import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  scenarios,
  scenario_adjustments,
  datasets,
  band_sets,
  bands,
  employees,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'
import { requireWorkspace } from './workspaces.js'

const router = new Hono()

const DEMO_WORKSPACE_ID = 'demo-workspace'

async function resolveWorkspaceId(c: any): Promise<string> {
  const userId = getUserId(c)
  if (!userId) return DEMO_WORKSPACE_ID
  const ws = await requireWorkspace(userId)
  return ws.id
}

// ---------------------------------------------------------------------------
// Remediation math
// ---------------------------------------------------------------------------

interface EmpRow {
  id: string
  level: string
  role_family: string
  geo: string
  gender: string | null
  base_salary: number
}

interface BandRow {
  level: string
  role_family: string
  geo: string
  min_salary: number
  mid_salary: number
  max_salary: number
  target_compa_low: number
  target_compa_high: number
}

type TargetType = 'to_min' | 'to_mid' | 'to_band_floor' | 'close_unexplained'

function bandKey(level: string, role_family: string, geo: string): string {
  return `${level}|${role_family}|${geo}`
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

/** Raw mean-pay gap (%) of a comparison group vs the reference group. */
function rawGapPct(comparison: EmpRow[], reference: EmpRow[]): number {
  const refMean = mean(reference.map((e) => e.base_salary))
  const compMean = mean(comparison.map((e) => e.base_salary))
  if (refMean === 0) return 0
  return ((refMean - compMean) / refMean) * 100
}

/**
 * Compute proposed salaries for each employee under a remediation target.
 * Returns the per-person adjustment (only positive raises are proposed) along
 * with the band map used. Constraints supported:
 *   - reference_group / protected_group / dimension: scope to a cohort
 *   - max_raise_pct: cap any single raise
 *   - budget_cap_cents: stop once the budget is exhausted (largest gaps first)
 */
function computeAdjustments(
  emps: EmpRow[],
  bandMap: Map<string, BandRow>,
  targetType: TargetType,
  constraints: Record<string, unknown>,
): Array<{ employee_id: string; current: number; proposed: number; rationale: string }> {
  const dimension = (constraints.dimension as string) ?? 'gender'
  const protectedGroup = constraints.protected_group as string | undefined
  const referenceGroup = constraints.reference_group as string | undefined
  const maxRaisePct = Number(constraints.max_raise_pct ?? 0) || 0

  // For 'close_unexplained' we lift the protected group's mean toward the
  // reference group's mean within each band cell.
  let refCellMean = new Map<string, number>()
  if (targetType === 'close_unexplained' && referenceGroup) {
    const byCell = new Map<string, number[]>()
    for (const e of emps) {
      const grp = String((e as unknown as Record<string, unknown>)[dimension] ?? '')
      if (grp !== referenceGroup) continue
      const k = bandKey(e.level, e.role_family, e.geo)
      const arr = byCell.get(k) ?? []
      arr.push(e.base_salary)
      byCell.set(k, arr)
    }
    for (const [k, arr] of byCell) refCellMean.set(k, mean(arr))
  }

  const out: Array<{
    employee_id: string
    current: number
    proposed: number
    rationale: string
  }> = []

  for (const e of emps) {
    // Scope: if a protected group is set, only adjust that group.
    if (protectedGroup) {
      const grp = String((e as unknown as Record<string, unknown>)[dimension] ?? '')
      if (grp !== protectedGroup) continue
    }

    const band = bandMap.get(bandKey(e.level, e.role_family, e.geo))
    let target = e.base_salary
    let rationale = ''

    if (targetType === 'to_min') {
      if (band && e.base_salary < band.min_salary) {
        target = band.min_salary
        rationale = 'Below band minimum; raised to band floor'
      }
    } else if (targetType === 'to_band_floor') {
      if (band) {
        const floor = band.min_salary * band.target_compa_low
        if (e.base_salary < floor) {
          target = floor
          rationale = `Below target compa floor (${band.target_compa_low}); raised to target floor`
        }
      }
    } else if (targetType === 'to_mid') {
      if (band && e.base_salary < band.mid_salary) {
        target = band.mid_salary
        rationale = 'Below band midpoint; raised to midpoint'
      }
    } else if (targetType === 'close_unexplained') {
      const cm = refCellMean.get(bandKey(e.level, e.role_family, e.geo))
      if (cm && e.base_salary < cm) {
        target = cm
        rationale = 'Below reference-group mean for band cell; raised to parity'
      }
    }

    if (maxRaisePct > 0 && target > e.base_salary) {
      const cap = e.base_salary * (1 + maxRaisePct / 100)
      if (target > cap) {
        target = cap
        rationale = `${rationale} (capped at ${maxRaisePct}% max raise)`.trim()
      }
    }

    if (target > e.base_salary) {
      out.push({
        employee_id: e.id,
        current: e.base_salary,
        proposed: Number(target.toFixed(2)),
        rationale: rationale || 'Remediation adjustment',
      })
    }
  }

  // Budget cap: apply the largest deltas first, drop the rest.
  const budgetCapCents = Number(constraints.budget_cap_cents ?? 0) || 0
  if (budgetCapCents > 0) {
    out.sort((a, b) => b.proposed - b.current - (a.proposed - a.current))
    const kept: typeof out = []
    let spent = 0
    for (const adj of out) {
      const deltaCents = Math.round((adj.proposed - adj.current) * 100)
      if (spent + deltaCents > budgetCapCents) continue
      spent += deltaCents
      kept.push(adj)
    }
    return kept
  }

  return out
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET / — list scenarios
router.get('/', async (c) => {
  const workspaceId = await resolveWorkspaceId(c)
  const rows = await db
    .select()
    .from(scenarios)
    .where(eq(scenarios.workspace_id, workspaceId))
    .orderBy(desc(scenarios.created_at))
  return c.json(rows)
})

// GET /compare — compare scenarios by ids (?ids=a,b,c). Declared before /:id.
router.get('/compare', async (c) => {
  const workspaceId = await resolveWorkspaceId(c)
  const idsParam = c.req.query('ids') ?? ''
  const ids = idsParam.split(',').map((s) => s.trim()).filter(Boolean)
  if (ids.length === 0) return c.json({ rows: [] })
  const rows = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.workspace_id, workspaceId), inArray(scenarios.id, ids)))
  const out = rows.map((s) => ({
    id: s.id,
    name: s.name,
    target_type: s.target_type,
    total_budget_cents: s.total_budget_cents,
    headcount_affected: s.headcount_affected,
    residual_gap_pct: s.residual_gap_pct,
    cost_per_point: s.residual_gap_pct
      ? Number((s.total_budget_cents / Math.max(0.01, Math.abs(s.residual_gap_pct))).toFixed(2))
      : null,
  }))
  return c.json({ rows: out })
})

// GET /:id — scenario + adjustments
router.get('/:id', async (c) => {
  const workspaceId = await resolveWorkspaceId(c)
  const id = c.req.param('id')
  const [s] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.id, id), eq(scenarios.workspace_id, workspaceId)))
  if (!s) return c.json({ error: 'Not found' }, 404)
  const adjustments = await db
    .select()
    .from(scenario_adjustments)
    .where(eq(scenario_adjustments.scenario_id, id))
    .orderBy(desc(scenario_adjustments.delta_cents))
  return c.json({ ...s, adjustments })
})

const createSchema = z.object({
  name: z.string().min(1),
  dataset_id: z.string().min(1),
  band_set_id: z.string().min(1),
  target_type: z
    .enum(['to_min', 'to_mid', 'to_band_floor', 'close_unexplained'])
    .default('to_min'),
  constraints: z.record(z.string(), z.unknown()).optional().default({}),
})

// POST / — build scenario: compute adjustments + budget + residual gap
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const body = c.req.valid('json')

  const [ds] = await db
    .select()
    .from(datasets)
    .where(and(eq(datasets.id, body.dataset_id), eq(datasets.workspace_id, ws.id)))
  if (!ds) return c.json({ error: 'Dataset not found' }, 404)

  const [bs] = await db
    .select()
    .from(band_sets)
    .where(and(eq(band_sets.id, body.band_set_id), eq(band_sets.workspace_id, ws.id)))
  if (!bs) return c.json({ error: 'Band set not found' }, 404)

  const emps = (await db
    .select()
    .from(employees)
    .where(eq(employees.dataset_id, body.dataset_id))) as unknown as EmpRow[]
  if (emps.length === 0) return c.json({ error: 'Dataset has no employees' }, 400)

  const bandRows = (await db
    .select()
    .from(bands)
    .where(eq(bands.band_set_id, body.band_set_id))) as unknown as BandRow[]
  const bandMap = new Map<string, BandRow>()
  for (const b of bandRows) bandMap.set(bandKey(b.level, b.role_family, b.geo), b)

  const adjustments = computeAdjustments(
    emps,
    bandMap,
    body.target_type as TargetType,
    body.constraints as Record<string, unknown>,
  )

  // Residual gap: recompute the raw cohort gap after applying proposals.
  const constraints = body.constraints as Record<string, unknown>
  const dimension = (constraints.dimension as string) ?? 'gender'
  const protectedGroup = constraints.protected_group as string | undefined
  const referenceGroup = constraints.reference_group as string | undefined

  const proposedById = new Map(adjustments.map((a) => [a.employee_id, a.proposed]))
  const afterEmps: EmpRow[] = emps.map((e) => ({
    ...e,
    base_salary: proposedById.get(e.id) ?? e.base_salary,
  }))

  let residualGapPct: number | null = null
  if (protectedGroup && referenceGroup) {
    const comp = afterEmps.filter(
      (e) => String((e as unknown as Record<string, unknown>)[dimension] ?? '') === protectedGroup,
    )
    const ref = afterEmps.filter(
      (e) =>
        String((e as unknown as Record<string, unknown>)[dimension] ?? '') === referenceGroup,
    )
    residualGapPct = Number(rawGapPct(comp, ref).toFixed(4))
  }

  const totalBudgetCents = adjustments.reduce(
    (sum, a) => sum + Math.round((a.proposed - a.current) * 100),
    0,
  )

  const [scenario] = await db
    .insert(scenarios)
    .values({
      workspace_id: ws.id,
      dataset_id: body.dataset_id,
      band_set_id: body.band_set_id,
      name: body.name,
      target_type: body.target_type,
      constraints: body.constraints,
      total_budget_cents: totalBudgetCents,
      headcount_affected: adjustments.length,
      residual_gap_pct: residualGapPct,
      status: 'complete',
      created_by: userId,
    })
    .returning()

  if (adjustments.length > 0) {
    await db.insert(scenario_adjustments).values(
      adjustments.map((a) => ({
        scenario_id: scenario.id,
        workspace_id: ws.id,
        employee_id: a.employee_id,
        current_salary: a.current,
        proposed_salary: a.proposed,
        delta_cents: Math.round((a.proposed - a.current) * 100),
        rationale: a.rationale,
      })),
    )
  }

  const saved = await db
    .select()
    .from(scenario_adjustments)
    .where(eq(scenario_adjustments.scenario_id, scenario.id))
    .orderBy(desc(scenario_adjustments.delta_cents))

  return c.json({ ...scenario, adjustments: saved }, 201)
})

// GET /:id/sensitivity — budget-vs-residual-gap curve
router.get('/:id/sensitivity', async (c) => {
  const workspaceId = await resolveWorkspaceId(c)
  const id = c.req.param('id')
  const [s] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.id, id), eq(scenarios.workspace_id, workspaceId)))
  if (!s) return c.json({ error: 'Not found' }, 404)

  const adjs = await db
    .select()
    .from(scenario_adjustments)
    .where(eq(scenario_adjustments.scenario_id, id))

  // Recompute the cohort gap progressively as we fund adjustments largest-first.
  const emps = (await db
    .select()
    .from(employees)
    .where(eq(employees.dataset_id, s.dataset_id))) as unknown as EmpRow[]

  const constraints = (s.constraints ?? {}) as Record<string, unknown>
  const dimension = (constraints.dimension as string) ?? 'gender'
  const protectedGroup = constraints.protected_group as string | undefined
  const referenceGroup = constraints.reference_group as string | undefined

  const sorted = [...adjs].sort((a, b) => b.delta_cents - a.delta_cents)
  const proposedById = new Map<string, number>()

  function gapNow(): number | null {
    if (!protectedGroup || !referenceGroup) return null
    const after = emps.map((e) => ({
      ...e,
      base_salary: proposedById.get(e.id) ?? e.base_salary,
    }))
    const comp = after.filter(
      (e) => String((e as unknown as Record<string, unknown>)[dimension] ?? '') === protectedGroup,
    )
    const ref = after.filter(
      (e) =>
        String((e as unknown as Record<string, unknown>)[dimension] ?? '') === referenceGroup,
    )
    return Number(rawGapPct(comp, ref).toFixed(4))
  }

  const points: Array<{ budget_cents: number; residual_gap_pct: number | null; funded: number }> = [
    { budget_cents: 0, residual_gap_pct: gapNow(), funded: 0 },
  ]
  let spent = 0
  let funded = 0
  for (const a of sorted) {
    proposedById.set(a.employee_id, a.proposed_salary)
    spent += a.delta_cents
    funded += 1
    points.push({ budget_cents: spent, residual_gap_pct: gapNow(), funded })
  }

  return c.json({ points })
})

// DELETE /:id — delete scenario + adjustments
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const [s] = await db.select().from(scenarios).where(eq(scenarios.id, id))
  if (!s) return c.json({ error: 'Not found' }, 404)
  if (s.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(scenario_adjustments).where(eq(scenario_adjustments.scenario_id, id))
  await db.delete(scenarios).where(eq(scenarios.id, id))
  return c.json({ success: true })
})

export default router
