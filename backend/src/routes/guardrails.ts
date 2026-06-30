import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { workspaces, guardrail_rules } from '../db/schema.js'
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

const ruleSchema = z.object({
  rule_type: z.string().min(1),
  threshold: z.number().optional(),
  action: z.enum(['warn', 'block', 'notify']).optional().default('warn'),
  enabled: z.boolean().optional().default(true),
})

const ruleUpdateSchema = z.object({
  rule_type: z.string().min(1).optional(),
  threshold: z.number().nullable().optional(),
  action: z.enum(['warn', 'block', 'notify']).optional(),
  enabled: z.boolean().optional(),
})

// GET / — list guardrail rules (workspace-scoped)
router.get('/', async (c) => {
  const workspaceId = await resolveWorkspaceId(c)
  if (!workspaceId) return c.json([])
  const rows = await db
    .select()
    .from(guardrail_rules)
    .where(eq(guardrail_rules.workspace_id, workspaceId))
    .orderBy(desc(guardrail_rules.created_at))
  return c.json(rows)
})

// POST / — create rule
router.post('/', authMiddleware, zValidator('json', ruleSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const body = c.req.valid('json')
  const [created] = await db
    .insert(guardrail_rules)
    .values({
      workspace_id: ws.id,
      rule_type: body.rule_type,
      threshold: body.threshold ?? null,
      action: body.action,
      enabled: body.enabled,
    })
    .returning()
  return c.json(created, 201)
})

// PUT /:id — update threshold / action / enabled / rule_type
router.put('/:id', authMiddleware, zValidator('json', ruleUpdateSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(guardrail_rules)
    .where(eq(guardrail_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.rule_type !== undefined) patch.rule_type = body.rule_type
  if (body.threshold !== undefined) patch.threshold = body.threshold
  if (body.action !== undefined) patch.action = body.action
  if (body.enabled !== undefined) patch.enabled = body.enabled

  const [updated] = await db
    .update(guardrail_rules)
    .set(patch)
    .where(eq(guardrail_rules.id, id))
    .returning()
  return c.json(updated)
})

// DELETE /:id — delete rule
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(guardrail_rules)
    .where(eq(guardrail_rules.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(guardrail_rules).where(eq(guardrail_rules.id, id))
  return c.json({ success: true })
})

export default router
