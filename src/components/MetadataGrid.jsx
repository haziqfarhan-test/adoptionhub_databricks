import { motion } from 'framer-motion'
import { AlertCircle, Key } from 'lucide-react'

const DATA_TYPES      = ['string', 'integer', 'float', 'double', 'boolean', 'date', 'timestamp']
const PII_OPTIONS     = ['none', 'pii', 'sensitive']
const CLASSIFICATIONS = ['public', 'internal', 'confidential', 'restricted']

const DB_RESERVED = new Set([
  'select','from','where','table','column','index','view','create','drop',
  'insert','update','delete','merge','into','values','set','and','or','not',
  'null','true','false','case','when','then','else','end','join','left',
  'right','inner','outer','on','group','by','order','having','limit',
  'offset','union','all','distinct','as','with','partition','database',
  'schema','catalog','use','show','describe','explain','cast','over',
])

function validateColName(name) {
  if (!name)                                    return 'Cannot be empty'
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return 'Only letters, numbers, underscores — must not start with a number'
  if (name.length > 255)                        return 'Exceeds 255 characters'
  if (DB_RESERVED.has(name.toLowerCase()))      return 'Reserved Databricks keyword'
  return null
}

// Shared select style
const selectCls = `
  bg-dark-800 border border-ui/[0.08] rounded-lg px-2 py-1 text-dark-50 text-xs
  focus:outline-none focus:ring-1 focus:ring-brand-500/60 focus:border-brand-500
  transition-all duration-200 cursor-pointer
`

export default function MetadataGrid({ columns, onChange }) {
  function update(i, field, value) {
    onChange(columns.map((col, idx) => idx === i ? { ...col, [field]: value } : col))
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-ui/[0.07] shadow-apple dark:shadow-none">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-ui/[0.07] bg-dark-800/60">
            {['Original column name', 'Normalized name (editable)', 'Type', 'Description',
              'PII', 'Class.', 'Nullable', 'PK'].map(h => (
              <th key={h} className="
                px-3 py-3 text-left text-[10px] text-dark-300 font-semibold
                uppercase tracking-[0.08em] whitespace-nowrap
              ">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {columns.map((col, i) => {
            const err = validateColName(col.safe_name)
            return (
              <motion.tr
                key={i}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.015, ease: [0.25, 1, 0.5, 1] }}
                className={`
                  border-b border-ui/[0.05] transition-colors duration-150
                  ${col.is_primary_key
                    ? 'bg-brand-500/[0.06]'
                    : 'hover:bg-ui/[0.03]'
                  }
                `}>

                {/* Original name */}
                <td className="px-3 py-2.5">
                  <span className="font-mono text-dark-200 bg-dark-800 px-1.5 py-0.5 rounded-md text-[11px]">
                    {col.name}
                  </span>
                </td>

                {/* Normalized name — editable */}
                <td className="px-3 py-2.5">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <input
                        className={`
                          w-44 rounded-lg px-2 py-1 text-xs font-mono
                          focus:outline-none focus:ring-1 transition-all duration-200
                          ${err
                            ? 'bg-red-500/[0.08] border border-red-500/40 text-red-600 dark:text-red-400 focus:ring-red-500/50'
                            : 'bg-dark-800 border border-ui/[0.08] text-green-600 dark:text-green-400 focus:ring-brand-500/60'
                          }
                        `}
                        value={col.safe_name}
                        onChange={e => update(i, 'safe_name', e.target.value)}
                      />
                      {err && <AlertCircle size={12} className="text-red-500 dark:text-red-400 shrink-0" />}
                    </div>
                    {err && (
                      <p className="text-[10px] text-red-600 dark:text-red-400 pl-0.5">{err}</p>
                    )}
                    {col.name !== col.safe_name && !err && (
                      <p className="text-[10px] text-dark-300 pl-0.5">✓ normalized</p>
                    )}
                  </div>
                </td>

                {/* Type */}
                <td className="px-3 py-2.5">
                  <select
                    className={selectCls}
                    value={col.data_type || col.detected_type}
                    onChange={e => update(i, 'data_type', e.target.value)}>
                    {DATA_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </td>

                {/* Description */}
                <td className="px-3 py-2.5">
                  <input
                    className="
                      w-44 bg-dark-800 border border-ui/[0.08] rounded-lg px-2 py-1
                      text-dark-50 focus:outline-none focus:ring-1 focus:ring-brand-500/60
                      focus:border-brand-500 placeholder:text-dark-400 transition-all duration-200
                    "
                    value={col.description || ''}
                    placeholder="Business description…"
                    onChange={e => update(i, 'description', e.target.value)}
                  />
                </td>

                {/* PII */}
                <td className="px-3 py-2.5">
                  <select
                    className={selectCls}
                    value={col.pii || 'none'}
                    onChange={e => update(i, 'pii', e.target.value)}>
                    {PII_OPTIONS.map(t => <option key={t}>{t}</option>)}
                  </select>
                </td>

                {/* Classification */}
                <td className="px-3 py-2.5">
                  <select
                    className={selectCls}
                    value={col.classification || 'internal'}
                    onChange={e => update(i, 'classification', e.target.value)}>
                    {CLASSIFICATIONS.map(t => <option key={t}>{t}</option>)}
                  </select>
                </td>

                {/* Nullable */}
                <td className="px-3 py-2.5 text-center">
                  <input
                    type="checkbox"
                    checked={col.nullable !== false}
                    onChange={e => update(i, 'nullable', e.target.checked)}
                    className="rounded accent-brand-500 w-3.5 h-3.5 cursor-pointer"
                  />
                </td>

                {/* Primary Key */}
                <td className="px-3 py-2.5 text-center">
                  <div className="flex items-center justify-center">
                    <input
                      type="checkbox"
                      checked={col.is_primary_key || false}
                      onChange={e => update(i, 'is_primary_key', e.target.checked)}
                      className="rounded accent-brand-500 w-3.5 h-3.5 cursor-pointer"
                    />
                    {col.is_primary_key && (
                      <Key size={10} className="text-brand-500 ml-1" />
                    )}
                  </div>
                </td>
              </motion.tr>
            )
          })}
        </tbody>
      </table>

      {/* Legend */}
      <div className="
        px-4 py-2.5 border-t border-ui/[0.06] bg-dark-800/40
        flex items-center gap-5 text-[10px] text-dark-300
      ">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
          Valid name
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
          Invalid — fix before saving
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-brand-500 inline-block" />
          Primary key column
        </span>
      </div>
    </div>
  )
}
