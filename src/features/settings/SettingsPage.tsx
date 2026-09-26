import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Archive, ArrowRightLeft, LockKeyhole, RefreshCw, Settings2, Trash2 } from 'lucide-react'
import { ProjectTabShell } from '../../components/layout/ProjectTabShell'
import { useAuth } from '../auth/auth-context'
import { applySettings, loadSettings, SettingsError } from './settings-api'
import { SettingsActionDialog } from './SettingsActionDialog'
import type { SettingsDialogAction } from './SettingsActionDialog'
import type { SettingsRequest, SettingsSnapshot } from './settings-types'
import { useSettingsGuard } from './useSettingsGuard'

export function SettingsPage() {
  const { projectId = '' } = useParams()
  const { user } = useAuth()
  return <SettingsWorkspace key={`${projectId}:${user?.id}`} projectId={projectId} />
}

function SettingsWorkspace({ projectId }: { projectId: string }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [state, setState] = useState<{ data: SettingsSnapshot | null; loading: boolean; error: string }>({ data: null, loading: true, error: '' })
  const [draft, setDraft] = useState({ name: '', description: '' })
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState('')
  const [nameError, setNameError] = useState('')
  const [message, setMessage] = useState('')
  const [action, setAction] = useState<SettingsDialogAction | null>(null)
  const inFlight = useRef(false)
  const pending = useRef<SettingsRequest | null>(null)
  const dirty = !!state.data && (draft.name !== state.data.project.name || draft.description !== state.data.project.description)
  const allowNavigation = useSettingsGuard(dirty || !!action || uncertain, busy)

  useEffect(() => {
    const controller = new AbortController()
    void loadSettings(projectId, controller.signal).then((data) => {
      if (controller.signal.aborted) return
      setState({ data, loading: false, error: '' })
      setDraft({ name: data?.project.name ?? '', description: data?.project.description ?? '' })
    }).catch((cause) => {
      if (!controller.signal.aborted) setState({ data: null, loading: false, error: cause instanceof Error ? cause.message : 'Unable to load settings.' })
    })
    return () => controller.abort()
  }, [projectId, attempt])

  useEffect(() => {
    const refresh = () => {
      if (dirty || action || busy || uncertain) return
      setState((current) => ({ ...current, loading: true }))
      setAttempt((value) => value + 1)
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [dirty, action, busy, uncertain])

  function reload() {
    if (inFlight.current || busy) return
    if ((dirty || uncertain) && !window.confirm('Refresh settings and discard your unsaved draft? An unconfirmed change may already have completed.')) return
    pending.current = null; setUncertain(false); setError(''); setNameError('')
    setState({ data: null, loading: true, error: '' }); setAttempt((value) => value + 1)
  }

  async function saveDetails() {
    if (inFlight.current || !state.data || state.loading || busy) return
    if (!draft.name.trim()) { setNameError('Enter a project name.'); return }
    if (!pending.current) pending.current = { projectId, revision: state.data.project.settings_revision,
      operationId: crypto.randomUUID(), action: { kind: 'details', name: draft.name.trim(), description: draft.description.trim() } }
    inFlight.current = true; setBusy(true); setError(''); setNameError(''); setMessage('')
    try {
      await applySettings(pending.current)
      pending.current = null; setUncertain(false)
      setMessage('Project details saved.')
      setState({ data: null, loading: true, error: '' }); setAttempt((value) => value + 1)
    } catch (cause) {
      const retryable = cause instanceof SettingsError && cause.retryable
      if (!retryable) pending.current = null
      setUncertain(retryable); setError(cause instanceof Error ? cause.message : 'Unable to save project details.')
    } finally { inFlight.current = false; setBusy(false) }
  }

  if (!state.data) return <div className="project-tab-container"><Link className="back-link" to="/app">Back to dashboard</Link>
    {message && <p className="notice" role="status">{message}</p>}
    <div className="empty-state">{state.loading ? <p role="status">Loading project settings…</p> : state.error ? <><p role="alert">{state.error}</p><button className="button secondary compact-button" onClick={reload}>Try again</button></> : <><h1>Project unavailable</h1><p>This project may be in Trash or you may no longer have access.</p><Link to="/app?view=trash">View your Trash</Link></>}</div>
  </div>

  const { project, members, has_google_meetings } = state.data
  const owner = members.find((person) => person.user_id === project.owner_id)
  const isOwner = project.owner_id === user?.id
  const archived = project.status === 'archived'
  const locked = busy || state.loading || uncertain || !!action
  const canEdit = isOwner && !archived && !locked
  const managementDisabled = !isOwner || locked || dirty

  function actionSaved() {
    const completed = action
    setAction(null)
    if (completed === 'trash') { allowNavigation(); void navigate('/app?view=trash', { replace: true }); return }
    setMessage(completed === 'transfer' ? 'Ownership transferred. You now have member access.' : completed === 'archive' ? 'Project archived. Research remains available to read.' : 'Project unarchived. Your team can edit again.')
    setState({ data: null, loading: true, error: '' }); setAttempt((value) => value + 1)
  }

  return <ProjectTabShell projectId={projectId} projectName={project.name} projectStatus={project.status} activeTab="settings" isArchived={archived}>
    <div className="settings-page-heading"><div><p className="eyebrow">A HOME FOR YOUR RESEARCH</p><h2>Project settings</h2><p className="muted">Keep the details current and manage what happens next.</p></div><button className="button secondary compact-button" disabled={busy || !!action || state.loading} onClick={reload}><RefreshCw size={14} aria-hidden="true" />{state.loading ? 'Refreshing…' : 'Refresh'}</button></div>
    {message && <p className="notice" role="status">{message}</p>}
    {!isOwner && <p className="notice"><LockKeyhole size={15} aria-hidden="true" /> These settings are read-only. The project owner manages details, ownership and recovery.</p>}
    <div className="settings-layout">
      <div className="settings-main">
        <section className="settings-card" aria-labelledby="settings-general-title"><div className="settings-section-heading"><Settings2 size={20} aria-hidden="true" /><div><h3 id="settings-general-title">General</h3><p className="muted">Give your research a clear name and purpose.</p></div></div>
          <form onSubmit={(event) => { event.preventDefault(); void saveDetails() }} aria-busy={busy}>
            <div className="settings-fields">
              <label htmlFor="project-settings-name">Project name</label><input id="project-settings-name" required maxLength={120} readOnly={!canEdit} aria-invalid={!!nameError} aria-describedby={nameError ? 'project-name-error' : undefined} value={draft.name} onChange={(event) => { setDraft({ ...draft, name: event.target.value }); setNameError('') }} />
              {nameError && <p id="project-name-error" className="settings-field-error" role="alert">{nameError}</p>}
              <label htmlFor="project-settings-description">Description <span className="muted">Optional</span></label><textarea id="project-settings-description" maxLength={5000} rows={5} readOnly={!canEdit} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="What are you investigating together?" />
              <p className="form-note">{draft.description.length.toLocaleString()} / 5,000 characters</p>
            </div>
            {error && <p className="notice error-notice" role="alert">{error}</p>}
            {isOwner && !archived && <div className="settings-form-actions"><span className="form-note" role="status">{uncertain ? 'Confirm the last request before making more changes.' : dirty ? 'You have unsaved changes.' : 'Your details are up to date.'}</span><button type="submit" className="button primary compact-button" disabled={busy || state.loading || !!action || (!dirty && !uncertain)}>{busy ? 'Saving…' : uncertain ? 'Retry same request' : 'Save changes'}</button></div>}
          </form>
        </section>
        <section className="settings-card" aria-labelledby="settings-lifecycle-title"><div className="settings-section-heading"><Archive size={20} aria-hidden="true" /><div><h3 id="settings-lifecycle-title">Project lifecycle</h3><p className="muted">Pause editing while keeping your research close.</p></div></div><div className="settings-action-row"><div><strong>{archived ? 'Ready to continue?' : 'Archive this project'}</strong><p className="muted">{archived ? 'Unarchive to let your team edit and accept invitations again.' : 'Archived projects remain readable and still count toward your ownership limit.'}</p></div>{isOwner && <button className="button secondary compact-button" disabled={managementDisabled} onClick={() => setAction(archived ? 'unarchive' : 'archive')}>{archived ? 'Unarchive' : 'Archive project'}</button>}</div></section>
        <section className="settings-card" aria-labelledby="settings-ownership-title"><div className="settings-section-heading"><ArrowRightLeft size={20} aria-hidden="true" /><div><h3 id="settings-ownership-title">Ownership</h3><p className="muted">Pass project management to a trusted teammate.</p></div></div><div className="settings-action-row"><div><strong>One project, one owner</strong><p className="muted">{archived ? 'Unarchive the project before transferring ownership.' : 'Transfer to a verified member. Your contributions stay, and you become a member.'}</p></div>{isOwner && <button className="button secondary compact-button" disabled={managementDisabled || archived} onClick={() => setAction('transfer')}>Transfer ownership</button>}</div></section>
        {isOwner && <section className="settings-card settings-danger" aria-labelledby="settings-danger-title"><div className="settings-section-heading"><Trash2 size={20} aria-hidden="true" /><div><h3 id="settings-danger-title">Move to Trash</h3><p className="muted">Remove this project from the team’s workspace.</p></div></div><div className="settings-action-row"><p className="muted">Research is retained. You can restore it within 30 days from Dashboard Trash; after that, self-service recovery expires.</p><button className="button team-danger-button compact-button" disabled={managementDisabled} onClick={() => setAction('trash')}>Move to Trash</button></div></section>}
        {dirty && isOwner && <p className="form-note">Save or refresh your details before changing ownership or project status.</p>}
      </div>
      <aside className="settings-sidebar" aria-label="Project information"><section className="settings-card"><p className="eyebrow">WORKSPACE DETAILS</p><h3>Your project</h3><dl className="settings-metadata"><dt>Owner</dt><dd>{owner?.name ?? 'Project owner'}{isOwner ? ' (you)' : ''}</dd><dt>Status</dt><dd><span className="status-badge">{project.status}</span></dd><dt>Created</dt><dd>{new Date(project.created_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}</dd><dt>Project ID</dt><dd className="settings-project-id">{project.id}</dd></dl><Link to={`/project/${projectId}/team`}>View project team →</Link></section><section className="settings-help"><LockKeyhole size={20} aria-hidden="true" /><h3>Private by design</h3><p>Only your current team can access this project. Research roles describe contributions; access levels control permissions.</p><Link to="/app?view=trash">Go to your Trash →</Link></section></aside>
    </div>
    {action && <SettingsActionDialog kind={action} project={project} members={members} hasGoogleMeetings={has_google_meetings} close={() => setAction(null)} saved={actionSaved} onBusy={setBusy} />}
  </ProjectTabShell>
}
