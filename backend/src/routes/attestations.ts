import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { workspaces, attestations, evidence_packs } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ---------------------------------------------------------------------------
// workspace helper — find-or-create the caller's single workspace
// ---------------------------------------------------------------------------

async function requireWorkspace(userId: string) {
  const existing = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.owner_id, userId))
    .limit(1)
  if (existing.length > 0) return existing[0]
  const [created] = await db
    .insert(workspaces)
    .values({ name: 'My Workspace', owner_id: userId })
    .returning()
  return created
}

// ---------------------------------------------------------------------------
// GET / — list attestations (public read, optional ?evidence_pack_id filter,
// workspace-scoped via header)
// ---------------------------------------------------------------------------

router.get('/', async (c) => {
  const userId = getUserId(c)
  if (!userId) return c.json([])
  const ws = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.owner_id, userId))
    .limit(1)
  if (ws.length === 0) return c.json([])

  const packId = c.req.query('evidence_pack_id')
  const where = packId
    ? and(
        eq(attestations.workspace_id, ws[0].id),
        eq(attestations.evidence_pack_id, packId),
      )
    : eq(attestations.workspace_id, ws[0].id)

  const rows = await db
    .select()
    .from(attestations)
    .where(where)
    .orderBy(desc(attestations.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// POST / — add a sign-off to a pack
// ---------------------------------------------------------------------------

const createSchema = z.object({
  evidence_pack_id: z.string().min(1),
  approver_name: z.string().min(1),
  approver_id: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
})

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const body = c.req.valid('json')

  const [pack] = await db
    .select()
    .from(evidence_packs)
    .where(eq(evidence_packs.id, body.evidence_pack_id))
  if (!pack) return c.json({ error: 'Evidence pack not found' }, 404)
  if (pack.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)

  const [row] = await db
    .insert(attestations)
    .values({
      evidence_pack_id: body.evidence_pack_id,
      workspace_id: ws.id,
      approver_name: body.approver_name,
      approver_id: body.approver_id ?? userId,
      note: body.note ?? null,
    })
    .returning()
  return c.json(row, 201)
})

// ---------------------------------------------------------------------------
// DELETE /:id — remove an attestation
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')

  const [existing] = await db
    .select()
    .from(attestations)
    .where(eq(attestations.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)

  await db.delete(attestations).where(eq(attestations.id, id))
  return c.json({ success: true })
})

export default router
