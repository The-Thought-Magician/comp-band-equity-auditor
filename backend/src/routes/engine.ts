import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  engine_runs,
  positionings,
  datasets,
  employees,
  band_sets,
  bands,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'
import { requireWorkspace } from './workspaces.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a workspace id for a read request. Reads are public but always
 * scoped to a workspace. If the caller presents an X-User-Id header we scope
 * to that user's workspace; otherwise we fall back to the demo workspace so
 * unauthenticated landing/demo views see seeded data.
 */
async function readWorkspaceId(c: any): Promise<string> {
  const userId = getUserId(c)
  if (userId) {
    const ws = await requireWorkspace(userId)
    return ws.id
  }
  return 'demo-workspace'
}

interface BandRow {
  id: string
  level: string
  role_family: string
  geo: string
  currency: string
  min_salary: number
  mid_salary: number
  max_salary: number
  target_compa_low: number
  target_compa_high: number
}

interface EmployeeRow {
  id: string
  level: string
  role_family: string
  geo: string
  base_salary: number
  fte: number
}

/**
 * Pick the band that best matches an employee. Exact match on
 * (level, role_family, geo) first, then progressively looser matches so every
 * employee that can be placed gets a band.
 */
function matchBand(emp: EmployeeRow, bandList: BandRow[]): BandRow | null {
  const exact = bandList.find(
    (b) => b.level === emp.level && b.role_family === emp.role_family && b.geo === emp.geo,
  )
  if (exact) return exact
  const byLevelRole = bandList.find(
    (b) => b.level === emp.level && b.role_family === emp.role_family,
  )
  if (byLevelRole) return byLevelRole
  const byLevelGeo = bandList.find((b) => b.level === emp.level && b.geo === emp.geo)
  if (byLevelGeo) return byLevelGeo
  const byLevel = bandList.find((b) => b.level === emp.level)
  if (byLevel) return byLevel
  return null
}

function computePositioning(emp: EmployeeRow, band: BandRow) {
  // Normalize to a full-time-equivalent salary so part-timers compare fairly.
  const fte = emp.fte && emp.fte > 0 ? emp.fte : 1
  const normalized = emp.base_salary / fte

  const compaRatio = band.mid_salary > 0 ? normalized / band.mid_salary : null
  const span = band.max_salary - band.min_salary
  const rangePenetration = span > 0 ? (normalized - band.min_salary) / span : null

  // Quartile 1..4 by where in the band the salary lands.
  let quartile: number | null = null
  if (rangePenetration !== null) {
    const rp = Math.max(0, Math.min(1, rangePenetration))
    quartile = Math.min(4, Math.floor(rp * 4) + 1)
  }

  const flags: string[] = []
  if (rangePenetration !== null) {
    if (normalized < band.min_salary) flags.push('below_min')
    if (normalized > band.max_salary) flags.push('above_max')
  }
  if (compaRatio !== null) {
    if (compaRatio < band.target_compa_low) flags.push('below_target')
    if (compaRatio > band.target_compa_high) flags.push('above_target')
    if (compaRatio < 0.8) flags.push('green_circle')
    if (compaRatio > 1.2) flags.push('red_circle')
  }

  return {
    band_id: band.id,
    compa_ratio: compaRatio,
    range_penetration: rangePenetration,
    quartile,
    flags,
    base_salary_normalized: normalized,
  }
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

// ---------------------------------------------------------------------------
// GET /runs — list engine runs
// ---------------------------------------------------------------------------

router.get('/runs', async (c) => {
  const wsId = await readWorkspaceId(c)
  const rows = await db
    .select()
    .from(engine_runs)
    .where(eq(engine_runs.workspace_id, wsId))
    .orderBy(desc(engine_runs.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /runs/:id — engine run detail + summary
// ---------------------------------------------------------------------------

router.get('/runs/:id', async (c) => {
  const id = c.req.param('id')
  const [run] = await db.select().from(engine_runs).where(eq(engine_runs.id, id))
  if (!run) return c.json({ error: 'Not found' }, 404)
  return c.json(run)
})

// ---------------------------------------------------------------------------
// POST /runs — run the compa-ratio engine
// ---------------------------------------------------------------------------

const runSchema = z.object({
  dataset_id: z.string().min(1),
  band_set_id: z.string().min(1),
  label: z.string().min(1).optional(),
})

router.post('/runs', authMiddleware, zValidator('json', runSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const body = c.req.valid('json')

  // Ownership: dataset + band set must belong to caller's workspace.
  const [dataset] = await db
    .select()
    .from(datasets)
    .where(and(eq(datasets.id, body.dataset_id), eq(datasets.workspace_id, ws.id)))
  if (!dataset) return c.json({ error: 'Dataset not found' }, 404)

  const [bandSet] = await db
    .select()
    .from(band_sets)
    .where(and(eq(band_sets.id, body.band_set_id), eq(band_sets.workspace_id, ws.id)))
  if (!bandSet) return c.json({ error: 'Band set not found' }, 404)

  const emps = (await db
    .select()
    .from(employees)
    .where(eq(employees.dataset_id, body.dataset_id))) as unknown as Array<
    EmployeeRow & Record<string, unknown>
  >

  const bandList = (await db
    .select()
    .from(bands)
    .where(eq(bands.band_set_id, body.band_set_id))) as unknown as BandRow[]

  // Create the run shell first so positionings can reference it.
  const [run] = await db
    .insert(engine_runs)
    .values({
      workspace_id: ws.id,
      dataset_id: body.dataset_id,
      band_set_id: body.band_set_id,
      label: body.label ?? `Run ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`,
      status: 'complete',
      created_by: userId,
      summary: {},
    })
    .returning()

  const compaValues: number[] = []
  const flagCounts: Record<string, number> = {}
  let unbanded = 0
  const rowsToInsert: Array<Record<string, unknown>> = []

  for (const emp of emps) {
    const band = matchBand(emp, bandList)
    if (!band) {
      unbanded++
      rowsToInsert.push({
        engine_run_id: run.id,
        workspace_id: ws.id,
        employee_id: emp.id,
        band_id: null,
        compa_ratio: null,
        range_penetration: null,
        quartile: null,
        flags: ['unbanded'],
        base_salary_normalized: emp.fte && emp.fte > 0 ? emp.base_salary / emp.fte : emp.base_salary,
      })
      flagCounts['unbanded'] = (flagCounts['unbanded'] ?? 0) + 1
      continue
    }
    const p = computePositioning(emp, band)
    if (p.compa_ratio !== null) compaValues.push(p.compa_ratio)
    for (const f of p.flags) flagCounts[f] = (flagCounts[f] ?? 0) + 1
    rowsToInsert.push({
      engine_run_id: run.id,
      workspace_id: ws.id,
      employee_id: emp.id,
      ...p,
    })
  }

  if (rowsToInsert.length > 0) {
    // Chunk inserts to keep statement size bounded.
    const chunkSize = 200
    for (let i = 0; i < rowsToInsert.length; i += chunkSize) {
      await db.insert(positionings).values(rowsToInsert.slice(i, i + chunkSize) as any)
    }
  }

  const summary = {
    headcount: emps.length,
    banded: emps.length - unbanded,
    unbanded,
    median_compa_ratio: median(compaValues),
    mean_compa_ratio:
      compaValues.length > 0
        ? compaValues.reduce((a, b) => a + b, 0) / compaValues.length
        : null,
    min_compa_ratio: compaValues.length > 0 ? Math.min(...compaValues) : null,
    max_compa_ratio: compaValues.length > 0 ? Math.max(...compaValues) : null,
    flag_counts: flagCounts,
    outlier_count:
      (flagCounts['below_min'] ?? 0) +
      (flagCounts['above_max'] ?? 0) +
      (flagCounts['green_circle'] ?? 0) +
      (flagCounts['red_circle'] ?? 0),
  }

  const [updated] = await db
    .update(engine_runs)
    .set({ summary })
    .where(eq(engine_runs.id, run.id))
    .returning()

  return c.json(updated, 201)
})

// ---------------------------------------------------------------------------
// DELETE /runs/:id — delete run + positionings
// ---------------------------------------------------------------------------

router.delete('/runs/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const [run] = await db.select().from(engine_runs).where(eq(engine_runs.id, id))
  if (!run) return c.json({ error: 'Not found' }, 404)
  if (run.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(positionings).where(eq(positionings.engine_run_id, id))
  await db.delete(engine_runs).where(eq(engine_runs.id, id))
  return c.json({ success: true })
})

export default router
