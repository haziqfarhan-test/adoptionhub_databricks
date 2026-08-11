import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Bookmark, X, Loader2 } from 'lucide-react'

const EASE = [0.25, 1, 0.5, 1]

export function SaveModal({ open, defaultTitle = '', onClose, onConfirm }) {
  const [title,   setTitle]   = useState(defaultTitle)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [error,   setError]   = useState(null)

  // Reset state when modal opens with a new title
  if (open && title === '' && defaultTitle) setTitle(defaultTitle)

  async function handleSave() {
    if (!title.trim()) return
    setSaving(true)
    setError(null)
    try {
      await onConfirm(title.trim())
      setSaved(true)
      setTimeout(() => { setSaved(false); onClose() }, 1200)
    } catch (e) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    setError(null)
    setSaved(false)
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 bg-black/50"
            onClick={handleClose}
          />
          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -8 }}
            animate={{ opacity: 1, scale: 1,    y: 0  }}
            exit={{ opacity: 0,   scale: 0.96, y: -8  }}
            transition={{ ease: EASE, duration: 0.18 }}
            className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none">
            <div
              className="pointer-events-auto w-full max-w-md mx-4 rounded-2xl border border-ui/[0.12]
                         bg-dark-900 shadow-apple p-6 space-y-4"
              role="dialog"
              aria-modal="true"
              aria-label="Save dashboard">

              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-[9px] bg-brand-500/[0.12] flex items-center justify-center">
                    <Bookmark size={13} className="text-brand-500" />
                  </div>
                  <h2 className="text-sm font-semibold text-dark-50">Save Dashboard</h2>
                </div>
                <button
                  type="button"
                  onClick={handleClose}
                  className="p-1 rounded-lg text-dark-400 hover:text-dark-100 hover:bg-dark-800/60 transition-colors">
                  <X size={14} />
                </button>
              </div>

              {/* Name input */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-dark-400 uppercase tracking-wide">
                  Dashboard Name
                </label>
                <input
                  autoFocus
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSave()}
                  placeholder="e.g. Employee Count by Leadership Stage"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-ui/[0.10] bg-dark-800/60
                             text-sm text-dark-50 placeholder:text-dark-500 focus:outline-none
                             focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/20 transition-colors"
                />
              </div>

              {/* Info note */}
              <p className="text-[11px] text-dark-500 leading-relaxed">
                A Gold view will be created in{' '}
                <span className="font-mono text-dark-400">catalog_cross_ncss.gold</span>{' '}
                and the dashboard will appear on the Marketplace homepage.
              </p>

              {error && (
                <p className="text-[11px] text-red-400">{error}</p>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2 justify-end pt-1">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-3.5 py-2 rounded-xl text-xs font-medium text-dark-400
                             hover:text-dark-100 hover:bg-dark-800/60 transition-colors">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !title.trim()}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold
                    transition-all duration-150
                    ${saved
                      ? 'bg-green-500/[0.15] text-green-400 border border-green-500/25'
                      : 'bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-40'
                    }`}>
                  {saving
                    ? <><Loader2 size={11} className="animate-spin" /> Saving…</>
                    : saved
                    ? 'Saved!'
                    : <><Bookmark size={11} /> Save</>
                  }
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
