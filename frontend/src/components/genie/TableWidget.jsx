import { useState } from 'react'
import { Database, ChevronUp, ChevronDown, ChevronsUpDown, Search } from 'lucide-react'
import { fmtCell } from '../../utils/chartFormatters'
import { SizeSelector } from './SizeSelector'

export function TableWidget({ widget, height = 360, onHeightChange }) {
  const [showAll, setShowAll] = useState(false)
  const [search,  setSearch]  = useState('')
  const [sortCol, setSortCol] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  const cols = widget.data?.length ? Object.keys(widget.data[0]) : []
  const raw  = widget.data || []

  const filtered = search.trim()
    ? raw.filter(row =>
        cols.some(c => String(row[c] ?? '').toLowerCase().includes(search.toLowerCase()))
      )
    : raw

  const sorted = sortCol
    ? [...filtered].sort((a, b) => {
        const av = a[sortCol], bv = b[sortCol]
        if (av === null || av === undefined) return 1
        if (bv === null || bv === undefined) return -1
        const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv))
        return sortDir === 'asc' ? cmp : -cmp
      })
    : filtered

  const rows = showAll ? sorted : sorted.slice(0, 100)

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  function SortIcon({ col }) {
    if (sortCol !== col) return <ChevronsUpDown size={10} className="text-dark-600 ml-1 shrink-0" aria-hidden="true" />
    return sortDir === 'asc'
      ? <ChevronUp   size={10} className="text-brand-400 ml-1 shrink-0" aria-hidden="true" />
      : <ChevronDown size={10} className="text-brand-400 ml-1 shrink-0" aria-hidden="true" />
  }

  return (
    <div className="rounded-2xl border border-ui/[0.07] bg-dark-800/40 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-ui/[0.06]">
        <div className="flex items-center gap-2">
          <Database size={13} className="text-dark-400 shrink-0" aria-hidden="true" />
          <p className="text-sm font-semibold text-dark-50">{widget.title}</p>
        </div>
        <div className="flex items-center gap-3">
          {onHeightChange && <SizeSelector current={height} onChange={onHeightChange} />}
          <span className="text-[11px] text-dark-400 font-mono" aria-live="polite" aria-atomic="true">
            {filtered.length !== raw.length
              ? `${filtered.length} / ${raw.length} rows`
              : `${raw.length} rows`}
            {' · '}{cols.length} cols
          </span>
        </div>
      </div>

      {/* Search bar — visible when table has >10 rows */}
      {raw.length > 10 && (
        <div className="px-5 py-2.5 border-b border-ui/[0.04] flex items-center gap-2">
          <Search size={11} className="text-dark-500 shrink-0" aria-hidden="true" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setShowAll(false) }}
            placeholder="Filter rows…"
            aria-label="Filter table rows"
            className="flex-1 bg-transparent text-xs text-dark-200 placeholder:text-dark-600 outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear filter"
              className="text-[10px] text-dark-500 hover:text-dark-300 transition-colors">
              ✕
            </button>
          )}
        </div>
      )}

      {cols.length === 0 ? (
        <p className="px-5 py-8 text-sm text-dark-400 text-center">No data</p>
      ) : (
        <>
          <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: height }} role="region" aria-label={widget.title}>
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-dark-800/80 backdrop-blur-sm">
                  {cols.map(c => (
                    <th
                      key={c}
                      scope="col"
                      onClick={() => handleSort(c)}
                      aria-sort={sortCol === c ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className="px-4 py-2.5 text-left text-dark-400 font-semibold whitespace-nowrap border-b border-ui/[0.06] tracking-[0.04em] cursor-pointer hover:text-dark-200 transition-colors select-none">
                      <span className="flex items-center">
                        {c.replace(/_/g, ' ')}
                        <SortIcon col={c} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, ri) => (
                  <tr key={ri} className="border-b border-ui/[0.04] hover:bg-dark-800/30 transition-colors">
                    {cols.map(c => {
                      const v   = row[c]
                      const num = typeof v === 'number'
                      return (
                        <td key={c} className={`px-4 py-2.5 whitespace-nowrap font-mono ${num ? 'text-dark-100 text-right' : 'text-dark-200'}`}>
                          {fmtCell(v)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={cols.length} className="px-4 py-6 text-center text-xs text-dark-500 italic">
                      No rows match "{search}"
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {sorted.length > 100 && (
            <button
              type="button"
              onClick={() => setShowAll(v => !v)}
              aria-expanded={showAll}
              className="w-full py-2.5 text-xs text-dark-400 hover:text-dark-100 hover:bg-dark-800/40 transition-colors border-t border-ui/[0.06] flex items-center justify-center gap-1.5">
              {showAll
                ? <><ChevronUp size={12} aria-hidden="true" /> Show less</>
                : <><ChevronDown size={12} aria-hidden="true" /> Show all {sorted.length} rows</>}
            </button>
          )}
        </>
      )}
    </div>
  )
}
