import { useState } from 'react'
import { Link, NavLink, Outlet, useMatch } from 'react-router'
import { ArrowUpRight, BookOpen, FolderOpen, LayoutDashboard, LogOut } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../features/auth/auth-context'
import { BrandLogo } from '../BrandLogo'
import { ThemeToggle } from '../ThemeToggle'
import { ProfileProvider } from '../../features/profile/ProfileProvider'
import { useProfile } from '../../features/profile/profile-context'
import { ProfileAvatar } from '../../features/profile/ProfileAvatar'
import { hasUserRecovery, clearUserRecovery, allowUserRecovery } from '../../features/paper/draft-storage'
import { MeetingReminderBanner } from '../../features/meetings/MeetingReminderBanner'

export function AppShell() {
  const { user } = useAuth()
  if (!user) return null
  return <ProfileProvider key={user.id} userId={user.id}><WorkspaceShell /></ProfileProvider>
}

function WorkspaceShell() {
  const paperRoute = useMatch('/project/:projectId/paper')
  const projectRoute = useMatch('/project/:projectId/*')
  const projectPath = projectRoute ? `/project/${projectRoute.params.projectId}` : null
  const { user } = useAuth()
  const { profile, imageUrl } = useProfile()
  const badgeLabel = profile?.badge_display === 'username' ? profile.username : user?.email
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function signOut() {
    if (!supabase || busy) return
    if (!window.dispatchEvent(new Event('scholaris:before-sign-out', { cancelable: true }))) return
    setBusy(true); setError('')
    try {
      try {
        if (user && await hasUserRecovery(user.id)) {
          if (!window.confirm('Signing out clears unsaved paper recovery copies from this browser for this account. Save or download your work first. Continue?')) return
          window.dispatchEvent(new Event('scholaris:clear-paper-recovery'))
          await clearUserRecovery(user.id)
        }
      } catch {
        if (!window.confirm('Browser recovery storage is unavailable and could not be cleared. Sign out anyway? On a shared device, clear Scholaris site data in browser settings.')) {
          if (user) allowUserRecovery(user.id)
          window.dispatchEvent(new Event('scholaris:resume-paper-recovery'))
          return
        }
        window.dispatchEvent(new Event('scholaris:clear-paper-recovery'))
      }
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    } catch {
      if (user) allowUserRecovery(user.id)
      window.dispatchEvent(new Event('scholaris:resume-paper-recovery'))
      setError('Unable to sign out or clear local recovery. Check your connection/browser storage and try again.')
    }
    finally { setBusy(false) }
  }
  return <div className={`app-shell${paperRoute ? ' paper-shell' : ''}`}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="app-header">
      <Link className="brand" to="/app" aria-label="Team Scholaris home"><BrandLogo /></Link>
      <nav className="header-nav" aria-label="Main navigation">
        <NavLink className="header-nav-link" to="/app" end>
          <LayoutDashboard size={16} aria-hidden="true" /><span>Dashboard</span>
        </NavLink>
        {projectPath && <>
          <Link className={`header-nav-link${!paperRoute ? ' active' : ''}`} to={projectPath} aria-current={!paperRoute ? 'location' : undefined}>
            <FolderOpen size={16} aria-hidden="true" /><span>Project</span>
          </Link>
          <NavLink className="header-nav-link" to={`${projectPath}/paper`}>
            <BookOpen size={16} aria-hidden="true" /><span>Paper</span>
            <ArrowUpRight className="header-link-arrow" size={13} aria-hidden="true" />
          </NavLink>
        </>}
      </nav>
      <div className="header-account">
        <ThemeToggle />
        <Link to="/profile" className="account-identity" title="Edit your profile" aria-label={`Edit profile for ${badgeLabel || 'your account'}`}>
          <ProfileAvatar preset={profile?.avatar_preset} imageUrl={imageUrl} />
          <div className="account-copy">
            <span className="account-caption">Your workspace</span>
            <span className="account-email">{badgeLabel || 'Your profile'}</span>
          </div>
          <span className="account-mobile-label">Edit your profile</span>
        </Link>
        <button className="button secondary sign-out" onClick={() => void signOut()} disabled={busy} aria-label={busy ? 'Signing out...' : 'Sign out'} title="Sign out">
          <LogOut size={16} aria-hidden="true" /><span>{busy ? 'Signing out...' : 'Sign out'}</span>
        </button>
      </div>
    </header>
    <MeetingReminderBanner />
    {error && <p className="notice error-notice" role="alert">{error}</p>}
    <main id="main-content" className="workspace" tabIndex={-1}><Outlet /></main>
  </div>
}
