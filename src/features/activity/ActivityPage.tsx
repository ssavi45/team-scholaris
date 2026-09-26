import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { History, RefreshCw } from 'lucide-react'
import { ProjectTabShell } from '../../components/layout/ProjectTabShell'
import { useAuth } from '../auth/auth-context'
import { loadProject } from '../projects/projects-api'
import { ActivityList } from './ActivityList'
import { loadActivity, loadActivityActors } from './activity-api'
import { activityCategories, emptyActivityFilters } from './activity-types'
import type { ActivityCursor, ActivityFilters } from './activity-types'

type ActivityData = NonNullable<Awaited<ReturnType<typeof loadProject>>> & Awaited<ReturnType<typeof loadActivity>> & { actors: Awaited<ReturnType<typeof loadActivityActors>> }
export function ActivityPage() {
  const { projectId = '' } = useParams()
  const { user } = useAuth()
  return <ProjectActivity key={`${projectId}:${user?.id}`} projectId={projectId} />
}
function ProjectActivity({ projectId }: { projectId: string }) {
  const [state, setState] = useState<{ data: ActivityData | null; loading: boolean; error: string }>({ data: null, loading: true, error: '' })
  const [filters, setFilters] = useState<ActivityFilters>(emptyActivityFilters)
  const [draft, setDraft] = useState<ActivityFilters>(emptyActivityFilters)
  const [cursors, setCursors] = useState<(ActivityCursor | null)[]>([null])
  const [attempt, setAttempt] = useState(0)
  const cursor = cursors[cursors.length - 1]

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const project = await loadProject(projectId, controller.signal)
        if (!project) { if (!controller.signal.aborted) setState({ data: null, loading: false, error: '' }); return }
        const [activity, actors] = await Promise.all([loadActivity(projectId, controller.signal, filters, cursor), loadActivityActors(projectId, controller.signal)])
        if (!controller.signal.aborted) setState({ data: { ...project, ...activity, actors }, loading: false, error: '' })
      } catch (cause) {
        if (!controller.signal.aborted) setState({ data: null, loading: false, error: cause instanceof Error ? cause.message : 'Unable to load activity.' })
      }
    }
    void load()
    return () => controller.abort()
  }, [projectId, filters, cursor, attempt])

  useEffect(() => {
    const refresh = () => { setState((s) => ({ ...s, loading: true })); setCursors([null]); setAttempt((n) => n + 1) }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  function refresh(resetFilters = false) {
    if (resetFilters) { setFilters(emptyActivityFilters); setDraft(emptyActivityFilters) }
    setCursors([null]); setState((s) => ({ ...s, loading: true })); setAttempt((n) => n + 1)
  }
  if (!state.data) return <div className="project-tab-container"><Link to="/app" className="back-link">Back to dashboard</Link><div className="empty-state">{state.loading ? <p role="status">Loading project activity...</p> : state.error ? <><p role="alert">{state.error}</p><div className="activity-error-actions"><button className="button secondary compact-button" onClick={() => refresh()}>Try again</button><button className="button secondary compact-button" onClick={() => refresh(true)}>Clear filters</button></div></> : <><h1>Project unavailable</h1><p>This project does not exist or you no longer have access.</p></>}</div></div>
  const { project, events, actors, next } = state.data
  const filtered = Object.values(filters).some(Boolean)
  return <ProjectTabShell projectId={projectId} projectName={project.name} projectStatus={project.status} activeTab="activity" isArchived={project.status === 'archived'}>
    <div className="activity-heading"><div><p className="eyebrow">THE STORY OF YOUR RESEARCH</p><h2>Project activity</h2><p className="muted">Follow the work, decisions, and people moving your project forward.</p></div><button className="button secondary compact-button" disabled={state.loading} onClick={() => refresh()}><RefreshCw size={15} aria-hidden="true" />Refresh activity</button></div>
    <section className="activity-panel" aria-label="Project history" aria-busy={state.loading}>
      <form className="activity-filters" onSubmit={(e) => { e.preventDefault(); setFilters({ ...draft }); setCursors([null]); setState((s) => ({ ...s, loading: true })); setAttempt((n) => n + 1) }}>
        <label>Feature<select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}><option value="">All features</option>{Object.entries(activityCategories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Person<select value={draft.actor} onChange={(e) => setDraft({ ...draft, actor: e.target.value })}><option value="">Everyone</option>{actors.map((actor) => <option key={actor.user_id} value={actor.user_id}>{actor.name}</option>)}</select></label>
        <label>From<input type="date" min="1900-01-01" max={draft.to || '9998-12-31'} value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></label>
        <label>Through<input type="date" min={draft.from || '1900-01-01'} max="9998-12-31" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
        <div className="activity-filter-actions"><button className="button primary compact-button" disabled={state.loading}>Apply filters</button><button type="button" className="button secondary compact-button" disabled={state.loading} onClick={() => refresh(true)}>Clear</button></div>
      </form>
      <div className="activity-results"><p role="status" className="activity-results-label">{state.loading ? 'Refreshing history...' : `${events.length} ${events.length === 1 ? 'event' : 'events'} on this page${filtered ? ' · Filters applied' : ''}`}</p>
        {events.length ? <ActivityList events={events} projectId={projectId} /> : <div className="activity-empty"><History size={30} aria-hidden="true" /><h3>{filtered || cursors.length > 1 ? 'No activity matches this view' : 'Your project history starts here'}</h3><p>{filtered ? 'Try another person, feature, or date range.' : 'New project actions will appear here. Earlier task events are included when available.'}</p>{filtered && <button className="button secondary compact-button" onClick={() => refresh(true)}>Clear filters</button>}</div>}
      </div>
      {(next || cursors.length > 1) && <div className="activity-pagination"><button className="button secondary compact-button" disabled={cursors.length === 1 || state.loading} onClick={() => { setState((s) => ({ ...s, loading: true })); setCursors((items) => items.slice(0, -1)) }}>Newer</button><span>Page {cursors.length}</span><button className="button secondary compact-button" disabled={!next || state.loading} onClick={() => { if (next) { setState((s) => ({ ...s, loading: true })); setCursors((items) => [...items, next]) } }}>Older</button></div>}
    </section>
    <p className="form-note activity-footnote">Dates use your local time zone. History covers actions recorded since tracking was enabled; earlier task events are retained. Paper saves and file-tree changes are grouped by operation. Invitation activity is visible only to the project owner.</p>
  </ProjectTabShell>
}
