import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, GraduationCap } from 'lucide-react'

export interface ProjectTabShellProps {
  projectId: string
  projectName: string
  projectStatus: 'active' | 'archived'
  activeTab: 'overview' | 'files' | 'team' | 'chat' | 'tasks'
  categoryLabel?: string
  isArchived?: boolean
  children: ReactNode
}

export function ProjectTabShell({
  projectId,
  projectName,
  projectStatus,
  activeTab,
  categoryLabel,
  isArchived,
  children,
}: ProjectTabShellProps) {
  const defaultCategory =
    activeTab === 'overview'
      ? 'PROJECT OVERVIEW'
      : activeTab === 'files'
      ? 'PROJECT FILES'
      : activeTab === 'team'
      ? 'PROJECT TEAM'
      : activeTab === 'tasks'
      ? 'PROJECT TASKS'
      : 'PROJECT DISCUSSION'

  const category = categoryLabel || defaultCategory

  return (
    <div className="project-tab-container">
      <Link to="/app" className="back-link">
        <ArrowLeft size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
        Back to dashboard
      </Link>

      {/* Unified Hero Banner across all project tabs */}
      <div className="chat-hero-banner">
        <div className="chat-hero-wave-bg" aria-hidden="true" />
        <div className="chat-hero-top">
          <div className="chat-hero-title-area">
            <span className="chat-hero-category">{category}</span>
            <div className="chat-hero-title-row">
              <h1 className="chat-hero-title">{projectName}</h1>
              <span className={`chat-status-active-badge${projectStatus === 'archived' ? ' archived' : ''}`}>
                <span className="chat-active-dot" />
                {projectStatus === 'archived' ? 'Archived' : 'Active'}
              </span>
            </div>
          </div>

          <div className="chat-hero-badge-card" title="Scholar Collaboration Hub">
            <div className="chat-hero-badge-icon">
              <GraduationCap size={18} />
            </div>
            <div className="chat-hero-badge-text">
              <strong>Research together.</strong>
              <span>Build what matters.</span>
            </div>
          </div>
        </div>

        {isArchived && (
          <p className="notice">This project is archived and read-only.</p>
        )}

        {/* Unified Project Navigation Tabs */}
        <nav className="project-tabs" aria-label="Project">
          {activeTab === 'overview' ? (
            <span aria-current="page">Overview</span>
          ) : (
            <Link to={`/project/${projectId}`}>Overview</Link>
          )}
          <Link to={`/project/${projectId}/paper`}>Paper workspace</Link>
          {activeTab === 'files' ? (
            <span aria-current="page">Files</span>
          ) : (
            <Link to={`/project/${projectId}/files`}>Files</Link>
          )}
          {activeTab === 'team' ? (
            <span aria-current="page">Team</span>
          ) : (
            <Link to={`/project/${projectId}/team`}>Team</Link>
          )}
          {activeTab === 'chat' ? (
            <span aria-current="page">Chat</span>
          ) : (
            <Link to={`/project/${projectId}/chat`}>Chat</Link>
          )}
          {activeTab === 'tasks' ? <span aria-current="page">Tasks</span> : <Link to={`/project/${projectId}/tasks`}>Tasks</Link>}
        </nav>
      </div>

      {children}
    </div>
  )
}
