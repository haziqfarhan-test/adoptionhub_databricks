import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles } from 'lucide-react'

import { useGenieState }  from '../../hooks/useGenieState'
import { useGenieQuery }  from '../../hooks/useGenieQuery'

import { SchemaHint }           from './SchemaHint'
import { PromptBar }            from './PromptBar'
import { FilterBar }            from './FilterBar'
import { LoadingState }         from './LoadingState'
import { ErrorState }           from './ErrorState'
import { EmptyState }           from './EmptyState'
import { NotDataQuestion }      from './NotDataQuestion'
import { DashboardView }        from './DashboardView'
import { SavedDashboardsGrid }  from './SavedDashboardsGrid'

const EASE = [0.25, 1, 0.5, 1]

export function GenieShell() {
  const {
    question, setQuestion,
    loading, setLoading,
    result,  setResult,
    error,   setError,
    schema,  setSchema,
  } = useGenieState()

  const { askQuestion, refreshSchema, saveDashboard, fetchSaved, loadSaved, deleteDashboard } = useGenieQuery({
    setLoading, setResult, setError, setSchema,
  })

  const [savedRefresh,    setSavedRefresh]    = useState(0)
  // selectedTables: fq_name strings the AI is allowed to use (all = no restriction)
  const [selectedTables,  setSelectedTables]  = useState([])

  useEffect(() => { refreshSchema() }, [])

  // When schema loads for the first time, default-select all tables
  useEffect(() => {
    if (schema?.length && selectedTables.length === 0) {
      setSelectedTables(schema.map(t => t.table))
    }
  }, [schema])

  const isNotSuitable = result && result.suitable === false
  const filters       = result?.filters_extracted || []

  function handleAsk() {
    // Pass current selection; if all tables are selected send empty list (use default matching)
    const pinned = selectedTables.length === (schema?.length ?? 0) ? [] : selectedTables
    askQuestion(question, pinned)
  }

  async function onSaveDashboard(title) {
    await saveDashboard({
      title,
      description: result?.dashboard_description || '',
      question,
      sql_used: result?.sql_used || '',
      narrative_json: {
        title:       result?.dashboard_title       || title,
        description: result?.dashboard_description || '',
        summary:     result?.speech_bubble_summary || '',
        insights:    result?.key_insights          || [],
      },
    })
    setSavedRefresh(n => n + 1)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: EASE }}
      className="max-w-4xl mx-auto space-y-6">

      {/* Page title */}
      <div>
        <div className="flex items-center gap-2.5 mb-1">
          <div className="w-8 h-8 rounded-[11px] bg-brand-500/[0.12] flex items-center justify-center">
            <Sparkles size={14} className="text-brand-500" />
          </div>
          <h1 className="text-xl font-bold text-dark-50 tracking-tight">Marketplace</h1>
        </div>
        <p className="text-sm text-dark-300 ml-[42px]">
          Ask a question about your data and get an instant dashboard
        </p>
      </div>

      {/* Available tables selector */}
      <SchemaHint
        tables={schema}
        selectedTables={selectedTables}
        onSelectionChange={setSelectedTables}
      />

      {/* Prompt input */}
      <PromptBar
        question={question}
        onChange={setQuestion}
        onAsk={handleAsk}
        loading={loading}
      />

      {/* AI-extracted active filters */}
      <FilterBar filters={filters} />

      {/* Content area */}
      <AnimatePresence>
        {loading && <LoadingState key="loading" />}
      </AnimatePresence>

      <AnimatePresence>
        {error && !loading && <ErrorState key="error" message={error} />}
      </AnimatePresence>

      <AnimatePresence>
        {result && !loading && (
          isNotSuitable
            ? <NotDataQuestion key="not-suitable" message={result.message} />
            : <DashboardView   key="dashboard"    result={result} onSave={onSaveDashboard} />
        )}
      </AnimatePresence>

      {/* Empty state: show saved dashboards + suggestion chips */}
      {!result && !loading && !error && (
        <div className="space-y-6">
          <SavedDashboardsGrid
            fetchSaved={fetchSaved}
            onLoad={loadSaved}
            onDelete={deleteDashboard}
            refreshTrigger={savedRefresh}
          />
          <EmptyState />
        </div>
      )}
    </motion.div>
  )
}
