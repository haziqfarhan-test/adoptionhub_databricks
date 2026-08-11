import { motion, AnimatePresence } from 'framer-motion'
import { SlidersHorizontal } from 'lucide-react'
import { FilterChip } from './FilterChip'

const EASE = [0.25, 1, 0.5, 1]

export function FilterBar({ filters = [], onRemove }) {
  if (!filters.length) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{ opacity: 1, height: 'auto' }}
        exit={{ opacity: 0, height: 0 }}
        transition={{ ease: EASE, duration: 0.2 }}
        className="overflow-hidden">
        <div className="flex items-center gap-2 flex-wrap py-1">
          <div className="flex items-center gap-1.5 text-[11px] text-dark-400 font-medium shrink-0">
            <SlidersHorizontal size={11} />
            Filters:
          </div>
          {filters.map((f, i) => (
            <FilterChip
              key={i}
              label={f.label ?? `${f.column}: ${f.value}`}
              onRemove={onRemove ? () => onRemove(i) : undefined}
            />
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
