interface StatProps {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: 'default' | 'violet' | 'green' | 'amber' | 'rose'
}

const toneText: Record<NonNullable<StatProps['tone']>, string> = {
  default: 'text-slate-100',
  violet: 'text-violet-300',
  green: 'text-emerald-300',
  amber: 'text-amber-300',
  rose: 'text-rose-300',
}

export function Stat({ label, value, hint, tone = 'default' }: StatProps) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-5 py-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-2 text-2xl font-semibold ${toneText[tone]}`}>{value}</div>
      {hint != null && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  )
}

export default Stat
