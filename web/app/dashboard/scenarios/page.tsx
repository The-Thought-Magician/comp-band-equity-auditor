'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Scenario {
  id: string
  name: string
  target_type: string
  total_budget_cents: number | null
  headcount_affected: number | null
  residual_gap_pct: number | null
  status: string
  dataset_id: string
  band_set_id: string
  created_at: string
}

interface Dataset {
  id: string
  label: string
  version: number | string
}

interface BandSet {
  id: string
  label: string
  version: number | string
  status: string
}

interface CompareRow {
  id?: string
  scenario_id?: string
  name?: string
  target_type?: string
  total_budget_cents?: number | null
  headcount_affected?: number | null
  residual_gap_pct?: number | null
  [k: string]: unknown
}

const TARGET_TYPES = [
  { value: 'close_unexplained_gap', label: 'Close unexplained gap' },
  { value: 'bring_to_band_min', label: 'Bring below-min to band minimum' },
  { value: 'budget_cap', label: 'Distribute fixed budget' },
  { value: 'compa_floor', label: 'Lift everyone to a compa floor' },
]

function money(cents: number | null | undefined): string {
  if (cents == null) return '—'
  const dollars = cents / 100
  return dollars.toLocaleString(undefined, {
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

function statusTone(s: string): 'violet' | 'green' | 'neutral' {
  if (s === 'applied' || s === 'completed') return 'green'
  if (s === 'draft') return 'neutral'
  return 'violet'
}

export default function ScenariosPage() {
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [bandSets, setBandSets] = useState<BandSet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [targetFilter, setTargetFilter] = useState('')

  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    dataset_id: '',
    band_set_id: '',
    target_type: TARGET_TYPES[0].value,
    total_budget: '',
    max_increase_pct: '',
  })

  const [compareOpen, setCompareOpen] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [compareRows, setCompareRows] = useState<CompareRow[]>([])
  const [compareError, setCompareError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [sc, ds, bs] = await Promise.all([
        api.getScenarios(),
        api.getDatasets().catch(() => []),
        api.getBandSets().catch(() => []),
      ])
      setScenarios(Array.isArray(sc) ? sc : [])
      setDatasets(Array.isArray(ds) ? ds : [])
      setBandSets(Array.isArray(bs) ? bs : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load scenarios')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    return scenarios.filter((s) => {
      if (targetFilter && s.target_type !== targetFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!(`${s.name} ${s.target_type} ${s.status}`.toLowerCase().includes(q))) return false
      }
      return true
    })
  }, [scenarios, targetFilter, search])

  const totals = useMemo(() => {
    const budget = scenarios.reduce((a, s) => a + (s.total_budget_cents || 0), 0)
    const headcount = scenarios.reduce((a, s) => a + (s.headcount_affected || 0), 0)
    const residuals = scenarios.map((s) => s.residual_gap_pct).filter((v): v is number => v != null)
    const bestResidual = residuals.length ? Math.min(...residuals.map(Math.abs)) : null
    return { budget, headcount, bestResidual, count: scenarios.length }
  }, [scenarios])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map((s) => s.id)))
  }

  function resetForm() {
    setForm({
      name: '',
      dataset_id: datasets[0]?.id ?? '',
      band_set_id: bandSets[0]?.id ?? '',
      target_type: TARGET_TYPES[0].value,
      total_budget: '',
      max_increase_pct: '',
    })
    setCreateError(null)
  }

  function openCreate() {
    resetForm()
    setCreateOpen(true)
  }

  async function submitCreate() {
    if (!form.name.trim()) {
      setCreateError('Name is required')
      return
    }
    if (!form.dataset_id || !form.band_set_id) {
      setCreateError('Select a dataset and band set')
      return
    }
    setCreating(true)
    setCreateError(null)
    const constraints: Record<string, unknown> = {}
    if (form.max_increase_pct) constraints.max_increase_pct = Number(form.max_increase_pct)
    try {
      await api.createScenario({
        name: form.name.trim(),
        dataset_id: form.dataset_id,
        band_set_id: form.band_set_id,
        target_type: form.target_type,
        total_budget_cents: form.total_budget
          ? Math.round(Number(form.total_budget) * 100)
          : null,
        constraints,
      })
      setCreateOpen(false)
      await load()
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create scenario')
    } finally {
      setCreating(false)
    }
  }

  async function runCompare() {
    if (selected.size < 2) return
    setCompareOpen(true)
    setComparing(true)
    setCompareError(null)
    setCompareRows([])
    try {
      const ids = Array.from(selected).join(',')
      const res = await api.compareScenarios({ ids })
      const rows: CompareRow[] = Array.isArray(res)
        ? res
        : Array.isArray(res?.rows)
          ? res.rows
          : []
      setCompareRows(rows)
    } catch (e) {
      setCompareError(e instanceof Error ? e.message : 'Failed to compare scenarios')
    } finally {
      setComparing(false)
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Delete scenario "${name}"? This removes all its adjustments.`)) return
    try {
      await api.deleteScenario(id)
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete scenario')
    }
  }

  const targetLabel = (t: string) => TARGET_TYPES.find((x) => x.value === t)?.label ?? t

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">Remediation Scenarios</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Model what-if pay adjustments, see budget impact, and compare options side by side.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={runCompare}
            disabled={selected.size < 2}
            title={selected.size < 2 ? 'Select at least 2 scenarios' : 'Compare selected'}
          >
            Compare ({selected.size})
          </Button>
          <Button onClick={openCreate}>+ New what-if</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Scenarios" value={totals.count} tone="violet" />
        <Stat label="Total modeled budget" value={money(totals.budget)} />
        <Stat label="Headcount affected" value={totals.headcount.toLocaleString()} />
        <Stat
          label="Best residual gap"
          value={totals.bestResidual == null ? '—' : pct(totals.bestResidual)}
          tone={statTone(gapTone(totals.bestResidual))}
        />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search scenarios..."
              className="w-56 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-orange-500 focus:outline-none"
            />
            <select
              value={targetFilter}
              onChange={(e) => setTargetFilter(e.target.value)}
              className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
            >
              <option value="">All targets</option>
              {TARGET_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <span className="text-xs text-neutral-500">
            {filtered.length} of {scenarios.length}
          </span>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="flex justify-center py-16">
              <Spinner label="Loading scenarios..." />
            </div>
          ) : error ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm text-rose-300">{error}</p>
              <Button variant="secondary" className="mt-4" onClick={load}>
                Retry
              </Button>
            </div>
          ) : scenarios.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No scenarios yet"
                description="Build a what-if to model pay adjustments against a dataset and band set."
                icon="◇"
                action={<Button onClick={openCreate}>+ New what-if</Button>}
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No matches" description="Adjust your search or target filter." icon="∅" />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH className="w-10">
                    <input
                      type="checkbox"
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onChange={toggleAll}
                      aria-label="Select all"
                      className="accent-orange-500"
                    />
                  </TH>
                  <TH>Name</TH>
                  <TH>Target</TH>
                  <TH className="text-right">Budget</TH>
                  <TH className="text-right">Headcount</TH>
                  <TH className="text-right">Residual gap</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((s) => (
                  <TR key={s.id}>
                    <TD>
                      <input
                        type="checkbox"
                        checked={selected.has(s.id)}
                        onChange={() => toggle(s.id)}
                        aria-label={`Select ${s.name}`}
                        className="accent-orange-500"
                      />
                    </TD>
                    <TD>
                      <Link
                        href={`/dashboard/scenarios/${s.id}`}
                        className="font-medium text-orange-300 hover:text-orange-200"
                      >
                        {s.name}
                      </Link>
                    </TD>
                    <TD className="text-neutral-400">{targetLabel(s.target_type)}</TD>
                    <TD className="text-right tabular-nums">{money(s.total_budget_cents)}</TD>
                    <TD className="text-right tabular-nums">
                      {s.headcount_affected ?? '—'}
                    </TD>
                    <TD className="text-right">
                      <Badge tone={gapTone(s.residual_gap_pct)}>{pct(s.residual_gap_pct)}</Badge>
                    </TD>
                    <TD>
                      <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Link href={`/dashboard/scenarios/${s.id}`}>
                          <Button variant="ghost" className="px-2 py-1">
                            Open
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          className="px-2 py-1 text-rose-300 hover:text-rose-200"
                          onClick={() => remove(s.id, s.name)}
                        >
                          Delete
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

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New what-if scenario"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={creating}>
              {creating ? <Spinner label="Building..." /> : 'Build scenario'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Scenario name">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Close gender gap Q3"
              className={inputCls}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Dataset">
              <select
                value={form.dataset_id}
                onChange={(e) => setForm({ ...form, dataset_id: e.target.value })}
                className={inputCls}
              >
                <option value="">Select dataset</option>
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label} (v{d.version})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Band set">
              <select
                value={form.band_set_id}
                onChange={(e) => setForm({ ...form, band_set_id: e.target.value })}
                className={inputCls}
              >
                <option value="">Select band set</option>
                {bandSets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label} (v{b.version})
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Remediation target">
            <select
              value={form.target_type}
              onChange={(e) => setForm({ ...form, target_type: e.target.value })}
              className={inputCls}
            >
              {TARGET_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Total budget (USD)" hint="Optional cap">
              <input
                type="number"
                min="0"
                value={form.total_budget}
                onChange={(e) => setForm({ ...form, total_budget: e.target.value })}
                placeholder="250000"
                className={inputCls}
              />
            </Field>
            <Field label="Max increase %" hint="Per-person constraint">
              <input
                type="number"
                min="0"
                value={form.max_increase_pct}
                onChange={(e) => setForm({ ...form, max_increase_pct: e.target.value })}
                placeholder="15"
                className={inputCls}
              />
            </Field>
          </div>
          {(datasets.length === 0 || bandSets.length === 0) && (
            <p className="text-xs text-amber-300">
              You need at least one dataset and one band set before building a scenario.
            </p>
          )}
          {createError && <p className="text-sm text-rose-300">{createError}</p>}
        </div>
      </Modal>

      <Modal
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        title="Scenario comparison"
        className="max-w-3xl"
        footer={
          <Button variant="secondary" onClick={() => setCompareOpen(false)}>
            Close
          </Button>
        }
      >
        {comparing ? (
          <div className="flex justify-center py-10">
            <Spinner label="Comparing..." />
          </div>
        ) : compareError ? (
          <p className="text-sm text-rose-300">{compareError}</p>
        ) : compareRows.length === 0 ? (
          <p className="text-sm text-neutral-400">No comparison data returned.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Scenario</TH>
                <TH>Target</TH>
                <TH className="text-right">Budget</TH>
                <TH className="text-right">Headcount</TH>
                <TH className="text-right">Residual gap</TH>
              </TR>
            </THead>
            <TBody>
              {compareRows.map((r, i) => (
                <TR key={r.id ?? r.scenario_id ?? i}>
                  <TD className="font-medium text-neutral-200">{r.name ?? r.scenario_id ?? '—'}</TD>
                  <TD className="text-neutral-400">
                    {r.target_type ? targetLabel(r.target_type) : '—'}
                  </TD>
                  <TD className="text-right tabular-nums">{money(r.total_budget_cents)}</TD>
                  <TD className="text-right tabular-nums">{r.headcount_affected ?? '—'}</TD>
                  <TD className="text-right">
                    <Badge tone={gapTone(r.residual_gap_pct)}>{pct(r.residual_gap_pct)}</Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Modal>
    </div>
  )
}

const inputCls =
  'w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-orange-500 focus:outline-none'

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-xs font-medium text-neutral-400">
        {label}
        {hint && <span className="font-normal text-neutral-600">{hint}</span>}
      </span>
      {children}
    </label>
  )
}
