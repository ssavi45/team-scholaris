import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { INVITE_EXPIRY_DAYS } from '../../lib/constants'
import { listInvitations, revokeInvitation, sendInvitation } from './invitations-api'
import type { Invitation } from './invitations-api'

export function ProjectInvitations({ projectId, isActive, refreshVersion }: { projectId: string; isActive: boolean; refreshVersion: number }) {
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [attempt, setAttempt] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [loadedAt, setLoadedAt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void listInvitations(controller.signal, projectId).then((pending) => {
      if (!controller.signal.aborted) { setInvitations(pending); setLoading(false); setLoadError(''); setLoadedAt(Date.now()) }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) { setLoadError(cause instanceof Error ? cause.message : 'Unable to load invitations.'); setLoading(false) }
    })
    return () => controller.abort()
  }, [projectId, attempt, refreshVersion])
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    const form = event.currentTarget
    const values = new FormData(form)
    setBusy(true); setError(''); setMessage('')
    try {
      await sendInvitation(projectId, String(values.get('email')).trim(), String(values.get('access')))
      setMessage('Invitation email sent. The recipient can also accept from their dashboard.'); form.reset()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to send invitation.') }
    finally { inFlight.current = false; setBusy(false); setAttempt((value) => value + 1) }
  }
  async function revoke(id: string) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true); setError(''); setMessage('')
    try { await revokeInvitation(id); setMessage('Invitation revoked.'); setAttempt((value) => value + 1) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to revoke invitation.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <section className="team-invitations" aria-label="Project invitations">
    {loading && <p role="status">Loading invitations...</p>}
    {loadError && <p className="notice error-notice" role="alert">{loadError}</p>}
    {isActive && <div className="overview-panel">
      <h3>Invite a teammate</h3><p className="muted">Invitations expire after {INVITE_EXPIRY_DAYS} days. A new invitation to the same email replaces its previous link.</p>
      <form className="invite-form" onSubmit={(event) => void invite(event)} aria-busy={busy}>
        <label>Email<input name="email" type="email" maxLength={254} required disabled={busy} placeholder="teammate@university.edu" /></label>
        <label>Access<select name="access" defaultValue="member" disabled={busy}><option value="member">Member</option><option value="viewer">Viewer</option></select></label>
        <button className="button primary compact-button" disabled={busy || loading || !!loadError}>{busy ? 'Please wait...' : 'Send invitation'}</button>
      </form>
      <p className="form-note">Members can edit the paper, upload files, and send chat messages. Viewers can read the paper, download files, and read chat.</p>
    </div>}
    {error && <p className="notice error-notice" role="alert">{error}</p>}
    {message && <p className="notice" role="status">{message}</p>}
    <div className="overview-panel"><div className="section-heading"><h3>Invitations</h3><button className="button secondary compact-button" disabled={busy || loading} onClick={() => { setLoading(true); setAttempt((value) => value + 1) }}>Refresh invitations</button></div>
    {!loading && !loadError && invitations.length === 0 && <p className="muted">No invitations yet. Bring your co-authors into the project when you are ready.</p>}
    <ul className="invitation-list">{invitations.map((invitation) => {
      const status = invitation.accepted_at ? 'Accepted' : invitation.revoked_at ? 'Revoked' : new Date(invitation.expires_at).getTime() <= loadedAt ? 'Expired' : 'Pending'
      return <li className="invitation-row" key={invitation.id}><div><strong>{invitation.email}</strong><p className="muted">{invitation.access_level} / {status} / expires {new Date(invitation.expires_at).toLocaleDateString()}</p></div>
        {status === 'Pending' && isActive && <button className="button secondary compact-button" disabled={busy} onClick={() => void revoke(invitation.id)}>Revoke</button>}
      </li>
    })}</ul></div>
  </section>
}
