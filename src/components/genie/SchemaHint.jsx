import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Database, ChevronDown, ChevronUp, ChevronRight } from 'lucide-react'

const EASE = [0.25, 1, 0.5, 1]

const LAYER = {
  silver: {
    badge: 'bg-slate-500/[0.12] text-slate-400 border border-slate-500/20',
    dot:   'bg-slate-400',
    label: 'Silver',
  },
  gold: {
    badge: 'bg-amber-500/[0.12] text-amber-400 border border-amber-500/20',
    dot:   'bg-amber-400',
    label: 'Gold',
  },
}

// "catalog_sg.silver.tbl_sg_synthetic_data_for_sunray"
//   → "Synthetic Data For Sunray"
function humanName(fqName) {
  const raw = fqName.split('.').pop() || fqName
  return raw
    .replace(/^tbl_[a-z]{2}_/, '')   // strip tbl_sg_, tbl_pg_, tbl_pg_, …
    .replace(/^tbl_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

export function SchemaHint({ tables, selectedTables, onSelectionChange }) {
  const [panelOpen,     setPanelOpen]     = useState(false)
  const [expandedTable, setExpandedTable] = useState(null)

  if (!tables?.length) return null

  const allSelected = selectedTables.length === tables.length

  function toggle(fqName) {
    if (selectedTables.includes(fqName)) {
      if (selectedTables.length === 1) return   // always keep ≥1 table selected
      onSelectionChange(selectedTables.filter(t => t !== fqName))
    } else {
      onSelectionChange([...selectedTables, fqName])
    }
  }

  function selectAll() {
    onSelectionChange(tables.map(t => t.table))
  }

  return (
    <div className="rounded-2xl border border-ui/[0.07] bg-dark-900/40 overflow-hidden">

      {/* ── Panel toggle header ── */}
      <button
        type="button"
        onClick={() => setPanelOpen(v => !v)}
        className="w-full flex items-center gap-2.5 px-5 py-3 hover:bg-dark-800/40 transition-colors text-left">
        <Database size={12} className="text-dark-400 shrink-0" />
        <span className="text-xs text-dark-400">Available tables</span>
        <span className="ml-2 text-[10px] text-dark-500 tabular-nums">
          {selectedTables.length}/{tables.length} selected
        </span>
        {!allSelected && (
          <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded-full
                           bg-amber-500/[0.12] text-amber-400 border border-amber-500/20">
            filtered
          </span>
        )}
        <span className="ml-auto">
          {panelOpen
            ? <ChevronUp   size={12} className="text-dark-400" />
            : <ChevronDown size={12} className="text-dark-400" />}
        </span>
      </button>

      {/* ── Expandable body ── */}
      <AnimatePresence>
        {panelOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ ease: EASE, duration: 0.2 }}
            className="overflow-hidden">

            <div className="border-t border-ui/[0.06]">

              {/* Sub-header: hint + select-all */}
              <div className="px-5 py-2 flex items-center justify-between">
                <span className="text-[10px] text-dark-500">
                  Uncheck tables to exclude them from AI analysis
                </span>
                {!allSelected && (
                  <button
                    type="button"
                    onClick={selectAll}
                    className="text-[10px] text-brand-500 hover:text-brand-400 transition-colors">
                    Select all
                  </button>
                )}
              </div>

              {/* Table rows */}
              <div className="px-3 pb-3 space-y-1">
                {tables.map(t => {
                  const isSelected = selectedTables.includes(t.table)
                  const isExpanded = expandedTable === t.table
                  const layer      = (t.layer || '').toLowerCase()
                  const ls         = LAYER[layer] || null

                  return (
                    <div
                      key={t.table}
                      className={`rounded-xl border transition-all duration-150 overflow-hidden
                        ${isSelected
                          ? 'border-ui/[0.08] bg-dark-800/30'
                          : 'border-ui/[0.04] bg-transparent opacity-40'}`}>

                      {/* Collapsed row */}
                      <div className="flex items-center gap-2 px-3 py-2">

                        {/* Checkbox */}
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggle(t.table)}
                          onClick={e => e.stopPropagation()}
                          className="w-3.5 h-3.5 rounded shrink-0 cursor-pointer accent-brand-500"
                        />

                        {/* Tier badge */}
                        {ls && (
                          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded
                                           text-[9px] font-semibold shrink-0 ${ls.badge}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${ls.dot}`} />
                            {ls.label}
                          </span>
                        )}

                        {/* Name + expand toggle */}
                        <button
                          type="button"
                          onClick={() => setExpandedTable(isExpanded ? null : t.table)}
                          className="flex-1 flex items-center justify-between gap-2 min-w-0 text-left">
                          <span className="text-xs font-medium text-dark-200 truncate">
                            {humanName(t.table)}
                          </span>
                          <ChevronRight
                            size={11}
                            className={`shrink-0 text-dark-500 transition-transform duration-150
                                        ${isExpanded ? 'rotate-90' : ''}`}
                          />
                        </button>
                      </div>

                      {/* Expanded: fq_name + description + columns */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ ease: EASE, duration: 0.15 }}
                            className="overflow-hidden">
                            <div className="px-3 pb-3 pt-1 space-y-2 border-t border-ui/[0.05]">
                              <p className="text-[10px] font-mono text-dark-500 mt-1.5 break-all">
                                {t.table}
                              </p>
                              {t.description && (
                                <p className="text-[11px] text-dark-400 leading-relaxed">
                                  {t.description}
                                </p>
                              )}
                              {t.columns?.length > 0 && (
                                <div className="flex flex-wrap gap-1 pt-0.5">
                                  {t.columns.map(c => (
                                    <span key={c.name}
                                      className="text-[10px] px-1.5 py-0.5 rounded-md font-mono
                                                 bg-dark-700/60 border border-dark-600 text-dark-300">
                                      {c.name}
                                      <span className="text-dark-500 ml-1">{c.type}</span>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
