import { useState, useEffect } from 'react'

/**
 * useState that automatically syncs to localStorage.
 * Supports the same functional-update API as useState.
 */
export function useLocalStorage(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const raw = window.localStorage.getItem(key)
      return raw !== null ? JSON.parse(raw) : defaultValue
    } catch {
      return defaultValue
    }
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch { /* storage quota exceeded */ }
  }, [key, value])

  return [value, setValue]
}
