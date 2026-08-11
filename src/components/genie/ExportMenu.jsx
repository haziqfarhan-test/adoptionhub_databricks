import { useState, useRef, useEffect, useId } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, ChevronDown, Printer } from 'lucide-react'
import { rowsToCsv, downloadBlob, generateTwb } from '../../utils/twbExport'

const EASE = [0.25, 1, 0.5, 1]

export function ExportMenu({ widgets, title }) {
  const [open, setOpen] = useState(false)
  const ref    = useRef(null)
  const menuId = useId()

  useEffect(() => {
    function handle(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    function handleKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open])

  function getExportRows() {
    let best = null
    const chartTypes = new Set(['TABLE', 'BAR_CHART', 'LINE_CHART', 'STACKED_BAR_CHART'])
    for (const w of widgets) {
      if (chartTypes.has(w.type) && w.data?.length) {
        if (!best || w.data.length > best.length) best = w.data
      }
    }
    return best || []
  }

  function handleTableau() {
    const rows = getExportRows()
    const twb  = generateTwb(rows, title || 'Marketplace Dashboard')
    downloadBlob(twb, 'tableau_dashboard.twb', 'application/xml;charset=utf-8;')
    setOpen(false)
  }

  function handlePowerBi() {
    const bom = '﻿'
    downloadBlob(bom + rowsToCsv(getExportRows()), 'powerbi_data.csv', 'text/csv;charset=utf-8;')
    setOpen(false)
  }

  function handlePrint() {
    // Close dropdown first so it doesn't appear in the PDF.
    setOpen(false)
    setTimeout(() => {
      // Pin each ResponsiveContainer to its current pixel size BEFORE print styles
      // change the layout — otherwise the SVG remeasures against the shifted parent
      // and overflows its card box.
      const containers = Array.from(
        document.querySelectorAll('#genie-dashboard .recharts-responsive-container')
      )
      const saved = containers.map(el => ({
        el, width: el.style.width, height: el.style.height,
      }))
      containers.forEach(el => {
        const r = el.getBoundingClientRect()
        el.style.width  = `${Math.round(r.width)  || 680}px`
        el.style.height = `${Math.round(r.height) || 320}px`
      })

      const style = document.createElement('style')
      style.id = '__genie_print__'
      style.textContent = `
        @media print {
          html, body {
            height: auto !important;
            overflow: visible !important;
            background: white !important;
          }
          body * { visibility: hidden !important; }
          #genie-dashboard, #genie-dashboard * { visibility: visible !important; }
          #genie-dashboard {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: auto !important;
            overflow: visible !important;
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            background: white !important;
            color: black !important;
            padding: 24px !important;
            page-break-inside: auto !important;
          }
          /* Hide ALL interactive controls */
          #genie-dashboard button,
          #genie-dashboard [role="menu"],
          #genie-dashboard [aria-haspopup] { display: none !important; }
          /* Force lineage panel open even if collapsed */
          #lineage-content {
            max-height: none !important;
            opacity: 1 !important;
            overflow: visible !important;
            margin-top: 16px !important;
          }
          /* Chart cards */
          #genie-dashboard [data-chart-card] {
            page-break-inside: avoid !important;
            border: 1px solid #e2e8f0 !important;
            background: white !important;
            border-radius: 12px !important;
            padding: 16px !important;
          }
          /* KPI cards */
          #genie-dashboard [data-kpi-card] {
            border: 1px solid #e2e8f0 !important;
            background: white !important;
            border-radius: 12px !important;
          }
        }
      `
      document.head.appendChild(style)
      window.print()
      // Restore everything after the dialog closes
      setTimeout(() => {
        document.getElementById('__genie_print__')?.remove()
        saved.forEach(({ el, width, height }) => {
          el.style.width  = width
          el.style.height = height
        })
      }, 1000)
    }, 80)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium
                   bg-dark-800/60 border border-ui/[0.09] text-dark-300 hover:text-dark-50
                   hover:bg-dark-800 transition-all duration-150">
        <Download size={11} aria-hidden="true" />
        Export
        <ChevronDown size={10} aria-hidden="true" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={menuId}
            role="menu"
            aria-label="Export options"
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ ease: EASE, duration: 0.15 }}
            className="absolute right-0 top-full mt-1.5 z-50 w-56 rounded-xl border border-ui/[0.10]
                       bg-dark-900 shadow-apple overflow-hidden">
            <button
              type="button"
              role="menuitem"
              onClick={handleTableau}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-dark-200
                         hover:bg-dark-800/60 hover:text-dark-50 transition-colors text-left">
              <Download size={11} className="text-blue-400" aria-hidden="true" />
              <span>
                Tableau Workbook
                <span className="ml-1.5 text-dark-500 font-mono text-[10px]">.twb</span>
              </span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={handlePowerBi}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-dark-200
                         hover:bg-dark-800/60 hover:text-dark-50 transition-colors text-left">
              <Download size={11} className="text-yellow-400" aria-hidden="true" />
              <span>
                Power BI Data
                <span className="ml-1.5 text-dark-500 font-mono text-[10px]">.csv</span>
              </span>
            </button>
            <div className="h-px bg-ui/[0.08] mx-3" role="separator" />
            <button
              type="button"
              role="menuitem"
              onClick={handlePrint}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-dark-200
                         hover:bg-dark-800/60 hover:text-dark-50 transition-colors text-left">
              <Printer size={11} className="text-dark-400" aria-hidden="true" />
              Save as PDF
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
