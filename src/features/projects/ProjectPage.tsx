import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '../auth/auth-context'
import { loadProject } from './projects-api'
import { ProjectTabShell } from '../../components/layout/ProjectTabShell'

export function ProjectPage() {
  const { projectId = '' } = useParams()
  const { user } = useAuth()
  return <ProjectOverview key={`${projectId}:${user?.id}`} id={projectId} />
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

  if (state.loading) {
    return (
      <div className="project-tab-container">
        <Link to="/app" className="back-link">
          <ArrowLeft size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
          Back to dashboard
        </Link>
        <p className="empty-state" role="status">Loading project...</p>
      </div>
    )
  }

  if (state.error) {
    return (
      <div className="project-tab-container">
        <Link to="/app" className="back-link">
          <ArrowLeft size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
          Back to dashboard
        </Link>
        <div className="empty-state" role="alert">
          <p>{state.error}</p>
          <button
            className="button secondary compact-button"
            onClick={() => { setState({ data: null, loading: true, error: '' }); setAttempt(attempt + 1) }}
          >
            Try again
          </button>
        </div>
      </div>
    )
  }

  if (!state.data) {
    return (
      <div className="project-tab-container">
        <Link to="/app" className="back-link">
          <ArrowLeft size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
          Back to dashboard
        </Link>
        <div className="empty-state">
          <h1>Project unavailable</h1>
          <p>This project does not exist or you do not have access to it.</p>
        </div>
      </div>
    )
  }

  return (
    <ProjectTabShell
      projectId={id}
      projectName={state.data.project.name}
      projectStatus={state.data.project.status}
      activeTab="overview"
      categoryLabel="PROJECT OVERVIEW"
      isArchived={state.data.project.status === 'archived'}
    >
      <section className="overview-panel">
        <h2>About this research</h2>
        <p className="project-about">{state.data.project.description || 'No description has been added.'}</p>
      </section>

      <dl className="project-facts">
        <div><dt>Your access</dt><dd>{mine?.access_level ?? 'Unavailable'}</dd></div>
        <div><dt>Team size</dt><dd>{state.data.members.length} {state.data.members.length === 1 ? 'person' : 'people'}</dd></div>
        <div><dt>Created</dt><dd><time dateTime={state.data.project.created_at}>{new Date(state.data.project.created_at).toLocaleDateString()}</time></dd></div>
        <div><dt>Last updated</dt><dd><time dateTime={state.data.project.updated_at}>{new Date(state.data.project.updated_at).toLocaleDateString()}</time></dd></div>
      </dl>

      {mine?.display_role && <p className="muted">Your display role: {mine.display_role}</p>}

      <Link className="button secondary compact-button" to={`/project/${id}/team`}>View project team</Link>
    </ProjectTabShell>
  )
}
