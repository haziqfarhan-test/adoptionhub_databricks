import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  BarChart2, CheckCircle2, AlertTriangle, Info, Loader2,
  RotateCcw, ArrowRight, ChevronDown, ChevronUp, Key,
} from 'lucide-react'
import FileDropzone from '../components/FileDropzone'
import { profileFile } from '../services/api'

const EASE = [0.25, 1, 0.5, 1]

// Same type list as MetadataGrid — keep in sync
const DATA_TYPES = ['string', 'integer', 'float', 'double', 'boolean', 'date', 'timestamp']

// Exact DEFAULT_CFG shape from MetadataPage — must stay in sync
const DEFAULT_CFG = {
  job_name: '', source_entity_name: '', source_filename: '',
  source_type: 'csv', source_delimiter: ',', source_path: '',
  domain: 'sg', target_category: 'daily',
  bronze_catalog_name: '', bronze_archive_path: '', bronze_table_name: '',
  silver_catalog_name: '', silver_table_name: '',
  silver_curated_path: '', silver_invalid_path: '',
  source_system: 'NCSS', owner: 'NCSS',
  pipeline_name: '', scd_type: 'TYPE 1', active: true,
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny atoms
// ─────────────────────────────────────────────────────────────────────────────

// Color dot for each type — same palette as the old badge
const TYPE_DOT = {
  integer:   'bg-brand-500',
  float:     'bg-brand-400',
  double:    'bg-brand-400',
  boolean:   'bg-purple-400',
  date:      'bg-green-400',
  timestamp: 'bg-green-400',
  string:    'bg-dark-400',
}

// Editable type selector — fixed w-28 so every row's Type cell is the same width
function TypeSelect({ value, onChange }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full shrink-0 ${TYPE_DOT[value] || 'bg-dark-400'}`} />
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-28 bg-dark-800 border border-ui/[0.08] rounded-lg px-2 py-1
                   text-dark-50 text-[11px] font-semibold
                   focus:outline-none focus:ring-1 focus:ring-brand-500/60 focus:border-brand-500
                   transition-all duration-200 cursor-pointer">
        {DATA_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
    </div>
  )
}

function FillBar({ rate }) {
  const pct = Math.round(rate * 100)
  const color = pct >= 95 ? 'bg-green-500' : pct >= 70 ? 'bg-amber-500' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 rounded-full bg-dark-700/40 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-mono text-dark-300 w-8 text-right">{pct}%</span>
    </div>
  )
}

function ScoreColors(label) {
  if (label === 'Pass') return { bg: 'bg-green-500/[0.07]', border: 'border-green-500/25', text: 'text-green-400', num: 'text-green-400' }
  if (label === 'Fail') return { bg: 'bg-red-500/[0.07]',   border: 'border-red-500/25',   text: 'text-red-400',   num: 'text-red-400'   }
  return { bg: 'bg-amber-500/[0.06]', border: 'border-amber-500/25', text: 'text-amber-400', num: 'text-amber-400' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Section A — Summary bar
// ─────────────────────────────────────────────────────────────────────────────
function SummaryBar({ summary }) {
  const { file_name, row_count, column_count, duplicate_row_count } = summary
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: EASE }}
      className="flex flex-wrap items-center gap-6 px-6 py-4 rounded-2xl border border-ui/[0.07] bg-dark-900 shadow-apple">
      <div>
        <p className="text-[10px] text-dark-400 uppercase tracking-[0.07em] font-semibold mb-0.5">File</p>
        <p className="text-sm font-semibold text-dark-50 font-mono">{file_name}</p>
      </div>
      <div className="w-px h-8 bg-ui/[0.07]" />
      <div>
        <p className="text-[10px] text-dark-400 uppercase tracking-[0.07em] font-semibold mb-0.5">Rows</p>
        <p className="text-sm font-semibold text-dark-50">{row_count.toLocaleString()}</p>
      </div>
      <div className="w-px h-8 bg-ui/[0.07]" />
      <div>
        <p className="text-[10px] text-dark-400 uppercase tracking-[0.07em] font-semibold mb-0.5">Columns</p>
        <p className="text-sm font-semibold text-dark-50">{column_count}</p>
      </div>
      <div className="w-px h-8 bg-ui/[0.07]" />
      <div>
        <p className="text-[10px] text-dark-400 uppercase tracking-[0.07em] font-semibold mb-0.5">Duplicate rows</p>
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-dark-50">{duplicate_row_count.toLocaleString()}</p>
          {duplicate_row_count > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold
                             bg-amber-500/[0.10] text-amber-400 border border-amber-500/25">
              <AlertTriangle size={9} />
              duplicates
            </span>
          )}
        </div>
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Section B — AI Readiness Score
// ─────────────────────────────────────────────────────────────────────────────
function ReadinessCard({ readiness }) {
  const { score, label, narrative, suggestions } = readiness
  const { bg, border, text, num } = ScoreColors(label)
  const isAiFallback = narrative === 'AI scoring unavailable. Review column statistics manually.'

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: EASE, delay: 0.05 }}
      className={`rounded-2xl border ${bg} ${border} px-6 py-5 shadow-apple`}>
      <div className="flex items-start gap-5">
        {/* Score circle */}
        <div className={`shrink-0 w-20 h-20 rounded-2xl border ${border} ${bg}
                         flex flex-col items-center justify-center`}>
          <span className={`text-3xl font-bold ${num}`}>{score}</span>
          <span className={`text-[10px] font-semibold ${text} uppercase tracking-[0.07em]`}>{label}</span>
        </div>

        {/* Narrative + suggestions */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <Info size={12} className={text} />
            <span className={`text-xs font-semibold ${text} uppercase tracking-[0.07em]`}>
              AI Readiness Score
            </span>
            {isAiFallback && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]
                               bg-amber-500/[0.10] text-amber-400 border border-amber-500/25 font-semibold">
                <AlertTriangle size={8} /> AI unavailable
              </span>
            )}
          </div>
          <p className="text-sm text-dark-100 leading-relaxed mb-3">{narrative}</p>
          {suggestions.length > 0 && (
            <ul className="space-y-1.5">
              {suggestions.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-dark-200">
                  <span className={`mt-0.5 shrink-0 w-1.5 h-1.5 rounded-full ${num.replace('text-', 'bg-')}`} />
                  {s}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Section C — Column statistics table
// ─────────────────────────────────────────────────────────────────────────────
function ColumnTable({ columns, editedTypes, onTypeChange }) {
  const [expanded, setExpanded] = useState(true)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: EASE, delay: 0.1 }}
      className="rounded-2xl border border-ui/[0.07] bg-dark-900 shadow-apple overflow-hidden">

      {/* Collapsible header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-6 py-4 border-b border-ui/[0.06]
                   hover:bg-ui/[0.03] transition-colors duration-200">
        <div>
          <h3 className="text-sm font-semibold text-dark-50 tracking-tight">
            Column Statistics
          </h3>
          <p className="text-xs text-dark-300 mt-0.5">{columns.length} columns profiled</p>
        </div>
        {expanded
          ? <ChevronUp size={14} className="text-dark-400" />
          : <ChevronDown size={14} className="text-dark-400" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ ease: EASE, duration: 0.3 }}
            className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-ui/[0.07] bg-dark-800/60">
                    {['Column', 'Type', 'Fill rate', 'Unique / Total', 'PK', 'Top values', 'Issues'].map(h => (
                      <th key={h} className="px-4 py-3 text-left text-[10px] text-dark-300 font-semibold
                                             uppercase tracking-[0.08em] whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {columns.map((col, i) => (
                    <motion.tr
                      key={col._idx}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.012, ease: EASE }}
                      className="border-b border-ui/[0.05] hover:bg-ui/[0.03] transition-colors duration-150">

                      {/* Column name */}
                      <td className="px-4 py-3">
                        <p className="font-semibold text-dark-50 font-mono">{col.normalized_name}</p>
                        {col.name !== col.normalized_name && (
                          <p className="text-[10px] text-dark-400 font-mono mt-0.5 truncate max-w-[180px]">
                            {col.name}
                          </p>
                        )}
                      </td>

                      {/* Type — editable; overrides detected_type for the handoff */}
                      <td className="px-4 py-3">
                        <TypeSelect
                          value={editedTypes[col._idx] ?? col.detected_type}
                          onChange={t => onTypeChange(col._idx, t)}
                        />
                      </td>

                      {/* Fill rate bar */}
                      <td className="px-4 py-3">
                        <FillBar rate={col.fill_rate} />
                      </td>

                      {/* Unique / Total */}
                      <td className="px-4 py-3 font-mono text-dark-300 whitespace-nowrap">
                        {col.unique_count.toLocaleString()} / {(col.unique_count + col.null_count > 0
                          ? (col.unique_count + col.null_count) : 0).toLocaleString()}
                      </td>

                      {/* PK candidate */}
                      <td className="px-4 py-3 text-center">
                        {col.is_pk_candidate && (
                          <div className="flex items-center justify-center gap-1">
                            <CheckCircle2 size={13} className="text-green-400" />
                            <Key size={10} className="text-brand-500" />
                          </div>
                        )}
                      </td>

                      {/* Top values */}
                      <td className="px-4 py-3 max-w-[200px]">
                        {col.top_values.length > 0 ? (
                          <p className="text-dark-300 truncate">
                            {col.top_values.slice(0, 5).map(v => v.value).join(', ')}
                          </p>
                        ) : (
                          <span className="text-dark-500">—</span>
                        )}
                      </td>

                      {/* Format issues */}
                      <td className="px-4 py-3">
                        {col.format_issues.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {col.format_issues.map((issue, ii) => (
                              <span key={ii} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                                                         text-[10px] font-semibold
                                                         bg-amber-500/[0.10] text-amber-400 border border-amber-500/25">
                                <AlertTriangle size={8} />
                                {issue}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-dark-500">—</span>
                        )}
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const navigate = useNavigate()

  const [phase,       setPhase]       = useState('upload')   // upload | results | accepting | error
  const [loading,     setLoading]     = useState(false)
  const [result,      setResult]      = useState(null)       // { summary, columns, readiness }
  const [error,       setError]       = useState(null)
  // useRef so the file is always immediately current — no React batching delay
  const droppedFileRef = useRef(null)
  // _idx → user-chosen type string; only populated when user changes a type
  const [editedTypes, setEditedTypes] = useState({})

  function handleTypeChange(idx, newType) {
    setEditedTypes(prev => ({ ...prev, [idx]: newType }))
  }

  // ── File drop handler ────────────────────────────────────────────────────
  async function handleFileDrop(file) {
    setLoading(true)
    setError(null)
    droppedFileRef.current = file   // set immediately, no React batching
    setEditedTypes({})   // clear any previous edits on new upload
    try {
      const data = await profileFile(file)
      setResult(data)
      setPhase('results')
    } catch (e) {
      setError(e.response?.data?.detail || e.message || 'Profiling failed')
      setPhase('error')
    } finally {
      setLoading(false)
    }
  }

  // ── Accept & Configure handoff ───────────────────────────────────────────
  function handleAccept() {
    if (!result) return
    setPhase('accepting')

    const { summary, columns } = result

    // Build columns in the exact shape MetadataPage / MetadataGrid expects.
    // If the user changed a type in the profiler, store it as data_type (the user override
    // that MetadataGrid reads via `col.data_type || col.detected_type`).
    const metaCols = columns.map(col => {
      const typeOverride = editedTypes[col._idx] ?? null
      return {
        name:           col.name,
        safe_name:      col.normalized_name,
        detected_type:  col.detected_type,
        nullable:       col.null_count > 0,
        null_pct:       parseFloat(((1 - col.fill_rate) * 100).toFixed(1)),
        sample_values:  col.sample_values,
        is_primary_key: col.is_pk_candidate,
        data_type:      typeOverride,   // non-null only when user changed the type
        description:    '',
        pii:            'none',
        classification: 'internal',
      }
    })

    // Build partial cfg — pre-fill what the profiler knows, leave the rest at defaults
    const safe = summary.suggested_table_name
    const tbl  = `tbl_${safe}`
    const ext  = summary.file_name.split('.').pop().toLowerCase()
    const defaultDomain = DEFAULT_CFG.domain
    const partialCfg = {
      ...DEFAULT_CFG,
      job_name:           `pip_${safe}`,
      source_entity_name: safe,
      source_filename:    summary.file_name.replace(/\.[^.]+$/, ''),
      source_type:        ext === 'csv' ? 'csv' : 'excel',
      source_delimiter:   ext === 'csv' ? ',' : '',
      source_path:        `/Volumes/catalog_${defaultDomain}/raw/file_upload/`,
      bronze_table_name:  tbl,
      silver_table_name:  tbl,
    }

    // MetadataPage is always mounted and never re-reads localStorage after boot.
    // Dispatch a synchronous CustomEvent so its live React state is updated directly.
    // dispatchEvent is synchronous — state is set before navigate('/') runs.
    window.dispatchEvent(new CustomEvent('profiling-handoff', {
      detail: { columns: metaCols, cfg: partialCfg, file: droppedFileRef.current },
    }))

    // Also write to localStorage so the handoff survives a hard refresh.
    localStorage.setItem('ah_columns',   JSON.stringify(metaCols))
    localStorage.setItem('ah_step',      JSON.stringify('edit'))
    localStorage.setItem('ah_cfg',       JSON.stringify(partialCfg))
    localStorage.setItem('ah_saved',     JSON.stringify(null))
    localStorage.setItem('ah_activeTab', JSON.stringify('dataset'))

    navigate('/')
  }

  // ── Render: upload ───────────────────────────────────────────────────────
  if (phase === 'upload' || phase === 'error') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ease: EASE }}
        className="max-w-3xl mx-auto space-y-6">

        {/* Page header */}
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-[11px] bg-brand-500/[0.12] flex items-center justify-center">
            <BarChart2 size={14} className="text-brand-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-dark-50 tracking-tight">Data Profiling</h1>
            <p className="text-xs text-dark-300 mt-0.5">
              Profile your source file before configuring the pipeline
            </p>
          </div>
        </div>

        {/* Error banner */}
        <AnimatePresence>
          {phase === 'error' && error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ ease: EASE }}
              className="flex items-start gap-3 px-5 py-4 rounded-2xl
                         bg-red-500/[0.08] border border-red-500/25">
              <AlertTriangle size={15} className="text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-red-400">Profiling failed</p>
                <p className="text-xs text-dark-300 mt-0.5 break-words">{error}</p>
              </div>
              <button
                onClick={() => { setPhase('upload'); setError(null) }}
                className="shrink-0 flex items-center gap-1.5 text-xs text-dark-300
                           hover:text-dark-50 transition-colors">
                <RotateCcw size={11} /> Try again
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <FileDropzone onFile={handleFileDrop} loading={loading} />
      </motion.div>
    )
  }

  // ── Render: accepting ────────────────────────────────────────────────────
  if (phase === 'accepting') {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ ease: EASE }}
        className="flex flex-col items-center justify-center h-64 gap-4">
        <Loader2 size={28} className="text-brand-500 animate-spin" />
        <p className="text-sm text-dark-300">Opening Metadata editor…</p>
      </motion.div>
    )
  }

  // ── Render: results ──────────────────────────────────────────────────────
  const { summary, columns, readiness } = result

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: EASE }}
      className="max-w-6xl mx-auto space-y-5">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-[11px] bg-brand-500/[0.12] flex items-center justify-center">
            <BarChart2 size={14} className="text-brand-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-dark-50 tracking-tight">Data Profiling</h1>
            <p className="text-xs text-dark-300 mt-0.5">Review quality checks before proceeding</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => { setPhase('upload'); setResult(null) }}
            className="flex items-center gap-2 text-sm text-dark-300 hover:text-dark-50
                       border border-ui/[0.08] px-3.5 py-2 rounded-xl
                       bg-dark-800/60 hover:bg-dark-800
                       transition-all duration-200 hover:scale-[1.02] active:scale-95">
            <RotateCcw size={13} />
            New file
          </button>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleAccept}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold
                       bg-brand-500 hover:bg-brand-600 text-white
                       shadow-apple-blue transition-all duration-200">
            <ArrowRight size={14} />
            Accept &amp; Configure
          </motion.button>
        </div>
      </div>

      {/* A — Summary bar */}
      <SummaryBar summary={summary} />

      {/* B — AI Readiness */}
      <ReadinessCard readiness={readiness} />

      {/* C — Column stats */}
      <ColumnTable columns={columns} editedTypes={editedTypes} onTypeChange={handleTypeChange} />

      {/* Bottom CTA — visible when scrolled past header */}
      <div className="flex justify-end pt-2 pb-4">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={handleAccept}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold
                     bg-brand-500 hover:bg-brand-600 text-white
                     shadow-apple-blue transition-all duration-200">
          <ArrowRight size={14} />
          Accept &amp; Configure
        </motion.button>
      </div>
    </motion.div>
  )
}
