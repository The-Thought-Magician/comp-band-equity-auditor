import { Hono } from 'hono'
import { db } from '../db/index.js'
import {
  workspaces,
  employees,
  engine_runs,
  positionings,
  bands,
  gap_runs,
  gap_results,
  scenarios,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { getUserId } from '../lib/auth.js'

const router = new Hono()

// Public reads are workspace-scoped via the X-User-Id header. No workspace
// (anonymous or unprovisioned) yields empty/zeroed analytics.
async function resolveWorkspaceId(c: any): Promise<string | null> {
  const userId = getUserId(c)
  if (!userId) return null
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.owner_id, userId))
  return ws?.id ?? null
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

async function latestEngineRun(workspaceId: string) {
  const [run] = await db
    .select()
    .from(engine_runs)
    .where(eq(engine_runs.workspace_id, workspaceId))
    .orderBy(desc(engine_runs.created_at))
  return run ?? null
}

async function latestGapRun(workspaceId: string) {
  const [run] = await db
    .select()
    .from(gap_runs)
    .where(eq(gap_runs.workspace_id, workspaceId))
    .orderBy(desc(gap_runs.created_at))
  return run ?? null
}

// GET /summary — KPI tiles
router.get('/summary', async (c) => {
  const workspaceId = await resolveWorkspaceId(c)
  const emptyTiles = {
    medianCompaRatio: 0,
    largestUnexplainedGapPct: 0,
    totalExposureCents: 0,
    outlierCount: 0,
    headcount: 0,
    bandCoveragePct: 0,
  }
  if (!workspaceId) return c.json({ tiles: emptyTiles })

  const run = await latestEngineRun(workspaceId)

  let medianCompaRatio = 0
  let outlierCount = 0
  let totalExposureCents = 0
  let headcount = 0
  let bandCoveragePct = 0

  if (run) {
    const pos = await db
      .select()
      .from(positionings)
      .where(eq(positionings.engine_run_id, run.id))

    headcount = pos.length
    const ratios = pos.map((p) => p.compa_ratio).filter((r): r is number => r != null)
    medianCompaRatio = median(ratios)
    outlierCount = pos.filter((p) => (p.flags ?? []).length > 0).length
    bandCoveragePct =
      pos.length === 0
        ? 0
        : Math.round((pos.filter((p) => p.band_id != null).length / pos.length) * 1000) / 10

    // Total exposure: cost to bring every below-min employee up to band minimum.
    const bandList = await db.select().from(bands).where(eq(bands.workspace_id, workspaceId))
    const bandById = new Map(bandList.map((b) => [b.id, b]))
    let exposure = 0
    for (const p of pos) {
      const band = p.band_id ? bandById.get(p.band_id) : undefined
      const salary = p.base_salary_normalized ?? 0
      if (band && salary > 0 && salary < band.min_salary) {
        exposure += (band.min_salary - salary) * 100
      }
    }
    totalExposureCents = Math.round(exposure)
  } else {
    // No engine run yet — still surface raw headcount from the latest dataset.
    const emps = await db
      .select()
      .from(employees)
      .where(eq(employees.workspace_id, workspaceId))
    headcount = emps.length
  }

  // Largest unexplained gap from the latest gap run.
  let largestUnexplainedGapPct = 0
  const gapRun = await latestGapRun(workspaceId)
  if (gapRun) {
    const results = await db
      .select()
      .from(gap_results)
      .where(eq(gap_results.gap_run_id, gapRun.id))
    for (const r of results) {
      const u = Math.abs(r.unexplained_pct ?? 0)
      if (u > largestUnexplainedGapPct) largestUnexplainedGapPct = u
    }
    largestUnexplainedGapPct = Math.round(largestUnexplainedGapPct * 100) / 100
  }

  return c.json({
    tiles: {
      medianCompaRatio: Math.round(medianCompaRatio * 1000) / 1000,
      largestUnexplainedGapPct,
      totalExposureCents,
      outlierCount,
      headcount,
      bandCoveragePct,
    },
  })
})

// GET /outliers — outlier board from the latest engine run
router.get('/outliers', async (c) => {
  const workspaceId = await resolveWorkspaceId(c)
  if (!workspaceId) return c.json({ outliers: [] })

  const run = await latestEngineRun(workspaceId)
  if (!run) return c.json({ outliers: [] })

  const pos = await db
    .select()
    .from(positionings)
    .where(eq(positionings.engine_run_id, run.id))

  const flagged = pos.filter((p) => (p.flags ?? []).length > 0)

  const empList = await db
    .select()
    .from(employees)
    .where(eq(employees.workspace_id, workspaceId))
  const empById = new Map(empList.map((e) => [e.id, e]))

  const outliers = flagged
    .map((p) => {
      const emp = empById.get(p.employee_id)
      return {
        positioning_id: p.id,
        employee_id: p.employee_id,
        employee_ref: emp?.employee_ref ?? null,
        name: emp?.name ?? null,
        level: emp?.level ?? null,
        role_family: emp?.role_family ?? null,
        geo: emp?.geo ?? null,
        compa_ratio: p.compa_ratio,
        range_penetration: p.range_penetration,
        quartile: p.quartile,
        flags: p.flags ?? [],
        base_salary_normalized: p.base_salary_normalized,
      }
    })
    // Rank by how far compa-ratio strays from 1.0 (most extreme first).
    .sort(
      (a, b) =>
        Math.abs((b.compa_ratio ?? 1) - 1) - Math.abs((a.compa_ratio ?? 1) - 1),
    )

  return c.json({ outliers, engine_run_id: run.id, engine_run_label: run.label })
})

// GET /analytics — gap-by-cohort + compa distribution + budget trend
router.get('/analytics', async (c) => {
  const workspaceId = await resolveWorkspaceId(c)
  if (!workspaceId) {
    return c.json({ gapByCohort: [], compaDistribution: [], budgetTrend: [] })
  }

  // gap-by-cohort: latest gap run's results keyed by cohort.
  const gapByCohort: Array<{
    cohort_key: string
    dimension: string
    raw_gap_pct: number
    adjusted_gap_pct: number
    unexplained_pct: number
    group_size: number
  }> = []
  const gapRun = await latestGapRun(workspaceId)
  if (gapRun) {
    const results = await db
      .select()
      .from(gap_results)
      .where(eq(gap_results.gap_run_id, gapRun.id))
      .orderBy(desc(gap_results.unexplained_pct))
    for (const r of results) {
      gapByCohort.push({
        cohort_key: r.cohort_key,
        dimension: r.dimension,
        raw_gap_pct: r.raw_gap_pct ?? 0,
        adjusted_gap_pct: r.adjusted_gap_pct ?? 0,
        unexplained_pct: r.unexplained_pct ?? 0,
        group_size: r.group_size ?? 0,
      })
    }
  }

  // compa distribution: bucketed compa-ratios from the latest engine run.
  const compaDistribution: Array<{ bucket: string; count: number }> = []
  const run = await latestEngineRun(workspaceId)
  if (run) {
    const pos = await db
      .select()
      .from(positionings)
      .where(eq(positionings.engine_run_id, run.id))
    const ratios = pos.map((p) => p.compa_ratio).filter((r): r is number => r != null)

    const bucketDefs: Array<{ label: string; lo: number; hi: number }> = [
      { label: '<0.80', lo: -Infinity, hi: 0.8 },
      { label: '0.80–0.90', lo: 0.8, hi: 0.9 },
      { label: '0.90–1.00', lo: 0.9, hi: 1.0 },
      { label: '1.00–1.10', lo: 1.0, hi: 1.1 },
      { label: '1.10–1.20', lo: 1.1, hi: 1.2 },
      { label: '≥1.20', lo: 1.2, hi: Infinity },
    ]
    for (const def of bucketDefs) {
      const count = ratios.filter((r) => r >= def.lo && r < def.hi).length
      compaDistribution.push({ bucket: def.label, count })
    }
  }

  // budget trend: remediation budget over time from scenarios (chronological).
  const scen = await db
    .select()
    .from(scenarios)
    .where(eq(scenarios.workspace_id, workspaceId))
    .orderBy(scenarios.created_at)
  const budgetTrend = scen.map((s) => ({
    scenario_id: s.id,
    name: s.name,
    created_at: s.created_at,
    total_budget_cents: s.total_budget_cents,
    headcount_affected: s.headcount_affected,
    residual_gap_pct: s.residual_gap_pct ?? 0,
  }))

  return c.json({ gapByCohort, compaDistribution, budgetTrend })
})

export default router
