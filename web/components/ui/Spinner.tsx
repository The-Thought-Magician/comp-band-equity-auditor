interface SpinnerProps {
  className?: string
  label?: string
}

export function Spinner({ className = '', label }: SpinnerProps) {
  return (
    <span className="inline-flex items-center gap-2 text-neutral-400">
      <span
        className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-neutral-600 border-t-orange-400 ${className}`}
        aria-hidden
      />
      {label && <span className="text-sm">{label}</span>}
    </span>
  )
}

export function FullPageSpinner({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950">
      <Spinner label={label} />
    </div>
  )
}

export default Spinner
