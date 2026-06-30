import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc, inArray, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { employees } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'
import { requireWorkspace } from './workspaces.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// GET / — list employees with filters
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])
  const ws = await requireWorkspace(userId)

  const datasetId = c.req.query('dataset_id')
  const level = c.req.query('level')
  const geo = c.req.query('geo')
  const gender = c.req.query('gender')
  const tag = c.req.query('tag')

  const conds = [eq(employees.workspace_id, ws.id)]
  if (datasetId) conds.push(eq(employees.dataset_id, datasetId))
  if (level) conds.push(eq(employees.level, level))
  if (geo) conds.push(eq(employees.geo, geo))
  if (gender) conds.push(eq(employees.gender, gender))
  if (tag) conds.push(sql`${employees.tags} @> ${JSON.stringify([tag])}::jsonb`)

  const rows = await db
    .select()
    .from(employees)
    .where(and(...conds))
    .orderBy(desc(employees.created_at))
  return c.json(rows)
})

// GET /:id — employee detail
router.get('/:id', async (c) => {
  const [e] = await db.select().from(employees).where(eq(employees.id, c.req.param('id')))
  if (!e) return c.json({ error: 'Not found' }, 404)
  return c.json(e)
})

// ---------------------------------------------------------------------------
// PUT /:id — edit a normalized field
// ---------------------------------------------------------------------------

const editSchema = z
  .object({
    level: z.string().min(1).optional(),
    geo: z.string().min(1).optional(),
    role_family: z.string().min(1).optional(),
    base_salary: z.number().nonnegative().optional(),
    currency: z.string().min(1).max(8).optional(),
    name: z.string().optional(),
    gender: z.string().optional(),
    ethnicity: z.string().optional(),
    performance_rating: z.number().optional(),
    tenure_months: z.number().int().nonnegative().optional(),
    fte: z.number().positive().max(1).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'At least one field is required' })

router.put('/:id', authMiddleware, zValidator('json', editSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db.select().from(employees).where(eq(employees.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(employees)
    .set(body)
    .where(eq(employees.id, id))
    .returning()
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// POST /bulk-tag — add/remove tags on a set of employee ids
// ---------------------------------------------------------------------------

const bulkTagSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
  add: z.array(z.string().min(1)).optional().default([]),
  remove: z.array(z.string().min(1)).optional().default([]),
})

router.post('/bulk-tag', authMiddleware, zValidator('json', bulkTagSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const { ids, add, remove } = c.req.valid('json')

  const rows = await db
    .select()
    .from(employees)
    .where(and(eq(employees.workspace_id, ws.id), inArray(employees.id, ids)))

  let updated = 0
  for (const e of rows) {
    const current = new Set<string>(Array.isArray(e.tags) ? e.tags : [])
    for (const t of add) current.add(t)
    for (const t of remove) current.delete(t)
    await db
      .update(employees)
      .set({ tags: [...current] })
      .where(eq(employees.id, e.id))
    updated++
  }
  return c.json({ updated })
})

// ---------------------------------------------------------------------------
// POST /bulk-remap — bulk set level / geo on employee ids
// ---------------------------------------------------------------------------

const bulkRemapSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1),
    level: z.string().min(1).optional(),
    geo: z.string().min(1).optional(),
    role_family: z.string().min(1).optional(),
  })
  .refine((o) => o.level !== undefined || o.geo !== undefined || o.role_family !== undefined, {
    message: 'Provide at least one of level, geo, role_family',
  })

router.post('/bulk-remap', authMiddleware, zValidator('json', bulkRemapSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const { ids, level, geo, role_family } = c.req.valid('json')

  const patch: Record<string, unknown> = {}
  if (level !== undefined) patch.level = level
  if (geo !== undefined) patch.geo = geo
  if (role_family !== undefined) patch.role_family = role_family

  const res = await db
    .update(employees)
    .set(patch)
    .where(and(eq(employees.workspace_id, ws.id), inArray(employees.id, ids)))
    .returning({ id: employees.id })
  return c.json({ updated: res.length })
})

export default router
