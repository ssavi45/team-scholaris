import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from './auth-context'

export function ProtectedRoute() {
  const location = useLocation()
  const { user, loading, error } = useAuth()
  if (loading) return <main className="status-page" role="status">Restoring your session…</main>
  if (error) return <main className="status-page" role="alert"><p>{error}</p><button className="button secondary" onClick={() => window.location.reload()}>Try again</button></main>
  // This is UX protection. Every data query must still be authorized by RLS.
  if (user?.email_confirmed_at) return <Outlet />
  const next = encodeURIComponent(location.pathname + location.search)
  return <Navigate to={`/login?next=${next}`} replace />
}
