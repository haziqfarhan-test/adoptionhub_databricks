import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

const IDLE_TIMEOUT_MS = 10 * 60 * 1000
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart']

/**
 * Returns the user to the Home landing screen and clears the in-progress
 * Metadata & Dictionary form:
 *  - once per full page load ("new session")
 *  - after 10 minutes of inactivity
 */
export function useIdleReset() {
  const navigate = useNavigate()
  const timerRef = useRef(null)

  useEffect(() => {
    function resetToHome() {
      window.dispatchEvent(new CustomEvent('metadata-full-reset'))
      navigate('/', { replace: true })
    }

    function scheduleIdleTimeout() {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(resetToHome, IDLE_TIMEOUT_MS)
    }

    // New session — every full page load
    resetToHome()

    scheduleIdleTimeout()
    ACTIVITY_EVENTS.forEach(evt => window.addEventListener(evt, scheduleIdleTimeout, { passive: true }))

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      ACTIVITY_EVENTS.forEach(evt => window.removeEventListener(evt, scheduleIdleTimeout))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
}
