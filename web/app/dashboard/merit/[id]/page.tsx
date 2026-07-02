'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Allocation {
  id: string
  employee_id: string
  employee_ref?: string | null
  employee_name?: string | null
  name?: string | null
  level?: string | null
  role_family?: string | null
  current_salary: number
  recommended_increase_cents: number
  final_increase_cents: number | null
  override_reason: string | null
  created_at?: string
}

interface MeritCycle {
  id: string
  name: string
  budget_cents: number
  model: string
  status: string
  summary: Record<string, unknown> | null
  created_at: string
  allocations?: Allocation[]
}

interface ModelCompareRow {
  model: string
  total_increase_cents?: number
  total_cents?: number
  budget_utilization_pct?: number
  utilization_pct?: number
  headcount?: number
  avg_increase_pct?: number
  residual_gap_pct?: number
  [k: string]: unknown
}

function fmtMoney(cents: number | null | undefined): string {
  const v = (cents ?? 0) / 100
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n.toFixed(digits)}%`
}

function allocFinal(a: Allocation): number {
  return a.final_increase_cents ?? a.recommended_increase_cents ?? 0
}

function increasePct(a: Allocation): number | null {
  const base = (a.current_salary ?? 0) * 100
  if (base <= 0) return null
  return (allocFinal(a) / base) * 100
}

function empName(a: Allocation): string {
  return a.employee_name || a.name || a.employee_ref || a.employee_id
}

export default function MeritCycleDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id as string

  const [cycle, setCycle] = useState<MeritCycle | null>(null)
  const [allocations, setAllocations] = useState<Allocation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [onlyOverrides, setOnlyOverrides] = useState(false)
  const [sortKey, setSortKey] = useState<'name' | 'salary' | 'final' | 'pct'>('final')

  const [editing, setEditing] = useState<Allocation | null>(null)
  const [editVal, setEditVal] = useState('')
  const [editReason, setEditReason] = useState('')
  const [savingOverride, setSavingOverride] = useState(false)
  const [overrideError, setOverrideError] = useState<string | null>(null)

  const [compareOpen, setCompareOpen] = useState(false)
  const [compareRows, setCompareRows] = useState<ModelCompareRow[]>([])
  const [comparing, setComparing] = useState(false)
  const [compareError, setCompareError] = useState<string | null>(null)

  const [locking, setLocking] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getMeritCycle(id)
      setCycle(data)
      setAllocations(Array.isArray(data?.allocations) ? data.allocations : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load merit cycle')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (id) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const locked = cycle?.status === 'locked'

  const totals = useMemo(() => {
    const totalFinal = allocations.reduce((s, a) => s + allocFinal(a), 0)
    const totalRec = allocations.reduce((s, a) => s + (a.recommended_increase_cents ?? 0), 0)
    const overrides = allocations.filter((a) => a.final_increase_cents != null && a.override_reason).length
    const budget = cycle?.budget_cents ?? 0
    const util = budget > 0 ? (totalFinal / budget) * 100 : 0
    return { totalFinal, totalRec, overrides, budget, util, headcount: allocations.length }
  }, [allocations, cycle])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = allocations.filter((a) => {
      if (onlyOverrides && !a.override_reason) return false
      if (q) {
        const hay = `${empName(a)} ${a.level ?? ''} ${a.role_family ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    const sorted = [...list].sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return empName(a).localeCompare(empName(b))
        case 'salary':
          return (b.current_salary ?? 0) - (a.current_salary ?? 0)
        case 'pct':
          return (increasePct(b) ?? -1) - (increasePct(a) ?? -1)
        case 'final':
        default:
          return allocFinal(b) - allocFinal(a)
      }
    })
    return sorted
  }, [allocations, search, onlyOverrides, sortKey])

  const maxFinal = useMemo(
    () => Math.max(1, ...allocations.map((a) => allocFinal(a))),
    [allocations],
  )

  function openEdit(a: Allocation) {
    setEditing(a)
    setEditVal(String((allocFinal(a) / 100).toFixed(0)))
    setEditReason(a.override_reason ?? '')
    setOverrideError(null)
  }

  async function saveOverride() {
    if (!editing) return
    setOverrideError(null)
    const num = Number(editVal)
    if (!Number.isFinite(num) || num < 0) {
      setOverrideError('Enter a valid increase amount')
      return
    }
    if (!editReason.trim()) {
      setOverrideError('A reason is required for overrides')
      return
    }
    setSavingOverride(true)
    try {
      const updated = await api.overrideMeritAllocation(id, editing.id, {
        final_increase_cents: Math.round(num * 100),
        override_reason: editReason.trim(),
      })
      setAllocations((prev) =>
        prev.map((a) =>
          a.id === editing.id
            ? {
                ...a,
                final_increase_cents: updated?.final_increase_cents ?? Math.round(num * 100),
                override_reason: updated?.override_reason ?? editReason.trim(),
              }
            : a,
        ),
      )
      setEditing(null)
    } catch (e) {
      setOverrideError(e instanceof Error ? e.message : 'Failed to save override')
    } finally {
      setSavingOverride(false)
    }
  }

  async function openCompare() {
    setCompareOpen(true)
    setComparing(true)
    setCompareError(null)
    try {
      const res = await api.compareMeritModels(id)
      const rows = Array.isArray(res?.models) ? res.models : Array.isArray(res) ? res : []
      setCompareRows(rows)
    } catch (e) {
      setCompareError(e instanceof Error ? e.message : 'Failed to compare models')
    } finally {
      setComparing(false)
    }
  }

  async function handleLock() {
    if (!confirm('Lock this cycle? Allocations become immutable and a post-cycle summary is snapshotted.')) return
    setLocking(true)
    try {
      const updated = await api.lockMeritCycle(id)
      setCycle((prev) => (prev ? { ...prev, status: updated?.status ?? 'locked', summary: updated?.summary ?? prev.summary } : prev))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to lock cycle')
    } finally {
      setLocking(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner label="Loading cycle..." />
      </div>
    )
  }

  if (error || !cycle) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/merit" className="text-sm text-orange-300 hover:underline">
          ← Back to cycles
        </Link>
        <Card>
          <CardBody>
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-sm text-rose-300">{error ?? 'Cycle not found'}</p>
              <Button variant="secondary" onClick={load}>
                Retry
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    )
  }

  const compareUtil = (r: ModelCompareRow) => r.budget_utilization_pct ?? r.utilization_pct
  const compareTotal = (r: ModelCompareRow) => r.total_increase_cents ?? r.total_cents

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3">
        <Link href="/dashboard/merit" className="text-sm text-orange-300 hover:underline">
          ← Back to cycles
        </Link>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-neutral-100">{cycle.name}</h1>
            <Badge tone={locked ? 'green' : 'amber'}>{cycle.status}</Badge>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={openCompare}>
              Compare models
            </Button>
            <Button onClick={handleLock} disabled={locked || locking}>
              {locked ? 'Locked' : locking ? 'Locking...' : 'Lock cycle'}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Stat label="Budget" value={fmtMoney(totals.budget)} />
        <Stat
          label="Allocated"
          value={fmtMoney(totals.totalFinal)}
          tone={totals.util > 100 ? 'rose' : 'violet'}
          hint={`${fmtPct(totals.util)} of budget`}
        />
        <Stat label="Headcount" value={totals.headcount} />
        <Stat label="Overrides" value={totals.overrides} tone={totals.overrides ? 'amber' : 'default'} />
        <Stat
          label="Recommended"
          value={fmtMoney(totals.totalRec)}
          hint="model baseline"
        />
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-200">Budget utilization</h2>
            <span className="text-xs text-neutral-500">
              {fmtMoney(totals.totalFinal)} / {fmtMoney(totals.budget)}
            </span>
          </div>
        </CardHeader>
        <CardBody>
          <div className="h-3 w-full overflow-hidden rounded-full bg-neutral-800">
            <div
              className={`h-full rounded-full ${totals.util > 100 ? 'bg-rose-500' : 'bg-orange-500'}`}
              style={{ width: `${Math.min(100, totals.util)}%` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-xs text-neutral-500">
            <span>{fmtPct(totals.util)} consumed</span>
            <span>
              {totals.util > 100 ? 'Over budget' : `${fmtMoney(totals.budget - totals.totalFinal)} remaining`}
            </span>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employees..."
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-orange-500 focus:outline-none sm:max-w-xs"
          />
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as typeof sortKey)}
            className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
          >
            <option value="final">Sort: Final increase</option>
            <option value="pct">Sort: Increase %</option>
            <option value="salary">Sort: Current salary</option>
            <option value="name">Sort: Name</option>
          </select>
          <label className="inline-flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={onlyOverrides}
              onChange={(e) => setOnlyOverrides(e.target.checked)}
              className="h-4 w-4 rounded border-neutral-600 bg-neutral-950 accent-orange-500"
            />
            Overrides only
          </label>
          <div className="text-xs text-neutral-500 sm:ml-auto">
            {filtered.length} of {allocations.length}
          </div>
        </CardBody>
      </Card>

      {allocations.length === 0 ? (
        <EmptyState
          title="No allocations"
          description="This cycle has no computed allocations. Verify the dataset and band set used to create it."
          icon="📊"
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Employee</TH>
              <TH>Level</TH>
              <TH className="text-right">Current salary</TH>
              <TH className="text-right">Recommended</TH>
              <TH className="text-right">Final increase</TH>
              <TH className="text-right">%</TH>
              <TH>Distribution</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((a) => {
              const overridden = a.final_increase_cents != null && !!a.override_reason
              const pct = increasePct(a)
              return (
                <TR key={a.id}>
                  <TD>
                    <div className="font-medium text-neutral-200">{empName(a)}</div>
                    {a.role_family && <div className="text-xs text-neutral-500">{a.role_family}</div>}
                  </TD>
                  <TD>{a.level ?? '—'}</TD>
                  <TD className="text-right font-mono">{fmtMoney((a.current_salary ?? 0) * 100)}</TD>
                  <TD className="text-right font-mono text-neutral-400">
                    {fmtMoney(a.recommended_increase_cents)}
                  </TD>
                  <TD className="text-right font-mono">
                    <span className={overridden ? 'text-amber-300' : 'text-neutral-200'}>
                      {fmtMoney(allocFinal(a))}
                    </span>
                    {overridden && (
                      <div className="text-[10px] uppercase tracking-wide text-amber-400/80">override</div>
                    )}
                  </TD>
                  <TD className="text-right font-mono text-neutral-300">{fmtPct(pct)}</TD>
                  <TD>
                    <div className="h-2 w-24 overflow-hidden rounded-full bg-neutral-800">
                      <div
                        className={`h-full rounded-full ${overridden ? 'bg-amber-400' : 'bg-orange-500'}`}
                        style={{ width: `${Math.max(2, (allocFinal(a) / maxFinal) * 100)}%` }}
                      />
                    </div>
                  </TD>
                  <TD className="text-right">
                    <Button
                      variant="secondary"
                      className="px-3 py-1.5 text-xs"
                      disabled={locked}
                      onClick={() => openEdit(a)}
                      title={locked ? 'Cycle is locked' : 'Override'}
                    >
                      Override
                    </Button>
                  </TD>
                </TR>
              )
            })}
          </TBody>
        </Table>
      )}

      {/* Override modal */}
      <Modal
        open={editing != null}
        onClose={() => !savingOverride && setEditing(null)}
        title={editing ? `Override — ${empName(editing)}` : 'Override'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={savingOverride}>
              Cancel
            </Button>
            <Button onClick={saveOverride} disabled={savingOverride}>
              {savingOverride ? 'Saving...' : 'Save override'}
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2">
                <div className="text-xs uppercase tracking-wide text-neutral-500">Current salary</div>
                <div className="font-mono text-neutral-200">{fmtMoney((editing.current_salary ?? 0) * 100)}</div>
              </div>
              <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2">
                <div className="text-xs uppercase tracking-wide text-neutral-500">Recommended</div>
                <div className="font-mono text-neutral-200">{fmtMoney(editing.recommended_increase_cents)}</div>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
                Final increase (USD)
              </label>
              <input
                type="number"
                min={0}
                step={100}
                value={editVal}
                onChange={(e) => setEditVal(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
                Override reason
              </label>
              <textarea
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                rows={3}
                placeholder="Why is this allocation being adjusted from the model recommendation?"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-orange-500 focus:outline-none"
              />
            </div>
            {overrideError && <p className="text-sm text-rose-300">{overrideError}</p>}
          </div>
        )}
      </Modal>

      {/* Model compare modal */}
      <Modal
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        title="Compare allocation models"
        className="max-w-2xl"
        footer={
          <Button variant="ghost" onClick={() => setCompareOpen(false)}>
            Close
          </Button>
        }
      >
        {comparing ? (
          <div className="flex justify-center py-8">
            <Spinner label="Running models..." />
          </div>
        ) : compareError ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-rose-300">{compareError}</p>
            <Button variant="secondary" onClick={openCompare}>
              Retry
            </Button>
          </div>
        ) : compareRows.length === 0 ? (
          <p className="py-6 text-center text-sm text-neutral-500">No comparison data returned.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Model</TH>
                <TH className="text-right">Total spend</TH>
                <TH className="text-right">Utilization</TH>
                <TH className="text-right">Residual gap</TH>
              </TR>
            </THead>
            <TBody>
              {compareRows.map((r, i) => (
                <TR key={`${r.model}-${i}`}>
                  <TD>
                    <span className={r.model === cycle.model ? 'font-semibold text-orange-300' : 'text-neutral-200'}>
                      {r.model}
                      {r.model === cycle.model && (
                        <span className="ml-2 text-[10px] uppercase text-orange-400">active</span>
                      )}
                    </span>
                  </TD>
                  <TD className="text-right font-mono">{fmtMoney(compareTotal(r))}</TD>
                  <TD className="text-right font-mono">{fmtPct(compareUtil(r))}</TD>
                  <TD className="text-right font-mono">{fmtPct(r.residual_gap_pct)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Modal>
    </div>
  )
}
