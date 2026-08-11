import { useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, FileText, Clipboard, CheckCircle } from 'lucide-react'

const ACCEPTED_EXTS = new Set(['csv', 'xls', 'xlsx'])

function PasteZone({ onFile, loading }) {
  const [focused, setFocused]   = useState(false)
  const [pastedName, setPastedName] = useState(null)
  const [error, setError]       = useState(null)

  function handlePaste(e) {
    const file = e.clipboardData?.files?.[0]
    if (!file) return
    const ext = file.name.split('.').pop().toLowerCase()
    if (!ACCEPTED_EXTS.has(ext)) {
      setError(`Unsupported file type ".${ext}" — use CSV, XLS or XLSX`)
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
        relative rounded-3xl p-8 text-center cursor-text outline-none
        border-2 transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]
        ${focused
          ? 'border-amber-500/60 bg-amber-500/[0.05] shadow-[0_0_0_3px_rgb(245_158_11/0.12)]'
          : 'border-dashed border-ui/[0.15] bg-dark-900 hover:border-amber-500/30 hover:bg-amber-500/[0.02]'
        }
      `}>

      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div key="loading"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
            <p className="text-sm text-dark-200">Parsing file…</p>
          </motion.div>

        ) : pastedName ? (
          <motion.div key="done"
            initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-3">
            <CheckCircle size={28} className="text-green-500 dark:text-green-400" />
            <p className="text-sm font-semibold text-green-600 dark:text-green-400">{pastedName}</p>
            <p className="text-xs text-dark-300">File received — processing…</p>
          </motion.div>

        ) : focused ? (
          <motion.div key="focused"
            initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/[0.15] flex items-center justify-center">
              <Clipboard size={22} className="text-amber-500" />
            </div>
            <p className="text-sm font-semibold text-amber-500">Ready — press Ctrl+V to paste</p>
            {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}
          </motion.div>

        ) : (
          <motion.div key="idle"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-dark-800 border border-ui/[0.07] flex items-center justify-center shadow-apple">
              <Clipboard size={22} className="text-dark-300" />
            </div>
            <div>
              <p className="text-sm font-semibold text-dark-50 tracking-tight">
                Blocked by company policy?
              </p>
              <p className="text-xs text-dark-200 mt-1 leading-relaxed">
                Copy your file in Windows Explorer{' '}
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

export default function FileDropzone({ onFile, loading }) {
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    },
    maxFiles: 1,
    onDrop: files => files[0] && onFile(files[0]),
  })

  return (
    <div className="space-y-3">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ease: [0.25, 1, 0.5, 1] }}
        {...getRootProps()}
        className={`
          relative border-2 border-dashed rounded-3xl p-16 text-center cursor-pointer
          transition-all duration-300 ease-[cubic-bezier(0.25,1,0.5,1)]
          ${isDragActive
            ? 'border-brand-500 bg-brand-500/[0.07] shadow-apple-blue scale-[1.01]'
            : 'border-ui/[0.15] hover:border-brand-500/50 hover:bg-ui/[0.03] bg-dark-900'
          }
        `}>
        <input {...getInputProps()} />

        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div key="loading"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col items-center gap-4">
              <div className="w-10 h-10 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
              <p className="text-sm text-dark-200">Parsing file…</p>
            </motion.div>

          ) : isDragActive ? (
            <motion.div key="drag"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-2xl bg-brand-500/[0.12] flex items-center justify-center">
                <Upload size={28} className="text-brand-500" />
              </div>
              <p className="text-brand-500 font-semibold text-base">Drop it here</p>
            </motion.div>

          ) : (
            <motion.div key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center gap-5">
              <div className="w-16 h-16 rounded-2xl bg-dark-800 border border-ui/[0.07] flex items-center justify-center shadow-apple">
                <FileText size={28} className="text-dark-300" />
              </div>
              <div>
                <p className="text-[15px] font-semibold text-dark-50 tracking-tight">
                  Drop your source file here
                </p>
                <p className="text-sm text-dark-200 mt-1">
                  Supports .csv, .xls, .xlsx — or click to browse
                </p>
              </div>
              <div className="flex gap-2">
                {['CSV', 'XLS', 'XLSX'].map(t => (
                  <span key={t} className="text-[10px] px-2.5 py-1 rounded-lg font-semibold tracking-wide bg-dark-800 border border-ui/[0.07] text-dark-300">
                    {t}
                  </span>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <PasteZone onFile={onFile} loading={loading} />
    </div>
  )
}
