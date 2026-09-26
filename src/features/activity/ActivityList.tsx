import { Link } from 'react-router'
import { FileText, FolderOpen, Users, MessageSquare, ClipboardList, Sprout, ArrowUpRight, CalendarDays } from 'lucide-react'
import { activityCategories, activityDetail, activityLabel } from './activity-types'
import type { ActivityEvent } from './activity-types'

const icons = { paper: FileText, files: FolderOpen, team: Users, chat: MessageSquare, tasks: ClipboardList, project: Sprout, meetings: CalendarDays }
export function ActivityList({ events, projectId }: { events: ActivityEvent[]; projectId: string }) {
  return <ol className="activity-timeline">{events.map((event) => {
    const Icon = icons[event.category] ?? Sprout
    const detail = activityDetail(event)
    const destination = event.category === 'project' ? `/project/${projectId}` : `/project/${projectId}/${event.category}${event.category === 'meetings' ? `?meeting=${event.entity_id}` : ''}`
    return <li key={event.id} className="activity-event">
      <span className={`activity-event-icon activity-icon-${event.category}`} aria-hidden="true"><Icon size={17} /></span>
      <div className="activity-event-body"><div className="activity-event-byline"><strong>{event.actor_name}</strong><span className="activity-category">{activityCategories[event.category] ?? 'Project'}</span>{event.owner_only && <span className="activity-private">Owner only</span>}</div>
        <p className="activity-event-label">{activityLabel(event)}</p>{detail && <p className="activity-event-detail">{detail}</p>}
        <time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>
        {!event.target_exists && <span className="activity-unavailable">Item no longer available</span>}
      </div>
      {event.target_exists && <Link className="activity-open" to={destination} aria-label={`Open ${activityCategories[event.category]} workspace for ${activityLabel(event)}${detail ? `: ${detail}` : ''}`}>Open {activityCategories[event.category]}<ArrowUpRight size={13} aria-hidden="true" /></Link>}
    </li>
  })}</ol>
}
