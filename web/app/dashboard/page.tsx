'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'
import RightRail from '@/components/RightRail'

interface Tile {
  key: string
  label: string
  value: string | number
  hint?: string
  tone?: 'default' | 'violet' | 'green' | 'amber' | 'rose'
}

interface SummaryResponse {
  tiles?: Tile[] | Record<string, unknown>
  [k: string]: unknown
}

interface Outlier {
  id?: string
  employee_id?: string
  employee_ref?: string
  name?: string
  level?: string
  role_family?: string
  geo?: string
  compa_ratio?: number
  range_penetration?: number
  base_salary?: number
  base_salary_normalized?: number
  flags?: string[] | Record<string, unknown>
  quartile?: string | number
}

interface OutliersResponse {
  outliers?: Outlier[]
  [k: string]: unknown
}

interface SampleStatus {
  hasData?: boolean
}

function fmtNum(v: unknown, digits = 2): string {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

function fmtMoney(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function compaTone(r?: number): 'green' | 'amber' | 'rose' | 'neutral' {
  if (typeof r !== 'number' || !Number.isFinite(r)) return 'neutral'
  if (r < 0.85) return 'rose'
  if (r > 1.15) return 'amber'
  return 'green'
}

function flagList(flags: Outlier['flags']): string[] {
  if (!flags) return []
  if (Array.isArray(flags)) return flags.map(String)
  if (typeof flags === 'object') {
    return Object.entries(flags)
      .filter(([, v]) => v === true || (typeof v === 'number' && v > 0) || (typeof v === 'string' && v.length > 0))
      .map(([k]) => k)
  }
  return []
}

// Tolerant of the backend returning either { tiles: Tile[] } or a flat KPI object.
function normalizeTiles(summary: SummaryResponse | null): Tile[] {
  if (!summary) return []
  const t = summary.tiles
  if (Array.isArray(t)) {
    return t.map((x, i) => ({
      key: x.key ?? x.label ?? `tile-${i}`,
      label: x.label ?? x.key ?? `Metric ${i + 1}`,
      value: x.value ?? '—',
      hint: x.hint,
      tone: x.tone,
    }))
  }
  // Fall back to known KPI fields described in the build plan.
  const src = (t && typeof t === 'object' ? (t as Record<string, unknown>) : (summary as Record<string, unknown>))
  const mapped: Tile[] = []
  const push = (key: string, label: string, value: unknown, opts?: Partial<Tile>) => {
    if (value === undefined || value === null) return
    mapped.push({ key, label, value: typeof value === 'number' ? fmtNum(value) : String(value), ...opts })
  }
  push('median_compa_ratio', 'Median Compa-Ratio', src.median_compa_ratio ?? src.medianCompaRatio, { tone: 'violet' })
  push('largest_unexplained_gap', 'Largest Unexplained Gap', src.largest_unexplained_gap ?? src.largestUnexplainedGap, { tone: 'rose', hint: '% pay gap' })
  push('total_exposure', 'Total Exposure', src.total_exposure ?? src.totalExposure, { tone: 'amber' })
  push('outlier_count', 'Outliers', src.outlier_count ?? src.outlierCount, { tone: 'rose' })
  push('headcount', 'Headcount', src.headcount)
  push('band_coverage', 'Band Coverage', src.band_coverage ?? src.bandCoverage, { tone: 'green', hint: '% mapped to a band' })
  return mapped
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [outliers, setOutliers] = useState<Outlier[]>([])
  const [hasData, setHasData] = useState<boolean | null>(null)
  const [seeding, setSeeding] = useState(false)
  const [seedError, setSeedError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const status = (await api.getSampleStatus().catch(() => null)) as SampleStatus | null
      const hasAny = Boolean(status?.hasData)
      setHasData(hasAny)

      if (hasAny) {
        const [s, o] = await Promise.all([
          api.getDashboardSummary().catch(() => null),
          api.getDashboardOutliers().catch(() => null),
        ])
        setSummary(s as SummaryResponse | null)
        const list = (o as OutliersResponse | null)?.outliers
        setOutliers(Array.isArray(list) ? list : Array.isArray(o) ? (o as Outlier[]) : [])
      } else {
        setSummary(null)
        setOutliers([])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handleSeed = async () => {
    setSeeding(true)
    setSeedError(null)
    try {
      await api.seedSample()
      await load()
    } catch (e) {
      setSeedError(e instanceof Error ? e.message : 'Failed to seed sample data')
    } finally {
      setSeeding(false)
    }
  }

  const tiles = normalizeTiles(summary)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner label="Loading dashboard..." />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 xl:flex-row xl:items-start">
    <div className="min-w-0 flex-1 space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">Dashboard</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Pay-equity snapshot across your latest engine run and gap analysis.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
          {hasData && (
            <Link href="/dashboard/positioning">
              <Button>Run engine</Button>
            </Link>
          )}
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {hasData === false ? (
        <EmptyState
          icon={<span>◍</span>}
          title="No data in this workspace yet"
          description="Seed a synthetic ~80-person org with planted compensation outliers and a gender pay gap to explore every feature instantly. You can delete it later."
          action={
            <div className="flex flex-col items-center gap-3">
              <Button onClick={handleSeed} disabled={seeding}>
                {seeding ? 'Seeding sample org...' : 'Seed sample organization'}
              </Button>
              {seedError && <p className="text-xs text-rose-400">{seedError}</p>}
              <Link href="/dashboard/datasets" className="text-xs text-neutral-500 hover:text-neutral-300">
                or upload your own dataset →
              </Link>
            </div>
          }
        />
      ) : (
        <>
          {/* KPI tiles */}
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Key metrics
            </h2>
            {tiles.length === 0 ? (
              <Card>
                <CardBody>
                  <p className="text-sm text-neutral-500">
                    No metrics computed yet. Run the positioning engine and a gap analysis to populate KPIs.
                  </p>
                </CardBody>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {tiles.map((t) => (
                  <Stat key={t.key} label={t.label} value={t.value} hint={t.hint} tone={t.tone} />
                ))}
              </div>
            )}
          </section>

          {/* Outlier board */}
          <section>
            <Card>
              <CardHeader className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-semibold text-neutral-100">Outlier board</h2>
                  <p className="text-xs text-neutral-500">
                    Employees flagged out of band or compressed in the latest engine run.
                  </p>
                </div>
                {outliers.length > 0 && <Badge tone="rose">{outliers.length} flagged</Badge>}
              </CardHeader>
              <CardBody className="px-0 py-0">
                {outliers.length === 0 ? (
                  <div className="px-5 py-10 text-center text-sm text-neutral-500">
                    No outliers detected in the latest run. Either there is no engine run yet, or
                    everyone is within their target band.
                    <div className="mt-4">
                      <Link href="/dashboard/positioning">
                        <Button variant="secondary">Go to Positioning</Button>
                      </Link>
                    </div>
                  </div>
                ) : (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Employee</TH>
                        <TH>Level / Role</TH>
                        <TH>Geo</TH>
                        <TH className="text-right">Base</TH>
                        <TH className="text-right">Compa-ratio</TH>
                        <TH className="text-right">Range pen.</TH>
                        <TH>Flags</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {outliers.map((o, i) => {
                        const flags = flagList(o.flags)
                        const compa = o.compa_ratio
                        return (
                          <TR key={o.id ?? o.employee_id ?? `${o.employee_ref ?? 'row'}-${i}`}>
                            <TD>
                              <div className="font-medium text-neutral-200">
                                {o.name ?? o.employee_ref ?? '—'}
                              </div>
                              {o.employee_ref && o.name && (
                                <div className="text-xs text-neutral-500">{o.employee_ref}</div>
                              )}
                            </TD>
                            <TD>
                              <span className="text-neutral-300">{o.level ?? '—'}</span>
                              {o.role_family && (
                                <span className="text-neutral-500"> · {o.role_family}</span>
                              )}
                            </TD>
                            <TD>{o.geo ?? '—'}</TD>
                            <TD className="text-right tabular-nums">
                              {fmtMoney(o.base_salary ?? o.base_salary_normalized)}
                            </TD>
                            <TD className="text-right">
                              {typeof compa === 'number' ? (
                                <Badge tone={compaTone(compa)}>{fmtNum(compa)}</Badge>
                              ) : (
                                '—'
                              )}
                            </TD>
                            <TD className="text-right tabular-nums">
                              {typeof o.range_penetration === 'number'
                                ? `${fmtNum(o.range_penetration * 100, 0)}%`
                                : '—'}
                            </TD>
                            <TD>
                              {flags.length === 0 ? (
                                <span className="text-neutral-600">—</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {flags.map((f) => (
                                    <Badge key={f} tone="amber">
                                      {f.replace(/_/g, ' ')}
                                    </Badge>
                                  ))}
                                </div>
                              )}
                            </TD>
                          </TR>
                        )
                      })}
                    </TBody>
                  </Table>
                )}
              </CardBody>
            </Card>
          </section>

          {/* Quick links */}
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { href: '/dashboard/gaps', label: 'Pay Gaps', desc: 'Raw vs adjusted decomposition' },
              { href: '/dashboard/scenarios', label: 'Scenarios', desc: 'Remediation what-ifs' },
              { href: '/dashboard/bands', label: 'Comp Bands', desc: 'Versioned band designer' },
              { href: '/dashboard/evidence', label: 'Evidence Packs', desc: 'Board-ready sign-off' },
            ].map((q) => (
              <Link key={q.href} href={q.href}>
                <Card className="h-full transition-colors hover:border-orange-500/40">
                  <CardBody>
                    <div className="text-sm font-semibold text-orange-300">{q.label}</div>
                    <div className="mt-1 text-xs text-neutral-500">{q.desc}</div>
                  </CardBody>
                </Card>
              </Link>
            ))}
          </section>
        </>
      )}
    </div>
    <RightRail />
    </div>
  )
}
