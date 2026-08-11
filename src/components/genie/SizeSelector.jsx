const SIZE_OPTIONS = [
  { key: 'sm', label: 'S',  height: 220 },
  { key: 'md', label: 'M',  height: 320 },
  { key: 'lg', label: 'L',  height: 440 },
  { key: 'xl', label: 'XL', height: 580 },
]

export function SizeSelector({ current, onChange }) {
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Chart height">
      {SIZE_OPTIONS.map(({ key, label, height }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(height)}
          aria-label={`Set height to ${label}`}
          aria-pressed={current === height}
          className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-all duration-150
            ${current === height
              ? 'bg-brand-500/[0.18] text-brand-400 border border-brand-500/30'
              : 'bg-dark-800/50 text-dark-500 border border-ui/[0.06] hover:text-dark-300 hover:bg-dark-800/80'
            }`}>
          {label}
        </button>
      ))}
    </div>
  )
}
