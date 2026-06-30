import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { webhooks, webhook_deliveries, workspaces } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Resolve (and auto-provision) the caller's workspace.
async function requireWorkspace(userId: string) {
  const [existing] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.owner_id, userId))
    .limit(1)
  if (existing) return existing
  const [created] = await db
    .insert(workspaces)
    .values({ name: 'My Workspace', owner_id: userId })
    .returning()
  return created
}

const createSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).optional().default([]),
  secret: z.string().optional(),
  enabled: z.boolean().optional().default(true),
})

const updateSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(z.string()).optional(),
  secret: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
})

// GET / — public(read, workspace-scoped via header) — list webhooks
router.get('/', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])
  const ws = await requireWorkspace(userId)
  const rows = await db
    .select()
    .from(webhooks)
    .where(eq(webhooks.workspace_id, ws.id))
    .orderBy(desc(webhooks.created_at))
  return c.json(rows)
})

// POST / — auth — register a webhook
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const body = c.req.valid('json')
  const [row] = await db
    .insert(webhooks)
    .values({
      workspace_id: ws.id,
      url: body.url,
      events: body.events,
      secret: body.secret ?? null,
      enabled: body.enabled,
      created_by: userId,
    })
    .returning()
  return c.json(row, 201)
})

// PUT /:id — auth+owner — update url/events/enabled/secret
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db.select().from(webhooks).where(eq(webhooks.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.url !== undefined) patch.url = body.url
  if (body.events !== undefined) patch.events = body.events
  if (body.secret !== undefined) patch.secret = body.secret
  if (body.enabled !== undefined) patch.enabled = body.enabled
  const [updated] = await db
    .update(webhooks)
    .set(patch)
    .where(eq(webhooks.id, id))
    .returning()
  return c.json(updated)
})

// DELETE /:id — auth+owner — delete webhook + its deliveries
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db.select().from(webhooks).where(eq(webhooks.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(webhook_deliveries).where(eq(webhook_deliveries.webhook_id, id))
  await db.delete(webhooks).where(eq(webhooks.id, id))
  return c.json({ success: true })
})

// GET /:id/deliveries — public — delivery log for a webhook (workspace-scoped)
router.get('/:id/deliveries', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const [hook] = await db.select().from(webhooks).where(eq(webhooks.id, id))
  if (!hook) return c.json({ error: 'Not found' }, 404)
  if (hook.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
  const rows = await db
    .select()
    .from(webhook_deliveries)
    .where(
      and(
        eq(webhook_deliveries.webhook_id, id),
        eq(webhook_deliveries.workspace_id, ws.id),
      ),
    )
    .orderBy(desc(webhook_deliveries.created_at))
  return c.json(rows)
})

export default router
