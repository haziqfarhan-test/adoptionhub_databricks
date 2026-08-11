import { motion, AnimatePresence } from 'framer-motion'

const EASE = [0.25, 1, 0.5, 1]

export function SqlPanel({ sql, open }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ ease: EASE, duration: 0.2 }}
          className="overflow-hidden">
          <pre className="px-6 py-4 text-[11px] text-dark-300 font-mono leading-relaxed whitespace-pre-wrap break-words bg-dark-950/60 border-b border-ui/[0.06]">
            {sql}
          </pre>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
