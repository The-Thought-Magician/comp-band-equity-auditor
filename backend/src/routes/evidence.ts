import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  workspaces,
  evidence_packs,
  attestations,
  gap_runs,
  gap_results,
  scenarios,
  scenario_adjustments,
  band_sets,
  bands,
} from '../db/schema.js'
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

function randomToken(): string {
  // URL-safe opaque share token.
  const a = crypto.randomUUID().replace(/-/g, '')
  const b = crypto.randomUUID().replace(/-/g, '')
  return `${a}${b}`.slice(0, 40)
}

// ---------------------------------------------------------------------------
// methodology + contents builders — assemble a defensible, auto-written pack
// from whichever sources were referenced.
// ---------------------------------------------------------------------------

async function buildContents(
  workspaceId: string,
  gapRunId: string | null,
  scenarioId: string | null,
  bandSetId: string | null,
): Promise<{ methodology: string; contents: Record<string, unknown> }> {
  const contents: Record<string, unknown> = {}
  const methodologyParts: string[] = []

  if (gapRunId) {
    const [run] = await db
      .select()
      .from(gap_runs)
      .where(eq(gap_runs.id, gapRunId))
    if (run) {
      const results = await db
        .select()
        .from(gap_results)
        .where(eq(gap_results.gap_run_id, gapRunId))
      contents.gap_run = {
        id: run.id,
        reference_group: run.reference_group,
        summary: run.summary,
        results: results.map((r) => ({
          cohort_key: r.cohort_key,
          dimension: r.dimension,
          raw_gap_pct: r.raw_gap_pct,
          adjusted_gap_pct: r.adjusted_gap_pct,
          explained_pct: r.explained_pct,
          unexplained_pct: r.unexplained_pct,
          group_size: r.group_size,
          mean_pay: r.mean_pay,
          decomposition: r.decomposition,
        })),
      }
      methodologyParts.push(
        `Pay-gap analysis used a reference group of "${
          run.reference_group ?? 'unset'
        }". Raw gaps are the mean-pay difference of each cohort versus the reference group, expressed as a percentage of reference-group mean pay. Adjusted gaps control for level, role family, geography and tenure via a like-for-like decomposition; the residual after controls is reported as the unexplained gap.`,
      )
    }
  }

  if (scenarioId) {
    const [sc] = await db
      .select()
      .from(scenarios)
      .where(eq(scenarios.id, scenarioId))
    if (sc) {
      const adjustments = await db
        .select()
        .from(scenario_adjustments)
        .where(eq(scenario_adjustments.scenario_id, scenarioId))
      contents.scenario = {
        id: sc.id,
        name: sc.name,
        target_type: sc.target_type,
        constraints: sc.constraints,
        total_budget_cents: sc.total_budget_cents,
        headcount_affected: sc.headcount_affected,
        residual_gap_pct: sc.residual_gap_pct,
        adjustment_count: adjustments.length,
      }
      methodologyParts.push(
        `Remediation scenario "${sc.name}" targets "${sc.target_type}". Per-person adjustments were computed to move affected employees toward the target while respecting the stated constraints. Total remediation budget is ${(
          sc.total_budget_cents / 100
        ).toFixed(2)} and the projected residual unexplained gap after remediation is ${
          sc.residual_gap_pct ?? 'n/a'
        }%.`,
      )
    }
  }

  if (bandSetId) {
    const [bs] = await db
      .select()
      .from(band_sets)
      .where(eq(band_sets.id, bandSetId))
    if (bs) {
      const bandRows = await db
        .select()
        .from(bands)
        .where(eq(bands.band_set_id, bandSetId))
      contents.band_set = {
        id: bs.id,
        label: bs.label,
        version: bs.version,
        status: bs.status,
        effective_from: bs.effective_from,
        band_count: bandRows.length,
        bands: bandRows.map((b) => ({
          level: b.level,
          role_family: b.role_family,
          geo: b.geo,
          currency: b.currency,
          min_salary: b.min_salary,
          mid_salary: b.mid_salary,
          max_salary: b.max_salary,
        })),
      }
      methodologyParts.push(
        `Compensation positioning was measured against band set "${bs.label}" (version ${bs.version}). Compa-ratio is base salary divided by band midpoint; range penetration is (salary − min) / (max − min).`,
      )
    }
  }

  contents.generated_at = new Date().toISOString()
  const methodology =
    methodologyParts.length > 0
      ? methodologyParts.join('\n\n')
      : 'Evidence pack assembled from workspace pay-equity records. No source artifacts were attached, so this pack documents methodology only.'

  return { methodology, contents }
}

// ---------------------------------------------------------------------------
// GET / — list evidence packs (public read, workspace-scoped via header)
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
  const rows = await db
    .select()
    .from(evidence_packs)
    .where(eq(evidence_packs.workspace_id, ws[0].id))
    .orderBy(desc(evidence_packs.created_at))
  return c.json(rows)
})

// ---------------------------------------------------------------------------
// GET /shared/:token — read-only pack by share token (public, no auth)
// declared before /:id so the literal segment wins.
// ---------------------------------------------------------------------------

router.get('/shared/:token', async (c) => {
  const token = c.req.param('token')
  const [pack] = await db
    .select()
    .from(evidence_packs)
    .where(eq(evidence_packs.share_token, token))
  if (!pack) return c.json({ error: 'Not found' }, 404)
  if (pack.status !== 'published')
    return c.json({ error: 'Not published' }, 404)
  const signoffs = await db
    .select()
    .from(attestations)
    .where(eq(attestations.evidence_pack_id, pack.id))
    .orderBy(desc(attestations.created_at))
  return c.json({ ...pack, attestations: signoffs })
})

// ---------------------------------------------------------------------------
// GET /:id — evidence pack detail (contents + methodology)
// ---------------------------------------------------------------------------

router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [pack] = await db
    .select()
    .from(evidence_packs)
    .where(eq(evidence_packs.id, id))
  if (!pack) return c.json({ error: 'Not found' }, 404)
  const signoffs = await db
    .select()
    .from(attestations)
    .where(eq(attestations.evidence_pack_id, id))
    .orderBy(desc(attestations.created_at))
  return c.json({ ...pack, attestations: signoffs })
})

// ---------------------------------------------------------------------------
// POST / — generate evidence pack from gap_run / scenario / band_set
// ---------------------------------------------------------------------------

const createSchema = z.object({
  title: z.string().min(1),
  gap_run_id: z.string().optional().nullable(),
  scenario_id: z.string().optional().nullable(),
  band_set_id: z.string().optional().nullable(),
})

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const body = c.req.valid('json')

  const gapRunId = body.gap_run_id ?? null
  const scenarioId = body.scenario_id ?? null
  const bandSetId = body.band_set_id ?? null

  // Ownership checks on every referenced source.
  if (gapRunId) {
    const [r] = await db.select().from(gap_runs).where(eq(gap_runs.id, gapRunId))
    if (!r) return c.json({ error: 'gap_run not found' }, 404)
    if (r.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
  }
  if (scenarioId) {
    const [s] = await db.select().from(scenarios).where(eq(scenarios.id, scenarioId))
    if (!s) return c.json({ error: 'scenario not found' }, 404)
    if (s.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
  }
  if (bandSetId) {
    const [b] = await db.select().from(band_sets).where(eq(band_sets.id, bandSetId))
    if (!b) return c.json({ error: 'band_set not found' }, 404)
    if (b.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)
  }

  const { methodology, contents } = await buildContents(
    ws.id,
    gapRunId,
    scenarioId,
    bandSetId,
  )

  const [pack] = await db
    .insert(evidence_packs)
    .values({
      workspace_id: ws.id,
      gap_run_id: gapRunId,
      scenario_id: scenarioId,
      band_set_id: bandSetId,
      title: body.title,
      methodology,
      contents,
      status: 'draft',
      created_by: userId,
    })
    .returning()
  return c.json(pack, 201)
})

// ---------------------------------------------------------------------------
// POST /:id/publish — publish + mint share_token
// ---------------------------------------------------------------------------

router.post('/:id/publish', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')

  const [pack] = await db
    .select()
    .from(evidence_packs)
    .where(eq(evidence_packs.id, id))
  if (!pack) return c.json({ error: 'Not found' }, 404)
  if (pack.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)

  const token = pack.share_token ?? randomToken()
  const [updated] = await db
    .update(evidence_packs)
    .set({ status: 'published', share_token: token })
    .where(eq(evidence_packs.id, id))
    .returning()
  return c.json(updated)
})

// ---------------------------------------------------------------------------
// DELETE /:id — delete pack (and its attestations)
// ---------------------------------------------------------------------------

router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const ws = await requireWorkspace(userId)
  const id = c.req.param('id')

  const [pack] = await db
    .select()
    .from(evidence_packs)
    .where(eq(evidence_packs.id, id))
  if (!pack) return c.json({ error: 'Not found' }, 404)
  if (pack.workspace_id !== ws.id) return c.json({ error: 'Forbidden' }, 403)

  await db
    .delete(attestations)
    .where(eq(attestations.evidence_pack_id, id))
  await db.delete(evidence_packs).where(eq(evidence_packs.id, id))
  return c.json({ success: true })
})

export default router
