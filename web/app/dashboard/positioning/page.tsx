'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface EngineRun {
  id: string
  label?: string
  status?: string
  dataset_id?: string
  band_set_id?: string
  summary?: Record<string, unknown> | null
  created_at?: string
}

interface Dataset {
  id: string
  label?: string
  version?: number | string
}

interface BandSet {
  id: string
  label?: string
  version?: number | string
  status?: string
}

interface Positioning {
  id: string
  employee_id?: string
  band_id?: string | null
  compa_ratio?: number | null
  range_penetration?: number | null
  quartile?: number | string | null
  flags?: string[] | Record<string, unknown> | null
  base_salary_normalized?: number | null
  employee_name?: string
  level?: string
  geo?: string
}

interface DistBucket {
  label?: string
  range?: string
  min?: number
  max?: number
  count?: number
}

interface DistResult {
  buckets?: DistBucket[]
  stats?: Record<string, unknown>
}

function fmtRatio(n?: number | null): string {
  if (n == null) return '—'
  return n.toFixed(2)
}

function fmtPct(n?: number | null): string {
  if (n == null) return '—'
  // range_penetration may be 0..1 or 0..100; normalize display
  const v = n <= 1.5 ? n * 100 : n
  return `${v.toFixed(0)}%`
}

function compaTone(n?: number | null): 'rose' | 'amber' | 'green' | 'sky' | 'neutral' {
  if (n == null) return 'neutral'
  if (n < 0.8) return 'rose'
  if (n < 0.9) return 'amber'
  if (n > 1.2) return 'sky'
  return 'green'
}

function flagList(flags: Positioning['flags']): string[] {
  if (!flags) return []
  if (Array.isArray(flags)) return flags.map((f) => String(f))
  return Object.entries(flags)
    .filter(([, v]) => v === true || (typeof v === 'string' && v))
    .map(([k]) => k)
}

export default function PositioningPage() {
  const [runs, setRuns] = useState<EngineRun[]>([])
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [bandSets, setBandSets] = useState<BandSet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [selectedRunId, setSelectedRunId] = useState<string>('')
  const [runDetail, setRunDetail] = useState<EngineRun | null>(null)
  const [positionings, setPositionings] = useState<Positioning[]>([])
  const [dist, setDist] = useState<DistResult | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [flagFilter, setFlagFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  // create run modal
  const [createOpen, setCreateOpen] = useState(false)
  const [runForm, setRunForm] = useState({ dataset_id: '', band_set_id: '', label: '' })

  // delete
  const [deleteTarget, setDeleteTarget] = useState<EngineRun | null>(null)

  const loadBase = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [r, d, b] = await Promise.all([api.getEngineRuns(), api.getDatasets(), api.getBandSets()])
      const runList: EngineRun[] = Array.isArray(r) ? r : r?.runs ?? []
      setRuns(runList)
      setDatasets(Array.isArray(d) ? d : d?.datasets ?? [])
      setBandSets(Array.isArray(b) ? b : b?.bandSets ?? [])
      if (runList.length > 0 && !selectedRunId) {
        setSelectedRunId(runList[0].id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load engine runs')
    } finally {
      setLoading(false)
    }
  }, [selectedRunId])

  useEffect(() => {
    loadBase()
  }, [loadBase])

  const loadDetail = useCallback(async (runId: string) => {
    setDetailLoading(true)
    setError(null)
    try {
      const [detail, pos, distribution] = await Promise.all([
        api.getEngineRun(runId),
        api.getPositionings({ engine_run_id: runId }),
        api.getCompaDistribution({ engine_run_id: runId }),
      ])
      setRunDetail(detail)
      setPositionings(Array.isArray(pos) ? pos : pos?.positionings ?? [])
      setDist(distribution ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load run detail')
      setPositionings([])
      setDist(null)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedRunId) loadDetail(selectedRunId)
  }, [selectedRunId, loadDetail])

  const allFlags = useMemo(() => {
    const s = new Set<string>()
    positionings.forEach((p) => flagList(p.flags).forEach((f) => s.add(f)))
    return Array.from(s).sort()
  }, [positionings])

  const filteredPos = useMemo(() => {
    return positionings.filter((p) => {
      if (flagFilter !== 'all' && !flagList(p.flags).includes(flagFilter)) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const hay = `${p.employee_name ?? ''} ${p.level ?? ''} ${p.geo ?? ''} ${p.employee_id ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [positionings, flagFilter, search])

  const summaryStats = useMemo(() => {
    const ratios = positionings.map((p) => p.compa_ratio).filter((r): r is number => r != null)
    const median = ratios.length
      ? [...ratios].sort((a, b) => a - b)[Math.floor(ratios.length / 2)]
      : null
    const below = ratios.filter((r) => r < 0.8).length
    const above = ratios.filter((r) => r > 1.2).length
    const flagged = positionings.filter((p) => flagList(p.flags).length > 0).length
    return { count: positionings.length, median, below, above, flagged }
  }, [positionings])

  const buckets = useMemo<DistBucket[]>(() => {
    if (dist?.buckets && dist.buckets.length) return dist.buckets
    // derive a histogram client-side from positionings if backend gave none
    const ratios = positionings.map((p) => p.compa_ratio).filter((r): r is number => r != null)
    if (!ratios.length) return []
    const edges = [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3]
    const out: DistBucket[] = []
    for (let i = 0; i < edges.length - 1; i++) {
      const lo = edges[i]
      const hi = edges[i + 1]
      out.push({
        label: `${lo.toFixed(2)}–${hi.toFixed(2)}`,
        min: lo,
        max: hi,
        count: ratios.filter((r) => r >= lo && r < hi).length,
      })
    }
    out.unshift({ label: '<0.70', max: 0.7, count: ratios.filter((r) => r < 0.7).length })
    out.push({ label: '≥1.30', min: 1.3, count: ratios.filter((r) => r >= 1.3).length })
    return out
  }, [dist, positionings])

  const maxBucket = useMemo(() => Math.max(1, ...buckets.map((b) => b.count ?? 0)), [buckets])

  async function handleCreateRun() {
    if (!runForm.dataset_id || !runForm.band_set_id) return
    setBusy(true)
    setError(null)
    try {
      const created = await api.createEngineRun({
        dataset_id: runForm.dataset_id,
        band_set_id: runForm.band_set_id,
        label: runForm.label.trim() || undefined,
      })
      setCreateOpen(false)
      setRunForm({ dataset_id: '', band_set_id: '', label: '' })
      await loadBase()
      if (created?.id) setSelectedRunId(created.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run engine')
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteRun() {
    if (!deleteTarget) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteEngineRun(deleteTarget.id)
      const wasSelected = deleteTarget.id === selectedRunId
      setDeleteTarget(null)
      const remaining = runs.filter((r) => r.id !== deleteTarget.id)
      setRuns(remaining)
      if (wasSelected) {
        setSelectedRunId(remaining[0]?.id ?? '')
        if (!remaining.length) {
          setRunDetail(null)
          setPositionings([])
          setDist(null)
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete run')
    } finally {
      setBusy(false)
    }
  }

  function labelForDataset(idv?: string) {
    const d = datasets.find((x) => x.id === idv)
    return d ? d.label || `Dataset v${d.version ?? '?'}` : idv?.slice(0, 8) ?? '—'
  }
  function labelForBandSet(idv?: string) {
    const b = bandSets.find((x) => x.id === idv)
    return b ? b.label || `Band set v${b.version ?? '?'}` : idv?.slice(0, 8) ?? '—'
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">Positioning</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Run the compa-ratio engine against a dataset and band set, then inspect positionings and distribution.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={datasets.length === 0 || bandSets.length === 0}>
          Run engine
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner label="Loading engine runs…" />
        </div>
      ) : runs.length === 0 ? (
        <EmptyState
          title="No engine runs yet"
          description={
            datasets.length === 0 || bandSets.length === 0
              ? 'You need at least one dataset and one band set before running the engine.'
              : 'Run the compa-ratio engine to compute positionings.'
          }
          action={
            datasets.length > 0 && bandSets.length > 0 ? (
              <Button onClick={() => setCreateOpen(true)}>Run engine</Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Run selector */}
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs font-medium uppercase tracking-wide text-neutral-400">Run</label>
                <select
                  value={selectedRunId}
                  onChange={(e) => setSelectedRunId(e.target.value)}
                  className="min-w-64 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
                >
                  {runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label || `Run ${r.id.slice(0, 8)}`} · {labelForBandSet(r.band_set_id)}
                    </option>
                  ))}
                </select>
              </div>
              {runDetail && (
                <div className="flex items-center gap-3 text-xs text-neutral-500">
                  <span>{labelForDataset(runDetail.dataset_id)}</span>
                  <span>·</span>
                  <span>{labelForBandSet(runDetail.band_set_id)}</span>
                  {runDetail.status && <Badge tone="violet">{runDetail.status}</Badge>}
                  <Button variant="danger" onClick={() => setDeleteTarget(runDetail)}>
                    Delete run
                  </Button>
                </div>
              )}
            </CardHeader>
          </Card>

          {detailLoading ? (
            <div className="flex justify-center py-16">
              <Spinner label="Loading positionings…" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-5">
                <Stat label="Positionings" value={summaryStats.count} tone="violet" />
                <Stat
                  label="Median compa"
                  value={fmtRatio(summaryStats.median)}
                  tone={compaTone(summaryStats.median) === 'green' ? 'green' : 'default'}
                />
                <Stat label="Below 0.80" value={summaryStats.below} tone="rose" />
                <Stat label="Above 1.20" value={summaryStats.above} tone="amber" />
                <Stat label="Flagged" value={summaryStats.flagged} tone="amber" />
              </div>

              {/* Distribution histogram */}
              <Card>
                <CardHeader>
                  <h2 className="text-sm font-semibold text-neutral-200">Compa-ratio distribution</h2>
                </CardHeader>
                <CardBody>
                  {buckets.length === 0 ? (
                    <p className="py-6 text-center text-sm text-neutral-500">No distribution data.</p>
                  ) : (
                    <div className="flex items-end gap-2" style={{ height: 200 }}>
                      {buckets.map((b, i) => {
                        const count = b.count ?? 0
                        const h = (count / maxBucket) * 100
                        const isLow = b.max != null && b.max <= 0.8
                        const isHigh = b.min != null && b.min >= 1.2
                        const color = isLow
                          ? 'bg-rose-500/70'
                          : isHigh
                            ? 'bg-amber-500/70'
                            : 'bg-orange-500/70'
                        return (
                          <div key={i} className="flex flex-1 flex-col items-center gap-1">
                            <div className="text-xs font-medium text-neutral-300">{count}</div>
                            <div className="flex w-full flex-1 items-end">
                              <div
                                className={`w-full rounded-t ${color} transition-all`}
                                style={{ height: `${Math.max(h, count > 0 ? 4 : 0)}%` }}
                                title={`${b.label || b.range}: ${count}`}
                              />
                            </div>
                            <div className="mt-1 w-full truncate text-center text-[10px] text-neutral-500">
                              {b.label || b.range || `${b.min ?? ''}-${b.max ?? ''}`}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {dist?.stats && (
                    <div className="mt-4 flex flex-wrap gap-4 border-t border-neutral-800 pt-3 text-xs text-neutral-400">
                      {Object.entries(dist.stats).map(([k, v]) => (
                        <span key={k}>
                          <span className="text-neutral-500">{k}:</span>{' '}
                          <span className="font-mono text-neutral-300">
                            {typeof v === 'number' ? v.toFixed(2) : String(v)}
                          </span>
                        </span>
                      ))}
                    </div>
                  )}
                </CardBody>
              </Card>

              {/* Positionings table */}
              <Card>
                <CardHeader className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search employee, level, geo…"
                      className="w-64 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder-neutral-500 focus:border-orange-500 focus:outline-none"
                    />
                    <select
                      value={flagFilter}
                      onChange={(e) => setFlagFilter(e.target.value)}
                      className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
                    >
                      <option value="all">All flags</option>
                      {allFlags.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </div>
                  <span className="text-xs text-neutral-500">
                    {filteredPos.length} of {positionings.length}
                  </span>
                </CardHeader>
                <CardBody className="p-0">
                  {filteredPos.length === 0 ? (
                    <div className="p-6">
                      <EmptyState
                        title={positionings.length === 0 ? 'No positionings' : 'No matches'}
                        description={
                          positionings.length === 0
                            ? 'This run produced no positionings.'
                            : 'Adjust your search or flag filter.'
                        }
                      />
                    </div>
                  ) : (
                    <Table>
                      <THead>
                        <TR>
                          <TH>Employee</TH>
                          <TH>Level</TH>
                          <TH>Geo</TH>
                          <TH className="text-right">Compa ratio</TH>
                          <TH className="text-right">Range pen.</TH>
                          <TH>Quartile</TH>
                          <TH>Flags</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {filteredPos.map((p) => {
                          const flags = flagList(p.flags)
                          return (
                            <TR key={p.id}>
                              <TD>
                                <span className="font-medium text-neutral-100">
                                  {p.employee_name || p.employee_id?.slice(0, 8) || '—'}
                                </span>
                              </TD>
                              <TD>{p.level || '—'}</TD>
                              <TD>
                                <span className="text-neutral-400">{p.geo || '—'}</span>
                              </TD>
                              <TD className="text-right">
                                <Badge tone={compaTone(p.compa_ratio)}>{fmtRatio(p.compa_ratio)}</Badge>
                              </TD>
                              <TD className="text-right font-mono text-neutral-400">
                                {fmtPct(p.range_penetration)}
                              </TD>
                              <TD>{p.quartile != null ? `Q${p.quartile}` : '—'}</TD>
                              <TD>
                                <div className="flex flex-wrap gap-1">
                                  {flags.length === 0 ? (
                                    <span className="text-neutral-600">—</span>
                                  ) : (
                                    flags.map((f) => (
                                      <Badge key={f} tone="rose">
                                        {f}
                                      </Badge>
                                    ))
                                  )}
                                </div>
                              </TD>
                            </TR>
                          )
                        })}
                      </TBody>
                    </Table>
                  )}
                </CardBody>
              </Card>
            </>
          )}
        </>
      )}

      {/* Create run modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Run compa-ratio engine"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateRun}
              disabled={busy || !runForm.dataset_id || !runForm.band_set_id}
            >
              {busy ? 'Running…' : 'Run'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
              Dataset
            </span>
            <select
              value={runForm.dataset_id}
              onChange={(e) => setRunForm({ ...runForm, dataset_id: e.target.value })}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
            >
              <option value="">Select dataset…</option>
              {datasets.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label || `Dataset v${d.version ?? '?'}`}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
              Band set
            </span>
            <select
              value={runForm.band_set_id}
              onChange={(e) => setRunForm({ ...runForm, band_set_id: e.target.value })}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
            >
              <option value="">Select band set…</option>
              {bandSets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label || `Band set v${b.version ?? '?'}`}
                  {b.status ? ` (${b.status})` : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
              Label (optional)
            </span>
            <input
              value={runForm.label}
              onChange={(e) => setRunForm({ ...runForm, label: e.target.value })}
              placeholder="Q2 audit run"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder-neutral-500 focus:border-orange-500 focus:outline-none"
            />
          </label>
        </div>
      </Modal>

      {/* Delete run modal */}
      <Modal
        open={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        title="Delete engine run"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDeleteRun} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-300">
          Delete{' '}
          <span className="font-medium text-neutral-100">
            {deleteTarget?.label || `run ${deleteTarget?.id.slice(0, 8)}`}
          </span>{' '}
          and all its positionings? This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
