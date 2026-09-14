import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { INVITE_EXPIRY_DAYS } from '../../lib/constants'
import { getTeam, listInvitations, revokeInvitation, sendInvitation } from './invitations-api'
import type { Invitation, TeamMember } from './invitations-api'

export function ProjectTeam({ projectId, isOwner, isActive, onRefresh }: { projectId: string; isOwner: boolean; isActive: boolean; onRefresh: () => void }) {
  const [team, setTeam] = useState<TeamMember[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [loadError, setLoadError] = useState('')
  const [loadedAt, setLoadedAt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([getTeam(projectId, controller.signal), isOwner ? listInvitations(controller.signal, projectId) : Promise.resolve([])]).then(([members, pending]) => {
      if (!controller.signal.aborted) { setTeam(members); setInvitations(pending); setLoading(false); setLoadError(''); setLoadedAt(Date.now()) }
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) { setLoadError(cause instanceof Error ? cause.message : 'Unable to load team.'); setLoading(false) }
    })
    return () => controller.abort()
  }, [projectId, isOwner, attempt])
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const form = event.currentTarget
    const values = new FormData(form)
    setBusy(true); setError(''); setMessage('')
    try {
      await sendInvitation(projectId, String(values.get('email')).trim(), String(values.get('access')))
      setMessage('Invitation email sent. The recipient can also accept from their dashboard.'); form.reset()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to send invitation.') }
    finally { setBusy(false); setAttempt((value) => value + 1) }
  }
  async function revoke(id: string) {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try { await revokeInvitation(id); setMessage('Invitation revoked.'); setAttempt((value) => value + 1) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to revoke invitation.') }
    finally { setBusy(false) }
  }
  return <section className="project-section" aria-labelledby="team-title">
    <div className="section-heading"><h2 id="team-title">Team</h2><button className="button secondary compact-button" disabled={busy} onClick={onRefresh}>Refresh team</button></div>
    {loading && <p role="status">Loading team...</p>}
    {loadError && <p className="notice error-notice" role="alert">{loadError}</p>}
    <ul className="team-list">{team.map((member) => <li key={member.user_id}><div><strong>{member.name || 'Team member'}</strong>{member.display_role && <p className="muted">{member.display_role}</p>}</div><span className="status-badge">{member.access_level}</span></li>)}</ul>
    {isOwner && isActive && <div className="overview-panel">
      <h3>Invite a teammate</h3><p className="muted">Invitations expire after {INVITE_EXPIRY_DAYS} days. A new invitation to the same email replaces its previous link.</p>
      <form className="invite-form" onSubmit={(event) => void invite(event)} aria-busy={busy}>
        <label>Email<input name="email" type="email" maxLength={254} required disabled={busy} placeholder="teammate@university.edu" /></label>
        <label>Access<select name="access" defaultValue="member" disabled={busy}><option value="member">Member</option><option value="viewer">Viewer</option></select></label>
        <button className="button primary compact-button" disabled={busy}>{busy ? 'Please wait...' : 'Send invitation'}</button>
      </form>
      <p className="form-note">Members will be able to contribute to the paper and files; viewers will have read access. Both will be able to use project chat when those features are available.</p>
    </div>}
    {error && <p className="notice error-notice" role="alert">{error}</p>}
    {message && <p className="notice" role="status">{message}</p>}
    {isOwner && invitations.length > 0 && <div className="overview-panel"><h3>Invitations</h3><ul className="invitation-list">{invitations.map((invitation) => {
      const status = invitation.accepted_at ? 'Accepted' : invitation.revoked_at ? 'Revoked' : new Date(invitation.expires_at).getTime() <= loadedAt ? 'Expired' : 'Pending'
      return <li className="invitation-row" key={invitation.id}><div><strong>{invitation.email}</strong><p className="muted">{invitation.access_level} / {status} / expires {new Date(invitation.expires_at).toLocaleDateString()}</p></div>
        {status === 'Pending' && isActive && <button className="button secondary compact-button" disabled={busy} onClick={() => void revoke(invitation.id)}>Revoke</button>}
      </li>
    })}</ul></div>}
  </section>
}
