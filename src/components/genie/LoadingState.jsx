import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'

const EASE = [0.25, 1, 0.5, 1]

const STEPS = [
  'Checking suitability',
  'Grounding schema',
  'Generating SQL',
  'Running query',
  'Building dashboard',
]

export function LoadingState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ ease: EASE }}
      className="flex flex-col items-center gap-4 py-14">
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 rounded-full border-2 border-brand-500/20 animate-ping" />
        <div className="w-12 h-12 rounded-full bg-brand-500/[0.10] border border-brand-500/30 flex items-center justify-center">
          <Sparkles size={18} className="text-brand-500" />
        </div>
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-dark-100">Thinking…</p>
        <p className="text-xs text-dark-400 mt-0.5">Generating SQL and analysing your data</p>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-dark-400 flex-wrap justify-center">
        {STEPS.map((step, i) => (
          <span key={step} className="flex items-center gap-1.5">
            {i > 0 && <span className="w-4 h-px bg-dark-700" />}
            <span
              className="px-2.5 py-1 rounded-full bg-dark-800/60 border border-ui/[0.07] animate-pulse"
              style={{ animationDelay: `${i * 0.25}s` }}>
              {step}
            </span>
          </span>
        ))}
      </div>
    </motion.div>
  )
}
