export const activityCategories = { project: 'Project', paper: 'Paper', files: 'Files', team: 'Team', chat: 'Chat', tasks: 'Tasks', meetings: 'Meetings' }
export type ActivityCategory = keyof typeof activityCategories
export type ActivityEvent = {
  id: string; actor_id: string | null; actor_name: string; event_type: string
  category: ActivityCategory; entity_id: string; metadata: Record<string, unknown>
  created_at: string; target_exists: boolean; owner_only: boolean
}
export type ActivityCursor = { at: string; id: string }
export type ActivityFilters = { category: string; actor: string; from: string; to: string }
export const emptyActivityFilters: ActivityFilters = { category: '', actor: '', from: '', to: '' }
const eventLabels: Record<string, string> = {
  'meeting.created': 'Scheduled a meeting', 'meeting.updated': 'Updated a meeting',
  'meeting.cancelled': 'Cancelled a meeting', 'meeting.notes_updated': 'Updated shared meeting notes',
  'project.created': 'Created the project', 'project.updated': 'Updated project details',
  'project.archived': 'Archived the project', 'project.unarchived': 'Unarchived the project',
  'project.deleted': 'Deleted the project', 'project.restored': 'Restored the project',
  'project.ownership_transferred': 'Transferred project ownership',
  'team.joined': 'Added a teammate', 'team.left': 'Left the project', 'team.removed': 'Removed a teammate',
  'team.access_changed': 'Changed teammate access', 'team.role_changed': 'Updated a research role',
  'invitation.created': 'Created an invitation', 'invitation.accepted': 'Accepted an invitation', 'invitation.revoked': 'Revoked an invitation',
  'file.added': 'Added a file', 'file.renamed': 'Renamed a file', 'file.deleted': 'Deleted a file',
  'chat.posted': 'Posted a message', 'chat.deleted': 'Deleted a message',
  'paper.initialized': 'Started the paper workspace', 'paper.updated': 'Updated the paper workspace',
  'task.created': 'Created a task', 'task.updated': 'Updated a task', 'task.status_changed': 'Changed task status',
  'task.unassigned': 'Unassigned a task', 'task.deleted': 'Deleted a task',
}
const statuses: Record<string, string> = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' }
const channels: Record<string, string> = { discussion: 'Project Discussion', announcements: 'Announcements', ideas: 'Ideas & References', experiments: 'Experiments', general: 'General' }
export function activityLabel(event: ActivityEvent) {
  if (event.event_type === 'team.joined' && event.actor_id === event.entity_id) return 'Joined the project'
  return eventLabels[event.event_type] ?? 'Updated the project'
}
export function activityDetail(event: ActivityEvent) {
  const { title, status, channel, access } = event.metadata
  const parts: string[] = []
  if (typeof title === 'string' && title.trim()) parts.push(title)
  if (event.category === 'tasks' && typeof status === 'string' && statuses[status]) parts.push(statuses[status])
  if (event.category === 'chat' && typeof channel === 'string') parts.push(channels[channel] ?? 'Project chat')
  if (event.event_type === 'team.access_changed' && typeof access === 'string') parts.push(access)
  return parts.join(' · ')
}

// Date filters are local calendar days, sent as half-open UTC boundaries. Using
// next-day midnight handles 23/25-hour daylight-saving days correctly.
export function activityDateBoundary(value: string, nextDay = false) {
  if (!value) return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Choose a valid date range.')
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  if (year < 1900 || year > 9998 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) throw new Error('Choose a valid date range.')
  if (nextDay) date.setDate(date.getDate() + 1)
  return date.toISOString()
}
