'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { authClient } from '@/lib/auth/client'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Dataset {
  id: string
  version?: number | string
  label?: string
  status?: string
  row_count?: number
}

interface BandSet {
  id: string
  version?: number | string
  label?: string
  status?: string
}

interface GapRunSummary {
  largest_unexplained_pct?: number
  largest_raw_pct?: number
  cohorts_analyzed?: number
  flagged?: number
  [k: string]: unknown
}

interface GapRun {
  id: string
  dataset_id: string
  band_set_id: string | null
  reference_group: string | null
  summary: GapRunSummary | null
  status: string
  created_by?: string
  created_at: string
}

const DIMENSIONS = [
  { key: 'gender', label: 'Gender' },
  { key: 'ethnicity', label: 'Ethnicity' },
  { key: 'geo', label: 'Geography' },
  { key: 'level', label: 'Level' },
  { key: 'role_family', label: 'Role family' },
]

function pct(v: unknown): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  const n = Number(v)
  return `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
}

function statusTone(status: string): 'green' | 'amber' | 'rose' | 'neutral' {
  switch (status) {
    case 'complete':
    case 'completed':
    case 'done':
      return 'green'
    case 'running':
    case 'pending':
      return 'amber'
    case 'failed':
    case 'error':
      return 'rose'
    default:
      return 'neutral'
  }
}

function gapTone(v: unknown): 'rose' | 'amber' | 'green' {
  const n = Math.abs(Number(v ?? 0))
  if (n >= 5) return 'rose'
  if (n >= 2) return 'amber'
  return 'green'
}

export default function GapRunsPage() {
  const router = useRouter()
  const [runs, setRuns] = useState<GapRun[]>([])
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [bandSets, setBandSets] = useState<BandSet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  // Launch form state
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)
  const [datasetId, setDatasetId] = useState('')
  const [bandSetId, setBandSetId] = useState('')
  const [dims, setDims] = useState<string[]>(['gender'])
  const [refGroup, setRefGroup] = useState('')
  const [label, setLabel] = useState('')

  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<GapRun | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [r, d, b] = await Promise.all([
        api.getGapRuns(),
        api.getDatasets().catch(() => []),
        api.getBandSets().catch(() => []),
      ])
      setRuns(Array.isArray(r) ? r : [])
      setDatasets(Array.isArray(d) ? d : [])
      setBandSets(Array.isArray(b) ? b : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load gap runs')
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
  }, [])

  function openForm() {
    setFormErr(null)
    setDatasetId(datasets[0]?.id ?? '')
    setBandSetId('')
    setDims(['gender'])
    setRefGroup('')
    setLabel('')
    setOpen(true)
  }

  function toggleDim(key: string) {
    setDims((prev) => (prev.includes(key) ? prev.filter((d) => d !== key) : [...prev, key]))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!datasetId) {
      setFormErr('Select a dataset to analyze.')
      return
    }
    if (dims.length === 0) {
      setFormErr('Select at least one dimension.')
      return
    }
    setSubmitting(true)
    setFormErr(null)
    try {
      const created = await api.createGapRun({
        dataset_id: datasetId,
        band_set_id: bandSetId || null,
        dimensions: dims,
        reference_group: refGroup || null,
        label: label || null,
      })
      setOpen(false)
      if (created && typeof created === 'object' && 'id' in created) {
        router.push(`/dashboard/gaps/${(created as GapRun).id}`)
      } else {
        load()
      }
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : 'Failed to launch analysis')
    } finally {
      setSubmitting(false)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeletingId(pendingDelete.id)
    try {
      await api.deleteGapRun(pendingDelete.id)
      setRuns((prev) => prev.filter((r) => r.id !== pendingDelete.id))
      setPendingDelete(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete run')
    } finally {
      setDeletingId(null)
    }
  }

  const datasetLabel = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of datasets) m.set(d.id, d.label || `v${d.version ?? '?'}`)
    return m
  }, [datasets])

  const bandSetLabel = useMemo(() => {
    const m = new Map<string, string>()
    for (const b of bandSets) m.set(b.id, b.label || `v${b.version ?? '?'}`)
    return m
  }, [bandSets])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return runs.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (!q) return true
      const hay = [
        r.reference_group ?? '',
        datasetLabel.get(r.dataset_id) ?? '',
        r.band_set_id ? bandSetLabel.get(r.band_set_id) ?? '' : '',
        r.status,
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [runs, search, statusFilter, datasetLabel, bandSetLabel])

  const statuses = useMemo(() => Array.from(new Set(runs.map((r) => r.status))).sort(), [runs])

  const kpis = useMemo(() => {
    const total = runs.length
    const flagged = runs.reduce((acc, r) => acc + Number(r.summary?.flagged ?? 0), 0)
    const worst = runs.reduce((max, r) => {
      const v = Math.abs(Number(r.summary?.largest_unexplained_pct ?? 0))
      return v > max ? v : max
    }, 0)
    return { total, flagged, worst }
  }, [runs])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Pay Gap Analysis</h1>
          <p className="mt-1 text-sm text-slate-400">
            Raw and regression-adjusted pay gaps with explained / unexplained decomposition.
          </p>
        </div>
        <Button onClick={openForm} disabled={loading}>
          + Launch analysis
        </Button>
      </div>

      {!loading && runs.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label="Gap runs" value={kpis.total} tone="violet" />
          <Stat label="Largest unexplained gap" value={pct(kpis.worst)} tone={kpis.worst >= 5 ? 'rose' : 'amber'} />
          <Stat label="Flagged cohorts" value={kpis.flagged} tone={kpis.flagged > 0 ? 'amber' : 'green'} />
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Runs</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search runs…"
              className="w-48 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-violet-500 focus:outline-none"
            >
              <option value="all">All statuses</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner label="Loading gap runs…" />
            </div>
          ) : error ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-rose-300">{error}</p>
              <Button variant="secondary" className="mt-4" onClick={load}>
                Retry
              </Button>
            </div>
          ) : runs.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No gap analyses yet"
                description="Launch your first analysis to measure raw and adjusted pay gaps across cohorts."
                icon={<span>📊</span>}
                action={<Button onClick={openForm}>Launch analysis</Button>}
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No runs match your filters" description="Adjust the search or status filter." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Reference group</TH>
                  <TH>Dataset</TH>
                  <TH>Band set</TH>
                  <TH className="text-right">Largest unexplained</TH>
                  <TH className="text-right">Flagged</TH>
                  <TH>Status</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((r) => (
                  <TR key={r.id} className="cursor-pointer">
                    <TD>
                      <Link href={`/dashboard/gaps/${r.id}`} className="font-medium text-violet-300 hover:text-violet-200">
                        {r.reference_group || 'Auto reference'}
                      </Link>
                    </TD>
                    <TD>{datasetLabel.get(r.dataset_id) ?? r.dataset_id.slice(0, 8)}</TD>
                    <TD>{r.band_set_id ? bandSetLabel.get(r.band_set_id) ?? r.band_set_id.slice(0, 8) : '—'}</TD>
                    <TD className="text-right">
                      <Badge tone={gapTone(r.summary?.largest_unexplained_pct)}>
                        {pct(r.summary?.largest_unexplained_pct)}
                      </Badge>
                    </TD>
                    <TD className="text-right">{r.summary?.flagged ?? 0}</TD>
                    <TD>
                      <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                    </TD>
                    <TD className="whitespace-nowrap text-slate-400">
                      {r.created_at ? new Date(r.created_at).toLocaleDateString() : '—'}
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Link href={`/dashboard/gaps/${r.id}`}>
                          <Button variant="ghost" className="px-2 py-1">
                            View
                          </Button>
                        </Link>
                        <Button
                          variant="danger"
                          className="px-2 py-1"
                          disabled={deletingId === r.id}
                          onClick={() => setPendingDelete(r)}
                        >
                          {deletingId === r.id ? '…' : 'Delete'}
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
        open={open}
        onClose={() => !submitting && setOpen(false)}
        title="Launch gap analysis"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? 'Running…' : 'Run analysis'}
            </Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-4">
          {formErr && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {formErr}
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Dataset</label>
            {datasets.length === 0 ? (
              <p className="text-sm text-amber-300">
                No datasets found.{' '}
                <Link href="/dashboard/datasets" className="underline">
                  Create one first.
                </Link>
              </p>
            ) : (
              <select
                value={datasetId}
                onChange={(e) => setDatasetId(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-violet-500 focus:outline-none"
              >
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {(d.label || `Version ${d.version ?? '?'}`) + (d.row_count != null ? ` · ${d.row_count} rows` : '')}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
              Band set (optional, enables compa-adjusted gaps)
            </label>
            <select
              value={bandSetId}
              onChange={(e) => setBandSetId(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-violet-500 focus:outline-none"
            >
              <option value="">None</option>
              {bandSets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label || `Version ${b.version ?? '?'}`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-400">
              Dimensions to analyze
            </label>
            <div className="flex flex-wrap gap-2">
              {DIMENSIONS.map((d) => {
                const active = dims.includes(d.key)
                return (
                  <button
                    type="button"
                    key={d.key}
                    onClick={() => toggleDim(d.key)}
                    className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                      active
                        ? 'border-violet-500/40 bg-violet-500/20 text-violet-200'
                        : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {d.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
              Reference group (optional)
            </label>
            <input
              value={refGroup}
              onChange={(e) => setRefGroup(e.target.value)}
              placeholder="e.g. male, or leave blank for largest group"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
              Label (optional)
            </label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Q2 2026 pay equity audit"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
            />
          </div>
        </form>
      </Modal>

      <Modal
        open={pendingDelete !== null}
        onClose={() => deletingId === null && setPendingDelete(null)}
        title="Delete gap run"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)} disabled={deletingId !== null}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deletingId !== null}>
              {deletingId !== null ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          This permanently deletes the gap run
          {pendingDelete?.reference_group ? ` for “${pendingDelete.reference_group}”` : ''} and all of its results. This
          cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
