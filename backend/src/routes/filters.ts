import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { workspaces, saved_filters } from '../db/schema.js'
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

const filterSchema = z.object({
  name: z.string().min(1),
  target_type: z.string().min(1),
  definition: z.record(z.unknown()).optional().default({}),
})

// GET / — list saved filters (optional filter by target_type)
router.get('/', async (c) => {
  const workspaceId = await resolveWorkspaceId(c)
  if (!workspaceId) return c.json([])
  const targetType = c.req.query('target_type')

  const conditions = [eq(saved_filters.workspace_id, workspaceId)]
  if (targetType) conditions.push(eq(saved_filters.target_type, targetType))
  const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions)

  const rows = await db
    .select()
    .from(saved_filters)
    .where(whereClause)
    .orderBy(desc(saved_filters.created_at))
  return c.json(rows)
})

// POST / — create saved filter
router.post('/', authMiddleware, zValidator('json', filterSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(saved_filters)
    .values({
      workspace_id: ws.id,
      name: body.name,
      target_type: body.target_type,
      definition: body.definition as Record<string, unknown>,
      created_by: userId,
    })
    .returning()
  return c.json(created, 201)
})

// DELETE /:id — delete saved filter
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(saved_filters)
    .where(eq(saved_filters.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(saved_filters).where(eq(saved_filters.id, id))
  return c.json({ success: true })
})

export default router
