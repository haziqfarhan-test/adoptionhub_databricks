import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Zap } from 'lucide-react'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { ALL_NAV } from '../nav'

const EASE = [0.25, 1, 0.5, 1]

export default function HomePage() {
  const navigate = useNavigate()
  const { role } = useCurrentUser()
  const modules = ALL_NAV.filter(n => n.roles.includes(role))

  return (
    <div className="max-w-4xl mx-auto space-y-10">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ease: EASE }}
        className="flex flex-col items-center text-center gap-4 pt-6">
        <div className="w-14 h-14 rounded-2xl bg-brand-500 flex items-center justify-center shadow-apple-blue">
          <Zap size={24} className="text-white" />
        </div>
        <div>
          <h1 className="text-[26px] font-bold text-dark-50 tracking-tightest">
            Welcome to AdoptionHub
          </h1>
          <p className="text-sm text-dark-200 mt-3 leading-relaxed max-w-xl mx-auto">
            AdoptionHub is your central workspace for configuring, validating, and running
            enterprise data pipelines through a guided, no-code interface — and for turning
            plain-English questions into live, AI-generated dashboards. Data engineers can
            define and execute pipeline configurations end to end, while business users can
            explore governed data and get instant, interactive visualizations without writing
            a single line of SQL.
          </p>
        </div>
      </motion.div>

      <div>
        <p className="text-[10px] text-dark-300 uppercase tracking-[0.1em] font-semibold mb-3 text-center">
          Choose a module to get started
        </p>
        <div className="grid grid-cols-2 gap-3">
          {modules.map(({ to, label, icon: Icon, desc }, i) => (
            <motion.button
              key={to}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ease: EASE, delay: i * 0.06 }}
              onClick={() => navigate(to)}
              className="group flex items-start gap-4 text-left p-5 rounded-2xl
                         bg-dark-900 border border-ui/[0.07] shadow-apple dark:shadow-apple-dk
                         hover:border-brand-500/30 hover:bg-brand-500/[0.06]
                         hover:scale-[1.01] active:scale-[0.99]
                         transition-all duration-200">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5
                               bg-dark-800 text-dark-300 group-hover:bg-brand-500/[0.15] group-hover:text-brand-500
                               transition-colors duration-200">
                <Icon size={18} />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-sm tracking-tight text-dark-50 group-hover:text-brand-500 transition-colors duration-200">
                    {label}
                  </p>
                  <ArrowRight size={14} className="text-dark-300 group-hover:text-brand-500
                                                     group-hover:translate-x-0.5 transition-all duration-200 shrink-0" />
                </div>
                <p className="text-xs text-dark-200 mt-1 leading-relaxed">{desc}</p>
              </div>
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  )
}
