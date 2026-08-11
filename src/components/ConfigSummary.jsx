import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  CheckCircle, RotateCcw, Copy, Check,
  Upload, Play, Loader2, XCircle,
  AlertCircle,
} from 'lucide-react'
import { uploadToVolume } from '../services/api'

// ── Shared UI primitives ────────────────────────────────────────────────────
function Card({ children, className = '' }) {
  return (
    <div className={`bg-dark-900 border border-ui/[0.07] rounded-2xl overflow-hidden shadow-apple dark:shadow-apple-dk ${className}`}>
      {children}
    </div>
  )
}

function CardHeader({ title, subtitle }) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-ui/[0.06]">
      <div>
        <h2 className="text-sm font-semibold text-dark-50 tracking-tight">{title}</h2>
        {subtitle && <p className="text-xs text-dark-200 mt-0.5 leading-relaxed">{subtitle}</p>}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
export default function ConfigSummary({ config, file, onReset }) {
  const navigate = useNavigate()
  const [copied, setCopied] = useState(false)

  // Always start fresh — MetadataPage is always-mounted so React state
  // survives module navigation without needing localStorage.
  const [uploadPhase,  setUploadPhase]  = useState('idle')
  const [uploadedPath, setUploadedPath] = useState(null)
  const [uploadError,  setUploadError]  = useState(null)

  async function handleUpload() {
    if (!file) return
    setUploadPhase('uploading')
    setUploadError(null)
    try {
      const result = await uploadToVolume(file, config.source_path)
      setUploadedPath(result.path)
      setUploadPhase('done')
    } catch (e) {
      setUploadError(e.response?.data?.detail || e.message)
      setUploadPhase('error')
    }
  }

  function handleGoToJobRun() {
    navigate('/jobrun', { state: { preselect: config.job_name } })
  }

  function copyAll() {
    const text = rows.map(([k, v]) => `${k}: ${v}`).join('\n')
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const rows = [
    ['Job name',          config.job_name],
    ['Domain',            config.domain],
    ['Source type',       config.source_type],
    ['Source filename',   config.source_filename],
    ['Source path',       config.source_path],
    ['Bronze catalog',    config.bronze_catalog_name],
    ['Bronze table',      config.bronze_table_name],
    ['Bronze archive',    config.bronze_archive_path],
    ['Silver catalog',    config.silver_catalog_name],
    ['Silver table',      config.silver_table_name],
    ['Silver curated',    config.silver_curated_path],
    ['Silver history',    config.silver_history_path],
    ['Silver invalid',    config.silver_invalid_path],
    ['Primary key',       config.silver_primary_key || '(none)'],
    ['Mandatory cols',    config.silver_mandatory_columns || '(none)'],
    ['Silver write mode', config.silver_write_mode],
    ['Silver load type',  config.silver_load_type],
  ]

  const slideIn = {
    initial:    { opacity: 0, y: 8 },
    animate:    { opacity: 1, y: 0 },
    exit:       { opacity: 0, y: -4 },
    transition: { ease: [0.25, 1, 0.5, 1] },
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: [0.25, 1, 0.5, 1] }}
      className="space-y-4">

      {/* ── Saved banner ── */}
      <motion.div
        initial={{ scale: 0.97, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ ease: [0.25, 1, 0.5, 1], delay: 0.05 }}
        className="flex items-center gap-4 bg-green-500/[0.08] border border-green-500/20
                   rounded-2xl px-6 py-5">
        <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center shrink-0">
          <CheckCircle size={20} className="text-green-500 dark:text-green-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-green-700 dark:text-green-400">
            Config row saved to Databricks
          </p>
          <p className="text-xs text-green-600/70 dark:text-green-600 mt-0.5 font-mono">
            catalog_central.medallion_config.tbl_config → {config.job_name}
          </p>
        </div>
      </motion.div>

      {/* ── Saved configuration ── */}
      <Card>
        <div className="flex items-center justify-between px-5 py-4 border-b border-ui/[0.06]">
          <h2 className="text-sm font-semibold text-dark-50 tracking-tight">Saved configuration</h2>
          <button
            onClick={copyAll}
            className="flex items-center gap-1.5 text-xs text-dark-200 hover:text-dark-50
                       transition-colors duration-200 px-2.5 py-1.5 rounded-lg hover:bg-ui/[0.05]">
            {copied
              ? <Check size={12} className="text-green-500 dark:text-green-400" />
              : <Copy size={12} />}
            {copied ? 'Copied!' : 'Copy all'}
          </button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-x-8 gap-y-2.5">
          {rows.map(([label, val], i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.02 }}
              className="flex text-xs gap-2">
              <span className="text-dark-300 w-36 shrink-0">{label}</span>
              <span className="font-mono text-dark-50 truncate">{val || '—'}</span>
            </motion.div>
          ))}
        </div>
      </Card>

      {/* ── Upload to Volume ── */}
      <Card>
        <CardHeader
          title="Upload to Volume"
          subtitle={<>Push source file to <span className="font-mono">{config.source_path}</span></>}
        />
        <div className="p-5">
          {uploadPhase === 'idle' && (
            file ? (
              <button
                onClick={handleUpload}
                className="flex items-center gap-2 px-4 py-2 bg-brand-500 hover:bg-brand-600
                           text-white text-sm rounded-xl font-semibold
                           shadow-apple-blue hover:shadow-apple-blue-lg
                           hover:scale-[1.02] active:scale-95 transition-all duration-200">
                <Upload size={14} />
                Upload {file.name}
              </button>
            ) : (
              <div className="flex items-center gap-2 text-sm text-amber-500">
                <AlertCircle size={15} />
                Source file unavailable after page refresh — use&nbsp;
                <button
                  onClick={onReset}
                  className="underline hover:text-amber-400 transition-colors">
                  Configure another table
                </button>
                &nbsp;to restart, or upload the file to Databricks directly.
              </div>
            )
          )}

          {uploadPhase === 'uploading' && (
            <div className="flex items-center gap-2.5 text-sm text-dark-200">
              <Loader2 size={16} className="animate-spin text-brand-500" />
              Uploading to Databricks volume…
            </div>
          )}

          {uploadPhase === 'done' && (
            <div className="flex items-center gap-2.5 text-sm text-green-600 dark:text-green-400">
              <CheckCircle size={16} />
              <span>
                Uploaded —{' '}
                <span className="font-mono text-xs text-dark-200">{uploadedPath}</span>
              </span>
            </div>
          )}

          {uploadPhase === 'error' && (
            <div className="space-y-3">
              <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400">
                <XCircle size={16} className="shrink-0 mt-0.5" />
                <span>{uploadError}</span>
              </div>
              <button
                onClick={handleUpload}
                className="flex items-center gap-2 px-3 py-1.5
                           border border-red-500/25 text-red-600 dark:text-red-400
                           text-xs rounded-xl hover:bg-red-500/[0.08] transition-all duration-200">
                Retry upload
              </button>
            </div>
          )}
        </div>
      </Card>

      {/* ── Run Pipeline ── */}
      <AnimatePresence>
        {uploadPhase === 'done' && (
          <motion.div key="run-card" {...slideIn}>
            <Card>
              <CardHeader
                title="Run Pipeline"
                subtitle={
                  <>
                    Trigger the full TIER 1 → TIER 2 pipeline in the Job Run module.&nbsp;
                    <span className="font-mono">{config.job_name}</span> will be pre-selected.
                  </>
                }
              />
              <div className="p-5 flex items-center gap-4">
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={handleGoToJobRun}
                  className="flex items-center gap-2 px-4 py-2
                             bg-brand-500 hover:bg-brand-600 text-white
                             text-sm rounded-xl font-semibold
                             shadow-apple-blue hover:shadow-apple-blue-lg
                             transition-all duration-200">
                  <Play size={13} className="ml-0.5" />
                  Run
                </motion.button>
                <p className="text-xs text-dark-400">
                  Opens Job Run with this entity already selected — click Run to start the pipeline.
                </p>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <button
        onClick={onReset}
        className="flex items-center gap-2 text-sm text-dark-200 hover:text-dark-50
                   transition-colors duration-200 group">
        <RotateCcw size={14} className="group-hover:rotate-[-30deg] transition-transform duration-300" />
        Configure another table
      </button>
    </motion.div>
  )
}
