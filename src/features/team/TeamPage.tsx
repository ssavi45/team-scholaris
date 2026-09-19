import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { RefreshCw, ShieldCheck, Users } from 'lucide-react'
import { ProjectTabShell } from '../../components/layout/ProjectTabShell'
import { useAuth } from '../auth/auth-context'
import { getTeam } from '../invitations/invitations-api'
import type { TeamMember } from '../invitations/invitations-api'
import { ProjectInvitations } from '../invitations/ProjectInvitations'
import { loadProject } from '../projects/projects-api'
import { leaveProject, removeMember, updateMember } from './team-api'

type TeamData = { project: NonNullable<Awaited<ReturnType<typeof loadProject>>>['project']; members: TeamMember[] }
type Action = { kind: 'edit' | 'remove' | 'leave'; member: TeamMember }

export function TeamPage() {
  const { projectId = '' } = useParams()
  const { user } = useAuth()
  return <TeamWorkspace key={`${projectId}:${user?.id}`} projectId={projectId} />
}

function TeamWorkspace({ projectId }: { projectId: string }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [state, setState] = useState<{ data: TeamData | null; error: string; loading: boolean }>({ data: null, error: '', loading: true })
  const [attempt, setAttempt] = useState(0)
  const [action, setAction] = useState<Action | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const result = await loadProject(projectId, controller.signal)
        const data = result ? { project: result.project, members: await getTeam(projectId, controller.signal) } : null
        if (!controller.signal.aborted) setState({ data, loading: false, error: '' })
      } catch (cause) {
        if (!controller.signal.aborted) setState({ data: null, loading: false, error: cause instanceof Error ? cause.message : 'Unable to load the team.' })
      }
    }
    void load()
    return () => controller.abort()
  }, [projectId, attempt])

  useEffect(() => {
    // Refresh permissions on return, without interrupting an open confirmation.
    const refresh = () => { if (!action) setAttempt((value) => value + 1) }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [action])

  function refresh() {
    setState((current) => ({ ...current, loading: true }))
    setAttempt((value) => value + 1)
  }

  if (!state.data) return <div className="project-tab-container">
    <Link to="/app" className="back-link">Back to dashboard</Link>
    <div className="empty-state">
      {state.loading ? <p role="status">Loading project team...</p> : state.error ? <><p role="alert">{state.error}</p><button className="button secondary" onClick={refresh}>Try again</button></> : <><h1>Project unavailable</h1><p>This project does not exist or you no longer have access.</p></>}
    </div>
  </div>

  const { project, members } = state.data
  const mine = members.find((member) => member.user_id === user?.id)
  const isOwner = mine?.access_level === 'owner'
  const canManage = isOwner && project.status === 'active' && !state.loading

  return <ProjectTabShell projectId={projectId} projectName={project.name} projectStatus={project.status} activeTab="team" isArchived={project.status === 'archived'}>
    <div className="team-workspace">
      <div className="team-main">
        <section className="team-members-panel" aria-labelledby="members-title" aria-busy={state.loading}>
          <div className="team-section-heading">
            <div><p className="eyebrow">YOUR COLLABORATORS</p><h2 id="members-title">Project team <span className="team-count">{members.length}</span></h2><p className="muted">The people behind your research.</p></div>
            <button className="button secondary compact-button" disabled={state.loading || !!action} onClick={refresh}><RefreshCw size={14} aria-hidden="true" /> {state.loading ? 'Refreshing...' : 'Refresh'}</button>
          </div>
          {message && <p className="notice" role="status">{message}</p>}
          <ul className="team-member-list">{members.map((member) => <li className="team-member-row" key={member.user_id}>
            <span className="team-member-avatar" aria-hidden="true">{(member.name || 'Team member').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</span>
            <div className="team-member-identity"><strong>{member.name || 'Team member'} {member.user_id === user?.id && <span className="team-you">(you)</span>}</strong><span className="muted">{member.display_role || 'No research role added'}</span></div>
            <span className={`team-access team-access-${member.access_level}`}>{member.access_level === 'owner' && <ShieldCheck size={13} aria-hidden="true" />}{member.access_level}</span>
            {canManage && <div className="team-member-actions">
              <button className="button secondary compact-button" aria-label={`Edit ${member.name || 'team member'}`} onClick={() => setAction({ kind: 'edit', member })}>Edit</button>
              {member.access_level !== 'owner' && <button className="team-text-danger" aria-label={`Remove ${member.name || 'team member'}`} onClick={() => setAction({ kind: 'remove', member })}>Remove</button>}
            </div>}
          </li>)}</ul>
        </section>
        {isOwner && <ProjectInvitations projectId={projectId} isActive={project.status === 'active'} refreshVersion={attempt} />}
      </div>
      <aside className="team-sidebar" aria-label="Team access guide">
        <section className="overview-panel"><Users size={22} aria-hidden="true" /><h2>Everyone has a role</h2><p className="muted">Access controls what a teammate can do. Research roles describe their contribution.</p>
          <dl className="team-access-guide"><dt>Owner</dt><dd>Manages the team and has full editing access.</dd><dt>Member</dt><dd>Edits the paper, uploads files, and joins the discussion.</dd><dt>Viewer</dt><dd>Reads the paper and chat, and downloads shared files.</dd></dl>
          <p className="form-note">Labels such as “Supervisor” or “Lead author” do not change permissions.</p>
        </section>
        {!isOwner && mine && <section className="overview-panel team-leave-panel"><h3>Your membership</h3><p className="muted">Leaving removes your access. Your contributions stay with the project. You will need a new invitation to return.</p><button className="button secondary compact-button" disabled={state.loading} onClick={() => setAction({ kind: 'leave', member: mine })}>Leave project</button></section>}
      </aside>
    </div>
    {action && <MemberDialog projectId={projectId} action={action} close={() => setAction(null)} saved={() => {
      setAction(null)
      if (action.kind === 'leave') { void navigate('/app', { replace: true }); return }
      setMessage(action.kind === 'remove' ? 'Teammate removed. Their contributions have been preserved.' : 'Team member updated.')
      refresh()
    }} />}
  </ProjectTabShell>
}

function MemberDialog({ projectId, action, close, saved }: { projectId: string; action: Action; close: () => void; saved: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const inFlight = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [access, setAccess] = useState(action.member.access_level)
  const [role, setRole] = useState(action.member.display_role || '')
  const editing = action.kind === 'edit'
  const leaving = action.kind === 'leave'
  useEffect(() => {
    const node = dialog.current!
    node.showModal()
    return () => node.close()
  }, [])

  async function submit() {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      if (editing) await updateMember(projectId, action.member, access, role)
      else if (leaving) await leaveProject(projectId)
      else await removeMember(projectId, action.member)
      saved()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to update membership.') }
    finally { inFlight.current = false; setBusy(false) }
  }

  return <dialog ref={dialog} className="project-dialog team-dialog" aria-labelledby="member-dialog-title" aria-describedby="member-dialog-description" onCancel={(event) => { event.preventDefault(); if (!inFlight.current) close() }}>
    <form onSubmit={(event) => { event.preventDefault(); void submit() }} aria-busy={busy}>
      <p className="eyebrow">PROJECT TEAM</p>
      <h2 id="member-dialog-title">{editing ? 'Edit team member' : leaving ? 'Leave this project?' : `Remove ${action.member.name || 'this teammate'}?`}</h2>
      <p id="member-dialog-description" className="muted">{editing ? `Update access and research role for ${action.member.name || 'this teammate'}.` : leaving ? 'You will lose access to the paper, files, and chat. A new invitation is required to rejoin.' : 'This teammate will lose project access. You can invite them again later.'}</p>
      {editing ? <div className="team-edit-fields">
        <label>Access<select value={access} onChange={(event) => setAccess(event.target.value as TeamMember['access_level'])} disabled={busy || action.member.access_level === 'owner'}>{action.member.access_level === 'owner' ? <option value="owner">Owner</option> : <><option value="member">Member — can edit</option><option value="viewer">Viewer — read only</option></>}</select></label>
        {action.member.access_level === 'owner' && <p className="form-note">Owner access is protected and cannot be changed here.</p>}
        <label>Research role <span className="muted">(optional)</span><input value={role} onChange={(event) => setRole(event.target.value)} maxLength={120} disabled={busy} placeholder="e.g. Lead author, Supervisor" /></label>
        <p className="form-note">A descriptive label only. It does not grant extra permissions.</p>
      </div> : <p className="notice">Existing messages, paper content, and uploaded files will remain in the project with their attribution.</p>}
      {error && <p className="notice error-notice" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" autoFocus disabled={busy} onClick={close}>Cancel</button><button type="submit" className={`button ${editing ? 'primary' : 'team-danger-button'}`} disabled={busy}>{busy ? 'Saving...' : editing ? 'Save changes' : leaving ? 'Leave project' : 'Remove teammate'}</button></div>
    </form>
  </dialog>
}
