import { X } from 'lucide-react'

export function FilterChip({ label, onRemove }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium
                     bg-brand-500/[0.12] border border-brand-500/25 text-brand-400">
      {label}
      {onRemove && (
        <button
          onClick={onRemove}
          className="rounded-full hover:text-brand-200 transition-colors"
          aria-label={`Remove filter: ${label}`}>
          <X size={10} />
        </button>
      )}
    </span>
  )
}
