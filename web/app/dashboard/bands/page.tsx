'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface BandSet {
  id: string
  version?: number | string
  label?: string
  status?: string
  notes?: string | null
  effective_from?: string | null
  created_at?: string
}

interface DiffItem {
  level?: string
  role_family?: string
  geo?: string
  field?: string
  from?: unknown
  to?: unknown
  [k: string]: unknown
}

interface DiffResult {
  added?: DiffItem[]
  removed?: DiffItem[]
  changed?: DiffItem[]
}

function statusTone(status?: string): 'violet' | 'green' | 'amber' | 'neutral' {
  switch ((status || '').toLowerCase()) {
    case 'published':
      return 'green'
    case 'draft':
      return 'amber'
    case 'archived':
      return 'neutral'
    default:
      return 'violet'
  }
}

function fmtDate(s?: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

export default function BandSetsPage() {
  const [bandSets, setBandSets] = useState<BandSet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // create modal
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState({ label: '', notes: '', effective_from: '' })

  // clone modal
  const [cloneTarget, setCloneTarget] = useState<BandSet | null>(null)
  const [cloneLabel, setCloneLabel] = useState('')

  // delete
  const [deleteTarget, setDeleteTarget] = useState<BandSet | null>(null)

  // diff
  const [diffOpen, setDiffOpen] = useState(false)
  const [diffA, setDiffA] = useState('')
  const [diffB, setDiffB] = useState('')
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.getBandSets()
      setBandSets(Array.isArray(data) ? data : data?.bandSets ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load band sets')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    return bandSets.filter((bs) => {
      if (statusFilter !== 'all' && (bs.status || '').toLowerCase() !== statusFilter) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const hay = `${bs.label ?? ''} ${bs.version ?? ''} ${bs.notes ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [bandSets, search, statusFilter])

  const stats = useMemo(() => {
    const total = bandSets.length
    const published = bandSets.filter((b) => (b.status || '').toLowerCase() === 'published').length
    const drafts = bandSets.filter((b) => (b.status || '').toLowerCase() === 'draft').length
    return { total, published, drafts }
  }, [bandSets])

  async function handleCreate() {
    if (!form.label.trim()) return
    setBusy(true)
    setError(null)
    try {
      await api.createBandSet({
        label: form.label.trim(),
        notes: form.notes.trim() || undefined,
        effective_from: form.effective_from || undefined,
      })
      setCreateOpen(false)
      setForm({ label: '', notes: '', effective_from: '' })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create band set')
    } finally {
      setBusy(false)
    }
  }

  async function handleClone() {
    if (!cloneTarget) return
    setBusy(true)
    setError(null)
    try {
      await api.cloneBandSet(cloneTarget.id, cloneLabel.trim() ? { label: cloneLabel.trim() } : {})
      setCloneTarget(null)
      setCloneLabel('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to clone band set')
    } finally {
      setBusy(false)
    }
  }

  async function handlePublish(bs: BandSet) {
    setBusy(true)
    setError(null)
    try {
      await api.publishBandSet(bs.id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to publish band set')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteBandSet(deleteTarget.id)
      setDeleteTarget(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete band set')
    } finally {
      setBusy(false)
    }
  }

  async function runDiff() {
    if (!diffA || !diffB || diffA === diffB) return
    setDiffLoading(true)
    setDiffError(null)
    setDiffResult(null)
    try {
      const res = await api.diffBandSets(diffA, diffB)
      setDiffResult(res ?? {})
    } catch (e) {
      setDiffError(e instanceof Error ? e.message : 'Failed to diff band sets')
    } finally {
      setDiffLoading(false)
    }
  }

  function labelFor(id: string): string {
    const bs = bandSets.find((b) => b.id === id)
    if (!bs) return id.slice(0, 8)
    return bs.label || `v${bs.version ?? '?'}`
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">Comp Bands</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Versioned salary band sets. Draft, clone, and publish immutable versions.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setDiffOpen(true)
              setDiffResult(null)
              setDiffError(null)
            }}
            disabled={bandSets.length < 2}
          >
            Compare versions
          </Button>
          <Button onClick={() => setCreateOpen(true)}>New band set</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Band sets" value={stats.total} tone="violet" />
        <Stat label="Published" value={stats.published} tone="green" />
        <Stat label="Drafts" value={stats.drafts} tone="amber" />
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search label, version, notes…"
              className="w-64 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder-neutral-500 focus:border-orange-500 focus:outline-none"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
            >
              <option value="all">All statuses</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <span className="text-xs text-neutral-500">
            {filtered.length} of {bandSets.length}
          </span>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="flex justify-center py-16">
              <Spinner label="Loading band sets…" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={bandSets.length === 0 ? 'No band sets yet' : 'No matches'}
                description={
                  bandSets.length === 0
                    ? 'Create your first salary band set to start auditing compa-ratios.'
                    : 'Adjust your search or status filter.'
                }
                action={
                  bandSets.length === 0 ? (
                    <Button onClick={() => setCreateOpen(true)}>New band set</Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Label</TH>
                  <TH>Version</TH>
                  <TH>Status</TH>
                  <TH>Effective</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((bs) => {
                  const published = (bs.status || '').toLowerCase() === 'published'
                  return (
                    <TR key={bs.id}>
                      <TD>
                        <Link
                          href={`/dashboard/bands/${bs.id}`}
                          className="font-medium text-orange-300 hover:text-orange-200"
                        >
                          {bs.label || `Band set ${String(bs.id).slice(0, 8)}`}
                        </Link>
                        {bs.notes && <div className="mt-0.5 text-xs text-neutral-500">{bs.notes}</div>}
                      </TD>
                      <TD>
                        <span className="font-mono text-neutral-400">v{bs.version ?? '—'}</span>
                      </TD>
                      <TD>
                        <Badge tone={statusTone(bs.status)}>{bs.status || 'draft'}</Badge>
                      </TD>
                      <TD>{fmtDate(bs.effective_from)}</TD>
                      <TD>{fmtDate(bs.created_at)}</TD>
                      <TD>
                        <div className="flex justify-end gap-2">
                          <Link href={`/dashboard/bands/${bs.id}`}>
                            <Button variant="ghost">Edit</Button>
                          </Link>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setCloneTarget(bs)
                              setCloneLabel(`${bs.label || 'Band set'} (copy)`)
                            }}
                          >
                            Clone
                          </Button>
                          {!published && (
                            <Button variant="secondary" disabled={busy} onClick={() => handlePublish(bs)}>
                              Publish
                            </Button>
                          )}
                          <Button variant="danger" onClick={() => setDeleteTarget(bs)}>
                            Delete
                          </Button>
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

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New band set"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={busy || !form.label.trim()}>
              {busy ? 'Creating…' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Label">
            <input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="2026 Engineering Bands"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder-neutral-500 focus:border-orange-500 focus:outline-none"
            />
          </Field>
          <Field label="Effective from (optional)">
            <input
              type="date"
              value={form.effective_from}
              onChange={(e) => setForm({ ...form, effective_from: e.target.value })}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
            />
          </Field>
          <Field label="Notes (optional)">
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              placeholder="Context for this version…"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder-neutral-500 focus:border-orange-500 focus:outline-none"
            />
          </Field>
        </div>
      </Modal>

      {/* Clone modal */}
      <Modal
        open={cloneTarget != null}
        onClose={() => setCloneTarget(null)}
        title={`Clone ${cloneTarget?.label || 'band set'}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCloneTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleClone} disabled={busy}>
              {busy ? 'Cloning…' : 'Clone'}
            </Button>
          </>
        }
      >
        <p className="mb-4 text-sm text-neutral-400">
          Creates a new draft version with all bands copied from this set.
        </p>
        <Field label="New label">
          <input
            value={cloneLabel}
            onChange={(e) => setCloneLabel(e.target.value)}
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
          />
        </Field>
      </Modal>

      {/* Delete modal */}
      <Modal
        open={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        title="Delete band set"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-300">
          Delete <span className="font-medium text-neutral-100">{deleteTarget?.label || 'this band set'}</span> and all its
          bands? This cannot be undone.
        </p>
      </Modal>

      {/* Diff modal */}
      <Modal
        open={diffOpen}
        onClose={() => setDiffOpen(false)}
        title="Compare band-set versions"
        className="max-w-3xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDiffOpen(false)}>
              Close
            </Button>
            <Button onClick={runDiff} disabled={diffLoading || !diffA || !diffB || diffA === diffB}>
              {diffLoading ? 'Comparing…' : 'Compare'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Base version">
              <select
                value={diffA}
                onChange={(e) => setDiffA(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
              >
                <option value="">Select…</option>
                {bandSets.map((bs) => (
                  <option key={bs.id} value={bs.id}>
                    {labelFor(bs.id)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Compare to">
              <select
                value={diffB}
                onChange={(e) => setDiffB(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
              >
                <option value="">Select…</option>
                {bandSets.map((bs) => (
                  <option key={bs.id} value={bs.id}>
                    {labelFor(bs.id)}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          {diffError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {diffError}
            </div>
          )}

          {diffResult && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <Badge tone="green">+{diffResult.added?.length ?? 0} added</Badge>
                <Badge tone="rose">−{diffResult.removed?.length ?? 0} removed</Badge>
                <Badge tone="amber">~{diffResult.changed?.length ?? 0} changed</Badge>
              </div>
              <DiffSection title="Added" tone="green" items={diffResult.added} />
              <DiffSection title="Removed" tone="rose" items={diffResult.removed} />
              <DiffSection title="Changed" tone="amber" items={diffResult.changed} />
              {(diffResult.added?.length ?? 0) +
                (diffResult.removed?.length ?? 0) +
                (diffResult.changed?.length ?? 0) ===
                0 && <p className="text-sm text-neutral-500">No differences between these versions.</p>}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</span>
      {children}
    </label>
  )
}

function DiffSection({
  title,
  tone,
  items,
}: {
  title: string
  tone: 'green' | 'rose' | 'amber'
  items?: DiffItem[]
}) {
  if (!items || items.length === 0) return null
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <Badge tone={tone}>{title}</Badge>
        <span className="text-xs text-neutral-500">{items.length}</span>
      </div>
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950/60 p-2">
        {items.map((it, i) => (
          <div key={i} className="rounded px-2 py-1 font-mono text-xs text-neutral-300">
            {[it.level, it.role_family, it.geo].filter(Boolean).join(' · ') || `row ${i + 1}`}
            {it.field != null && (
              <span className="ml-2 text-neutral-500">
                {String(it.field)}: {String(it.from ?? '∅')} → {String(it.to ?? '∅')}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
