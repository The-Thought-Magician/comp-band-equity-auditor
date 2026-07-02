import Link from 'next/link'

const features = [
  {
    title: 'Versioned Comp Bands',
    body: 'Bands keyed by level, role-family, and geo with min/mid/max and compa-ratio targets. Publish immutable, timestamped versions; clone, diff, and lint for overlaps and inversions.',
  },
  {
    title: 'Compa-Ratio Engine',
    body: 'Compute compa-ratio and range penetration for every employee against any band-set version. Flag below-min, above-max, and off-target outliers with the exact math shown.',
  },
  {
    title: 'Deterministic Gap Analysis',
    body: 'Raw and adjusted pay gaps by gender, level, geo, tenure, and more. Explainable linear decomposition splits explained vs unexplained gap, drillable to the contributing employees.',
  },
  {
    title: 'Remediation Cost Simulator',
    body: 'Compute the exact per-person adjustment to close gaps to a target. Roll up the total budget, model constraints, and compare what-if scenarios with a budget-vs-residual-gap curve.',
  },
  {
    title: 'Offer Guardrails',
    body: 'Evaluate prospective offers against the live band set for compression and equity risk before you extend them, with configurable guardrail thresholds and a decision log.',
  },
  {
    title: 'Merit-Cycle Planner',
    body: 'Allocate a fixed raise budget by compa-ratio, performance, or a blended matrix. Apply manager overrides within budget and compare allocation models side by side.',
  },
  {
    title: 'Board-Ready Evidence Packs',
    body: 'Generate timestamped, methodology-backed evidence packs for pay-transparency filings, with a named sign-off workflow and a shareable read-only link.',
  },
  {
    title: 'Audit Trail & API',
    body: 'An append-only audit log of every band publish, run, and decision. Webhooks, scoped API keys, and structured exports keep your governance reproducible and integrable.',
  },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <nav className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
        <span className="flex items-center gap-2 text-lg font-bold">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-orange-600 text-sm font-black">
            C
          </span>
          <span className="text-orange-300">CompBandEquityAuditor</span>
        </span>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/pricing" className="text-neutral-300 hover:text-white">
            Pricing
          </Link>
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

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <span className="inline-flex items-center rounded-full border border-orange-500/30 bg-orange-500/10 px-3 py-1 text-xs font-medium text-orange-300">
          Pay-equity governance for total-rewards teams
        </span>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-black tracking-tight sm:text-5xl">
          Close comp band equity gaps before the board, the regulator, or a plaintiff finds them
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-neutral-400">
          CompBandEquityAuditor gives total-rewards and legal teams a defensible, single source of
          truth for pay equity, versioned comp bands, reproducible compa-ratio and gap math, and a
          line-item remediation budget that quantifies exactly what it costs to de-risk your
          compensation program and who receives an adjustment.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-orange-600 px-6 py-3 font-semibold text-white hover:bg-orange-500"
          >
            Start free
          </Link>
          <Link
            href="/auth/sign-in"
            className="rounded-lg border border-neutral-700 px-6 py-3 font-semibold text-neutral-200 hover:bg-neutral-900"
          >
            Sign in
          </Link>
        </div>
      </section>

      {/* Problem */}
      <section className="border-y border-neutral-800 bg-neutral-900/40">
        <div className="mx-auto max-w-4xl px-6 py-16 text-center">
          <h2 className="text-2xl font-bold">Spreadsheets cannot defend a pay-equity filing</h2>
          <p className="mx-auto mt-4 max-w-2xl text-neutral-400">
            Pay-transparency audits are now legally mandated and recurring, yet most teams still run
            compa-ratio and gap analysis in fragile, one-off spreadsheets, with no version control
            over bands, no reproducible gap math, no audit trail, and no defensible remediation
            costing. When the board asks what it costs to close the gap, there is no numbers-backed,
            line-item answer. CompBandEquityAuditor makes the pay band a first-class versioned
            object and quantifies pay equity risk as a central, computed artifact your organization
            can stand behind.
          </p>
        </div>
      </section>

      {/* Feature grid */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-2xl font-bold">Every number is deterministic math over your data</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-neutral-400">
          No black-box models. Fully reproducible calculations a Head of People or General Counsel
          can defend in front of a board, an auditor, or a regulator.
        </p>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-6"
            >
              <h3 className="text-base font-semibold text-orange-300">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-neutral-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-4xl px-6 pb-24 text-center">
        <div className="rounded-2xl border border-orange-500/30 bg-orange-600/10 px-8 py-14">
          <h2 className="text-2xl font-bold">See your own risk exposure on day one</h2>
          <p className="mx-auto mt-3 max-w-xl text-neutral-400">
            A built-in sample seeder produces a synthetic 80-employee org with realistic bands and
            deliberately planted outliers and a gender pay gap, so the full audit pipeline, from
            band positioning to remediation costing, is live the moment you log in.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link
              href="/auth/sign-up"
              className="rounded-lg bg-orange-600 px-6 py-3 font-semibold text-white hover:bg-orange-500"
            >
              Start your audit
            </Link>
            <Link
              href="/pricing"
              className="rounded-lg border border-neutral-700 px-6 py-3 font-semibold text-neutral-200 hover:bg-neutral-900"
            >
              See pricing
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-neutral-800 py-8 text-center text-sm text-neutral-600">
        <p>CompBandEquityAuditor</p>
      </footer>
    </main>
  )
}
