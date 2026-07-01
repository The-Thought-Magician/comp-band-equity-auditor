import { Hono } from 'hono'
import { eq, and, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import { positionings, employees, bands, engine_runs, cohorts } from '../db/schema.js'
import { getUserId } from '../lib/auth.js'
import { requireWorkspace } from './workspaces.js'

const router = new Hono()

async function readWorkspaceId(c: any): Promise<string> {
  const userId = getUserId(c)
  if (userId) {
    const ws = await requireWorkspace(userId)
    return ws.id
  }
  return 'demo-workspace'
}

interface EmployeeRow {
  id: string
  level: string
  role_family: string
  geo: string
  gender: string | null
  ethnicity: string | null
  tenure_months: number
  base_salary: number
  [k: string]: unknown
}

/**
 * Does an employee satisfy a cohort definition? The definition is a flat map of
 * field -> value | value[] over employee columns. An empty definition matches
 * everyone.
 */
function matchesCohort(emp: EmployeeRow, def: Record<string, unknown>): boolean {
  for (const [field, expected] of Object.entries(def ?? {})) {
    if (expected === undefined || expected === null || expected === '') continue
    const actual = emp[field]
    if (Array.isArray(expected)) {
      if (!expected.map(String).includes(String(actual))) return false
    } else if (String(actual) !== String(expected)) {
      return false
    }
  }
  return true
}

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base])
  }
  return sorted[base]
}

// ---------------------------------------------------------------------------
// GET /distribution — compa-ratio distribution buckets + stats for a run
// (registered before /:id so the literal path is not captured as a param)
// ---------------------------------------------------------------------------

router.get('/distribution', async (c) => {
  const runId = c.req.query('engine_run_id')
  if (!runId) return c.json({ error: 'engine_run_id is required' }, 400)
  const cohortId = c.req.query('cohort_id')

  const [run] = await db.select().from(engine_runs).where(eq(engine_runs.id, runId))
  if (!run) return c.json({ error: 'Run not found' }, 404)

  const rows = await db
    .select()
    .from(positionings)
    .where(eq(positionings.engine_run_id, runId))

  // Optional cohort filter: join through employees and apply the definition.
  let allowed: Set<string> | null = null
  if (cohortId) {
    const [cohort] = await db.select().from(cohorts).where(eq(cohorts.id, cohortId))
    if (cohort) {
      const emps = (await db
        .select()
        .from(employees)
        .where(eq(employees.dataset_id, run.dataset_id))) as unknown as EmployeeRow[]
      const def = (cohort.definition ?? {}) as Record<string, unknown>
      allowed = new Set(emps.filter((e) => matchesCohort(e, def)).map((e) => e.id))
    }
  }

  const values = rows
    .filter((r) => (allowed ? allowed.has(r.employee_id) : true))
    .map((r) => r.compa_ratio)
    .filter((v): v is number => v !== null && v !== undefined)

  // Fixed compa-ratio buckets covering the meaningful range.
  const edges = [0, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, Infinity]
  const labels = [
    '<0.70',
    '0.70-0.80',
    '0.80-0.90',
    '0.90-1.00',
    '1.00-1.10',
    '1.10-1.20',
    '1.20-1.30',
    '>1.30',
  ]
  const buckets = labels.map((label) => ({ label, count: 0 }))
  for (const v of values) {
    for (let i = 0; i < edges.length - 1; i++) {
      if (v >= edges[i] && v < edges[i + 1]) {
        buckets[i].count++
        break
      }
    }
  }

  const sorted = [...values].sort((a, b) => a - b)
  const sum = values.reduce((a, b) => a + b, 0)
  const mean = values.length > 0 ? sum / values.length : null
  const variance =
    values.length > 0
      ? values.reduce((a, b) => a + (b - (mean as number)) ** 2, 0) / values.length
      : null

  const stats = {
    count: values.length,
    mean,
    median: quantile(sorted, 0.5),
    min: sorted.length > 0 ? sorted[0] : null,
    max: sorted.length > 0 ? sorted[sorted.length - 1] : null,
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75),
    p90: quantile(sorted, 0.9),
    std_dev: variance !== null ? Math.sqrt(variance) : null,
  }

  return c.json({ buckets, stats })
})

// ---------------------------------------------------------------------------
// GET / — list positionings for an engine_run_id (optionally filter by flag)
// ---------------------------------------------------------------------------

/**
 * Attach employee identity fields (name/ref, level, geo) to each positioning
 * row so the UI can render a human-readable table without a second round trip.
 */
async function withEmployeeFields<T extends { employee_id: string }>(
  rows: T[]
): Promise<(T & { employee_name?: string; level?: string; geo?: string })[]> {
  const ids = Array.from(new Set(rows.map((r) => r.employee_id)))
  if (ids.length === 0) return rows
  const emps = await db.select().from(employees).where(inArray(employees.id, ids))
  const empMap = new Map(emps.map((e) => [e.id, e]))
  return rows.map((r) => {
    const emp = empMap.get(r.employee_id)
    return {
      ...r,
      employee_name: emp?.name || emp?.employee_ref || undefined,
      level: emp?.level ?? undefined,
      geo: emp?.geo ?? undefined,
    }
  })
}

router.get('/', async (c) => {
  const runId = c.req.query('engine_run_id')
  const flag = c.req.query('flag')

  if (!runId) {
    // Without a run id, scope to the workspace to avoid leaking cross-tenant rows.
    const wsId = await readWorkspaceId(c)
    const rows = await db
      .select()
      .from(positionings)
      .where(eq(positionings.workspace_id, wsId))
    const filtered = flag
      ? rows.filter((r) => (r.flags ?? []).includes(flag))
      : rows
    return c.json(await withEmployeeFields(filtered))
  }

  const rows = await db
    .select()
    .from(positionings)
    .where(eq(positionings.engine_run_id, runId))
  const filtered = flag ? rows.filter((r) => (r.flags ?? []).includes(flag)) : rows
  return c.json(await withEmployeeFields(filtered))
})

// ---------------------------------------------------------------------------
// GET /:id — single positioning with band + employee + the math shown
// ---------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [p] = await db.select().from(positionings).where(eq(positionings.id, id))
  if (!p) return c.json({ error: 'Not found' }, 404)

  const [employee] = await db.select().from(employees).where(eq(employees.id, p.employee_id))
  const band = p.band_id
    ? (await db.select().from(bands).where(eq(bands.id, p.band_id)))[0] ?? null
    : null

  // Reconstruct the arithmetic so the UI can render "show your work".
  const math: Record<string, unknown> = {
    base_salary: employee?.base_salary ?? null,
    fte: employee?.fte ?? null,
    base_salary_normalized: p.base_salary_normalized,
  }
  if (band) {
    math.band_min = band.min_salary
    math.band_mid = band.mid_salary
    math.band_max = band.max_salary
    math.compa_ratio_formula = 'base_salary_normalized / band_mid'
    math.compa_ratio =
      band.mid_salary > 0 && p.base_salary_normalized !== null
        ? p.base_salary_normalized / band.mid_salary
        : null
    math.range_penetration_formula = '(base_salary_normalized - band_min) / (band_max - band_min)'
    const span = band.max_salary - band.min_salary
    math.range_penetration =
      span > 0 && p.base_salary_normalized !== null
        ? (p.base_salary_normalized - band.min_salary) / span
        : null
    math.target_compa_low = band.target_compa_low
    math.target_compa_high = band.target_compa_high
  }

  return c.json({ ...p, employee: employee ?? null, band, math })
})

export default router
