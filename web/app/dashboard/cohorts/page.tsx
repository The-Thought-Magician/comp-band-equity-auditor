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

interface Filter {
  field: string
  op: string
  value: string
}

interface CohortDefinition {
  match?: 'all' | 'any'
  filters?: Filter[]
  [k: string]: unknown
}

interface Cohort {
  id: string
  name: string
  definition: CohortDefinition | null
  created_at: string
}

interface Employee {
  id: string
  employee_ref?: string
  name?: string
  level?: string
  role_family?: string
  geo?: string
  gender?: string
  ethnicity?: string
  base_salary?: number
  currency?: string
}

interface CohortPreview extends Cohort {
  size?: number
  sample?: Employee[]
}

const FIELDS = [
  { key: 'level', label: 'Level' },
  { key: 'role_family', label: 'Role family' },
  { key: 'geo', label: 'Geography' },
  { key: 'gender', label: 'Gender' },
  { key: 'ethnicity', label: 'Ethnicity' },
  { key: 'currency', label: 'Currency' },
  { key: 'tenure_months', label: 'Tenure (months)' },
  { key: 'performance_rating', label: 'Performance rating' },
  { key: 'base_salary', label: 'Base salary' },
]

const OPS = [
  { key: 'eq', label: '=' },
  { key: 'neq', label: '≠' },
  { key: 'gt', label: '>' },
  { key: 'gte', label: '≥' },
  { key: 'lt', label: '<' },
  { key: 'lte', label: '≤' },
  { key: 'contains', label: 'contains' },
]

function opLabel(op: string): string {
  return OPS.find((o) => o.key === op)?.label ?? op
}

function money(v: unknown, currency = 'USD'): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(v))
  } catch {
    return Number(v).toLocaleString()
  }
}

function emptyFilter(): Filter {
  return { field: 'level', op: 'eq', value: '' }
}

export default function CohortsPage() {
  const router = useRouter()
  const [cohorts, setCohorts] = useState<Cohort[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  // Builder modal
  const [open, setOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [match, setMatch] = useState<'all' | 'any'>('all')
  const [filters, setFilters] = useState<Filter[]>([emptyFilter()])
  const [submitting, setSubmitting] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)

  // Preview
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [preview, setPreview] = useState<CohortPreview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const [pendingDelete, setPendingDelete] = useState<Cohort | null>(null)
  const [deleting, setDeleting] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const c = await api.getCohorts()
      setCohorts(Array.isArray(c) ? c : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load cohorts')
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

  function openCreate() {
    setEditId(null)
    setName('')
    setMatch('all')
    setFilters([emptyFilter()])
    setFormErr(null)
    setOpen(true)
  }

  function openEdit(c: Cohort) {
    setEditId(c.id)
    setName(c.name)
    setMatch(c.definition?.match === 'any' ? 'any' : 'all')
    const f = c.definition?.filters
    setFilters(Array.isArray(f) && f.length > 0 ? f.map((x) => ({ ...x })) : [emptyFilter()])
    setFormErr(null)
    setOpen(true)
  }

  function updateFilter(idx: number, patch: Partial<Filter>) {
    setFilters((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)))
  }

  function addFilter() {
    setFilters((prev) => [...prev, emptyFilter()])
  }

  function removeFilter(idx: number) {
    setFilters((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setFormErr('Give the cohort a name.')
      return
    }
    const clean = filters.filter((f) => f.field && f.value !== '')
    if (clean.length === 0) {
      setFormErr('Add at least one filter with a value.')
      return
    }
    const definition: CohortDefinition = { match, filters: clean }
    setSubmitting(true)
    setFormErr(null)
    try {
      if (editId) {
        const updated = await api.updateCohort(editId, { name: name.trim(), definition })
        setCohorts((prev) => prev.map((c) => (c.id === editId ? (updated as Cohort) : c)))
        if (previewId === editId) refreshPreview(editId)
      } else {
        const created = await api.createCohort({ name: name.trim(), definition })
        setCohorts((prev) => [created as Cohort, ...prev])
      }
      setOpen(false)
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : 'Failed to save cohort')
    } finally {
      setSubmitting(false)
    }
  }

  async function refreshPreview(idCohort: string) {
    setPreviewId(idCohort)
    setPreviewLoading(true)
    setPreviewError(null)
    try {
      const p = await api.getCohort(idCohort)
      setPreview(p as CohortPreview)
    } catch (e) {
      setPreviewError(e instanceof Error ? e.message : 'Failed to load preview')
      setPreview(null)
    } finally {
      setPreviewLoading(false)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      await api.deleteCohort(pendingDelete.id)
      setCohorts((prev) => prev.filter((c) => c.id !== pendingDelete.id))
      if (previewId === pendingDelete.id) {
        setPreviewId(null)
        setPreview(null)
      }
      setPendingDelete(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete cohort')
    } finally {
      setDeleting(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return cohorts
    return cohorts.filter((c) => c.name.toLowerCase().includes(q))
  }, [cohorts, search])

  function describeDefinition(def: CohortDefinition | null): string {
    const fs = def?.filters
    if (!Array.isArray(fs) || fs.length === 0) return 'No filters'
    const joiner = def?.match === 'any' ? ' OR ' : ' AND '
    return fs.map((f) => `${f.field} ${opLabel(f.op)} ${f.value}`).join(joiner)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">Cohorts</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Define reusable employee segments for gap analysis, scenarios and reporting.
          </p>
        </div>
        <Button onClick={openCreate} disabled={loading}>
          + New cohort
        </Button>
      </div>

      {!loading && cohorts.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label="Cohorts" value={cohorts.length} tone="violet" />
          <Stat
            label="Total filters"
            value={cohorts.reduce((a, c) => a + (c.definition?.filters?.length ?? 0), 0)}
          />
          <Stat
            label="Most recent"
            value={
              cohorts[0]?.created_at ? new Date(cohorts[0].created_at).toLocaleDateString() : '—'
            }
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-semibold text-neutral-200">All cohorts</h2>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search cohorts…"
                className="w-48 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-500 focus:border-orange-500 focus:outline-none"
              />
            </CardHeader>
            <CardBody className="p-0">
              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <Spinner label="Loading cohorts…" />
                </div>
              ) : error ? (
                <div className="px-5 py-10 text-center">
                  <p className="text-sm text-rose-300">{error}</p>
                  <Button variant="secondary" className="mt-4" onClick={load}>
                    Retry
                  </Button>
                </div>
              ) : cohorts.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    title="No cohorts yet"
                    description="Build a cohort by combining field filters, then preview its membership."
                    icon={<span>👥</span>}
                    action={<Button onClick={openCreate}>New cohort</Button>}
                  />
                </div>
              ) : filtered.length === 0 ? (
                <div className="p-5">
                  <EmptyState title="No cohorts match" description="Try a different search term." />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>Name</TH>
                      <TH>Definition</TH>
                      <TH>Match</TH>
                      <TH className="text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filtered.map((c) => (
                      <TR key={c.id} className={previewId === c.id ? 'bg-orange-500/5' : ''}>
                        <TD>
                          <button
                            onClick={() => refreshPreview(c.id)}
                            className="font-medium text-orange-300 hover:text-orange-200"
                          >
                            {c.name}
                          </button>
                        </TD>
                        <TD className="max-w-xs">
                          <span className="block truncate text-xs text-neutral-400" title={describeDefinition(c.definition)}>
                            {describeDefinition(c.definition)}
                          </span>
                        </TD>
                        <TD>
                          <Badge tone={c.definition?.match === 'any' ? 'sky' : 'violet'}>
                            {c.definition?.match === 'any' ? 'ANY' : 'ALL'}
                          </Badge>
                        </TD>
                        <TD className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" className="px-2 py-1" onClick={() => refreshPreview(c.id)}>
                              Preview
                            </Button>
                            <Button variant="ghost" className="px-2 py-1" onClick={() => openEdit(c)}>
                              Edit
                            </Button>
                            <Button variant="danger" className="px-2 py-1" onClick={() => setPendingDelete(c)}>
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
        </div>

        {/* Preview panel */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-neutral-200">Membership preview</h2>
              <p className="mt-0.5 text-xs text-neutral-500">
                {preview ? `“${preview.name}”` : 'Select a cohort to preview who it includes.'}
              </p>
            </CardHeader>
            <CardBody>
              {!previewId ? (
                <p className="py-8 text-center text-sm text-neutral-500">No cohort selected.</p>
              ) : previewLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Spinner label="Computing membership…" />
                </div>
              ) : previewError ? (
                <p className="py-6 text-sm text-rose-300">{previewError}</p>
              ) : preview ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950/50 px-4 py-3">
                    <div className="text-xs font-medium uppercase tracking-wide text-neutral-400">Members</div>
                    <div className="mt-1 text-3xl font-semibold text-orange-300">{preview.size ?? 0}</div>
                  </div>
                  {(preview.sample?.length ?? 0) === 0 ? (
                    <EmptyState
                      title="No matching employees"
                      description="No one in the current dataset matches this definition."
                    />
                  ) : (
                    <div>
                      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-neutral-400">
                        Sample ({preview.sample!.length})
                      </div>
                      <Table>
                        <THead>
                          <TR>
                            <TH>Employee</TH>
                            <TH>Level</TH>
                            <TH className="text-right">Salary</TH>
                          </TR>
                        </THead>
                        <TBody>
                          {preview.sample!.map((e) => (
                            <TR key={e.id}>
                              <TD>{e.name || e.employee_ref || e.id.slice(0, 8)}</TD>
                              <TD>{e.level ?? '—'}</TD>
                              <TD className="text-right">{money(e.base_salary, e.currency || 'USD')}</TD>
                            </TR>
                          ))}
                        </TBody>
                      </Table>
                    </div>
                  )}
                </div>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Builder modal */}
      <Modal
        open={open}
        onClose={() => !submitting && setOpen(false)}
        title={editId ? 'Edit cohort' : 'New cohort'}
        className="max-w-2xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? 'Saving…' : editId ? 'Save changes' : 'Create cohort'}
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
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Senior engineers in EMEA"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-500 focus:border-orange-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">Match</label>
            <div className="flex gap-2">
              {(['all', 'any'] as const).map((m) => (
                <button
                  type="button"
                  key={m}
                  onClick={() => setMatch(m)}
                  className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                    match === m
                      ? 'border-orange-500/40 bg-orange-500/20 text-orange-200'
                      : 'border-neutral-700 bg-neutral-900 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  {m === 'all' ? 'Match ALL filters' : 'Match ANY filter'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="block text-xs font-medium uppercase tracking-wide text-neutral-400">Filters</label>
              <Button type="button" variant="ghost" className="px-2 py-1" onClick={addFilter}>
                + Add filter
              </Button>
            </div>
            <div className="space-y-2">
              {filters.map((f, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
                  <select
                    value={f.field}
                    onChange={(e) => updateFilter(idx, { field: e.target.value })}
                    className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
                  >
                    {FIELDS.map((fl) => (
                      <option key={fl.key} value={fl.key}>
                        {fl.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={f.op}
                    onChange={(e) => updateFilter(idx, { op: e.target.value })}
                    className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
                  >
                    {OPS.map((o) => (
                      <option key={o.key} value={o.key}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={f.value}
                    onChange={(e) => updateFilter(idx, { value: e.target.value })}
                    placeholder="value"
                    className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200 placeholder:text-neutral-500 focus:border-orange-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => removeFilter(idx)}
                    disabled={filters.length === 1}
                    className="rounded-lg px-2 py-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-rose-300 disabled:opacity-30"
                    aria-label="Remove filter"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={pendingDelete !== null}
        onClose={() => !deleting && setPendingDelete(null)}
        title="Delete cohort"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral-300">
          Delete cohort {pendingDelete ? `“${pendingDelete.name}”` : ''}? This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
