import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { cohorts, employees, datasets } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'
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
  employee_ref: string
  name: string | null
  level: string
  role_family: string
  geo: string
  gender: string | null
  ethnicity: string | null
  base_salary: number
  [k: string]: unknown
}

/**
 * A cohort definition is a flat map of employee field -> value | value[].
 * Empty definition matches everyone. Array values match by membership.
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

const cohortSchema = z.object({
  name: z.string().min(1),
  definition: z.record(z.string(), z.unknown()).optional().default({}),
})

// ---------------------------------------------------------------------------
// GET / — list cohorts
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const wsId = await readWorkspaceId(c)
  const rows = await db
    .select()
    .from(cohorts)
    .where(eq(cohorts.workspace_id, wsId))
    .orderBy(desc(cohorts.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /:id — cohort detail + membership preview against a dataset
// ---------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [cohort] = await db.select().from(cohorts).where(eq(cohorts.id, id))
  if (!cohort) return c.json({ error: 'Not found' }, 404)

  // Membership preview: against an explicit dataset_id, else the workspace's
  // most recent dataset.
  let datasetId = c.req.query('dataset_id') ?? null
  if (!datasetId) {
    const [latest] = await db
      .select()
      .from(datasets)
      .where(eq(datasets.workspace_id, cohort.workspace_id))
      .orderBy(desc(datasets.created_at))
      .limit(1)
    datasetId = latest?.id ?? null
  }

  let size = 0
  let sample: Array<Record<string, unknown>> = []
  if (datasetId) {
    const emps = (await db
      .select()
      .from(employees)
      .where(eq(employees.dataset_id, datasetId))) as unknown as EmployeeRow[]
    const def = (cohort.definition ?? {}) as Record<string, unknown>
    const members = emps.filter((e) => matchesCohort(e, def))
    size = members.length
    sample = members.slice(0, 10).map((e) => ({
      id: e.id,
      employee_ref: e.employee_ref,
      name: e.name,
      level: e.level,
      role_family: e.role_family,
      geo: e.geo,
      gender: e.gender,
      base_salary: e.base_salary,
    }))
  }

  return c.json({ ...cohort, dataset_id: datasetId, size, sample })
})

// ---------------------------------------------------------------------------
// POST / — create cohort definition
// ---------------------------------------------------------------------------

router.post('/', authMiddleware, zValidator('json', cohortSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(cohorts)
    .values({
      workspace_id: ws.id,
      name: body.name,
      definition: body.definition as Record<string, unknown>,
      created_by: userId,
    })
    .returning()
  return c.json(created, 201)
})

// ---------------------------------------------------------------------------
// PUT /:id — update definition
// ---------------------------------------------------------------------------

router.put('/:id', authMiddleware, zValidator('json', cohortSchema.partial()), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db.select().from(cohorts).where(eq(cohorts.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.definition !== undefined) patch.definition = body.definition

  const [updated] = await db
    .update(cohorts)
    .set(patch)
    .where(eq(cohorts.id, id))
    .returning()
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id — delete cohort
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db.select().from(cohorts).where(eq(cohorts.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(cohorts).where(eq(cohorts.id, id))
  return c.json({ success: true })
})

export default router
