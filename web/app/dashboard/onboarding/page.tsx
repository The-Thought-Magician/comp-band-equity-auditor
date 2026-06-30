'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'

interface SampleStatus {
  hasData: boolean
}

interface Dataset {
  id: string
  version: number | string
  label: string
}

interface BandSet {
  id: string
  version: number | string
  label: string
  status: string
}

interface EngineRun {
  id: string
  label: string
  status: string
}

interface GapRun {
  id: string
  reference_group: string
  status: string
}

interface StepDef {
  key: string
  title: string
  description: string
  done: boolean
  href: string
  cta: string
  count?: number
}

export default function OnboardingPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [hasData, setHasData] = useState(false)
  const [datasets, setDatasets] = useState<Dataset[]>([])
  const [bandSets, setBandSets] = useState<BandSet[]>([])
  const [engineRuns, setEngineRuns] = useState<EngineRun[]>([])
  const [gapRuns, setGapRuns] = useState<GapRun[]>([])

  const [seeding, setSeeding] = useState(false)
  const [seedMsg, setSeedMsg] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [status, ds, bs, er, gr] = await Promise.all([
        api.getSampleStatus().catch(() => ({ hasData: false })),
        api.getDatasets().catch(() => []),
        api.getBandSets().catch(() => []),
        api.getEngineRuns().catch(() => []),
        api.getGapRuns().catch(() => []),
      ])
      setHasData(Boolean((status as SampleStatus)?.hasData))
      setDatasets(Array.isArray(ds) ? ds : [])
      setBandSets(Array.isArray(bs) ? bs : [])
      setEngineRuns(Array.isArray(er) ? er : [])
      setGapRuns(Array.isArray(gr) ? gr : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load onboarding status')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handleSeed() {
    setSeedMsg(null)
    setSeeding(true)
    try {
      const res = await api.seedSample()
      setSeedMsg(
        res?.seeded === false
          ? 'Workspace already has data; sample was not re-seeded.'
          : 'Sample organization seeded. ~80 employees, a band set, and planted gaps are ready.',
      )
      await load()
    } catch (e) {
      setSeedMsg(e instanceof Error ? e.message : 'Failed to seed sample data')
    } finally {
      setSeeding(false)
    }
  }

  const steps: StepDef[] = useMemo(() => {
    const dataDone = hasData || datasets.length > 0
    const publishedBands = bandSets.some((b) => b.status === 'published')
    return [
      {
        key: 'seed',
        title: 'Load a dataset',
        description:
          'Seed the synthetic ~80-person org with planted outliers and a gender gap, or upload your own headcount file.',
        done: dataDone,
        href: '/dashboard/datasets',
        cta: 'Go to datasets',
        count: datasets.length,
      },
      {
        key: 'band',
        title: 'Define comp bands',
        description:
          'Set salary min/mid/max ranges per level, role family, and geo. Publish a band set to lock it for analysis.',
        done: bandSets.length > 0,
        href: '/dashboard/bands',
        cta: 'Build bands',
        count: bandSets.length,
      },
      {
        key: 'engine',
        title: 'Run the positioning engine',
        description:
          'Compute compa-ratios and range penetration for every employee against a published band set.',
        done: engineRuns.length > 0,
        href: '/dashboard/positioning',
        cta: 'Run engine',
        count: engineRuns.length,
      },
      {
        key: 'gap',
        title: 'Analyze pay gaps',
        description:
          'Decompose raw vs. adjusted pay gaps by gender, ethnicity, and other dimensions with explained/unexplained splits.',
        done: gapRuns.length > 0,
        href: '/dashboard/gaps',
        cta: 'Analyze gaps',
        count: gapRuns.length,
      },
      {
        key: 'scenario',
        title: 'Model a remediation scenario',
        description:
          'Build a what-if budget to close unexplained gaps, then export an evidence pack for sign-off.',
        done: false,
        href: '/dashboard/scenarios',
        cta: 'Build scenario',
      },
      // hint that band publish is recommended before engine
    ].map((s) =>
      s.key === 'engine' && !publishedBands && bandSets.length > 0 && engineRuns.length === 0
        ? { ...s, description: s.description + ' Tip: publish a band set first for an immutable baseline.' }
        : s,
    )
  }, [hasData, datasets, bandSets, engineRuns, gapRuns])

  const completed = steps.filter((s) => s.done).length
  const total = steps.length
  const pct = Math.round((completed / total) * 100)
  const nextStep = steps.find((s) => !s.done)

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner label="Loading onboarding..." />
      </div>
    )
  }

  if (error) {
    return (
      <Card>
        <CardBody>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-rose-300">{error}</p>
            <Button variant="secondary" onClick={load}>
              Retry
            </Button>
          </div>
        </CardBody>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">Get started</h1>
        <p className="mt-1 text-sm text-slate-400">
          Five steps from an empty workspace to a defensible pay-equity audit. Seed sample data to explore
          end to end in minutes.
        </p>
      </div>

      {/* Progress + seed CTA */}
      <Card>
        <CardBody className="space-y-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-200">
                  {completed === total ? 'All set!' : `${completed} of ${total} steps complete`}
                </span>
                <span className="text-sm font-semibold text-violet-300">{pct}%</span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-600 to-violet-400 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
            <div className="flex flex-col items-start gap-1 sm:items-end">
              <Button onClick={handleSeed} disabled={seeding}>
                {seeding ? 'Seeding...' : hasData ? 'Re-seed sample' : 'Seed sample org'}
              </Button>
              <span className="text-xs text-slate-500">
                {hasData ? 'Workspace already has data' : 'Synthetic ~80-employee dataset'}
              </span>
            </div>
          </div>
          {seedMsg && <p className="text-sm text-violet-300">{seedMsg}</p>}
          {nextStep && (
            <div className="flex items-center justify-between rounded-lg border border-violet-500/30 bg-violet-500/10 px-4 py-3">
              <div className="text-sm text-slate-200">
                <span className="text-slate-400">Next up:</span>{' '}
                <span className="font-medium">{nextStep.title}</span>
              </div>
              <Link href={nextStep.href}>
                <Button variant="secondary" className="px-3 py-1.5 text-xs">
                  {nextStep.cta}
                </Button>
              </Link>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Checklist */}
      <Card>
        <CardHeader>
          <h2 className="text-base font-semibold text-slate-100">Setup checklist</h2>
        </CardHeader>
        <CardBody className="space-y-3">
          {steps.map((s, i) => (
            <div
              key={s.key}
              className={`flex items-start gap-4 rounded-xl border px-4 py-4 ${
                s.done
                  ? 'border-emerald-500/30 bg-emerald-500/5'
                  : 'border-slate-800 bg-slate-900/40'
              }`}
            >
              <div
                className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
                  s.done
                    ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300'
                    : 'border-slate-700 bg-slate-800 text-slate-400'
                }`}
              >
                {s.done ? '✓' : i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-slate-100">{s.title}</h3>
                  {s.done ? (
                    <Badge tone="green">Done</Badge>
                  ) : (
                    <Badge tone="neutral">Pending</Badge>
                  )}
                  {typeof s.count === 'number' && s.count > 0 && (
                    <span className="text-xs text-slate-500">
                      {s.count} {s.count === 1 ? 'item' : 'items'}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-400">{s.description}</p>
              </div>
              <div className="flex-shrink-0">
                <Link href={s.href}>
                  <Button variant={s.done ? 'ghost' : 'secondary'} className="px-3 py-1.5 text-xs">
                    {s.done ? 'View' : s.cta}
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </CardBody>
      </Card>

      {/* Quick links */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link href="/dashboard">
          <Card className="h-full transition-colors hover:border-violet-500/40">
            <CardBody>
              <div className="text-sm font-medium text-slate-100">Dashboard</div>
              <p className="mt-1 text-xs text-slate-500">KPI tiles and outlier board.</p>
            </CardBody>
          </Card>
        </Link>
        <Link href="/dashboard/evidence">
          <Card className="h-full transition-colors hover:border-violet-500/40">
            <CardBody>
              <div className="text-sm font-medium text-slate-100">Evidence packs</div>
              <p className="mt-1 text-xs text-slate-500">Auditable methodology + sign-off.</p>
            </CardBody>
          </Card>
        </Link>
        <Link href="/dashboard/settings">
          <Card className="h-full transition-colors hover:border-violet-500/40">
            <CardBody>
              <div className="text-sm font-medium text-slate-100">Settings</div>
              <p className="mt-1 text-xs text-slate-500">Currency, FX, tags, billing.</p>
            </CardBody>
          </Card>
        </Link>
      </div>
    </div>
  )
}
