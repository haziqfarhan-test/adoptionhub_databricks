const BASE_URL = import.meta.env.VITE_API_URL || ''

async function apiFetch(path, opts = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `HTTP ${res.status}`)
  }
  return res.json()
}

export function useGenieQuery({ setLoading, setResult, setError, setSchema }) {
  async function askQuestion(question, pinnedTables = []) {
    const trimmed = question.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const data = await apiFetch('/api/genie/ask', {
        method: 'POST',
        body: JSON.stringify({ question: trimmed, pinned_tables: pinnedTables }),
      })
      setResult(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function refreshSchema() {
    try {
      const data = await apiFetch('/api/genie/schema')
      setSchema(data)
    } catch {
      // schema hint is non-critical — fail silently
    }
  }

  async function saveDashboard({ title, description, question, sql_used, narrative_json = {} }) {
    return apiFetch('/api/genie/save', {
      method: 'POST',
      body: JSON.stringify({ title, description, question, sql_used, narrative_json }),
    })
  }

  async function fetchSaved() {
    return apiFetch('/api/genie/saved')
  }

  async function deleteDashboard(id) {
    return apiFetch(`/api/genie/saved/${id}`, { method: 'DELETE' })
  }

  async function loadSaved(id) {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const data = await apiFetch('/api/genie/run-saved', {
        method: 'POST',
        body: JSON.stringify({ id }),
      })
      setResult(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return { askQuestion, refreshSchema, saveDashboard, fetchSaved, loadSaved, deleteDashboard }
}
