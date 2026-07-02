'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'

interface EngineRun {
  id: string
  status?: string
  created_at?: string
  dataset_id?: string
  band_set_id?: string
}

interface AuditEntry {
  id: string
  action?: string
  event?: string
  created_at?: string
  actor?: string
}

function runTone(status?: string): 'green' | 'amber' | 'rose' | 'neutral' {
  const s = (status || '').toLowerCase()
  if (s.includes('complete') || s.includes('success')) return 'green'
  if (s.includes('fail') || s.includes('error')) return 'rose'
  if (s.includes('pending') || s.includes('running')) return 'amber'
  return 'neutral'
}

function fmtDate(v?: string): string {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * Persistent contextual sidebar. Pulls real supplementary data from
 * existing backend endpoints only (no fabricated data, no new routes):
 * - GET /api/proxy/engine/runs  -> recent positioning engine runs
 * - GET /api/proxy/auditlog     -> recent governance/audit events
 */
export default function RightRail() {
  const [runs, setRuns] = useState<EngineRun[]>([])
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const [r, a] = await Promise.all([
        api.getEngineRuns().catch(() => null),
        api.getAuditLog({ limit: 5 }).catch(() => null),
      ])
      if (cancelled) return
      const runList = Array.isArray(r) ? r : (r as { runs?: EngineRun[] } | null)?.runs
      const auditList = Array.isArray(a) ? a : (a as { entries?: AuditEntry[] } | null)?.entries
      setRuns(Array.isArray(runList) ? runList.slice(0, 5) : [])
      setAuditEntries(Array.isArray(auditList) ? auditList.slice(0, 5) : [])
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <aside className="hidden w-72 shrink-0 space-y-4 xl:block">
      <Card>
        <CardHeader>
          <h2 className="text-sm font-bold tracking-tight text-neutral-100">Recent engine runs</h2>
          <p className="mt-0.5 text-xs text-neutral-500">Latest positioning runs across your workspace</p>
        </CardHeader>
        <CardBody className="space-y-3">
          {loading ? (
            <p className="text-xs text-neutral-500">Loading...</p>
          ) : runs.length === 0 ? (
            <p className="text-xs text-neutral-500">No engine runs yet.</p>
          ) : (
            runs.map((run) => (
              <div key={run.id} className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-neutral-300">{run.id.slice(0, 8)}</div>
                  <div className="text-[11px] text-neutral-500">{fmtDate(run.created_at)}</div>
                </div>
                <Badge tone={runTone(run.status)}>{run.status ?? 'unknown'}</Badge>
              </div>
            ))
          )}
          <Link href="/dashboard/positioning" className="block pt-1 text-xs font-medium text-orange-400 hover:text-orange-300">
            View positioning →
          </Link>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-bold tracking-tight text-neutral-100">Audit activity</h2>
          <p className="mt-0.5 text-xs text-neutral-500">Latest entries in the governance log</p>
        </CardHeader>
        <CardBody className="space-y-3">
          {loading ? (
            <p className="text-xs text-neutral-500">Loading...</p>
          ) : auditEntries.length === 0 ? (
            <p className="text-xs text-neutral-500">No audit entries yet.</p>
          ) : (
            auditEntries.map((e) => (
              <div key={e.id}>
                <div className="text-xs font-medium text-neutral-300">{e.action ?? e.event ?? 'Event'}</div>
                <div className="text-[11px] text-neutral-500">
                  {e.actor ? `${e.actor} · ` : ''}
                  {fmtDate(e.created_at)}
                </div>
              </div>
            ))
          )}
          <Link href="/dashboard/audit-log" className="block pt-1 text-xs font-medium text-orange-400 hover:text-orange-300">
            View full log →
          </Link>
        </CardBody>
      </Card>
    </aside>
  )
}
