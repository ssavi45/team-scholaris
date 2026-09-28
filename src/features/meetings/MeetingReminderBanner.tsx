import { Link } from 'react-router'
import { Video, Bell, X, CalendarCheck, Clock } from 'lucide-react'
import { useMeetingReminders } from './use-meeting-reminders'

export function MeetingReminderBanner() {
  const { reminders, dismiss, notificationPermission, requestNotificationPermission } = useMeetingReminders()

  if (!reminders.length) return null

  return (
    <aside className="meeting-reminders-container" aria-label="Meeting reminders">
      {reminders.map((reminder) => {
        const joinLabel = reminder.meetingProvider === 'google' ? 'Join Google Meet' : 'Join Call'

        return (
          <div
            key={reminder.id}
            className={`meeting-reminder-bar ${reminder.isNow ? 'is-now' : 'is-soon'}`}
            role="alert"
          >
            <div className="meeting-reminder-info">
              <span className={`meeting-pulse-pill ${reminder.isNow ? 'pulse-live' : 'pulse-soon'}`}>
                <span className="meeting-pulse-dot" aria-hidden="true" />
                {reminder.isNow ? 'Happening Now' : `In ${reminder.minutesUntil}m`}
              </span>

              <div className="meeting-reminder-text">
                <strong className="meeting-reminder-title">{reminder.title}</strong>
                <span className="meeting-reminder-time">
                  <Clock size={12} aria-hidden="true" />
                  {reminder.formattedTime}
                </span>
              </div>
            </div>

            <div className="meeting-reminder-actions">
              {reminder.safeUrl && (
                <a
                  href={reminder.safeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="button primary compact-button meeting-join-btn"
                >
                  <Video size={14} aria-hidden="true" />
                  <span>{joinLabel}</span>
                </a>
              )}

              <Link
                to={`/project/${reminder.projectId}/meetings?meeting=${reminder.id}`}
                className="button secondary compact-button meeting-details-btn"
              >
                <CalendarCheck size={14} aria-hidden="true" />
                <span>Details</span>
              </Link>

              {notificationPermission === 'default' && (
                <button
                  type="button"
                  className="button secondary compact-button meeting-bell-btn"
                  onClick={() => void requestNotificationPermission()}
                  title="Turn on desktop notifications for meeting alerts"
                >
                  <Bell size={14} aria-hidden="true" />
                  <span className="desktop-only-text">Alerts</span>
                </button>
              )}

              <button
                type="button"
                className="meeting-dismiss-btn"
                onClick={() => dismiss(reminder.id)}
                aria-label={`Dismiss reminder for ${reminder.title}`}
                title="Dismiss"
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>
          </div>
        )
      })}
    </aside>
  )
}
