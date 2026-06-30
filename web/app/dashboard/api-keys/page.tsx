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

interface ApiKey {
  id: string
  name: string
  key_prefix?: string
  last_used_at?: string | null
  revoked?: boolean
  created_by?: string
  created_at?: string
}

interface CreateApiKeyResponse {
  key: string
  record: ApiKey
}

function fmtDate(v?: string | null): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString()
}

function fmtRelative(v?: string | null): string {
  if (!v) return 'Never used'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return 'Never used'
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString()
}

export default function ApiKeysPage() {
  const router = useRouter()
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'revoked'>('all')

  // Create
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createErr, setCreateErr] = useState<string | null>(null)
  const [newName, setNewName] = useState('')

  // One-time plaintext reveal
  const [plaintext, setPlaintext] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Revoke / delete
  const [pendingRevoke, setPendingRevoke] = useState<ApiKey | null>(null)
  const [pendingDelete, setPendingDelete] = useState<ApiKey | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const r = await api.getApiKeys()
      setKeys(Array.isArray(r) ? r : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load API keys')
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
    setNewName('')
    setCreateErr(null)
    setCreateOpen(true)
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) {
      setCreateErr('Give the key a name so you can recognize it later.')
      return
    }
    setCreating(true)
    setCreateErr(null)
    try {
      const res = (await api.createApiKey({ name: newName.trim() })) as CreateApiKeyResponse
      setCreateOpen(false)
      if (res?.record) {
        setKeys((prev) => [res.record, ...prev])
      } else {
        load()
      }
      if (res?.key) {
        setCopied(false)
        setPlaintext(res.key)
      }
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : 'Failed to create key')
    } finally {
      setCreating(false)
    }
  }

  async function copyPlaintext() {
    if (!plaintext) return
    try {
      await navigator.clipboard.writeText(plaintext)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  async function confirmRevoke() {
    if (!pendingRevoke) return
    setBusyId(pendingRevoke.id)
    try {
      const updated = (await api.revokeApiKey(pendingRevoke.id)) as ApiKey
      setKeys((prev) =>
        prev.map((k) => (k.id === pendingRevoke.id ? { ...k, ...updated, revoked: true } : k)),
      )
      setPendingRevoke(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revoke key')
    } finally {
      setBusyId(null)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setBusyId(pendingDelete.id)
    try {
      await api.deleteApiKey(pendingDelete.id)
      setKeys((prev) => prev.filter((k) => k.id !== pendingDelete.id))
      setPendingDelete(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete key')
    } finally {
      setBusyId(null)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return keys.filter((k) => {
      if (statusFilter === 'active' && k.revoked) return false
      if (statusFilter === 'revoked' && !k.revoked) return false
      if (!q) return true
      return [k.name, k.key_prefix ?? '', k.created_by ?? ''].join(' ').toLowerCase().includes(q)
    })
  }, [keys, search, statusFilter])

  const kpis = useMemo(() => {
    const total = keys.length
    const active = keys.filter((k) => !k.revoked).length
    const revoked = total - active
    return { total, active, revoked }
  }, [keys])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">API Keys</h1>
          <p className="mt-1 text-sm text-slate-400">
            Issue keys for programmatic access. The full secret is shown once, at creation. Revoke or
            delete keys you no longer trust.
          </p>
        </div>
        <Button onClick={openCreate} disabled={loading}>
          + Issue key
        </Button>
      </div>

      {!loading && keys.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label="Total keys" value={kpis.total} tone="violet" />
          <Stat label="Active" value={kpis.active} tone="green" />
          <Stat label="Revoked" value={kpis.revoked} tone={kpis.revoked > 0 ? 'amber' : 'default'} />
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Keys</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search keys…"
              className="w-48 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'revoked')}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-violet-500 focus:outline-none"
            >
              <option value="all">All keys</option>
              <option value="active">Active</option>
              <option value="revoked">Revoked</option>
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner label="Loading API keys…" />
            </div>
          ) : error ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-rose-300">{error}</p>
              <Button variant="secondary" className="mt-4" onClick={load}>
                Retry
              </Button>
            </div>
          ) : keys.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No API keys yet"
                description="Issue a key to call the CompBandEquityAuditor API from scripts, CI, or your HRIS."
                icon={<span>🔑</span>}
                action={<Button onClick={openCreate}>Issue your first key</Button>}
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No keys match your filters" description="Adjust the search or status filter." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Key</TH>
                  <TH>Status</TH>
                  <TH>Last used</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((k) => (
                  <TR key={k.id}>
                    <TD className="font-medium text-slate-100">{k.name}</TD>
                    <TD>
                      <code className="rounded bg-slate-950 px-2 py-0.5 font-mono text-xs text-violet-300">
                        {k.key_prefix ? `${k.key_prefix}••••••••` : '••••••••'}
                      </code>
                    </TD>
                    <TD>
                      {k.revoked ? (
                        <Badge tone="rose">Revoked</Badge>
                      ) : (
                        <Badge tone="green">Active</Badge>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-slate-400" title={fmtDate(k.last_used_at)}>
                      {fmtRelative(k.last_used_at)}
                    </TD>
                    <TD className="whitespace-nowrap text-slate-400">{fmtDate(k.created_at)}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        {!k.revoked && (
                          <Button
                            variant="secondary"
                            className="px-2 py-1"
                            disabled={busyId === k.id}
                            onClick={() => setPendingRevoke(k)}
                          >
                            Revoke
                          </Button>
                        )}
                        <Button
                          variant="danger"
                          className="px-2 py-1"
                          disabled={busyId === k.id}
                          onClick={() => setPendingDelete(k)}
                        >
                          {busyId === k.id ? '…' : 'Delete'}
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

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => !creating && setCreateOpen(false)}
        title="Issue API key"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button onClick={submitCreate} disabled={creating}>
              {creating ? 'Issuing…' : 'Issue key'}
            </Button>
          </>
        }
      >
        <form onSubmit={submitCreate} className="space-y-4">
          {createErr && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {createErr}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">
              Key name
            </label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. HRIS sync, CI pipeline"
              autoFocus
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
            />
            <p className="mt-2 text-xs text-slate-500">
              The full secret is displayed only once after creation. Store it somewhere safe.
            </p>
          </div>
        </form>
      </Modal>

      {/* One-time plaintext reveal */}
      <Modal
        open={plaintext !== null}
        onClose={() => setPlaintext(null)}
        title="Copy your API key now"
        footer={
          <Button onClick={() => setPlaintext(null)}>I have saved it</Button>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
            This is the only time the full key will be shown. It cannot be retrieved again.
          </div>
          <div className="flex items-stretch gap-2">
            <code className="flex-1 overflow-x-auto rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-violet-200">
              {plaintext}
            </code>
            <Button variant="secondary" onClick={copyPlaintext}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Revoke confirm */}
      <Modal
        open={pendingRevoke !== null}
        onClose={() => busyId === null && setPendingRevoke(null)}
        title="Revoke API key"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingRevoke(null)} disabled={busyId !== null}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmRevoke} disabled={busyId !== null}>
              {busyId !== null ? 'Revoking…' : 'Revoke'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Revoking <span className="font-medium text-slate-100">{pendingRevoke?.name}</span> immediately
          blocks all requests made with it. The key record is kept for your audit log. This cannot be undone.
        </p>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={pendingDelete !== null}
        onClose={() => busyId === null && setPendingDelete(null)}
        title="Delete API key"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)} disabled={busyId !== null}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={busyId !== null}>
              {busyId !== null ? 'Deleting…' : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          This permanently removes <span className="font-medium text-slate-100">{pendingDelete?.name}</span>{' '}
          and its record. Any requests using it will fail. This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
