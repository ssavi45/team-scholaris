export type MeetingView = 'upcoming' | 'past' | 'cancelled'
export type Meeting = {
  id: string; project_id: string; title: string; starts_at: string; ends_at: string
  time_zone: string; agenda: string; notes: string; join_url: string; attendee_ids: string[]
  created_by: string; organizer_name: string; created_at: string; updated_at: string
  revision: number; cancelled_at: string | null
  meeting_provider: 'external' | 'google'; google_owner_id: string | null
  google_status: 'pending' | 'ready' | 'error' | 'cancelled' | null; google_error: string | null
  attendees: { user_id: string; name: string; is_member: boolean }[]
}
export type MeetingDraft = Pick<Meeting, 'title' | 'starts_at' | 'ends_at' | 'time_zone' | 'agenda' | 'notes' | 'join_url' | 'attendee_ids'>
export const meetingViews: Record<MeetingView, string> = { upcoming: 'Upcoming', past: 'Past', cancelled: 'Cancelled' }
export function viewerZone() { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' }
export function meetingTime(value: string, zone = viewerZone()) {
  return new Date(value).toLocaleString(undefined, { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' })
}
export function wallTime(value: string | number, zone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value))
  const part = (name: string) => parts.find((p) => p.type === name)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`
}

// Discover offsets on both sides of a possible clock transition, then accept
// only instants that round-trip to the requested wall time. Zero matches is a
// skipped time; multiple matches require an explicit choice, never a guess.
export function timeCandidates(value: string, zone: string): string[] {
  if (!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) && !/^2100-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Choose a date from 2000 through 2100.')
  const clock = Date.parse(`${value}:00Z`)
  if (!Number.isFinite(clock) || new Date(clock).toISOString().slice(0, 16) !== value) throw new Error('Choose a valid date and time.')
  const offsets = new Set<number>()
  for (let hours = -48; hours <= 48; hours += 6) {
    const sample = clock + hours * 3600000
    offsets.add(Date.parse(`${wallTime(sample, zone)}:00Z`) - sample)
  }
  return [...offsets].map((offset) => clock - offset).filter((instant) => wallTime(instant, zone) === value).sort((a, b) => a - b).map((instant) => new Date(instant).toISOString())
}
export function safeMeetingUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password && !/[\s\\]/.test(value) ? url.href : null
  } catch { return null }
}
