'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface GapByCohort {
  cohort_key?: string
  cohort?: string
  label?: string
  dimension?: string
  raw_gap_pct?: number
  adjusted_gap_pct?: number
  unexplained_pct?: number
  group_size?: number
  [k: string]: unknown
}

interface CompaBucket {
  label?: string
  bucket?: string
  range?: string
  min?: number
  max?: number
  count?: number
  [k: string]: unknown
}

interface BudgetPoint {
  label?: string
  period?: string
  date?: string
  budget_cents?: number
  budget?: number
  spend_cents?: number
  amount?: number
  [k: string]: unknown
}

interface Analytics {
  gapByCohort?: GapByCohort[]
  compaDistribution?: CompaBucket[]
  budgetTrend?: BudgetPoint[]
  [k: string]: unknown
}

interface Guardrail {
  id: string
  rule_type: string
  threshold: number
  action: string
  enabled: boolean
  created_at: string
}

const RULE_TYPES = [
  { value: 'max_unexplained_gap', label: 'Max unexplained gap %' },
  { value: 'min_compa_ratio', label: 'Min compa-ratio' },
  { value: 'max_compa_ratio', label: 'Max compa-ratio' },
  { value: 'max_range_penetration', label: 'Max range penetration %' },
  { value: 'max_offer_premium', label: 'Max offer premium %' },
]

const ACTIONS = [
  { value: 'warn', label: 'Warn' },
  { value: 'block', label: 'Block' },
  { value: 'require_approval', label: 'Require approval' },
]

const inputCls =
  'w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-orange-500 focus:outline-none'

function ruleLabel(t: string): string {
  return RULE_TYPES.find((r) => r.value === t)?.label ?? t
}
function actionTone(a: string): 'rose' | 'amber' | 'violet' | 'neutral' {
  if (a === 'block') return 'rose'
  if (a === 'require_approval') return 'amber'
  if (a === 'warn') return 'violet'
  return 'neutral'
}
function gapTone(v: number): 'green' | 'amber' | 'rose' {
  const a = Math.abs(v)
  if (a < 1) return 'green'
  if (a < 3) return 'amber'
  return 'rose'
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

export default function AnalyticsPage() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [guardrails, setGuardrails] = useState<Guardrail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Guardrail | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({
    rule_type: RULE_TYPES[0].value,
    threshold: '',
    action: ACTIONS[0].value,
    enabled: true,
  })
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [an, gr] = await Promise.all([
        api.getDashboardAnalytics(),
        api.getGuardrails().catch(() => []),
      ])
      setAnalytics(an ?? {})
      setGuardrails(asArray<Guardrail>(gr))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analytics')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const gapByCohort = useMemo(
    () => asArray<GapByCohort>(analytics?.gapByCohort),
    [analytics],
  )
  const compaDistribution = useMemo(
    () => asArray<CompaBucket>(analytics?.compaDistribution),
    [analytics],
  )
  const budgetTrend = useMemo(
    () => asArray<BudgetPoint>(analytics?.budgetTrend),
    [analytics],
  )

  const kpis = useMemo(() => {
    const maxGap = gapByCohort.reduce(
      (m, g) => Math.max(m, Math.abs(g.unexplained_pct ?? g.adjusted_gap_pct ?? g.raw_gap_pct ?? 0)),
      0,
    )
    const totalHeadcount = compaDistribution.reduce((s, b) => s + (b.count ?? 0), 0)
    const activeRules = guardrails.filter((g) => g.enabled).length
    const lastBudget = budgetTrend.length
      ? (budgetTrend[budgetTrend.length - 1].budget_cents ??
          (budgetTrend[budgetTrend.length - 1].budget ?? 0) * 100) / 100
      : 0
    return { maxGap, totalHeadcount, activeRules, lastBudget }
  }, [gapByCohort, compaDistribution, guardrails, budgetTrend])

  function openCreate() {
    setEditing(null)
    setForm({ rule_type: RULE_TYPES[0].value, threshold: '', action: ACTIONS[0].value, enabled: true })
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(g: Guardrail) {
    setEditing(g)
    setForm({
      rule_type: g.rule_type,
      threshold: String(g.threshold),
      action: g.action,
      enabled: g.enabled,
    })
    setFormError(null)
    setModalOpen(true)
  }

  async function submit() {
    setFormError(null)
    const t = Number(form.threshold)
    if (!Number.isFinite(t)) {
      setFormError('Enter a valid threshold')
      return
    }
    setSubmitting(true)
    try {
      if (editing) {
        await api.updateGuardrail(editing.id, {
          rule_type: form.rule_type,
          threshold: t,
          action: form.action,
          enabled: form.enabled,
        })
      } else {
        await api.createGuardrail({
          rule_type: form.rule_type,
          threshold: t,
          action: form.action,
          enabled: form.enabled,
        })
      }
      setModalOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save rule')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleEnabled(g: Guardrail) {
    setBusy(g.id)
    try {
      await api.updateGuardrail(g.id, { enabled: !g.enabled })
      setGuardrails((prev) =>
        prev.map((x) => (x.id === g.id ? { ...x, enabled: !g.enabled } : x)),
      )
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to toggle rule')
    } finally {
      setBusy(null)
    }
  }

  async function remove(g: Guardrail) {
    if (!confirm('Delete this guardrail rule?')) return
    setBusy(g.id)
    try {
      await api.deleteGuardrail(g.id)
      setGuardrails((prev) => prev.filter((x) => x.id !== g.id))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete rule')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">Analytics</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Pay-gap by cohort, compa-ratio distribution, remediation budget trend, and policy guardrails.
          </p>
        </div>
        <Button variant="secondary" onClick={load} disabled={loading}>
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-24">
          <Spinner label="Loading analytics..." />
        </div>
      ) : error ? (
        <Card>
          <CardBody>
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-rose-300">{error}</p>
              <Button variant="secondary" onClick={load}>
                Retry
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat
              label="Largest unexplained gap"
              value={`${kpis.maxGap.toFixed(1)}%`}
              tone={kpis.maxGap >= 3 ? 'rose' : kpis.maxGap >= 1 ? 'amber' : 'green'}
            />
            <Stat label="Population analyzed" value={kpis.totalHeadcount.toLocaleString()} tone="violet" />
            <Stat label="Active guardrails" value={kpis.activeRules} />
            <Stat
              label="Latest remediation budget"
              value={kpis.lastBudget.toLocaleString(undefined, {
                style: 'currency',
                currency: 'USD',
                maximumFractionDigits: 0,
              })}
            />
          </div>

          {/* Gap by cohort */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-neutral-200">Gap by cohort</h2>
              <p className="mt-1 text-xs text-neutral-500">
                Unexplained pay gap per cohort after controlling for legitimate factors.
              </p>
            </CardHeader>
            <CardBody>
              {gapByCohort.length === 0 ? (
                <EmptyState
                  title="No gap data"
                  description="Run a gap analysis to populate cohort-level findings."
                  icon="📊"
                />
              ) : (
                <div className="space-y-3">
                  {gapByCohort.map((g, i) => {
                    const val = g.unexplained_pct ?? g.adjusted_gap_pct ?? g.raw_gap_pct ?? 0
                    const maxAbs = Math.max(
                      ...gapByCohort.map((x) =>
                        Math.abs(x.unexplained_pct ?? x.adjusted_gap_pct ?? x.raw_gap_pct ?? 0),
                      ),
                      1,
                    )
                    const widthPct = (Math.abs(val) / maxAbs) * 100
                    const tone = gapTone(val)
                    const barColor =
                      tone === 'rose' ? 'bg-rose-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-emerald-500'
                    const name = g.cohort_key ?? g.cohort ?? g.label ?? g.dimension ?? `Cohort ${i + 1}`
                    return (
                      <div key={`${name}-${i}`}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="text-neutral-300">
                            {name}
                            {g.dimension && (
                              <span className="ml-2 text-neutral-500">({g.dimension})</span>
                            )}
                            {g.group_size != null && (
                              <span className="ml-2 text-neutral-600">n={g.group_size}</span>
                            )}
                          </span>
                          <Badge tone={tone}>{val.toFixed(1)}%</Badge>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-800">
                          <div
                            className={`h-full rounded-full ${barColor}`}
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Compa distribution */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-neutral-200">Compa-ratio distribution</h2>
              <p className="mt-1 text-xs text-neutral-500">
                Headcount across compa-ratio buckets relative to band midpoint.
              </p>
            </CardHeader>
            <CardBody>
              {compaDistribution.length === 0 ? (
                <EmptyState
                  title="No distribution data"
                  description="Run the positioning engine to compute compa-ratios."
                  icon="📈"
                />
              ) : (
                <CompaHistogram buckets={compaDistribution} />
              )}
            </CardBody>
          </Card>

          {/* Budget trend */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-neutral-200">Remediation budget trend</h2>
              <p className="mt-1 text-xs text-neutral-500">
                Remediation spend committed over time across scenarios and merit cycles.
              </p>
            </CardHeader>
            <CardBody>
              {budgetTrend.length === 0 ? (
                <EmptyState
                  title="No budget trend"
                  description="Build scenarios or merit cycles to track remediation spend."
                  icon="💸"
                />
              ) : (
                <BudgetTrendChart points={budgetTrend} />
              )}
            </CardBody>
          </Card>

          {/* Guardrails */}
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-neutral-200">Guardrail rules</h2>
                <p className="mt-1 text-xs text-neutral-500">
                  Policy thresholds enforced on offers, positioning, and gaps.
                </p>
              </div>
              <Button onClick={openCreate}>+ New rule</Button>
            </CardHeader>
            <CardBody className="p-0">
              {guardrails.length === 0 ? (
                <div className="p-6">
                  <EmptyState
                    title="No guardrail rules"
                    description="Add a rule to flag offers and positions that breach equity policy."
                    icon="🛡️"
                    action={<Button onClick={openCreate}>Create first rule</Button>}
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Rule</TH>
                      <TH className="text-right">Threshold</TH>
                      <TH>Action</TH>
                      <TH>Status</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {guardrails.map((g) => (
                      <TR key={g.id}>
                        <TD className="font-medium text-neutral-200">{ruleLabel(g.rule_type)}</TD>
                        <TD className="text-right tabular-nums text-neutral-200">{g.threshold}</TD>
                        <TD>
                          <Badge tone={actionTone(g.action)}>{g.action}</Badge>
                        </TD>
                        <TD>
                          <Badge tone={g.enabled ? 'green' : 'neutral'}>
                            {g.enabled ? 'Enabled' : 'Disabled'}
                          </Badge>
                        </TD>
                        <TD className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="secondary"
                              className="px-3 py-1.5 text-xs"
                              disabled={busy === g.id}
                              onClick={() => toggleEnabled(g)}
                            >
                              {g.enabled ? 'Disable' : 'Enable'}
                            </Button>
                            <Button
                              variant="secondary"
                              className="px-3 py-1.5 text-xs"
                              onClick={() => openEdit(g)}
                            >
                              Edit
                            </Button>
                            <Button
                              variant="danger"
                              className="px-3 py-1.5 text-xs"
                              disabled={busy === g.id}
                              onClick={() => remove(g)}
                            >
                              {busy === g.id ? '...' : 'Delete'}
                            </Button>
                          </div>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardBody>
          </Card>
        </>
      )}

      <Modal
        open={modalOpen}
        onClose={() => !submitting && setModalOpen(false)}
        title={editing ? 'Edit guardrail rule' : 'New guardrail rule'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? 'Saving...' : editing ? 'Save changes' : 'Create rule'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
              Rule type
            </label>
            <select
              value={form.rule_type}
              onChange={(e) => setForm({ ...form, rule_type: e.target.value })}
              className={inputCls}
            >
              {RULE_TYPES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
                Threshold
              </label>
              <input
                type="number"
                step="0.01"
                value={form.threshold}
                onChange={(e) => setForm({ ...form, threshold: e.target.value })}
                placeholder="3"
                className={inputCls}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
                Action
              </label>
              <select
                value={form.action}
                onChange={(e) => setForm({ ...form, action: e.target.value })}
                className={inputCls}
              >
                {ACTIONS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="accent-orange-500"
            />
            Enabled
          </label>
          {formError && <p className="text-sm text-rose-300">{formError}</p>}
        </div>
      </Modal>
    </div>
  )
}

function CompaHistogram({ buckets }: { buckets: CompaBucket[] }) {
  const max = Math.max(...buckets.map((b) => b.count ?? 0), 1)
  return (
    <div className="flex items-end gap-2 overflow-x-auto pb-2" style={{ minHeight: 200 }}>
      {buckets.map((b, i) => {
        const count = b.count ?? 0
        const hPct = (count / max) * 100
        const label = b.label ?? b.bucket ?? b.range ?? (b.min != null ? `${b.min}` : `${i + 1}`)
        // center buckets (compa ~1.0) green, edges amber/rose
        const isCenter = label.includes('0.9') || label.includes('1.0') || label.includes('1.1')
        const color = isCenter ? 'bg-orange-500' : 'bg-neutral-600'
        return (
          <div key={`${label}-${i}`} className="flex min-w-[44px] flex-1 flex-col items-center gap-1">
            <span className="text-xs tabular-nums text-neutral-400">{count}</span>
            <div className="flex h-40 w-full items-end">
              <div
                className={`w-full rounded-t ${color}`}
                style={{ height: `${Math.max(hPct, count > 0 ? 4 : 0)}%` }}
                title={`${label}: ${count}`}
              />
            </div>
            <span className="text-[10px] text-neutral-500" style={{ writingMode: 'horizontal-tb' }}>
              {label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function BudgetTrendChart({ points }: { points: BudgetPoint[] }) {
  const norm = points.map((p, i) => ({
    label: p.label ?? p.period ?? p.date ?? `P${i + 1}`,
    value:
      p.budget_cents != null
        ? p.budget_cents / 100
        : p.spend_cents != null
          ? p.spend_cents / 100
          : (p.budget ?? p.amount ?? 0),
  }))

  const w = 640
  const h = 220
  const padL = 56
  const padB = 32
  const padT = 16
  const padR = 16

  const maxV = Math.max(...norm.map((p) => p.value), 1)
  const x = (i: number) =>
    padL + (norm.length <= 1 ? 0 : (i / (norm.length - 1)) * (w - padL - padR))
  const y = (v: number) => padT + (1 - v / maxV) * (h - padT - padB)

  const path = norm.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ')
  const area =
    norm.length > 1
      ? `${path} L ${x(norm.length - 1)} ${h - padB} L ${x(0)} ${h - padB} Z`
      : ''
  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((f) => maxV * f)

  const fmt = (v: number) =>
    v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${Math.round(v)}`

  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full min-w-[480px]" role="img">
        <defs>
          <linearGradient id="budgetFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(167 139 250)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="rgb(167 139 250)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridVals.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={y(v)} y2={y(v)} stroke="rgb(30 41 59)" strokeWidth="1" />
            <text x={4} y={y(v) + 4} fill="rgb(100 116 139)" fontSize="10">
              {fmt(v)}
            </text>
          </g>
        ))}
        {area && <path d={area} fill="url(#budgetFill)" />}
        <path d={path} fill="none" stroke="rgb(167 139 250)" strokeWidth="2.5" />
        {norm.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.value)} r="3.5" fill="rgb(196 181 253)" />
        ))}
        {norm.map((p, i) => {
          if (i % Math.ceil(norm.length / 6 || 1) !== 0 && i !== norm.length - 1) return null
          return (
            <text
              key={`xl-${i}`}
              x={x(i)}
              y={h - padB + 16}
              fill="rgb(100 116 139)"
              fontSize="10"
              textAnchor="middle"
            >
              {p.label}
            </text>
          )
        })}
      </svg>
    </div>
  )
}
