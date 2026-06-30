import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { workspaces, settings } from '../db/schema.js'
import { eq } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Auto-provision the caller's workspace (one per user) on first authed call.
async function requireWorkspace(userId: string) {
  const [existing] = await db.select().from(workspaces).where(eq(workspaces.owner_id, userId))
  if (existing) return existing
  const [created] = await db
    .insert(workspaces)
    .values({ name: 'My Workspace', owner_id: userId })
    .returning()
  return created
}

// Get-or-create the settings row for a workspace with sensible defaults.
async function requireSettings(workspaceId: string, baseCurrency: string) {
  const [existing] = await db.select().from(settings).where(eq(settings.workspace_id, workspaceId))
  if (existing) return existing
  const [created] = await db
    .insert(settings)
    .values({ workspace_id: workspaceId, base_currency: baseCurrency })
    .returning()
  return created
}

// GET / — workspace settings (auto-create defaults)
router.get('/', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const row = await requireSettings(ws.id, ws.base_currency)
  return c.json(row)
})

const updateSchema = z.object({
  base_currency: z.string().min(1).max(8).optional(),
  default_reference_group: z.string().min(1).max(64).optional(),
  gap_threshold_pct: z.number().min(0).max(100).optional(),
  pii_masking: z.boolean().optional(),
})

// PUT / — update settings
router.put('/', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  await requireSettings(ws.id, ws.base_currency)
  const body = c.req.valid('json')

  const [updated] = await db
    .update(settings)
    .set({ ...body, updated_at: new Date() })
    .where(eq(settings.workspace_id, ws.id))
    .returning()

  // Keep workspace base_currency in sync when changed via settings.
  if (body.base_currency && body.base_currency !== ws.base_currency) {
    await db
      .update(workspaces)
      .set({ base_currency: body.base_currency, updated_at: new Date() })
      .where(eq(workspaces.id, ws.id))
  }

  return c.json(updated)
})

export default router
