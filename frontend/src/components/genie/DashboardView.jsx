import { useState } from 'react'
import { motion } from 'framer-motion'

import { DashboardHeader } from './DashboardHeader'
import { SqlPanel }        from './SqlPanel'
import { WidgetGrid }      from './WidgetGrid'
import { InsightsPanel }   from './InsightsPanel'
import { LineagePanel }    from './LineagePanel'

const EASE = [0.25, 1, 0.5, 1]

export function DashboardView({ result, onSave }) {
  const [sqlOpen,       setSqlOpen]       = useState(false)
  const [widgetHeights, setWidgetHeights] = useState({})

  return (
    <motion.div
      id="genie-dashboard"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: EASE }}
      className="rounded-2xl border border-ui/[0.09] bg-dark-900/60 shadow-apple overflow-hidden">

      <DashboardHeader
        result={result}
        sqlOpen={sqlOpen}
        onToggleSql={() => setSqlOpen(v => !v)}
        onSave={onSave}
      />

      <SqlPanel sql={result.sql_used} open={sqlOpen} />

      <div className="px-6 py-5 space-y-5">
        <WidgetGrid
          widgets={result.layout?.widgets || []}
          widgetHeights={widgetHeights}
          setWidgetHeights={setWidgetHeights}
        />
        <InsightsPanel insights={result.key_insights} />
        <LineagePanel  lineage={result.lineage} />
      </div>
    </motion.div>
  )
}
