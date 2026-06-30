import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { randomBytes, createHash } from 'node:crypto'
import { db } from '../db/index.js'
import { api_keys, workspaces } from '../db/schema.js'
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

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

// Public-shape projection: never expose key_hash.
function publicKey(row: typeof api_keys.$inferSelect) {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    key_prefix: row.key_prefix,
    last_used_at: row.last_used_at,
    revoked: row.revoked,
    created_by: row.created_by,
    created_at: row.created_at,
  }
}

const createSchema = z.object({
  name: z.string().min(1),
})

// GET / — public(workspace-scoped via header) — list API keys (prefix only, never hash)
router.get('/', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])
  const ws = await requireWorkspace(userId)
  const rows = await db
    .select()
    .from(api_keys)
    .where(eq(api_keys.workspace_id, ws.id))
    .orderBy(desc(api_keys.created_at))
  return c.json(rows.map(publicKey))
})

// POST / — auth — issue a key; returns the plaintext exactly once
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const body = c.req.valid('json')
  const raw = randomBytes(24).toString('hex') // 48 hex chars of entropy
  const plaintext = `cbea_${raw}`
  const key_prefix = plaintext.slice(0, 12)
  const key_hash = sha256(plaintext)
  const [row] = await db
    .insert(api_keys)
    .values({
      workspace_id: ws.id,
      name: body.name,
      key_prefix,
      key_hash,
      created_by: userId,
    })
    .returning()
  return c.json({ key: plaintext, record: publicKey(row) }, 201)
})

// POST /:id/revoke — auth+owner — revoke a key
router.post('/:id/revoke', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db.select().from(api_keys).where(eq(api_keys.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
  const [updated] = await db
    .update(api_keys)
    .set({ revoked: true })
    .where(eq(api_keys.id, id))
    .returning()
  return c.json(publicKey(updated))
})

// DELETE /:id — auth+owner — delete a key
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const [existing] = await db.select().from(api_keys).where(eq(api_keys.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
  await db
    .delete(api_keys)
    .where(and(eq(api_keys.id, id), eq(api_keys.workspace_id, ws.id)))
  return c.json({ success: true })
})

export default router
