import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  workspaces,
  merit_cycles,
  merit_allocations,
  employees,
  bands,
  positionings,
  engine_runs,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// workspace helper — find-or-create the caller's single workspace
// ---------------------------------------------------------------------------

async function requireWorkspace(userId: string) {
  const existing = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.owner_id, userId))
    .limit(1)
  if (existing.length > 0) return existing[0]
  const [created] = await db
    .insert(workspaces)
    .values({ name: 'My Workspace', owner_id: userId })
    .returning()
  return created
}

// ---------------------------------------------------------------------------
// allocation models — pure, deterministic merit math over the cycle inputs
// ---------------------------------------------------------------------------

type ModelName = 'compa_ratio' | 'flat' | 'performance' | 'equity'

interface EmpInput {
  id: string
  current_salary: number
  performance_rating: number | null
  compa_ratio: number | null
  range_penetration: number | null
}

/**
 * Compute per-employee weights for a given model, then scale them so the total
 * recommended increase equals the budget (in cents). Returns a map of
 * employee_id -> recommended_increase_cents (integer).
 */
function computeAllocations(
  emps: EmpInput[],
  model: ModelName,
  budgetCents: number,
): Map<string, number> {
  const weights = new Map<string, number>()
  let totalWeight = 0

  for (const e of emps) {
    let w = 0
    if (model === 'flat') {
      // equal share of the budget regardless of attributes
      w = 1
    } else if (model === 'performance') {
      // higher performers get a larger share; default rating 3 of 5
      const rating = e.performance_rating ?? 3
      w = Math.max(0, rating)
    } else if (model === 'equity') {
      // people furthest BELOW market (low compa-ratio) get the largest share
      const compa = e.compa_ratio ?? 1
      w = Math.max(0, 1 - compa)
      // everyone at/above market still eligible for a token share
      if (w === 0) w = 0.05
    } else {
      // compa_ratio model: weight by how far below mid (compa 1.0) someone sits,
      // tempered by performance so strong performers below mid get the most.
      const compa = e.compa_ratio ?? 1
      const rating = e.performance_rating ?? 3
      const below = Math.max(0, 1 - compa)
      w = below * (rating / 3) + 0.05
    }
    weights.set(e.id, w)
    totalWeight += w
  }

  const out = new Map<string, number>()
  if (totalWeight <= 0 || budgetCents <= 0) {
    for (const e of emps) out.set(e.id, 0)
    return out
  }
  for (const e of emps) {
    const w = weights.get(e.id) ?? 0
    out.set(e.id, Math.round((w / totalWeight) * budgetCents))
  }
  return out
}

function summarize(
  emps: EmpInput[],
  alloc: Map<string, number>,
  budgetCents: number,
) {
  let allocated = 0
  let count = 0
  for (const v of alloc.values()) {
    allocated += v
    if (v > 0) count += 1
  }
  const totalCurrentCents = emps.reduce(
    (acc, e) => acc + Math.round(e.current_salary * 100),
    0,
  )
  return {
    budget_cents: budgetCents,
    allocated_cents: allocated,
    remaining_cents: budgetCents - allocated,
    employees_affected: count,
    headcount: emps.length,
    avg_increase_pct:
      totalCurrentCents > 0 ? (allocated / totalCurrentCents) * 100 : 0,
  }
}

// ---------------------------------------------------------------------------
// load the latest positioning math for a (dataset, band_set) pair so the
// compa_ratio / equity models have real compa-ratios to work with.
// ---------------------------------------------------------------------------

async function loadEmpInputs(
  workspaceId: string,
  datasetId: string,
  bandSetId: string,
): Promise<EmpInput[]> {
  const emps = await db
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.workspace_id, workspaceId),
        eq(employees.dataset_id, datasetId),
      ),
    )

  // Find the most recent engine run for this dataset+band_set, if any.
  const [run] = await db
    .select()
    .from(engine_runs)
    .where(
      and(
        eq(engine_runs.workspace_id, workspaceId),
        eq(engine_runs.dataset_id, datasetId),
        eq(engine_runs.band_set_id, bandSetId),
      ),
    )
    .orderBy(desc(engine_runs.created_at))
    .limit(1)

  const compaByEmp = new Map<
    string,
    { compa_ratio: number | null; range_penetration: number | null }
  >()
  if (run) {
    const pos = await db
      .select()
      .from(positionings)
      .where(eq(positionings.engine_run_id, run.id))
    for (const p of pos) {
      compaByEmp.set(p.employee_id, {
        compa_ratio: p.compa_ratio,
        range_penetration: p.range_penetration,
      })
    }
  }

  return emps.map((e) => {
    const c = compaByEmp.get(e.id)
    return {
      id: e.id,
      current_salary: e.base_salary,
      performance_rating: e.performance_rating,
      compa_ratio: c?.compa_ratio ?? null,
      range_penetration: c?.range_penetration ?? null,
    }
  })
}

// ---------------------------------------------------------------------------
// GET / — list merit cycles (public read, workspace-scoped via header)
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])
  const ws = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.owner_id, userId))
    .limit(1)
  if (ws.length === 0) return c.json([])
  const rows = await db
    .select()
    .from(merit_cycles)
    .where(eq(merit_cycles.workspace_id, ws[0].id))
    .orderBy(desc(merit_cycles.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /:id — merit cycle + allocations
// ---------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [cycle] = await db
    .select()
    .from(merit_cycles)
    .where(eq(merit_cycles.id, id))
  if (!cycle) return c.json({ error: 'Not found' }, 404)
  const allocations = await db
    .select()
    .from(merit_allocations)
    .where(eq(merit_allocations.merit_cycle_id, id))
    .orderBy(desc(merit_allocations.recommended_increase_cents))
  return c.json({ ...cycle, allocations })
})

// ---------------------------------------------------------------------------
// POST / — create merit cycle + compute allocations for model + budget
// ---------------------------------------------------------------------------

const createSchema = z.object({
  name: z.string().min(1),
  dataset_id: z.string().min(1),
  band_set_id: z.string().min(1),
  budget_cents: z.number().int().nonnegative().default(0),
  model: z.enum(['compa_ratio', 'flat', 'performance', 'equity']).default('compa_ratio'),
})

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const body = c.req.valid('json')

  const inputs = await loadEmpInputs(ws.id, body.dataset_id, body.band_set_id)
  const alloc = computeAllocations(inputs, body.model, body.budget_cents)
  const summary = summarize(inputs, alloc, body.budget_cents)

  const [cycle] = await db
    .insert(merit_cycles)
    .values({
      workspace_id: ws.id,
      dataset_id: body.dataset_id,
      band_set_id: body.band_set_id,
      name: body.name,
      budget_cents: body.budget_cents,
      model: body.model,
      status: 'draft',
      summary,
      created_by: userId,
    })
    .returning()

  const allocations =
    inputs.length > 0
      ? await db
          .insert(merit_allocations)
          .values(
            inputs.map((e) => {
              const rec = alloc.get(e.id) ?? 0
              return {
                merit_cycle_id: cycle.id,
                workspace_id: ws.id,
                employee_id: e.id,
                current_salary: e.current_salary,
                recommended_increase_cents: rec,
                final_increase_cents: rec,
              }
            }),
          )
          .returning()
      : []

  return c.json({ ...cycle, allocations }, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id/allocations/:allocId — manager override of final_increase
// ---------------------------------------------------------------------------

const overrideSchema = z.object({
  final_increase_cents: z.number().int().nonnegative(),
  override_reason: z.string().optional(),
})

router.put(
  '/:id/allocations/:allocId',
  authMiddleware,
  zValidator('json', overrideSchema),
  async (c) => {
    const userId = getUserId(c)
    const ws = await requireWorkspace(userId)
    const cycleId = c.req.param('id')
    const allocId = c.req.param('allocId')

    const [cycle] = await db
      .select()
      .from(merit_cycles)
      .where(eq(merit_cycles.id, cycleId))
    if (!cycle) return c.json({ error: 'Not found' }, 404)
    if (cycle.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
    if (cycle.status === 'locked')
      return c.json({ error: 'Cycle is locked' }, 409)

    const [existing] = await db
      .select()
      .from(merit_allocations)
      .where(
        and(
          eq(merit_allocations.id, allocId),
          eq(merit_allocations.merit_cycle_id, cycleId),
        ),
      )
    if (!existing) return c.json({ error: 'Allocation not found' }, 404)

    const body = c.req.valid('json')
    const [updated] = await db
      .update(merit_allocations)
      .set({
        final_increase_cents: body.final_increase_cents,
        override_reason: body.override_reason ?? existing.override_reason,
      })
      .where(eq(merit_allocations.id, allocId))
      .returning()
    return c.json(updated)
  },
)

// ---------------------------------------------------------------------------
// POST /:id/lock — lock + snapshot the cycle, store post-cycle summary
// ---------------------------------------------------------------------------

router.post('/:id/lock', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')

  const [cycle] = await db
    .select()
    .from(merit_cycles)
    .where(eq(merit_cycles.id, id))
  if (!cycle) return c.json({ error: 'Not found' }, 404)
  if (cycle.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)

  const allocations = await db
    .select()
    .from(merit_allocations)
    .where(eq(merit_allocations.merit_cycle_id, id))

  let finalTotal = 0
  let recommendedTotal = 0
  let overrides = 0
  let totalCurrentCents = 0
  for (const a of allocations) {
    finalTotal += a.final_increase_cents
    recommendedTotal += a.recommended_increase_cents
    totalCurrentCents += Math.round(a.current_salary * 100)
    if (a.final_increase_cents !== a.recommended_increase_cents) overrides += 1
  }

  const postSummary = {
    ...(cycle.summary ?? {}),
    locked_at: new Date().toISOString(),
    final_allocated_cents: finalTotal,
    recommended_allocated_cents: recommendedTotal,
    override_count: overrides,
    budget_cents: cycle.budget_cents,
    remaining_cents: cycle.budget_cents - finalTotal,
    over_budget: finalTotal > cycle.budget_cents,
    headcount: allocations.length,
    avg_final_increase_pct:
      totalCurrentCents > 0 ? (finalTotal / totalCurrentCents) * 100 : 0,
  }

  const [updated] = await db
    .update(merit_cycles)
    .set({ status: 'locked', summary: postSummary })
    .where(eq(merit_cycles.id, id))
    .returning()
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// GET /:id/compare — compare allocation models for the cycle's inputs
// ---------------------------------------------------------------------------

router.get('/:id/compare', async (c) => {
  const id = c.req.param('id')
  const [cycle] = await db
    .select()
    .from(merit_cycles)
    .where(eq(merit_cycles.id, id))
  if (!cycle) return c.json({ error: 'Not found' }, 404)

  const inputs = await loadEmpInputs(
    cycle.workspace_id,
    cycle.dataset_id,
    cycle.band_set_id,
  )

  const modelNames: ModelName[] = ['compa_ratio', 'flat', 'performance', 'equity']
  const models = modelNames.map((m) => {
    const alloc = computeAllocations(inputs, m, cycle.budget_cents)
    return { model: m, ...summarize(inputs, alloc, cycle.budget_cents) }
  })
  return c.json({ models })
})

// ---------------------------------------------------------------------------
// DELETE /:id — delete cycle + allocations
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')

  const [cycle] = await db
    .select()
    .from(merit_cycles)
    .where(eq(merit_cycles.id, id))
  if (!cycle) return c.json({ error: 'Not found' }, 404)
  if (cycle.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)

  await db
    .delete(merit_allocations)
    .where(eq(merit_allocations.merit_cycle_id, id))
  await db.delete(merit_cycles).where(eq(merit_cycles.id, id))
  return c.json({ success: true })
})

export default router
