import { Navigate, useLocation } from 'react-router'

export function ProtectedRoute() {
  const location = useLocation()
  // Fail closed until verified Supabase session handling is implemented.
  // This is not database authorization; project access will require RLS.
  const next = encodeURIComponent(location.pathname + location.search)
  return <Navigate to={`/login?next=${next}`} replace />
}
