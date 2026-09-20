import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { CheckCheck, ClipboardList, Plus, RefreshCw, Search } from 'lucide-react'
import { ProjectTabShell } from '../../components/layout/ProjectTabShell'
import { useAuth } from '../auth/auth-context'
import { getTeam, type TeamMember } from '../invitations/invitations-api'
import { loadProject } from '../projects/projects-api'
import { deleteTask, loadTasks, loadTaskSummary, saveTask, TASK_PAGE_SIZE, type TaskDraft } from './tasks-api'
import { dueLabel, isOverdue, localDate, taskPriorities, taskStatuses } from './task-types'
import type { Task, TaskFilter, TaskPriority, TaskStatus, TaskSummary } from './task-types'

const filters: Record<TaskFilter, string> = { all: 'All tasks', open: 'Open', mine: 'Assigned to me', unassigned: 'Unassigned', overdue: 'Overdue', completed: 'Completed' }
type Data = NonNullable<Awaited<ReturnType<typeof loadProject>>> & { team: TeamMember[]; tasks: Task[]; count: number; summary: TaskSummary }

export function TasksPage() {
  const { projectId = '' } = useParams()
  const { user } = useAuth()
  return <TasksWorkspace key={`${projectId}:${user?.id}`} projectId={projectId} userId={user?.id ?? ''} />
}

function TasksWorkspace({ projectId, userId }: { projectId: string; userId: string }) {
  const [params, setParams] = useSearchParams()
  const requestedFilter = params.get('filter') ?? 'all'
  const filter: TaskFilter = Object.hasOwn(filters, requestedFilter) ? requestedFilter as TaskFilter : 'all'
  const pageNumber = Number(params.get('page') ?? 0)
  const page = Number.isSafeInteger(pageNumber) && pageNumber >= 0 && pageNumber <= 100000 ? pageNumber : 0
  const search = (params.get('q') ?? '').slice(0, 160)
  const [state, setState] = useState<{ data: Data | null; error: string; loading: boolean }>({ data: null, error: '', loading: true })
  const [attempt, setAttempt] = useState(0)
  const [today, setToday] = useState(localDate)
  const [dialog, setDialog] = useState<{ task: Task | null } | null>(null)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const project = await loadProject(projectId, controller.signal)
        if (!project) { if (!controller.signal.aborted) setState({ data: null, loading: false, error: '' }); return }
        const [team, list, summary] = await Promise.all([getTeam(projectId, controller.signal), loadTasks(projectId, userId, filter, search, page, controller.signal, today), loadTaskSummary(projectId, controller.signal, today)])
        if (!controller.signal.aborted) setState({ data: { ...project, team, ...list, summary }, loading: false, error: '' })
      } catch (cause) {
        if (!controller.signal.aborted) setState({ data: null, loading: false, error: cause instanceof Error ? cause.message : 'Unable to load tasks.' })
      }
    }
    void load()
    return () => controller.abort()
  }, [projectId, userId, filter, search, page, attempt, today])

  useEffect(() => {
    const refresh = () => { if (!dialog) { setState((s) => ({ ...s, loading: true })); setAttempt((n) => n + 1) } }
    window.addEventListener('focus', refresh)
    const midnight = window.setInterval(() => { if (!dialog) setToday(localDate()) }, 60000)
    return () => { window.removeEventListener('focus', refresh); window.clearInterval(midnight) }
  }, [dialog])

  function refresh() { setState((s) => ({ ...s, loading: true })); setAttempt((n) => n + 1) }
  function navigateFilter(nextFilter: TaskFilter, nextPage = 0, nextSearch = search) {
    setState((s) => ({ ...s, loading: true }))
    setParams({ filter: nextFilter, ...(nextPage ? { page: String(nextPage) } : {}), ...(nextSearch ? { q: nextSearch } : {}) })
    // Also refresh when the same filter/search is submitted.
    setAttempt((n) => n + 1)
  }

  if (!state.data) return <div className="project-tab-container"><Link to="/app" className="back-link">Back to dashboard</Link><div className="empty-state">{state.loading ? <p role="status">Loading project tasks...</p> : state.error ? <><p role="alert">{state.error}</p><button className="button secondary compact-button" onClick={refresh}>Try again</button></> : <><h1>Project unavailable</h1><p>This project does not exist or you no longer have access.</p></>}</div></div>
  const { project, team, tasks, count, summary } = state.data
  const mine = team.find((m) => m.user_id === userId)
  const writable = project.status === 'active' && (mine?.access_level === 'owner' || mine?.access_level === 'member')
  const owner = mine?.access_level === 'owner'

  return <ProjectTabShell projectId={projectId} projectName={project.name} projectStatus={project.status} activeTab="tasks" isArchived={project.status === 'archived'}>
    <div className="tasks-heading"><div><p className="eyebrow">TURN IDEAS INTO PROGRESS</p><h2>Research tasks</h2><p className="muted">A shared place for the next steps in your research.</p></div><div className="tasks-heading-actions"><button className="button secondary compact-button" disabled={state.loading} onClick={refresh}><RefreshCw size={15} aria-hidden="true" />Refresh</button>{writable && <button className="button primary compact-button" disabled={state.loading} onClick={() => setDialog({ task: null })}><Plus size={16} aria-hidden="true" />New task</button>}</div></div>
    <div className="tasks-summary" aria-label="Task summary">{([['open', summary.open_count, 'Open tasks'], ['mine', summary.mine_count, 'Assigned to you'], ['overdue', summary.overdue_count, 'Overdue'], ['completed', summary.done_count, 'Completed']] as const).map(([value, total, label]) => <button key={value} className={`tasks-summary-card${value === 'overdue' && total ? ' tasks-summary-warning' : ''}`} disabled={state.loading} onClick={() => navigateFilter(value, 0, '')}><span>{label}</span><strong>{total}</strong></button>)}</div>
    {message && <p className="notice" role="status">{message}</p>}
    {!writable && project.status !== 'archived' && <p className="notice">You have read-only access. Open any task to view its details.</p>}
    <section className="tasks-list-panel" aria-label="Research tasks" aria-busy={state.loading}>
      <div className="tasks-filters"><div className="tasks-filter-buttons" role="group" aria-label="Filter tasks">{(Object.entries(filters) as [TaskFilter, string][]).map(([key, label]) => <button key={key} type="button" aria-pressed={filter === key} disabled={state.loading} onClick={() => navigateFilter(key)}>{label}</button>)}</div>
        <form key={search} className="tasks-search" onSubmit={(e) => { e.preventDefault(); navigateFilter(filter, 0, String(new FormData(e.currentTarget).get('q') ?? '').trim()) }}><label className="sr-only" htmlFor="task-search">Search task titles</label><input id="task-search" name="q" type="search" placeholder="Search task titles" defaultValue={search} maxLength={160} /><button className="button secondary compact-button" disabled={state.loading} aria-label="Search tasks"><Search size={16} aria-hidden="true" /></button></form>
      </div>
      <p className="tasks-result-count" role="status">{state.loading ? 'Refreshing tasks...' : `${count} ${count === 1 ? 'task' : 'tasks'}${search ? ` matching “${search}”` : ''}`}</p>
      {tasks.length ? <ul className="task-list">{tasks.map((task) => <li key={task.id}><button className="task-row" disabled={state.loading} onClick={() => setDialog({ task })}>
        <span className={`task-state-icon task-state-${task.status}`} aria-hidden="true">{task.status === 'done' ? <CheckCheck size={18} /> : <ClipboardList size={18} />}</span>
        <span className="task-row-main"><strong>{task.title}</strong><span className="task-row-meta"><span>{task.assignee_id ? task.assignee_name || 'Former teammate' : 'Unassigned'}</span>{task.due_date && <time dateTime={task.due_date} className={isOverdue(task, today) ? 'task-overdue' : ''}>{isOverdue(task, today) ? 'Overdue · ' : 'Due '}{dueLabel(task.due_date)}</time>}</span></span>
        <span className={`task-priority task-priority-${task.priority}`}>{taskPriorities[task.priority]} priority</span><span className={`task-status task-status-${task.status}`}>{taskStatuses[task.status]}</span>
      </button></li>)}</ul> : <div className="tasks-empty"><ClipboardList size={30} aria-hidden="true" /><h3>{summary.open_count + summary.done_count === 0 ? 'Every research project starts with a next step' : 'No tasks match this view'}</h3><p>{summary.open_count + summary.done_count === 0 ? writable ? 'Create a task, assign a collaborator, and keep your work moving.' : 'Tasks will appear here when your team creates them.' : 'Choose another filter or clear your search to see more work.'}</p>{(filter !== 'all' || search || page) && <button className="button secondary compact-button" onClick={() => navigateFilter('all', 0, '')}>Show all tasks</button>}</div>}
      {(page > 0 || count > TASK_PAGE_SIZE) && <div className="tasks-pagination"><button className="button secondary compact-button" disabled={!page || state.loading} onClick={() => navigateFilter(filter, page - 1)}>Previous</button><span>Page {page + 1} · {count} tasks</span><button className="button secondary compact-button" disabled={(page + 1) * TASK_PAGE_SIZE >= count || state.loading} onClick={() => navigateFilter(filter, page + 1)}>Next</button></div>}
    </section>
    <p className="form-note tasks-permissions">Owners manage all tasks. Creators edit their own tasks; assignees can update status. Assigned to me and Unassigned show unfinished work.</p>
    {dialog && <TaskDialog projectId={projectId} task={dialog.task} team={team} fullEdit={!!writable && (!dialog.task || owner || dialog.task.created_by === userId)} statusEdit={!!writable && (!!owner || !dialog.task || dialog.task.created_by === userId || dialog.task.assignee_id === userId)} close={() => setDialog(null)} saved={(deleted) => { setDialog(null); setMessage(deleted ? 'Task deleted. Its activity history has been retained.' : 'Task saved.'); navigateFilter(filter, 0) }} />}
  </ProjectTabShell>
}

function TaskDialog({ projectId, task, team, fullEdit, statusEdit, close, saved }: { projectId: string; task: Task | null; team: TeamMember[]; fullEdit: boolean; statusEdit: boolean; close: () => void; saved: (deleted: boolean) => void }) {
  const node = useRef<HTMLDialogElement>(null)
  const inFlight = useRef(false)
  const [id] = useState(() => task?.id ?? crypto.randomUUID())
  const [initial] = useState<TaskDraft>(() => task ? { title: task.title, description: task.description, assignee_id: task.assignee_id, status: task.status, priority: task.priority, due_date: task.due_date } : { title: '', description: '', assignee_id: null, status: 'todo', priority: 'normal', due_date: null })
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const eligible = team.filter((m) => m.access_level !== 'viewer')
  const formerAssignee = !!draft.assignee_id && !eligible.some((m) => m.user_id === draft.assignee_id)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  useEffect(() => { const dialog = node.current!; dialog.showModal(); return () => dialog.close() }, [])
  useEffect(() => {
    if (!dirty && !busy) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    const signOut = (e: Event) => {
      if (inFlight.current || (dirty && !window.confirm('Sign out and discard your unsaved task changes?'))) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    window.addEventListener('scholaris:before-sign-out', signOut)
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener('scholaris:before-sign-out', signOut) }
  }, [dirty, busy])
  function dismiss() { if (!inFlight.current && (!dirty || window.confirm('Discard your unsaved task changes?'))) close() }
  async function submit(deleting = false) {
    if (inFlight.current || (deleting ? !fullEdit || !task : !statusEdit)) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      if (deleting && task) await deleteTask(projectId, task)
      else await saveTask(projectId, id, task?.revision ?? 0, draft)
      saved(deleting)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save task.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  return <dialog ref={node} className="project-dialog task-dialog" aria-labelledby="task-dialog-title" onCancel={(e) => { e.preventDefault(); dismiss() }}>
    <form onSubmit={(e) => { e.preventDefault(); if (!confirmDelete) void submit() }} aria-busy={busy}>
      <div className="task-dialog-heading"><div><p className="eyebrow">RESEARCH TASK</p><h2 id="task-dialog-title">{task ? statusEdit ? 'Task details' : 'View task' : 'Create a task'}</h2></div><button type="button" className="button secondary compact-button" onClick={dismiss} disabled={busy} autoFocus>Close</button></div>
      {task && <p className="form-note">Created by {task.creator_name || 'Former teammate'} · {new Date(task.created_at).toLocaleDateString()}{task.completed_at && ` · Completed ${new Date(task.completed_at).toLocaleDateString()}`}</p>}
      {confirmDelete ? <div className="notice error-notice"><h3>Delete this task?</h3><p>The task will leave the list. Its activity record will remain.</p><div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep task</button><button type="button" className="button team-danger-button" disabled={busy} onClick={() => void submit(true)}>{busy ? 'Deleting...' : 'Delete task'}</button></div></div> : <>
        <label>Title<input required maxLength={160} value={draft.title} readOnly={!fullEdit} disabled={busy} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Review related work on video datasets" /></label>
        <label>Description <span className="muted">Optional</span><textarea rows={4} maxLength={5000} value={draft.description} readOnly={!fullEdit} disabled={busy} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Describe the outcome and any useful context." /></label>
        <div className="task-form-grid"><label>Status<select value={draft.status} disabled={!statusEdit || busy} onChange={(e) => setDraft({ ...draft, status: e.target.value as TaskStatus, assignee_id: formerAssignee && e.target.value !== 'done' ? null : draft.assignee_id })}>{Object.entries(taskStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Priority<select value={draft.priority} disabled={!fullEdit || busy} onChange={(e) => setDraft({ ...draft, priority: e.target.value as TaskPriority })}>{Object.entries(taskPriorities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Assignee<select value={draft.assignee_id ?? ''} disabled={!fullEdit || busy} onChange={(e) => setDraft({ ...draft, assignee_id: e.target.value || null })}><option value="">Unassigned</option>{formerAssignee && <option value={draft.assignee_id!} disabled>{task?.assignee_name || 'Former teammate'} (no editing access)</option>}{eligible.map((member) => <option key={member.user_id} value={member.user_id}>{member.name || 'Teammate'}</option>)}</select></label>
          <label>Due date <span className="muted">Optional</span><input type="date" min="1900-01-01" max="9999-12-31" value={draft.due_date ?? ''} readOnly={!fullEdit} disabled={busy} onChange={(e) => setDraft({ ...draft, due_date: e.target.value || null })} /></label>
        </div>
        {statusEdit && !fullEdit && <p className="form-note">You can update this task's status. Its creator and the project owner manage other details.</p>}
        {formerAssignee && fullEdit && <p className="form-note">Reopening will leave this task unassigned because its previous assignee no longer has editing access.</p>}
        <div className="dialog-actions">{task && fullEdit && <button type="button" className="button secondary task-delete-action" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete task</button>}{statusEdit && <button type="submit" className="button primary" disabled={busy || !draft.title.trim() || (!!task && !dirty)}>{busy ? 'Saving...' : task ? 'Save changes' : 'Create task'}</button>}</div>
      </>}
      {error && <p className="notice error-notice" role="alert">{error}</p>}
    </form>
  </dialog>
}
