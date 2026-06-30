import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { datasets, employees } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'
import { requireWorkspace } from './workspaces.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// Employee row validation (shared by create + validate)
// ---------------------------------------------------------------------------

interface RawRow {
  [key: string]: unknown
}

interface RowError {
  index: number
  employee_ref?: string
  errors: string[]
}

function validateRow(row: RawRow, index: number): RowError | null {
  const errors: string[] = []
  const ref = row.employee_ref ?? row.ref ?? row.id
  if (ref === undefined || ref === null || String(ref).trim() === '') {
    errors.push('employee_ref is required')
  }
  if (!row.level || String(row.level).trim() === '') errors.push('level is required')
  if (!row.role_family || String(row.role_family).trim() === '')
    errors.push('role_family is required')
  if (!row.geo || String(row.geo).trim() === '') errors.push('geo is required')
  const salary = Number(row.base_salary)
  if (row.base_salary === undefined || row.base_salary === null || row.base_salary === '') {
    errors.push('base_salary is required')
  } else if (!Number.isFinite(salary) || salary < 0) {
    errors.push('base_salary must be a non-negative number')
  }
  if (row.fte !== undefined && row.fte !== null && row.fte !== '') {
    const fte = Number(row.fte)
    if (!Number.isFinite(fte) || fte <= 0 || fte > 1) errors.push('fte must be in (0, 1]')
  }
  if (
    row.performance_rating !== undefined &&
    row.performance_rating !== null &&
    row.performance_rating !== '' &&
    !Number.isFinite(Number(row.performance_rating))
  ) {
    errors.push('performance_rating must be numeric')
  }
  if (errors.length === 0) return null
  return { index, employee_ref: ref !== undefined ? String(ref) : undefined, errors }
}

function normalizeRow(row: RawRow, datasetId: string, workspaceId: string) {
  const ref = row.employee_ref ?? row.ref ?? row.id
  return {
    dataset_id: datasetId,
    workspace_id: workspaceId,
    employee_ref: String(ref),
    name: row.name != null ? String(row.name) : null,
    level: String(row.level),
    role_family: String(row.role_family),
    geo: String(row.geo),
    gender: row.gender != null && row.gender !== '' ? String(row.gender) : null,
    ethnicity: row.ethnicity != null && row.ethnicity !== '' ? String(row.ethnicity) : null,
    tenure_months:
      row.tenure_months != null && row.tenure_months !== ''
        ? Math.max(0, Math.round(Number(row.tenure_months)))
        : 0,
    hire_date: row.hire_date != null && row.hire_date !== '' ? String(row.hire_date) : null,
    performance_rating:
      row.performance_rating != null && row.performance_rating !== ''
        ? Number(row.performance_rating)
        : null,
    base_salary: Number(row.base_salary),
    currency: row.currency != null && row.currency !== '' ? String(row.currency) : 'USD',
    fte: row.fte != null && row.fte !== '' ? Number(row.fte) : 1,
    tags: Array.isArray(row.tags) ? (row.tags as string[]).map(String) : [],
  }
}

// ---------------------------------------------------------------------------
// schemas
// ---------------------------------------------------------------------------

const createSchema = z.object({
  label: z.string().min(1),
  source: z.string().optional().default('upload'),
  rows: z.array(z.record(z.string(), z.unknown())).default([]),
})

// ---------------------------------------------------------------------------
// GET / — list dataset versions (workspace-scoped via header)
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])
  const ws = await requireWorkspace(userId)
  const rows = await db
    .select()
    .from(datasets)
    .where(eq(datasets.workspace_id, ws.id))
    .orderBy(desc(datasets.version))
  return c.json(rows)
})

// GET /:id — dataset detail
router.get('/:id', async (c) => {
  const [ds] = await db.select().from(datasets).where(eq(datasets.id, c.req.param('id')))
  if (!ds) return c.json({ error: 'Not found' }, 404)
  return c.json(ds)
})

// POST / — create dataset version + insert employee rows
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const { label, source, rows } = c.req.valid('json')

  const rejected: RowError[] = []
  const valid: RawRow[] = []
  rows.forEach((row, i) => {
    const err = validateRow(row as RawRow, i)
    if (err) rejected.push(err)
    else valid.push(row as RawRow)
  })

  // version = max existing version for workspace + 1
  const [{ maxVersion }] = await db
    .select({ maxVersion: sql<number>`coalesce(max(${datasets.version}), 0)` })
    .from(datasets)
    .where(eq(datasets.workspace_id, ws.id))
  const version = Number(maxVersion) + 1

  const [ds] = await db
    .insert(datasets)
    .values({
      workspace_id: ws.id,
      version,
      label,
      source: source ?? 'upload',
      row_count: valid.length,
      rejected_rows: rejected as unknown as Array<Record<string, unknown>>,
      status: 'ready',
      created_by: userId,
    })
    .returning()

  if (valid.length > 0) {
    const toInsert = valid.map((row) => normalizeRow(row, ds.id, ws.id))
    // Insert in chunks to stay within parameter limits.
    const CHUNK = 200
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      await db.insert(employees).values(toInsert.slice(i, i + CHUNK))
    }
  }

  return c.json(ds, 201)
})

// POST /:id/validate — re-run validation against current employees
router.post('/:id/validate', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const [ds] = await db.select().from(datasets).where(eq(datasets.id, id))
  if (!ds) return c.json({ error: 'Not found' }, 404)
  if (ds.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)

  const emps = await db.select().from(employees).where(eq(employees.dataset_id, id))
  const errors: RowError[] = []
  emps.forEach((e, i) => {
    const err = validateRow(e as unknown as RawRow, i)
    if (err) {
      err.employee_ref = e.employee_ref
      errors.push(err)
    }
  })
  return c.json({ valid: errors.length === 0, errors })
})

// DELETE /:id — delete dataset + its employees
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const [ds] = await db.select().from(datasets).where(eq(datasets.id, id))
  if (!ds) return c.json({ error: 'Not found' }, 404)
  if (ds.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(employees).where(eq(employees.dataset_id, id))
  await db.delete(datasets).where(eq(datasets.id, id))
  return c.json({ success: true })
})

// GET /:id/diff/:otherId — diff two dataset versions by employee_ref
router.get('/:id/diff/:otherId', async (c) => {
  const id = c.req.param('id')
  const otherId = c.req.param('otherId')
  const [a] = await db.select().from(datasets).where(eq(datasets.id, id))
  const [b] = await db.select().from(datasets).where(eq(datasets.id, otherId))
  if (!a || !b) return c.json({ error: 'Not found' }, 404)

  const empA = await db.select().from(employees).where(eq(employees.dataset_id, id))
  const empB = await db.select().from(employees).where(eq(employees.dataset_id, otherId))
  const mapA = new Map(empA.map((e) => [e.employee_ref, e]))
  const mapB = new Map(empB.map((e) => [e.employee_ref, e]))

  const added: Array<Record<string, unknown>> = []
  const removed: Array<Record<string, unknown>> = []
  const changed: Array<Record<string, unknown>> = []

  const compareFields = [
    'level',
    'role_family',
    'geo',
    'gender',
    'ethnicity',
    'base_salary',
    'currency',
    'fte',
    'performance_rating',
    'tenure_months',
  ] as const

  for (const [ref, eb] of mapB) {
    const ea = mapA.get(ref)
    if (!ea) {
      added.push({ employee_ref: ref, name: eb.name, level: eb.level, base_salary: eb.base_salary })
      continue
    }
    const fieldChanges: Record<string, { from: unknown; to: unknown }> = {}
    for (const f of compareFields) {
      const va = (ea as Record<string, unknown>)[f]
      const vb = (eb as Record<string, unknown>)[f]
      if (va !== vb) fieldChanges[f] = { from: va, to: vb }
    }
    if (Object.keys(fieldChanges).length > 0) {
      changed.push({ employee_ref: ref, name: eb.name, changes: fieldChanges })
    }
  }
  for (const [ref, ea] of mapA) {
    if (!mapB.has(ref)) {
      removed.push({ employee_ref: ref, name: ea.name, level: ea.level, base_salary: ea.base_salary })
    }
  }

  return c.json({ added, removed, changed })
})

export default router
