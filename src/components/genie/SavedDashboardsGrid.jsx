import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Bookmark, ExternalLink, Loader2, Trash2 } from 'lucide-react'

const EASE = [0.25, 1, 0.5, 1]

function fmtDate(iso) {
  if (!iso) return ''
  try {
    return new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).toLocaleDateString(undefined, {
      day: 'numeric', month: 'short', year: 'numeric',
    })
  } catch { return iso.slice(0, 10) }
}

export function SavedDashboardsGrid({ fetchSaved, onLoad, onDelete, refreshTrigger }) {
  const [items,      setItems]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [loadingId,  setLoadingId]  = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  useEffect(() => {
    setLoading(true)
    fetchSaved()
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false))
  }, [refreshTrigger])

  async function handleLoad(id) {
    setLoadingId(id)
    await onLoad(id)
    setLoadingId(null)
  }

  async function handleDelete(id, e) {
    e.stopPropagation()
    setDeletingId(id)
    try {
      await onDelete(id)
      setItems(prev => prev.filter(item => item.id !== id))
    } catch {
      // fail silently — item stays in list
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) return (
    <div className="flex items-center gap-2 text-dark-500 text-xs py-2">
      <Loader2 size={12} className="animate-spin" />
      Loading saved dashboards…
    </div>
  )

  if (!items.length) return null

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Bookmark size={12} className="text-dark-400" />
        <span className="text-xs font-semibold text-dark-400 uppercase tracking-[0.08em]">
          Saved Dashboards
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((item, i) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, ease: EASE }}
            className="group rounded-xl border border-ui/[0.08] bg-dark-800/40
                       hover:border-brand-500/30 hover:bg-dark-800/70 transition-all duration-200 p-4">

            {/* Badge row: view name (truncated) + delete button */}
            <div className="flex items-center gap-1.5 mb-2.5 min-w-0">
              <span className="inline-flex items-center gap-1 min-w-0 flex-1 px-1.5 py-0.5 rounded
                               bg-brand-500/[0.10] text-brand-400 font-mono text-[9px] overflow-hidden">
                <ExternalLink size={8} className="shrink-0" />
                <span className="truncate">{item.view_name}</span>
              </span>
              {onDelete && (
                <button
                  type="button"
                  onClick={e => handleDelete(item.id, e)}
                  disabled={deletingId === item.id}
                  title="Delete dashboard"
                  className="shrink-0 p-1.5 rounded-lg text-dark-600
                             hover:text-red-400 hover:bg-red-400/[0.10] transition-colors
                             opacity-0 group-hover:opacity-100 disabled:opacity-50">
                  {deletingId === item.id
                    ? <Loader2 size={12} className="animate-spin" />
                    : <Trash2 size={12} />
                  }
                </button>
              )}
            </div>

            <p className="text-sm font-semibold text-dark-100 leading-snug mb-1 group-hover:text-dark-50 transition-colors line-clamp-2">
              {item.title}
            </p>

            <p className="text-[10px] text-dark-500 mb-3">
              {fmtDate(item.created_at)}
            </p>

            <button
              type="button"
              onClick={() => handleLoad(item.id)}
              disabled={loadingId === item.id}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium
                         bg-brand-500/[0.10] text-brand-400 border border-brand-500/20
                         hover:bg-brand-500/[0.18] hover:text-brand-300 transition-all duration-150
                         disabled:opacity-50">
              {loadingId === item.id
                ? <><Loader2 size={10} className="animate-spin" /> Loading…</>
                : 'Load Dashboard'
              }
            </button>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
