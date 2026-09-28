import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/auth-context'
import { safeMeetingUrl, viewerZone, meetingTime } from './meeting-types'

export type ScheduledMeetingReminder = {
  id: string
  projectId: string
  title: string
  startsAt: string
  endsAt: string
  timeZone: string
  joinUrl: string
  meetingProvider: 'external' | 'google'
  googleStatus: string | null
  isNow: boolean
  minutesUntil: number
  formattedTime: string
  safeUrl: string | null
}

function getDismissed(): Set<string> {
  try {
    const raw = sessionStorage.getItem('scholaris_dismissed_reminders')
    return new Set(raw ? JSON.parse(raw) : [])
  } catch {
    return new Set()
  }
}

function addDismissed(id: string) {
  try {
    const current = getDismissed()
    current.add(id)
    sessionStorage.setItem('scholaris_dismissed_reminders', JSON.stringify([...current]))
  } catch {
    // Ignore session storage errors
  }
}

function playReminderChime() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(587.33, now) // D5
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.15) // A5
    gain.gain.setValueAtTime(0.08, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.6)
  } catch {
    // Audio autoplay restrictions before user gesture can safely be ignored.
  }
}

export function useMeetingReminders() {
  const { user } = useAuth()
  const [reminders, setReminders] = useState<ScheduledMeetingReminder[]>([])
  const [dismissed, setDismissed] = useState<Set<string>>(() => getDismissed())
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(() =>
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'denied'
  )
  const notifiedRef = useRef<Set<string>>(new Set())
  const activeRemindersRef = useRef<ScheduledMeetingReminder[]>([])

  const requestNotificationPermission = useCallback(async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'denied'
    try {
      const permission = await Notification.requestPermission()
      setNotificationPermission(permission)
      return permission
    } catch {
      return 'denied'
    }
  }, [])

  const dismiss = useCallback((id: string) => {
    addDismissed(id)
    setDismissed((prev) => new Set([...prev, id]))
  }, [])

  useEffect(() => {
    if (!user || !supabase) return

    let cancelled = false
    const zone = viewerZone()

    async function checkMeetings() {
      if (cancelled || !supabase) return
      try {
        const now = new Date()
        // Query upcoming/current meetings ending in the future
        const { data, error } = await supabase
          .from('project_meetings')
          .select('id, project_id, title, starts_at, ends_at, time_zone, join_url, meeting_provider, google_status')
          .is('cancelled_at', null)
          .gte('ends_at', now.toISOString())
          .order('starts_at', { ascending: true })
          .limit(20)

        if (error || !data || cancelled) return

        const nowMs = now.getTime()
        const active: ScheduledMeetingReminder[] = []

        for (const row of data) {
          const startMs = new Date(row.starts_at).getTime()
          const endMs = new Date(row.ends_at).getTime()
          // Reminder window: starts within 15 minutes, or happening right now
          const withinWindow = nowMs >= (startMs - 15 * 60 * 1000) && nowMs < endMs

          if (withinWindow) {
            const isNow = nowMs >= startMs
            const minutesUntil = Math.max(0, Math.round((startMs - nowMs) / 60000))
            const safeUrl = safeMeetingUrl(row.join_url)
            const formattedTime = meetingTime(row.starts_at, zone)

            const reminder: ScheduledMeetingReminder = {
              id: row.id,
              projectId: row.project_id,
              title: row.title,
              startsAt: row.starts_at,
              endsAt: row.ends_at,
              timeZone: row.time_zone,
              joinUrl: row.join_url,
              meetingProvider: row.meeting_provider,
              googleStatus: row.google_status,
              isNow,
              minutesUntil,
              formattedTime,
              safeUrl,
            }

            active.push(reminder)

            // Trigger Desktop Notification & audio chime if not already notified for this stage
            const notifyKey = `${row.id}:${isNow ? 'now' : 'soon'}`
            if (!notifiedRef.current.has(notifyKey)) {
              notifiedRef.current.add(notifyKey)
              playReminderChime()

              if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
                try {
                  const title = isNow
                    ? `Meeting Now: ${row.title}`
                    : `Meeting in ${minutesUntil}m: ${row.title}`
                  const body = isNow
                    ? `Your scheduled meeting is happening now. Click to join.`
                    : `Starts at ${formattedTime}. Click to join.`
                  const notif = new Notification(title, {
                    body,
                    icon: '/favicon.ico',
                    tag: notifyKey,
                  })
                  notif.onclick = () => {
                    window.focus()
                    if (safeUrl) {
                      window.open(safeUrl, '_blank', 'noopener,noreferrer')
                    }
                  }
                } catch {
                  // Ignore notification error on unsupported platforms
                }
              }
            }
          }
        }

        activeRemindersRef.current = active
        setReminders(active)
      } catch {
        // Suppress background poll errors
      }
    }

    void checkMeetings()
    // Poll every 30 seconds for accurate countdowns and timely meeting start triggers
    const interval = window.setInterval(checkMeetings, 30000)
    const onFocus = () => void checkMeetings()
    window.addEventListener('focus', onFocus)

    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [user])

  const visibleReminders = reminders.filter((r) => !dismissed.has(r.id))

  return {
    reminders: visibleReminders,
    allReminders: reminders,
    dismiss,
    notificationPermission,
    requestNotificationPermission,
  }
}
