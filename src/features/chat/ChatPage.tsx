import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useParams } from 'react-router'
import {
  ArrowLeft,
  MessageSquare,
  Megaphone,
  Lightbulb,
  FlaskConical,
  Hash,
  Paperclip,
  Trash2,
  Send,
  UserPlus,
  FileText,
  AlertCircle,
  RefreshCw,
} from 'lucide-react'
import { useAuth } from '../auth/auth-context'
import { loadProject } from '../projects/projects-api'
import { getTeam, type TeamMember } from '../invitations/invitations-api'
import { ProjectTabShell } from '../../components/layout/ProjectTabShell'
import {
  deleteProjectMessage,
  loadProjectMessages,
  sendProjectMessage,
  subscribeProjectChat,
  type ProjectMessage,
  type ChatConnection,
} from './chat-api'

interface ChannelConfig {
  id: string
  title: string
  subtext: string
  icon: typeof MessageSquare
  about: string
}

const CHANNELS: ChannelConfig[] = [
  {
    id: 'discussion',
    title: 'Project Discussion',
    subtext: 'Real-time collaboration',
    icon: MessageSquare,
    about: 'Open discussion for research, ideas, progress updates, and collaboration on the project.',
  },
  {
    id: 'announcements',
    title: 'Announcements',
    subtext: 'Project updates & milestones',
    icon: Megaphone,
    about: 'Official project updates, milestones, deadlines, and important group notices.',
  },
  {
    id: 'ideas',
    title: 'Ideas & References',
    subtext: 'Papers, links, and ideas',
    icon: Lightbulb,
    about: 'Literature notes, external paper links, hypotheses, and exploratory concepts.',
  },
  {
    id: 'experiments',
    title: 'Experiments',
    subtext: 'Results and analysis',
    icon: FlaskConical,
    about: 'Experimental protocol discussions, benchmark datasets, model evaluations, and empirical data analysis.',
  },
  {
    id: 'general',
    title: 'General',
    subtext: 'Miscellaneous discussion',
    icon: Hash,
    about: 'Informal discussions, schedule syncing, and general co-author communication.',
  },
]

const AVATAR_PALETTES = [
  { bg: '#dcfce7', text: '#166534' }, // Soft sage green (SS)
  { bg: '#fee2e2', text: '#991b1b' }, // Soft coral (AS)
  { bg: '#e0e7ff', text: '#3730a3' }, // Soft lavender blue (DS)
  { bg: '#fef3c7', text: '#92400e' }, // Warm amber
  { bg: '#f3e8ff', text: '#6b21a8' }, // Soft purple
]

function getAvatarColor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  const index = Math.abs(hash) % AVATAR_PALETTES.length
  return AVATAR_PALETTES[index]
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 0 || !parts[0]) return 'SC'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function formatMessageDate(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return 'Today'

  const yesterday = new Date()
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatMessageTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export function ChatPage() {
  const { projectId = '' } = useParams()
  const { user } = useAuth()
  return <ChatWorkspace key={`${projectId}:${user?.id}`} projectId={projectId} />
}

function ChatWorkspace({ projectId }: { projectId: string }) {
  const { user } = useAuth()
  const [activeChannelId, setActiveChannelId] = useState<string>('discussion')
  const [projectData, setProjectData] = useState<Awaited<ReturnType<typeof loadProject>> | null>(null)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [messages, setMessages] = useState<ProjectMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const draft = drafts[activeChannelId] ?? ''
  const setDraft = (value: string) => setDrafts((previous) => ({ ...previous, [activeChannelId]: value }))
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [connection, setConnection] = useState<ChatConnection>('connecting')
  const sendingRef = useRef(false)
  const refreshRef = useRef<() => void>(() => {})

  const streamRef = useRef<HTMLDivElement>(null)
  const followLatest = useRef(true)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const activeChannel = useMemo(
    () => CHANNELS.find((c) => c.id === activeChannelId) || CHANNELS[0],
    [activeChannelId]
  )

  const scrollToBottom = (smooth = false) => {
    const stream = streamRef.current
    if (stream && followLatest.current) stream.scrollTo({ top: stream.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }

  // Serialize snapshot refreshes so a slower initial response cannot overwrite
  // a newer message. Reconcile after subscribing, reconnecting, and refocusing.
  useEffect(() => {
    const controller = new AbortController()
    let running = false
    let queued = false
    const deleted = new Set<string>()
    async function refresh() {
      if (controller.signal.aborted) return
      if (running) { queued = true; return }
      running = true
      do {
        queued = false
        try {
          const [proj, team, messageList] = await Promise.all([
            loadProject(projectId, controller.signal),
            getTeam(projectId, controller.signal).catch(() => []),
            loadProjectMessages(projectId, 100, controller.signal, activeChannelId),
          ])
          if (controller.signal.aborted) return
          setProjectData(proj)
          setTeamMembers(team)
          setMessages(messageList.filter((message) => !deleted.has(message.id)))
          setError('')
        } catch (err) {
          if (controller.signal.aborted) return
          setMessages([])
          setProjectData(null)
          setError(err instanceof Error ? err.message : 'Unable to load project chat.')
        } finally {
          if (!controller.signal.aborted) setLoading(false)
        }
      } while (queued && !controller.signal.aborted)
      running = false
    }
    const requestRefresh = () => { void refresh() }
    refreshRef.current = requestRefresh
    const unsubscribe = subscribeProjectChat(
      projectId,
      requestRefresh,
      (deletedId) => {
        deleted.add(deletedId)
        setMessages((prev) => prev.filter((m) => m.id !== deletedId))
      },
      setConnection,
    )
    requestRefresh()
    window.addEventListener('focus', requestRefresh)
    return () => {
      controller.abort()
      unsubscribe()
      window.removeEventListener('focus', requestRefresh)
    }
  }, [projectId, activeChannelId, attempt])

  useEffect(() => { scrollToBottom() }, [messages])
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    function resize() {
      if (!textarea) return
      textarea.style.height = '0px'
      const height = Math.max(36, Math.min(textarea.scrollHeight, 124))
      textarea.style.height = `${height}px`
      textarea.style.overflowY = textarea.scrollHeight > 124 ? 'auto' : 'hidden'
      scrollToBottom()
    }
    resize()
    // Wrapped text must reflow when the conversation column changes width.
    let width = textarea.getBoundingClientRect().width
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === width) return
      width = entry.contentRect.width
      resize()
    })
    observer.observe(textarea)
    return () => observer.disconnect()
  }, [draft, loading, sending])

  const isOwner = projectData?.project.owner_id === user?.id
  const isArchived = projectData?.project.status === 'archived'
  const myMembership = projectData?.members.find((m) => m.user_id === user?.id)
  const canWrite = !loading && !error && !isArchived && !!user && (myMembership?.access_level === 'owner' || myMembership?.access_level === 'member')

  // Fallback member list if getTeam has fewer records
  const displayMembers = useMemo(() => {
    if (teamMembers.length > 0) return teamMembers
    if (!projectData) return []
    return projectData.members.map((m) => ({
      user_id: m.user_id,
      name: m.user_id === user?.id ? (user?.user_metadata?.name || 'You') : 'Scholar',
      access_level: m.access_level,
      display_role: m.display_role,
    }))
  }, [teamMembers, projectData, user])

  async function handleSend(e?: FormEvent) {
    if (e) e.preventDefault()
    if (!canWrite || sendingRef.current || !draft.trim()) return

    sendingRef.current = true
    setSending(true)
    setSendError('')
    try {
      await sendProjectMessage(projectId, draft, activeChannelId)
      setDraft('')
      followLatest.current = true
      refreshRef.current()
      textareaRef.current?.focus()
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send message.')
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void handleSend()
    }
  }

  async function handleDelete(messageId: string) {
    if (!window.confirm('Delete this message for everyone in the project?')) return
    try {
      await deleteProjectMessage(messageId)
      setMessages((prev) => prev.filter((m) => m.id !== messageId))
    } catch (err) {
      alert(`Failed to delete message: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  // Group messages by day
  const groupedMessages = useMemo(() => {
    return messages.reduce<Record<string, ProjectMessage[]>>((acc, msg) => {
      const day = formatMessageDate(msg.created_at)
      if (!acc[day]) acc[day] = []
      acc[day].push(msg)
      return acc
    }, {})
  }, [messages])

  if (loading) {
    return (
      <div className="project-tab-container">
        <Link to="/app" className="back-link">
          <ArrowLeft size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
          Back to dashboard
        </Link>
        <p className="empty-state" role="status">Opening research collaboration workbench...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="project-tab-container">
        <Link to="/app" className="back-link">
          <ArrowLeft size={13} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
          Back to dashboard
        </Link>
        <div className="empty-state" role="alert">
          <p>{error}</p>
          <button
            className="button secondary compact-button"
            onClick={() => {
              setLoading(true)
              setError('')
              setAttempt((a) => a + 1)
            }}
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (!projectData) {
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
      projectId={projectId}
      projectName={projectData.project.name}
      projectStatus={projectData.project.status}
      activeTab="chat"
      categoryLabel="PROJECT DISCUSSION"
      isArchived={isArchived}
    >
      {/* 3-Column Collaborative Grid */}
      <div className="chat-layout-grid">
            {/* Column 1: Channels Navigation */}
            <aside className="chat-channels-card" aria-label="Discussion channels">
              {CHANNELS.map((chan) => {
                const IconComponent = chan.icon
                const isActive = chan.id === activeChannelId

                return (
                  <button
                    key={chan.id}
                    type="button"
                    className={`chat-channel-button ${isActive ? 'active' : ''}`}
                    disabled={sending}
                    onClick={() => {
                      if (sendingRef.current || chan.id === activeChannelId) return
                      followLatest.current = true
                      setLoading(true)
                      setMessages([])
                      setSendError('')
                      setConnection('connecting')
                      setActiveChannelId(chan.id)
                    }}
                    aria-pressed={isActive}
                  >
                    <div className="chat-channel-icon-wrap">
                      <IconComponent size={17} />
                    </div>
                    <div className="chat-channel-info">
                      <p className="chat-channel-title">{chan.title}</p>
                      <p className="chat-channel-subtext">{chan.subtext}</p>
                    </div>
                  </button>
                )
              })}
            </aside>

            {/* Column 2: Main Chat Conversation Card */}
            <main className="chat-feed-card" aria-label={`${activeChannel.title} stream`}>
              {/* Channel Top Bar */}
              <header className="chat-feed-header">
                <div className="chat-feed-header-left">
                  <div className="chat-header-circle-icon">
                    <activeChannel.icon size={19} />
                  </div>
                  <div className="chat-header-heading-area">
                    <h2 className="chat-header-channel-name">{activeChannel.title}</h2>
                    <span className="chat-header-online-status" data-connection={connection} role="status">
                      <span className="chat-connection-dot" aria-hidden="true" />
                      {connection === 'connected' ? 'Live updates connected' : connection === 'connecting' ? 'Connecting…' : 'Disconnected · refresh to sync'}
                    </span>
                  </div>
                </div>

                <div className="chat-feed-header-right">
                  {/* Overlapping Avatar Stack */}
                  <div className="chat-avatar-stack" title="Project co-authors">
                    {displayMembers.slice(0, 4).map((member) => {
                      const colors = getAvatarColor(member.name)
                      return (
                        <div
                          key={member.user_id}
                          className="chat-stack-avatar"
                          style={{ backgroundColor: colors.bg, color: colors.text }}
                          title={`${member.name} (${member.access_level})`}
                        >
                          {getInitials(member.name)}
                        </div>
                      )
                    })}
                    {isOwner && <Link
                      to={`/project/${projectId}/team`}
                      className="chat-stack-add-btn"
                      title="Invite co-author"
                      aria-label="Invite co-author"
                    >
                      +
                    </Link>}
                  </div>

                  <div className="chat-header-tools-divider" />

                  {/* Actions Toolbar */}
                  <Link to={`/project/${projectId}/files`} className="chat-header-tool-btn" title="Open project files" aria-label="Open project files">
                    <Paperclip size={16} />
                  </Link>
                  <button type="button" className="chat-header-tool-btn" title="Refresh conversation" aria-label="Refresh conversation" onClick={() => refreshRef.current()}><RefreshCw size={16} /></button>
                </div>
              </header>

              {/* Message Feed Stream */}
              <div ref={streamRef} className="chat-stream-body" role="log" aria-live="polite" onScroll={(event) => {
                const stream = event.currentTarget
                followLatest.current = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 80
              }}>
                {messages.length === 100 && <p className="muted">Showing the latest 100 messages in this channel.</p>}
                {messages.length === 0 ? (
                  <div className="empty-chat-state">
                    <div className="empty-chat-icon-wrap">
                      <activeChannel.icon size={36} style={{ color: '#2d6549' }} />
                    </div>
                    <h3>Start the conversation</h3>
                    <p className="muted">{activeChannel.about}</p>
                    <div className="chat-starter-tip">
                      <span>{canWrite ? 'Share a question, an update, or an idea with your team.' : 'Messages from your team will appear here.'}</span>
                    </div>
                  </div>
                ) : (
                  Object.entries(groupedMessages).map(([day, dayMsgs]) => (
                    <div key={day} className="chat-day-section">
                      <div className="chat-stream-day-divider">
                        <span className="chat-stream-day-pill">{day}</span>
                      </div>

                      {dayMsgs.map((msg) => {
                        const isMine = msg.sender_id === user?.id
                        const canDelete = canWrite && (isMine || isOwner)
                        const avatarColors = getAvatarColor(msg.sender_name)

                        return (
                          <div
                            key={msg.id}
                            className={`chat-row ${isMine ? 'mine' : 'teammate'}`}
                          >
                            {!isMine && (
                              <div
                                className="chat-msg-avatar"
                                style={{ backgroundColor: avatarColors.bg, color: avatarColors.text }}
                                aria-hidden="true"
                              >
                                {getInitials(msg.sender_name)}
                              </div>
                            )}

                            <div className="chat-msg-package">
                              <div className="chat-msg-header">
                                <span className="chat-msg-sender">{msg.sender_name}</span>
                                <time className="chat-msg-time" dateTime={msg.created_at} title={new Date(msg.created_at).toLocaleString()}>
                                  {formatMessageTime(msg.created_at)}
                                </time>
                              </div>

                              <div className="chat-bubble">{msg.content}</div>

                              <div className="chat-msg-footer">
                                {isMine && (
                                  <span className="chat-read-receipt">Sent</span>
                                )}

                                {canDelete && (
                                  <button
                                    type="button"
                                    className="chat-delete-action"
                                    onClick={() => void handleDelete(msg.id)}
                                    title="Delete message"
                                    aria-label="Delete message"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                )}
                              </div>
                            </div>

                            {isMine && (
                              <div
                                className="chat-msg-avatar"
                                style={{ backgroundColor: avatarColors.bg, color: avatarColors.text }}
                                aria-hidden="true"
                              >
                                {getInitials(msg.sender_name)}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  ))
                )}
              </div>

              {/* Composer */}
              {canWrite ? (
                <div className="chat-composer-section">
                  {sendError && (
                    <div className="composer-error-alert" role="alert" style={{ marginBottom: 8 }}>
                      <AlertCircle size={14} />
                      <span>{sendError}</span>
                    </div>
                  )}

                  <form className="chat-composer-pill-box" aria-busy={sending} onSubmit={(e) => void handleSend(e)}>
                    <textarea
                      ref={textareaRef}
                      aria-label={`Message ${activeChannel.title}`}
                      aria-describedby="chat-composer-hint"
                      className="chat-composer-input"
                      placeholder="Write a message…"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={handleKeyDown}
                      rows={1}
                      maxLength={4000}
                      readOnly={sending}
                      autoFocus
                    />

                    <button
                      type="submit"
                      className="chat-composer-send-btn"
                      disabled={sending || !draft.trim()}
                      aria-label="Send message"
                    >
                      <Send size={15} aria-hidden="true" />
                      <span>{sending ? 'Sending...' : 'Send'}</span>
                    </button>
                  </form>
                  <div className="chat-composer-meta">
                    <span id="chat-composer-hint"><span className="chat-enter-hint">Enter to send · </span>Shift+Enter for a new line</span>
                    <span className={draft.length >= 3800 ? 'chat-character-count near-limit' : 'chat-character-count'} aria-label={`${draft.length} of 4000 characters`}>{draft.length.toLocaleString()} / 4,000</span>
                  </div>
                </div>
              ) : (
                <div className="chat-readonly-notice">
                  <p>
                    {isArchived
                      ? 'This project is archived. Discussions are read-only.'
                      : 'You have viewer access to this project. Chat participation is disabled.'}
                  </p>
                </div>
              )}
            </main>

            {/* Column 3: Context & Project Members Sidebar */}
            <aside className="chat-context-column" aria-label="Project context">
              {/* Card 1: Project Members */}
              <div className="chat-sidebar-card">
                <div className="chat-sidebar-card-header">
                  <div className="chat-sidebar-card-title-wrap">
                    <h3 className="chat-sidebar-card-title">Project Members</h3>
                    <span className="chat-sidebar-card-subtext">
                      {displayMembers.length} collaborator{displayMembers.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  {isOwner && <Link
                    to={`/project/${projectId}/team`}
                    className="chat-sidebar-invite-btn"
                    title="Invite teammate"
                  >
                    <UserPlus size={13} />
                    <span>Invite</span>
                  </Link>}
                </div>

                <div className="chat-members-list">
                  {displayMembers.map((member) => {
                    const colors = getAvatarColor(member.name)
                    return (
                      <div key={member.user_id} className="chat-member-row">
                        <div className="chat-member-left">
                          <div
                            className="chat-msg-avatar"
                            style={{
                              width: 32,
                              height: 32,
                              backgroundColor: colors.bg,
                              color: colors.text,
                            }}
                          >
                            {getInitials(member.name)}
                          </div>
                          <div className="chat-member-name-area">
                            <span className="chat-member-name" title={member.name}>
                              {member.name}
                            </span>
                            <span className="chat-member-status-line">
                              {member.access_level}
                            </span>
                          </div>
                        </div>

                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Card 2: About This Channel */}
              <div className="chat-sidebar-card chat-about-card">
                <div className="chat-about-header">
                  <FileText size={16} />
                  <span>About this channel</span>
                </div>
                <p className="chat-about-text">
                  {activeChannel.about.replace('the project', projectData.project.name)}
                </p>
              </div>

              {/* Card 3: Scholar Quote Card */}
              <div className="chat-quote-card">
                <div className="chat-quote-symbol" aria-hidden="true">
                  &ldquo;
                </div>
                <blockquote className="chat-quote-body">
                  &ldquo;Better research happens together.&rdquo;
                </blockquote>
                <p className="chat-quote-author">&mdash; Team Scholaris</p>
              </div>
            </aside>
          </div>
    </ProjectTabShell>
  )
}
