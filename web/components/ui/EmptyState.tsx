interface EmptyStateProps {
  title: string
  description?: React.ReactNode
  icon?: React.ReactNode
  action?: React.ReactNode
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-800 bg-neutral-900/40 px-6 py-14 text-center">
      {icon != null && <div className="mb-3 text-3xl text-orange-400">{icon}</div>}
      <h3 className="text-base font-semibold text-neutral-200">{title}</h3>
      {description != null && (
        <p className="mt-1 max-w-sm text-sm text-neutral-500">{description}</p>
      )}
      {action != null && <div className="mt-5">{action}</div>}
    </div>
  )
}

export default EmptyState
