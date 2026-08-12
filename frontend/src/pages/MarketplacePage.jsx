import { motion } from 'framer-motion'
import { Sparkles } from 'lucide-react'

export default function MarketplacePage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: [0.25, 1, 0.5, 1] }}
      className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-4">
      <div className="
        w-14 h-14 rounded-2xl
        bg-dark-900 border border-ui/[0.07]
        flex items-center justify-center
        shadow-apple
      ">
        <Sparkles size={22} className="text-dark-300" />
      </div>
      <div className="text-center max-w-sm">
        <p className="text-dark-50 text-sm font-medium">Marketplace</p>
        <p className="text-dark-300 text-xs mt-1.5 leading-relaxed">
          Temporarily unavailable while we redesign table-level access control
          for the new authentication model. Check back soon.
        </p>
      </div>
    </motion.div>
  )
}
