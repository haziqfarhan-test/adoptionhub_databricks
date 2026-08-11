import { useState, useEffect } from 'react'

const BASE_URL = import.meta.env.VITE_API_URL || ''

export function useCurrentUser() {
  const [user,    setUser]    = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${BASE_URL}/api/me`)
      .then(r => r.json())
      .then(data => setUser(data))
      .catch(() => setUser({ display_name: '', user_name: '', groups: [], role: 'unknown' }))
      .finally(() => setLoading(false))
  }, [])

  return {
    user,
    loading,
    role:        user?.role         ?? 'unknown',
    displayName: user?.display_name ?? '',
  }
}
