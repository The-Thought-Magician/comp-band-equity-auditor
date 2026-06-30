import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { offers, band_sets, bands, employees } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'
import { requireWorkspace } from './workspaces.js'

const router = new Hono()

const DEMO_WORKSPACE_ID = 'demo-workspace'

async function resolveWorkspaceId(c: any): Promise<string> {
  const userId = getUserId(c)
  if (!userId) return DEMO_WORKSPACE_ID
  const ws = await requireWorkspace(userId)
  return ws.id
}

interface BandRow {
  level: string
  role_family: string
  geo: string
  currency: string
  min_salary: number
  mid_salary: number
  max_salary: number
  target_compa_low: number
  target_compa_high: number
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

// ---------------------------------------------------------------------------
// Offer evaluation against a live band set
// ---------------------------------------------------------------------------

interface EvalInput {
  band_set_id: string
  level: string
  role_family: string
  geo: string
  proposed_salary: number
  currency?: string
}

interface EvalResult {
  compa_ratio: number | null
  range_penetration: number | null
  flags: string[]
  suggested_range: { min: number; mid: number; max: number } | null
  band_found: boolean
}

async function evaluateOffer(workspaceId: string, input: EvalInput): Promise<EvalResult> {
  const bandRows = (await db
    .select()
    .from(bands)
    .where(
      and(
        eq(bands.band_set_id, input.band_set_id),
        eq(bands.level, input.level),
        eq(bands.role_family, input.role_family),
        eq(bands.geo, input.geo),
      ),
    )) as unknown as BandRow[]

  const band = bandRows[0]
  const flags: string[] = []

  if (!band) {
    flags.push('no_band_match')
    return {
      compa_ratio: null,
      range_penetration: null,
      flags,
      suggested_range: null,
      band_found: false,
    }
  }

  const compaRatio = band.mid_salary > 0 ? input.proposed_salary / band.mid_salary : null
  const rangePenetration =
    band.max_salary > band.min_salary
      ? (input.proposed_salary - band.min_salary) / (band.max_salary - band.min_salary)
      : null

  if (input.proposed_salary < band.min_salary) flags.push('below_band_min')
  if (input.proposed_salary > band.max_salary) flags.push('above_band_max')
  if (compaRatio !== null && compaRatio < band.target_compa_low) flags.push('below_target_compa')
  if (compaRatio !== null && compaRatio > band.target_compa_high) flags.push('above_target_compa')

  // Compression check: compare the offer against existing employees in the same
  // band cell within the workspace. If the offer would land at or above the
  // current incumbents' pay, flag potential compression / inversion.
  const incumbents = (await db
    .select()
    .from(employees)
    .where(
      and(
        eq(employees.workspace_id, workspaceId),
        eq(employees.level, input.level),
        eq(employees.role_family, input.role_family),
        eq(employees.geo, input.geo),
      ),
    )) as unknown as Array<{ base_salary: number }>

  if (incumbents.length > 0) {
    const incMean = mean(incumbents.map((e) => e.base_salary))
    const incMax = Math.max(...incumbents.map((e) => e.base_salary))
    if (input.proposed_salary > incMax) {
      flags.push('inversion_vs_incumbents')
    } else if (input.proposed_salary >= incMean) {
      flags.push('compression_vs_incumbents')
    }
  }

  return {
    compa_ratio: compaRatio !== null ? Number(compaRatio.toFixed(4)) : null,
    range_penetration: rangePenetration !== null ? Number(rangePenetration.toFixed(4)) : null,
    flags,
    suggested_range: {
      min: band.min_salary,
      mid: band.mid_salary,
      max: band.max_salary,
    },
    band_found: true,
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET / — list offers
router.get('/', async (c) => {
  const workspaceId = await resolveWorkspaceId(c)
  const rows = await db
    .select()
    .from(offers)
    .where(eq(offers.workspace_id, workspaceId))
    .orderBy(desc(offers.created_at))
  return c.json(rows)
})

const evalSchema = z.object({
  band_set_id: z.string().min(1),
  level: z.string().min(1),
  role_family: z.string().min(1),
  geo: z.string().min(1),
  proposed_salary: z.number().positive(),
  currency: z.string().min(1).max(8).optional(),
})

// POST /evaluate — evaluate prospective offer without saving
router.post('/evaluate', authMiddleware, zValidator('json', evalSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const body = c.req.valid('json')

  const [bs] = await db
    .select()
    .from(band_sets)
    .where(and(eq(band_sets.id, body.band_set_id), eq(band_sets.workspace_id, ws.id)))
  if (!bs) return c.json({ error: 'Band set not found' }, 404)

  const result = await evaluateOffer(ws.id, body)
  return c.json({
    compa_ratio: result.compa_ratio,
    range_penetration: result.range_penetration,
    flags: result.flags,
    suggested_range: result.suggested_range,
  })
})

const saveSchema = evalSchema.extend({
  candidate_label: z.string().min(1),
})

// POST / — save an evaluated offer (re-evaluates server-side for trustworthy fields)
router.post('/', authMiddleware, zValidator('json', saveSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const body = c.req.valid('json')

  const [bs] = await db
    .select()
    .from(band_sets)
    .where(and(eq(band_sets.id, body.band_set_id), eq(band_sets.workspace_id, ws.id)))
  if (!bs) return c.json({ error: 'Band set not found' }, 404)

  const result = await evaluateOffer(ws.id, body)

  const [offer] = await db
    .insert(offers)
    .values({
      workspace_id: ws.id,
      band_set_id: body.band_set_id,
      candidate_label: body.candidate_label,
      level: body.level,
      role_family: body.role_family,
      geo: body.geo,
      proposed_salary: body.proposed_salary,
      currency: body.currency ?? 'USD',
      compa_ratio: result.compa_ratio,
      range_penetration: result.range_penetration,
      flags: result.flags,
      decision: 'pending',
      created_by: userId,
    })
    .returning()

  return c.json(offer, 201)
})

// GET /:id — offer detail
router.get('/:id', async (c) => {
  const workspaceId = await resolveWorkspaceId(c)
  const id = c.req.param('id')
  const [offer] = await db
    .select()
    .from(offers)
    .where(and(eq(offers.id, id), eq(offers.workspace_id, workspaceId)))
  if (!offer) return c.json({ error: 'Not found' }, 404)
  return c.json(offer)
})

const decisionSchema = z.object({
  decision: z.enum(['pending', 'approved', 'rejected', 'needs_review']),
  reviewer: z.string().min(1).optional(),
})

// PUT /:id/decision — set decision + reviewer
router.put('/:id/decision', authMiddleware, zValidator('json', decisionSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const [offer] = await db.select().from(offers).where(eq(offers.id, id))
  if (!offer) return c.json({ error: 'Not found' }, 404)
  if (offer.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(offers)
    .set({ decision: body.decision, reviewer: body.reviewer ?? offer.reviewer ?? userId })
    .where(eq(offers.id, id))
    .returning()
  return c.json(updated)
})

// DELETE /:id — delete offer
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')
  const [offer] = await db.select().from(offers).where(eq(offers.id, id))
  if (!offer) return c.json({ error: 'Not found' }, 404)
  if (offer.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(offers).where(eq(offers.id, id))
  return c.json({ success: true })
})

export default router
