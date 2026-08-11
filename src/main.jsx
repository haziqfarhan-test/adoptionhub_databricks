import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

// Apply theme before first render to prevent flash of wrong mode
;(function () {
  const saved  = localStorage.getItem('theme')
  const system = window.matchMedia('(prefers-color-scheme: dark)').matches
  if (saved === 'dark' || (!saved && system)) {
    document.documentElement.classList.add('dark')
  }
})()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
