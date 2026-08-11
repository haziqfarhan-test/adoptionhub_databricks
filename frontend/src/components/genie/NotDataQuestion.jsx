import { motion } from 'framer-motion'
import { Ban } from 'lucide-react'

const EASE = [0.25, 1, 0.5, 1]

export function NotDataQuestion({ message }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ ease: EASE }}
      className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] px-6 py-6 flex items-start gap-4">
      <div className="w-9 h-9 rounded-[10px] bg-amber-500/[0.12] border border-amber-500/20 flex items-center justify-center shrink-0">
        <Ban size={16} className="text-amber-400" />
      </div>
      <div>
        <p className="text-sm font-semibold text-amber-300 mb-1.5">Not a data question</p>
        <p className="text-sm text-amber-300/60 leading-relaxed">
          {message || "This question doesn't appear to be answerable as a data dashboard. Try asking about counts, trends, distributions, or comparisons from your data."}
        </p>
        <p className="text-xs text-amber-400/50 mt-2.5 italic">
          Example: "How many employees are in each leadership stage?"
        </p>
      </div>
    </motion.div>
  )
}
