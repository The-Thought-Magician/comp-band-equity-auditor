'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Stat } from '@/components/ui/Stat'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Dataset {
  id: string
  version?: number | string
  label?: string
  source?: string
  row_count?: number
  rejected_rows?: unknown[] | Record<string, unknown> | null
  status?: string
  created_at?: string
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
  tenure_months?: number
  hire_date?: string
  performance_rating?: number
  base_salary?: number
  currency?: string
  fte?: number
  tags?: string[] | null
}

interface ValidationResult {
  valid?: boolean
  errors?: Array<{ row?: number; field?: string; message?: string } | string>
}

const EDIT_FIELDS: Array<{ key: keyof Employee; label: string; numeric?: boolean }> = [
  { key: 'level', label: 'Level' },
  { key: 'role_family', label: 'Role family' },
  { key: 'geo', label: 'Geo' },
  { key: 'base_salary', label: 'Base salary', numeric: true },
]

function fmtMoney(v: unknown, ccy = 'USD'): string {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return '—'
  try {
    return n.toLocaleString(undefined, { style: 'currency', currency: ccy, maximumFractionDigits: 0 })
  } catch {
    return n.toLocaleString()
  }
}

function rejectedRows(d: Dataset | null): unknown[] {
  if (!d) return []
  const r = d.rejected_rows
  if (Array.isArray(r)) return r
  if (r && typeof r === 'object' && Array.isArray((r as { rows?: unknown[] }).rows)) {
    return (r as { rows: unknown[] }).rows
  }
  return []
}

export default function DatasetDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [employees, setEmployees] = useState<Employee[]>([])

  // filters
  const [search, setSearch] = useState('')
  const [levelFilter, setLevelFilter] = useState('')
  const [geoFilter, setGeoFilter] = useState('')
  const [genderFilter, setGenderFilter] = useState('')

  // selection
  const [selected, setSelected] = useState<Set<string>>(new Set())

  // validation
  const [validating, setValidating] = useState(false)
  const [validation, setValidation] = useState<ValidationResult | null>(null)

  // edit modal
  const [editTarget, setEditTarget] = useState<Employee | null>(null)
  const [editForm, setEditForm] = useState<Record<string, string>>({})
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  // bulk modals
  const [showTag, setShowTag] = useState(false)
  const [tagAction, setTagAction] = useState<'add' | 'remove'>('add')
  const [tagValue, setTagValue] = useState('')
  const [showRemap, setShowRemap] = useState(false)
  const [remapLevel, setRemapLevel] = useState('')
  const [remapGeo, setRemapGeo] = useState('')
  const [remapRoleFamily, setRemapRoleFamily] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const [d, emp] = await Promise.all([
        api.getDataset(id),
        api.getEmployees({ dataset_id: id }),
      ])
      setDataset(d as Dataset)
      const list = Array.isArray(emp) ? emp : ((emp as { employees?: Employee[] })?.employees ?? [])
      setEmployees(list as Employee[])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dataset')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const levels = useMemo(
    () => Array.from(new Set(employees.map((e) => e.level).filter(Boolean))).sort() as string[],
    [employees],
  )
  const geos = useMemo(
    () => Array.from(new Set(employees.map((e) => e.geo).filter(Boolean))).sort() as string[],
    [employees],
  )
  const genders = useMemo(
    () => Array.from(new Set(employees.map((e) => e.gender).filter(Boolean))).sort() as string[],
    [employees],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return employees.filter((e) => {
      if (levelFilter && e.level !== levelFilter) return false
      if (geoFilter && e.geo !== geoFilter) return false
      if (genderFilter && e.gender !== genderFilter) return false
      if (q) {
        const hay = `${e.name ?? ''} ${e.employee_ref ?? ''} ${e.role_family ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [employees, search, levelFilter, geoFilter, genderFilter])

  const allVisibleSelected = filtered.length > 0 && filtered.every((e) => selected.has(e.id))

  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        for (const e of filtered) next.delete(e.id)
      } else {
        for (const e of filtered) next.add(e.id)
      }
      return next
    })
  }

  const toggleOne = (eid: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(eid)) next.delete(eid)
      else next.add(eid)
      return next
    })
  }

  const runValidate = async () => {
    if (!id) return
    setValidating(true)
    setValidation(null)
    try {
      const res = (await api.validateDataset(id)) as ValidationResult
      setValidation(res)
      await load()
    } catch (e) {
      setValidation({ valid: false, errors: [e instanceof Error ? e.message : 'Validation failed'] })
    } finally {
      setValidating(false)
    }
  }

  const openEdit = (e: Employee) => {
    setEditTarget(e)
    setEditError(null)
    setEditForm({
      level: e.level ?? '',
      role_family: e.role_family ?? '',
      geo: e.geo ?? '',
      base_salary: e.base_salary != null ? String(e.base_salary) : '',
    })
  }

  const saveEdit = async () => {
    if (!editTarget) return
    setSavingEdit(true)
    setEditError(null)
    try {
      const patch: Record<string, unknown> = {}
      for (const f of EDIT_FIELDS) {
        const raw = editForm[f.key as string] ?? ''
        if (f.numeric) {
          const n = Number(raw)
          patch[f.key as string] = raw === '' ? null : Number.isFinite(n) ? n : undefined
        } else {
          patch[f.key as string] = raw
        }
      }
      const updated = (await api.updateEmployee(editTarget.id, patch)) as Employee
      setEmployees((prev) => prev.map((e) => (e.id === editTarget.id ? { ...e, ...updated } : e)))
      setEditTarget(null)
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Failed to update employee')
    } finally {
      setSavingEdit(false)
    }
  }

  const runBulkTag = async () => {
    if (selected.size === 0 || !tagValue.trim()) {
      setBulkError('Select employees and enter a tag.')
      return
    }
    setBulkBusy(true)
    setBulkError(null)
    try {
      await api.bulkTagEmployees({
        employee_ids: Array.from(selected),
        action: tagAction,
        tag: tagValue.trim(),
        tags: [tagValue.trim()],
      })
      setShowTag(false)
      setTagValue('')
      await load()
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : 'Bulk tag failed')
    } finally {
      setBulkBusy(false)
    }
  }

  const runBulkRemap = async () => {
    if (selected.size === 0) {
      setBulkError('Select employees first.')
      return
    }
    if (!remapLevel && !remapGeo && !remapRoleFamily) {
      setBulkError('Set at least one field to remap.')
      return
    }
    setBulkBusy(true)
    setBulkError(null)
    try {
      const payload: Record<string, unknown> = { employee_ids: Array.from(selected) }
      if (remapLevel) payload.level = remapLevel
      if (remapGeo) payload.geo = remapGeo
      if (remapRoleFamily) payload.role_family = remapRoleFamily
      await api.bulkRemapEmployees(payload)
      setShowRemap(false)
      setRemapLevel('')
      setRemapGeo('')
      setRemapRoleFamily('')
      await load()
    } catch (e) {
      setBulkError(e instanceof Error ? e.message : 'Bulk remap failed')
    } finally {
      setBulkBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner label="Loading dataset..." />
      </div>
    )
  }

  if (error && !dataset) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/datasets" className="text-sm text-slate-400 hover:text-white">
          ← Datasets
        </Link>
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      </div>
    )
  }

  const rejects = rejectedRows(dataset)

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard/datasets" className="text-sm text-slate-400 hover:text-white">
          ← Datasets
        </Link>
      </div>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-slate-100">{dataset?.label ?? 'Dataset'}</h1>
            <Badge tone="violet">v{dataset?.version ?? '—'}</Badge>
            {dataset?.status && <Badge>{dataset.status}</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Source {dataset?.source ?? '—'} · {dataset?.row_count ?? employees.length} rows
          </p>
        </div>
        <Button onClick={() => void runValidate()} disabled={validating}>
          {validating ? 'Validating...' : 'Re-run validation'}
        </Button>
      </header>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Employees" value={employees.length} />
        <Stat
          label="Rejected rows"
          value={rejects.length}
          tone={rejects.length > 0 ? 'amber' : 'default'}
        />
        <Stat
          label="Selected"
          value={selected.size}
          tone={selected.size > 0 ? 'violet' : 'default'}
        />
      </div>

      {/* Validation results */}
      {validation && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-100">Validation</h2>
            <Badge tone={validation.valid ? 'green' : 'rose'}>
              {validation.valid ? 'Valid' : `${validation.errors?.length ?? 0} errors`}
            </Badge>
          </CardHeader>
          {!validation.valid && (validation.errors?.length ?? 0) > 0 && (
            <CardBody className="max-h-48 space-y-1 overflow-y-auto text-sm">
              {validation.errors!.map((err, i) => (
                <div key={i} className="text-rose-300">
                  {typeof err === 'string'
                    ? err
                    : `Row ${err.row ?? '?'} · ${err.field ?? ''} ${err.message ?? ''}`}
                </div>
              ))}
            </CardBody>
          )}
        </Card>
      )}

      {/* Rejected rows from import */}
      {rejects.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-amber-300">
              Rejected at import ({rejects.length})
            </h2>
          </CardHeader>
          <CardBody className="max-h-48 overflow-y-auto">
            <pre className="whitespace-pre-wrap break-words text-xs text-slate-400">
              {JSON.stringify(rejects.slice(0, 25), null, 2)}
            </pre>
          </CardBody>
        </Card>
      )}

      {/* Filters + bulk action bar */}
      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, ref, role..."
              className="min-w-[200px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-violet-500 focus:outline-none"
            />
            <select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
            >
              <option value="">All levels</option>
              {levels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <select
              value={geoFilter}
              onChange={(e) => setGeoFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
            >
              <option value="">All geos</option>
              {geos.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <select
              value={genderFilter}
              onChange={(e) => setGenderFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
            >
              <option value="">All genders</option>
              {genders.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            {(search || levelFilter || geoFilter || genderFilter) && (
              <Button
                variant="ghost"
                onClick={() => {
                  setSearch('')
                  setLevelFilter('')
                  setGeoFilter('')
                  setGenderFilter('')
                }}
              >
                Clear
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
            <span className="text-xs text-slate-500">
              {filtered.length} shown · {selected.size} selected
            </span>
            <div className="ml-auto flex gap-2">
              <Button
                variant="secondary"
                disabled={selected.size === 0}
                onClick={() => {
                  setBulkError(null)
                  setShowTag(true)
                }}
              >
                Bulk tag
              </Button>
              <Button
                variant="secondary"
                disabled={selected.size === 0}
                onClick={() => {
                  setBulkError(null)
                  setShowRemap(true)
                }}
              >
                Bulk remap
              </Button>
              {selected.size > 0 && (
                <Button variant="ghost" onClick={() => setSelected(new Set())}>
                  Deselect all
                </Button>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Employee table */}
      {employees.length === 0 ? (
        <EmptyState
          title="No employees in this dataset"
          description="This dataset version has no employee rows. Try re-running validation or upload a new dataset version."
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No employees match your filters" description="Adjust or clear the filters above." />
      ) : (
        <Card>
          <CardBody className="px-0 py-0">
            <Table>
              <THead>
                <TR>
                  <TH className="w-10">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAll}
                      className="accent-violet-600"
                      aria-label="Select all"
                    />
                  </TH>
                  <TH>Ref / Name</TH>
                  <TH>Level</TH>
                  <TH>Role family</TH>
                  <TH>Geo</TH>
                  <TH>Gender</TH>
                  <TH className="text-right">Tenure</TH>
                  <TH className="text-right">Perf</TH>
                  <TH className="text-right">Base</TH>
                  <TH>Tags</TH>
                  <TH className="text-right">Edit</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((e) => (
                  <TR key={e.id} className={selected.has(e.id) ? 'bg-violet-500/5' : ''}>
                    <TD>
                      <input
                        type="checkbox"
                        checked={selected.has(e.id)}
                        onChange={() => toggleOne(e.id)}
                        className="accent-violet-600"
                        aria-label={`Select ${e.employee_ref ?? e.id}`}
                      />
                    </TD>
                    <TD>
                      <div className="font-medium text-slate-200">{e.name ?? e.employee_ref ?? '—'}</div>
                      {e.employee_ref && e.name && (
                        <div className="text-xs text-slate-500">{e.employee_ref}</div>
                      )}
                    </TD>
                    <TD>{e.level ?? '—'}</TD>
                    <TD>{e.role_family ?? '—'}</TD>
                    <TD>{e.geo ?? '—'}</TD>
                    <TD>{e.gender ?? '—'}</TD>
                    <TD className="text-right tabular-nums">
                      {e.tenure_months != null ? `${e.tenure_months}mo` : '—'}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {e.performance_rating != null ? e.performance_rating : '—'}
                    </TD>
                    <TD className="text-right tabular-nums">
                      {fmtMoney(e.base_salary, e.currency ?? 'USD')}
                    </TD>
                    <TD>
                      {Array.isArray(e.tags) && e.tags.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {e.tags.map((t) => (
                            <Badge key={t} tone="sky">
                              {t}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </TD>
                    <TD className="text-right">
                      <Button variant="ghost" onClick={() => openEdit(e)}>
                        Edit
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      {/* Edit employee modal */}
      <Modal
        open={editTarget != null}
        onClose={() => setEditTarget(null)}
        title={`Edit ${editTarget?.name ?? editTarget?.employee_ref ?? 'employee'}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditTarget(null)} disabled={savingEdit}>
              Cancel
            </Button>
            <Button onClick={() => void saveEdit()} disabled={savingEdit}>
              {savingEdit ? 'Saving...' : 'Save changes'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {EDIT_FIELDS.map((f) => (
            <label key={f.key as string} className="block">
              <span className="mb-1 block text-xs font-medium text-slate-400">{f.label}</span>
              <input
                type={f.numeric ? 'number' : 'text'}
                value={editForm[f.key as string] ?? ''}
                onChange={(e) =>
                  setEditForm((prev) => ({ ...prev, [f.key as string]: e.target.value }))
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
              />
            </label>
          ))}
          {editError && <p className="text-sm text-rose-400">{editError}</p>}
        </div>
      </Modal>

      {/* Bulk tag modal */}
      <Modal
        open={showTag}
        onClose={() => setShowTag(false)}
        title={`Bulk tag ${selected.size} employees`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowTag(false)} disabled={bulkBusy}>
              Cancel
            </Button>
            <Button onClick={() => void runBulkTag()} disabled={bulkBusy}>
              {bulkBusy ? 'Applying...' : 'Apply'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button
              variant={tagAction === 'add' ? 'primary' : 'secondary'}
              onClick={() => setTagAction('add')}
            >
              Add tag
            </Button>
            <Button
              variant={tagAction === 'remove' ? 'primary' : 'secondary'}
              onClick={() => setTagAction('remove')}
            >
              Remove tag
            </Button>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">Tag</span>
            <input
              value={tagValue}
              onChange={(e) => setTagValue(e.target.value)}
              placeholder="e.g. flight-risk"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-violet-500 focus:outline-none"
            />
          </label>
          {bulkError && <p className="text-sm text-rose-400">{bulkError}</p>}
        </div>
      </Modal>

      {/* Bulk remap modal */}
      <Modal
        open={showRemap}
        onClose={() => setShowRemap(false)}
        title={`Bulk remap ${selected.size} employees`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowRemap(false)} disabled={bulkBusy}>
              Cancel
            </Button>
            <Button onClick={() => void runBulkRemap()} disabled={bulkBusy}>
              {bulkBusy ? 'Applying...' : 'Apply'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Leave a field blank to keep it unchanged for the selected employees.
          </p>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">Level</span>
            <input
              value={remapLevel}
              onChange={(e) => setRemapLevel(e.target.value)}
              list="level-options"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
            />
            <datalist id="level-options">
              {levels.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">Geo</span>
            <input
              value={remapGeo}
              onChange={(e) => setRemapGeo(e.target.value)}
              list="geo-options"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
            />
            <datalist id="geo-options">
              {geos.map((g) => (
                <option key={g} value={g} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">Role family</span>
            <input
              value={remapRoleFamily}
              onChange={(e) => setRemapRoleFamily(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-violet-500 focus:outline-none"
            />
          </label>
          {bulkError && <p className="text-sm text-rose-400">{bulkError}</p>}
        </div>
      </Modal>
    </div>
  )
}
