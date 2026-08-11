import { useState } from 'react'
import { Sparkles, Code2, Bookmark } from 'lucide-react'
import { ExportMenu } from './ExportMenu'
import { SaveModal }  from './SaveModal'

export function DashboardHeader({ result, sqlOpen, onToggleSql, onSave }) {
  const [saveOpen, setSaveOpen] = useState(false)
  const widgets = result?.layout?.widgets || []

  return (
    <div className="px-6 py-5 border-b border-ui/[0.06]">
      {/* Title row — wraps on narrow screens */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-[10px] bg-brand-500/[0.12] flex items-center justify-center shrink-0" aria-hidden="true">
            <Sparkles size={14} className="text-brand-500" />
          </div>
          <h2 className="text-lg font-bold text-dark-50 tracking-tight leading-snug">
            {result.dashboard_title}
          </h2>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ExportMenu widgets={widgets} title={result.dashboard_title} />
          {/* Save button — only rendered when a save handler is provided */}
          {onSave && (
            <button
              type="button"
              onClick={() => setSaveOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium
                         bg-dark-800/60 border border-ui/[0.09] text-dark-300
                         hover:text-dark-50 hover:bg-dark-800 transition-all duration-150">
              <Bookmark size={11} aria-hidden="true" />
              Save
            </button>
          )}
          <button
            type="button"
            onClick={onToggleSql}
            aria-expanded={sqlOpen}
            aria-label={sqlOpen ? 'Hide SQL query' : 'Show SQL query'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all duration-150
              ${sqlOpen
                ? 'bg-dark-700/80 border-ui/[0.12] text-dark-100'
                : 'bg-dark-800/60 border-ui/[0.09] text-dark-300 hover:text-dark-50 hover:bg-dark-800'
              }`}>
            <Code2 size={11} aria-hidden="true" />
            SQL
          </button>
        </div>
      </div>

      <SaveModal
        open={saveOpen}
        defaultTitle={result.dashboard_title || ''}
        onClose={() => setSaveOpen(false)}
        onConfirm={title => onSave(title)}
      />
      {result.dashboard_description && (
        <p className="text-sm text-dark-400 ml-[42px] leading-relaxed mb-1.5">
          {result.dashboard_description}
        </p>
      )}
      {result.speech_bubble_summary && (
        <p className="text-sm text-dark-100 ml-[42px] leading-relaxed">
          {result.speech_bubble_summary}
        </p>
      )}
    </div>
  )
}
