import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { loadProject } from './projects-api'
import { ProjectTeam } from '../invitations/ProjectTeam'

export function ProjectPage() {
  const { projectId = '' } = useParams()
  return <ProjectOverview key={projectId} id={projectId} />
}

function ProjectOverview({ id }: { id: string }) {
  const { user } = useAuth()
  const [state, setState] = useState<{ data: Awaited<ReturnType<typeof loadProject>>; loading: boolean; error: string }>({ data: null, loading: true, error: '' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void loadProject(id, controller.signal).then((data) => {
      if (!controller.signal.aborted) setState({ data, loading: false, error: '' })
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setState({ data: null, loading: false, error: cause instanceof Error ? cause.message : 'Unable to load project.' })
    })
    return () => controller.abort()
  }, [id, user?.id, attempt])
  const mine = state.data?.members.find((member) => member.user_id === user?.id)
  return <div className="project-page-container">
    <Link to="/app" className="back-link">&larr; Back to dashboard</Link>
    {state.loading ? <p className="empty-state" role="status">Loading project...</p> : state.error ? <div className="empty-state" role="alert"><p>{state.error}</p><button className="button secondary compact-button" onClick={() => { setState({ data: null, loading: true, error: '' }); setAttempt(attempt + 1) }}>Try again</button></div> : !state.data ?
      <div className="empty-state"><h1>Project unavailable</h1><p>This project does not exist or you do not have access to it.</p></div> : <>
      <div className="page-heading project-title"><div><p className="eyebrow">Project overview</p><h1>{state.data.project.name}</h1></div><span className="status-badge">{state.data.project.status}</span></div>
      {state.data.project.status === 'archived' && <p className="notice">This project is archived and read-only.</p>}
      <nav className="project-tabs" aria-label="Project"><span aria-current="page">Overview</span><Link to={`/project/${id}/paper`}>Paper workspace</Link><Link to={`/project/${id}/files`}>Files</Link></nav>
      <section className="overview-panel"><h2>About this research</h2><p className="project-about">{state.data.project.description || 'No description has been added.'}</p></section>
      <dl className="project-facts">
        <div><dt>Your access</dt><dd>{mine?.access_level ?? 'Unavailable'}</dd></div>
        <div><dt>Team size</dt><dd>{state.data.members.length} {state.data.members.length === 1 ? 'person' : 'people'}</dd></div>
        <div><dt>Created</dt><dd><time dateTime={state.data.project.created_at}>{new Date(state.data.project.created_at).toLocaleDateString()}</time></dd></div>
        <div><dt>Last updated</dt><dd><time dateTime={state.data.project.updated_at}>{new Date(state.data.project.updated_at).toLocaleDateString()}</time></dd></div>
      </dl>
      {mine?.display_role && <p className="muted">Your display role: {mine.display_role}</p>}
      <ProjectTeam projectId={id} isOwner={mine?.access_level === 'owner'} isActive={state.data.project.status === 'active'} onRefresh={() => { setState({ data: null, loading: true, error: '' }); setAttempt((value) => value + 1) }} />
    </>}
  </div>
}
