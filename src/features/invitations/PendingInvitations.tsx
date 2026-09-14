import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { acceptInvitation, listInvitations } from './invitations-api'
import type { Invitation } from './invitations-api'

export function PendingInvitations() {
  const [params, setParams] = useSearchParams()
  const token = params.get('invite') ?? undefined
  return <InvitationList key={token ?? 'all'} token={token} onClear={() => { const next = new URLSearchParams(params); next.delete('invite'); setParams(next, { replace: true }) }} />
}
function InvitationList({ token, onClear }: { token?: string; onClear: () => void }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void listInvitations(controller.signal, undefined, token).then((data) => {
      if (!controller.signal.aborted) { setInvitations(data); setLoading(false) }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : 'Unable to load invitations.'); setLoading(false) }
    })
    return () => controller.abort()
  }, [user?.id, token, attempt])
  async function accept(id: string) {
    if (busy) return
    setBusy(id); setError('')
    try { navigate('/project/' + await acceptInvitation(id, token), { replace: true }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to accept invitation.') }
    finally { setBusy(null) }
  }
  if (!loading && !error && !token && !invitations.length) return null
  return <section className="project-section" aria-labelledby="invitations-title">
    <h2 id="invitations-title">{token ? 'Your project invitation' : 'Pending invitations'}</h2>
    {loading && <p role="status">Loading invitations...</p>}
    {error && <div className="notice error-notice" role="alert"><p>{error}</p><button className="button secondary compact-button" disabled={!!busy} onClick={() => { setError(''); setLoading(true); setAttempt(attempt + 1) }}>Refresh invitations</button></div>}
    {!loading && !error && token && !invitations.length && <p className="notice">This invitation is unavailable for {user?.email}. It may be expired or already used. If it was sent to another email, sign out and sign in with that address using the original invitation link.</p>}
    <ul className="invitation-list">{invitations.map((invitation) => <li key={invitation.id} className="overview-panel invitation-row">
      <div><h3>{invitation.project_name}</h3><p className="muted">Join as {invitation.access_level} using {invitation.email}</p><p className="muted">Expires {new Date(invitation.expires_at).toLocaleDateString()}</p></div>
      <button className="button primary compact-button" disabled={!!busy} onClick={() => void accept(invitation.id)}>{busy === invitation.id ? 'Joining...' : 'Accept invitation'}</button>
    </li>)}</ul>
    {token && <button className="button secondary compact-button" onClick={onClear}>View all invitations</button>}
  </section>
}
