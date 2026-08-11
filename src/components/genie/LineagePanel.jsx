import { useState } from 'react'
import { GitBranch, ChevronUp, ChevronDown } from 'lucide-react'

export function LineagePanel({ lineage }) {
  const [open, setOpen] = useState(false)
  if (!lineage) return null

  const tableCount = lineage.tables_used?.length || 0

  return (
    <div className="border-t border-ui/[0.06] pt-4">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls="lineage-content"
        className="flex items-center gap-2 w-full text-left group">
        <GitBranch size={12} className="text-dark-400 shrink-0 group-hover:text-dark-200 transition-colors" />
        <span className="text-xs font-semibold text-dark-400 uppercase tracking-[0.08em] group-hover:text-dark-200 transition-colors">
          Data Lineage
        </span>
        <span className="text-[10px] text-dark-500 ml-1.5">
          {tableCount} table{tableCount !== 1 ? 's' : ''}
          {' · '}{lineage.row_count} row{lineage.row_count !== 1 ? 's' : ''}
        </span>
        <span className="ml-auto" aria-hidden="true">
          {open
            ? <ChevronUp size={12} className="text-dark-400" />
            : <ChevronDown size={12} className="text-dark-400" />}
        </span>
      </button>

      {/*
        Always keep content in the DOM so print CSS can force it visible.
        max-h transition drives open/close; print CSS overrides max-h + opacity.
      */}
      <div
        id="lineage-content"
        aria-hidden={!open}
        className={`overflow-hidden transition-all duration-200 ease-out ${
          open ? 'max-h-[600px] opacity-100 mt-4' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <div>
            <p className="text-[10px] font-semibold text-dark-400 uppercase tracking-[0.06em] mb-2">Tables Used</p>
            {lineage.tables_used?.length
              ? lineage.tables_used.map(t => (
                  <p key={t} className="text-[11px] text-brand-400 font-mono leading-snug mb-1 break-all">{t}</p>
                ))
              : <p className="text-[11px] text-dark-500 italic">—</p>}
          </div>
          <div>
            <p className="text-[10px] font-semibold text-dark-400 uppercase tracking-[0.06em] mb-2">Columns Returned</p>
            <div className="flex flex-wrap gap-1">
              {lineage.result_columns?.map(c => (
                <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-dark-700/60 text-dark-300 font-mono">{c}</span>
              ))}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-dark-400 uppercase tracking-[0.06em] mb-2">Transformations</p>
            {lineage.transformations?.length
              ? lineage.transformations.map((t, i) => (
                  <p key={i} className="text-[11px] text-dark-300 leading-snug mb-1">{t}</p>
                ))
              : <p className="text-[11px] text-dark-500 italic">No transformations</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
