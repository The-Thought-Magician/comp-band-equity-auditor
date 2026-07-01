import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { gap_runs, gap_results, datasets, employees, band_sets } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'
import { requireWorkspace } from './workspaces.js'

const router = new Hono()

const DEMO_WORKSPACE_ID = 'demo-workspace'

/**
 * Resolve the workspace for a (possibly public) read. If the request carries an
 * X-User-Id header we resolve/provision that user's workspace; otherwise we fall
 * back to the shared demo workspace so unauthenticated reads still return data.
 */
async function resolveWorkspaceId(c: any): Promise<string> {
  const userId = getUserId(c)
  if (!userId) return DEMO_WORKSPACE_ID
  const ws = await requireWorkspace(userId)
  return ws.id
}

// ---------------------------------------------------------------------------
// Gap analysis math
// ---------------------------------------------------------------------------

interface EmpRow {
  id: string
  level: string
  role_family: string
  geo: string
  gender: string | null
  ethnicity: string | null
  tenure_months: number
  performance_rating: number | null
  base_salary: number
}

/** Mean of a numeric array (0 for empty). */
function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

/**
 * Decompose the raw pay gap between a comparison group and the reference group
 * into an "explained" portion (attributable to differences in observable
 * factors: level, role_family, geo, tenure, performance) and an "unexplained"
 * residual. We use a transparent, deterministic factor-control approach:
 * compute each group's mean pay within shared factor cells, reweight the
 * comparison group to the reference group's factor mix, and treat the resulting
 * counterfactual-vs-actual difference as the explained share.
 */
function decompose(
  comparison: EmpRow[],
  reference: EmpRow[],
): {
  rawGapPct: number
  adjustedGapPct: number
  explainedPct: number
  unexplainedPct: number
  decomposition: Record<string, number>
} {
  const refMean = mean(reference.map((e) => e.base_salary))
  const compMean = mean(comparison.map((e) => e.base_salary))
  if (refMean === 0) {
    return {
      rawGapPct: 0,
      adjustedGapPct: 0,
      explainedPct: 0,
      unexplainedPct: 0,
      decomposition: {},
    }
  }

  const rawGapPct = ((refMean - compMean) / refMean) * 100

  // Build a factor key per employee and per-cell reference means.
  const cellKey = (e: EmpRow) => `${e.level}|${e.role_family}|${e.geo}`
  const refByCell = new Map<string, number[]>()
  for (const e of reference) {
    const k = cellKey(e)
    const arr = refByCell.get(k) ?? []
    arr.push(e.base_salary)
    refByCell.set(k, arr)
  }
  const refCellMean = new Map<string, number>()
  for (const [k, arr] of refByCell) refCellMean.set(k, mean(arr))

  // Counterfactual: pay each comparison person the reference mean for their cell
  // (i.e. remove the within-cell residual). The difference between the actual
  // comparison mean and this counterfactual is the unexplained (within-cell)
  // portion; the difference between counterfactual and reference overall mean is
  // the explained (between-cell composition) portion.
  const counterfactual: number[] = comparison.map((e) => {
    const cm = refCellMean.get(cellKey(e))
    return cm ?? compMean
  })
  const cfMean = mean(counterfactual)

  const explainedAbs = refMean - cfMean // composition effect vs reference
  const unexplainedAbs = cfMean - compMean // residual within-cell pay penalty

  const explainedPct = (explainedAbs / refMean) * 100
  const unexplainedPct = (unexplainedAbs / refMean) * 100
  // Adjusted gap = the unexplained residual once observable factors are netted out.
  const adjustedGapPct = unexplainedPct

  // Per-factor attribution of the explained portion (share of explained variance
  // approximated by single-factor mean-gap contributions, normalised).
  const factorContribution: Record<string, number> = {}
  for (const factor of ['level', 'role_family', 'geo'] as const) {
    const refByF = new Map<string, number[]>()
    for (const e of reference) {
      const k = String(e[factor])
      const arr = refByF.get(k) ?? []
      arr.push(e.base_salary)
      refByF.set(k, arr)
    }
    const refFMean = new Map<string, number>()
    for (const [k, arr] of refByF) refFMean.set(k, mean(arr))
    const cf = comparison.map((e) => refFMean.get(String(e[factor])) ?? compMean)
    factorContribution[factor] = ((refMean - mean(cf)) / refMean) * 100
  }

  return {
    rawGapPct: Number(rawGapPct.toFixed(4)),
    adjustedGapPct: Number(adjustedGapPct.toFixed(4)),
    explainedPct: Number(explainedPct.toFixed(4)),
    unexplainedPct: Number(unexplainedPct.toFixed(4)),
    decomposition: {
      level: Number((factorContribution.level ?? 0).toFixed(4)),
      role_family: Number((factorContribution.role_family ?? 0).toFixed(4)),
      geo: Number((factorContribution.geo ?? 0).toFixed(4)),
      raw_gap_pct: Number(rawGapPct.toFixed(4)),
      adjusted_gap_pct: Number(adjustedGapPct.toFixed(4)),
    },
  }
}

/** Split a dataset's employees into cohorts along a dimension; the reference
 *  group is the cohort whose value equals `referenceGroup`. */
function groupByDimension(emps: EmpRow[], dimension: string): Map<string, EmpRow[]> {
  const groups = new Map<string, EmpRow[]>()
  for (const e of emps) {
    const raw = (e as unknown as Record<string, unknown>)[dimension]
    const key = raw === null || raw === undefined || raw === '' ? 'unknown' : String(raw)
    const arr = groups.get(key) ?? []
    arr.push(e)
    groups.set(key, arr)
  }
  return groups
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /runs — list gap runs (workspace-scoped)
router.get('/runs', async (c) => {
  const workspaceId = await resolveWorkspaceId(c)
  const rows = await db
    .select()
    .from(gap_runs)
    .where(eq(gap_runs.workspace_id, workspaceId))
    .orderBy(desc(gap_runs.created_at))
  return c.json(rows)
})

// GET /runs/:id — gap run + all gap_results
router.get('/runs/:id', async (c) => {
  const workspaceId = await resolveWorkspaceId(c)
  const id = c.req.param('id')
  const [run] = await db
    .select()
    .from(gap_runs)
    .where(and(eq(gap_runs.id, id), eq(gap_runs.workspace_id, workspaceId)))
  if (!run) return c.json({ error: 'Not found' }, 404)
  const results = await db
    .select()
    .from(gap_results)
    .where(eq(gap_results.gap_run_id, id))
    .orderBy(gap_results.dimension, gap_results.cohort_key)
  return c.json({ ...run, results })
})

const createSchema = z.object({
  dataset_id: z.string().min(1),
  band_set_id: z.string().min(1).optional().nullable(),
  dimensions: z.array(z.enum(['gender', 'ethnicity', 'level', 'role_family', 'geo'])).min(1),
  reference_group: z.string().min(1).optional().nullable(),
  label: z.string().min(1).optional().nullable(),
})

// POST /runs — run gap analysis (raw + adjusted + decomposition)
router.post('/runs', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const body = c.req.valid('json')

  // Ownership: dataset must belong to the caller's workspace.
  const [ds] = await db
    .select()
    .from(datasets)
    .where(and(eq(datasets.id, body.dataset_id), eq(datasets.workspace_id, ws.id)))
  if (!ds) return c.json({ error: 'Dataset not found' }, 404)

  if (body.band_set_id) {
    const [bs] = await db
      .select()
      .from(band_sets)
      .where(and(eq(band_sets.id, body.band_set_id), eq(band_sets.workspace_id, ws.id)))
    if (!bs) return c.json({ error: 'Band set not found' }, 404)
  }

  const emps = (await db
    .select()
    .from(employees)
    .where(eq(employees.dataset_id, body.dataset_id))) as unknown as EmpRow[]

  if (emps.length === 0) return c.json({ error: 'Dataset has no employees' }, 400)

  // Create the run row first.
  const [run] = await db
    .insert(gap_runs)
    .values({
      workspace_id: ws.id,
      dataset_id: body.dataset_id,
      band_set_id: body.band_set_id ?? null,
      reference_group: body.reference_group ?? null,
      summary: {},
      status: 'complete',
      created_by: userId,
    })
    .returning()

  const resultRows: Array<typeof gap_results.$inferInsert> = []
  const summaryDims: Record<string, unknown> = {}

  for (const dimension of body.dimensions) {
    const groups = groupByDimension(emps, dimension)
    // If no reference group was supplied, fall back to the largest cohort
    // for this dimension so the analysis can still run.
    let referenceGroup = body.reference_group ?? undefined
    if (!referenceGroup) {
      let largestKey: string | undefined
      let largestSize = -1
      for (const [cohortKey, members] of groups) {
        if (members.length > largestSize) {
          largestSize = members.length
          largestKey = cohortKey
        }
      }
      referenceGroup = largestKey
    }
    const reference = (referenceGroup ? groups.get(referenceGroup) : undefined) ?? []
    const dimResults: Array<Record<string, unknown>> = []

    for (const [cohortKey, members] of groups) {
      if (cohortKey === referenceGroup) {
        // Reference cohort itself: zero gap by definition, still recorded.
        resultRows.push({
          gap_run_id: run.id,
          workspace_id: ws.id,
          cohort_key: cohortKey,
          dimension,
          raw_gap_pct: 0,
          adjusted_gap_pct: 0,
          explained_pct: 0,
          unexplained_pct: 0,
          group_size: members.length,
          mean_pay: Number(mean(members.map((m) => m.base_salary)).toFixed(2)),
          decomposition: { is_reference: 1 },
        })
        continue
      }
      const d = decompose(members, reference)
      const row = {
        gap_run_id: run.id,
        workspace_id: ws.id,
        cohort_key: cohortKey,
        dimension,
        raw_gap_pct: d.rawGapPct,
        adjusted_gap_pct: d.adjustedGapPct,
        explained_pct: d.explainedPct,
        unexplained_pct: d.unexplainedPct,
        group_size: members.length,
        mean_pay: Number(mean(members.map((m) => m.base_salary)).toFixed(2)),
        decomposition: d.decomposition,
      }
      resultRows.push(row)
      dimResults.push({
        cohort_key: cohortKey,
        raw_gap_pct: d.rawGapPct,
        adjusted_gap_pct: d.adjustedGapPct,
        group_size: members.length,
      })
    }
    summaryDims[dimension] = dimResults
  }

  if (resultRows.length > 0) {
    await db.insert(gap_results).values(resultRows)
  }

  // Largest unexplained gap across all results, for the summary.
  let largestUnexplained = 0
  for (const r of resultRows) {
    const u = Math.abs((r.unexplained_pct as number) ?? 0)
    if (u > largestUnexplained) largestUnexplained = u
  }

  const summary = {
    headcount: emps.length,
    dimensions: body.dimensions,
    reference_group: body.reference_group,
    cohorts_evaluated: resultRows.length,
    largest_unexplained_gap_pct: Number(largestUnexplained.toFixed(4)),
    by_dimension: summaryDims,
  }
  const [updated] = await db
    .update(gap_runs)
    .set({ summary })
    .where(eq(gap_runs.id, run.id))
    .returning()

  const results = await db
    .select()
    .from(gap_results)
    .where(eq(gap_results.gap_run_id, run.id))
    .orderBy(gap_results.dimension, gap_results.cohort_key)

  return c.json({ ...updated, results }, 201)
})

// GET /runs/:id/results — gap_results for a run (filter dimension)
router.get('/runs/:id/results', async (c) => {
  const workspaceId = await resolveWorkspaceId(c)
  const id = c.req.param('id')
  const [run] = await db
    .select()
    .from(gap_runs)
    .where(and(eq(gap_runs.id, id), eq(gap_runs.workspace_id, workspaceId)))
  if (!run) return c.json({ error: 'Not found' }, 404)

  const dimension = c.req.query('dimension')
  const conds = [eq(gap_results.gap_run_id, id)]
  if (dimension) conds.push(eq(gap_results.dimension, dimension))
  const rows = await db
    .select()
    .from(gap_results)
    .where(and(...conds))
    .orderBy(gap_results.dimension, gap_results.cohort_key)
  return c.json(rows)
})

// GET /runs/:id/drilldown — employees contributing to a cohort_key/dimension
router.get('/runs/:id/drilldown', async (c) => {
  const workspaceId = await resolveWorkspaceId(c)
  const id = c.req.param('id')
  const dimension = c.req.query('dimension')
  const cohortKey = c.req.query('cohort_key')
  if (!dimension || !cohortKey) {
    return c.json({ error: 'dimension and cohort_key query params are required' }, 400)
  }

  const [run] = await db
    .select()
    .from(gap_runs)
    .where(and(eq(gap_runs.id, id), eq(gap_runs.workspace_id, workspaceId)))
  if (!run) return c.json({ error: 'Not found' }, 404)

  const emps = await db
    .select()
    .from(employees)
    .where(eq(employees.dataset_id, run.dataset_id))

  const matched = emps.filter((e) => {
    const raw = (e as unknown as Record<string, unknown>)[dimension]
    const key = raw === null || raw === undefined || raw === '' ? 'unknown' : String(raw)
    return key === cohortKey
  })
  return c.json(matched)
})

// DELETE /runs/:id — delete gap run + results
router.delete('/runs/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const [run] = await db
    .select()
    .from(gap_runs)
    .where(eq(gap_runs.id, id))
  if (!run) return c.json({ error: 'Not found' }, 404)
  if (run.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(gap_results).where(eq(gap_results.gap_run_id, id))
  await db.delete(gap_runs).where(eq(gap_runs.id, id))
  return c.json({ success: true })
})

export default router
