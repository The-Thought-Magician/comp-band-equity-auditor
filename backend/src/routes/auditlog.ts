import { Hono } from 'hono'
import { db } from '../db/index.js'
import { workspaces, audit_log } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { getUserId } from '../lib/auth.js'

const router = new Hono()

// Resolve the caller's workspace from the X-User-Id header without creating
// one. Public reads are workspace-scoped: a row is only visible to a caller
// whose workspace owns it. Returns null when the caller has no workspace.
async function resolveWorkspaceId(c: any): Promise<string | null> {
  const userId = getUserId(c)
  if (!userId) return null
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.owner_id, userId))
  return ws?.id ?? null
}

// GET / — paginated workspace audit log (filter action / target_type)
router.get('/', async (c) => {
  const workspaceId = await resolveWorkspaceId(c)
  if (!workspaceId) return c.json({ entries: [], total: 0, limit: 50, offset: 0 })

  const action = c.req.query('action')
  const targetType = c.req.query('target_type')
  const rawLimit = parseInt(c.req.query('limit') ?? '50', 10)
  const rawOffset = parseInt(c.req.query('offset') ?? '0', 10)
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 200)) : 50
  const offset = Number.isFinite(rawOffset) ? Math.max(0, rawOffset) : 0

  const conditions = [eq(audit_log.workspace_id, workspaceId)]
  if (action) conditions.push(eq(audit_log.action, action))
  if (targetType) conditions.push(eq(audit_log.target_type, targetType))
  const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions)

  const all = await db
    .select()
    .from(audit_log)
    .where(whereClause)
    .orderBy(desc(audit_log.created_at))

  const total = all.length
  const entries = all.slice(offset, offset + limit)

  return c.json({ entries, total, limit, offset })
})

export default router
