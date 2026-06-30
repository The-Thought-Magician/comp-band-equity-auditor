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

interface EvidencePack {
  id: string
  title: string
  methodology: string | null
  contents: Record<string, unknown> | null
  share_token: string | null
  status: string
  gap_run_id: string | null
  scenario_id: string | null
  band_set_id: string | null
  created_at: string
}

interface GapRun {
  id: string
  reference_group?: string | null
  status?: string
  created_at?: string
}

interface Scenario {
  id: string
  name: string
}

interface BandSet {
  id: string
  version: number | string
  label: string
}

function statusTone(status: string): 'neutral' | 'violet' | 'green' | 'amber' {
  if (status === 'published') return 'green'
  if (status === 'draft') return 'amber'
  return 'violet'
}

export default function EvidencePacksPage() {
  const [packs, setPacks] = useState<EvidencePack[]>([])
  const [gapRuns, setGapRuns] = useState<GapRun[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [bandSets, setBandSets] = useState<BandSet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')

  const [createOpen, setCreateOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({
    title: '',
    gap_run_id: '',
    scenario_id: '',
    band_set_id: '',
    methodology: '',
  })

  const [busyId, setBusyId] = useState<string | null>(null)
  const [shareToken, setShareToken] = useState<{ title: string; token: string } | null>(null)
  const [copied, setCopied] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [pk, gr, sc, bs] = await Promise.all([
        api.getEvidencePacks(),
        api.getGapRuns().catch(() => []),
        api.getScenarios().catch(() => []),
        api.getBandSets().catch(() => []),
      ])
      setPacks(Array.isArray(pk) ? pk : [])
      setGapRuns(Array.isArray(gr) ? gr : [])
      setScenarios(Array.isArray(sc) ? sc : [])
      setBandSets(Array.isArray(bs) ? bs : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load evidence packs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return packs.filter((p) => {
      if (statusFilter !== 'all' && p.status !== statusFilter) return false
      if (q && !p.title.toLowerCase().includes(q)) return false
      return true
    })
  }, [packs, search, statusFilter])

  const totals = useMemo(() => {
    const published = packs.filter((p) => p.status === 'published').length
    return { count: packs.length, published, draft: packs.length - published }
  }, [packs])

  function openCreate() {
    setForm({ title: '', gap_run_id: '', scenario_id: '', band_set_id: '', methodology: '' })
    setFormError(null)
    setCreateOpen(true)
  }

  async function submitCreate() {
    setFormError(null)
    if (!form.title.trim()) {
      setFormError('Title is required')
      return
    }
    if (!form.gap_run_id && !form.scenario_id && !form.band_set_id) {
      setFormError('Attach at least one source: a gap run, scenario, or band set')
      return
    }
    setSubmitting(true)
    try {
      await api.createEvidencePack({
        title: form.title.trim(),
        gap_run_id: form.gap_run_id || null,
        scenario_id: form.scenario_id || null,
        band_set_id: form.band_set_id || null,
        methodology: form.methodology.trim() || null,
      })
      setCreateOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to generate pack')
    } finally {
      setSubmitting(false)
    }
  }

  async function handlePublish(p: EvidencePack) {
    setBusyId(p.id)
    try {
      const updated = await api.publishEvidencePack(p.id)
      const token = updated?.share_token ?? null
      setPacks((prev) =>
        prev.map((x) =>
          x.id === p.id
            ? { ...x, status: updated?.status ?? 'published', share_token: token ?? x.share_token }
            : x,
        ),
      )
      if (token) {
        setShareToken({ title: p.title, token })
        setCopied(false)
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to publish pack')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this evidence pack?')) return
    setBusyId(id)
    try {
      await api.deleteEvidencePack(id)
      setPacks((prev) => prev.filter((p) => p.id !== id))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete pack')
    } finally {
      setBusyId(null)
    }
  }

  function shareUrl(token: string): string {
    if (typeof window === 'undefined') return `/api/proxy/evidence/shared/${token}`
    return `${window.location.origin}/api/proxy/evidence/shared/${token}`
  }

  async function copyShare(token: string) {
    try {
      await navigator.clipboard.writeText(shareUrl(token))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Evidence Packs</h1>
          <p className="mt-1 text-sm text-slate-400">
            Bundle gap analyses, remediation scenarios, and band methodology into shareable audit-ready reports.
          </p>
        </div>
        <Button onClick={openCreate} disabled={loading}>
          + Generate Pack
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Packs" value={totals.count} />
        <Stat label="Published" value={totals.published} tone="green" />
        <Stat label="Drafts" value={totals.draft} tone="amber" />
      </div>

      <Card>
        <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search packs..."
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-violet-500 focus:outline-none sm:max-w-xs"
          />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-violet-500 focus:outline-none"
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
          </select>
          <div className="text-xs text-slate-500 sm:ml-auto">
            {filtered.length} of {packs.length}
          </div>
        </CardBody>
      </Card>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner label="Loading evidence packs..." />
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
      ) : packs.length === 0 ? (
        <EmptyState
          title="No evidence packs yet"
          description="Generate a pack from a completed gap run or remediation scenario to produce an audit-ready report."
          icon="📑"
          action={<Button onClick={openCreate}>Generate your first pack</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No packs match your filters"
          action={
            <Button
              variant="secondary"
              onClick={() => {
                setSearch('')
                setStatusFilter('all')
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
              <TH>Title</TH>
              <TH>Sources</TH>
              <TH>Status</TH>
              <TH>Share link</TH>
              <TH>Created</TH>
              <TH className="text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((p) => (
              <TR key={p.id}>
                <TD>
                  <Link
                    href={`/dashboard/evidence/${p.id}`}
                    className="font-medium text-violet-300 hover:text-violet-200 hover:underline"
                  >
                    {p.title}
                  </Link>
                </TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    {p.gap_run_id && <Badge tone="sky">gap run</Badge>}
                    {p.scenario_id && <Badge tone="violet">scenario</Badge>}
                    {p.band_set_id && <Badge tone="neutral">band set</Badge>}
                    {!p.gap_run_id && !p.scenario_id && !p.band_set_id && (
                      <span className="text-xs text-slate-500">—</span>
                    )}
                  </div>
                </TD>
                <TD>
                  <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                </TD>
                <TD>
                  {p.share_token ? (
                    <button
                      onClick={() => copyShare(p.share_token as string)}
                      className="font-mono text-xs text-violet-300 hover:text-violet-200 hover:underline"
                      title="Copy share link"
                    >
                      {p.share_token.slice(0, 12)}… 📋
                    </button>
                  ) : (
                    <span className="text-xs text-slate-500">not published</span>
                  )}
                </TD>
                <TD>
                  <span className="text-slate-400">
                    {p.created_at ? new Date(p.created_at).toLocaleDateString() : '—'}
                  </span>
                </TD>
                <TD className="text-right">
                  <div className="flex justify-end gap-2">
                    {p.status !== 'published' && (
                      <Button
                        className="px-3 py-1.5 text-xs"
                        disabled={busyId === p.id}
                        onClick={() => handlePublish(p)}
                      >
                        {busyId === p.id ? '...' : 'Publish'}
                      </Button>
                    )}
                    <Link href={`/dashboard/evidence/${p.id}`}>
                      <Button variant="secondary" className="px-3 py-1.5 text-xs">
                        Open
                      </Button>
                    </Link>
                    <Button
                      variant="danger"
                      className="px-3 py-1.5 text-xs"
                      disabled={busyId === p.id}
                      onClick={() => handleDelete(p.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => !submitting && setCreateOpen(false)}
        title="Generate Evidence Pack"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={submitting}>
              {submitting ? 'Generating...' : 'Generate'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
              Title
            </label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Q2 Pay Equity Audit"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
              Gap run (optional)
            </label>
            <select
              value={form.gap_run_id}
              onChange={(e) => setForm({ ...form, gap_run_id: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-violet-500 focus:outline-none"
            >
              <option value="">None</option>
              {gapRuns.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.reference_group ? `${g.reference_group} ref` : 'Gap run'} ·{' '}
                  {g.created_at ? new Date(g.created_at).toLocaleDateString() : g.id.slice(0, 8)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
              Scenario (optional)
            </label>
            <select
              value={form.scenario_id}
              onChange={(e) => setForm({ ...form, scenario_id: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-violet-500 focus:outline-none"
            >
              <option value="">None</option>
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
              Band set (optional)
            </label>
            <select
              value={form.band_set_id}
              onChange={(e) => setForm({ ...form, band_set_id: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-violet-500 focus:outline-none"
            >
              <option value="">None</option>
              {bandSets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label || `v${b.version}`} (v{b.version})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
              Methodology notes (optional)
            </label>
            <textarea
              value={form.methodology}
              onChange={(e) => setForm({ ...form, methodology: e.target.value })}
              rows={3}
              placeholder="Leave blank to auto-generate from the attached sources."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
            />
          </div>
          {formError && <p className="text-sm text-rose-300">{formError}</p>}
        </div>
      </Modal>

      {/* Share token modal */}
      <Modal
        open={shareToken != null}
        onClose={() => setShareToken(null)}
        title="Pack published"
        footer={
          <Button variant="ghost" onClick={() => setShareToken(null)}>
            Done
          </Button>
        }
      >
        {shareToken && (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">
              <span className="font-medium text-slate-100">{shareToken.title}</span> is now published. Anyone
              with this read-only link can view it.
            </p>
            <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2">
              <code className="flex-1 truncate text-xs text-violet-300">{shareUrl(shareToken.token)}</code>
              <Button
                variant="secondary"
                className="px-3 py-1.5 text-xs"
                onClick={() => copyShare(shareToken.token)}
              >
                {copied ? 'Copied!' : 'Copy'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
