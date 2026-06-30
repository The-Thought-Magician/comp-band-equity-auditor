import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { workspaces } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

/**
 * Resolve (and lazily provision) the workspace owned by a user. Each user gets
 * exactly one workspace, created on first authed call.
 */
export async function requireWorkspace(userId: string) {
  const [existing] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.owner_id, userId))
  if (existing) return existing
  const [created] = await db
    .insert(workspaces)
    .values({ name: 'My Workspace', owner_id: userId, base_currency: 'USD' })
    .returning()
  return created
}

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  base_currency: z.string().min(1).max(8).optional(),
})

// GET /me — current user's workspace (auto-create if absent)
router.get('/me', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  return c.json(ws)
})

// PUT /me — update name / base_currency
router.put('/me', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const body = c.req.valid('json')
  const patch: Record<string, unknown> = { updated_at: new Date() }
  if (body.name !== undefined) patch.name = body.name
  if (body.base_currency !== undefined) patch.base_currency = body.base_currency
  const [updated] = await db
    .update(workspaces)
    .set(patch)
    .where(eq(workspaces.id, ws.id))
    .returning()
  return c.json(updated)
})

export default router
