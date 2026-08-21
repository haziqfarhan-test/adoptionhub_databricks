import { useState } from 'react'
import { Routes, Route, NavLink, Link, Navigate, useLocation } from 'react-router-dom'
import { motion } from 'framer-motion'
import MetadataPage from './pages/MetadataPage'
import { Zap, Sun, Moon, Layers, ShieldOff } from 'lucide-react'
import MarketplacePage from './pages/MarketplacePage'
import JobRunPage from './pages/JobRunPage'
import ProfilePage from './pages/ProfilePage'
import HomePage from './pages/HomePage'
import { useCurrentUser } from './hooks/useCurrentUser'
import { useIdleReset } from './hooks/useIdleReset'
import { ALL_NAV } from './nav'

export default function App() {
  const [isDark, setIsDark] = useState(
    () => document.documentElement.classList.contains('dark')
  )
  const location                    = useLocation()
  const { role, displayName, loading } = useCurrentUser()
  useIdleReset()

  function toggleTheme() {
    const html = document.documentElement
    html.classList.toggle('dark')
    const next = html.classList.contains('dark')
    localStorage.setItem('theme', next ? 'dark' : 'light')
    setIsDark(next)
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-dark-950">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
          <p className="text-sm text-dark-300">Loading…</p>
        </div>
      </div>
    )
  }

  if (role === 'unknown') {
    return (
      <div className="h-screen flex items-center justify-center bg-dark-950">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ease: [0.25, 1, 0.5, 1] }}
          className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="w-14 h-14 rounded-2xl bg-dark-900 border border-ui/[0.07] flex items-center justify-center shadow-apple">
            <ShieldOff size={22} className="text-dark-300" />
          </div>
          <div>
            <p className="text-dark-50 font-semibold text-base">Access Denied</p>
            <p className="text-dark-300 text-sm mt-1.5 leading-relaxed">
              Your account is not assigned to any application group.
              Contact your administrator to request access.
            </p>
          </div>
        </motion.div>
      </div>
    )
  }

  const isEngineer = role === 'data_engineer'
  const nav        = ALL_NAV.filter(n => n.roles.includes(role))

  return (
    <div className="h-screen flex flex-col bg-dark-950 overflow-hidden">

      {/* ── Top bar ── */}
      <header className="
        sticky top-0 z-50
        bg-dark-900/80 backdrop-blur-apple
        border-b border-ui/[0.07]
        px-5 py-3 flex items-center gap-3
        shadow-apple-sm
      ">
        <Link to="/" className="flex items-center gap-2.5 flex-1">
          <div className="w-7 h-7 rounded-[10px] bg-brand-500 flex items-center justify-center shadow-apple-blue">
            <Zap size={14} className="text-white" />
          </div>
          <span className="font-semibold text-dark-50 text-[15px] tracking-tight">
            ABeam Adoption Kit
          </span>
          <span className="
            text-[10px] px-2 py-0.5 rounded-full font-semibold tracking-wide
            bg-brand-500/[0.12] text-brand-500 border border-brand-500/20
          ">
            DEMO
          </span>
        </Link>

        {/* User display name */}
        {displayName && (
          <span className="text-xs text-dark-300 hidden sm:block">{displayName}</span>
        )}

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="
            w-8 h-8 rounded-full flex items-center justify-center
            text-dark-300 hover:text-dark-50
            bg-dark-800/60 hover:bg-dark-800
            border border-ui/[0.08]
            transition-all duration-300
            hover:scale-105 active:scale-95
          ">
          {isDark ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </header>

      <div className="flex flex-1 min-h-0">

        {/* ── Sidebar ── */}
        <aside className="
          w-56 shrink-0
          bg-dark-900/70 backdrop-blur-apple
          border-r border-ui/[0.07]
          py-5 px-3 flex flex-col gap-0.5
        ">
          <p className="
            text-[10px] text-dark-300 uppercase tracking-[0.1em]
            px-3 mb-2.5 font-semibold
          ">
            Modules
          </p>

          {nav.map(({ to, label, icon: Icon }, i) => (
            <motion.div
              key={to}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06, ease: [0.25, 1, 0.5, 1] }}>
              <NavLink
                to={to}
                className={({ isActive }) => `
                  flex items-center gap-2.5 px-3 py-2 rounded-xl text-[13px] font-medium
                  transition-all duration-200
                  ${isActive
                    ? 'bg-brand-500/[0.12] text-brand-500 shadow-[inset_0_0_0_1px_rgb(0_113_227/0.2)]'
                    : 'text-dark-200 hover:bg-ui/[0.05] hover:text-dark-50'
                  }
                `}>
                <Icon size={14} className="shrink-0" />
                {label}
              </NavLink>
            </motion.div>
          ))}
        </aside>

        {/* ── Main content ── */}
        <main className="flex-1 p-8 overflow-auto">
          {/* MetadataPage always mounted for data_engineer only */}
          {isEngineer && (
            <div className={location.pathname !== '/metadata' ? 'hidden' : ''}>
              <MetadataPage />
            </div>
          )}

          <Routes>
            <Route path="/" element={<HomePage />} />
            {isEngineer && (
              <>
                {/* MetadataPage itself renders via the always-mounted div above — this route
                    just keeps react-router from treating /metadata as unmatched. */}
                <Route path="/metadata"  element={null} />
                <Route path="/jobrun"    element={<JobRunPage />} />
                <Route path="/profiling" element={<ProfilePage />} />
                <Route path="/modelling" element={<ComingSoon label="Gold Modelling" />} />
              </>
            )}
            <Route path="/marketplace" element={<MarketplacePage />} />
            <Route path="*"            element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

function ComingSoon({ label }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ease: [0.25, 1, 0.5, 1] }}
      className="flex flex-col items-center justify-center h-64 gap-4">
      <div className="
        w-14 h-14 rounded-2xl
        bg-dark-900 border border-ui/[0.07]
        flex items-center justify-center
        shadow-apple
      ">
        <Layers size={22} className="text-dark-300" />
      </div>
      <div className="text-center">
        <p className="text-dark-50 text-sm font-medium">{label}</p>
        <p className="text-dark-300 text-xs mt-0.5">Coming in next sprint</p>
      </div>
    </motion.div>
  )
}
