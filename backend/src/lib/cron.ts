// ---------------------------------------------------------------------------
// cron.ts — THE ENGINE
//
// Pure, deterministic, self-contained scheduling math used by routes. No
// external services, no DB. Supports three schedule "kinds":
//   - 'cron'   : a standard 5/6-field cron expression (parsed via cron-parser)
//   - 'rate'   : "every N minutes|hours|days" computed arithmetically
//   - 'oneoff' : a single ISO instant
//
// Every function returns plain JSON-serialisable data with explicit types.
// ---------------------------------------------------------------------------

import { CronExpressionParser } from 'cron-parser'

export type ScheduleKind = 'cron' | 'rate' | 'oneoff'

export interface ValidationResult {
  valid: boolean
  error?: string
}

export interface JobInput {
  id: string
  kind: ScheduleKind
  expr: string
  timezone?: string
  resourceId?: string
}

export interface CollisionWindow {
  windowStart: string
  windowEnd: string
  jobIds: string[]
  severity: 'low' | 'medium' | 'high'
  resourceId?: string
}

export interface HeatmapBucket {
  bucket: string
  count: number
}

export type DstTrapType = 'double_fire' | 'skip' | 'ambiguous'

export interface DstTrap {
  type: DstTrapType
  atLocal: string
  atUtc: string
}

export interface CoverageWindow {
  start: string // ISO instant or HH:MM local time-of-day window start
  end: string
  label?: string
}

export interface CoverageGap {
  windowStart: string
  windowEnd: string
  durationMinutes: number
  reason: string
}

export interface SpreadSuggestion {
  jobId: string
  suggestedExpr: string
  reason: string
}

// ---------------------------------------------------------------------------
// internal helpers
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

const RATE_RE = /^every\s+(\d+)\s+(minute|minutes|hour|hours|day|days|min|mins|hr|hrs)$/i

function parseRate(expr: string): { unit: 'minute' | 'hour' | 'day'; n: number } | null {
  const m = RATE_RE.exec(expr.trim())
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n <= 0) return null
  const raw = m[2].toLowerCase()
  let unit: 'minute' | 'hour' | 'day'
  if (raw.startsWith('min')) unit = 'minute'
  else if (raw.startsWith('h')) unit = 'hour'
  else unit = 'day'
  return { unit, n }
}

function rateStepMs(unit: 'minute' | 'hour' | 'day', n: number): number {
  if (unit === 'minute') return n * MINUTE_MS
  if (unit === 'hour') return n * HOUR_MS
  return n * DAY_MS
}

function safeDate(iso: string): Date {
  const d = new Date(iso)
  if (isNaN(d.getTime())) throw new Error(`Invalid ISO instant: ${iso}`)
  return d
}

/** Floor an instant to the start of its UTC minute, returned as ISO. */
function minuteKey(d: Date): string {
  const t = Math.floor(d.getTime() / MINUTE_MS) * MINUTE_MS
  return new Date(t).toISOString()
}

/**
 * Offset (in minutes) of a UTC instant within a given IANA timezone.
 * Positive = east of UTC. Uses Intl with no external deps.
 */
function tzOffsetMinutes(date: Date, timeZone: string): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const parts = dtf.formatToParts(date)
    const map: Record<string, number> = {}
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = parseInt(p.value, 10)
    }
    // Treat the wall-clock components as if they were UTC, then diff.
    const asUtc = Date.UTC(
      map.year,
      (map.month ?? 1) - 1,
      map.day ?? 1,
      map.hour === 24 ? 0 : map.hour ?? 0,
      map.minute ?? 0,
      map.second ?? 0,
    )
    return Math.round((asUtc - date.getTime()) / MINUTE_MS)
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// validateExpression
// ---------------------------------------------------------------------------

export function validateExpression(kind: ScheduleKind, expr: string): ValidationResult {
  const e = (expr ?? '').trim()
  if (!e) return { valid: false, error: 'Expression is empty' }

  if (kind === 'cron') {
    try {
      CronExpressionParser.parse(e)
      return { valid: true }
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  if (kind === 'rate') {
    const parsed = parseRate(e)
    if (!parsed) return { valid: false, error: 'Rate must be "every N minutes|hours|days"' }
    return { valid: true }
  }

  if (kind === 'oneoff') {
    const d = new Date(e)
    if (isNaN(d.getTime())) return { valid: false, error: 'One-off must be a valid ISO instant' }
    return { valid: true }
  }

  return { valid: false, error: `Unknown kind: ${kind}` }
}

// ---------------------------------------------------------------------------
// describeExpression
// ---------------------------------------------------------------------------

const FIELD_NAMES = ['minute', 'hour', 'day-of-month', 'month', 'day-of-week']

export function describeExpression(kind: ScheduleKind, expr: string, timezone = 'UTC'): string {
  const e = (expr ?? '').trim()
  const valid = validateExpression(kind, e)
  if (!valid.valid) return `Invalid (${valid.error})`

  if (kind === 'rate') {
    const parsed = parseRate(e)!
    const plural = parsed.n === 1 ? parsed.unit : `${parsed.unit}s`
    return `Every ${parsed.n} ${plural} (${timezone})`
  }

  if (kind === 'oneoff') {
    return `Once at ${new Date(e).toISOString()} (UTC)`
  }

  // cron
  const fields = e.split(/\s+/)
  // Handle 5- and 6-field (with seconds) cron forms gracefully.
  const offset = fields.length >= 6 ? 1 : 0
  const min = fields[offset] ?? '*'
  const hr = fields[offset + 1] ?? '*'
  const dom = fields[offset + 2] ?? '*'
  const mon = fields[offset + 3] ?? '*'
  const dow = fields[offset + 4] ?? '*'

  const parts: string[] = []
  if (min === '*' && hr === '*') parts.push('every minute')
  else if (min !== '*' && hr === '*') parts.push(`at minute ${min} of every hour`)
  else if (hr !== '*' && min === '0') parts.push(`at ${hr}:00`)
  else parts.push(`at ${hr === '*' ? 'every hour' : hr}:${min === '*' ? '00' : min.padStart(2, '0')}`)

  if (dom !== '*') parts.push(`on day-of-month ${dom}`)
  if (mon !== '*') parts.push(`in month ${mon}`)
  if (dow !== '*') parts.push(`on day-of-week ${dow}`)

  const fieldList = FIELD_NAMES.slice(0, 5)
    .map((name, i) => `${name}=${[min, hr, dom, mon, dow][i]}`)
    .join(', ')

  return `Runs ${parts.join(', ')} (${timezone}) [${fieldList}]`
}

// ---------------------------------------------------------------------------
// nextFirings
// ---------------------------------------------------------------------------

export function nextFirings(
  kind: ScheduleKind,
  expr: string,
  timezone = 'UTC',
  fromISO?: string,
  count = 10,
): string[] {
  const from = fromISO ? safeDate(fromISO) : new Date()
  const n = Math.max(0, Math.min(count, 1000))
  if (n === 0) return []

  if (kind === 'cron') {
    try {
      const it = CronExpressionParser.parse(expr.trim(), {
        tz: timezone,
        currentDate: new Date(from.getTime()),
      })
      const out: string[] = []
      for (let i = 0; i < n; i++) {
        const next = it.next().toDate()
        out.push(next.toISOString())
      }
      return out
    } catch {
      return []
    }
  }

  if (kind === 'rate') {
    const parsed = parseRate(expr)
    if (!parsed) return []
    const step = rateStepMs(parsed.unit, parsed.n)
    const out: string[] = []
    let t = from.getTime() + step
    for (let i = 0; i < n; i++) {
      out.push(new Date(t).toISOString())
      t += step
    }
    return out
  }

  if (kind === 'oneoff') {
    const d = new Date(expr.trim())
    if (isNaN(d.getTime())) return []
    return d.getTime() > from.getTime() ? [d.toISOString()] : []
  }

  return []
}

// ---------------------------------------------------------------------------
// computeCollisions
// ---------------------------------------------------------------------------

export function computeCollisions(
  jobs: JobInput[],
  opts: { horizonDays?: number; threshold?: number } = {},
): CollisionWindow[] {
  const horizonDays = opts.horizonDays ?? 7
  const threshold = opts.threshold ?? 2
  const fromISO = new Date().toISOString()
  const horizonEnd = Date.now() + horizonDays * DAY_MS

  // For each job, enumerate firings within the horizon and bucket by minute.
  // bucket -> { jobIds:Set, resources: Map<resourceId, Set<jobId>> }
  const buckets = new Map<string, { jobIds: Set<string>; resources: Map<string, Set<string>> }>()

  for (const job of jobs) {
    // Generous per-job cap so a 1-minute rate over a week stays bounded.
    const firings = nextFirings(job.kind, job.expr, job.timezone ?? 'UTC', fromISO, 5000)
    for (const f of firings) {
      const t = new Date(f).getTime()
      if (t > horizonEnd) break
      const key = minuteKey(new Date(t))
      let entry = buckets.get(key)
      if (!entry) {
        entry = { jobIds: new Set(), resources: new Map() }
        buckets.set(key, entry)
      }
      entry.jobIds.add(job.id)
      if (job.resourceId) {
        let rset = entry.resources.get(job.resourceId)
        if (!rset) {
          rset = new Set()
          entry.resources.set(job.resourceId, rset)
        }
        rset.add(job.id)
      }
    }
  }

  const out: CollisionWindow[] = []
  for (const [key, entry] of buckets) {
    const concurrency = entry.jobIds.size

    // Resource contention: any resource shared by >= 2 jobs in the same minute.
    let contendedResource: string | undefined
    for (const [rid, set] of entry.resources) {
      if (set.size >= 2) {
        contendedResource = rid
        break
      }
    }

    const flaggedByConcurrency = concurrency >= threshold
    const flaggedByResource = contendedResource !== undefined
    if (!flaggedByConcurrency && !flaggedByResource) continue

    const start = new Date(key)
    const end = new Date(start.getTime() + MINUTE_MS)

    let severity: CollisionWindow['severity'] = 'low'
    if (flaggedByResource) severity = 'high'
    else if (concurrency >= threshold + 2) severity = 'high'
    else if (concurrency >= threshold + 1) severity = 'medium'

    out.push({
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      jobIds: [...entry.jobIds].sort(),
      severity,
      resourceId: contendedResource,
    })
  }

  out.sort((a, b) => a.windowStart.localeCompare(b.windowStart))
  return out
}

// ---------------------------------------------------------------------------
// loadHeatmap
// ---------------------------------------------------------------------------

export function loadHeatmap(
  jobs: JobInput[],
  opts: { horizonDays?: number } = {},
): HeatmapBucket[] {
  const horizonDays = opts.horizonDays ?? 7
  const fromISO = new Date().toISOString()
  const horizonEnd = Date.now() + horizonDays * DAY_MS

  // Bucket by hour for a readable heatmap.
  const counts = new Map<string, number>()
  for (const job of jobs) {
    const firings = nextFirings(job.kind, job.expr, job.timezone ?? 'UTC', fromISO, 5000)
    for (const f of firings) {
      const t = new Date(f).getTime()
      if (t > horizonEnd) break
      const hour = new Date(Math.floor(t / HOUR_MS) * HOUR_MS).toISOString()
      counts.set(hour, (counts.get(hour) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket))
}

// ---------------------------------------------------------------------------
// dstTraps
// ---------------------------------------------------------------------------

export function dstTraps(
  kind: ScheduleKind,
  expr: string,
  timezone = 'UTC',
  fromISO?: string,
  days = 365,
): DstTrap[] {
  const from = fromISO ? safeDate(fromISO) : new Date()
  const out: DstTrap[] = []
  if (timezone === 'UTC') return out // UTC never has DST transitions.

  // Walk the window hour-by-hour, detecting offset changes between consecutive
  // hours. A forward jump (spring) => skipped local hour. A backward jump
  // (fall) => repeated/ambiguous local hour.
  const end = from.getTime() + days * DAY_MS
  let prev = new Date(from.getTime())
  let prevOffset = tzOffsetMinutes(prev, timezone)

  // collect firing minutes for the schedule so we can decide double_fire / skip
  const firingSet = new Set(
    nextFirings(kind, expr, timezone, from.toISOString(), 100000).map((iso) =>
      minuteKey(new Date(iso)),
    ),
  )

  for (let t = from.getTime() + HOUR_MS; t <= end; t += HOUR_MS) {
    const cur = new Date(t)
    const curOffset = tzOffsetMinutes(cur, timezone)
    if (curOffset !== prevOffset) {
      const delta = curOffset - prevOffset
      const atUtc = cur.toISOString()
      const atLocalMs = cur.getTime() + curOffset * MINUTE_MS
      const atLocal = new Date(atLocalMs).toISOString().replace('Z', '')

      if (delta > 0) {
        // clock sprang forward — a local hour does not exist (skip)
        // If the schedule would have fired in the skipped window, it is skipped.
        const skippedFires = [...firingSet].some((k) => {
          const kt = new Date(k).getTime()
          return kt >= prev.getTime() && kt < cur.getTime()
        })
        out.push({ type: skippedFires ? 'skip' : 'ambiguous', atLocal, atUtc })
      } else {
        // clock fell back — a local hour repeats (ambiguous / potential double fire)
        const doubleFires = [...firingSet].some((k) => {
          const kt = new Date(k).getTime()
          return kt >= prev.getTime() && kt < cur.getTime() + HOUR_MS
        })
        out.push({ type: doubleFires ? 'double_fire' : 'ambiguous', atLocal, atUtc })
      }
      prevOffset = curOffset
    }
    prev = cur
  }

  return out
}

// ---------------------------------------------------------------------------
// coverageGaps
// ---------------------------------------------------------------------------

/**
 * Given desired coverage windows (ISO instant ranges within the horizon) and a
 * set of jobs, return the sub-windows during which no job fires. Coverage means
 * "at least one firing inside the window". Gaps are reported as the spans of
 * any coverage window that contain zero firings.
 */
export function coverageGaps(
  windows: CoverageWindow[],
  jobs: JobInput[],
  opts: { horizonDays?: number } = {},
): CoverageGap[] {
  const horizonDays = opts.horizonDays ?? 7
  const now = Date.now()
  const horizonEnd = now + horizonDays * DAY_MS
  const fromISO = new Date(now).toISOString()

  // Collect all firing instants within the horizon.
  const fires: number[] = []
  for (const job of jobs) {
    const firings = nextFirings(job.kind, job.expr, job.timezone ?? 'UTC', fromISO, 5000)
    for (const f of firings) {
      const t = new Date(f).getTime()
      if (t > horizonEnd) break
      fires.push(t)
    }
  }
  fires.sort((a, b) => a - b)

  const out: CoverageGap[] = []
  for (const w of windows) {
    const ws = new Date(w.start).getTime()
    const we = new Date(w.end).getTime()
    if (isNaN(ws) || isNaN(we) || we <= ws) continue

    const inWindow = fires.filter((t) => t >= ws && t <= we)
    if (inWindow.length === 0) {
      out.push({
        windowStart: new Date(ws).toISOString(),
        windowEnd: new Date(we).toISOString(),
        durationMinutes: Math.round((we - ws) / MINUTE_MS),
        reason: w.label ? `No firings during "${w.label}"` : 'No firings during window',
      })
      continue
    }

    // Find internal gaps between the window edges and consecutive firings.
    let cursor = ws
    for (const t of inWindow) {
      if (t - cursor > MINUTE_MS) {
        out.push({
          windowStart: new Date(cursor).toISOString(),
          windowEnd: new Date(t).toISOString(),
          durationMinutes: Math.round((t - cursor) / MINUTE_MS),
          reason: w.label ? `Coverage gap within "${w.label}"` : 'Coverage gap within window',
        })
      }
      cursor = t
    }
    if (we - cursor > MINUTE_MS) {
      out.push({
        windowStart: new Date(cursor).toISOString(),
        windowEnd: new Date(we).toISOString(),
        durationMinutes: Math.round((we - cursor) / MINUTE_MS),
        reason: w.label ? `Trailing gap within "${w.label}"` : 'Trailing gap within window',
      })
    }
  }

  out.sort((a, b) => a.windowStart.localeCompare(b.windowStart))
  return out
}

// ---------------------------------------------------------------------------
// autoSpread
// ---------------------------------------------------------------------------

/**
 * Suggest de-conflicted schedules for jobs that collide. Strategy: for any job
 * participating in an over-threshold minute, shift its cron minute field (or
 * its rate phase) by a deterministic per-job offset so the fleet fans out.
 */
export function autoSpread(
  jobs: JobInput[],
  opts: { threshold?: number; horizonDays?: number } = {},
): SpreadSuggestion[] {
  const threshold = opts.threshold ?? 2
  const collisions = computeCollisions(jobs, {
    threshold,
    horizonDays: opts.horizonDays ?? 7,
  })

  // Identify jobs implicated in any collision, preserving first-seen order.
  const implicated: string[] = []
  const seen = new Set<string>()
  for (const col of collisions) {
    for (const id of col.jobIds) {
      if (!seen.has(id)) {
        seen.add(id)
        implicated.push(id)
      }
    }
  }

  const jobMap = new Map(jobs.map((j) => [j.id, j]))
  const out: SpreadSuggestion[] = []

  // Keep the first job on its slot; fan the rest out across the hour.
  implicated.forEach((id, idx) => {
    const job = jobMap.get(id)
    if (!job) return
    if (idx === 0) return // anchor — no change needed

    const minuteOffset = (idx * 7) % 60 // deterministic, coprime-ish spread

    if (job.kind === 'cron') {
      const fields = job.expr.trim().split(/\s+/)
      const base = fields.length >= 6 ? 1 : 0
      // Set an explicit minute to spread firings off the shared slot.
      if (fields.length >= 5 + base) {
        fields[base] = String(minuteOffset)
        out.push({
          jobId: id,
          suggestedExpr: fields.join(' '),
          reason: `Shift minute to ${minuteOffset} to avoid the shared firing slot`,
        })
      } else {
        out.push({
          jobId: id,
          suggestedExpr: job.expr,
          reason: 'Could not rewrite cron expression; manual review needed',
        })
      }
    } else if (job.kind === 'rate') {
      // Rate jobs cannot be phase-shifted via the expression alone; suggest a
      // cron equivalent pinned to an offset minute.
      const parsed = parseRate(job.expr)
      if (parsed && parsed.unit === 'hour') {
        out.push({
          jobId: id,
          suggestedExpr: `${minuteOffset} */${parsed.n} * * *`,
          reason: `Convert hourly rate to cron at minute ${minuteOffset} to de-conflict`,
        })
      } else if (parsed && parsed.unit === 'minute') {
        out.push({
          jobId: id,
          suggestedExpr: job.expr,
          reason: 'High-frequency rate job; stagger start time or reduce frequency',
        })
      } else {
        out.push({
          jobId: id,
          suggestedExpr: job.expr,
          reason: 'Daily rate job; pin to an off-peak hour to de-conflict',
        })
      }
    } else {
      out.push({
        jobId: id,
        suggestedExpr: job.expr,
        reason: 'One-off job; reschedule to a quieter instant',
      })
    }
  })

  return out
}
