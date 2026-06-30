'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import api from '@/lib/api'
import { authClient } from '@/lib/auth/client'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface DecompFactor {
  factor?: string
  name?: string
  contribution_pct?: number
  contribution?: number
  [k: string]: unknown
}

interface GapResult {
  id: string
  gap_run_id: string
  cohort_key: string
  dimension: string
  raw_gap_pct: number | null
  adjusted_gap_pct: number | null
  explained_pct: number | null
  unexplained_pct: number | null
  group_size: number | null
  mean_pay: number | null
  decomposition: DecompFactor[] | Record<string, number> | null
}

interface GapRun {
  id: string
  dataset_id: string
  band_set_id: string | null
  reference_group: string | null
  summary: Record<string, unknown> | null
  status: string
  created_at: string
  results?: GapResult[]
}

interface Employee {
  id: string
  employee_ref?: string
  name?: string
  level?: string
  role_family?: string
  geo?: string
  gender?: string
  ethnicity?: string
  tenure_months?: number
  performance_rating?: number
  base_salary?: number
  currency?: string
}

function pct(v: unknown, signed = true): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  return `${signed && n > 0 ? '+' : ''}${n.toFixed(1)}%`
}

function money(v: unknown, currency = 'USD'): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(v))
  } catch {
    return Number(v).toLocaleString()
  }
}

function gapTone(v: unknown): 'rose' | 'amber' | 'green' {
  const n = Math.abs(Number(v ?? 0))
  if (n >= 5) return 'rose'
  if (n >= 2) return 'amber'
  return 'green'
}

function normalizeDecomp(d: GapResult['decomposition']): DecompFactor[] {
  if (!d) return []
  if (Array.isArray(d)) {
    return d.map((f) => ({
      factor: f.factor ?? f.name ?? 'factor',
      contribution_pct: Number(f.contribution_pct ?? f.contribution ?? 0),
    }))
  }
  return Object.entries(d).map(([factor, contribution_pct]) => ({
    factor,
    contribution_pct: Number(contribution_pct),
  }))
}

// Horizontal diverging bar comparing raw vs adjusted
function GapBar({ value, max }: { value: number; max: number }) {
  const span = Math.max(max, 1)
  const widthPct = Math.min(100, (Math.abs(value) / span) * 100)
  const negative = value < 0
  return (
    <div className="relative h-5 w-full overflow-hidden rounded bg-slate-800">
      <div className="absolute left-1/2 top-0 h-full w-px bg-slate-600" />
      <div
        className={`absolute top-0 h-full ${negative ? 'bg-sky-500/60' : 'bg-rose-500/60'}`}
        style={{
          width: `${widthPct / 2}%`,
          left: negative ? `${50 - widthPct / 2}%` : '50%',
        }}
      />
    </div>
  )
}

export default function GapRunDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const id = params?.id

  const [run, setRun] = useState<GapRun | null>(null)
  const [results, setResults] = useState<GapResult[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dimFilter, setDimFilter] = useState('all')

  // Drill-down state
  const [drillKey, setDrillKey] = useState<{ cohort: string; dimension: string } | null>(null)
  const [drillRows, setDrillRows] = useState<Employee[]>([])
  const [drillLoading, setDrillLoading] = useState(false)
  const [drillError, setDrillError] = useState<string | null>(null)

  async function load() {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const [r, res] = await Promise.all([api.getGapRun(id), api.getGapResults(id)])
      setRun(r as GapRun)
      const list = Array.isArray(res) ? res : (r as GapRun)?.results ?? []
      setResults(Array.isArray(list) ? (list as GapResult[]) : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load gap run')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      const session = await authClient.getSession().catch(() => null)
      if (!active) return
      if (!session) {
        router.replace('/auth/sign-in')
        return
      }
      load()
    })()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function openDrill(cohort: string, dimension: string) {
    if (!id) return
    setDrillKey({ cohort, dimension })
    setDrillLoading(true)
    setDrillError(null)
    setDrillRows([])
    try {
      const rows = await api.getGapDrilldown(id, { cohort_key: cohort, dimension })
      setDrillRows(Array.isArray(rows) ? rows : [])
    } catch (e) {
      setDrillError(e instanceof Error ? e.message : 'Failed to load contributing employees')
    } finally {
      setDrillLoading(false)
    }
  }

  const dimensions = useMemo(() => Array.from(new Set(results.map((r) => r.dimension))).sort(), [results])

  const filtered = useMemo(
    () => (dimFilter === 'all' ? results : results.filter((r) => r.dimension === dimFilter)),
    [results, dimFilter],
  )

  const maxAbsGap = useMemo(
    () =>
      results.reduce(
        (m, r) => Math.max(m, Math.abs(Number(r.raw_gap_pct ?? 0)), Math.abs(Number(r.adjusted_gap_pct ?? 0))),
        0,
      ),
    [results],
  )

  const headline = useMemo(() => {
    let worstUnexplained = 0
    let worstRow: GapResult | null = null
    for (const r of results) {
      const v = Math.abs(Number(r.unexplained_pct ?? r.adjusted_gap_pct ?? 0))
      if (v > worstUnexplained) {
        worstUnexplained = v
        worstRow = r
      }
    }
    const avgRaw =
      results.length > 0 ? results.reduce((a, r) => a + Math.abs(Number(r.raw_gap_pct ?? 0)), 0) / results.length : 0
    const avgAdj =
      results.length > 0
        ? results.reduce((a, r) => a + Math.abs(Number(r.adjusted_gap_pct ?? 0)), 0) / results.length
        : 0
    return { worstUnexplained, worstRow, avgRaw, avgAdj }
  }, [results])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner label="Loading gap run…" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/gaps" className="text-sm text-violet-300 hover:text-violet-200">
          ← Back to gap runs
        </Link>
        <Card>
          <CardBody>
            <p className="text-sm text-rose-300">{error}</p>
            <Button variant="secondary" className="mt-4" onClick={load}>
              Retry
            </Button>
          </CardBody>
        </Card>
      </div>
    )
  }

  if (!run) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/gaps" className="text-sm text-violet-300 hover:text-violet-200">
          ← Back to gap runs
        </Link>
        <EmptyState title="Gap run not found" description="It may have been deleted." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Link href="/dashboard/gaps" className="text-sm text-violet-300 hover:text-violet-200">
          ← Back to gap runs
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-100">
              {run.reference_group ? `Gap vs reference: ${run.reference_group}` : 'Pay gap run'}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Run {run.id.slice(0, 8)} ·{' '}
              {run.created_at ? new Date(run.created_at).toLocaleString() : 'unknown date'}
            </p>
          </div>
          <Badge tone={run.status === 'complete' || run.status === 'completed' ? 'green' : 'amber'}>{run.status}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Stat label="Cohorts analyzed" value={results.length} tone="violet" />
        <Stat label="Avg raw gap" value={pct(headline.avgRaw, false)} tone={gapTone(headline.avgRaw)} />
        <Stat label="Avg adjusted gap" value={pct(headline.avgAdj, false)} tone={gapTone(headline.avgAdj)} />
        <Stat
          label="Largest unexplained"
          value={pct(headline.worstUnexplained, false)}
          hint={headline.worstRow ? headline.worstRow.cohort_key : undefined}
          tone={gapTone(headline.worstUnexplained)}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Raw vs adjusted gap by cohort</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Adjusted gap controls for level, role, geo, tenure and performance. Click a row to drill into contributing
              employees.
            </p>
          </div>
          {dimensions.length > 1 && (
            <select
              value={dimFilter}
              onChange={(e) => setDimFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-violet-500 focus:outline-none"
            >
              <option value="all">All dimensions</option>
              {dimensions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}
        </CardHeader>
        <CardBody className="p-0">
          {results.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No results"
                description="This run produced no cohort results. The dataset may be empty or the dimensions had no comparison groups."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Cohort</TH>
                  <TH>Dimension</TH>
                  <TH className="text-right">Group size</TH>
                  <TH className="text-right">Mean pay</TH>
                  <TH className="text-right">Raw gap</TH>
                  <TH className="text-right">Adjusted gap</TH>
                  <TH>Raw vs adjusted</TH>
                  <TH className="text-right">Explained / Unexplained</TH>
                  <TH className="text-right">Drill</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => {
                  const explained = Number(r.explained_pct ?? 0)
                  const unexplained = Number(r.unexplained_pct ?? 0)
                  const totalSplit = Math.max(Math.abs(explained) + Math.abs(unexplained), 0.0001)
                  const explShare = (Math.abs(explained) / totalSplit) * 100
                  return (
                    <TR key={r.id}>
                      <TD className="font-medium text-slate-200">{r.cohort_key}</TD>
                      <TD>
                        <Badge tone="neutral">{r.dimension}</Badge>
                      </TD>
                      <TD className="text-right">{r.group_size ?? '—'}</TD>
                      <TD className="text-right">{money(r.mean_pay)}</TD>
                      <TD className="text-right">
                        <Badge tone={gapTone(r.raw_gap_pct)}>{pct(r.raw_gap_pct)}</Badge>
                      </TD>
                      <TD className="text-right">
                        <Badge tone={gapTone(r.adjusted_gap_pct)}>{pct(r.adjusted_gap_pct)}</Badge>
                      </TD>
                      <TD className="min-w-[140px]">
                        <div className="space-y-1">
                          <GapBar value={Number(r.raw_gap_pct ?? 0)} max={maxAbsGap} />
                          <GapBar value={Number(r.adjusted_gap_pct ?? 0)} max={maxAbsGap} />
                        </div>
                      </TD>
                      <TD className="text-right">
                        <div className="flex h-3 w-32 overflow-hidden rounded-full bg-slate-800">
                          <div className="bg-sky-500/70" style={{ width: `${explShare}%` }} title={`Explained ${pct(explained, false)}`} />
                          <div className="bg-rose-500/70" style={{ width: `${100 - explShare}%` }} title={`Unexplained ${pct(unexplained, false)}`} />
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {pct(explained, false)} expl · {pct(unexplained, false)} unexpl
                        </div>
                      </TD>
                      <TD className="text-right">
                        <Button variant="ghost" className="px-2 py-1" onClick={() => openDrill(r.cohort_key, r.dimension)}>
                          Drill →
                        </Button>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Decomposition panels */}
      {filtered.some((r) => normalizeDecomp(r.decomposition).length > 0) && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-200">Decomposition — what drives each gap</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Share of the raw gap attributable to each explanatory factor; the remainder is unexplained.
            </p>
          </CardHeader>
          <CardBody className="space-y-5">
            {filtered.map((r) => {
              const factors = normalizeDecomp(r.decomposition)
              if (factors.length === 0) return null
              const maxFactor = Math.max(...factors.map((f) => Math.abs(Number(f.contribution_pct ?? 0))), 0.0001)
              return (
                <div key={r.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-200">
                      {r.cohort_key} <span className="text-slate-500">· {r.dimension}</span>
                    </span>
                    <Badge tone={gapTone(r.unexplained_pct)}>{pct(r.unexplained_pct)} unexplained</Badge>
                  </div>
                  <div className="space-y-2">
                    {factors.map((f, i) => {
                      const v = Number(f.contribution_pct ?? 0)
                      const w = (Math.abs(v) / maxFactor) * 100
                      return (
                        <div key={i} className="grid grid-cols-[120px_1fr_60px] items-center gap-3">
                          <span className="truncate text-xs text-slate-400">{f.factor}</span>
                          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
                            <div
                              className={v < 0 ? 'h-full bg-sky-500/70' : 'h-full bg-violet-500/70'}
                              style={{ width: `${w}%` }}
                            />
                          </div>
                          <span className="text-right text-xs text-slate-300">{pct(v)}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </CardBody>
        </Card>
      )}

      {/* Drill-down */}
      {drillKey && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">
                Contributing employees — {drillKey.cohort}{' '}
                <span className="text-slate-500">({drillKey.dimension})</span>
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">Individuals making up this cohort.</p>
            </div>
            <Button variant="ghost" className="px-2 py-1" onClick={() => setDrillKey(null)}>
              Close ✕
            </Button>
          </CardHeader>
          <CardBody className="p-0">
            {drillLoading ? (
              <div className="flex items-center justify-center py-10">
                <Spinner label="Loading employees…" />
              </div>
            ) : drillError ? (
              <p className="px-5 py-6 text-sm text-rose-300">{drillError}</p>
            ) : drillRows.length === 0 ? (
              <div className="p-5">
                <EmptyState title="No employees" description="No individuals matched this cohort key." />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Employee</TH>
                    <TH>Level</TH>
                    <TH>Role</TH>
                    <TH>Geo</TH>
                    <TH className="text-right">Tenure (mo)</TH>
                    <TH className="text-right">Rating</TH>
                    <TH className="text-right">Base salary</TH>
                  </TR>
                </THead>
                <TBody>
                  {drillRows.map((e) => (
                    <TR key={e.id}>
                      <TD>
                        <Link href={`/dashboard/datasets/${run.dataset_id}`} className="text-violet-300 hover:text-violet-200">
                          {e.name || e.employee_ref || e.id.slice(0, 8)}
                        </Link>
                      </TD>
                      <TD>{e.level ?? '—'}</TD>
                      <TD>{e.role_family ?? '—'}</TD>
                      <TD>{e.geo ?? '—'}</TD>
                      <TD className="text-right">{e.tenure_months ?? '—'}</TD>
                      <TD className="text-right">{e.performance_rating ?? '—'}</TD>
                      <TD className="text-right">{money(e.base_salary, e.currency || 'USD')}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  )
}
