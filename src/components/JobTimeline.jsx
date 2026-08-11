import { motion } from 'framer-motion'
import { CheckCircle2, XCircle, Loader2, Circle, MinusCircle, ExternalLink } from 'lucide-react'

// ─────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────
const TERMINAL = new Set(['TERMINATED', 'SKIPPED', 'INTERNAL_ERROR'])

function formatDuration(startMs, endMs) {
  if (!startMs || !endMs || endMs <= startMs) return null
  const sec = Math.floor((endMs - startMs) / 1000)
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return s > 0 ? `${m}m ${s}s` : `${m}m`
}

function taskLabel(taskKey) {
  return taskKey
    .replace(/^task_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

// ─────────────────────────────────────────────────────
// Step icon  (28 × 28 fixed so the connector line aligns)
// ─────────────────────────────────────────────────────
function StepIcon({ state, result }) {
  const base = 'w-7 h-7 rounded-full flex items-center justify-center shrink-0 relative z-10'

  if (state === 'RUNNING' || state === 'TERMINATING') {
    return (
      <div className={`${base} bg-brand-500/[0.15] border-2 border-brand-500 shadow-apple-blue`}>
        <Loader2 size={13} className="text-brand-500 animate-spin" />
        <span className="absolute inset-0 rounded-full animate-ping bg-brand-500/20" />
      </div>
    )
  }
  if (state === 'TERMINATED') {
    return result === 'SUCCESS'
      ? (
        <div className={`${base} bg-green-500/[0.12] border-2 border-green-500/70`}>
          <CheckCircle2 size={13} className="text-green-600 dark:text-green-400" />
        </div>
      ) : (
        <div className={`${base} bg-red-500/[0.12] border-2 border-red-500/70`}>
          <XCircle size={13} className="text-red-600 dark:text-red-400" />
        </div>
      )
  }
  if (state === 'INTERNAL_ERROR') {
    return (
      <div className={`${base} bg-red-500/[0.12] border-2 border-red-500/70`}>
        <XCircle size={13} className="text-red-600 dark:text-red-400" />
      </div>
    )
  }
  if (state === 'SKIPPED') {
    return (
      <div className={`${base} bg-dark-700/50 border-2 border-dark-600`}>
        <MinusCircle size={13} className="text-dark-300" />
      </div>
    )
  }
  // PENDING / BLOCKED / WAITING_FOR_RETRY
  return (
    <div className={`${base} bg-dark-800 border-2 border-dark-600`}>
      <Circle size={9} className="text-dark-400" />
    </div>
  )
}

// ─────────────────────────────────────────────────────
// Status badge
// ─────────────────────────────────────────────────────
function StateBadge({ state, result }) {
  const map = {
    'RUNNING':        'bg-brand-500/[0.12] text-brand-500 border-brand-500/25',
    'TERMINATING':    'bg-brand-500/[0.12] text-brand-500 border-brand-500/25',
    'TERMINATED':     result === 'SUCCESS'
                        ? 'bg-green-500/[0.1] text-green-600 dark:text-green-400 border-green-500/25'
                        : 'bg-red-500/[0.1] text-red-600 dark:text-red-400 border-red-500/25',
    'INTERNAL_ERROR': 'bg-red-500/[0.1] text-red-600 dark:text-red-400 border-red-500/25',
    'SKIPPED':        'bg-dark-700/50 text-dark-300 border-dark-600',
    'PENDING':        'bg-dark-800 text-dark-300 border-dark-700',
    'BLOCKED':        'bg-dark-800 text-dark-300 border-dark-700',
  }
  const label = {
    RUNNING: 'Running', TERMINATING: 'Finishing',
    TERMINATED: result === 'SUCCESS' ? 'Completed' : (result || 'Failed'),
    INTERNAL_ERROR: 'Error', SKIPPED: 'Skipped',
    PENDING: 'Pending', BLOCKED: 'Blocked',
  }
  const cls = map[state] ?? 'bg-dark-800 text-dark-300 border-dark-700'
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      {label[state] ?? state}
    </span>
  )
}

// ─────────────────────────────────────────────────────
// Single step
// ─────────────────────────────────────────────────────
function Step({ task, index, isLast }) {
  const duration = formatDuration(task.start_time, task.end_time)
  const isActive = task.life_cycle_state === 'RUNNING' || task.life_cycle_state === 'TERMINATING'
  const isDone   = task.life_cycle_state === 'TERMINATED' && task.result_state === 'SUCCESS'

  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.06, ease: [0.25, 1, 0.5, 1] }}
      className="relative flex gap-4">

      {/* Connector line */}
      {!isLast && (
        <div
          className="absolute left-[13px] top-7 bottom-0 w-px"
          style={{
            background: isDone
              ? 'linear-gradient(to bottom, rgba(34,197,94,0.4), rgba(34,197,94,0.1))'
              : 'rgb(var(--ui) / 0.08)',
          }}
        />
      )}

      <StepIcon state={task.life_cycle_state} result={task.result_state} />

      <div className={`flex-1 min-w-0 ${isLast ? 'pb-0' : 'pb-6'}`}>
        {/* Title row */}
        <div className="flex items-center gap-2 flex-wrap mb-0.5">
          <p className={`text-sm font-semibold leading-snug tracking-tight
            ${isActive ? 'text-dark-50'
              : isDone ? 'text-dark-100'
              : 'text-dark-300'}`}>
            {taskLabel(task.task_key)}
          </p>
          <StateBadge state={task.life_cycle_state} result={task.result_state} />
          {duration && (
            <span className="text-[10px] text-dark-300 font-mono">{duration}</span>
          )}
        </div>

        {/* Raw key */}
        <p className="text-[10px] text-dark-400 font-mono mb-1 truncate">{task.task_key}</p>

        {/* Description */}
        {task.description && (
          <p className="text-xs text-dark-200 mb-1">{task.description}</p>
        )}

        {/* Error message */}
        {task.state_message && !isActive && (
          <p className="text-xs text-red-600 dark:text-red-400/80 bg-red-500/[0.07]
                        border border-red-500/15 rounded-xl px-2.5 py-1.5 mt-1
                        font-mono leading-relaxed">
            {task.state_message}
          </p>
        )}

        {isActive && (
          <p className="text-xs text-brand-500/70 animate-pulse mt-0.5">In progress…</p>
        )}

        {task.run_page_url && (
          <a href={task.run_page_url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-dark-300 hover:text-brand-500
                       transition-colors duration-200 mt-1">
            <ExternalLink size={9} />
            View task run
          </a>
        )}
      </div>
    </motion.div>
  )
}

// ─────────────────────────────────────────────────────
// Run header
// ─────────────────────────────────────────────────────
function RunHeader({ runId, state, result, runPageUrl, startTime, endTime }) {
  const duration  = formatDuration(startTime, endTime)
  const isRunning = !TERMINAL.has(state)

  const colour =
    state === 'TERMINATED' && result === 'SUCCESS' ? 'text-green-600 dark:text-green-400' :
    state === 'TERMINATED'                         ? 'text-red-600   dark:text-red-400'   :
    isRunning                                      ? 'text-brand-500'                      : 'text-dark-200'

  const label =
    state === 'TERMINATED' && result === 'SUCCESS' ? 'Job completed successfully' :
    state === 'TERMINATED'                         ? `Job ${result?.toLowerCase() || 'failed'}` :
    state === 'INTERNAL_ERROR'                     ? 'Internal error' :
                                                     'Job is running…'

  return (
    <div className="flex items-center justify-between mb-5">
      <div>
        <p className={`text-sm font-semibold tracking-tight ${colour}`}>{label}</p>
        <p className="text-[10px] text-dark-300 font-mono mt-0.5">
          run #{runId}{duration ? ` · ${duration}` : ''}
          {isRunning && <span className="animate-pulse"> · refreshes every 5 s</span>}
        </p>
      </div>
      {runPageUrl && (
        <a href={runPageUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-brand-500
                     border border-brand-500/20 px-3 py-1.5 rounded-xl
                     bg-brand-500/[0.07] hover:bg-brand-500/[0.13]
                     hover:scale-[1.02] active:scale-95
                     transition-all duration-200">
          <ExternalLink size={11} />
          Open in Databricks
        </a>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────
export default function JobTimeline({ status, runId }) {
  // Sort by start_time asc; pending tasks (no start_time) stay at end in original order
  const tasks = [...(status?.tasks || [])].sort((a, b) => {
    if (a.start_time && b.start_time) return a.start_time - b.start_time
    if (a.start_time) return -1
    if (b.start_time) return 1
    return 0
  })

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: [0.25, 1, 0.5, 1] }}
      className="bg-dark-800/40 border border-ui/[0.06] rounded-2xl p-5 shadow-apple-sm">

      <RunHeader
        runId={runId}
        state={status.life_cycle_state}
        result={status.result_state}
        runPageUrl={status.run_page_url}
        startTime={status.start_time}
        endTime={status.end_time}
      />

      {tasks.length > 0 ? (
        <div>
          {tasks.map((task, i) => (
            <Step
              key={task.task_key}
              task={task}
              index={i}
              isLast={i === tasks.length - 1}
            />
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm text-dark-200 py-2">
          <Loader2 size={14} className="animate-spin text-brand-500" />
          Waiting for tasks to appear…
        </div>
      )}
    </motion.div>
  )
}
