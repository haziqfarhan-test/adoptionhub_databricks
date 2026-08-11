import { Zap } from 'lucide-react'

export function InsightsPanel({ insights }) {
  if (!insights?.length) return null
  return (
    <div className="border-t border-ui/[0.06] pt-5">
      <div className="flex items-center gap-2 mb-3">
        <Zap size={12} className="text-yellow-400 shrink-0" />
        <p className="text-xs font-semibold text-dark-200 uppercase tracking-[0.08em]">Key Insights</p>
      </div>
      <ul className="space-y-2">
        {insights.map((ins, i) => (
          <li key={i} className="flex items-start gap-2.5 text-sm text-dark-200 leading-snug">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500 mt-[5px] shrink-0" />
            {ins}
          </li>
        ))}
      </ul>
    </div>
  )
}
