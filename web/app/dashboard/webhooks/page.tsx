'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

interface Webhook {
  id: string
  url: string
  events: string[]
  secret: string | null
  enabled: boolean
  created_by: string | null
  created_at: string
}

interface Delivery {
  id: string
  webhook_id: string
  event: string
  status: string
  response_code: number | null
  created_at: string
}

const EVENT_TYPES = [
  'gap_run.completed',
  'engine_run.completed',
  'scenario.created',
  'offer.decided',
  'merit_cycle.locked',
  'evidence_pack.published',
  'guardrail.breached',
]

const inputCls =
  'w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 placeholder:text-neutral-600 focus:border-orange-500 focus:outline-none'

function deliveryTone(status: string, code: number | null): 'green' | 'rose' | 'amber' | 'neutral' {
  const s = (status || '').toLowerCase()
  if (s === 'success' || s === 'delivered' || (code != null && code >= 200 && code < 300)) return 'green'
  if (s === 'failed' || s === 'error' || (code != null && code >= 400)) return 'rose'
  if (s === 'pending' || s === 'retrying') return 'amber'
  return 'neutral'
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Webhook | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [form, setForm] = useState<{ url: string; events: string[]; secret: string; enabled: boolean }>(
    { url: '', events: [], secret: '', enabled: true },
  )
  const [busy, setBusy] = useState<string | null>(null)

  // Delivery log
  const [selected, setSelected] = useState<Webhook | null>(null)
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [delLoading, setDelLoading] = useState(false)
  const [delError, setDelError] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const w = await api.getWebhooks()
      setWebhooks(asArray<Webhook>(w))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load webhooks')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const loadDeliveries = useCallback(async (wh: Webhook) => {
    setSelected(wh)
    setDelLoading(true)
    setDelError(null)
    setStatusFilter('all')
    try {
      const d = await api.getWebhookDeliveries(wh.id)
      setDeliveries(asArray<Delivery>(d))
    } catch (e) {
      setDelError(e instanceof Error ? e.message : 'Failed to load deliveries')
      setDeliveries([])
    } finally {
      setDelLoading(false)
    }
  }, [])

  const stats = useMemo(() => {
    const active = webhooks.filter((w) => w.enabled).length
    const totalEvents = new Set(webhooks.flatMap((w) => asArray<string>(w.events))).size
    return { count: webhooks.length, active, totalEvents }
  }, [webhooks])

  const filteredDeliveries = useMemo(() => {
    if (statusFilter === 'all') return deliveries
    return deliveries.filter((d) => deliveryTone(d.status, d.response_code) === statusFilter)
  }, [deliveries, statusFilter])

  function openCreate() {
    setEditing(null)
    setForm({ url: '', events: [], secret: '', enabled: true })
    setFormError(null)
    setModalOpen(true)
  }

  function openEdit(w: Webhook) {
    setEditing(w)
    setForm({
      url: w.url,
      events: asArray<string>(w.events),
      secret: w.secret ?? '',
      enabled: w.enabled,
    })
    setFormError(null)
    setModalOpen(true)
  }

  function toggleEvent(ev: string) {
    setForm((f) =>
      f.events.includes(ev)
        ? { ...f, events: f.events.filter((e) => e !== ev) }
        : { ...f, events: [...f.events, ev] },
    )
  }

  async function submit() {
    setFormError(null)
    if (!form.url.trim() || !/^https?:\/\//i.test(form.url.trim())) {
      setFormError('Enter a valid http(s) URL')
      return
    }
    if (form.events.length === 0) {
      setFormError('Select at least one event')
      return
    }
    setSubmitting(true)
    try {
      const payload = {
        url: form.url.trim(),
        events: form.events,
        secret: form.secret.trim() || undefined,
        enabled: form.enabled,
      }
      if (editing) {
        await api.updateWebhook(editing.id, payload)
      } else {
        await api.createWebhook(payload)
      }
      setModalOpen(false)
      await load()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save webhook')
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleEnabled(w: Webhook) {
    setBusy(w.id)
    try {
      await api.updateWebhook(w.id, { enabled: !w.enabled })
      setWebhooks((prev) => prev.map((x) => (x.id === w.id ? { ...x, enabled: !w.enabled } : x)))
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to toggle webhook')
    } finally {
      setBusy(null)
    }
  }

  async function remove(w: Webhook) {
    if (!confirm('Delete this webhook? Delivery history will be lost.')) return
    setBusy(w.id)
    try {
      await api.deleteWebhook(w.id)
      setWebhooks((prev) => prev.filter((x) => x.id !== w.id))
      if (selected?.id === w.id) {
        setSelected(null)
        setDeliveries([])
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete webhook')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-100">Webhooks</h1>
          <p className="mt-1 text-sm text-neutral-400">
            Register outbound endpoints and inspect delivery history for workspace events.
          </p>
        </div>
        <Button onClick={openCreate} disabled={loading}>
          + New webhook
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Stat label="Webhooks" value={stats.count} />
        <Stat label="Enabled" value={stats.active} tone="green" />
        <Stat label="Event types subscribed" value={stats.totalEvents} tone="violet" />
      </div>

      {/* Registry */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-neutral-200">Registry</h2>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="flex justify-center py-16">
              <Spinner label="Loading webhooks..." />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm text-rose-300">{error}</p>
              <Button variant="secondary" onClick={load}>
                Retry
              </Button>
            </div>
          ) : webhooks.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No webhooks registered"
                description="Add a webhook to receive event notifications at your endpoint."
                icon="🔗"
                action={<Button onClick={openCreate}>Register first webhook</Button>}
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Endpoint</TH>
                  <TH>Events</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {webhooks.map((w) => (
                  <TR
                    key={w.id}
                    className={selected?.id === w.id ? 'bg-orange-500/5' : ''}
                  >
                    <TD className="max-w-xs">
                      <span className="break-all font-mono text-xs text-neutral-200">{w.url}</span>
                    </TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {asArray<string>(w.events)
                          .slice(0, 3)
                          .map((ev) => (
                            <Badge key={ev} tone="sky">
                              {ev}
                            </Badge>
                          ))}
                        {asArray<string>(w.events).length > 3 && (
                          <Badge tone="neutral">+{asArray<string>(w.events).length - 3}</Badge>
                        )}
                      </div>
                    </TD>
                    <TD>
                      <Badge tone={w.enabled ? 'green' : 'neutral'}>
                        {w.enabled ? 'Enabled' : 'Disabled'}
                      </Badge>
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="secondary"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => loadDeliveries(w)}
                        >
                          Deliveries
                        </Button>
                        <Button
                          variant="secondary"
                          className="px-3 py-1.5 text-xs"
                          disabled={busy === w.id}
                          onClick={() => toggleEnabled(w)}
                        >
                          {w.enabled ? 'Disable' : 'Enable'}
                        </Button>
                        <Button
                          variant="secondary"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => openEdit(w)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          className="px-3 py-1.5 text-xs"
                          disabled={busy === w.id}
                          onClick={() => remove(w)}
                        >
                          {busy === w.id ? '...' : 'Delete'}
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

      {/* Delivery log */}
      {selected && (
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-neutral-200">Delivery log</h2>
              <p className="mt-1 break-all text-xs text-neutral-500">{selected.url}</p>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200 focus:border-orange-500 focus:outline-none"
              >
                <option value="all">All statuses</option>
                <option value="green">Success</option>
                <option value="rose">Failed</option>
                <option value="amber">Pending</option>
              </select>
              <Button
                variant="secondary"
                className="px-3 py-1.5 text-xs"
                onClick={() => loadDeliveries(selected)}
              >
                Refresh
              </Button>
              <Button
                variant="ghost"
                className="px-3 py-1.5 text-xs"
                onClick={() => {
                  setSelected(null)
                  setDeliveries([])
                }}
              >
                Close
              </Button>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            {delLoading ? (
              <div className="flex justify-center py-12">
                <Spinner label="Loading deliveries..." />
              </div>
            ) : delError ? (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <p className="text-sm text-rose-300">{delError}</p>
                <Button variant="secondary" onClick={() => loadDeliveries(selected)}>
                  Retry
                </Button>
              </div>
            ) : deliveries.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  title="No deliveries yet"
                  description="Deliveries will appear here once events fire for this webhook."
                  icon="📭"
                />
              </div>
            ) : filteredDeliveries.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No matching deliveries" description="Try a different status filter." icon="∅" />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Event</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Response</TH>
                    <TH>Time</TH>
                  </TR>
                </THead>
                <TBody>
                  {filteredDeliveries.map((d) => (
                    <TR key={d.id}>
                      <TD className="font-mono text-xs text-neutral-200">{d.event}</TD>
                      <TD>
                        <Badge tone={deliveryTone(d.status, d.response_code)}>{d.status}</Badge>
                      </TD>
                      <TD className="text-right tabular-nums text-neutral-300">
                        {d.response_code ?? '—'}
                      </TD>
                      <TD className="text-neutral-400">{new Date(d.created_at).toLocaleString()}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}

      <Modal
        open={modalOpen}
        onClose={() => !submitting && setModalOpen(false)}
        title={editing ? 'Edit webhook' : 'New webhook'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? 'Saving...' : editing ? 'Save changes' : 'Register'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
              Endpoint URL
            </label>
            <input
              value={form.url}
              onChange={(e) => setForm({ ...form, url: e.target.value })}
              placeholder="https://hooks.example.com/comp-equity"
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
              Events
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {EVENT_TYPES.map((ev) => (
                <label
                  key={ev}
                  className="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-300"
                >
                  <input
                    type="checkbox"
                    checked={form.events.includes(ev)}
                    onChange={() => toggleEvent(ev)}
                    className="accent-orange-500"
                  />
                  {ev}
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-400">
              Signing secret (optional)
            </label>
            <input
              value={form.secret}
              onChange={(e) => setForm({ ...form, secret: e.target.value })}
              placeholder="whsec_..."
              className={inputCls}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              className="accent-orange-500"
            />
            Enabled
          </label>
          {formError && <p className="text-sm text-rose-300">{formError}</p>}
        </div>
      </Modal>
    </div>
  )
}
