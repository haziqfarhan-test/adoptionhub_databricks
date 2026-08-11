import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'

const EASE = [0.25, 1, 0.5, 1]

export function EmptyState() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.15, ease: EASE }}
      className="flex flex-col items-center justify-center py-16 gap-4 text-dark-400">
      <div className="w-14 h-14 rounded-2xl bg-dark-900 border border-ui/[0.07] flex items-center justify-center shadow-apple">
        <Sparkles size={22} className="text-dark-500" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-dark-200">Ask a question to get started</p>
        <p className="text-xs text-dark-400 mt-1">Try one of the example prompts above</p>
      </div>
    </motion.div>
  )
}
