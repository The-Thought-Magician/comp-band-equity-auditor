'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface EvidencePack {
  id: string
  title: string
  methodology: string | null
  contents: Record<string, unknown> | null
  status: string
  share_token: string | null
  gap_run_id: string | null
  scenario_id: string | null
  band_set_id: string | null
  created_by: string | null
  created_at: string
}

interface Attestation {
  id: string
  evidence_pack_id: string
  approver_name: string
  approver_id: string | null
  note: string | null
  attested_at: string | null
  created_at: string
}

const inputCls =
  'w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-orange-500 focus:outline-none'

function statusTone(status: string): 'neutral' | 'violet' | 'green' | 'amber' {
  if (status === 'published') return 'green'
  if (status === 'draft') return 'amber'
  return 'violet'
}

function humanizeKey(k: string): string {
  return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function renderValue(v: unknown): React.ReactNode {
  if (v == null) return <span className="text-neutral-600">—</span>
  if (typeof v === 'number') {
    return <span className="tabular-nums text-neutral-200">{v.toLocaleString()}</span>
  }
  if (typeof v === 'boolean') return <span className="text-neutral-200">{v ? 'Yes' : 'No'}</span>
  if (typeof v === 'string') return <span className="text-neutral-200">{v}</span>
  if (Array.isArray(v)) {
    return (
      <span className="text-neutral-400">
        {v.length} item{v.length === 1 ? '' : 's'}
      </span>
    )
  }
  return (
    <span className="text-neutral-400">
      {Object.keys(v as Record<string, unknown>).length} field
      {Object.keys(v as Record<string, unknown>).length === 1 ? '' : 's'}
    </span>
  )
}

export default function EvidenceDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const [pack, setPack] = useState<EvidencePack | null>(null)
  const [attestations, setAttestations] = useState<Attestation[]>([])
  const [loading, setLoading] = useState(true)
  const [attLoading, setAttLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [signOpen, setSignOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState({ approver_name: '', note: '' })
  const [removing, setRemoving] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const loadAttestations = useCallback(async () => {
    setAttLoading(true)
    try {
      const a = await api.getAttestations({ evidence_pack_id: id })
      setAttestations(Array.isArray(a) ? a : [])
    } catch {
      setAttestations([])
    } finally {
      setAttLoading(false)
    }
  }, [id])

  const loadPack = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const p = await api.getEvidencePack(id)
      setPack(p)
    } catch (e) {
      // Fall back to shared-token read if direct fetch is not permitted.
      try {
        const shared = await api.getSharedEvidencePack(id)
        setPack(shared)
      } catch {
        setError(e instanceof Error ? e.message : 'Failed to load evidence pack')
      }
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (!id) return
    loadPack()
    loadAttestations()
  }, [id, loadPack, loadAttestations])

  const contentEntries = useMemo(() => {
    if (!pack?.contents || typeof pack.contents !== 'object') return []
    return Object.entries(pack.contents)
  }, [pack])

  function openSign() {
    setForm({ approver_name: '', note: '' })
    setFormError(null)
    setSignOpen(true)
  }

  async function submitSign() {
    setFormError(null)
    if (!form.approver_name.trim()) {
      setFormError('Approver name is required')
      return
    }
    setSubmitting(true)
    try {
      await api.createAttestation({
        evidence_pack_id: id,
        approver_name: form.approver_name.trim(),
        note: form.note.trim() || null,
      })
      setSignOpen(false)
      await loadAttestations()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to record sign-off')
    } finally {
      setSubmitting(false)
    }
  }

  async function removeAttestation(attId: string) {
    if (!confirm('Remove this sign-off?')) return
    setRemoving(attId)
    try {
      await api.deleteAttestation(attId)
      setAttestations((prev) => prev.filter((a) => a.id !== attId))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to remove sign-off')
    } finally {
      setRemoving(null)
    }
  }

  function copyShareLink() {
    if (!pack?.share_token) return
    const url = `${window.location.origin}/share/evidence/${pack.share_token}`
    navigator.clipboard?.writeText(url).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      },
      () => {},
    )
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner label="Loading evidence pack..." />
      </div>
    )
  }

  if (error || !pack) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/evidence" className="text-sm text-orange-300 hover:text-orange-200">
          ← Back to evidence packs
        </Link>
        <Card>
          <CardBody>
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-rose-300">{error ?? 'Evidence pack not found.'}</p>
              <Button variant="secondary" onClick={loadPack}>
                Retry
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    )
  }

  const signedCount = attestations.length

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/dashboard/evidence"
          className="text-sm text-orange-300 hover:text-orange-200"
        >
          ← Back to evidence packs
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-neutral-100">{pack.title}</h1>
          <Badge tone={statusTone(pack.status)}>{pack.status}</Badge>
          {signedCount > 0 && (
            <Badge tone="sky">
              {signedCount} sign-off{signedCount === 1 ? '' : 's'}
            </Badge>
          )}
        </div>
        <p className="mt-1 text-sm text-neutral-500">
          Created {new Date(pack.created_at).toLocaleString()}
          {pack.created_by ? ` by ${pack.created_by}` : ''}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Status" value={pack.status} tone={pack.status === 'published' ? 'green' : 'amber'} />
        <Stat label="Content sections" value={contentEntries.length} tone="violet" />
        <Stat label="Sign-offs" value={signedCount} tone={signedCount > 0 ? 'green' : 'default'} />
        <Stat
          label="Shareable"
          value={pack.share_token ? 'Yes' : 'No'}
          hint={pack.share_token ? 'public read-only link' : 'publish to mint a link'}
        />
      </div>

      {/* Source links */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-neutral-200">Sources</h2>
        </CardHeader>
        <CardBody className="flex flex-wrap gap-2">
          {pack.gap_run_id ? (
            <Link href={`/dashboard/gaps/${pack.gap_run_id}`}>
              <Badge tone="violet" className="cursor-pointer hover:opacity-80">
                Gap run {pack.gap_run_id.slice(0, 8)}
              </Badge>
            </Link>
          ) : null}
          {pack.scenario_id ? (
            <Link href={`/dashboard/scenarios/${pack.scenario_id}`}>
              <Badge tone="sky" className="cursor-pointer hover:opacity-80">
                Scenario {pack.scenario_id.slice(0, 8)}
              </Badge>
            </Link>
          ) : null}
          {pack.band_set_id ? (
            <Link href={`/dashboard/bands/${pack.band_set_id}`}>
              <Badge tone="neutral" className="cursor-pointer hover:opacity-80">
                Band set {pack.band_set_id.slice(0, 8)}
              </Badge>
            </Link>
          ) : null}
          {!pack.gap_run_id && !pack.scenario_id && !pack.band_set_id && (
            <span className="text-sm text-neutral-500">No linked sources.</span>
          )}
        </CardBody>
      </Card>

      {/* Share link */}
      {pack.share_token && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-neutral-200">Share link</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Anyone with this link can view the pack read-only.
            </p>
          </CardHeader>
          <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <code className="flex-1 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-orange-300">
              {`${typeof window !== 'undefined' ? window.location.origin : ''}/share/evidence/${pack.share_token}`}
            </code>
            <Button variant="secondary" onClick={copyShareLink}>
              {copied ? 'Copied!' : 'Copy link'}
            </Button>
          </CardBody>
        </Card>
      )}

      {/* Methodology */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-neutral-200">Methodology</h2>
        </CardHeader>
        <CardBody>
          {pack.methodology ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-300">
              {pack.methodology}
            </p>
          ) : (
            <p className="text-sm text-neutral-500">No methodology recorded for this pack.</p>
          )}
        </CardBody>
      </Card>

      {/* Pack contents */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-neutral-200">Pack contents</h2>
          <p className="mt-1 text-xs text-neutral-500">
            Snapshot of the figures captured at generation time.
          </p>
        </CardHeader>
        <CardBody className="p-0">
          {contentEntries.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No contents"
                description="This pack does not carry a structured contents snapshot."
                icon="📄"
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Section</TH>
                  <TH>Value</TH>
                </TR>
              </THead>
              <TBody>
                {contentEntries.map(([k, v]) => (
                  <TR key={k}>
                    <TD className="font-medium text-neutral-200">{humanizeKey(k)}</TD>
                    <TD>{renderValue(v)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          {contentEntries.length > 0 && (
            <details className="border-t border-neutral-800 px-4 py-3">
              <summary className="cursor-pointer text-xs text-neutral-400 hover:text-neutral-200">
                View raw contents JSON
              </summary>
              <pre className="mt-3 max-h-80 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-3 text-xs text-neutral-400">
                {JSON.stringify(pack.contents, null, 2)}
              </pre>
            </details>
          )}
        </CardBody>
      </Card>

      {/* Sign-off workflow */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-200">Sign-off workflow</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Capture approver attestations to certify these findings.
            </p>
          </div>
          <Button onClick={openSign}>+ Add sign-off</Button>
        </CardHeader>
        <CardBody className="p-0">
          {attLoading ? (
            <div className="flex justify-center py-10">
              <Spinner label="Loading sign-offs..." />
            </div>
          ) : attestations.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No sign-offs yet"
                description="Add an approver attestation to begin the certification trail."
                icon="✍️"
                action={<Button onClick={openSign}>Record first sign-off</Button>}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Approver</TH>
                  <TH>Note</TH>
                  <TH>Attested</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {attestations.map((a) => (
                  <TR key={a.id}>
                    <TD className="font-medium text-neutral-200">{a.approver_name}</TD>
                    <TD className="max-w-md text-neutral-400">{a.note || '—'}</TD>
                    <TD className="text-neutral-400">
                      {a.attested_at
                        ? new Date(a.attested_at).toLocaleString()
                        : new Date(a.created_at).toLocaleString()}
                    </TD>
                    <TD className="text-right">
                      <Button
                        variant="danger"
                        className="px-3 py-1.5 text-xs"
                        disabled={removing === a.id}
                        onClick={() => removeAttestation(a.id)}
                      >
                        {removing === a.id ? '...' : 'Remove'}
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={signOpen}
        onClose={() => !submitting && setSignOpen(false)}
        title="Add sign-off"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSignOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submitSign} disabled={submitting}>
              {submitting ? 'Recording...' : 'Record sign-off'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
              Approver name
            </label>
            <input
              value={form.approver_name}
              onChange={(e) => setForm({ ...form, approver_name: e.target.value })}
              placeholder="Jordan Lee, VP People"
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
              Note (optional)
            </label>
            <textarea
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
              placeholder="Reviewed methodology and remediation plan; approved for board."
              rows={4}
              className={inputCls}
            />
          </div>
          {formError && <p className="text-sm text-rose-300">{formError}</p>}
        </div>
      </Modal>
    </div>
  )
}
