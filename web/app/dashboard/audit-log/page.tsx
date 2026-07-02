'use client'

import { useEffect, useMemo, useState } from 'react'
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

interface AuditEntry {
  id: string
  actor_id?: string | null
  action: string
  target_type?: string | null
  target_id?: string | null
  metadata?: Record<string, unknown> | null
  created_at?: string
}

interface SavedFilter {
  id: string
  name: string
  target_type?: string | null
  definition?: { action?: string; target_type?: string; [k: string]: unknown } | null
  created_by?: string
  created_at?: string
}

const PAGE_SIZE = 50
const SAVED_FILTER_TARGET = 'auditlog'

function fmtDate(v?: string): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

function actionTone(action: string): 'green' | 'amber' | 'rose' | 'sky' | 'violet' | 'neutral' {
  const a = action.toLowerCase()
  if (a.includes('delete') || a.includes('revoke') || a.includes('remove')) return 'rose'
  if (a.includes('create') || a.includes('add') || a.includes('issue') || a.includes('seed')) return 'green'
  if (a.includes('update') || a.includes('edit') || a.includes('override') || a.includes('remap')) return 'amber'
  if (a.includes('publish') || a.includes('lock') || a.includes('attest')) return 'violet'
  if (a.includes('run') || a.includes('evaluate') || a.includes('validate')) return 'sky'
  return 'neutral'
}

export default function AuditLogPage() {
  const router = useRouter()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // Filters
  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [targetFilter, setTargetFilter] = useState('')
  const [page, setPage] = useState(0)

  // Saved filter create
  const [saveOpen, setSaveOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [filterName, setFilterName] = useState('')

  // Saved filter delete
  const [pendingDelete, setPendingDelete] = useState<SavedFilter | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Inspect metadata
  const [inspect, setInspect] = useState<AuditEntry | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [log, filters] = await Promise.all([
        api.getAuditLog({ limit: 500 }),
        api.getSavedFilters({ target_type: SAVED_FILTER_TARGET }).catch(() => []),
      ])
      setEntries(Array.isArray(log) ? log : [])
      setSavedFilters(Array.isArray(filters) ? filters : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit log')
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

  async function refresh() {
    setRefreshing(true)
    try {
      const log = await api.getAuditLog({
        limit: 500,
        action: actionFilter || undefined,
        target_type: targetFilter || undefined,
      })
      setEntries(Array.isArray(log) ? log : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh')
    } finally {
      setRefreshing(false)
    }
  }

  const actions = useMemo(
    () => Array.from(new Set(entries.map((e) => e.action).filter(Boolean))).sort(),
    [entries],
  )
  const targetTypes = useMemo(
    () => Array.from(new Set(entries.map((e) => e.target_type).filter(Boolean) as string[])).sort(),
    [entries],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return entries.filter((e) => {
      if (actionFilter && e.action !== actionFilter) return false
      if (targetFilter && e.target_type !== targetFilter) return false
      if (!q) return true
      const hay = [
        e.action,
        e.target_type ?? '',
        e.target_id ?? '',
        e.actor_id ?? '',
        e.metadata ? JSON.stringify(e.metadata) : '',
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [entries, search, actionFilter, targetFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageClamped = Math.min(page, totalPages - 1)
  const pageRows = useMemo(
    () => filtered.slice(pageClamped * PAGE_SIZE, pageClamped * PAGE_SIZE + PAGE_SIZE),
    [filtered, pageClamped],
  )

  // reset to first page when filters change
  useEffect(() => {
    setPage(0)
  }, [search, actionFilter, targetFilter])

  const hasActiveFilter = Boolean(search || actionFilter || targetFilter)

  function applySaved(f: SavedFilter) {
    const def = f.definition ?? {}
    setActionFilter(typeof def.action === 'string' ? def.action : '')
    setTargetFilter(typeof def.target_type === 'string' ? def.target_type : '')
    setSearch(typeof def.search === 'string' ? def.search : '')
  }

  function clearFilters() {
    setSearch('')
    setActionFilter('')
    setTargetFilter('')
  }

  function openSave() {
    setFilterName('')
    setSaveErr(null)
    setSaveOpen(true)
  }

  async function submitSave(e: React.FormEvent) {
    e.preventDefault()
    if (!filterName.trim()) {
      setSaveErr('Name this filter so you can reuse it.')
      return
    }
    setSaving(true)
    setSaveErr(null)
    try {
      const created = (await api.createSavedFilter({
        name: filterName.trim(),
        target_type: SAVED_FILTER_TARGET,
        definition: {
          action: actionFilter || undefined,
          target_type: targetFilter || undefined,
          search: search || undefined,
        },
      })) as SavedFilter
      setSaveOpen(false)
      if (created?.id) {
        setSavedFilters((prev) => [created, ...prev])
      } else {
        load()
      }
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'Failed to save filter')
    } finally {
      setSaving(false)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeletingId(pendingDelete.id)
    try {
      await api.deleteSavedFilter(pendingDelete.id)
      setSavedFilters((prev) => prev.filter((f) => f.id !== pendingDelete.id))
      setPendingDelete(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete filter')
    } finally {
      setDeletingId(null)
    }
  }

  const kpis = useMemo(() => {
    const total = entries.length
    const last = entries.reduce<string | null>((acc, e) => {
      if (!e.created_at) return acc
      if (!acc || new Date(e.created_at) > new Date(acc)) return e.created_at
      return acc
    }, null)
    const actors = new Set(entries.map((e) => e.actor_id).filter(Boolean)).size
    return { total, last, actors }
  }, [entries])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">Audit Log</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Every workspace mutation, attributed and timestamped. Save filter views you check often.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={refresh} disabled={loading || refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button onClick={openSave} disabled={loading || !hasActiveFilter}>
            Save current view
          </Button>
        </div>
      </div>

      {!loading && entries.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label="Total events" value={kpis.total} tone="violet" />
          <Stat label="Distinct actors" value={kpis.actors} tone="violet" />
          <Stat
            label="Most recent"
            value={kpis.last ? new Date(kpis.last).toLocaleDateString() : '—'}
            hint={kpis.last ? new Date(kpis.last).toLocaleTimeString() : undefined}
          />
        </div>
      )}

      {/* Saved filters */}
      {savedFilters.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-neutral-200">Saved views</h2>
          </CardHeader>
          <CardBody className="flex flex-wrap gap-2">
            {savedFilters.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-1 rounded-full border border-neutral-700 bg-neutral-900 py-0.5 pl-3 pr-1 text-sm"
              >
                <button
                  onClick={() => applySaved(f)}
                  className="text-neutral-200 hover:text-orange-300"
                  title="Apply this view"
                >
                  {f.name}
                </button>
                <button
                  onClick={() => setPendingDelete(f)}
                  className="rounded-full px-1.5 text-neutral-500 hover:text-rose-300"
                  aria-label={`Delete saved view ${f.name}`}
                  disabled={deletingId === f.id}
                >
                  ✕
                </button>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <h2 className="text-sm font-semibold text-neutral-200">Activity</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search actions, targets, actors…"
              className="w-56 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-500 focus:border-orange-500 focus:outline-none"
            />
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
            >
              <option value="">All actions</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select
              value={targetFilter}
              onChange={(e) => setTargetFilter(e.target.value)}
              className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
            >
              <option value="">All targets</option>
              {targetTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {hasActiveFilter && (
              <Button variant="ghost" className="px-2 py-1.5" onClick={clearFilters}>
                Clear
              </Button>
            )}
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner label="Loading audit log…" />
            </div>
          ) : error ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-rose-300">{error}</p>
              <Button variant="secondary" className="mt-4" onClick={load}>
                Retry
              </Button>
            </div>
          ) : entries.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No activity yet"
                description="Workspace changes such as running the engine, editing bands, or issuing keys will appear here."
                icon={<span>🧾</span>}
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No events match your filters"
                description="Adjust the search, action, or target filters."
                action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}
              />
            </div>
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>When</TH>
                    <TH>Action</TH>
                    <TH>Target</TH>
                    <TH>Actor</TH>
                    <TH className="text-right">Details</TH>
                  </TR>
                </THead>
                <TBody>
                  {pageRows.map((e) => {
                    const hasMeta = e.metadata && Object.keys(e.metadata).length > 0
                    return (
                      <TR key={e.id}>
                        <TD className="whitespace-nowrap text-neutral-400">{fmtDate(e.created_at)}</TD>
                        <TD>
                          <Badge tone={actionTone(e.action)}>{e.action}</Badge>
                        </TD>
                        <TD>
                          {e.target_type ? (
                            <span className="text-neutral-200">
                              {e.target_type}
                              {e.target_id ? (
                                <span className="ml-1 font-mono text-xs text-neutral-500">
                                  {e.target_id.slice(0, 8)}
                                </span>
                              ) : null}
                            </span>
                          ) : (
                            <span className="text-neutral-500">—</span>
                          )}
                        </TD>
                        <TD className="font-mono text-xs text-neutral-400">
                          {e.actor_id ? e.actor_id.slice(0, 12) : 'system'}
                        </TD>
                        <TD className="text-right">
                          {hasMeta ? (
                            <Button variant="ghost" className="px-2 py-1" onClick={() => setInspect(e)}>
                              View
                            </Button>
                          ) : (
                            <span className="text-neutral-600">—</span>
                          )}
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </Table>
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-5 py-3 text-sm text-neutral-400">
                  <span>
                    Showing {pageClamped * PAGE_SIZE + 1}–
                    {Math.min((pageClamped + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      className="px-2 py-1"
                      disabled={pageClamped === 0}
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                    >
                      Previous
                    </Button>
                    <span className="px-2 py-1">
                      Page {pageClamped + 1} / {totalPages}
                    </span>
                    <Button
                      variant="secondary"
                      className="px-2 py-1"
                      disabled={pageClamped >= totalPages - 1}
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>

      {/* Save filter modal */}
      <Modal
        open={saveOpen}
        onClose={() => !saving && setSaveOpen(false)}
        title="Save current view"
        footer={
          <>
            <Button variant="secondary" onClick={() => setSaveOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save view'}
            </Button>
          </>
        }
      >
        <form onSubmit={submitSave} className="space-y-4">
          {saveErr && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {saveErr}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
              View name
            </label>
            <input
              value={filterName}
              onChange={(e) => setFilterName(e.target.value)}
              placeholder="e.g. Band edits this quarter"
              autoFocus
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-500 focus:border-orange-500 focus:outline-none"
            />
          </div>
          <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-xs text-neutral-400">
            <div className="mb-1 font-medium uppercase tracking-wide text-neutral-500">Captured filters</div>
            <ul className="space-y-0.5">
              <li>Action: {actionFilter || 'any'}</li>
              <li>Target: {targetFilter || 'any'}</li>
              <li>Search: {search || 'none'}</li>
            </ul>
          </div>
        </form>
      </Modal>

      {/* Delete saved filter */}
      <Modal
        open={pendingDelete !== null}
        onClose={() => deletingId === null && setPendingDelete(null)}
        title="Delete saved view"
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
        <p className="text-sm text-neutral-300">
          Delete saved view <span className="font-medium text-neutral-100">{pendingDelete?.name}</span>? This
          only removes the saved filter, not any log entries.
        </p>
      </Modal>

      {/* Inspect metadata */}
      <Modal open={inspect !== null} onClose={() => setInspect(null)} title="Event details">
        {inspect && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-3 gap-2">
              <span className="text-neutral-500">Action</span>
              <span className="col-span-2 text-neutral-200">{inspect.action}</span>
              <span className="text-neutral-500">Target</span>
              <span className="col-span-2 text-neutral-200">
                {inspect.target_type ?? '—'}
                {inspect.target_id ? ` · ${inspect.target_id}` : ''}
              </span>
              <span className="text-neutral-500">Actor</span>
              <span className="col-span-2 font-mono text-xs text-neutral-300">
                {inspect.actor_id ?? 'system'}
              </span>
              <span className="text-neutral-500">When</span>
              <span className="col-span-2 text-neutral-200">{fmtDate(inspect.created_at)}</span>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">Metadata</div>
              <pre className="max-h-72 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 font-mono text-xs text-neutral-300">
                {JSON.stringify(inspect.metadata ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
