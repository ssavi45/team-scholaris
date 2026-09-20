import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft, ArrowUpRight, FileText, FolderOpen, Users, MessageSquare, RefreshCw, Clock3, Sprout, ShieldCheck } from 'lucide-react'
import { useAuth } from '../auth/auth-context'
import { loadOverview } from './overview-api'
import { ProjectTabShell } from '../../components/layout/ProjectTabShell'

const activityIcons = { paper: FileText, files: FolderOpen, chat: MessageSquare, project: Sprout }
const destinations = { paper: 'Paper workspace', files: 'Files', team: 'Team', chat: 'Chat' }

export function ProjectPage() {
  const { projectId = '' } = useParams()
  const { user } = useAuth()
  return <ProjectOverview key={`${projectId}:${user?.id}`} id={projectId} />
}

function ProjectOverview({ id }: { id: string }) {
  const { user } = useAuth()
  const [state, setState] = useState<{ data: Awaited<ReturnType<typeof loadOverview>>; loading: boolean; error: string }>({ data: null, loading: true, error: '' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void loadOverview(id, controller.signal).then((data) => {
      if (!controller.signal.aborted) setState({ data, loading: false, error: '' })
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setState({ data: null, loading: false, error: cause instanceof Error ? cause.message : 'Unable to load project.' })
    })
    return () => controller.abort()
  }, [id, attempt])

  useEffect(() => {
    const refresh = () => {
      setState((current) => ({ ...current, loading: true }))
      setAttempt((value) => value + 1)
    }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  function refresh() {
    setState((current) => ({ ...current, loading: true }))
    setAttempt((value) => value + 1)
  }

  if (!state.data) return <div className="project-tab-container">
    <Link to="/app" className="back-link"><ArrowLeft size={13} aria-hidden="true" /> Back to dashboard</Link>
    <div className="empty-state">
      {state.loading ? <p role="status">Loading project overview...</p> : state.error ? <><p role="alert">{state.error}</p><button className="button secondary compact-button" onClick={refresh}>Try again</button></> : <><h1>Project unavailable</h1><p>This project does not exist or you no longer have access to it.</p></>}
    </div>
  </div>

  const { project, members, paperCount, fileCount, taskSummary, activity, unavailable } = state.data
  const mine = members.find((member) => member.user_id === user?.id)
  const archived = project.status === 'archived'
  const canEdit = !archived && (mine?.access_level === 'owner' || mine?.access_level === 'member')
  const shortcuts = [
    { tab: 'paper' as const, icon: FileText, detail: paperCount === null ? 'Paper summary unavailable' : paperCount === 0 ? 'No paper files yet' : `${paperCount} paper ${paperCount === 1 ? 'file' : 'files'}`, action: canEdit ? 'Open your writing workspace' : 'Read the project paper' },
    { tab: 'files' as const, icon: FolderOpen, detail: fileCount === null ? 'File summary unavailable' : `${fileCount} shared ${fileCount === 1 ? 'file' : 'files'}`, action: canEdit ? 'Organize research materials' : 'Browse and download research' },
    { tab: 'team' as const, icon: Users, detail: `${members.length} ${members.length === 1 ? 'collaborator' : 'collaborators'}`, action: mine?.access_level === 'owner' && !archived ? 'Manage your research team' : 'Meet your collaborators' },
    { tab: 'chat' as const, icon: MessageSquare, detail: 'Project conversations', action: canEdit ? 'Continue the discussion' : 'Read the discussion' },
  ]

  return <ProjectTabShell projectId={id} projectName={project.name} projectStatus={project.status} activeTab="overview" isArchived={archived}>
    <div className="overview-toolbar"><div><p className="eyebrow">YOUR RESEARCH AT A GLANCE</p><p className="muted">Pick up your work and stay close to your team.</p></div><button className="button secondary compact-button" disabled={state.loading} onClick={refresh}><RefreshCw size={14} aria-hidden="true" />{state.loading ? 'Refreshing...' : 'Refresh overview'}</button></div>
    {unavailable.length > 0 && <p className="notice error-notice" role="status">Some summaries could not load ({unavailable.join(', ')}). Recent activity may be incomplete. Refresh to try again.</p>}
    <nav className="overview-shortcuts" aria-label="Project workspaces">{shortcuts.map(({ tab, icon: Icon, detail, action }) => <Link className={`overview-shortcut overview-shortcut-${tab}`} key={tab} to={`/project/${id}/${tab}`}>
      <div className="overview-shortcut-top"><span className="overview-icon"><Icon size={21} aria-hidden="true" /></span><ArrowUpRight size={17} aria-hidden="true" /></div><h2>{destinations[tab]}</h2><p className="overview-shortcut-count">{detail}</p><p className="muted">{action}</p>
    </Link>)}</nav>
    <div className="overview-content-grid">
      <div className="overview-primary-column">
        <section className="overview-card" aria-labelledby="research-title"><p className="eyebrow">THE RESEARCH</p><h2 id="research-title">About this project</h2><p className="overview-description">{project.description || 'No description has been added yet.'}</p></section>
        <section className="overview-card" aria-labelledby="activity-title" aria-busy={state.loading}>
          <div className="overview-card-heading"><div><p className="eyebrow">KEEP UP WITH THE PROJECT</p><h2 id="activity-title">Recent activity</h2></div><Clock3 size={20} aria-hidden="true" /></div>
          {activity.length === 1 && !unavailable.length && <p className="overview-start-note">Your project is ready. Paper changes, shared files, and conversations will appear here as the team gets started.</p>}
          <ol className="overview-activity-list">{activity.map((item) => {
            const Icon = activityIcons[item.kind]
            return <li key={item.id}><span className="overview-activity-icon"><Icon size={16} aria-hidden="true" /></span><div className="overview-activity-text"><p>{item.label}</p><time dateTime={item.at}>{new Date(item.at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</time></div>{item.kind !== 'project' && <Link to={`/project/${id}/${item.kind}`} className="overview-activity-link" aria-label={`Open ${destinations[item.kind]}: ${item.label}`}>View <ArrowUpRight size={13} aria-hidden="true" /></Link>}</li>
          })}</ol>
          <p className="form-note overview-activity-note">Recent file additions, latest changes to paper files, and messages. Deleted items are not included.</p>
        </section>
      </div>
      <aside className="overview-sidebar" aria-label="Project details">
        <section className="overview-card"><p className="eyebrow">NEXT STEPS</p><h2>Research tasks</h2>{taskSummary ? <dl className="overview-task-counts"><div><dt>Open</dt><dd><Link to={`/project/${id}/tasks?filter=open`}>{taskSummary.open_count}</Link></dd></div><div><dt>Overdue</dt><dd><Link to={`/project/${id}/tasks?filter=overdue`}>{taskSummary.overdue_count}</Link></dd></div><div><dt>Assigned to you</dt><dd><Link to={`/project/${id}/tasks?filter=mine`}>{taskSummary.mine_count}</Link></dd></div></dl> : <p className="muted">Task summary unavailable. Refresh to try again.</p>}<Link to={`/project/${id}/tasks`} className="overview-inline-link">View all tasks <ArrowUpRight size={14} aria-hidden="true" /></Link></section>
        <section className="overview-card overview-access-card"><ShieldCheck size={22} aria-hidden="true" /><p className="eyebrow">YOUR PLACE ON THE TEAM</p><h2 className="overview-access-level">{mine?.access_level ?? 'Access unavailable'}</h2><p className="muted">{archived ? 'This project is archived. You can browse its research and conversations.' : canEdit ? 'You can edit the paper, share research files, and contribute to discussions.' : 'You can read the paper and chat, and download shared research files.'}</p>{mine?.display_role && <p className="overview-research-role">{mine.display_role}</p>}<Link to={`/project/${id}/team`} className="overview-inline-link">View project team <ArrowUpRight size={14} aria-hidden="true" /></Link></section>
        <section className="overview-card"><h2>Project details</h2><dl className="overview-details"><div><dt>Created</dt><dd><time dateTime={project.created_at}>{new Date(project.created_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}</time></dd></div><div><dt>Status</dt><dd>{archived ? 'Archived' : 'Active'}</dd></div><div><dt>Visibility</dt><dd>Project team only</dd></div></dl><p className="form-note">Shared with invited collaborators.</p></section>
      </aside>
    </div>
  </ProjectTabShell>
}
