import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Play, RotateCcw, ChevronDown, ChevronUp, ChevronRight,
  CheckCircle2, XCircle, Loader2, Circle, Clock, ExternalLink,
  Search, AlertTriangle, Database, Layers, Filter, Info,
  CheckSquare, Square, Minus, ArrowDown,
} from 'lucide-react'
import {
  listJobRunEntities,
  runJobEntities,
  runJob20 as runJob20Api,
  getJobRunStatus,
  getJobRunLogsAll,
} from '../services/api'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const TERMINAL = new Set(['TERMINATED', 'SKIPPED', 'INTERNAL_ERROR'])
const POLL_MS  = 5000
const EASE     = [0.25, 1, 0.5, 1]

const FREQ_LABELS = {
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly',
}

// ─────────────────────────────────────────────────────────────────────────────
// Tiny helpers
// ─────────────────────────────────────────────────────────────────────────────
function formatDur(startMs, endMs) {
  if (!startMs || !endMs || endMs <= startMs) return null
  const s = Math.floor((endMs - startMs) / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60); const r = s % 60
  return r > 0 ? `${m}m ${r}s` : `${m}m`
}

// DB timestamps are stored as UTC (+0). Append 'Z' if no timezone is present
// so the browser parses them correctly and converts to local time for display.
function toUtcDate(iso) {
  if (!iso) return null
  const s = String(iso)
  return new Date(s.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(s) ? s : s + 'Z')
}

function formatTime(iso) {
  if (!iso) return '—'
  try {
    const d = toUtcDate(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch { return String(iso) }
}

function entityMatchesSearch(entity, q) {
  if (!q) return true
  const lq = q.toLowerCase()
  return (
    (entity.source_entity_name || '').toLowerCase().includes(lq) ||
    (entity.source_filename     || '').toLowerCase().includes(lq) ||
    (entity.job_name            || '').toLowerCase().includes(lq)
  )
}

// Match task_run_log rows to an entity.
// The job_run_id format is: YYYYMMDD_XXXX_<job_name>.
// This works for both TIER 1 and TIER 2 since the same job_name is embedded.
function matchTaskLogs(taskLogs, entity) {
  if (!taskLogs?.length) return []
  const jobName    = (entity.job_name           || '').toLowerCase().trim()
  const entityName = (entity.source_entity_name || '').toLowerCase().trim()
  const silverTbl  = (entity.silver_table_name  || '').toLowerCase().trim()

  return taskLogs.filter(row => {
    const jrid = String(row.job_run_id  || '').toLowerCase()
    const tn   = String(row.table_name  || '').toLowerCase().trim()

    if (jobName && jrid.includes(jobName)) return true
    if (entityName && tn === entityName)   return true
    if (silverTbl  && tn === silverTbl)    return true

    return false
  })
}

// Derive entity card status.
// Rule: immediately red if any explicit failure is found, even while the job runs.
// Otherwise amber while running, then green/grey after the job finishes.
function entityStatus(entity, taskLogs, isJobRunning) {
  const matched = matchTaskLogs(taskLogs, entity)

  // Priority: show red immediately on explicit failure — even during the run
  if (matched.length) {
    const hasExplicitFail = matched.some(r => {
      const st  = String(r.status || '').toUpperCase()
      const err = r.error_message
      const hasError = err !== null && err !== undefined &&
                       String(err).trim() !== '' && String(err).toLowerCase() !== 'null'
      return st === 'FAILED' || st === 'ERROR' || hasError
    })
    if (hasExplicitFail) return 'failed'
  }

  if (isJobRunning) return 'inprogress'

  if (!matched.length) return 'pending'

  // After job completes: any non-SUCCESS status counts as failure
  const hasFail = matched.some(r => {
    const st  = String(r.status || '').toUpperCase()
    const err = r.error_message
    const hasError = err !== null && err !== undefined &&
                     String(err).trim() !== '' && String(err).toLowerCase() !== 'null'
    return st !== 'SUCCESS' || hasError
  })
  if (hasFail) return 'failed'

  const allOk = matched.every(r => String(r.status || '').toUpperCase() === 'SUCCESS')
  return allOk ? 'success' : 'pending'
}

// ─────────────────────────────────────────────────────────────────────────────
// Small re-usable atoms
// ─────────────────────────────────────────────────────────────────────────────
function Tag({ children, color = 'default' }) {
  const cls = {
    default:  'bg-dark-700/60 text-dark-200 border-dark-600',
    blue:     'bg-brand-500/[0.12] text-brand-500 border-brand-500/25',
    green:    'bg-green-500/[0.10] text-green-400 border-green-500/25',
    red:      'bg-red-500/[0.10] text-red-400 border-red-500/25',
    amber:    'bg-amber-500/[0.10] text-amber-400 border-amber-500/25',
    purple:   'bg-purple-500/[0.10] text-purple-400 border-purple-500/25',
  }[color] || 'bg-dark-700/60 text-dark-200 border-dark-600'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${cls}`}>
      {children}
    </span>
  )
}

function StatusTag({ state, result }) {
  if (!state) return <Tag color="default">Pending</Tag>
  if (state === 'RUNNING' || state === 'TERMINATING') return <Tag color="blue">Running</Tag>
  if (state === 'TERMINATED') {
    return result === 'SUCCESS'
      ? <Tag color="green">Completed</Tag>
      : <Tag color="red">{result || 'Failed'}</Tag>
  }
  if (state === 'INTERNAL_ERROR') return <Tag color="red">Error</Tag>
  if (state === 'SKIPPED')        return <Tag color="amber">Skipped</Tag>
  return <Tag color="default">{state}</Tag>
}

function EntityStatusDot({ status }) {
  const map = {
    pending:    { cls: 'bg-dark-500',   pulse: false },
    inprogress: { cls: 'bg-amber-400',  pulse: true  },
    success:    { cls: 'bg-green-500',  pulse: false },
    failed:     { cls: 'bg-red-500',    pulse: false },
    skipped:    { cls: 'bg-amber-500',  pulse: false },
  }
  const s = map[status] || map.pending
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0">
      {s.pulse && (
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${s.cls} opacity-60`} />
      )}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${s.cls}`} />
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Entity selector table
// ─────────────────────────────────────────────────────────────────────────────
function EntityTable({ entities, selected, onToggle, onToggleAll, searchQuery }) {
  const filtered = entities.filter(e => entityMatchesSearch(e, searchQuery))
  const allChecked  = filtered.length > 0 && filtered.every(e => selected.has(e.job_name))
  const someChecked = filtered.some(e => selected.has(e.job_name)) && !allChecked

  if (!filtered.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-dark-300">
        <Search size={22} />
        <p className="text-sm">No entities match your search</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-ui/[0.06]">
            <th className="w-10 px-3 py-3 text-left">
              <button
                onClick={() => onToggleAll(filtered)}
                className="flex items-center justify-center text-dark-300 hover:text-brand-500 transition-colors">
                {allChecked
                  ? <CheckSquare size={14} className="text-brand-500" />
                  : someChecked
                  ? <Minus size={14} className="text-brand-400" />
                  : <Square size={14} />}
              </button>
            </th>
            {['Entity', 'Source File', 'Bronze Path', 'Silver Table', 'Load Type', 'Domain', 'Frequency', 'Active'].map(h => (
              <th key={h} className="px-3 py-3 text-left font-semibold text-dark-300 uppercase tracking-[0.07em] text-[10px] whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map((entity, i) => {
            const isSelected = selected.has(entity.job_name)
            return (
              <motion.tr
                key={entity.job_name}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.02, ease: EASE }}
                onClick={() => onToggle(entity.job_name)}
                className={`
                  border-b border-ui/[0.04] cursor-pointer transition-colors duration-150
                  ${isSelected
                    ? 'bg-brand-500/[0.05] hover:bg-brand-500/[0.08]'
                    : 'hover:bg-dark-800/50'}
                `}>
                <td className="px-3 py-3.5">
                  <div className={`w-4 h-4 rounded flex items-center justify-center border transition-all duration-150
                    ${isSelected
                      ? 'bg-brand-500 border-brand-500 shadow-apple-blue'
                      : 'border-dark-500 bg-dark-800'}`}>
                    {isSelected && <svg viewBox="0 0 10 8" className="w-2.5 h-2.5 fill-white" fill="none">
                      <path d="M1 4L3.8 7L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>}
                  </div>
                </td>
                <td className="px-3 py-3.5">
                  <p className={`font-semibold truncate max-w-[160px] ${isSelected ? 'text-dark-50' : 'text-dark-100'}`}>
                    {entity.source_entity_name || entity.job_name || '—'}
                  </p>
                  <p className="text-dark-400 font-mono text-[10px] truncate max-w-[160px]">{entity.job_name}</p>
                </td>
                <td className="px-3 py-3.5 text-dark-300 font-mono truncate max-w-[140px]">
                  {entity.source_filename || '—'}
                </td>
                <td className="px-3 py-3.5 text-dark-300 font-mono truncate max-w-[180px]">
                  {entity.bronze_table_path || '—'}
                </td>
                <td className="px-3 py-3.5 text-dark-300 font-mono truncate max-w-[140px]">
                  {entity.silver_table_name || '—'}
                </td>
                <td className="px-3 py-3.5">
                  <Tag color={entity.silver_load_type === 'incremental' ? 'purple' : 'default'}>
                    {entity.silver_load_type || '—'}
                  </Tag>
                </td>
                <td className="px-3 py-3.5">
                  <Tag color="blue">{entity.domain || '—'}</Tag>
                </td>
                <td className="px-3 py-3.5">
                  <Tag>{FREQ_LABELS[entity.target_category] || entity.target_category || '—'}</Tag>
                </td>
                <td className="px-3 py-3.5">
                  {entity.active
                    ? <Tag color="green">Active</Tag>
                    : <Tag color="default">Inactive</Tag>}
                </td>
              </motion.tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Horizontal entity tracker card
// ─────────────────────────────────────────────────────────────────────────────
function EntityCard({ entity, status, taskLogs, isSelected, onClick }) {
  const matched = matchTaskLogs(taskLogs, entity)
  const firstLog = matched[0] || null

  const borderColor = {
    pending:    'border-dark-700',
    inprogress: 'border-amber-400/60',
    success:    'border-green-500/50',
    failed:     'border-red-500/50',
    skipped:    'border-amber-500/50',
  }[status] || 'border-dark-700'

  const bgGlow = {
    inprogress: 'shadow-[0_0_20px_rgba(251,191,36,0.10)]',
    success:    'shadow-[0_0_20px_rgba(34,197,94,0.08)]',
    failed:     'shadow-[0_0_20px_rgba(239,68,68,0.08)]',
  }[status] || ''

  const statusLabel = {
    pending:    'Queued',
    inprogress: 'In Progress',
    success:    'Completed',
    failed:     'Failed',
    skipped:    'Skipped',
  }[status] || 'Queued'

  return (
    <motion.button
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: EASE }}
      onClick={onClick}
      className={`
        min-w-[196px] w-[196px] flex-shrink-0 text-left
        rounded-2xl border bg-dark-900/80 p-4
        transition-all duration-300 cursor-pointer
        ${borderColor} ${bgGlow}
        ${isSelected ? 'ring-2 ring-brand-500/40 ring-offset-1 ring-offset-dark-900' : ''}
        hover:bg-dark-800/80
      `}>

      {/* Status row */}
      <div className="flex items-center gap-2 mb-3">
        <EntityStatusDot status={status} />
        <span className={`text-[11px] font-semibold tracking-wide
          ${status === 'inprogress' ? 'text-amber-400' :
            status === 'success'    ? 'text-green-400' :
            status === 'failed'     ? 'text-red-400'   :
            status === 'skipped'    ? 'text-amber-400' : 'text-dark-400'}`}>
          {statusLabel}
        </span>
        {status === 'inprogress' && (
          <Loader2 size={10} className="text-amber-400 animate-spin ml-auto" />
        )}
        {status === 'success' && (
          <CheckCircle2 size={10} className="text-green-400 ml-auto" />
        )}
        {status === 'failed' && (
          <XCircle size={10} className="text-red-400 ml-auto" />
        )}
      </div>

      {/* Entity name */}
      <p className="text-sm font-semibold text-dark-50 leading-tight truncate mb-1">
        {entity.source_entity_name || entity.job_name}
      </p>
      <p className="text-[10px] text-dark-400 font-mono truncate mb-3">
        {entity.source_filename || '—'}
      </p>

      {/* Meta pills */}
      <div className="flex flex-wrap gap-1 mb-3">
        <Tag color="blue">{entity.domain}</Tag>
        <Tag color={entity.silver_load_type === 'incremental' ? 'purple' : 'default'}>
          {entity.silver_load_type || 'full'}
        </Tag>
      </div>

      {/* Timing */}
      {firstLog && (
        <div className="text-[10px] text-dark-400 font-mono space-y-0.5">
          {firstLog.start_time && (
            <div className="flex items-center gap-1">
              <Clock size={8} />
              {formatTime(firstLog.start_time)}
            </div>
          )}
          {firstLog.start_time && firstLog.end_time && (
            <div className="text-dark-300">
              {formatDur(toUtcDate(firstLog.start_time)?.getTime(), toUtcDate(firstLog.end_time)?.getTime())}
            </div>
          )}
        </div>
      )}

      {/* Expand hint */}
      <div className="mt-3 pt-3 border-t border-ui/[0.06] flex items-center gap-1.5 text-[10px] text-dark-400">
        <Info size={9} />
        {matched.length > 0 ? `${matched.length} log row${matched.length > 1 ? 's' : ''}` : 'Details'}
        <ChevronRight size={9} className="ml-auto" />
      </div>
    </motion.button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Entity detail panel — shows TIER 1 and TIER 2 log sections
// ─────────────────────────────────────────────────────────────────────────────
function EntityDetailPanel({ entity, taskLogs, jobLogs, onClose }) {
  const matched = matchTaskLogs(taskLogs, entity)

  const tier1ScrollRef = useRef(null)
  const tier2ScrollRef = useRef(null)
  const tier1SavedTop  = useRef(0)
  const tier2SavedTop  = useRef(0)

  useLayoutEffect(() => {
    if (tier1ScrollRef.current) tier1ScrollRef.current.scrollTop = tier1SavedTop.current
    if (tier2ScrollRef.current) tier2ScrollRef.current.scrollTop = tier2SavedTop.current
  })

  // Build layer lookup: job_run_id → 'TIER 1' | 'TIER 2'
  const layerMap = {}
  for (const row of (jobLogs || [])) {
    if (row.job_run_id) layerMap[String(row.job_run_id)] = row.layer || ''
  }

  // Use the row's own `layer` column first (tbl_task_run_log has it directly).
  // Fall back to layerMap (derived from tbl_job_run_log) only when the column is absent.
  const tier1Logs = matched.filter(r => {
    const rowLayer = String(r.layer || '').trim()
    if (rowLayer) return rowLayer === 'TIER 1'
    const jLayer = layerMap[String(r.job_run_id)] || ''
    return jLayer === 'TIER 1' || jLayer === ''
  })
  const tier2Logs = matched.filter(r => {
    const rowLayer = String(r.layer || '').trim()
    if (rowLayer) return rowLayer === 'TIER 2'
    return layerMap[String(r.job_run_id)] === 'TIER 2'
  })

  const allCols = matched.length
    ? Object.keys(matched[0]).filter(k => k !== 'job_run_id')
    : []

  function renderRows(rows) {
    return rows.map((row, ri) => {
      const st = String(row.status || '').toUpperCase()
      return (
        <tr key={ri} className={`border-b border-ui/[0.04] hover:bg-dark-800/30 ${
          st.includes('FAIL') || st.includes('ERROR') ? 'bg-red-500/[0.04]' : ''
        }`}>
          {allCols.map(col => {
            const v        = row[col]
            const isStatus = col.toLowerCase() === 'status'
            const isError  = col.toLowerCase().includes('error') && v
            return (
              <td key={col} className="px-3 py-2 whitespace-nowrap">
                {isStatus ? (
                  <Tag color={
                    String(v).toUpperCase().includes('SUCCESS') || String(v).toUpperCase().includes('DONE') ? 'green' :
                    String(v).toUpperCase().includes('FAIL') || String(v).toUpperCase().includes('ERROR') ? 'red' :
                    String(v).toUpperCase().includes('RUN') ? 'blue' : 'default'
                  }>{v ?? '—'}</Tag>
                ) : isError ? (
                  <span className="text-red-400 font-mono">{v}</span>
                ) : (
                  <span className="text-dark-200 font-mono">{v ?? '—'}</span>
                )}
              </td>
            )
          })}
        </tr>
      )
    })
  }

  function TierTable({ rows, emptyLabel, scrollRef, savedTopRef }) {
    if (!rows.length) return (
      <p className="text-[11px] text-dark-500 italic py-2 pl-1">{emptyLabel}</p>
    )
    return (
      <div
        ref={scrollRef}
        onScroll={e => { if (savedTopRef) savedTopRef.current = e.currentTarget.scrollTop }}
        className="overflow-x-auto overflow-y-auto max-h-44 rounded-xl border border-ui/[0.06]">
        <table className="w-full text-[11px]">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-ui/[0.06] bg-dark-800/70">
              {allCols.map(col => (
                <th key={col} className="px-3 py-2 text-left text-dark-400 font-semibold whitespace-nowrap">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>{renderRows(rows)}</tbody>
        </table>
      </div>
    )
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ ease: EASE, duration: 0.3 }}
      className="overflow-hidden">
      <div className="mt-4 rounded-2xl border border-ui/[0.07] bg-dark-900/60 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm font-semibold text-dark-50">
              {entity.source_entity_name || entity.job_name}
            </p>
            <p className="text-[11px] text-dark-400 font-mono mt-0.5">{entity.job_name}</p>
          </div>
          <button onClick={onClose} className="text-dark-400 hover:text-dark-100 transition-colors p-1">
            <ChevronUp size={14} />
          </button>
        </div>

        {/* Meta grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          {[
            { label: 'Bronze Path',   value: entity.bronze_table_path },
            { label: 'Silver Table',  value: entity.silver_table_name },
            { label: 'Load Type',     value: entity.silver_load_type  },
            { label: 'Source File',   value: entity.source_filename   },
          ].map(({ label, value }) => (
            <div key={label} className="bg-dark-800/60 rounded-xl p-3">
              <p className="text-[10px] text-dark-400 uppercase tracking-[0.07em] font-semibold mb-1">{label}</p>
              <p className="text-xs text-dark-100 font-mono truncate">{value || '—'}</p>
            </div>
          ))}
        </div>

        {matched.length > 0 ? (
          <div className="space-y-4">
            {/* TIER 1 */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-[10px] font-semibold text-dark-300 uppercase tracking-[0.07em]">
                  TIER 1 · Raw → Bronze ({tier1Logs.length})
                </p>
                <Tag color="blue">job_10</Tag>
              </div>
              <TierTable rows={tier1Logs} emptyLabel="No TIER 1 entries yet" scrollRef={tier1ScrollRef} savedTopRef={tier1SavedTop} />
            </div>

            {/* TIER 2 — only show section if any TIER 2 logs exist */}
            {tier2Logs.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-[10px] font-semibold text-dark-300 uppercase tracking-[0.07em]">
                    TIER 2 · Bronze → Silver ({tier2Logs.length})
                  </p>
                  <Tag color="purple">job_20</Tag>
                </div>
                <TierTable rows={tier2Logs} emptyLabel="No TIER 2 entries yet" scrollRef={tier2ScrollRef} savedTopRef={tier2SavedTop} />
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-sm text-dark-400 py-4">
            <Clock size={14} />
            No log entries found yet for this entity
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Horizontal entity tracker
// ─────────────────────────────────────────────────────────────────────────────
function HorizontalTracker({ selectedEntities, jobStatus, runLogs, isRunning }) {
  const [activeCard, setActiveCard] = useState(null)
  const taskLogs = runLogs?.task_logs || []
  const jobLogs  = runLogs?.job_logs  || []

  const stats = selectedEntities.reduce(
    (acc, e) => {
      const s = entityStatus(e, taskLogs, isRunning)
      acc[s] = (acc[s] || 0) + 1
      return acc
    },
    {}
  )

  return (
    <div>
      {/* Stats bar */}
      <div className="flex items-center gap-4 mb-5 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs text-dark-300">
          <span className="font-semibold text-dark-50">{selectedEntities.length}</span> entities
        </div>
        {stats.inprogress > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-amber-400">
            <Loader2 size={11} className="animate-spin" />
            {stats.inprogress} in progress
          </div>
        )}
        {stats.success > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-green-400">
            <CheckCircle2 size={11} />
            {stats.success} completed
          </div>
        )}
        {stats.failed > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-red-400">
            <XCircle size={11} />
            {stats.failed} failed
          </div>
        )}
        {stats.pending > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-dark-400">
            <Circle size={11} />
            {stats.pending} queued
          </div>
        )}
        {isRunning && (
          <div className="ml-auto flex items-center gap-1.5 text-[11px] text-dark-400 animate-pulse">
            <Clock size={11} />
            Refreshing every 5s
          </div>
        )}
      </div>

      {/* Cards row */}
      <div className="flex gap-3 overflow-x-auto pb-3 snap-x snap-mandatory">
        {selectedEntities.map(entity => {
          const status = entityStatus(entity, taskLogs, isRunning)
          return (
            <div key={entity.job_name} className="snap-start">
              <EntityCard
                entity={entity}
                status={status}
                taskLogs={taskLogs}
                isSelected={activeCard === entity.job_name}
                onClick={() => setActiveCard(
                  activeCard === entity.job_name ? null : entity.job_name
                )}
              />
            </div>
          )
        })}
      </div>

      {/* Detail panel */}
      <AnimatePresence>
        {activeCard && (() => {
          const entity = selectedEntities.find(e => e.job_name === activeCard)
          return entity ? (
            <EntityDetailPanel
              key={activeCard}
              entity={entity}
              taskLogs={taskLogs}
              jobLogs={jobLogs}
              onClose={() => setActiveCard(null)}
            />
          ) : null
        })()}
      </AnimatePresence>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Single task pill (used in PipelineTimeline)
// ─────────────────────────────────────────────────────────────────────────────
function TaskPill({ task }) {
  const isActive  = task.life_cycle_state === 'RUNNING' || task.life_cycle_state === 'TERMINATING'
  const isDone    = task.life_cycle_state === 'TERMINATED' && task.result_state === 'SUCCESS'
  const isFailed  = task.life_cycle_state === 'TERMINATED' && task.result_state !== 'SUCCESS'
  const isSkipped = task.life_cycle_state === 'SKIPPED'
  const dur = formatDur(task.start_time, task.end_time)

  return (
    <div className={`
      flex flex-col items-center gap-1.5 px-3 py-2.5 rounded-xl min-w-[120px]
      border transition-all duration-300
      ${isActive  ? 'bg-brand-500/[0.08] border-brand-500/40 shadow-[0_0_16px_rgba(0,113,227,0.15)]' :
        isDone    ? 'bg-green-500/[0.07] border-green-500/30' :
        isFailed  ? 'bg-red-500/[0.07] border-red-500/30' :
        isSkipped ? 'bg-dark-700/40 border-dark-600' :
                    'bg-dark-800/40 border-dark-700'}
    `}>
      <div className="flex items-center gap-1.5">
        {isActive  && <Loader2 size={11} className="text-brand-500 animate-spin" />}
        {isDone    && <CheckCircle2 size={11} className="text-green-400" />}
        {isFailed  && <XCircle size={11} className="text-red-400" />}
        {isSkipped && <Minus size={11} className="text-amber-400" />}
        {!isActive && !isDone && !isFailed && !isSkipped && (
          <Circle size={9} className="text-dark-400" />
        )}
        <span className={`text-[10px] font-semibold
          ${isActive ? 'text-brand-500' : isDone ? 'text-green-400' : isFailed ? 'text-red-400' : 'text-dark-400'}`}>
          {isActive ? 'Running' : isDone ? 'Done' : isFailed ? (task.result_state || 'Failed') : isSkipped ? 'Skipped' : 'Pending'}
        </span>
      </div>
      <p className="text-[10px] text-dark-200 font-mono text-center leading-tight max-w-[100px] truncate">
        {task.task_key.replace(/^task_/, '')}
      </p>
      {dur && <span className="text-[9px] text-dark-400 font-mono">{dur}</span>}
      {task.run_page_url && (
        <a href={task.run_page_url} target="_blank" rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="text-[9px] text-brand-500/70 hover:text-brand-500 flex items-center gap-0.5 transition-colors">
          <ExternalLink size={8} /> View
        </a>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline task timeline — shows job_10 and job_20 tasks vertically linked
// ─────────────────────────────────────────────────────────────────────────────
function PipelineTimeline({ job10Status, job20Status, isJob20Triggering, isExpanded, onToggle }) {
  const sortTasks = tasks => [...(tasks || [])].sort((a, b) => {
    if (a.start_time && b.start_time) return a.start_time - b.start_time
    if (a.start_time) return -1
    if (b.start_time) return 1
    return 0
  })

  const job10Tasks = sortTasks(job10Status?.tasks)
  const job20Tasks = sortTasks(job20Status?.tasks)

  const job10IsComplete = job10Status && TERMINAL.has(job10Status.life_cycle_state)
  const job10IsSuccess  = job10IsComplete && job10Status.result_state === 'SUCCESS'
  const hasJob20        = isJob20Triggering || !!job20Status

  const totalTasks = job10Tasks.length + job20Tasks.length

  function TaskRow({ tasks }) {
    if (!tasks.length) return (
      <p className="text-[11px] text-dark-500 font-mono italic py-3 pl-1">
        {isJob20Triggering ? 'Waiting for Databricks…' : 'Tasks will appear when job starts'}
      </p>
    )
    return (
      <div className="flex items-center gap-0 overflow-x-auto pb-2">
        {tasks.map((task, i) => {
          const isDone = task.life_cycle_state === 'TERMINATED' && task.result_state === 'SUCCESS'
          return (
            <div key={task.task_key} className="flex items-center shrink-0">
              <TaskPill task={task} />
              {i < tasks.length - 1 && (
                <div className={`h-px w-6 shrink-0 mx-0.5 ${isDone ? 'bg-green-500/40' : 'bg-dark-600'}`} />
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-ui/[0.07] bg-dark-900/50 overflow-hidden">
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-dark-800/40 transition-colors">
        <div className="flex items-center gap-2.5 flex-wrap">
          <Layers size={13} className="text-dark-300" />
          <span className="text-sm font-semibold text-dark-100">Pipeline Tasks</span>
          {job10Tasks.length > 0 && <Tag>TIER 1: {job10Tasks.length}</Tag>}
          {job20Tasks.length > 0 && <Tag color="purple">TIER 2: {job20Tasks.length}</Tag>}
          {job20Tasks.length === 0 && job10Tasks.length > 0 && (
            <Tag color={isJob20Triggering ? 'amber' : 'default'}>
              TIER 2: {isJob20Triggering ? 'triggering…' : 'pending'}
            </Tag>
          )}
        </div>
        {isExpanded
          ? <ChevronUp size={14} className="text-dark-400 shrink-0" />
          : <ChevronDown size={14} className="text-dark-400 shrink-0" />}
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ ease: EASE, duration: 0.25 }}
            className="overflow-hidden">
            <div className="px-5 pb-5 space-y-0">

              {/* ── TIER 1 ── */}
              <div>
                <div className="flex items-center gap-2.5 mb-3 pt-1">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${job10IsSuccess ? 'bg-green-500' : job10IsComplete ? 'bg-red-500' : 'bg-brand-500 animate-pulse'}`} />
                    <span className="text-[10px] font-bold text-dark-300 uppercase tracking-[0.07em]">
                      TIER 1
                    </span>
                  </div>
                  <span className="text-[10px] text-dark-500 font-mono">job_10_raw_to_bronze</span>
                  <span className="text-dark-600 text-[10px]">·</span>
                  <span className="text-[10px] text-dark-400">Raw → Bronze</span>
                  {job10Status && (
                    <div className="ml-auto">
                      <StatusTag state={job10Status.life_cycle_state} result={job10Status.result_state} />
                    </div>
                  )}
                </div>
                <TaskRow tasks={job10Tasks} />
              </div>

              {/* ── Connector ── */}
              <div className="flex items-start gap-4 py-3 pl-1">
                {/* Vertical line + node */}
                <div className="flex flex-col items-center gap-0 shrink-0 mt-0.5">
                  <div className={`w-px h-4 ${job10IsSuccess ? 'bg-green-500/50' : 'bg-dark-600'}`} />
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all duration-500
                    ${isJob20Triggering
                      ? 'border-amber-400 bg-amber-400/10'
                      : job20Status
                      ? 'border-brand-500/70 bg-brand-500/10'
                      : job10IsSuccess
                      ? 'border-dark-500 bg-dark-800'
                      : 'border-dark-700 bg-dark-900'}`}>
                    {isJob20Triggering
                      ? <Loader2 size={9} className="text-amber-400 animate-spin" />
                      : job20Status
                      ? <ArrowDown size={9} className="text-brand-500" />
                      : <ArrowDown size={9} className="text-dark-600" />}
                  </div>
                  <div className={`w-px h-4 ${job20Status ? 'bg-brand-500/40' : 'bg-dark-700'}`} />
                </div>
                {/* Label */}
                <div className="flex items-center gap-2 text-[11px] pt-1.5">
                  {isJob20Triggering && (
                    <span className="text-amber-400 flex items-center gap-1.5">
                      <Loader2 size={10} className="animate-spin" />
                      Auto-triggering job_20_bronze_to_silver…
                    </span>
                  )}
                  {!isJob20Triggering && job20Status && (
                    <span className="text-dark-300 font-mono">→ job_20_bronze_to_silver</span>
                  )}
                  {!isJob20Triggering && !job20Status && job10IsSuccess && (
                    <span className="text-dark-500">→ job_20_bronze_to_silver queued</span>
                  )}
                  {!isJob20Triggering && !job20Status && !job10IsComplete && (
                    <span className="text-dark-600">→ job_20_bronze_to_silver (pending job_10)</span>
                  )}
                </div>
              </div>

              {/* ── TIER 2 ── */}
              <div className={`transition-opacity duration-500 ${hasJob20 ? 'opacity-100' : 'opacity-35'}`}>
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${
                      job20Status && TERMINAL.has(job20Status.life_cycle_state) && job20Status.result_state === 'SUCCESS'
                        ? 'bg-green-500'
                        : job20Status && TERMINAL.has(job20Status.life_cycle_state)
                        ? 'bg-red-500'
                        : job20Status
                        ? 'bg-brand-500 animate-pulse'
                        : isJob20Triggering
                        ? 'bg-amber-400 animate-pulse'
                        : 'bg-dark-600'
                    }`} />
                    <span className="text-[10px] font-bold text-dark-300 uppercase tracking-[0.07em]">
                      TIER 2
                    </span>
                  </div>
                  <span className="text-[10px] text-dark-500 font-mono">job_20_bronze_to_silver</span>
                  <span className="text-dark-600 text-[10px]">·</span>
                  <span className="text-[10px] text-dark-400">Bronze → Silver</span>
                  {isJob20Triggering && (
                    <div className="ml-auto"><Tag color="amber">Triggering…</Tag></div>
                  )}
                  {job20Status && !isJob20Triggering && (
                    <div className="ml-auto">
                      <StatusTag state={job20Status.life_cycle_state} result={job20Status.result_state} />
                    </div>
                  )}
                  {!job20Status && !isJob20Triggering && (
                    <div className="ml-auto"><Tag>Pending</Tag></div>
                  )}
                </div>
                <TaskRow tasks={job20Tasks} />
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Overall status banner — reflects current pipeline phase
// ─────────────────────────────────────────────────────────────────────────────
function OverallStatusBanner({ job10Status, job20Status, runInfo, stage }) {
  const isJob20Phase    = stage === 'triggering-job20' || stage === 'running-job20'
  const isTriggering    = stage === 'triggering-job20'
  const isDone          = stage === 'done'
  const activeStatus    = isJob20Phase ? job20Status : job10Status
  const activeJobName   = isJob20Phase ? 'job_20_bronze_to_silver' : (runInfo?.job_name || 'job_10_raw_to_bronze')

  if (!activeStatus && !isTriggering) return null

  if (isTriggering) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ease: EASE }}
        className="flex items-center gap-4 px-5 py-4 rounded-2xl border bg-amber-500/[0.06] border-amber-500/25 mb-6">
        <Loader2 size={15} className="text-amber-400 animate-spin shrink-0" />
        <div>
          <p className="text-sm font-semibold text-amber-400">Triggering Bronze → Silver</p>
          <p className="text-[11px] text-dark-400 font-mono mt-0.5">
            TIER 1 complete · auto-triggering job_20_bronze_to_silver
          </p>
        </div>
      </motion.div>
    )
  }

  const { life_cycle_state, result_state, run_page_url, start_time, end_time } = activeStatus || {}
  const dur       = formatDur(start_time, end_time)
  const isRunning = life_cycle_state && !TERMINAL.has(life_cycle_state)

  const tierLabel = isJob20Phase ? 'TIER 2 · Bronze → Silver' : 'TIER 1 · Raw → Bronze'

  const [bg, border, textColor, label] =
    life_cycle_state === 'TERMINATED' && result_state === 'SUCCESS'
      ? ['bg-green-500/[0.07]', 'border-green-500/25', 'text-green-400', 'Completed successfully']
      : life_cycle_state === 'TERMINATED'
      ? ['bg-red-500/[0.07]',   'border-red-500/25',   'text-red-400',   `Failed — ${result_state || 'unknown reason'}`]
      : life_cycle_state === 'INTERNAL_ERROR'
      ? ['bg-red-500/[0.07]',   'border-red-500/25',   'text-red-400',   'Internal error']
      : ['bg-brand-500/[0.06]', 'border-brand-500/25', 'text-brand-500', 'Running']

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: EASE }}
      className={`flex items-center gap-4 px-5 py-4 rounded-2xl border ${bg} ${border} mb-6`}>
      <div className="flex items-center gap-2 flex-1">
        {isRunning
          ? <Loader2 size={15} className={`${textColor} animate-spin shrink-0`} />
          : result_state === 'SUCCESS'
          ? <CheckCircle2 size={15} className={`${textColor} shrink-0`} />
          : <XCircle size={15} className={`${textColor} shrink-0`} />}
        <div>
          <p className={`text-sm font-semibold ${textColor}`}>{label}</p>
          <p className="text-[11px] text-dark-400 font-mono mt-0.5">
            {tierLabel} · {activeJobName}
            {runInfo?.run_id && `  ·  run #${runInfo.run_id}`}
            {dur && ` · ${dur}`}
            {isRunning && <span className="animate-pulse"> · updating every 5s</span>}
          </p>
        </div>
      </div>
      {run_page_url && (
        <a href={run_page_url} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-brand-500
                     border border-brand-500/20 px-3 py-1.5 rounded-xl
                     bg-brand-500/[0.07] hover:bg-brand-500/[0.13]
                     hover:scale-[1.02] active:scale-95
                     transition-all duration-200 shrink-0">
          <ExternalLink size={11} />
          Open in Databricks
        </a>
      )}
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Job run log table (scrollable, collapsible)
// ─────────────────────────────────────────────────────────────────────────────
function JobRunLogTable({ runLogs }) {
  const [expanded, setExpanded] = useState(false)
  const jobLogs  = runLogs?.job_logs  || []
  const taskLogs = runLogs?.task_logs || []

  const jobScrollRef  = useRef(null)
  const taskScrollRef = useRef(null)
  const jobSavedTop   = useRef(0)
  const taskSavedTop  = useRef(0)

  // Restore scroll positions after every render so polling never jumps the user back to top
  useLayoutEffect(() => {
    if (jobScrollRef.current)  jobScrollRef.current.scrollTop  = jobSavedTop.current
    if (taskScrollRef.current) taskScrollRef.current.scrollTop = taskSavedTop.current
  })

  if (!jobLogs.length && !taskLogs.length) return null

  const jobCols  = jobLogs.length  ? Object.keys(jobLogs[0])  : []
  const taskCols = taskLogs.length ? Object.keys(taskLogs[0]) : []

  return (
    <div className="rounded-2xl border border-ui/[0.07] bg-dark-900/50 overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-dark-800/40 transition-colors">
        <div className="flex items-center gap-2.5">
          <Database size={13} className="text-dark-300" />
          <span className="text-sm font-semibold text-dark-100">Run Logs</span>
          <Tag>{jobLogs.length} job entries</Tag>
          {taskLogs.length > 0 && <Tag>{taskLogs.length} task entries</Tag>}
        </div>
        {expanded ? <ChevronUp size={14} className="text-dark-400" /> : <ChevronDown size={14} className="text-dark-400" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ ease: EASE, duration: 0.3 }}
            className="overflow-hidden">
            <div className="px-5 pb-5 space-y-5">

              {/* Job run log */}
              {jobLogs.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-dark-400 uppercase tracking-[0.07em] mb-2">
                    tbl_job_run_log ({jobLogs.length} rows)
                  </p>
                  <div
                    ref={jobScrollRef}
                    onScroll={e => { jobSavedTop.current = e.currentTarget.scrollTop }}
                    className="overflow-x-auto overflow-y-auto max-h-60 rounded-xl border border-ui/[0.06]">
                    <table className="w-full text-[11px]">
                      <thead className="sticky top-0 z-10">
                        <tr className="border-b border-ui/[0.06] bg-dark-800/70">
                          {jobCols.map(c => (
                            <th key={c} className="px-3 py-2 text-left text-dark-400 font-semibold whitespace-nowrap">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {jobLogs.map((row, ri) => (
                          <tr key={ri} className="border-b border-ui/[0.04] hover:bg-dark-800/30">
                            {jobCols.map(c => (
                              <td key={c} className="px-3 py-2 font-mono text-dark-200 whitespace-nowrap">
                                {row[c] ?? '—'}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Task run log */}
              {taskLogs.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-dark-400 uppercase tracking-[0.07em] mb-2">
                    tbl_task_run_log ({taskLogs.length} rows)
                  </p>
                  <div
                    ref={taskScrollRef}
                    onScroll={e => { taskSavedTop.current = e.currentTarget.scrollTop }}
                    className="overflow-x-auto overflow-y-auto max-h-60 rounded-xl border border-ui/[0.06]">
                    <table className="w-full text-[11px]">
                      <thead className="sticky top-0 z-10">
                        <tr className="border-b border-ui/[0.06] bg-dark-800/70">
                          {taskCols.map(c => (
                            <th key={c} className="px-3 py-2 text-left text-dark-400 font-semibold whitespace-nowrap">{c}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {taskLogs.map((row, ri) => {
                          const st = String(row.status || '').toUpperCase()
                          return (
                            <tr key={ri} className={`border-b border-ui/[0.04] hover:bg-dark-800/30 ${
                              st.includes('FAIL') || st.includes('ERROR') ? 'bg-red-500/[0.04]' : ''
                            }`}>
                              {taskCols.map(c => {
                                const v = row[c]
                                const isStatus = c.toLowerCase() === 'status'
                                const isErr    = c.toLowerCase().includes('error') && v
                                return (
                                  <td key={c} className="px-3 py-2 whitespace-nowrap">
                                    {isStatus ? (
                                      <Tag color={
                                        String(v).toUpperCase().includes('SUCCESS') || String(v).toUpperCase().includes('DONE') ? 'green' :
                                        String(v).toUpperCase().includes('FAIL') || String(v).toUpperCase().includes('ERROR') ? 'red' :
                                        String(v).toUpperCase().includes('RUN') ? 'blue' : 'default'
                                      }>{v ?? '—'}</Tag>
                                    ) : isErr ? (
                                      <span className="text-red-400 font-mono">{v}</span>
                                    ) : (
                                      <span className="font-mono text-dark-200">{v ?? '—'}</span>
                                    )}
                                  </td>
                                )
                              })}
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
export default function JobRunPage() {
  const location = useLocation()
  // Capture once on mount — the job_name to auto-select when navigated from ConfigSummary
  const [preselectJobName] = useState(location.state?.preselect || null)

  const persistedRun   = (() => { try { return JSON.parse(localStorage.getItem('ah_jr')  || 'null') } catch { return null } })()
  const persistedJob20 = (() => { try { return JSON.parse(localStorage.getItem('ah_jr20') || 'null') } catch { return null } })()

  const [stage,    setStage]    = useState(() => {
    if (location.state?.preselect) return 'idle'  // always show selector when coming from ConfigSummary
    if (persistedJob20) return 'running-job20'
    if (persistedRun)   return 'running'
    return 'idle'
  })

  const [entities, setEntities] = useState([])
  const [loadingEntities, setLoadingEntities] = useState(true)
  const [errorEntities,   setErrorEntities]   = useState(null)

  // Selection state
  const [selected,  setSelected]  = useState(new Set())
  const [search,    setSearch]    = useState('')
  const [domain,    setDomain]    = useState('')
  const [frequency, setFrequency] = useState('')

  // Monitor state — job_10
  const [runInfo,    setRunInfo]    = useState(persistedRun)
  const [jobStatus,  setJobStatus]  = useState(() => {
    try { return JSON.parse(localStorage.getItem('ah_jr_job10_status') || 'null') } catch { return null }
  })
  const [tasksOpen,  setTasksOpen]  = useState(true)
  const [triggering, setTriggering] = useState(false)
  const [runError,   setRunError]   = useState(null)

  // Monitor state — job_20
  const [job20RunInfo, setJob20RunInfo] = useState(persistedJob20)
  const [job20Status,  setJob20Status]  = useState(null)

  // Shared
  const [runLogs,    setRunLogs]    = useState(null)

  // The entities that were selected when Run was clicked
  const [runEntities, setRunEntities] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ah_jr_entities') || 'null') } catch { return null }
  })

  const pollRef = useRef(null)
  const cumulativeTaskLogsRef = useRef([])
  const runStartMsRef = useRef(
    (() => { const s = localStorage.getItem('ah_jr_start'); return s ? parseInt(s, 10) : null })()
  )
  // Ref to access latest runInfo in the polling closure without stale captures
  const runInfoRef = useRef(runInfo)
  useEffect(() => { runInfoRef.current = runInfo }, [runInfo])

  // ── Load entities ──────────────────────────────────────────────────────────
  useEffect(() => {
    setLoadingEntities(true)
    listJobRunEntities()
      .then(data => {
        setEntities(data)
        if (data.length) {
          setDomain(d => d || data[0].domain || '')
          setFrequency(f => f || data[0].target_category || '')
        }
        // Auto-select entity when navigated from ConfigSummary's "Run" button
        if (preselectJobName) {
          const match = data.find(e => e.job_name === preselectJobName)
          if (match) {
            setSelected(new Set([preselectJobName]))
            setDomain(match.domain || '')
            setFrequency(match.target_category || '')
          }
        }
      })
      .catch(e => setErrorEntities(e.message || 'Failed to load entities'))
      .finally(() => setLoadingEntities(false))
  }, [preselectJobName])

  // ── Polling ────────────────────────────────────────────────────────────────
  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }, [])

  const startPolling = useCallback((rid, isJob20 = false) => {
    stopPolling()
    const tick = async () => {
      try {
        const [status, logs] = await Promise.all([
          getJobRunStatus(rid),
          getJobRunLogsAll(),
        ])

        if (isJob20) {
          setJob20Status(status)
        } else {
          setJobStatus(status)
          // Persist so job_10 tasks survive navigation away and back
          localStorage.setItem('ah_jr_job10_status', JSON.stringify(status))
        }

        // Filter job_logs to entries that belong to this run (start_time >= run start with a
        // 2-minute buffer for Databricks scheduling lag). This prevents previous-run rows
        // from leaking in via the 50-row historical query.
        const filteredJobLogs = (logs.job_logs || []).filter(row => {
          if (!runStartMsRef.current) return true
          const rowMs = toUtcDate(row.start_time)?.getTime()
          return !rowMs || rowMs >= runStartMsRef.current - 2 * 60 * 1000
        })

        // Collect the job_run_ids that belong to this run so task rows can be filtered
        // by id rather than time — this reliably excludes TIER 2 rows from prior runs.
        const currentJobRunIds = new Set(
          filteredJobLogs.map(row => String(row.job_run_id)).filter(Boolean)
        )

        // Upsert incoming task_logs into the cumulative store — current run only.
        // When currentJobRunIds is empty the job hasn't logged yet; include nothing rather
        // than falling back to "include everything", which would pull previous-run rows.
        const incoming = (logs.task_logs || []).filter(row =>
          currentJobRunIds.has(String(row.job_run_id || ''))
        )
        const rowKey = r => `${String(r.task_name||'').trim()}|${String(r.job_run_id||'').trim()}`
        const keyMap = {}
        for (const r of cumulativeTaskLogsRef.current) keyMap[rowKey(r)] = r
        for (const r of incoming) keyMap[rowKey(r)] = r
        const merged = Object.values(keyMap)
        merged.sort((a, b) => {
          const ta = toUtcDate(a.start_time)?.getTime() || 0
          const tb = toUtcDate(b.start_time)?.getTime() || 0
          return ta - tb
        })
        cumulativeTaskLogsRef.current = merged
        setRunLogs({ job_logs: filteredJobLogs, task_logs: merged })

        if (TERMINAL.has(status.life_cycle_state)) {
          stopPolling()
          if (!isJob20 && status.result_state === 'SUCCESS') {
            // job_10 succeeded — auto-trigger job_20
            setStage('triggering-job20')
            try {
              const domain    = runInfoRef.current?.domain    || ''
              const frequency = runInfoRef.current?.frequency || ''
              const j20 = await runJob20Api(domain, frequency)
              const j20Info = { run_id: j20.run_id, job_id: j20.job_id, job_name: j20.job_name }
              localStorage.setItem('ah_jr20', JSON.stringify(j20Info))
              setJob20RunInfo(j20Info)
              setStage('running-job20')
            } catch (e) {
              console.error('Failed to trigger job_20:', e)
              setStage('done')
            }
          } else {
            setStage('done')
          }
        }
      } catch (e) {
        console.error('Poll error:', e)
      }
    }
    tick()
    pollRef.current = setInterval(tick, POLL_MS)
  }, [stopPolling])

  useEffect(() => {
    if (stage === 'running' && runInfo?.run_id) {
      startPolling(runInfo.run_id, false)
    } else if (stage === 'running-job20' && job20RunInfo?.run_id) {
      startPolling(job20RunInfo.run_id, true)
    }
    return stopPolling
  }, [stage, runInfo?.run_id, job20RunInfo?.run_id, startPolling, stopPolling])

  // ── Derived values ─────────────────────────────────────────────────────────
  const domains    = [...new Set(entities.map(e => e.domain).filter(Boolean))]
  const frequencies = [...new Set(entities.map(e => e.target_category).filter(Boolean))]

  const filteredEntities = entities.filter(e => {
    if (domain    && e.domain          !== domain)    return false
    if (frequency && e.target_category !== frequency) return false
    return entityMatchesSearch(e, search)
  })

  // ── Handlers ───────────────────────────────────────────────────────────────
  function toggleEntity(jobName) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(jobName) ? next.delete(jobName) : next.add(jobName)
      return next
    })
  }

  function toggleAll(visibleEntities) {
    const allSel = visibleEntities.every(e => selected.has(e.job_name))
    setSelected(prev => {
      const next = new Set(prev)
      visibleEntities.forEach(e => allSel ? next.delete(e.job_name) : next.add(e.job_name))
      return next
    })
  }

  async function handleRun() {
    if (!selected.size) return
    setTriggering(true)
    setRunError(null)
    const names = [...selected]
    const ents  = entities.filter(e => names.includes(e.job_name))

    // Derive domain from selected entities — pass all unique domains as comma-separated string
    const uniqueDomains = [...new Set(ents.map(e => e.domain).filter(Boolean))]
    const domainParam   = uniqueDomains.length ? uniqueDomains.join(', ') : (domain || '')

    try {
      const result = await runJobEntities(names, domainParam, frequency)
      const info = {
        run_id:    result.run_id,
        job_id:    result.job_id,
        job_name:  result.job_name,
        domain:    domainParam,
        frequency: frequency,
      }
      const startNow = Date.now()
      cumulativeTaskLogsRef.current = []
      runStartMsRef.current         = startNow
      localStorage.setItem('ah_jr',          JSON.stringify(info))
      localStorage.setItem('ah_jr_entities', JSON.stringify(ents))
      localStorage.setItem('ah_jr_start',    String(startNow))
      localStorage.removeItem('ah_jr20')
      localStorage.removeItem('ah_jr_job10_status')
      // Clear all previous-run display state immediately so stale logs never flash
      setRunLogs(null)
      setJobStatus(null)
      setJob20RunInfo(null)
      setJob20Status(null)
      setRunInfo(info)
      setRunEntities(ents)
      setStage('running')
    } catch (e) {
      setRunError(e.response?.data?.detail || e.message || 'Failed to trigger job')
    } finally {
      setTriggering(false)
    }
  }

  function handleReset() {
    stopPolling()
    cumulativeTaskLogsRef.current = []
    runStartMsRef.current         = null
    localStorage.removeItem('ah_jr')
    localStorage.removeItem('ah_jr20')
    localStorage.removeItem('ah_jr_entities')
    localStorage.removeItem('ah_jr_start')
    localStorage.removeItem('ah_jr_job10_status')
    setStage('idle')
    setRunInfo(null)
    setJob20RunInfo(null)
    setJobStatus(null)
    setJob20Status(null)
    setRunLogs(null)
    setRunError(null)
    setSelected(new Set())
  }

  // ── Render: Monitor view ───────────────────────────────────────────────────
  if (stage === 'running' || stage === 'triggering-job20' || stage === 'running-job20' || stage === 'done') {
    const isDone     = stage === 'done'
    const isRunning  = !isDone   // any active phase = isRunning for entity status
    const isSuccess  = isDone && job20Status?.result_state === 'SUCCESS'
    const isFailed   = isDone && (
      job20Status?.result_state  !== 'SUCCESS' && job20Status?.result_state ||
      jobStatus?.result_state !== 'SUCCESS' && jobStatus?.result_state
    )

    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ease: EASE }}
        className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2.5 mb-1">
              <div className="w-8 h-8 rounded-[11px] bg-brand-500/[0.12] flex items-center justify-center">
                <Play size={14} className="text-brand-500 ml-0.5" />
              </div>
              <h1 className="text-xl font-bold text-dark-50 tracking-tight">Job Run</h1>
              {!isDone && stage !== 'triggering-job20' && <Tag color="blue">In Progress</Tag>}
              {stage === 'triggering-job20' && <Tag color="amber">Auto-triggering TIER 2</Tag>}
              {isDone && isSuccess && <Tag color="green">Pipeline Complete</Tag>}
              {isDone && isFailed  && <Tag color="red">Failed</Tag>}
            </div>
            <p className="text-sm text-dark-300 ml-10.5">
              {runEntities?.length || 0} entities · TIER 1 → TIER 2 pipeline
              {runInfo?.domain && ` · domain: ${runInfo.domain}`}
            </p>
          </div>
          <button
            onClick={handleReset}
            className="flex items-center gap-2 text-sm text-dark-300 hover:text-dark-50
                       border border-ui/[0.08] px-3.5 py-2 rounded-xl
                       bg-dark-800/60 hover:bg-dark-800
                       transition-all duration-200 hover:scale-[1.02] active:scale-95">
            <RotateCcw size={13} />
            New Run
          </button>
        </div>

        {/* Overall status */}
        <OverallStatusBanner
          job10Status={jobStatus}
          job20Status={job20Status}
          runInfo={runInfo}
          stage={stage}
        />

        {/* Pipeline task timeline */}
        <PipelineTimeline
          job10Status={jobStatus}
          job20Status={job20Status}
          isJob20Triggering={stage === 'triggering-job20'}
          isExpanded={tasksOpen}
          onToggle={() => setTasksOpen(v => !v)}
        />

        {/* Horizontal entity tracker */}
        <div className="rounded-2xl border border-ui/[0.07] bg-dark-900/40 p-6">
          <div className="flex items-center gap-2 mb-5">
            <h2 className="text-sm font-semibold text-dark-50">Entity Progress</h2>
            <div className="flex-1 h-px bg-ui/[0.06]" />
          </div>
          {runEntities?.length > 0 ? (
            <HorizontalTracker
              selectedEntities={runEntities}
              jobStatus={jobStatus}
              runLogs={runLogs}
              isRunning={isRunning}
            />
          ) : (
            <p className="text-sm text-dark-400">No entity data available</p>
          )}
        </div>

        {/* Run log tables */}
        {(isDone || (runLogs?.job_logs?.length ?? 0) > 0) && (
          <JobRunLogTable runLogs={runLogs} />
        )}
      </motion.div>
    )
  }

  // ── Render: Entity selector ────────────────────────────────────────────────
  const selCount = [...selected].filter(n => entities.some(e => e.job_name === n)).length

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: EASE }}
      className="max-w-6xl mx-auto space-y-6">

      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 rounded-[11px] bg-brand-500/[0.12] flex items-center justify-center">
              <Play size={14} className="text-brand-500 ml-0.5" />
            </div>
            <h1 className="text-xl font-bold text-dark-50 tracking-tight">Job Run</h1>
          </div>
          <p className="text-sm text-dark-300 ml-10.5">
            Select entities to run the full pipeline:&nbsp;
            <span className="font-mono text-dark-200">job_10_raw_to_bronze</span>
            <span className="text-dark-500"> → </span>
            <span className="font-mono text-dark-200">job_20_bronze_to_silver</span>
          </p>
        </div>

        {/* Run button */}
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={handleRun}
          disabled={!selCount || triggering}
          className={`
            flex items-center gap-2.5 px-5 py-2.5 rounded-xl text-sm font-semibold
            transition-all duration-200 shadow-apple-blue
            ${selCount && !triggering
              ? 'bg-brand-500 hover:bg-brand-600 text-white cursor-pointer'
              : 'bg-dark-700/60 text-dark-400 cursor-not-allowed'}
          `}>
          {triggering
            ? <Loader2 size={14} className="animate-spin" />
            : <Play size={14} className="ml-0.5" />}
          {triggering ? 'Triggering…' : selCount ? `Run ${selCount} ${selCount === 1 ? 'Entity' : 'Entities'}` : 'Run'}
        </motion.button>
      </div>

      {/* Error */}
      {runError && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/[0.08] border border-red-500/25 text-sm text-red-400">
          <AlertTriangle size={14} className="shrink-0" />
          {runError}
        </motion.div>
      )}

      {/* Run parameters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Domain filter */}
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-semibold text-dark-400 uppercase tracking-[0.07em] whitespace-nowrap">Domain</label>
          <select
            value={domain}
            onChange={e => setDomain(e.target.value)}
            className="bg-dark-800/70 border border-ui/[0.09] text-dark-100 text-xs rounded-xl
                       px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500/40
                       transition-all duration-200 appearance-none cursor-pointer min-w-[100px]">
            <option value="">All</option>
            {domains.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>

        {/* Frequency filter */}
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-semibold text-dark-400 uppercase tracking-[0.07em] whitespace-nowrap">Frequency</label>
          <select
            value={frequency}
            onChange={e => setFrequency(e.target.value)}
            className="bg-dark-800/70 border border-ui/[0.09] text-dark-100 text-xs rounded-xl
                       px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500/40
                       transition-all duration-200 appearance-none cursor-pointer min-w-[100px]">
            <option value="">All</option>
            {frequencies.map(f => <option key={f} value={f}>{FREQ_LABELS[f] || f}</option>)}
          </select>
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-ui/[0.08]" />

        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-dark-400 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search entities…"
            className="w-full bg-dark-800/70 border border-ui/[0.09] text-dark-100 text-xs
                       rounded-xl pl-8 pr-3 py-2
                       placeholder:text-dark-500
                       focus:outline-none focus:ring-2 focus:ring-brand-500/40
                       transition-all duration-200"
          />
        </div>

        {/* Selection summary */}
        {selCount > 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex items-center gap-2 ml-auto">
            <Tag color="blue">{selCount} selected</Tag>
            <button onClick={() => setSelected(new Set())} className="text-[11px] text-dark-400 hover:text-dark-200 transition-colors">
              Clear
            </button>
          </motion.div>
        )}
      </div>

      {/* Warning */}
      {selCount > 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-amber-500/[0.06] border border-amber-500/20 text-xs text-amber-400/80">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          Running will set the selected {selCount} {selCount === 1 ? 'entity' : 'entities'} as active and deactivate all others in{' '}
          <span className="font-mono mx-0.5">tbl_config</span>.
          Domain parameter will be derived from selected entities.
        </motion.div>
      )}

      {/* Main table card */}
      <div className="rounded-2xl border border-ui/[0.07] bg-dark-900/40 overflow-hidden">
        {loadingEntities ? (
          <div className="flex items-center justify-center py-20 gap-3 text-dark-300">
            <Loader2 size={18} className="animate-spin text-brand-500" />
            <span className="text-sm">Loading entities from tbl_config…</span>
          </div>
        ) : errorEntities ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <AlertTriangle size={22} className="text-red-400" />
            <p className="text-sm text-red-400">{errorEntities}</p>
          </div>
        ) : (
          <EntityTable
            entities={filteredEntities}
            selected={selected}
            onToggle={toggleEntity}
            onToggleAll={toggleAll}
            searchQuery={search}
          />
        )}
      </div>

      {/* Footer count */}
      {!loadingEntities && !errorEntities && (
        <p className="text-xs text-dark-500 text-center">
          {filteredEntities.length} of {entities.length} entities shown
          {domain || frequency ? ` · filtered by${domain ? ` domain "${domain}"` : ''}${frequency ? ` frequency "${frequency}"` : ''}` : ''}
        </p>
      )}
    </motion.div>
  )
}
