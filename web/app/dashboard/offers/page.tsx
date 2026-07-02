'use client'

import { useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface BandSet {
  id: string
  label: string
  version: number | string
  status: string
}

interface Offer {
  id: string
  candidate_label: string
  level: string
  role_family: string
  geo: string
  proposed_salary: number
  currency: string
  compa_ratio: number | null
  range_penetration: number | null
  flags: string[] | Record<string, unknown> | null
  decision: string | null
  reviewer: string | null
  band_set_id: string
  created_at: string
}

interface EvalResult {
  compa_ratio: number | null
  range_penetration: number | null
  flags: string[] | null
  suggested_range?: {
    min_salary?: number
    mid_salary?: number
    max_salary?: number
    currency?: string
  } | null
}

function dollars(v: number | null | undefined, currency = 'USD'): string {
  if (v == null) return '—'
  return v.toLocaleString(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  })
}

function compaTone(v: number | null | undefined): 'green' | 'amber' | 'rose' | 'neutral' {
  if (v == null) return 'neutral'
  if (v < 0.85 || v > 1.15) return 'rose'
  if (v < 0.9 || v > 1.1) return 'amber'
  return 'green'
}

function decisionTone(d: string | null): 'green' | 'rose' | 'amber' | 'neutral' {
  if (d === 'approved') return 'green'
  if (d === 'rejected') return 'rose'
  if (d === 'pending' || !d) return 'neutral'
  return 'amber'
}

function normFlags(flags: Offer['flags'] | EvalResult['flags']): string[] {
  if (!flags) return []
  if (Array.isArray(flags)) return flags.map(String)
  return Object.entries(flags)
    .filter(([, v]) => v)
    .map(([k]) => k)
}

const LEVELS = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7']
const DECISIONS = [
  { value: 'approved', label: 'Approve', variant: 'primary' as const },
  { value: 'rejected', label: 'Reject', variant: 'danger' as const },
  { value: 'needs_review', label: 'Needs review', variant: 'secondary' as const },
]

export default function OffersPage() {
  const [offers, setOffers] = useState<Offer[]>([])
  const [bandSets, setBandSets] = useState<BandSet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [decisionFilter, setDecisionFilter] = useState('')
  const [flaggedOnly, setFlaggedOnly] = useState(false)

  // Evaluator modal
  const [evalOpen, setEvalOpen] = useState(false)
  const [form, setForm] = useState({
    candidate_label: '',
    level: 'L3',
    role_family: '',
    geo: '',
    proposed_salary: '',
    currency: 'USD',
    band_set_id: '',
  })
  const [evaluating, setEvaluating] = useState(false)
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null)
  const [evalError, setEvalError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Decision modal
  const [decideTarget, setDecideTarget] = useState<Offer | null>(null)
  const [reviewer, setReviewer] = useState('')
  const [deciding, setDeciding] = useState(false)
  const [decideError, setDecideError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [os, bs] = await Promise.all([
        api.getOffers(),
        api.getBandSets().catch(() => []),
      ])
      setOffers(Array.isArray(os) ? os : [])
      setBandSets(Array.isArray(bs) ? bs : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load offers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const publishedBandSets = useMemo(
    () => bandSets.filter((b) => b.status === 'published'),
    [bandSets],
  )
  const usableBandSets = publishedBandSets.length ? publishedBandSets : bandSets

  const filtered = useMemo(() => {
    return offers.filter((o) => {
      if (decisionFilter && (o.decision ?? 'pending') !== decisionFilter) return false
      if (flaggedOnly && normFlags(o.flags).length === 0) return false
      if (search) {
        const q = search.toLowerCase()
        if (
          !`${o.candidate_label} ${o.level} ${o.role_family} ${o.geo}`
            .toLowerCase()
            .includes(q)
        )
          return false
      }
      return true
    })
  }, [offers, decisionFilter, flaggedOnly, search])

  const summary = useMemo(() => {
    const total = offers.length
    const flagged = offers.filter((o) => normFlags(o.flags).length > 0).length
    const pending = offers.filter((o) => !o.decision || o.decision === 'pending').length
    const approved = offers.filter((o) => o.decision === 'approved').length
    return { total, flagged, pending, approved }
  }, [offers])

  function openEvaluator() {
    setForm({
      candidate_label: '',
      level: 'L3',
      role_family: '',
      geo: '',
      proposed_salary: '',
      currency: 'USD',
      band_set_id: usableBandSets[0]?.id ?? '',
    })
    setEvalResult(null)
    setEvalError(null)
    setEvalOpen(true)
  }

  async function runEvaluate() {
    if (!form.band_set_id) {
      setEvalError('Select a band set')
      return
    }
    if (!form.proposed_salary) {
      setEvalError('Enter a proposed salary')
      return
    }
    setEvaluating(true)
    setEvalError(null)
    try {
      const res = await api.evaluateOffer({
        candidate_label: form.candidate_label || 'Candidate',
        level: form.level,
        role_family: form.role_family,
        geo: form.geo,
        proposed_salary: Number(form.proposed_salary),
        currency: form.currency,
        band_set_id: form.band_set_id,
      })
      setEvalResult(res)
    } catch (e) {
      setEvalError(e instanceof Error ? e.message : 'Evaluation failed')
    } finally {
      setEvaluating(false)
    }
  }

  async function saveOffer() {
    setSaving(true)
    setEvalError(null)
    try {
      await api.createOffer({
        candidate_label: form.candidate_label || 'Candidate',
        level: form.level,
        role_family: form.role_family,
        geo: form.geo,
        proposed_salary: Number(form.proposed_salary),
        currency: form.currency,
        band_set_id: form.band_set_id,
      })
      setEvalOpen(false)
      await load()
    } catch (e) {
      setEvalError(e instanceof Error ? e.message : 'Failed to save offer')
    } finally {
      setSaving(false)
    }
  }

  function openDecide(o: Offer) {
    setDecideTarget(o)
    setReviewer(o.reviewer ?? '')
    setDecideError(null)
  }

  async function submitDecision(decision: string) {
    if (!decideTarget) return
    if (!reviewer.trim()) {
      setDecideError('Reviewer name is required')
      return
    }
    setDeciding(true)
    setDecideError(null)
    try {
      await api.decideOffer(decideTarget.id, { decision, reviewer: reviewer.trim() })
      setDecideTarget(null)
      await load()
    } catch (e) {
      setDecideError(e instanceof Error ? e.message : 'Failed to record decision')
    } finally {
      setDeciding(false)
    }
  }

  async function remove(o: Offer) {
    if (!confirm(`Delete offer for "${o.candidate_label}"?`)) return
    try {
      await api.deleteOffer(o.id)
      await load()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete offer')
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">Offer Guardrails</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Evaluate prospective offers against live comp bands, catch compression and equity
            risk, and keep a reviewed decision log.
          </p>
        </div>
        <Button onClick={openEvaluator}>+ Evaluate offer</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Offers logged" value={summary.total} tone="violet" />
        <Stat label="Flagged" value={summary.flagged} tone={summary.flagged ? 'rose' : 'green'} />
        <Stat label="Pending review" value={summary.pending} tone={summary.pending ? 'amber' : 'green'} />
        <Stat label="Approved" value={summary.approved} tone="green" />
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search candidate, level, role..."
              className={inputCls + ' w-64'}
            />
            <select
              value={decisionFilter}
              onChange={(e) => setDecisionFilter(e.target.value)}
              className={inputCls}
            >
              <option value="">All decisions</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="needs_review">Needs review</option>
            </select>
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              <input
                type="checkbox"
                checked={flaggedOnly}
                onChange={(e) => setFlaggedOnly(e.target.checked)}
                className="accent-orange-500"
              />
              Flagged only
            </label>
          </div>
          <span className="text-xs text-neutral-500">
            {filtered.length} of {offers.length}
          </span>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="flex justify-center py-16">
              <Spinner label="Loading offers..." />
            </div>
          ) : error ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm text-rose-300">{error}</p>
              <Button variant="secondary" className="mt-4" onClick={load}>
                Retry
              </Button>
            </div>
          ) : offers.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No offers yet"
                description="Run the offer evaluator to check a candidate's salary against your bands before extending it."
                icon="◷"
                action={<Button onClick={openEvaluator}>+ Evaluate offer</Button>}
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No matches" description="Adjust your filters." icon="∅" />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Candidate</TH>
                  <TH>Level / Role</TH>
                  <TH>Geo</TH>
                  <TH className="text-right">Proposed</TH>
                  <TH className="text-right">Compa</TH>
                  <TH className="text-right">Range pen.</TH>
                  <TH>Flags</TH>
                  <TH>Decision</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((o) => {
                  const flags = normFlags(o.flags)
                  return (
                    <TR key={o.id}>
                      <TD className="font-medium text-neutral-200">{o.candidate_label}</TD>
                      <TD className="text-neutral-400">
                        {o.level} · {o.role_family || '—'}
                      </TD>
                      <TD className="text-neutral-400">{o.geo || '—'}</TD>
                      <TD className="text-right tabular-nums">
                        {dollars(o.proposed_salary, o.currency)}
                      </TD>
                      <TD className="text-right">
                        <Badge tone={compaTone(o.compa_ratio)}>
                          {o.compa_ratio != null ? o.compa_ratio.toFixed(2) : '—'}
                        </Badge>
                      </TD>
                      <TD className="text-right tabular-nums text-neutral-300">
                        {o.range_penetration != null
                          ? `${(o.range_penetration * 100).toFixed(0)}%`
                          : '—'}
                      </TD>
                      <TD>
                        {flags.length === 0 ? (
                          <span className="text-xs text-neutral-600">clean</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {flags.map((f) => (
                              <Badge key={f} tone="rose">
                                {f}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </TD>
                      <TD>
                        <Badge tone={decisionTone(o.decision)}>{o.decision ?? 'pending'}</Badge>
                        {o.reviewer && (
                          <div className="mt-0.5 text-[11px] text-neutral-500">{o.reviewer}</div>
                        )}
                      </TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            className="px-2 py-1"
                            onClick={() => openDecide(o)}
                          >
                            Decide
                          </Button>
                          <Button
                            variant="ghost"
                            className="px-2 py-1 text-rose-300 hover:text-rose-200"
                            onClick={() => remove(o)}
                          >
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

      {/* Evaluator modal */}
      <Modal
        open={evalOpen}
        onClose={() => setEvalOpen(false)}
        title="Offer evaluator"
        className="max-w-2xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setEvalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="secondary" onClick={runEvaluate} disabled={evaluating || saving}>
              {evaluating ? <Spinner label="Evaluating..." /> : 'Evaluate'}
            </Button>
            <Button onClick={saveOffer} disabled={!evalResult || saving}>
              {saving ? <Spinner label="Saving..." /> : 'Save to log'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Candidate label">
              <input
                value={form.candidate_label}
                onChange={(e) => setForm({ ...form, candidate_label: e.target.value })}
                placeholder="Req-1234 / Jane Doe"
                className={inputCls + ' w-full'}
              />
            </Field>
            <Field label="Band set">
              <select
                value={form.band_set_id}
                onChange={(e) => setForm({ ...form, band_set_id: e.target.value })}
                className={inputCls + ' w-full'}
              >
                <option value="">Select band set</option>
                {usableBandSets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label} (v{b.version}){b.status === 'published' ? '' : ` · ${b.status}`}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Level">
              <select
                value={form.level}
                onChange={(e) => setForm({ ...form, level: e.target.value })}
                className={inputCls + ' w-full'}
              >
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Role family">
              <input
                value={form.role_family}
                onChange={(e) => setForm({ ...form, role_family: e.target.value })}
                placeholder="Engineering"
                className={inputCls + ' w-full'}
              />
            </Field>
            <Field label="Geo">
              <input
                value={form.geo}
                onChange={(e) => setForm({ ...form, geo: e.target.value })}
                placeholder="US-NYC"
                className={inputCls + ' w-full'}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Proposed salary">
              <input
                type="number"
                min="0"
                value={form.proposed_salary}
                onChange={(e) => setForm({ ...form, proposed_salary: e.target.value })}
                placeholder="185000"
                className={inputCls + ' w-full'}
              />
            </Field>
            <Field label="Currency">
              <input
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                placeholder="USD"
                className={inputCls + ' w-full'}
              />
            </Field>
          </div>

          {evalError && <p className="text-sm text-rose-300">{evalError}</p>}

          {evalResult && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-950/60 p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                Evaluation result
              </h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-neutral-500">Compa-ratio</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-xl font-semibold text-neutral-100">
                      {evalResult.compa_ratio != null ? evalResult.compa_ratio.toFixed(2) : '—'}
                    </span>
                    <Badge tone={compaTone(evalResult.compa_ratio)}>
                      {evalResult.compa_ratio == null
                        ? 'no band'
                        : evalResult.compa_ratio < 0.9
                          ? 'below band'
                          : evalResult.compa_ratio > 1.1
                            ? 'above band'
                            : 'in band'}
                    </Badge>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-neutral-500">Range penetration</div>
                  <div className="mt-1 text-xl font-semibold text-neutral-100">
                    {evalResult.range_penetration != null
                      ? `${(evalResult.range_penetration * 100).toFixed(0)}%`
                      : '—'}
                  </div>
                </div>
              </div>

              {evalResult.range_penetration != null && (
                <div className="mt-4">
                  <div className="mb-1 flex justify-between text-[11px] text-neutral-500">
                    <span>min</span>
                    <span>mid</span>
                    <span>max</span>
                  </div>
                  <div className="relative h-2 rounded-full bg-neutral-800">
                    <div className="absolute left-1/2 top-0 h-2 w-px bg-neutral-600" />
                    <div
                      className="absolute top-1/2 h-3 w-3 -tranneutral-y-1/2 -tranneutral-x-1/2 rounded-full border-2 border-neutral-950 bg-orange-400"
                      style={{
                        left: `${Math.min(100, Math.max(0, evalResult.range_penetration * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {evalResult.suggested_range && (
                <div className="mt-4 text-sm text-neutral-400">
                  Suggested band range:{' '}
                  <span className="text-neutral-200">
                    {dollars(
                      evalResult.suggested_range.min_salary,
                      evalResult.suggested_range.currency ?? form.currency,
                    )}{' '}
                    –{' '}
                    {dollars(
                      evalResult.suggested_range.max_salary,
                      evalResult.suggested_range.currency ?? form.currency,
                    )}
                  </span>
                  {evalResult.suggested_range.mid_salary != null && (
                    <span className="text-neutral-500">
                      {' '}
                      (mid{' '}
                      {dollars(
                        evalResult.suggested_range.mid_salary,
                        evalResult.suggested_range.currency ?? form.currency,
                      )}
                      )
                    </span>
                  )}
                </div>
              )}

              <div className="mt-4">
                <div className="mb-1 text-xs text-neutral-500">Flags</div>
                {normFlags(evalResult.flags).length === 0 ? (
                  <Badge tone="green">No equity or compression risk</Badge>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {normFlags(evalResult.flags).map((f) => (
                      <Badge key={f} tone="rose">
                        {f}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {usableBandSets.length === 0 && (
            <p className="text-xs text-amber-300">
              No band sets found. Create and publish a band set before evaluating offers.
            </p>
          )}
        </div>
      </Modal>

      {/* Decision modal */}
      <Modal
        open={decideTarget != null}
        onClose={() => setDecideTarget(null)}
        title={decideTarget ? `Decision: ${decideTarget.candidate_label}` : 'Decision'}
        footer={
          <Button variant="secondary" onClick={() => setDecideTarget(null)} disabled={deciding}>
            Cancel
          </Button>
        }
      >
        {decideTarget && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-neutral-500">Proposed salary</div>
                <div className="text-neutral-200">
                  {dollars(decideTarget.proposed_salary, decideTarget.currency)}
                </div>
              </div>
              <div>
                <div className="text-xs text-neutral-500">Compa-ratio</div>
                <div className="text-neutral-200">
                  {decideTarget.compa_ratio != null ? decideTarget.compa_ratio.toFixed(2) : '—'}
                </div>
              </div>
            </div>
            {normFlags(decideTarget.flags).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {normFlags(decideTarget.flags).map((f) => (
                  <Badge key={f} tone="rose">
                    {f}
                  </Badge>
                ))}
              </div>
            )}
            <Field label="Reviewer">
              <input
                value={reviewer}
                onChange={(e) => setReviewer(e.target.value)}
                placeholder="Your name"
                className={inputCls + ' w-full'}
              />
            </Field>
            {decideError && <p className="text-sm text-rose-300">{decideError}</p>}
            <div className="flex flex-wrap gap-2">
              {DECISIONS.map((d) => (
                <Button
                  key={d.value}
                  variant={d.variant}
                  onClick={() => submitDecision(d.value)}
                  disabled={deciding}
                >
                  {deciding ? '...' : d.label}
                </Button>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

const inputCls =
  'rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-orange-500 focus:outline-none'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-400">{label}</span>
      {children}
    </label>
  )
}
