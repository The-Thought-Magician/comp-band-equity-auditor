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
    <main className="min-h-screen bg-slate-950 text-white">
      <nav className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <span className="flex items-center gap-2 text-lg font-bold">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600 text-sm font-black">
            C
          </span>
          <span className="text-violet-300">CompBandEquityAuditor</span>
        </span>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/pricing" className="text-slate-300 hover:text-white">
            Pricing
          </Link>
          <Link href="/auth/sign-in" className="text-slate-300 hover:text-white">
            Sign In
          </Link>
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-violet-600 px-4 py-2 font-medium text-white hover:bg-violet-500"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <span className="inline-flex items-center rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1 text-xs font-medium text-violet-300">
          Pay-equity governance for total-rewards teams
        </span>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-black tracking-tight sm:text-5xl">
          Defensible pay equity, with the numbers to back it up
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          CompBandEquityAuditor turns your headcount and compensation data into versioned bands,
          reproducible compa-ratio and gap math, and a board-ready remediation budget that says
          exactly what it costs to fix the gap and who gets a raise.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-violet-600 px-6 py-3 font-semibold text-white hover:bg-violet-500"
          >
            Start free
          </Link>
          <Link
            href="/auth/sign-in"
            className="rounded-lg border border-slate-700 px-6 py-3 font-semibold text-slate-200 hover:bg-slate-900"
          >
            Sign in
          </Link>
        </div>
      </section>

      {/* Problem */}
      <section className="border-y border-slate-800 bg-slate-900/40">
        <div className="mx-auto max-w-4xl px-6 py-16 text-center">
          <h2 className="text-2xl font-bold">Spreadsheets cannot defend a pay-equity filing</h2>
          <p className="mx-auto mt-4 max-w-2xl text-slate-400">
            Pay-transparency audits are now legally mandated and recurring, yet most teams run
            compa-ratio and gap analysis in fragile one-off spreadsheets: no version control over
            bands, no reproducible gap math, no audit trail, and no defensible remediation costing.
            When the board asks what it costs to fix the gap, there is no numbers-backed, line-item
            answer. CompBandEquityAuditor makes the pay band a first-class versioned object and the
            statutory gap the central computed artifact.
          </p>
        </div>
      </section>

      {/* Feature grid */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <h2 className="text-center text-2xl font-bold">Everything is deterministic math over your data</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">
          No black-box ML. Fully reproducible numbers a Head of People can defend in front of a board
          or a regulator.
        </p>
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="rounded-xl border border-slate-800 bg-slate-900/60 p-6"
            >
              <h3 className="text-base font-semibold text-violet-300">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-4xl px-6 pb-24 text-center">
        <div className="rounded-2xl border border-violet-500/30 bg-violet-600/10 px-8 py-14">
          <h2 className="text-2xl font-bold">Demoable on first sign-in</h2>
          <p className="mx-auto mt-3 max-w-xl text-slate-400">
            A built-in sample seeder produces a synthetic 80-employee org with realistic bands and
            deliberately planted outliers and a gender pay gap, so the entire pipeline is live the
            moment you log in.
          </p>
          <div className="mt-8 flex items-center justify-center gap-4">
            <Link
              href="/auth/sign-up"
              className="rounded-lg bg-violet-600 px-6 py-3 font-semibold text-white hover:bg-violet-500"
            >
              Create your workspace
            </Link>
            <Link
              href="/pricing"
              className="rounded-lg border border-slate-700 px-6 py-3 font-semibold text-slate-200 hover:bg-slate-900"
            >
              See pricing
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-8 text-center text-sm text-slate-600">
        <p>CompBandEquityAuditor</p>
      </footer>
    </main>
  )
}
