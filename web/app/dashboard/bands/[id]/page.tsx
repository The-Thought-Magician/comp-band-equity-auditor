'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
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
  bands?: Band[]
}

interface Band {
  id: string
  band_set_id?: string
  level?: string
  role_family?: string
  geo?: string
  currency?: string
  min_salary?: number
  mid_salary?: number
  max_salary?: number
  target_compa_low?: number
  target_compa_high?: number
  notes?: string | null
}

interface LintFinding {
  type?: string
  severity?: string
  message?: string
  band_id?: string
  level?: string
  role_family?: string
  geo?: string
  [k: string]: unknown
}

const EMPTY_BAND = {
  level: '',
  role_family: '',
  geo: '',
  currency: 'USD',
  min_salary: '',
  mid_salary: '',
  max_salary: '',
  target_compa_low: '',
  target_compa_high: '',
  notes: '',
}

type BandForm = typeof EMPTY_BAND

function num(v: string | number | undefined): number | undefined {
  if (v === '' || v == null) return undefined
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isNaN(n) ? undefined : n
}

function fmtMoney(n?: number, currency?: string): string {
  if (n == null) return '—'
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 0,
    }).format(n)
  } catch {
    return `${n}`
  }
}

function severityTone(sev?: string): 'rose' | 'amber' | 'sky' {
  switch ((sev || '').toLowerCase()) {
    case 'error':
    case 'high':
      return 'rose'
    case 'warning':
    case 'medium':
      return 'amber'
    default:
      return 'sky'
  }
}

export default function BandGridEditorPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id as string

  const [bandSet, setBandSet] = useState<BandSet | null>(null)
  const [bands, setBands] = useState<Band[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')

  // band create/edit
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Band | null>(null)
  const [form, setForm] = useState<BandForm>(EMPTY_BAND)

  // delete
  const [deleteTarget, setDeleteTarget] = useState<Band | null>(null)

  // bulk import
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkError, setBulkError] = useState<string | null>(null)

  // lint
  const [lintOpen, setLintOpen] = useState(false)
  const [lintFindings, setLintFindings] = useState<LintFinding[] | null>(null)
  const [lintLoading, setLintLoading] = useState(false)
  const [lintError, setLintError] = useState<string | null>(null)

  const published = (bandSet?.status || '').toLowerCase() === 'published'

  const loadBands = useCallback(async () => {
    const data = await api.getBands({ band_set_id: id })
    setBands(Array.isArray(data) ? data : data?.bands ?? [])
  }, [id])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const bs = await api.getBandSet(id)
      setBandSet(bs)
      if (Array.isArray(bs?.bands)) {
        setBands(bs.bands)
      } else {
        await loadBands()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load band set')
    } finally {
      setLoading(false)
    }
  }, [id, loadBands])

  useEffect(() => {
    if (id) load()
  }, [id, load])

  const filtered = useMemo(() => {
    if (!search.trim()) return bands
    const q = search.toLowerCase()
    return bands.filter((b) =>
      `${b.level ?? ''} ${b.role_family ?? ''} ${b.geo ?? ''}`.toLowerCase().includes(q),
    )
  }, [bands, search])

  const stats = useMemo(() => {
    const count = bands.length
    const levels = new Set(bands.map((b) => b.level).filter(Boolean)).size
    const families = new Set(bands.map((b) => b.role_family).filter(Boolean)).size
    const geos = new Set(bands.map((b) => b.geo).filter(Boolean)).size
    return { count, levels, families, geos }
  }, [bands])

  function openCreate() {
    setEditing(null)
    setForm(EMPTY_BAND)
    setEditorOpen(true)
  }

  function openEdit(b: Band) {
    setEditing(b)
    setForm({
      level: b.level ?? '',
      role_family: b.role_family ?? '',
      geo: b.geo ?? '',
      currency: b.currency ?? 'USD',
      min_salary: b.min_salary != null ? String(b.min_salary) : '',
      mid_salary: b.mid_salary != null ? String(b.mid_salary) : '',
      max_salary: b.max_salary != null ? String(b.max_salary) : '',
      target_compa_low: b.target_compa_low != null ? String(b.target_compa_low) : '',
      target_compa_high: b.target_compa_high != null ? String(b.target_compa_high) : '',
      notes: b.notes ?? '',
    })
    setEditorOpen(true)
  }

  async function handleSave() {
    setBusy(true)
    setError(null)
    const payload = {
      band_set_id: id,
      level: form.level.trim(),
      role_family: form.role_family.trim(),
      geo: form.geo.trim(),
      currency: form.currency.trim() || 'USD',
      min_salary: num(form.min_salary),
      mid_salary: num(form.mid_salary),
      max_salary: num(form.max_salary),
      target_compa_low: num(form.target_compa_low),
      target_compa_high: num(form.target_compa_high),
      notes: form.notes.trim() || undefined,
    }
    try {
      if (editing) {
        await api.updateBand(editing.id, payload)
      } else {
        await api.createBand(payload)
      }
      setEditorOpen(false)
      await loadBands()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save band')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteBand(deleteTarget.id)
      setDeleteTarget(null)
      await loadBands()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete band')
    } finally {
      setBusy(false)
    }
  }

  function parseBulk(text: string): Record<string, unknown>[] {
    const trimmed = text.trim()
    if (!trimmed) return []
    // JSON array support
    if (trimmed.startsWith('[')) {
      const arr = JSON.parse(trimmed)
      if (!Array.isArray(arr)) throw new Error('JSON must be an array of band rows')
      return arr
    }
    // CSV: header row required
    const lines = trimmed.split(/\r?\n/).filter((l) => l.trim())
    if (lines.length < 2) throw new Error('Provide a header row plus at least one data row')
    const headers = lines[0].split(',').map((h) => h.trim())
    const numeric = new Set([
      'min_salary',
      'mid_salary',
      'max_salary',
      'target_compa_low',
      'target_compa_high',
    ])
    return lines.slice(1).map((line) => {
      const cells = line.split(',').map((c) => c.trim())
      const row: Record<string, unknown> = {}
      headers.forEach((h, i) => {
        const raw = cells[i] ?? ''
        row[h] = numeric.has(h) ? (raw === '' ? undefined : parseFloat(raw)) : raw
      })
      return row
    })
  }

  async function handleBulkImport() {
    setBulkError(null)
    let rows: Record<string, unknown>[]
    try {
      rows = parseBulk(bulkText)
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : 'Could not parse input')
      return
    }
    if (rows.length === 0) {
      setBulkError('No rows to import')
      return
    }
    setBusy(true)
    try {
      await api.bulkCreateBands({ band_set_id: id, bands: rows })
      setBulkOpen(false)
      setBulkText('')
      await loadBands()
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : 'Bulk import failed')
    } finally {
      setBusy(false)
    }
  }

  async function runLint() {
    setLintOpen(true)
    setLintLoading(true)
    setLintError(null)
    setLintFindings(null)
    try {
      const res = await api.lintBandSet(id)
      const findings = Array.isArray(res) ? res : res?.findings ?? []
      setLintFindings(findings)
    } catch (e) {
      setLintError(e instanceof Error ? e.message : 'Lint failed')
    } finally {
      setLintLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner label="Loading band set…" />
      </div>
    )
  }

  if (error && !bandSet) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/bands" className="text-sm text-violet-300 hover:text-violet-200">
          ← Back to band sets
        </Link>
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/bands" className="text-sm text-violet-300 hover:text-violet-200">
          ← Back to band sets
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-100">
              {bandSet?.label || 'Band set'}
            </h1>
            <Badge tone={published ? 'green' : 'amber'}>{bandSet?.status || 'draft'}</Badge>
            <span className="font-mono text-sm text-slate-500">v{bandSet?.version ?? '—'}</span>
          </div>
          {bandSet?.notes && <p className="mt-1 text-sm text-slate-400">{bandSet.notes}</p>}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={runLint}>
            Lint bands
          </Button>
          <Button variant="secondary" onClick={() => setBulkOpen(true)} disabled={published}>
            Bulk import
          </Button>
          <Button onClick={openCreate} disabled={published}>
            Add band
          </Button>
        </div>
      </div>

      {published && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          This version is published and immutable. Clone it to make changes.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Bands" value={stats.count} tone="violet" />
        <Stat label="Levels" value={stats.levels} />
        <Stat label="Role families" value={stats.families} />
        <Stat label="Geos" value={stats.geos} />
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by level, role family, geo…"
            className="w-72 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-violet-500 focus:outline-none"
          />
          <span className="text-xs text-slate-500">
            {filtered.length} of {bands.length}
          </span>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title={bands.length === 0 ? 'No bands yet' : 'No matches'}
                description={
                  bands.length === 0
                    ? 'Add bands one at a time or paste a CSV/JSON to bulk import.'
                    : 'Adjust your filter.'
                }
                action={
                  bands.length === 0 && !published ? (
                    <div className="flex gap-2">
                      <Button onClick={openCreate}>Add band</Button>
                      <Button variant="secondary" onClick={() => setBulkOpen(true)}>
                        Bulk import
                      </Button>
                    </div>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Level</TH>
                  <TH>Role family</TH>
                  <TH>Geo</TH>
                  <TH className="text-right">Min</TH>
                  <TH className="text-right">Mid</TH>
                  <TH className="text-right">Max</TH>
                  <TH className="text-right">Compa target</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((b) => {
                  const inversion =
                    (b.min_salary != null && b.mid_salary != null && b.min_salary > b.mid_salary) ||
                    (b.mid_salary != null && b.max_salary != null && b.mid_salary > b.max_salary)
                  return (
                    <TR key={b.id}>
                      <TD>
                        <span className="font-medium text-slate-100">{b.level || '—'}</span>
                      </TD>
                      <TD>{b.role_family || '—'}</TD>
                      <TD>
                        <span className="text-slate-400">{b.geo || '—'}</span>
                      </TD>
                      <TD className="text-right font-mono">{fmtMoney(b.min_salary, b.currency)}</TD>
                      <TD className="text-right font-mono">{fmtMoney(b.mid_salary, b.currency)}</TD>
                      <TD className="text-right font-mono">
                        {fmtMoney(b.max_salary, b.currency)}
                        {inversion && (
                          <span className="ml-2 align-middle">
                            <Badge tone="rose">inversion</Badge>
                          </span>
                        )}
                      </TD>
                      <TD className="text-right font-mono text-slate-400">
                        {b.target_compa_low != null || b.target_compa_high != null
                          ? `${b.target_compa_low ?? '—'} – ${b.target_compa_high ?? '—'}`
                          : '—'}
                      </TD>
                      <TD>
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" onClick={() => openEdit(b)} disabled={published}>
                            Edit
                          </Button>
                          <Button variant="danger" onClick={() => setDeleteTarget(b)} disabled={published}>
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

      {/* Editor modal */}
      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? 'Edit band' : 'Add band'}
        className="max-w-2xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={busy}>
              {busy ? 'Saving…' : editing ? 'Save' : 'Add band'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Field label="Level">
            <Input value={form.level} onChange={(v) => setForm({ ...form, level: v })} placeholder="L4" />
          </Field>
          <Field label="Role family">
            <Input
              value={form.role_family}
              onChange={(v) => setForm({ ...form, role_family: v })}
              placeholder="Engineering"
            />
          </Field>
          <Field label="Geo">
            <Input value={form.geo} onChange={(v) => setForm({ ...form, geo: v })} placeholder="US-NAT" />
          </Field>
          <Field label="Currency">
            <Input value={form.currency} onChange={(v) => setForm({ ...form, currency: v })} placeholder="USD" />
          </Field>
          <Field label="Min salary">
            <Input value={form.min_salary} onChange={(v) => setForm({ ...form, min_salary: v })} type="number" />
          </Field>
          <Field label="Mid salary">
            <Input value={form.mid_salary} onChange={(v) => setForm({ ...form, mid_salary: v })} type="number" />
          </Field>
          <Field label="Max salary">
            <Input value={form.max_salary} onChange={(v) => setForm({ ...form, max_salary: v })} type="number" />
          </Field>
          <div />
          <Field label="Target compa low">
            <Input
              value={form.target_compa_low}
              onChange={(v) => setForm({ ...form, target_compa_low: v })}
              type="number"
              placeholder="0.9"
            />
          </Field>
          <Field label="Target compa high">
            <Input
              value={form.target_compa_high}
              onChange={(v) => setForm({ ...form, target_compa_high: v })}
              type="number"
              placeholder="1.1"
            />
          </Field>
          <div className="col-span-2">
            <Field label="Notes">
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={2}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-violet-500 focus:outline-none"
              />
            </Field>
          </div>
        </div>
      </Modal>

      {/* Delete modal */}
      <Modal
        open={deleteTarget != null}
        onClose={() => setDeleteTarget(null)}
        title="Delete band"
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
        <p className="text-sm text-slate-300">
          Delete the band{' '}
          <span className="font-medium text-slate-100">
            {[deleteTarget?.level, deleteTarget?.role_family, deleteTarget?.geo].filter(Boolean).join(' · ')}
          </span>
          ?
        </p>
      </Modal>

      {/* Bulk import modal */}
      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title="Bulk import bands"
        className="max-w-2xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setBulkOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkImport} disabled={busy}>
              {busy ? 'Importing…' : 'Import'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-slate-400">
            Paste CSV (header row) or a JSON array. Recognized columns: level, role_family, geo, currency,
            min_salary, mid_salary, max_salary, target_compa_low, target_compa_high, notes.
          </p>
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 font-mono text-xs text-slate-500">
            level,role_family,geo,currency,min_salary,mid_salary,max_salary
            <br />
            L4,Engineering,US-NAT,USD,120000,150000,180000
          </div>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={10}
            placeholder="Paste CSV or JSON here…"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 placeholder-slate-500 focus:border-violet-500 focus:outline-none"
          />
          {bulkError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {bulkError}
            </div>
          )}
        </div>
      </Modal>

      {/* Lint modal */}
      <Modal
        open={lintOpen}
        onClose={() => setLintOpen(false)}
        title="Lint findings"
        className="max-w-2xl"
        footer={
          <Button variant="secondary" onClick={() => setLintOpen(false)}>
            Close
          </Button>
        }
      >
        {lintLoading ? (
          <div className="flex justify-center py-8">
            <Spinner label="Linting…" />
          </div>
        ) : lintError ? (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
            {lintError}
          </div>
        ) : lintFindings && lintFindings.length === 0 ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-6 text-center text-sm text-emerald-300">
            No overlap or inversion issues found. Bands look clean.
          </div>
        ) : (
          <div className="space-y-2">
            {lintFindings?.map((f, i) => (
              <div
                key={i}
                className="flex items-start gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2"
              >
                <Badge tone={severityTone(f.severity)}>{f.severity || f.type || 'info'}</Badge>
                <div className="text-sm text-slate-300">
                  {f.message || f.type || 'Issue'}
                  {(f.level || f.role_family || f.geo) && (
                    <span className="ml-2 font-mono text-xs text-slate-500">
                      {[f.level, f.role_family, f.geo].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </label>
  )
}

function Input({
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:border-violet-500 focus:outline-none"
    />
  )
}
