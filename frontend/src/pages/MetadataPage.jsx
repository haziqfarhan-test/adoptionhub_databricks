import { useState, useEffect, useRef } from 'react'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { motion, AnimatePresence } from 'framer-motion'
import FileDropzone from '../components/FileDropzone'
import MetadataGrid from '../components/MetadataGrid'
import ConfigSummary from '../components/ConfigSummary'
import DictionarySection from '../components/DictionarySection'
import {
  parseFile, enrichWithAI, saveConfig,
  listDomains, createDomain, getConfigTableStatus, createConfigTable,
} from '../services/api'
import { Sparkles, Save, RotateCcw, AlertTriangle, ChevronDown, ChevronUp, Database, BookOpen } from 'lucide-react'

const SUBSECTIONS = [
  {
    id: 'dataset',
    icon: Database,
    title: 'Dataset',
    desc: 'Upload a source file, configure medallion architecture paths, review and annotate column metadata.',
  },
  {
    id: 'dictionary',
    icon: BookOpen,
    title: 'Data Dictionary',
    desc: 'Upload an NCSS data dictionary Excel, enrich with AI-generated SQL logic, and push to Databricks.',
  },
]

const NEW_DOMAIN_OPTION   = '__new_domain__'
const TARGET_CATEGORIES   = ['daily', 'weekly', 'monthly', 'yearly']
const SILVER_LOAD_TYPES   = ['incremental', 'overwrite']

const DB_RESERVED = new Set([
  'select','from','where','table','column','index','view','create','drop',
  'insert','update','delete','merge','into','values','set','and','or','not',
  'null','true','false','case','when','then','else','end','join','left',
  'right','inner','outer','on','group','by','order','having','limit',
  'offset','union','all','distinct','as','with','partition','database',
  'schema','catalog',
])

function validateColName(name) {
  if (!name)                                    return 'Cannot be empty'
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return 'Only letters, numbers, underscores allowed; must not start with a number'
  if (name.length > 255)                        return 'Exceeds 255 characters'
  if (DB_RESERVED.has(name.toLowerCase()))      return 'Reserved Databricks keyword'
  return null
}

function Field({ label, value, onChange, options, readOnly, hint, placeholder, required }) {
  return (
    <div>
      <label className="text-[11px] text-dark-200 block mb-1.5 font-semibold tracking-wide uppercase">
        {label}
        {required && <span className="text-red-500 dark:text-red-400 ml-0.5">*</span>}
        {readOnly && (
          <span className="ml-1.5 text-[9px] text-dark-300 bg-dark-800 px-1.5 py-0.5 rounded-md font-medium tracking-widest">
            AUTO
          </span>
        )}
      </label>
      {options ? (
        <select
          disabled={readOnly}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full bg-dark-800 border border-ui/[0.08] rounded-xl px-3 py-2 text-sm text-dark-50
                     focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500
                     disabled:opacity-40 disabled:cursor-not-allowed
                     transition-all duration-200 cursor-pointer">
          {options.map(o => <option key={o}>{o}</option>)}
        </select>
      ) : (
        <input
          readOnly={readOnly}
          placeholder={placeholder}
          value={value}
          onChange={e => !readOnly && onChange(e.target.value)}
          className="w-full bg-dark-800 border border-ui/[0.08] rounded-xl px-3 py-2 text-sm text-dark-50
                     focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500
                     read-only:opacity-50 read-only:cursor-default placeholder:text-dark-400
                     transition-all duration-200"
        />
      )}
      {hint && <p className="text-[10px] text-dark-300 mt-1.5 leading-relaxed">{hint}</p>}
    </div>
  )
}

function Section({ title, subtitle, children, action, collapsible = false, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: [0.25, 1, 0.5, 1] }}
      className="bg-dark-900 border border-ui/[0.07] rounded-2xl overflow-hidden shadow-apple dark:shadow-apple-dk">
      <div
        className={`flex items-center justify-between px-5 py-4 border-b border-ui/[0.06]
          ${collapsible ? 'cursor-pointer hover:bg-ui/[0.03] transition-colors duration-200' : ''}`}
        onClick={() => collapsible && setOpen(o => !o)}>
        <div>
          <h2 className="text-sm font-semibold text-dark-50 tracking-tight">{title}</h2>
          {subtitle && <p className="text-xs text-dark-200 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {action}
          {collapsible && (
            open
              ? <ChevronUp  size={14} className="text-dark-300 transition-transform duration-300" />
              : <ChevronDown size={14} className="text-dark-300 transition-transform duration-300" />
          )}
        </div>
      </div>
      <AnimatePresence>
        {(!collapsible || open) && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ ease: [0.25, 1, 0.5, 1], duration: 0.3 }}
            className="overflow-hidden">
            <div className="p-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function ValidationErrors({ errors }) {
  if (!errors.length) return null
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: [0.25, 1, 0.5, 1] }}
      className="bg-red-500/[0.08] border border-red-500/25 rounded-2xl px-5 py-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={16} className="text-red-500 dark:text-red-400" />
        <p className="text-sm font-semibold text-red-600 dark:text-red-400">
          {errors.length} column{errors.length > 1 ? 's' : ''} with invalid normalized name
        </p>
      </div>
      <div className="space-y-1.5">
        {errors.map((e, i) => (
          <div key={i} className="flex items-start gap-3 text-xs">
            <span className="font-mono text-red-500 dark:text-red-300 bg-red-500/10 px-1.5 py-0.5 rounded-md shrink-0">
              {e.safe_name || '(empty)'}
            </span>
            <span className="text-red-600 dark:text-red-400">{e.reason}</span>
            <span className="text-dark-300">← from "{e.column}"</span>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

const DEFAULT_CFG = {
  job_name: '', source_entity_name: '', source_filename: '',
  source_type: 'csv', source_delimiter: ',', source_path: '',
  domain: 'sg', target_category: 'daily',
  bronze_catalog_name: '', bronze_archive_path: '', bronze_table_name: '',
  silver_catalog_name: '', silver_table_name: '',
  silver_curated_path: '', silver_history_path: '', silver_invalid_path: '',
  silver_write_mode: 'merge', silver_load_type: 'incremental',
  source_system: 'NCSS', owner: 'NCSS', load_sequence: 1,
  pipeline_name: 'pipeline_01_raw_to_bronze', active: true,
}

export default function MetadataPage() {
  // Persisted across module navigation AND browser refresh via localStorage
  const [activeTab, setActiveTab] = useLocalStorage('ah_activeTab', 'dataset')
  const [step, setStep]           = useLocalStorage('ah_step', 'upload')
  const [columns, setColumns]     = useLocalStorage('ah_columns', [])
  const [saved, setSaved]         = useLocalStorage('ah_saved', null)
  const [cfg, setCfg]             = useLocalStorage('ah_cfg', DEFAULT_CFG)

  // Ephemeral — intentionally reset on page refresh
  const [loading, setLoading]         = useState(false)
  const [aiLoading, setAiLoading]     = useState(false)
  const [uploadedFile, setUploadedFile] = useState(null)
  // Ref fallback: set synchronously in both handleFileDrop and onProfilingHandoff
  // so ConfigSummary always gets the file even if the state update races with navigation.
  const uploadedFileRef = useRef(null)
  const [validationErrors, setValidationErrors] = useState([])

  // Domain (catalog) discovery + "add new domain" flow
  const [domains, setDomains]             = useState([])
  const [domainsLoading, setDomainsLoading] = useState(true)
  const [newDomainName, setNewDomainName] = useLocalStorage('ah_new_domain_name', '')

  // Config table gate — null while checking
  const [configTableStatus, setConfigTableStatus]   = useState(null)
  const [configTableCreating, setConfigTableCreating] = useState(false)
  const [configTableError, setConfigTableError]       = useState('')

  function set(field) { return val => setCfg(c => ({ ...c, [field]: val })) }

  async function refreshDomains() {
    setDomainsLoading(true)
    try {
      const { domains: list } = await listDomains()
      setDomains(list)
    } catch (e) {
      console.error('Failed to load domains', e)
    } finally {
      setDomainsLoading(false)
    }
  }

  async function refreshConfigTableStatus() {
    try {
      const status = await getConfigTableStatus()
      setConfigTableStatus(status)
    } catch (e) {
      setConfigTableStatus({ catalog_exists: false, schema_exists: false, table_exists: false })
    }
  }

  async function handleCreateConfigTable() {
    setConfigTableCreating(true)
    setConfigTableError('')
    try {
      await createConfigTable()
      await refreshConfigTableStatus()
    } catch (e) {
      setConfigTableError(e.response?.data?.detail || e.message)
    } finally {
      setConfigTableCreating(false)
    }
  }

  useEffect(() => {
    refreshDomains()
    refreshConfigTableStatus()
  }, [])

  useEffect(() => {
    const effectiveDomain = cfg.domain === NEW_DOMAIN_OPTION
      ? newDomainName.trim().toLowerCase()
      : cfg.domain
    if (!effectiveDomain) return
    const catalog   = `catalog_${effectiveDomain}`
    const silver_tn = cfg.silver_table_name
    setCfg(c => ({
      ...c,
      bronze_catalog_name: catalog,
      bronze_archive_path: `/Volumes/${catalog}/raw/archive`,
      silver_catalog_name: catalog,
      source_path:         c.source_path.includes('/Volumes/') ? `/Volumes/${catalog}/raw/file_upload/` : c.source_path,
      silver_curated_path: silver_tn ? `${catalog}.silver.${silver_tn}` : '',
      silver_history_path: silver_tn ? `${catalog}.silver.${silver_tn}_hist` : '',
      silver_invalid_path: silver_tn ? `${catalog}.silver.${silver_tn}_reject` : '',
    }))
  }, [cfg.domain, newDomainName, cfg.silver_table_name])

  // Listen for Data Profiling handoff. MetadataPage is always mounted (never unmounted),
  // so localStorage writes from ProfilePage don't update state here. The event bypasses
  // that by calling the setters directly. localStorage is also written by ProfilePage for
  // refresh-persistence, but the live state update comes from this event.
  useEffect(() => {
    function onProfilingHandoff(e) {
      const { columns: cols, cfg: newCfg, file } = e.detail
      setColumns(cols)
      setCfg(newCfg)
      setStep('edit')
      setSaved(null)
      setActiveTab('dataset')
      if (file) {
        uploadedFileRef.current = file  // synchronous — no batching delay
        setUploadedFile(file)
      }
    }
    window.addEventListener('profiling-handoff', onProfilingHandoff)
    return () => window.removeEventListener('profiling-handoff', onProfilingHandoff)
  }, []) // setters from useLocalStorage are stable references — empty deps is correct

  async function handleFileDrop(file) {
    setLoading(true)
    setValidationErrors([])
    try {
      const result = await parseFile(file)
      const fm     = result.file_meta
      const safe   = fm.safe_name
      const tbl    = `tbl_${safe}`
      uploadedFileRef.current = file
      setUploadedFile(file)
      setColumns(result.columns)
      setCfg(c => ({
        ...c,
        job_name:           `pip_${safe}`,
        source_entity_name: safe,
        source_filename:    fm.source_filename,
        source_type:        fm.source_type,
        source_delimiter:   fm.source_delimiter,
        bronze_table_name:  tbl,
        silver_table_name:  tbl,
        source_path:        `/Volumes/catalog_${c.domain === NEW_DOMAIN_OPTION ? newDomainName.trim().toLowerCase() : c.domain}/raw/file_upload/`,
      }))
      setStep('edit')
    } catch (e) { alert('Error parsing file: ' + e.message) }
    finally { setLoading(false) }
  }

  async function handleEnrich() {
    setAiLoading(true)
    try {
      const enriched = await enrichWithAI(columns)
      setColumns(enriched)
    } catch (e) {
      const detail = e.response?.data?.detail
      const msg = Array.isArray(detail)
        ? detail.map(d => `${d.loc?.join('.')}: ${d.msg}`).join('\n')
        : (detail ?? e.message)
      alert('AI enrichment failed:\n' + msg)
    }
    finally { setAiLoading(false) }
  }

  function runClientValidation() {
    const errors = []
    columns.forEach(col => {
      const err = validateColName(col.safe_name)
      if (err) errors.push({ column: col.name, safe_name: col.safe_name, reason: err })
    })
    return errors
  }

  async function handleSave() {
    // Client-side validation first
    const clientErrors = runClientValidation()
    if (clientErrors.length > 0) {
      setValidationErrors(clientErrors)
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
      return
    }
    setValidationErrors([])
    setLoading(true)
    try {
      let domainToSave = cfg.domain
      if (cfg.domain === NEW_DOMAIN_OPTION) {
        const trimmed = newDomainName.trim().toLowerCase()
        if (!trimmed) throw new Error('New domain name is required')
        await createDomain(trimmed)
        domainToSave = trimmed
        await refreshDomains()
      }
      const result = await saveConfig({ ...cfg, domain: domainToSave, columns })
      setSaved(result)
      setStep('saved')
      setCfg(c => ({ ...c, domain: domainToSave }))
      setNewDomainName('')
    } catch (e) {
      const detail = e.response?.data?.detail
      alert('Save failed: ' + (detail || e.message))
    }
    finally { setLoading(false) }
  }

  function handleReset() {
    setStep('upload')
    setColumns([])
    setSaved(null)
    setCfg(DEFAULT_CFG)
    uploadedFileRef.current = null
    setUploadedFile(null)
    setValidationErrors([])
    setActiveTab('dataset')
    setNewDomainName('')
  }

  const effectiveDomain = cfg.domain === NEW_DOMAIN_OPTION ? newDomainName.trim().toLowerCase() : cfg.domain
  const canSave    = cfg.job_name && cfg.source_path && effectiveDomain && configTableStatus?.table_exists
  const hasErrors  = validationErrors.length > 0
  const pkCount    = columns.filter(c => c.is_primary_key).length

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ease: [0.25, 1, 0.5, 1] }}>
        <h1 className="text-[22px] font-bold text-dark-50 tracking-tightest">
          Metadata & Dictionary Setup
        </h1>
        <p className="text-sm text-dark-200 mt-1 leading-relaxed">
          Configure dataset metadata and enrich your data dictionary — choose a subsection below.
        </p>
      </motion.div>

      {/* ── Subsection tabs ── */}
      <div className="grid grid-cols-2 gap-3">
        {SUBSECTIONS.map((tab, i) => {
          const Icon   = tab.icon
          const active = activeTab === tab.id
          return (
            <motion.button
              key={tab.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ease: [0.25, 1, 0.5, 1], delay: i * 0.05 }}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-start gap-4 text-left p-5 rounded-2xl border transition-all duration-200
                ${active
                  ? 'bg-brand-500/[0.08] border-brand-500/30 shadow-[inset_0_0_0_1px_rgb(var(--brand-500)/0.12)]'
                  : 'bg-dark-900 border-ui/[0.07] shadow-apple dark:shadow-apple-dk hover:border-ui/[0.14] hover:bg-ui/[0.02]'
                }`}>
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5 transition-colors duration-200
                ${active ? 'bg-brand-500/[0.15] text-brand-500' : 'bg-dark-800 text-dark-300'}`}>
                <Icon size={18} />
              </div>
              <div>
                <p className={`font-semibold text-sm tracking-tight transition-colors duration-200
                  ${active ? 'text-brand-500' : 'text-dark-50'}`}>
                  {tab.title}
                </p>
                <p className="text-xs text-dark-200 mt-0.5 leading-relaxed">{tab.desc}</p>
              </div>
            </motion.button>
          )
        })}
      </div>

      {/* ── Dataset subsection — always mounted so job run state survives tab switches ── */}
      <div className={activeTab !== 'dataset' ? 'hidden' : ''}>

      {configTableStatus === null && (
        <div className="text-center py-12 text-sm text-dark-200">Checking configuration table…</div>
      )}

      {configTableStatus && !configTableStatus.table_exists && (
        <Section title="Configuration table required">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-500 dark:text-red-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-600 dark:text-red-400">No Config Table Created!</p>
              <p className="text-xs text-dark-200 mt-1.5 leading-relaxed">
                <code className="text-[11px] bg-dark-800 px-1.5 py-0.5 rounded-md">
                  catalog_central.medallion_config.tbl_config
                </code>{' '}
                does not exist yet. Create it to start configuring datasets — this also creates the{' '}
                <code className="text-[11px] bg-dark-800 px-1.5 py-0.5 rounded-md">catalog_central</code> catalog
                and{' '}
                <code className="text-[11px] bg-dark-800 px-1.5 py-0.5 rounded-md">medallion_config</code> schema
                automatically if they are missing.
              </p>
              {configTableError && (
                <p className="text-xs text-red-500 dark:text-red-400 mt-2">{configTableError}</p>
              )}
              <button
                onClick={handleCreateConfigTable}
                disabled={configTableCreating}
                className="mt-3 flex items-center gap-2 px-4 py-2 bg-brand-500 hover:bg-brand-600 text-white
                           text-sm font-semibold rounded-xl disabled:opacity-40 transition-all duration-200 active:scale-95">
                {configTableCreating ? 'Creating…' : 'Create Config Table'}
              </button>
            </div>
          </div>
        </Section>
      )}

      {configTableStatus?.table_exists && <>

      {step === 'upload' && <FileDropzone onFile={handleFileDrop} loading={loading} />}

      {step === 'edit' && (
        <div className="space-y-4">

          {/* Required fields */}
          <Section title="Required fields" subtitle="Select domain and target category — everything else auto-fills.">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] text-dark-200 block mb-1.5 font-semibold tracking-wide uppercase">
                  Domain<span className="text-red-500 dark:text-red-400 ml-0.5">*</span>
                </label>
                <select
                  disabled={domainsLoading}
                  value={cfg.domain}
                  onChange={e => set('domain')(e.target.value)}
                  className="w-full bg-dark-800 border border-ui/[0.08] rounded-xl px-3 py-2 text-sm text-dark-50
                             focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500
                             disabled:opacity-40 disabled:cursor-not-allowed
                             transition-all duration-200 cursor-pointer">
                  {domains.map(d => <option key={d} value={d}>{d}</option>)}
                  <option value={NEW_DOMAIN_OPTION}>+ Add new domain</option>
                </select>
                <p className="text-[10px] text-dark-300 mt-1.5 leading-relaxed">
                  {domainsLoading ? 'Loading available catalogs…' : 'Drives catalog_<domain> naming across all layers'}
                </p>
                {cfg.domain === NEW_DOMAIN_OPTION && (
                  <div className="mt-2">
                    <input
                      value={newDomainName}
                      onChange={e => setNewDomainName(e.target.value)}
                      placeholder="e.g. finance"
                      required
                      className="w-full bg-dark-800 border border-brand-500/40 rounded-xl px-3 py-2 text-sm text-dark-50
                                 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500
                                 placeholder:text-dark-400 transition-all duration-200" />
                    <p className="text-[10px] text-dark-300 mt-1.5 leading-relaxed">
                      New domain name (required) — on save this creates catalog_&lt;name&gt; with raw/bronze/silver/gold
                      schemas and file_upload, ad_hoc_upload, archive volumes under raw.
                    </p>
                  </div>
                )}
              </div>
              <Field label="Target category" required value={cfg.target_category}
                onChange={set('target_category')} options={TARGET_CATEGORIES} />
            </div>
          </Section>

          {/* Source */}
          <Section title="Source" subtitle="Auto-filled from uploaded file. Edit source path if needed."
            collapsible defaultOpen>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Source type"     value={cfg.source_type}     onChange={() => {}} readOnly />
              <Field label="Source filename" value={cfg.source_filename} onChange={() => {}} readOnly
                hint="Date suffix removed for generic config" />
              <Field label="Delimiter"
                value={cfg.source_delimiter}
                onChange={set('source_delimiter')}
                readOnly={cfg.source_type === 'excel'}
                placeholder={cfg.source_type === 'excel' ? 'N/A' : 'e.g. , or |'}
                hint={cfg.source_type === 'excel' ? 'Not applicable for Excel' : 'CSV default: ,'} />
              <div className="col-span-3">
                <Field label="Source path" required value={cfg.source_path} onChange={set('source_path')}
                  hint="Auto-filled — edit if your volume path is different" />
              </div>
            </div>
          </Section>

          {/* Bronze */}
          <Section title="Bronze layer" subtitle="Fixed rules applied: overwrite mode, full load."
            collapsible defaultOpen>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Catalog"      value={cfg.bronze_catalog_name}                           onChange={() => {}} readOnly />
              <Field label="Schema"       value="bronze"                                            onChange={() => {}} readOnly />
              <Field label="Table name"   value={cfg.bronze_table_name}                             onChange={set('bronze_table_name')} />
              <Field label="Table path"   value={`${cfg.bronze_catalog_name}.bronze.${cfg.bronze_table_name}`} onChange={() => {}} readOnly />
              <Field label="Archive path" value={cfg.bronze_archive_path}                           onChange={() => {}} readOnly />
              <Field label="Write mode"   value="overwrite"                                         onChange={() => {}} readOnly />
              <Field label="Load type"    value="full"                                              onChange={() => {}} readOnly />
            </div>
          </Section>

          {/* Silver */}
          <Section title="Silver layer" subtitle="Paths auto-built. Write mode fixed to merge. Choose load type."
            collapsible defaultOpen>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Catalog"       value={cfg.silver_catalog_name} onChange={() => {}} readOnly />
              <Field label="Schema"        value="silver"                  onChange={() => {}} readOnly />
              <Field label="Table name"    value={cfg.silver_table_name}   onChange={set('silver_table_name')} />
              <Field label="Curated path"  value={cfg.silver_curated_path} onChange={() => {}} readOnly />
              <Field label="History path"  value={cfg.silver_history_path} onChange={() => {}} readOnly />
              <Field label="Invalid path"  value={cfg.silver_invalid_path} onChange={() => {}} readOnly />
              <Field label="Write mode"    value="merge"                   onChange={() => {}} readOnly />
              <Field label="Load type"     value={cfg.silver_load_type}    onChange={set('silver_load_type')}    options={SILVER_LOAD_TYPES} />
            </div>
          </Section>

          {/* Columns */}
          <Section
            title={`Column metadata — ${columns.length} columns · ${pkCount} primary key${pkCount !== 1 ? 's' : ''}`}
            subtitle="Original names shown alongside normalized DB-safe names. Edit normalized names if needed."
            action={
              <button onClick={handleEnrich} disabled={aiLoading}
                className="flex items-center gap-2 px-3 py-1.5 bg-brand-500/[0.12] border border-brand-500/25
                           text-brand-500 text-xs font-medium rounded-xl
                           hover:bg-brand-500/[0.18] hover:scale-[1.02]
                           disabled:opacity-40 transition-all duration-200 active:scale-95">
                <Sparkles size={12} />
                {aiLoading ? 'Thinking...' : 'AI fill descriptions'}
              </button>
            }>
            <MetadataGrid columns={columns} onChange={cols => { setColumns(cols); setValidationErrors([]) }} />
          </Section>

          {/* Validation errors */}
          <AnimatePresence>
            {hasErrors && <ValidationErrors errors={validationErrors} />}
          </AnimatePresence>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={handleReset}
              className="flex items-center gap-2 text-sm text-dark-200 hover:text-dark-50 transition-colors duration-200">
              <RotateCcw size={14} /> Start over
            </button>
            <button
              onClick={handleSave}
              disabled={loading || !canSave}
              className={`flex items-center gap-2 px-5 py-2.5 text-sm rounded-xl font-semibold
                          transition-all duration-200 disabled:opacity-40 active:scale-95
                ${hasErrors
                  ? 'bg-red-500/[0.1] border border-red-500/25 text-red-600 dark:text-red-400 cursor-not-allowed'
                  : 'bg-brand-500 hover:bg-brand-600 text-white shadow-apple-blue hover:shadow-apple-blue-lg hover:scale-[1.02]'
                }`}>
              <Save size={14} />
              {loading ? 'Saving to Databricks…' : hasErrors ? 'Fix errors to save' : 'Save config row'}
            </button>
          </div>
        </div>
      )}

      {step === 'saved' && saved && (
        <ConfigSummary config={saved} file={uploadedFile ?? uploadedFileRef.current} onReset={handleReset} />
      )}

      </>}

      </div>

      {/* ── Data Dictionary subsection — always mounted so uploaded file state is preserved ── */}
      <div className={activeTab !== 'dictionary' ? 'hidden' : ''}>
        <DictionarySection />
      </div>
    </div>
  )
}