import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { MAX_OWNED_PROJECTS } from '../../lib/constants'
import { listProjects } from './projects-api'
import type { Project } from './projects-api'
import { CreateProjectDialog } from './CreateProjectDialog'
import { PendingInvitations } from '../invitations/PendingInvitations'

export function DashboardPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [state, setState] = useState<{ projects: Project[]; loading: boolean; error: string }>({ projects: [], loading: true, error: '' })
  const [attempt, setAttempt] = useState(0)
  const [creating, setCreating] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void listProjects(controller.signal).then((projects) => {
      if (!controller.signal.aborted) setState({ projects, loading: false, error: '' })
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted) setState({ projects: [], loading: false, error: cause instanceof Error ? cause.message : 'Unable to load projects.' })
    })
    return () => controller.abort()
  }, [user?.id, attempt])
  const owned = state.projects.filter((project) => project.owner_id === user?.id)
  const joined = state.projects.filter((project) => project.owner_id !== user?.id)
  const atLimit = owned.length >= MAX_OWNED_PROJECTS
  return <div className="dashboard-container">
    <PendingInvitations />
    <div className="page-heading"><div><p className="eyebrow">Workspace</p><h1>My projects</h1><p className="muted">Your research, together in one place.</p></div>
      <button className="button primary compact-button" disabled={state.loading || !!state.error || atLimit} onClick={() => setCreating(true)}>New project</button>
    </div>
    {state.loading ? <p className="empty-state" role="status">Loading your projects...</p> : state.error ?
      <div className="empty-state" role="alert"><p>{state.error}</p><button className="button secondary compact-button" onClick={() => { setState({ projects: [], loading: true, error: '' }); setAttempt(attempt + 1) }}>Try again</button></div> : <>
      <section className="project-section" aria-labelledby="owned-title"><div className="section-heading"><h2 id="owned-title">Owned projects</h2><span className="muted">{owned.length} of {MAX_OWNED_PROJECTS}</span></div>
        {atLimit && <p className="notice" role="status">You have reached the {MAX_OWNED_PROJECTS}-project ownership limit. You can still join projects created by others.</p>}
        <ProjectList projects={owned} empty="No projects yet. Create your first research workspace to get started." />
      </section>
      <section className="project-section" aria-labelledby="joined-title"><div className="section-heading"><h2 id="joined-title">Joined projects</h2><span className="muted">{joined.length}</span></div>
        <ProjectList projects={joined} empty="Projects you join will appear here." />
      </section>
    </>}
    {creating && <CreateProjectDialog onClose={() => setCreating(false)} onCreated={(id) => navigate('/project/' + id)} />}
  </div>
}

function ProjectList({ projects, empty }: { projects: Project[]; empty: string }) {
  if (!projects.length) return <div className="empty-state"><p>{empty}</p></div>
  return <ul className="project-grid">{projects.map((project) => <li key={project.id}>
    <Link className="project-card" to={'/project/' + project.id}>
      <div className="section-heading"><h3>{project.name}</h3><span className="status-badge">{project.status}</span></div>
      <p className="project-description">{project.description || 'No description yet.'}</p>
      <span className="muted">Updated <time dateTime={project.updated_at}>{new Date(project.updated_at).toLocaleDateString()}</time></span>
    </Link>
  </li>)}</ul>
}
