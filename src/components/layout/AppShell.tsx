import { useState } from 'react'
import { NavLink, Outlet, useMatch } from 'react-router'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../features/auth/auth-context'

export function AppShell() {
  const paperRoute = useMatch('/project/:projectId/paper')
  const { user } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function signOut() {
    if (!supabase || busy) return
    if (!window.dispatchEvent(new Event('scholaris:before-sign-out', { cancelable: true }))) return
    setBusy(true); setError('')
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    } catch { setError('Unable to sign out. Check your connection and try again.') }
    finally { setBusy(false) }
  }
  return <div className={`app-shell${paperRoute ? ' paper-shell' : ''}`}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="app-header">
      <NavLink className="brand" to="/app">Team Scholaris</NavLink>
      <nav aria-label="Main navigation"><NavLink to="/app">Dashboard</NavLink></nav>
      <span className="account-email">{user?.email}</span>
      <button className="button secondary sign-out" onClick={() => void signOut()} disabled={busy}>{busy ? 'Signing out...' : 'Sign out'}</button>
    </header>
    {error && <p className="notice error-notice" role="alert">{error}</p>}
    <main id="main-content" className="workspace" tabIndex={-1}><Outlet /></main>
  </div>
}
