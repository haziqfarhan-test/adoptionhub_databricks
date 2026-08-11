import { motion } from 'framer-motion'
import { fmtValue } from '../../utils/chartFormatters'

const EASE = [0.25, 1, 0.5, 1]

export function KpiCard({ widget, index = 0 }) {
  const item = widget.data?.[0] || {}
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, ease: EASE }}
      data-kpi-card
      className="rounded-2xl border border-ui/[0.07] bg-dark-800/40 p-5 flex flex-col gap-2.5">
      <p className="text-[11px] font-semibold text-dark-400 uppercase tracking-[0.08em] leading-snug">
        {widget.title}
      </p>
      <p className="text-3xl font-bold text-dark-50 tracking-tight leading-none">
        {fmtValue(item.value, item.label || widget.title)}
      </p>
      <p className="text-xs text-dark-400 font-mono truncate">{item.label || ''}</p>
    </motion.div>
  )
}
