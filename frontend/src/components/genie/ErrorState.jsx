import { motion } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'

const EASE = [0.25, 1, 0.5, 1]

export function ErrorState({ message }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ ease: EASE }}
      className="flex items-start gap-3 px-5 py-4 rounded-2xl bg-red-500/[0.07] border border-red-500/25 text-sm text-red-400">
      <AlertTriangle size={15} className="shrink-0 mt-0.5" />
      <div>
        <p className="font-semibold mb-0.5">Could not answer that question</p>
        <p className="text-red-400/80 text-xs">{message}</p>
      </div>
    </motion.div>
  )
}
