import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { band_sets, bands, workspaces } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'
import { requireWorkspace } from './workspaces.js'

const router = new Hono()

/**
 * Resolve the workspace id for a (possibly unauthenticated) read request. The
 * Next.js proxy injects X-User-Id for any authed session, so public reads are
 * still scoped to the caller's workspace when a header is present. Returns null
 * for fully anonymous callers (no rows leak across workspaces).
 */
async function resolveWorkspaceId(c: any): Promise<string | null> {
  const userId = c.req.header('X-User-Id') ?? c.req.header('x-user-id')
  if (!userId) return null
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.owner_id, userId))
  return ws ? ws.id : null
}

const createSchema = z.object({
  version: z.number().int().positive().optional(),
  label: z.string().min(1),
  effective_from: z.string().optional(),
  notes: z.string().optional(),
})

const cloneSchema = z.object({
  label: z.string().min(1).optional(),
  notes: z.string().optional(),
})

// GET / — list band-set versions (workspace-scoped)
router.get('/', async (c) => {
  const wsId = await resolveWorkspaceId(c)
  if (!wsId) return c.json([])
  const rows = await db
    .select()
    .from(band_sets)
    .where(eq(band_sets.workspace_id, wsId))
    .orderBy(desc(band_sets.version))
  return c.json(rows)
})

// GET /:id — band-set detail with its bands
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [bs] = await db.select().from(band_sets).where(eq(band_sets.id, id))
  if (!bs) return c.json({ error: 'Not found' }, 404)
  const rows = await db
    .select()
    .from(bands)
    .where(eq(bands.band_set_id, id))
    .orderBy(bands.level, bands.role_family, bands.geo)
  return c.json({ ...bs, bands: rows })
})

// POST / — create a band-set version
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const body = c.req.valid('json')

  let version = body.version
  if (version === undefined) {
    const existing = await db
      .select()
      .from(band_sets)
      .where(eq(band_sets.workspace_id, ws.id))
      .orderBy(desc(band_sets.version))
    version = existing.length > 0 ? (existing[0].version ?? 0) + 1 : 1
  }

  const [created] = await db
    .insert(band_sets)
    .values({
      workspace_id: ws.id,
      version,
      label: body.label,
      effective_from: body.effective_from ?? null,
      status: 'draft',
      notes: body.notes ?? null,
      created_by: userId,
    })
    .returning()
  return c.json(created, 201)
})

// POST /:id/publish — mark status published (immutable)
router.post('/:id/publish', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const [bs] = await db.select().from(band_sets).where(eq(band_sets.id, id))
  if (!bs) return c.json({ error: 'Not found' }, 404)
  if (bs.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
  const [updated] = await db
    .update(band_sets)
    .set({ status: 'published' })
    .where(eq(band_sets.id, id))
    .returning()
  return c.json(updated)
})

// POST /:id/clone — clone band-set + its bands into a new version
router.post('/:id/clone', authMiddleware, zValidator('json', cloneSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const body = c.req.valid('json')
  const [src] = await db.select().from(band_sets).where(eq(band_sets.id, id))
  if (!src) return c.json({ error: 'Not found' }, 404)
  if (src.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)

  const existing = await db
    .select()
    .from(band_sets)
    .where(eq(band_sets.workspace_id, ws.id))
    .orderBy(desc(band_sets.version))
  const nextVersion = existing.length > 0 ? (existing[0].version ?? 0) + 1 : 1

  const [clone] = await db
    .insert(band_sets)
    .values({
      workspace_id: ws.id,
      version: nextVersion,
      label: body.label ?? `${src.label} (copy)`,
      effective_from: src.effective_from,
      status: 'draft',
      notes: body.notes ?? src.notes,
      created_by: userId,
    })
    .returning()

  const srcBands = await db.select().from(bands).where(eq(bands.band_set_id, id))
  if (srcBands.length > 0) {
    await db.insert(bands).values(
      srcBands.map((b) => ({
        band_set_id: clone.id,
        workspace_id: ws.id,
        level: b.level,
        role_family: b.role_family,
        geo: b.geo,
        currency: b.currency,
        min_salary: b.min_salary,
        mid_salary: b.mid_salary,
        max_salary: b.max_salary,
        target_compa_low: b.target_compa_low,
        target_compa_high: b.target_compa_high,
        notes: b.notes,
      })),
    )
  }
  return c.json(clone, 201)
})

// GET /:id/diff/:otherId — diff two band-set versions
router.get('/:id/diff/:otherId', async (c) => {
  const id = c.req.param('id')
  const otherId = c.req.param('otherId')
  const [a] = await db.select().from(band_sets).where(eq(band_sets.id, id))
  const [b] = await db.select().from(band_sets).where(eq(band_sets.id, otherId))
  if (!a || !b) return c.json({ error: 'Not found' }, 404)

  const aBands = await db.select().from(bands).where(eq(bands.band_set_id, id))
  const bBands = await db.select().from(bands).where(eq(bands.band_set_id, otherId))

  const keyOf = (x: typeof aBands[number]) => `${x.level}|${x.role_family}|${x.geo}`
  const aMap = new Map(aBands.map((x) => [keyOf(x), x]))
  const bMap = new Map(bBands.map((x) => [keyOf(x), x]))

  const added: unknown[] = []
  const removed: unknown[] = []
  const changed: unknown[] = []

  for (const [k, bv] of bMap) {
    if (!aMap.has(k)) added.push(bv)
  }
  for (const [k, av] of aMap) {
    if (!bMap.has(k)) {
      removed.push(av)
    } else {
      const bv = bMap.get(k)!
      const fields: Record<string, { from: number; to: number }> = {}
      for (const f of ['min_salary', 'mid_salary', 'max_salary', 'target_compa_low', 'target_compa_high'] as const) {
        if (av[f] !== bv[f]) fields[f] = { from: av[f] as number, to: bv[f] as number }
      }
      if (Object.keys(fields).length > 0) {
        changed.push({ key: k, level: av.level, role_family: av.role_family, geo: av.geo, fields })
      }
    }
  }

  return c.json({ added, removed, changed })
})

// GET /:id/lint — overlap/inversion lint findings
router.get('/:id/lint', async (c) => {
  const id = c.req.param('id')
  const [bs] = await db.select().from(band_sets).where(eq(band_sets.id, id))
  if (!bs) return c.json({ error: 'Not found' }, 404)
  const rows = await db.select().from(bands).where(eq(bands.band_set_id, id))

  const findings: Array<{ severity: string; band_id: string; type: string; message: string }> = []

  // Per-band internal inversions: min <= mid <= max, low <= high.
  for (const b of rows) {
    if (b.min_salary > b.mid_salary) {
      findings.push({ severity: 'error', band_id: b.id, type: 'inversion', message: `min (${b.min_salary}) exceeds mid (${b.mid_salary}) for ${b.level}/${b.role_family}/${b.geo}` })
    }
    if (b.mid_salary > b.max_salary) {
      findings.push({ severity: 'error', band_id: b.id, type: 'inversion', message: `mid (${b.mid_salary}) exceeds max (${b.max_salary}) for ${b.level}/${b.role_family}/${b.geo}` })
    }
    if (b.min_salary > b.max_salary) {
      findings.push({ severity: 'error', band_id: b.id, type: 'inversion', message: `min (${b.min_salary}) exceeds max (${b.max_salary}) for ${b.level}/${b.role_family}/${b.geo}` })
    }
    if (b.target_compa_low > b.target_compa_high) {
      findings.push({ severity: 'error', band_id: b.id, type: 'inversion', message: `target_compa_low (${b.target_compa_low}) exceeds target_compa_high (${b.target_compa_high})` })
    }
  }

  // Cross-level overlaps within the same role_family + geo: a higher level whose
  // min sits below a lower level's max is flagged as an overlap.
  const groups = new Map<string, typeof rows>()
  for (const b of rows) {
    const k = `${b.role_family}|${b.geo}`
    const g = groups.get(k)
    if (g) g.push(b)
    else groups.set(k, [b])
  }
  const levelRank = (lvl: string) => {
    const m = /(\d+)/.exec(lvl)
    return m ? parseInt(m[1], 10) : 0
  }
  for (const g of groups.values()) {
    const sorted = [...g].sort((x, y) => levelRank(x.level) - levelRank(y.level))
    for (let i = 0; i + 1 < sorted.length; i++) {
      const lower = sorted[i]
      const higher = sorted[i + 1]
      if (levelRank(higher.level) === levelRank(lower.level)) continue
      if (higher.min_salary < lower.max_salary) {
        findings.push({
          severity: 'warn',
          band_id: higher.id,
          type: 'overlap',
          message: `Band ${higher.level} min (${higher.min_salary}) overlaps ${lower.level} max (${lower.max_salary}) in ${lower.role_family}/${lower.geo}`,
        })
      }
      if (higher.mid_salary <= lower.mid_salary) {
        findings.push({
          severity: 'warn',
          band_id: higher.id,
          type: 'compression',
          message: `Band ${higher.level} mid (${higher.mid_salary}) is not above ${lower.level} mid (${lower.mid_salary}) in ${lower.role_family}/${lower.geo}`,
        })
      }
    }
  }

  return c.json({ findings })
})

// DELETE /:id — delete band-set + its bands
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const [bs] = await db.select().from(band_sets).where(eq(band_sets.id, id))
  if (!bs) return c.json({ error: 'Not found' }, 404)
  if (bs.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(bands).where(eq(bands.band_set_id, id))
  await db.delete(band_sets).where(eq(band_sets.id, id))
  return c.json({ success: true })
})

export default router
