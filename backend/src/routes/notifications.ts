import { Hono } from 'hono'
import { db } from '../db/index.js'
import { notifications, workspaces } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Resolve (and auto-provision) the caller's workspace. Each user owns exactly
// one workspace; all domain rows carry its workspace_id.
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

// GET / — auth — list the current user's notifications (newest first)
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const rows = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.workspace_id, ws.id), eq(notifications.user_id, userId)))
    .orderBy(desc(notifications.created_at))
  return c.json(rows)
})

// POST /:id/read — auth — mark a single notification read (ownership-checked)
router.post('/:id/read', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(notifications)
    .where(eq(notifications.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.workspace_id !== ws.id || existing.user_id !== userId) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const [updated] = await db
    .update(notifications)
    .set({ read: true })
    .where(eq(notifications.id, id))
    .returning()
  return c.json(updated)
})

// POST /read-all — auth — mark all of the user's notifications read
router.post('/read-all', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const updated = await db
    .update(notifications)
    .set({ read: true })
    .where(
      and(
        eq(notifications.workspace_id, ws.id),
        eq(notifications.user_id, userId),
        eq(notifications.read, false),
      ),
    )
    .returning()
  return c.json({ updated: updated.length })
})

export default router
