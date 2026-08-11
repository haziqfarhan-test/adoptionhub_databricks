import { useState } from 'react'

export function useGenieState() {
  const [question,      setQuestion]      = useState('')
  const [loading,       setLoading]       = useState(false)
  const [loadingPhase,  setLoadingPhase]  = useState(0)
  const [result,        setResult]        = useState(null)
  const [error,         setError]         = useState(null)
  const [schema,        setSchema]        = useState([])
  const [widgetHeights, setWidgetHeights] = useState({})
  const [sqlOpen,       setSqlOpen]       = useState(false)
  const [schemaOpen,    setSchemaOpen]    = useState(false)

  function getHeight(key)    { return widgetHeights[key] ?? 320 }
  function setHeight(key, h) { setWidgetHeights(prev => ({ ...prev, [key]: h })) }

  return {
    question, setQuestion,
    loading, setLoading,
    loadingPhase, setLoadingPhase,
    result, setResult,
    error, setError,
    schema, setSchema,
    sqlOpen, setSqlOpen,
    schemaOpen, setSchemaOpen,
    getHeight, setHeight,
  }
}
