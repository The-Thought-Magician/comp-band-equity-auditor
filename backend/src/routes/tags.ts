import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { workspaces, tags } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'
import { requireWorkspace } from './workspaces.js'

const router = new Hono()

// Resolve the caller's workspace from the X-User-Id header WITHOUT creating one.
// Public reads are workspace-scoped: a row is only visible to a caller whose
// workspace owns it. Returns null when the caller has no workspace.
async function resolveWorkspaceId(c: any): Promise<string | null> {
  const userId = getUserId(c)
  if (!userId) return null
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.owner_id, userId))
  return ws?.id ?? null
}

const tagSchema = z.object({
  name: z.string().min(1).max(64),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'color must be a hex code like #6366f1')
    .optional()
    .default('#6366f1'),
})

// GET / — list tags (workspace-scoped)
router.get('/', async (c) => {
  const workspaceId = await resolveWorkspaceId(c)
  if (!workspaceId) return c.json([])
  const rows = await db
    .select()
    .from(tags)
    .where(eq(tags.workspace_id, workspaceId))
    .orderBy(desc(tags.created_at))
  return c.json(rows)
})

// POST / — create tag (unique per (workspace_id, name))
router.post('/', authMiddleware, zValidator('json', tagSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const body = c.req.valid('json')

  const [existing] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.workspace_id, ws.id), eq(tags.name, body.name)))
  if (existing) return c.json({ error: 'Tag already exists' }, 409)

  const [created] = await db
    .insert(tags)
    .values({ workspace_id: ws.id, name: body.name, color: body.color })
    .returning()
  return c.json(created, 201)
})

// DELETE /:id — delete tag
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db.select().from(tags).where(eq(tags.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(tags).where(eq(tags.id, id))
  return c.json({ success: true })
})

export default router
