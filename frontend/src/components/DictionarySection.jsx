import { useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Upload, Loader2, CheckCircle, XCircle, Sparkles,
  ChevronLeft, ChevronRight, AlertCircle, Cloud, Filter, Clipboard,
} from 'lucide-react'
import { parseDictionary, generateDictLogic, uploadDictionary } from '../services/api'

// ─── normalize — exact mirror of backend normalize_element_name ───────────────

function normalizeElementName(name) {
  if (!name) return ''
  let s = name.trim()
  s = s.replace(/[ \-/\\]+/g, '_')
  s = s.replace(/['"()[\]{}.,:;!?@#$%^&*+=~`]+/g, '')
  s = s.replace(/[^a-zA-Z0-9_]/g, '')
  s = s.replace(/_+/g, '_')
  s = s.replace(/^_+|_+$/g, '')
  if (s && /^\d/.test(s)) s = 'col_' + s
  return s || 'unnamed'
}

// ─── Databricks column name validation (mirrors MetadataGrid) ────────────────

const DB_RESERVED = new Set([
  'select','from','where','table','column','index','view','create','drop',
  'insert','update','delete','merge','into','values','set','and','or','not',
  'null','true','false','case','when','then','else','end','join','left',
  'right','inner','outer','on','group','by','order','having','limit',
  'offset','union','all','distinct','as','with','partition','database',
  'schema','catalog','use','show','describe','explain','cast','over',
])

function validateColName(name) {
  if (!name)                                     return 'Cannot be empty'
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name))  return 'Only letters, numbers, underscores — must not start with a number'
  if (name.length > 255)                         return 'Exceeds 255 characters'
  if (DB_RESERVED.has(name.toLowerCase()))       return 'Reserved Databricks keyword'
  return null
}

// ─── constants ───────────────────────────────────────────────────────────────

const PAGE_SIZE  = 50
const SKIP_LOGIC = new Set(['Align with Data Format', 'MASTER_CODE_LOOKUP', 'Not required'])

const INNER_TABS = [
  { id: 'dict', label: 'Data Dictionary', desc: 'System Level + Domain Level — All' },
  { id: 'code', label: 'Master Code',     desc: 'System Code Table + Domain Code Table' },
]

const DD_COLUMNS = [
  { key: 'Data Element Name',           label: 'Data Element Name',    width: 'w-44', special: 'elementName' },
  { key: '_safe_element_name',          label: 'Data Element Name (Normalized)', width: 'w-52', special: 'safeName' },
  { key: 'Dictionary Technical Logic',  label: 'Technical Logic',      width: 'w-56', special: 'logic'       },
  { key: '_generated_sql',             label: 'Generated SQL',        width: 'w-56', special: 'sql'         },
  { key: 'Dictionary Level',           label: 'Level',                width: 'w-24', editable: true         },
  { key: 'Dictionary Domain',          label: 'Domain',               width: 'w-28', editable: true         },
  { key: 'Description',                label: 'Description',          width: 'w-52', editable: true         },
  { key: 'Data Element Alias',         label: 'Alias',                width: 'w-36', editable: true         },
  { key: 'Data Type',                  label: 'Type',                 width: 'w-24', editable: true         },
  { key: 'Data Length',                label: 'Length',               width: 'w-16', editable: true         },
  { key: 'Data Format',                label: 'Format',               width: 'w-24', editable: true         },
  { key: 'Master Code Reference',      label: 'Master Code Ref',      width: 'w-32', editable: true         },
  { key: 'Data Verification Rules and Code Reference Table', label: 'Verification Rules', width: 'w-52', editable: true },
  { key: 'Data Source Agency',         label: 'Source Agency',        width: 'w-28', editable: true         },
  { key: 'Data Owner',                 label: 'Owner',                width: 'w-36', editable: true         },
  { key: 'DRM',                       label: 'DRM',                  width: 'w-24', editable: true         },
  { key: 'Data Element mapped to DRM', label: 'Mapped to DRM',       width: 'w-32', editable: true         },
]

const MC_COLUMNS = [
  { key: 'Code Level',              label: 'Level',              width: 'w-24' },
  { key: 'Code Table Name',         label: 'Table Name',         width: 'w-44' },
  { key: 'Code Owner',              label: 'Owner',              width: 'w-28' },
  { key: 'Adopted Standards',       label: 'Adopted Standards',  width: 'w-36' },
  { key: 'Dependent Data Elements', label: 'Dependent Elements', width: 'w-44' },
  { key: 'Usage Guidelines',        label: 'Usage Guidelines',   width: 'w-52' },
  { key: 'Code Value',              label: 'Value',              width: 'w-28' },
  { key: 'Code Description',        label: 'Description',        width: 'w-56' },
]

// ─── Dropzone ─────────────────────────────────────────────────────────────────

function DictDropzone({ onFile, loading }) {
  const [dragging, setDragging] = useState(false)

  const handleDrop = useCallback(e => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) onFile(f)
  }, [onFile])

  return (
    <label
      className={`flex flex-col items-center justify-center gap-4 border-2 border-dashed
        rounded-3xl p-12 text-center cursor-pointer transition-all duration-300
        ${dragging
          ? 'border-brand-500 bg-brand-500/[0.06] scale-[1.02]'
          : 'border-ui/[0.15] hover:border-brand-500/50 hover:bg-brand-500/[0.03]'}`}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}>
      <input type="file" accept=".xlsx,.xls" className="hidden"
        onChange={e => e.target.files[0] && onFile(e.target.files[0])} />
      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-colors duration-200
        ${dragging ? 'bg-brand-500/20' : 'bg-dark-800'}`}>
        {loading
          ? <Loader2 size={28} className="text-brand-500 animate-spin" />
          : <Upload  size={28} className={dragging ? 'text-brand-500' : 'text-dark-300'} />}
      </div>
      <div>
        <p className="text-sm font-semibold text-dark-50">
          {loading ? 'Parsing dictionary…' : 'Drop NCSS_Data_Dictionary.xlsx here'}
        </p>
        <p className="text-xs text-dark-300 mt-1">or click to browse · Excel files only</p>
      </div>
    </label>
  )
}

// ─── Paste zone (Purview bypass) ─────────────────────────────────────────────

function DictPasteZone({ onFile, loading }) {
  const [focused,    setFocused]    = useState(false)
  const [pastedName, setPastedName] = useState(null)
  const [error,      setError]      = useState(null)

  function handlePaste(e) {
    const file = e.clipboardData?.files?.[0]
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (!['xls', 'xlsx'].includes(ext)) {
      setError(`Unsupported type ".${ext}" — use XLS or XLSX`)
      return
    }
    setError(null)
    setPastedName(file.name)
    onFile(file)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: [0.25, 1, 0.5, 1], delay: 0.05 }}
      tabIndex={0}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); setError(null) }}
      onPaste={handlePaste}
      className={`
        rounded-3xl p-8 text-center cursor-text outline-none
        border-2 transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]
        ${focused
          ? 'border-amber-500/60 bg-amber-500/[0.05] shadow-[0_0_0_3px_rgb(245_158_11/0.12)]'
          : 'border-dashed border-ui/[0.15] hover:border-amber-500/30 hover:bg-amber-500/[0.02]'
        }
      `}>
      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex flex-col items-center gap-3">
            <Loader2 size={24} className="text-brand-500 animate-spin" />
            <p className="text-sm text-dark-200">Parsing…</p>
          </motion.div>
        ) : pastedName ? (
          <motion.div key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-3">
            <CheckCircle size={24} className="text-green-500 dark:text-green-400" />
            <p className="text-sm font-semibold text-green-600 dark:text-green-400">{pastedName}</p>
            <p className="text-xs text-dark-300">File received — processing…</p>
          </motion.div>
        ) : focused ? (
          <motion.div key="focused" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/[0.15] flex items-center justify-center">
              <Clipboard size={20} className="text-amber-500" />
            </div>
            <p className="text-sm font-semibold text-amber-500">Ready — press Ctrl+V to paste</p>
            {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
          </motion.div>
        ) : (
          <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-dark-800 border border-ui/[0.07] flex items-center justify-center">
              <Clipboard size={20} className="text-dark-300" />
            </div>
            <div>
              <p className="text-sm font-semibold text-dark-50 tracking-tight">Blocked by company policy?</p>
              <p className="text-xs text-dark-200 mt-1 leading-relaxed">
                Copy the Excel file{' '}
                <kbd className="px-1.5 py-0.5 rounded-md bg-dark-800 border border-ui/[0.1] text-[10px] font-mono text-dark-200">Ctrl+C</kbd>
                {' '}then click here and press{' '}
                <kbd className="px-1.5 py-0.5 rounded-md bg-dark-800 border border-ui/[0.1] text-[10px] font-mono text-dark-200">Ctrl+V</kbd>
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ─── Shared cell input ────────────────────────────────────────────────────────

function Cell({ value, onChange, width }) {
  return (
    <input value={value} onChange={e => onChange(e.target.value)}
      className={`${width} bg-dark-800 border border-ui/[0.08] rounded-lg px-2 py-1
                  text-xs text-dark-50 font-mono focus:outline-none focus:ring-1
                  focus:ring-brand-500/60 focus:border-brand-500 transition-all duration-150`} />
  )
}

// ─── Paginator ────────────────────────────────────────────────────────────────

function Paginator({ page, setPage, total, pageSize }) {
  const totalPages = Math.ceil(total / pageSize)
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-center gap-3 py-1">
      <button disabled={page === 0} onClick={() => setPage(0)}
        className="text-xs text-dark-300 hover:text-dark-50 disabled:opacity-30 transition-colors px-2 py-1 rounded-lg hover:bg-ui/[0.05]">
        First
      </button>
      <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
        className="p-1.5 rounded-lg hover:bg-ui/[0.06] disabled:opacity-30 transition-colors">
        <ChevronLeft size={14} />
      </button>
      <span className="text-xs text-dark-300">
        {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
      </span>
      <button disabled={page === totalPages - 1} onClick={() => setPage(p => p + 1)}
        className="p-1.5 rounded-lg hover:bg-ui/[0.06] disabled:opacity-30 transition-colors">
        <ChevronRight size={14} />
      </button>
      <button disabled={page === totalPages - 1} onClick={() => setPage(totalPages - 1)}
        className="text-xs text-dark-300 hover:text-dark-50 disabled:opacity-30 transition-colors px-2 py-1 rounded-lg hover:bg-ui/[0.05]">
        Last
      </button>
    </div>
  )
}

// ─── Data Dictionary grid ─────────────────────────────────────────────────────
// rows: already-filtered slice, each row carries _idx = original index in ddRows

function DataDictionaryGrid({
  rows, totalCount, domains, domainFilter, onDomainChange,
  onChangeRow, generating, onGenerateSQL,
}) {
  const [page, setPage] = useState(0)
  const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div className="space-y-3">

      {/* ── Filter + row count bar ── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-xs text-dark-300">
          {rows.length === totalCount
            ? `${totalCount} rows · System Level + Domain Level`
            : `${rows.length} of ${totalCount} rows`}
        </p>

        <div className="flex items-center gap-2">
          <Filter size={12} className="text-dark-400" />
          <span className="text-xs text-dark-300">Domain:</span>
          <select
            value={domainFilter}
            onChange={e => { onDomainChange(e.target.value); setPage(0) }}
            className="bg-dark-800 border border-ui/[0.08] rounded-xl px-3 py-1.5
                       text-xs text-dark-50 focus:outline-none focus:ring-1 focus:ring-brand-500/60
                       focus:border-brand-500 cursor-pointer transition-all duration-200">
            {domains.map(d => (
              <option key={d} value={d}>{d === 'All' ? 'All domains' : d}</option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="overflow-auto rounded-2xl border border-ui/[0.07] shadow-apple dark:shadow-none"
           style={{ maxHeight: '520px' }}>
        <table className="text-xs whitespace-nowrap w-full">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-ui/[0.07] bg-dark-800">
              <th className="px-3 py-3 text-left text-[10px] text-dark-300 font-semibold uppercase tracking-[0.08em]">#</th>
              {DD_COLUMNS.map(col => (
                <th key={col.key} className="px-3 py-3 text-left text-[10px] text-dark-300 font-semibold uppercase tracking-[0.08em]">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map(row => {
              const origIdx      = row._idx
              const isGenerating = generating.has(origIdx)
              const elemName     = row['Data Element Name'] || ''
              const safeName     = row['_safe_element_name'] || ''
              const logic        = row['Dictionary Technical Logic'] || ''
              const canGenerate  = logic && !SKIP_LOGIC.has(logic.trim())
              const wasNormalized = elemName !== '' && elemName.trim() !== safeName

              return (
                <tr key={origIdx} className="border-b border-ui/[0.05] hover:bg-ui/[0.02] transition-colors">
                  <td className="px-3 py-2 text-dark-400 font-mono text-[10px]">{origIdx + 1}</td>

                  {DD_COLUMNS.map(col => {

                    // ── Original Data Element Name — read-only badge ──
                    if (col.special === 'elementName') {
                      return (
                        <td key={col.key} className="px-3 py-2.5">
                          <span className="font-mono text-dark-200 bg-dark-800 px-1.5 py-0.5 rounded-md text-[11px]">
                            {elemName || '—'}
                          </span>
                        </td>
                      )
                    }

                    // ── Data Element Name (Normalized) — editable, validated, MetadataGrid style ──
                    if (col.special === 'safeName') {
                      const err = validateColName(safeName)
                      return (
                        <td key={col.key} className="px-3 py-2.5">
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1.5">
                              <input
                                value={safeName}
                                onChange={e => onChangeRow(origIdx, '_safe_element_name', e.target.value)}
                                className={`w-52 rounded-lg px-2 py-1 text-xs font-mono
                                           focus:outline-none focus:ring-1 transition-all duration-200
                                           ${err
                                             ? 'bg-red-500/[0.08] border border-red-500/40 text-red-600 dark:text-red-400 focus:ring-red-500/50'
                                             : 'bg-dark-800 border border-ui/[0.08] text-green-600 dark:text-green-400 focus:ring-brand-500/60'
                                           }`}
                              />
                              {err && <AlertCircle size={12} className="text-red-500 dark:text-red-400 shrink-0" />}
                            </div>
                            {err && (
                              <p className="text-[10px] text-red-600 dark:text-red-400 pl-0.5">{err}</p>
                            )}
                            {!err && wasNormalized && (
                              <p className="text-[10px] text-dark-300 pl-0.5">✓ normalized</p>
                            )}
                          </div>
                        </td>
                      )
                    }

                    // ── Dictionary Technical Logic — editable + AI button ──
                    if (col.special === 'logic') {
                      return (
                        <td key={col.key} className="px-3 py-2">
                          <div className="flex flex-col gap-1.5">
                            <input
                              value={logic}
                              onChange={e => onChangeRow(origIdx, 'Dictionary Technical Logic', e.target.value)}
                              className="w-56 bg-dark-800 border border-ui/[0.08] rounded-lg px-2 py-1
                                         text-xs text-dark-50 focus:outline-none focus:ring-1
                                         focus:ring-brand-500/60 focus:border-brand-500 transition-all"
                            />
                            {canGenerate && (
                              <button
                                disabled={isGenerating}
                                onClick={() => onGenerateSQL(origIdx)}
                                className="flex items-center gap-1 px-2 py-0.5 self-start
                                           bg-brand-500/[0.1] border border-brand-500/20 text-brand-500
                                           rounded-lg text-[10px] font-medium
                                           hover:bg-brand-500/[0.18] disabled:opacity-40 transition-all duration-200">
                                {isGenerating
                                  ? <><Loader2 size={9} className="animate-spin" /> Generating…</>
                                  : <><Sparkles size={9} /> Generate SQL</>}
                              </button>
                            )}
                          </div>
                        </td>
                      )
                    }

                    // ── Generated SQL — read-only code block ──
                    if (col.special === 'sql') {
                      const sql = row['_generated_sql'] || ''
                      return (
                        <td key={col.key} className="px-3 py-2">
                          {sql
                            ? <code className="block w-56 text-[10px] text-green-600 dark:text-green-400
                                               bg-green-500/[0.07] border border-green-500/15
                                               rounded-lg px-2 py-1.5 font-mono leading-relaxed
                                               whitespace-pre-wrap break-all">{sql}</code>
                            : <span className="text-dark-400 text-[10px]">—</span>
                          }
                        </td>
                      )
                    }

                    // ── Generic editable cell ──
                    return (
                      <td key={col.key} className="px-3 py-2">
                        <Cell
                          value={row[col.key] || ''}
                          onChange={val => onChangeRow(origIdx, col.key, val)}
                          width={col.width}
                        />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Paginator page={page} setPage={setPage} total={rows.length} pageSize={PAGE_SIZE} />
    </div>
  )
}

// ─── Master Code grid ─────────────────────────────────────────────────────────

function MasterCodeGrid({ rows, onChangeRow }) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-dark-300">
        {rows.length} rows · System Code Table + Domain Code Table
      </p>
      <div className="overflow-auto rounded-2xl border border-ui/[0.07] shadow-apple dark:shadow-none"
           style={{ maxHeight: '520px' }}>
        <table className="text-xs whitespace-nowrap w-full">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-ui/[0.07] bg-dark-800">
              <th className="px-3 py-3 text-left text-[10px] text-dark-300 font-semibold uppercase tracking-[0.08em]">#</th>
              {MC_COLUMNS.map(col => (
                <th key={col.key} className="px-3 py-3 text-left text-[10px] text-dark-300 font-semibold uppercase tracking-[0.08em]">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-ui/[0.05] hover:bg-ui/[0.02] transition-colors">
                <td className="px-3 py-2 text-dark-400 font-mono text-[10px]">{i + 1}</td>
                {MC_COLUMNS.map(col => (
                  <td key={col.key} className="px-3 py-2">
                    <Cell
                      value={row[col.key] || ''}
                      onChange={val => onChangeRow(i, col.key, val)}
                      width={col.width}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function DictionarySection() {
  const [phase,        setPhase]       = useState('upload')
  const [innerTab,     setInnerTab]    = useState('dict')

  const [ddHeaders,    setDdHeaders]   = useState([])
  const [ddRows,       setDdRows]      = useState([])   // each row has _idx, _safe_element_name
  const [mcHeaders,    setMcHeaders]   = useState([])
  const [mcRows,       setMcRows]      = useState([])

  const [domainFilter, setDomainFilter] = useState('All')

  const [parseLoading, setParseLoading] = useState(false)
  const [parseError,   setParseError]  = useState(null)
  const [generating,   setGenerating]  = useState(new Set())

  const [uploadPhase,  setUploadPhase] = useState('idle')
  const [uploadError,  setUploadError] = useState(null)
  const [uploadedPath, setUploadedPath] = useState(null)

  // ── Derived: unique domains sorted, prefixed with "All" ──
  const domains = useMemo(() => {
    const vals = [...new Set(ddRows.map(r => r['Dictionary Domain']).filter(Boolean))].sort()
    return ['All', ...vals]
  }, [ddRows])

  // ── Derived: filtered rows (always a subset of ddRows) ──
  const filteredDdRows = useMemo(() =>
    domainFilter === 'All'
      ? ddRows
      : ddRows.filter(r => r['Dictionary Domain'] === domainFilter),
    [ddRows, domainFilter]
  )

  // ── File parse ───────────────────────────────────────────────────────────────

  async function handleFileDrop(file) {
    setParseLoading(true)
    setParseError(null)
    try {
      const result = await parseDictionary(file)

      // Stamp each DD row with a stable _idx and guaranteed _safe_element_name
      const enriched = result.data_dictionary.rows.map((row, i) => {
        const elem     = (row['Data Element Name'] || '').trim()
        const safeName = normalizeElementName(elem)  // always computed client-side
        return {
          ...row,
          _idx:              i,
          _safe_element_name: safeName,
          _generated_sql:    row._generated_sql || '',
        }
      })

      setDdHeaders(result.data_dictionary.headers)
      setDdRows(enriched)
      setMcHeaders(result.master_code.headers)
      setMcRows(result.master_code.rows)
      setPhase('edit')
    } catch (e) {
      setParseError(e.response?.data?.detail || e.message)
    } finally {
      setParseLoading(false)
    }
  }

  // ── Row updates ──────────────────────────────────────────────────────────────

  function handleChangeDdRow(origIdx, key, value) {
    setDdRows(prev => prev.map(row => {
      if (row._idx !== origIdx) return row
      const updated = { ...row, [key]: value }
      // Auto-recompute safe name when Data Element Name is edited
      if (key === 'Data Element Name') {
        updated['_safe_element_name'] = normalizeElementName(value)
      }
      return updated
    }))
  }

  function handleChangeMcRow(idx, key, value) {
    setMcRows(prev => prev.map((row, i) => i === idx ? { ...row, [key]: value } : row))
  }

  // ── AI SQL generation ────────────────────────────────────────────────────────

  async function handleGenerateSQL(origIdx) {
    const row = ddRows.find(r => r._idx === origIdx)
    if (!row) return
    setGenerating(prev => new Set([...prev, origIdx]))
    try {
      const result = await generateDictLogic(
        row['_safe_element_name']         || '',
        row['Dictionary Technical Logic'] || '',
        row['Description']                || '',
      )
      setDdRows(prev => prev.map(r =>
        r._idx === origIdx ? { ...r, _generated_sql: result.sql } : r
      ))
    } catch {
      // silently leave cell empty
    } finally {
      setGenerating(prev => {
        const next = new Set(prev)
        next.delete(origIdx)
        return next
      })
    }
  }

  // ── Upload ───────────────────────────────────────────────────────────────────

  async function handleUpload() {
    setUploadPhase('uploading')
    setUploadError(null)
    try {
      const result = await uploadDictionary(
        { headers: ddHeaders, rows: ddRows },
        { headers: mcHeaders, rows: mcRows },
        'NCSS_Data_Dictionary.xlsx',
      )
      setUploadedPath(result.path)
      setUploadPhase('done')
    } catch (e) {
      setUploadError(e.response?.data?.detail || e.message)
      setUploadPhase('error')
    }
  }

  function handleReset() {
    setPhase('upload')
    setDdRows([]); setDdHeaders([])
    setMcRows([]); setMcHeaders([])
    setDomainFilter('All')
    setUploadPhase('idle')
    setParseError(null)
  }

  // ── Upload phase ──────────────────────────────────────────────────────────────

  if (phase === 'upload') {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ease: [0.25, 1, 0.5, 1] }}
        className="space-y-3">
        <DictDropzone onFile={handleFileDrop} loading={parseLoading} />
        <DictPasteZone onFile={handleFileDrop} loading={parseLoading} />
        {parseError && (
          <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400
                          bg-red-500/[0.08] border border-red-500/20 rounded-2xl px-5 py-4">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{parseError}</span>
          </div>
        )}
      </motion.div>
    )
  }

  // ── Edit phase ────────────────────────────────────────────────────────────────

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: [0.25, 1, 0.5, 1] }}
      className="space-y-4">

      {/* ── Inner tab bar ── */}
      <div className="flex items-center gap-1 bg-dark-800/60 border border-ui/[0.07] rounded-2xl p-1">
        {INNER_TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setInnerTab(tab.id)}
            className={`flex-1 flex flex-col items-center py-2.5 px-4 rounded-xl
                        transition-all duration-200
              ${innerTab === tab.id
                ? 'bg-dark-900 shadow-apple dark:shadow-apple-dk border border-ui/[0.07]'
                : 'hover:bg-ui/[0.04]'}`}>
            <span className={`text-xs font-semibold tracking-tight transition-colors duration-200
              ${innerTab === tab.id ? 'text-brand-500' : 'text-dark-200'}`}>
              {tab.label}
            </span>
            <span className="text-[10px] text-dark-400 mt-0.5">{tab.desc}</span>
          </button>
        ))}
      </div>

      {/* ── Grid content ── */}
      <AnimatePresence mode="wait">
        {innerTab === 'dict' && (
          <motion.div key="dict"
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }} transition={{ ease: [0.25, 1, 0.5, 1] }}>
            <DataDictionaryGrid
              rows={filteredDdRows}
              totalCount={ddRows.length}
              domains={domains}
              domainFilter={domainFilter}
              onDomainChange={setDomainFilter}
              onChangeRow={handleChangeDdRow}
              generating={generating}
              onGenerateSQL={handleGenerateSQL}
            />
          </motion.div>
        )}

        {innerTab === 'code' && (
          <motion.div key="code"
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -2 }} transition={{ ease: [0.25, 1, 0.5, 1] }}>
            <MasterCodeGrid rows={mcRows} onChangeRow={handleChangeMcRow} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Upload to Databricks ── */}
      <div className="bg-dark-900 border border-ui/[0.07] rounded-2xl overflow-hidden shadow-apple dark:shadow-apple-dk">
        <div className="px-5 py-4 border-b border-ui/[0.06]">
          <h2 className="text-sm font-semibold text-dark-50 tracking-tight">Upload to Databricks</h2>
          <p className="text-xs text-dark-200 mt-0.5">
            Saves both sheets as a single Excel to{' '}
            <span className="font-mono">/Volumes/catalog_central/dictionary/file_upload/</span>
          </p>
        </div>
        <div className="p-5">
          {uploadPhase === 'idle' && (
            <button onClick={handleUpload}
              className="flex items-center gap-2 px-4 py-2 bg-brand-500 hover:bg-brand-600
                         text-white text-sm rounded-xl font-semibold shadow-apple-blue
                         hover:shadow-apple-blue-lg hover:scale-[1.02] active:scale-95
                         transition-all duration-200">
              <Cloud size={14} />
              Upload dictionary to Databricks
            </button>
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
              <button onClick={handleUpload}
                className="flex items-center gap-2 px-3 py-1.5 border border-red-500/25
                           text-red-600 dark:text-red-400 text-xs rounded-xl
                           hover:bg-red-500/[0.08] transition-all duration-200">
                Retry upload
              </button>
            </div>
          )}
        </div>
      </div>

      <button onClick={handleReset}
        className="flex items-center gap-2 text-sm text-dark-200 hover:text-dark-50
                   transition-colors duration-200">
        Upload a different file
      </button>
    </motion.div>
  )
}
