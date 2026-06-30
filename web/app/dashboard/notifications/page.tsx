'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import api from '@/lib/api'
import { authClient } from '@/lib/auth/client'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'

interface Notification {
  id: string
  type?: string | null
  title: string
  body?: string | null
  read?: boolean
  created_at?: string
}

function fmtDate(v?: string): string {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString()
}

function typeTone(type?: string | null): 'green' | 'amber' | 'rose' | 'sky' | 'violet' | 'neutral' {
  const t = (type ?? '').toLowerCase()
  if (t.includes('error') || t.includes('fail') || t.includes('alert') || t.includes('guardrail')) return 'rose'
  if (t.includes('warn') || t.includes('gap') || t.includes('outlier')) return 'amber'
  if (t.includes('success') || t.includes('complete') || t.includes('done')) return 'green'
  if (t.includes('engine') || t.includes('run') || t.includes('scenario')) return 'sky'
  if (t.includes('evidence') || t.includes('attest') || t.includes('publish')) return 'violet'
  return 'neutral'
}

function typeIcon(type?: string | null): string {
  const t = (type ?? '').toLowerCase()
  if (t.includes('error') || t.includes('fail') || t.includes('alert')) return '⚠️'
  if (t.includes('guardrail')) return '🛡️'
  if (t.includes('gap') || t.includes('outlier')) return '📉'
  if (t.includes('engine') || t.includes('run')) return '⚙️'
  if (t.includes('evidence') || t.includes('attest')) return '📑'
  if (t.includes('scenario') || t.includes('merit')) return '🧮'
  if (t.includes('success') || t.includes('complete')) return '✅'
  return '🔔'
}

export default function NotificationsPage() {
  const router = useRouter()
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'all' | 'unread'>('all')
  const [typeFilter, setTypeFilter] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [markingAll, setMarkingAll] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const r = await api.getNotifications()
      setItems(Array.isArray(r) ? r : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notifications')
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

  async function markRead(n: Notification) {
    if (n.read) return
    setBusyId(n.id)
    // optimistic
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
    try {
      await api.markNotificationRead(n.id)
    } catch (e) {
      // revert
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: false } : x)))
      setError(e instanceof Error ? e.message : 'Failed to mark as read')
    } finally {
      setBusyId(null)
    }
  }

  async function markAll() {
    if (unreadCount === 0) return
    setMarkingAll(true)
    const snapshot = items
    setItems((prev) => prev.map((x) => ({ ...x, read: true })))
    try {
      await api.markAllNotificationsRead()
    } catch (e) {
      setItems(snapshot)
      setError(e instanceof Error ? e.message : 'Failed to mark all as read')
    } finally {
      setMarkingAll(false)
    }
  }

  const types = useMemo(
    () => Array.from(new Set(items.map((n) => n.type).filter(Boolean) as string[])).sort(),
    [items],
  )

  const unreadCount = useMemo(() => items.filter((n) => !n.read).length, [items])

  const filtered = useMemo(() => {
    return items.filter((n) => {
      if (tab === 'unread' && n.read) return false
      if (typeFilter && n.type !== typeFilter) return false
      return true
    })
  }, [items, tab, typeFilter])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Notifications</h1>
          <p className="mt-1 text-sm text-slate-400">
            Engine runs, gap flags, guardrail breaches, and sign-off requests land here.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={load} disabled={loading}>
            Refresh
          </Button>
          <Button onClick={markAll} disabled={loading || markingAll || unreadCount === 0}>
            {markingAll ? 'Marking…' : `Mark all read${unreadCount ? ` (${unreadCount})` : ''}`}
          </Button>
        </div>
      </div>

      {!loading && items.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label="Total" value={items.length} tone="violet" />
          <Stat label="Unread" value={unreadCount} tone={unreadCount > 0 ? 'amber' : 'green'} />
          <Stat label="Read" value={items.length - unreadCount} tone="default" />
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-lg border border-slate-700 bg-slate-950 p-0.5 text-sm">
            <button
              onClick={() => setTab('all')}
              className={`rounded-md px-3 py-1 transition-colors ${
                tab === 'all' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All
            </button>
            <button
              onClick={() => setTab('unread')}
              className={`rounded-md px-3 py-1 transition-colors ${
                tab === 'unread' ? 'bg-violet-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Unread{unreadCount ? ` · ${unreadCount}` : ''}
            </button>
          </div>
          {types.length > 0 && (
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-violet-500 focus:outline-none"
            >
              <option value="">All types</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Spinner label="Loading notifications…" />
            </div>
          ) : error ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-rose-300">{error}</p>
              <Button variant="secondary" className="mt-4" onClick={load}>
                Retry
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="You're all caught up"
                description="No notifications yet. We'll let you know when an engine run finishes or a guardrail trips."
                icon={<span>🔔</span>}
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={tab === 'unread' ? 'No unread notifications' : 'Nothing matches this type'}
                description={
                  tab === 'unread'
                    ? 'Everything has been read.'
                    : 'Try a different type filter or switch to All.'
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-slate-800">
              {filtered.map((n) => (
                <li
                  key={n.id}
                  className={`flex items-start gap-3 px-5 py-4 transition-colors ${
                    n.read ? 'bg-transparent' : 'bg-violet-500/5'
                  }`}
                >
                  <div className="mt-0.5 text-xl" aria-hidden>
                    {typeIcon(n.type)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {!n.read && (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full bg-violet-400"
                          aria-label="Unread"
                        />
                      )}
                      <span
                        className={`text-sm font-medium ${n.read ? 'text-slate-300' : 'text-slate-100'}`}
                      >
                        {n.title}
                      </span>
                      {n.type && <Badge tone={typeTone(n.type)}>{n.type}</Badge>}
                    </div>
                    {n.body && <p className="mt-1 text-sm text-slate-400">{n.body}</p>}
                    <p className="mt-1 text-xs text-slate-500">{fmtDate(n.created_at)}</p>
                  </div>
                  {!n.read && (
                    <Button
                      variant="ghost"
                      className="shrink-0 px-2 py-1"
                      disabled={busyId === n.id}
                      onClick={() => markRead(n)}
                    >
                      {busyId === n.id ? '…' : 'Mark read'}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
