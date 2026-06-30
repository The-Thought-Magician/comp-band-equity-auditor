import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import { fx_rates, workspaces } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'
import { requireWorkspace } from './workspaces.js'

const router = new Hono()

async function resolveWorkspaceId(c: any): Promise<string | null> {
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id')
  if (!userId) return null
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.owner_id, userId))
  return ws ? ws.id : null
}

const upsertSchema = z.object({
  from_currency: z.string().min(1).max(8),
  to_currency: z.string().min(1).max(8),
  rate: z.number().positive(),
})

// GET / — list FX rates (workspace-scoped)
router.get('/', async (c) => {
  const wsId = await resolveWorkspaceId(c)
  if (!wsId) return c.json([])
  const rows = await db
    .select()
    .from(fx_rates)
    .where(eq(fx_rates.workspace_id, wsId))
    .orderBy(fx_rates.from_currency, fx_rates.to_currency)
  return c.json(rows)
})

// POST / — upsert an FX rate (unique on workspace_id, from_currency, to_currency)
router.post('/', authMiddleware, zValidator('json', upsertSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const body = c.req.valid('json')
  const from = body.from_currency.toUpperCase()
  const to = body.to_currency.toUpperCase()

  const [row] = await db
    .insert(fx_rates)
    .values({ workspace_id: ws.id, from_currency: from, to_currency: to, rate: body.rate })
    .onConflictDoUpdate({
      target: [fx_rates.workspace_id, fx_rates.from_currency, fx_rates.to_currency],
      set: { rate: sql`excluded.rate` },
    })
    .returning()
  return c.json(row, 201)
})

// DELETE /:id — delete an FX rate
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db.select().from(fx_rates).where(eq(fx_rates.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(fx_rates).where(eq(fx_rates.id, id))
  return c.json({ success: true })
})

export default router
