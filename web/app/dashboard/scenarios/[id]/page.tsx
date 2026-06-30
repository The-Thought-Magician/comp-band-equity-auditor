'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Adjustment {
  id: string
  employee_id: string
  employee_name?: string | null
  employee_ref?: string | null
  level?: string | null
  current_salary: number
  proposed_salary: number
  delta_cents: number
  rationale?: string | null
}

interface Scenario {
  id: string
  name: string
  target_type: string
  status: string
  total_budget_cents: number | null
  headcount_affected: number | null
  residual_gap_pct: number | null
  constraints?: Record<string, unknown> | null
  dataset_id: string
  band_set_id: string
  created_at: string
  adjustments?: Adjustment[]
}

interface SensitivityPoint {
  budget_cents?: number
  budget?: number
  residual_gap_pct?: number
  residual_gap?: number
  headcount_affected?: number
  [k: string]: unknown
}

function money(cents: number | null | undefined): string {
  if (cents == null) return '—'
  return (cents / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

function dollars(v: number | null | undefined): string {
  if (v == null) return '—'
  return v.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

function pct(v: number | null | undefined): string {
  if (v == null) return '—'
  return `${v.toFixed(1)}%`
}

function gapTone(v: number | null | undefined): 'green' | 'amber' | 'rose' | 'neutral' {
  if (v == null) return 'neutral'
  const a = Math.abs(v)
  if (a < 1) return 'green'
  if (a < 3) return 'amber'
  return 'rose'
}

function statTone(
  t: 'green' | 'amber' | 'rose' | 'neutral',
): 'default' | 'violet' | 'green' | 'amber' | 'rose' {
  return t === 'neutral' ? 'default' : t
}

export default function ScenarioDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const [scenario, setScenario] = useState<Scenario | null>(null)
  const [sensitivity, setSensitivity] = useState<SensitivityPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [sensLoading, setSensLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sensError, setSensError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [onlyIncreases, setOnlyIncreases] = useState(false)
  const [sortKey, setSortKey] = useState<'delta' | 'current' | 'name'>('delta')

  useEffect(() => {
    if (!id) return
    let active = true
    setLoading(true)
    setError(null)
    api
      .getScenario(id)
      .then((s) => {
        if (active) setScenario(s)
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load scenario')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    setSensLoading(true)
    setSensError(null)
    api
      .getScenarioSensitivity(id)
      .then((res) => {
        if (!active) return
        const pts: SensitivityPoint[] = Array.isArray(res)
          ? res
          : Array.isArray(res?.points)
            ? res.points
            : []
        setSensitivity(pts)
      })
      .catch((e) => {
        if (active) setSensError(e instanceof Error ? e.message : 'Failed to load sensitivity')
      })
      .finally(() => {
        if (active) setSensLoading(false)
      })

    return () => {
      active = false
    }
  }, [id])

  const adjustments = scenario?.adjustments ?? []

  const filteredAdj = useMemo(() => {
    let rows = adjustments.slice()
    if (onlyIncreases) rows = rows.filter((a) => (a.delta_cents ?? 0) > 0)
    if (search) {
      const q = search.toLowerCase()
      rows = rows.filter((a) =>
        `${a.employee_name ?? ''} ${a.employee_ref ?? ''} ${a.level ?? ''}`
          .toLowerCase()
          .includes(q),
      )
    }
    rows.sort((a, b) => {
      if (sortKey === 'delta') return (b.delta_cents ?? 0) - (a.delta_cents ?? 0)
      if (sortKey === 'current') return (b.current_salary ?? 0) - (a.current_salary ?? 0)
      return (a.employee_name ?? a.employee_ref ?? '').localeCompare(
        b.employee_name ?? b.employee_ref ?? '',
      )
    })
    return rows
  }, [adjustments, onlyIncreases, search, sortKey])

  const stats = useMemo(() => {
    const totalDelta = adjustments.reduce((a, x) => a + (x.delta_cents ?? 0), 0)
    const affected = adjustments.filter((x) => (x.delta_cents ?? 0) !== 0).length
    const maxDelta = adjustments.reduce((m, x) => Math.max(m, x.delta_cents ?? 0), 0)
    const avgDelta = affected ? totalDelta / affected : 0
    return { totalDelta, affected, maxDelta, avgDelta }
  }, [adjustments])

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner label="Loading scenario..." />
      </div>
    )
  }

  if (error || !scenario) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/scenarios" className="text-sm text-violet-300 hover:text-violet-200">
          ← Back to scenarios
        </Link>
        <Card>
          <CardBody>
            <p className="text-sm text-rose-300">{error ?? 'Scenario not found.'}</p>
          </CardBody>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/scenarios"
          className="text-sm text-violet-300 hover:text-violet-200"
        >
          ← Back to scenarios
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-slate-100">{scenario.name}</h1>
          <Badge tone="violet">{scenario.target_type}</Badge>
          <Badge tone={scenario.status === 'applied' ? 'green' : 'neutral'}>
            {scenario.status}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Created {new Date(scenario.created_at).toLocaleDateString()}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Total budget"
          value={money(scenario.total_budget_cents ?? stats.totalDelta)}
          tone="violet"
        />
        <Stat
          label="Headcount affected"
          value={(scenario.headcount_affected ?? stats.affected).toLocaleString()}
          hint={`avg ${money(stats.avgDelta)} / person`}
        />
        <Stat
          label="Residual gap"
          value={pct(scenario.residual_gap_pct)}
          tone={statTone(gapTone(scenario.residual_gap_pct))}
        />
        <Stat label="Largest single raise" value={money(stats.maxDelta)} />
      </div>

      {scenario.constraints && Object.keys(scenario.constraints).length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-200">Constraints</h2>
          </CardHeader>
          <CardBody className="flex flex-wrap gap-2">
            {Object.entries(scenario.constraints).map(([k, v]) => (
              <Badge key={k} tone="sky">
                {k}: {String(v)}
              </Badge>
            ))}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-200">Budget vs residual gap sensitivity</h2>
          <p className="mt-1 text-xs text-slate-500">
            How residual unexplained gap shrinks as you spend more on this scenario.
          </p>
        </CardHeader>
        <CardBody>
          {sensLoading ? (
            <div className="flex justify-center py-10">
              <Spinner label="Loading curve..." />
            </div>
          ) : sensError ? (
            <p className="text-sm text-rose-300">{sensError}</p>
          ) : sensitivity.length === 0 ? (
            <p className="text-sm text-slate-500">No sensitivity data available.</p>
          ) : (
            <SensitivityChart points={sensitivity} />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Line-item adjustments</h2>
            <p className="mt-1 text-xs text-slate-500">{adjustments.length} proposed changes</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search people..."
              className={inputCls + ' w-48'}
            />
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
              className={inputCls}
            >
              <option value="delta">Sort: raise size</option>
              <option value="current">Sort: current salary</option>
              <option value="name">Sort: name</option>
            </select>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={onlyIncreases}
                onChange={(e) => setOnlyIncreases(e.target.checked)}
                className="accent-violet-500"
              />
              Only raises
            </label>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {adjustments.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No adjustments"
                description="This scenario did not produce any line-item pay changes."
                icon="∅"
              />
            </div>
          ) : filteredAdj.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No matches" description="Adjust your filters." icon="∅" />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Employee</TH>
                  <TH>Level</TH>
                  <TH className="text-right">Current</TH>
                  <TH className="text-right">Proposed</TH>
                  <TH className="text-right">Delta</TH>
                  <TH>Rationale</TH>
                </TR>
              </THead>
              <TBody>
                {filteredAdj.map((a) => {
                  const deltaPct = a.current_salary
                    ? ((a.proposed_salary - a.current_salary) / a.current_salary) * 100
                    : 0
                  return (
                    <TR key={a.id}>
                      <TD className="font-medium text-slate-200">
                        {a.employee_name ?? a.employee_ref ?? a.employee_id.slice(0, 8)}
                      </TD>
                      <TD className="text-slate-400">{a.level ?? '—'}</TD>
                      <TD className="text-right tabular-nums">{dollars(a.current_salary)}</TD>
                      <TD className="text-right tabular-nums text-slate-100">
                        {dollars(a.proposed_salary)}
                      </TD>
                      <TD className="text-right">
                        <span
                          className={
                            (a.delta_cents ?? 0) > 0
                              ? 'tabular-nums text-emerald-300'
                              : 'tabular-nums text-slate-500'
                          }
                        >
                          {money(a.delta_cents)}
                          {(a.delta_cents ?? 0) > 0 && (
                            <span className="ml-1 text-xs text-slate-500">
                              (+{deltaPct.toFixed(1)}%)
                            </span>
                          )}
                        </span>
                      </TD>
                      <TD className="max-w-xs text-xs text-slate-400">{a.rationale ?? '—'}</TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function SensitivityChart({ points }: { points: SensitivityPoint[] }) {
  const norm = points
    .map((p) => ({
      budget: p.budget_cents != null ? p.budget_cents / 100 : (p.budget ?? 0),
      gap: p.residual_gap_pct ?? p.residual_gap ?? 0,
    }))
    .sort((a, b) => a.budget - b.budget)

  const w = 640
  const h = 220
  const padL = 48
  const padB = 32
  const padT = 16
  const padR = 16

  const maxBudget = Math.max(...norm.map((p) => p.budget), 1)
  const maxGap = Math.max(...norm.map((p) => Math.abs(p.gap)), 1)

  const x = (b: number) => padL + (b / maxBudget) * (w - padL - padR)
  const y = (g: number) => padT + (1 - Math.abs(g) / maxGap) * (h - padT - padB)

  const path = norm.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.budget)} ${y(p.gap)}`).join(' ')
  const area =
    norm.length > 1
      ? `${path} L ${x(norm[norm.length - 1].budget)} ${h - padB} L ${x(norm[0].budget)} ${h - padB} Z`
      : ''

  const gridGaps = [0, 0.25, 0.5, 0.75, 1].map((f) => maxGap * f)

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full min-w-[480px]" role="img">
        <defs>
          <linearGradient id="sensFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(167 139 250)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="rgb(167 139 250)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridGaps.map((g, i) => (
          <g key={i}>
            <line
              x1={padL}
              x2={w - padR}
              y1={y(g)}
              y2={y(g)}
              stroke="rgb(30 41 59)"
              strokeWidth="1"
            />
            <text x={4} y={y(g) + 4} fill="rgb(100 116 139)" fontSize="10">
              {g.toFixed(1)}%
            </text>
          </g>
        ))}
        {area && <path d={area} fill="url(#sensFill)" />}
        <path d={path} fill="none" stroke="rgb(167 139 250)" strokeWidth="2.5" />
        {norm.map((p, i) => (
          <g key={i}>
            <circle cx={x(p.budget)} cy={y(p.gap)} r="3.5" fill="rgb(196 181 253)" />
          </g>
        ))}
        {norm.map((p, i) => {
          if (i % Math.ceil(norm.length / 6 || 1) !== 0 && i !== norm.length - 1) return null
          return (
            <text
              key={`xl-${i}`}
              x={x(p.budget)}
              y={h - padB + 16}
              fill="rgb(100 116 139)"
              fontSize="10"
              textAnchor="middle"
            >
              {p.budget >= 1000 ? `$${Math.round(p.budget / 1000)}k` : `$${Math.round(p.budget)}`}
            </text>
          )
        })}
      </svg>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>Budget spent →</span>
        <span>↑ residual unexplained gap</span>
      </div>
    </div>
  )
}

const inputCls =
  'rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-violet-500 focus:outline-none'
