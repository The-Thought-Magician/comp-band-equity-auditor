'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'

const freeFeatures = [
  'Unlimited dataset versions and employee records',
  'Version-controlled comp-band designer with lint + diff',
  'Compa-ratio & range-penetration engine',
  'Deterministic cohort pay-gap analysis with decomposition',
  'Remediation cost simulator and scenario comparison',
  'Offer-vs-band guardrails and merit-cycle planner',
  'Board-ready evidence packs with sign-off workflow',
  'Webhooks, scoped API keys, and full audit log',
]

export default function Pricing() {
  const [stripeEnabled, setStripeEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .getBillingPlan()
      .then((res) => {
        if (!cancelled) setStripeEnabled(Boolean(res?.stripeEnabled))
      })
      .catch(() => {
        if (!cancelled) setStripeEnabled(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <nav className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-600 text-sm font-black">
            C
          </span>
          <span className="text-orange-300">CompBandEquityAuditor</span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/auth/sign-in" className="text-neutral-300 hover:text-white">
            Sign In
          </Link>
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-orange-600 px-4 py-2 font-medium text-white hover:bg-orange-500"
          >
            Get Started
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-5xl px-6 py-20 text-center">
        <h1 className="text-4xl font-black tracking-tight">Simple, transparent pricing</h1>
        <p className="mx-auto mt-4 max-w-xl text-neutral-400">
          Every feature is free while we are in beta. Pro billing is wired but disabled until Stripe
          is configured.
        </p>

        <div className="mx-auto mt-12 grid max-w-3xl gap-6 md:grid-cols-2">
          {/* Free */}
          <div className="flex flex-col rounded-2xl border border-orange-500/40 bg-neutral-900/60 p-8 text-left">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-orange-300">Free</h2>
              <span className="rounded-full border border-orange-500/30 bg-orange-500/10 px-2.5 py-0.5 text-xs font-medium text-orange-300">
                Current plan
              </span>
            </div>
            <div className="mt-4 text-4xl font-black">
              $0<span className="text-base font-medium text-neutral-500">/mo</span>
            </div>
            <p className="mt-2 text-sm text-neutral-400">All features, all yours.</p>
            <ul className="mt-6 space-y-2 text-sm text-neutral-300">
              {freeFeatures.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <span className="mt-0.5 text-orange-400">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/auth/sign-up"
              className="mt-8 rounded-lg bg-orange-600 px-4 py-3 text-center font-semibold text-white hover:bg-orange-500"
            >
              Start free
            </Link>
          </div>

          {/* Pro */}
          <div className="flex flex-col rounded-2xl border border-neutral-800 bg-neutral-900/40 p-8 text-left">
            <h2 className="text-lg font-semibold text-neutral-200">Pro</h2>
            <div className="mt-4 text-4xl font-black text-neutral-300">
              Coming soon
            </div>
            <p className="mt-2 text-sm text-neutral-400">
              Priority support, SSO, and advanced retention for larger teams.
            </p>
            <ul className="mt-6 space-y-2 text-sm text-neutral-400">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-neutral-500">•</span>
                <span>Everything in Free</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 text-neutral-500">•</span>
                <span>Dedicated onboarding and SLAs</span>
              </li>
            </ul>
            <button
              disabled
              title={
                stripeEnabled === false
                  ? 'Billing is not configured yet'
                  : 'Pro is not available yet'
              }
              className="mt-8 cursor-not-allowed rounded-lg border border-neutral-700 px-4 py-3 text-center font-semibold text-neutral-400 opacity-60"
            >
              {stripeEnabled === null
                ? 'Checking availability...'
                : stripeEnabled
                  ? 'Contact us'
                  : 'Not available yet'}
            </button>
            {stripeEnabled === false && (
              <p className="mt-3 text-center text-xs text-neutral-500">
                Stripe is not configured, so upgrades are currently disabled.
              </p>
            )}
          </div>
        </div>

        <div className="mt-12">
          <Link href="/" className="text-sm text-neutral-400 hover:text-white">
            ← Back to home
          </Link>
        </div>
      </section>
    </main>
  )
}
