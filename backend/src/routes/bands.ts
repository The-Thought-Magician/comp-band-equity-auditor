import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { bands, band_sets, workspaces } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'
import { requireWorkspace } from './workspaces.js'

const router = new Hono()

async function resolveWorkspaceId(c: any): Promise<string | null> {
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id')
  if (!userId) return null
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.owner_id, userId))
  return ws ? ws.id : null
}

const bandFields = {
  level: z.string().min(1),
  role_family: z.string().min(1),
  geo: z.string().min(1),
  currency: z.string().min(1).max(8).optional(),
  min_salary: z.number(),
  mid_salary: z.number(),
  max_salary: z.number(),
  target_compa_low: z.number().optional(),
  target_compa_high: z.number().optional(),
  notes: z.string().optional(),
}

const createSchema = z.object({ band_set_id: z.string().min(1), ...bandFields })

const updateSchema = z.object({
  min_salary: z.number().optional(),
  mid_salary: z.number().optional(),
  max_salary: z.number().optional(),
  target_compa_low: z.number().optional(),
  target_compa_high: z.number().optional(),
  notes: z.string().optional(),
})

const bulkSchema = z.object({
  band_set_id: z.string().min(1),
  bands: z.array(z.object(bandFields)).min(1),
})

// GET / — list bands (filter band_set_id)
router.get('/', async (c) => {
  const wsId = await resolveWorkspaceId(c)
  if (!wsId) return c.json([])
  const bandSetId = c.req.query('band_set_id')
  const where = bandSetId
    ? and(eq(bands.workspace_id, wsId), eq(bands.band_set_id, bandSetId))
    : eq(bands.workspace_id, wsId)
  const rows = await db
    .select()
    .from(bands)
    .where(where)
    .orderBy(bands.level, bands.role_family, bands.geo)
  return c.json(rows)
})

// POST / — create a band in a band-set
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const body = c.req.valid('json')

  const [bs] = await db.select().from(band_sets).where(eq(band_sets.id, body.band_set_id))
  if (!bs) return c.json({ error: 'Band set not found' }, 404)
  if (bs.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
  if (bs.status === 'published') return c.json({ error: 'Band set is published (immutable)' }, 409)

  const [created] = await db
    .insert(bands)
    .values({
      band_set_id: body.band_set_id,
      workspace_id: ws.id,
      level: body.level,
      role_family: body.role_family,
      geo: body.geo,
      currency: body.currency ?? 'USD',
      min_salary: body.min_salary,
      mid_salary: body.mid_salary,
      max_salary: body.max_salary,
      target_compa_low: body.target_compa_low ?? 0.9,
      target_compa_high: body.target_compa_high ?? 1.1,
      notes: body.notes ?? null,
    })
    .returning()
  return c.json(created, 201)
})

// PUT /:id — edit min/mid/max/target
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db.select().from(bands).where(eq(bands.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
  const [bs] = await db.select().from(band_sets).where(eq(band_sets.id, existing.band_set_id))
  if (bs && bs.status === 'published') return c.json({ error: 'Band set is published (immutable)' }, 409)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  for (const f of ['min_salary', 'mid_salary', 'max_salary', 'target_compa_low', 'target_compa_high', 'notes'] as const) {
    if (body[f] !== undefined) patch[f] = body[f]
  }
  if (Object.keys(patch).length === 0) return c.json(existing)
  const [updated] = await db.update(bands).set(patch).where(eq(bands.id, id)).returning()
  return c.json(updated)
})

// DELETE /:id — delete band
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db.select().from(bands).where(eq(bands.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(bands).where(eq(bands.id, id))
  return c.json({ success: true })
})

// POST /bulk — bulk-import band rows into a band-set
router.post('/bulk', authMiddleware, zValidator('json', bulkSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const body = c.req.valid('json')

  const [bs] = await db.select().from(band_sets).where(eq(band_sets.id, body.band_set_id))
  if (!bs) return c.json({ error: 'Band set not found' }, 404)
  if (bs.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
  if (bs.status === 'published') return c.json({ error: 'Band set is published (immutable)' }, 409)

  const values = body.bands.map((b) => ({
    band_set_id: body.band_set_id,
    workspace_id: ws.id,
    level: b.level,
    role_family: b.role_family,
    geo: b.geo,
    currency: b.currency ?? 'USD',
    min_salary: b.min_salary,
    mid_salary: b.mid_salary,
    max_salary: b.max_salary,
    target_compa_low: b.target_compa_low ?? 0.9,
    target_compa_high: b.target_compa_high ?? 1.1,
    notes: b.notes ?? null,
  }))

  const inserted = await db
    .insert(bands)
    .values(values)
    .onConflictDoUpdate({
      target: [bands.band_set_id, bands.level, bands.role_family, bands.geo],
      set: {
        currency: sql`excluded.currency`,
        min_salary: sql`excluded.min_salary`,
        mid_salary: sql`excluded.mid_salary`,
        max_salary: sql`excluded.max_salary`,
        target_compa_low: sql`excluded.target_compa_low`,
        target_compa_high: sql`excluded.target_compa_high`,
        notes: sql`excluded.notes`,
      },
    })
    .returning()
  return c.json({ created: inserted.length, bands: inserted })
})

export default router
