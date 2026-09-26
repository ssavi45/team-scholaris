import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ArrowUpRight, CalendarDays, Clock3, Plus, RefreshCw, Users } from 'lucide-react'
import { ProjectTabShell } from '../../components/layout/ProjectTabShell'
import { useAuth } from '../auth/auth-context'
import { getTeam, type TeamMember } from '../invitations/invitations-api'
import { loadProject } from '../projects/projects-api'
import { MeetingDialog } from './MeetingDialog'
import { GoogleConnectionPanel } from './GoogleConnectionPanel'
import { googleStatus, type GoogleConnection } from './google-calendar-api'
import { loadMeetings, MEETING_PAGE_SIZE, type MeetingCursor } from './meetings-api'
import { meetingTime, meetingViews, viewerZone, type Meeting, type MeetingView } from './meeting-types'

type Data = NonNullable<Awaited<ReturnType<typeof loadProject>>> & {
  team: TeamMember[]; meetings: Meeting[]; more: boolean; detail: Meeting | null; resolved: string; view: MeetingView
}
export function MeetingsPage() {
  const { projectId = '' } = useParams()
  const { user } = useAuth()
  return <MeetingsWorkspace key={`${projectId}:${user?.id}`} projectId={projectId} userId={user?.id ?? ''} />
}
function MeetingsWorkspace({ projectId, userId }: { projectId: string; userId: string }) {
  const [params, setParams] = useSearchParams()
  const requestedView = params.get('view') ?? 'upcoming'
  const view: MeetingView = Object.hasOwn(meetingViews, requestedView) ? requestedView as MeetingView : 'upcoming'
  const requested = params.get('meeting') ?? ''
  const creating = requested === 'new' || requested === 'instant'
  const [connection, setConnection] = useState<GoogleConnection | null>(null)
  const [connectionError, setConnectionError] = useState('')
  const [connectionAttempt, setConnectionAttempt] = useState(0)
  const [cursor, setCursor] = useState<MeetingCursor>()
  const [attempt, setAttempt] = useState(0)
  const [message, setMessage] = useState('')
  const [state, setState] = useState<{ data: Data | null; loading: boolean; error: string }>({ data: null, loading: true, error: '' })
  useEffect(() => {
    const controller = new AbortController()
    void googleStatus(controller.signal).then((value) => { if (!controller.signal.aborted) { setConnection(value); setConnectionError('') } }).catch(() => { if (!controller.signal.aborted) { setConnection(null); setConnectionError('Could not reach the Google connection service. Check that the local functions are running.') } })
    return () => controller.abort()
  }, [connectionAttempt])
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const project = await loadProject(projectId, controller.signal)
        if (!project) { if (!controller.signal.aborted) setState({ data: null, loading: false, error: '' }); return }
        const [team, meetings, detail] = await Promise.all([
          getTeam(projectId, controller.signal), loadMeetings(projectId, view, controller.signal, cursor),
          requested && !creating ? loadMeetings(projectId, view, controller.signal, undefined, requested) : Promise.resolve([]),
        ])
        const current = await loadProject(projectId, controller.signal)
        if (controller.signal.aborted) return
        if (!current) { setState({ data: null, loading: false, error: '' }); return }
        setState((previous) => {
          const page = meetings.slice(0, MEETING_PAGE_SIZE)
          const rows = cursor && previous.data?.view === view ? [...previous.data.meetings, ...page] : page
          return { loading: false, error: '', data: { ...current, team, meetings: [...new Map(rows.map((m) => [m.id, m])).values()], more: meetings.length > MEETING_PAGE_SIZE, detail: detail[0] ?? null, resolved: requested, view } }
        })
      } catch (cause) {
        if (!controller.signal.aborted) setState({ data: null, loading: false, error: cause instanceof Error ? cause.message : 'Unable to load meetings.' })
      }
    }
    void load()
    return () => controller.abort()
  }, [projectId, view, cursor, requested, creating, attempt])
  useEffect(() => {
    const refresh = () => { if (!requested) { setCursor(undefined); setState((s) => ({ ...s, loading: true })); setAttempt((n) => n + 1); setConnectionAttempt((n) => n + 1) } }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [requested])
  function refresh() { setCursor(undefined); setState((s) => ({ ...s, loading: true })); setAttempt((n) => n + 1) }
  function open(id: string) { setState((s) => ({ ...s, loading: true })); setParams({ view, meeting: id }) }
  function close() { setParams({ view }, { replace: true }); refresh() }
  if (!state.data) return <div className="project-tab-container"><Link to="/app" className="back-link">Back to dashboard</Link><div className="empty-state">{state.loading ? <p role="status">Loading project meetings…</p> : state.error ? <><p role="alert">{state.error}</p><button className="button secondary compact-button" onClick={refresh}>Try again</button></> : <><h1>Project unavailable</h1><p>This project does not exist or you no longer have access.</p></>}</div></div>
  const { project, team, meetings, more, detail, resolved } = state.data
  const mine = team.find((m) => m.user_id === userId)
  const writable = project.status === 'active' && (mine?.access_level === 'owner' || mine?.access_level === 'member')
  const canManage = writable && (!detail || mine?.access_level === 'owner' || detail.created_by === userId)
  const activeDetail = requested && resolved === requested
  const callbackMessage: Record<string, string> = { connected: 'Google connected. You can now create Meet links inside Scholaris.', declined: 'Google connection was cancelled. Your meetings have not changed.', permission: 'Calendar permission was not granted. Connect again and allow calendar access.', failed: 'Google connection could not be completed. Retry from this page using the configured app address.' }
  return <ProjectTabShell projectId={projectId} projectName={project.name} projectStatus={project.status} activeTab="meetings" isArchived={project.status === 'archived'}>
    <div className="meetings-heading"><div><p className="eyebrow">MAKE TIME FOR GOOD IDEAS</p><h2>Meetings</h2><p className="muted">Bring your team together. Leave with a clear next step.</p></div><div className="meetings-heading-actions"><button className="button secondary compact-button" disabled={state.loading} onClick={refresh}><RefreshCw size={15} aria-hidden="true" />Refresh</button>{writable && <button className="button primary compact-button" disabled={state.loading} onClick={() => open('new')}><Plus size={17} aria-hidden="true" />Schedule meeting</button>}</div></div>
    <GoogleConnectionPanel projectId={projectId} connection={connection} error={connectionError} writable={!!writable} refresh={() => setConnectionAttempt((n) => n + 1)} />
    {writable && connection?.connected && <div className="meeting-instant-action"><button className="button primary compact-button" disabled={state.loading} onClick={() => open('instant')}>Start a Google Meet now</button><span className="form-note">Create a one-hour meeting and get a link for your team.</span></div>}
    {(message || callbackMessage[params.get('google') ?? '']) && <p className="notice" role="status">{message || callbackMessage[params.get('google') ?? '']}</p>}
    {!writable && project.status === 'active' && <p className="notice">You can read meetings and shared notes. Owners and members can schedule meetings.</p>}
    <section className="meetings-panel" aria-label="Project meetings" aria-busy={state.loading}>
      <div className="meetings-toolbar"><div className="meetings-views" role="group" aria-label="Meeting view">{Object.entries(meetingViews).map(([key, label]) => <button key={key} aria-pressed={view === key} disabled={state.loading} onClick={() => { setCursor(undefined); setState((s) => ({ ...s, loading: true })); setParams({ view: key }); setAttempt((n) => n + 1) }}>{label}</button>)}</div><span className="meeting-zone"><Clock3 size={14} aria-hidden="true" />Times in {viewerZone()}</span></div>
      {state.loading && <p className="meeting-loading" role="status">Loading meetings…</p>}
      {meetings.length ? <ul className="meeting-list">{meetings.map((meeting) => {
        const date = new Date(meeting.starts_at)
        return <li key={meeting.id}><button className="meeting-row" disabled={state.loading} onClick={() => open(meeting.id)}>
          <span className="meeting-date-tile" aria-hidden="true"><span>{date.toLocaleDateString(undefined, { month: 'short' })}</span><strong>{date.getDate()}</strong><small>{date.getFullYear()}</small></span>
          <span className="meeting-row-main"><span className="meeting-row-title"><strong>{meeting.title}</strong>{meeting.cancelled_at && <span className="meeting-cancelled">Cancelled</span>}</span><span className="meeting-row-time">{meetingTime(meeting.starts_at)} – {meetingTime(meeting.ends_at)}</span><span className="meeting-row-meta">Organized by {meeting.organizer_name}<span><Users size={13} aria-hidden="true" />{meeting.attendees.length} {meeting.attendees.length === 1 ? 'attendee' : 'attendees'}</span></span></span><ArrowUpRight size={19} aria-hidden="true" />
        </button></li>
      })}</ul> : !state.loading && <div className="meetings-empty"><span><CalendarDays size={30} aria-hidden="true" /></span><h3>{view === 'upcoming' ? 'A little time together goes a long way' : view === 'past' ? 'Your meeting history starts here' : 'No cancelled meetings'}</h3><p>{view === 'upcoming' ? 'Plan a research check-in, share an agenda, and keep your team in sync.' : view === 'past' ? 'Finished meetings stay here with their agendas and shared notes.' : 'Cancelled meetings will stay here so your team can refer back to them.'}</p>{writable && view === 'upcoming' && <button className="button primary compact-button" onClick={() => open('new')}><Plus size={16} aria-hidden="true" />Schedule your first meeting</button>}</div>}
      {more && <div className="meetings-pagination"><button className="button secondary compact-button" disabled={state.loading} onClick={() => { const last = meetings.at(-1)!; setState((s) => ({ ...s, loading: true })); setCursor({ at: last.starts_at, id: last.id }) }}>Load more meetings</button></div>}
    </section>
    <p className="form-note meetings-footer">Owners manage all meetings. Organizers manage their own meetings and shared notes. Meeting links open your preferred calling app; calendar invitations are not sent.</p>
    {activeDetail && (detail || (creating && writable)) && <MeetingDialog key={`${requested}:${detail?.revision ?? 0}:${detail?.meeting_provider ?? ''}`} projectId={projectId} meeting={detail} team={team} userId={userId} canManage={!!canManage} canSync={!!writable} googleConnected={!!connection?.connected} instant={requested === 'instant'} close={close} saved={(cancelled, warning, openId) => { setMessage(warning || (cancelled ? 'Meeting cancelled. Its notes and history have been kept.' : 'Meeting saved.')); if (openId) { open(openId); refresh() } else close() }} />}
    {activeDetail && !detail && !creating && <p className="notice" role="status">This meeting is unavailable. <button className="button secondary compact-button" onClick={close}>Back to meetings</button></p>}
    {activeDetail && creating && !writable && <p className="notice">This project is read-only. <button className="button secondary compact-button" onClick={close}>Back to meetings</button></p>}
  </ProjectTabShell>
}
