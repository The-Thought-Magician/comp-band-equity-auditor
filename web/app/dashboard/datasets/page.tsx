'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/Spinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Dataset {
  id: string
  version?: number | string
  label?: string
  source?: string
  row_count?: number
  rejected_rows?: unknown[] | Record<string, unknown> | null
  status?: string
  created_by?: string
  created_at?: string
}

// Canonical normalized employee fields we map raw columns onto.
const TARGET_FIELDS = [
  'employee_ref',
  'name',
  'level',
  'role_family',
  'geo',
  'gender',
  'ethnicity',
  'tenure_months',
  'hire_date',
  'performance_rating',
  'base_salary',
  'currency',
  'fte',
] as const

type TargetField = (typeof TARGET_FIELDS)[number]

const REQUIRED_FIELDS: TargetField[] = ['employee_ref', 'base_salary']

function rejectedCount(d: Dataset): number {
  const r = d.rejected_rows
  if (Array.isArray(r)) return r.length
  if (r && typeof r === 'object') {
    const maybe = (r as Record<string, unknown>).count
    if (typeof maybe === 'number') return maybe
  }
  return 0
}

function statusTone(s?: string): 'green' | 'amber' | 'neutral' | 'rose' {
  switch ((s ?? '').toLowerCase()) {
    case 'ready':
    case 'valid':
    case 'active':
      return 'green'
    case 'validating':
    case 'pending':
      return 'amber'
    case 'error':
    case 'invalid':
      return 'rose'
    default:
      return 'neutral'
  }
}

function fmtDate(s?: string): string {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString()
}

// --- CSV parsing (RFC-4180-ish, handles quoted fields) ---
function parseDelimited(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    if (row.length > 1 || row[0] !== '') rows.push(row)
  }
  const headers = rows.shift() ?? []
  return { headers: headers.map((h) => h.trim()), rows }
}

const NUMERIC_FIELDS = new Set<TargetField>([
  'tenure_months',
  'performance_rating',
  'base_salary',
  'fte',
])

function coerce(field: TargetField, raw: string): string | number | null {
  const v = raw?.trim() ?? ''
  if (v === '') return null
  if (NUMERIC_FIELDS.has(field)) {
    const n = Number(v.replace(/[$,]/g, ''))
    return Number.isFinite(n) ? n : null
  }
  return v
}

function autoGuess(header: string): TargetField | '' {
  const h = header.toLowerCase().replace(/[^a-z]/g, '')
  const table: Record<string, TargetField> = {
    employeeref: 'employee_ref',
    employeeid: 'employee_ref',
    empid: 'employee_ref',
    id: 'employee_ref',
    name: 'name',
    fullname: 'name',
    level: 'level',
    grade: 'level',
    rolefamily: 'role_family',
    role: 'role_family',
    jobfamily: 'role_family',
    geo: 'geo',
    location: 'geo',
    country: 'geo',
    region: 'geo',
    gender: 'gender',
    ethnicity: 'ethnicity',
    race: 'ethnicity',
    tenuremonths: 'tenure_months',
    tenure: 'tenure_months',
    hiredate: 'hire_date',
    startdate: 'hire_date',
    performancerating: 'performance_rating',
    rating: 'performance_rating',
    performance: 'performance_rating',
    basesalary: 'base_salary',
    salary: 'base_salary',
    base: 'base_salary',
    pay: 'base_salary',
    currency: 'currency',
    ccy: 'currency',
    fte: 'fte',
  }
  return table[h] ?? ''
}

export default function DatasetsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [datasets, setDatasets] = useState<Dataset[]>([])

  // Create / upload modal state
  const [showCreate, setShowCreate] = useState(false)
  const [label, setLabel] = useState('')
  const [source, setSource] = useState('upload')
  const [fileName, setFileName] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [previewRows, setPreviewRows] = useState<string[][]>([])
  const [allRows, setAllRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<string, TargetField | ''>>({})
  const [jsonRows, setJsonRows] = useState<Record<string, unknown>[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Diff state
  const [showDiff, setShowDiff] = useState(false)
  const [diffA, setDiffA] = useState('')
  const [diffB, setDiffB] = useState('')
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [diffResult, setDiffResult] = useState<{
    added?: unknown[]
    removed?: unknown[]
    changed?: unknown[]
  } | null>(null)

  const [deletingId, setDeletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = (await api.getDatasets()) as Dataset[] | { datasets?: Dataset[] }
      const list = Array.isArray(res) ? res : (res?.datasets ?? [])
      setDatasets(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load datasets')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const resetCreate = () => {
    setLabel('')
    setSource('upload')
    setFileName('')
    setHeaders([])
    setPreviewRows([])
    setAllRows([])
    setMapping({})
    setJsonRows(null)
    setCreateError(null)
  }

  const onFile = async (file: File) => {
    setCreateError(null)
    setFileName(file.name)
    if (!label) setLabel(file.name.replace(/\.[^.]+$/, ''))
    const text = await file.text()
    if (file.name.toLowerCase().endsWith('.json') || text.trim().startsWith('[') || text.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(text)
        const arr: Record<string, unknown>[] = Array.isArray(parsed)
          ? parsed
          : Array.isArray((parsed as { employees?: unknown[] }).employees)
            ? ((parsed as { employees: Record<string, unknown>[] }).employees)
            : []
        if (arr.length === 0) {
          setCreateError('JSON file contained no employee rows.')
          return
        }
        setJsonRows(arr)
        const keys = Array.from(new Set(arr.flatMap((r) => Object.keys(r))))
        setHeaders(keys)
        const m: Record<string, TargetField | ''> = {}
        for (const k of keys) m[k] = autoGuess(k)
        setMapping(m)
        setPreviewRows(arr.slice(0, 5).map((r) => keys.map((k) => String(r[k] ?? ''))))
        setAllRows([])
        return
      } catch {
        setCreateError('Could not parse JSON. Falling back to CSV parsing.')
      }
    }
    const { headers: hs, rows } = parseDelimited(text)
    if (hs.length === 0) {
      setCreateError('No header row found in file.')
      return
    }
    setJsonRows(null)
    setHeaders(hs)
    setAllRows(rows)
    setPreviewRows(rows.slice(0, 5))
    const m: Record<string, TargetField | ''> = {}
    for (const h of hs) m[h] = autoGuess(h)
    setMapping(m)
  }

  const mappedTargets = useMemo(() => new Set(Object.values(mapping).filter(Boolean)), [mapping])
  const missingRequired = REQUIRED_FIELDS.filter((f) => !mappedTargets.has(f))

  const buildEmployeeRows = (): Record<string, unknown>[] => {
    const cols = Object.entries(mapping).filter(([, t]) => t) as [string, TargetField][]
    if (jsonRows) {
      return jsonRows.map((r) => {
        const out: Record<string, unknown> = {}
        for (const [src, tgt] of cols) {
          out[tgt] = coerce(tgt, String(r[src] ?? ''))
        }
        return out
      })
    }
    const idx = (h: string) => headers.indexOf(h)
    return allRows.map((row) => {
      const out: Record<string, unknown> = {}
      for (const [src, tgt] of cols) {
        out[tgt] = coerce(tgt, row[idx(src)] ?? '')
      }
      return out
    })
  }

  const handleCreate = async () => {
    setCreating(true)
    setCreateError(null)
    try {
      if (!label.trim()) throw new Error('A label is required.')
      const employees = headers.length > 0 ? buildEmployeeRows() : []
      if (employees.length === 0) {
        throw new Error('Upload a CSV or JSON file and map at least the required columns.')
      }
      if (missingRequired.length > 0) {
        throw new Error(`Map the required columns: ${missingRequired.join(', ')}`)
      }
      await api.createDataset({
        label: label.trim(),
        source,
        column_map: mapping,
        employees,
        rows: employees,
      })
      setShowCreate(false)
      resetCreate()
      await load()
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create dataset')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this dataset version and all its employee rows? This cannot be undone.')) return
    setDeletingId(id)
    try {
      await api.deleteDataset(id)
      setDatasets((prev) => prev.filter((d) => d.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete dataset')
    } finally {
      setDeletingId(null)
    }
  }

  const runDiff = async () => {
    if (!diffA || !diffB || diffA === diffB) {
      setDiffError('Choose two different dataset versions.')
      return
    }
    setDiffLoading(true)
    setDiffError(null)
    setDiffResult(null)
    try {
      const res = (await api.diffDatasets(diffA, diffB)) as {
        added?: unknown[]
        removed?: unknown[]
        changed?: unknown[]
      }
      setDiffResult(res)
    } catch (e) {
      setDiffError(e instanceof Error ? e.message : 'Failed to diff datasets')
    } finally {
      setDiffLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner label="Loading datasets..." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">Datasets</h1>
          <p className="mt-1 text-sm text-neutral-500">
            Version-controlled employee snapshots. Upload a file, map columns, and diff versions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {datasets.length >= 2 && (
            <Button
              variant="secondary"
              onClick={() => {
                setShowDiff(true)
                setDiffResult(null)
                setDiffError(null)
                setDiffA(datasets[1]?.id ?? '')
                setDiffB(datasets[0]?.id ?? '')
              }}
            >
              Diff versions
            </Button>
          )}
          <Button
            onClick={() => {
              resetCreate()
              setShowCreate(true)
            }}
          >
            New dataset
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {datasets.length === 0 ? (
        <EmptyState
          icon={<span>⤓</span>}
          title="No datasets yet"
          description="Upload a CSV or JSON export from your HRIS and map its columns to the canonical schema. Each upload becomes an immutable version you can diff against later."
          action={
            <Button
              onClick={() => {
                resetCreate()
                setShowCreate(true)
              }}
            >
              Upload your first dataset
            </Button>
          }
        />
      ) : (
        <Card>
          <CardBody className="px-0 py-0">
            <Table>
              <THead>
                <TR>
                  <TH>Version</TH>
                  <TH>Label</TH>
                  <TH>Source</TH>
                  <TH className="text-right">Rows</TH>
                  <TH className="text-right">Rejected</TH>
                  <TH>Status</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {datasets.map((d) => (
                  <TR key={d.id}>
                    <TD>
                      <Badge tone="violet">v{d.version ?? '—'}</Badge>
                    </TD>
                    <TD>
                      <Link
                        href={`/dashboard/datasets/${d.id}`}
                        className="font-medium text-neutral-200 hover:text-orange-300"
                      >
                        {d.label ?? d.id}
                      </Link>
                    </TD>
                    <TD>{d.source ?? '—'}</TD>
                    <TD className="text-right tabular-nums">{d.row_count ?? 0}</TD>
                    <TD className="text-right tabular-nums">
                      {rejectedCount(d) > 0 ? (
                        <Badge tone="amber">{rejectedCount(d)}</Badge>
                      ) : (
                        <span className="text-neutral-600">0</span>
                      )}
                    </TD>
                    <TD>
                      <Badge tone={statusTone(d.status)}>{d.status ?? 'unknown'}</Badge>
                    </TD>
                    <TD className="text-neutral-500">{fmtDate(d.created_at)}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Link href={`/dashboard/datasets/${d.id}`}>
                          <Button variant="ghost">Open</Button>
                        </Link>
                        <Button
                          variant="danger"
                          onClick={() => void handleDelete(d.id)}
                          disabled={deletingId === d.id}
                        >
                          {deletingId === d.id ? '…' : 'Delete'}
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      {/* Create / upload + column-map modal */}
      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New dataset version"
        className="max-w-3xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowCreate(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreate()} disabled={creating}>
              {creating ? 'Creating...' : 'Create dataset'}
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-400">Label</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Q2 2026 snapshot"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:border-orange-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-400">Source</span>
              <input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="upload / workday / csv"
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:border-orange-500 focus:outline-none"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-neutral-400">
              Employee file (CSV or JSON)
            </span>
            <input
              type="file"
              accept=".csv,.json,text/csv,application/json"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void onFile(f)
              }}
              className="block w-full text-sm text-neutral-400 file:mr-3 file:rounded-lg file:border-0 file:bg-orange-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-orange-500"
            />
            {fileName && (
              <span className="mt-1 block text-xs text-neutral-500">
                {fileName} · {(jsonRows?.length ?? allRows.length).toLocaleString()} rows detected
              </span>
            )}
          </label>

          {headers.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                  Column mapping
                </h3>
                {missingRequired.length > 0 ? (
                  <Badge tone="rose">missing: {missingRequired.join(', ')}</Badge>
                ) : (
                  <Badge tone="green">required fields mapped</Badge>
                )}
              </div>
              <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-neutral-800 p-3">
                {headers.map((h) => (
                  <div key={h} className="grid grid-cols-2 items-center gap-3">
                    <span className="truncate text-sm text-neutral-300" title={h}>
                      {h}
                    </span>
                    <select
                      value={mapping[h] ?? ''}
                      onChange={(e) =>
                        setMapping((m) => ({ ...m, [h]: e.target.value as TargetField | '' }))
                      }
                      className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 focus:border-orange-500 focus:outline-none"
                    >
                      <option value="">— ignore —</option>
                      {TARGET_FIELDS.map((t) => (
                        <option key={t} value={t} disabled={mappedTargets.has(t) && mapping[h] !== t}>
                          {t}
                          {REQUIRED_FIELDS.includes(t) ? ' *' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {previewRows.length > 0 && (
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                    Preview
                  </h3>
                  <div className="overflow-x-auto rounded-lg border border-neutral-800">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-neutral-900/80 text-neutral-400">
                        <tr>
                          {headers.map((h) => (
                            <th key={h} className="whitespace-nowrap px-2 py-1.5 font-medium">
                              {h}
                              {mapping[h] && (
                                <span className="ml-1 text-orange-400">→{mapping[h]}</span>
                              )}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-800">
                        {previewRows.map((r, i) => (
                          <tr key={i}>
                            {headers.map((_, j) => (
                              <td key={j} className="whitespace-nowrap px-2 py-1.5 text-neutral-300">
                                {r[j] ?? ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {createError && <p className="text-sm text-rose-400">{createError}</p>}
        </div>
      </Modal>

      {/* Diff modal */}
      <Modal
        open={showDiff}
        onClose={() => setShowDiff(false)}
        title="Diff dataset versions"
        className="max-w-2xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowDiff(false)}>
              Close
            </Button>
            <Button onClick={() => void runDiff()} disabled={diffLoading}>
              {diffLoading ? 'Diffing...' : 'Compare'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-400">Base version</span>
              <select
                value={diffA}
                onChange={(e) => setDiffA(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-neutral-100 focus:border-orange-500 focus:outline-none"
              >
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    v{d.version} · {d.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-400">Compare to</span>
              <select
                value={diffB}
                onChange={(e) => setDiffB(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm text-neutral-100 focus:border-orange-500 focus:outline-none"
              >
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    v{d.version} · {d.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {diffError && <p className="text-sm text-rose-400">{diffError}</p>}

          {diffResult && (
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Added" count={diffResult.added?.length ?? 0} tone="green" />
              <Stat label="Removed" count={diffResult.removed?.length ?? 0} tone="rose" />
              <Stat label="Changed" count={diffResult.changed?.length ?? 0} tone="amber" />
            </div>
          )}

          {diffResult && (diffResult.changed?.length ?? 0) > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-lg border border-neutral-800 p-3 text-xs text-neutral-400">
              <pre className="whitespace-pre-wrap break-words">
                {JSON.stringify(diffResult.changed?.slice(0, 25), null, 2)}
              </pre>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}

function Stat({
  label,
  count,
  tone,
}: {
  label: string
  count: number
  tone: 'green' | 'rose' | 'amber'
}) {
  const toneText = { green: 'text-emerald-300', rose: 'text-rose-300', amber: 'text-amber-300' }
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 px-4 py-3 text-center">
      <div className={`text-2xl font-semibold ${toneText[tone]}`}>{count}</div>
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
    </div>
  )
}
