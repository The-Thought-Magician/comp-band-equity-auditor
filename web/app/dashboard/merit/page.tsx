'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface MeritCycle {
  id: string
  name: string
  dataset_id: string | null
  band_set_id: string | null
  budget_cents: number
  model: string
  status: string
  summary: Record<string, unknown> | null
  created_at: string
}

interface Dataset {
  id: string
  version: number | string
  label: string
}

interface BandSet {
  id: string
  version: number | string
  label: string
  status: string
}

const MODELS = [
  { value: 'merit_matrix', label: 'Merit Matrix (perf x positioning)' },
  { value: 'equal_pct', label: 'Equal Percentage' },
  { value: 'compa_target', label: 'Compa-Ratio Convergence' },
  { value: 'performance', label: 'Performance Weighted' },
]

function fmtMoney(cents: number): string {
  const v = (cents ?? 0) / 100
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function statusTone(status: string): 'neutral' | 'violet' | 'green' | 'amber' {
  if (status === 'locked') return 'green'
  if (status === 'draft') return 'amber'
  return 'violet'
}

function modelLabel(model: string): string {
  return MODELS.find((m) => m.value === model)?.label ?? model
}

export default function MeritCyclesPage() {
  const [cycles, setCycles] = useState<MeritCycle[]>([])
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [bandSets, setBandSets] = useState<BandSet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [modelFilter, setModelFilter] = useState<string>('all')

  const [createOpen, setCreateOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '',
    dataset_id: '',
    band_set_id: '',
    budget: '',
    model: MODELS[0].value,
  })

  const [deleting, setDeleting] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [cy, ds, bs] = await Promise.all([
        api.getMeritCycles(),
        api.getDatasets().catch(() => []),
        api.getBandSets().catch(() => []),
      ])
      setCycles(Array.isArray(cy) ? cy : [])
      setDatasets(Array.isArray(ds) ? ds : [])
      setBandSets(Array.isArray(bs) ? bs : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load merit cycles')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return cycles.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false
      if (modelFilter !== 'all' && c.model !== modelFilter) return false
      if (q && !c.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [cycles, search, statusFilter, modelFilter])

  const totals = useMemo(() => {
    const totalBudget = cycles.reduce((s, c) => s + (c.budget_cents ?? 0), 0)
    const locked = cycles.filter((c) => c.status === 'locked').length
    const draft = cycles.filter((c) => c.status !== 'locked').length
    return { count: cycles.length, totalBudget, locked, draft }
  }, [cycles])

  function openCreate() {
    setForm({
      name: '',
      dataset_id: datasets[0]?.id ?? '',
      band_set_id: bandSets[0]?.id ?? '',
      budget: '',
      model: MODELS[0].value,
    })
    setFormError(null)
    setCreateOpen(true)
  }

  async function submitCreate() {
    setFormError(null)
    if (!form.name.trim()) {
      setFormError('Cycle name is required')
      return
    }
    if (!form.dataset_id) {
      setFormError('Select a dataset')
      return
    }
    if (!form.band_set_id) {
      setFormError('Select a band set')
      return
    }
    const budgetNum = Number(form.budget)
    if (!Number.isFinite(budgetNum) || budgetNum <= 0) {
      setFormError('Enter a valid budget amount')
      return
    }
    setSubmitting(true)
    try {
      await api.createMeritCycle({
        name: form.name.trim(),
        dataset_id: form.dataset_id,
        band_set_id: form.band_set_id,
        budget_cents: Math.round(budgetNum * 100),
        model: form.model,
      })
      setCreateOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create cycle')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this merit cycle and all its allocations?')) return
    setDeleting(id)
    try {
      await api.deleteMeritCycle(id)
      setCycles((prev) => prev.filter((c) => c.id !== id))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete cycle')
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">Merit Cycles</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Model annual increase budgets, compute per-employee allocations, and lock a cycle for payout.
          </p>
        </div>
        <Button onClick={openCreate} disabled={loading}>
          + New Cycle
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Cycles" value={totals.count} />
        <Stat label="Total Budget" value={fmtMoney(totals.totalBudget)} tone="violet" />
        <Stat label="Locked" value={totals.locked} tone="green" />
        <Stat label="In Draft" value={totals.draft} tone="amber" />
      </div>

      <Card>
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search cycles..."
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-orange-500 focus:outline-none sm:max-w-xs"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="locked">Locked</option>
          </select>
          <select
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
            className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
          >
            <option value="all">All models</option>
            {MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <div className="text-xs text-neutral-500 sm:ml-auto">
            {filtered.length} of {cycles.length}
          </div>
        </CardBody>
      </Card>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner label="Loading merit cycles..." />
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
      ) : cycles.length === 0 ? (
        <EmptyState
          title="No merit cycles yet"
          description="Create a cycle to model annual merit increases against your latest dataset and band set."
          icon="💰"
          action={<Button onClick={openCreate}>Create your first cycle</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No cycles match your filters"
          description="Try clearing the search or status filter."
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setSearch('')
                setStatusFilter('all')
                setModelFilter('all')
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Cycle</TH>
              <TH>Model</TH>
              <TH className="text-right">Budget</TH>
              <TH>Status</TH>
              <TH>Created</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((c) => (
              <TR key={c.id}>
                <TD>
                  <Link
                    href={`/dashboard/merit/${c.id}`}
                    className="font-medium text-orange-300 hover:text-orange-200 hover:underline"
                  >
                    {c.name}
                  </Link>
                </TD>
                <TD>
                  <span className="text-neutral-300">{modelLabel(c.model)}</span>
                </TD>
                <TD className="text-right font-mono text-neutral-200">{fmtMoney(c.budget_cents)}</TD>
                <TD>
                  <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                </TD>
                <TD>
                  <span className="text-neutral-400">
                    {c.created_at ? new Date(c.created_at).toLocaleDateString() : '—'}
                  </span>
                </TD>
                <TD className="text-right">
                  <div className="flex justify-end gap-2">
                    <Link href={`/dashboard/merit/${c.id}`}>
                      <Button variant="secondary" className="px-3 py-1.5 text-xs">
                        Open
                      </Button>
                    </Link>
                    <Button
                      variant="danger"
                      className="px-3 py-1.5 text-xs"
                      disabled={deleting === c.id}
                      onClick={() => handleDelete(c.id)}
                    >
                      {deleting === c.id ? '...' : 'Delete'}
                    </Button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Modal
        open={createOpen}
        onClose={() => !submitting && setCreateOpen(false)}
        title="New Merit Cycle"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={submitting}>
              {submitting ? 'Computing...' : 'Create & Allocate'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
              Cycle name
            </label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="FY26 Annual Merit"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-orange-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
                Dataset
              </label>
              <select
                value={form.dataset_id}
                onChange={(e) => setForm({ ...form, dataset_id: e.target.value })}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
              >
                <option value="">Select dataset</option>
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label || `v${d.version}`} (v{d.version})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
                Band set
              </label>
              <select
                value={form.band_set_id}
                onChange={(e) => setForm({ ...form, band_set_id: e.target.value })}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
              >
                <option value="">Select band set</option>
                {bandSets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label || `v${b.version}`} (v{b.version})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
                Budget (USD)
              </label>
              <input
                type="number"
                min={0}
                step={1000}
                value={form.budget}
                onChange={(e) => setForm({ ...form, budget: e.target.value })}
                placeholder="500000"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
                Allocation model
              </label>
              <select
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
              >
                {MODELS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {datasets.length === 0 && (
            <p className="text-xs text-amber-300">
              No datasets found. Upload a dataset before creating a cycle.
            </p>
          )}
          {formError && <p className="text-sm text-rose-300">{formError}</p>}
        </div>
      </Modal>
    </div>
  )
}
