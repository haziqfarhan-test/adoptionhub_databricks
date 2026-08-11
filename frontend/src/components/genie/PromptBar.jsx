import { useRef } from 'react'
import { Sparkles, Send, Loader2 } from 'lucide-react'

const EXAMPLES = [
  'How many employees are in each leadership stage?',
  'Show programme count per employee',
  'List all active programmes with their funding end dates',
  'Which philanthropy agencies have the highest funding?',
  'Show employee count by designation',
  'What programmes are ending in the next 6 months?',
]

export function PromptBar({ question, onChange, onAsk, loading }) {
  const inputRef = useRef(null)

  function submit() {
    if (question.trim() && !loading) onAsk(question)
  }

  function handleExample(ex) {
    onChange(ex)
    setTimeout(() => onAsk(ex), 0)
  }

  return (
    <div className="relative" role="search">
      <div className={`
        flex items-center gap-3 rounded-2xl border bg-dark-900/70 px-4 py-3.5
        transition-all duration-200
        ${loading
          ? 'border-brand-500/40 shadow-[0_0_0_3px_rgba(0,113,227,0.10)]'
          : 'border-ui/[0.09] focus-within:border-brand-500/40 focus-within:shadow-[0_0_0_3px_rgba(0,113,227,0.10)]'}
      `}>
        <Sparkles
          size={15}
          aria-hidden="true"
          className={`shrink-0 transition-colors ${loading ? 'text-brand-500 animate-pulse' : 'text-dark-400'}`}
        />
        <input
          ref={inputRef}
          id="genie-input"
          value={question}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
          placeholder="Ask anything about your data…"
          disabled={loading}
          aria-label="Ask a question about your data"
          aria-busy={loading}
          autoComplete="off"
          className="flex-1 bg-transparent text-sm text-dark-50 placeholder:text-dark-500 outline-none disabled:opacity-50"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!question.trim() || loading}
          aria-label={loading ? 'Generating dashboard…' : 'Submit question'}
          className={`
            w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-all duration-200
            ${question.trim() && !loading
              ? 'bg-brand-500 text-white hover:bg-brand-600 hover:scale-105 active:scale-95 shadow-apple-blue'
              : 'bg-dark-700/60 text-dark-500 cursor-not-allowed'}
          `}>
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
        </button>
      </div>

      {/* Example chips */}
      <div className="flex flex-wrap gap-2 mt-3" role="list" aria-label="Example questions">
        {EXAMPLES.map(ex => (
          <button
            key={ex}
            type="button"
            role="listitem"
            onClick={() => handleExample(ex)}
            disabled={loading}
            aria-label={`Ask: ${ex}`}
            className="text-[11px] text-dark-300 border border-ui/[0.08] rounded-full px-3 py-1
                       bg-dark-800/50 hover:bg-dark-800 hover:text-dark-50 hover:border-ui/[0.14]
                       transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed">
            {ex}
          </button>
        ))}
      </div>
    </div>
  )
}
