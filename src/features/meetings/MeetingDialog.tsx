import { useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker } from 'react-router'
import { CalendarDays, ExternalLink, X } from 'lucide-react'
import type { TeamMember } from '../invitations/invitations-api'
import { cancelMeeting, saveMeeting } from './meetings-api'
import { meetingTime, safeMeetingUrl, timeCandidates, viewerZone, wallTime } from './meeting-types'
import type { Meeting } from './meeting-types'
import { syncGoogleMeeting } from './google-calendar-api'

function initialForm(meeting: Meeting | null, userId: string, instant: boolean) {
  const zone = meeting?.time_zone ?? viewerZone()
  const nextHour = instant ? Math.floor(Date.now() / 60000) * 60000 : Math.ceil((Date.now() + 3600000) / 3600000) * 3600000
  const start = meeting?.starts_at ?? new Date(nextHour).toISOString()
  const end = meeting?.ends_at ?? new Date(nextHour + 3600000).toISOString()
  return { title: meeting?.title ?? (instant ? 'Research meeting' : ''), starts_at: wallTime(start, zone), ends_at: wallTime(end, zone), time_zone: zone,
    startChoice: new Date(start).toISOString(), endChoice: new Date(end).toISOString(), agenda: meeting?.agenda ?? '',
    notes: meeting?.notes ?? '', join_url: meeting?.join_url ?? '', attendee_ids: meeting?.attendee_ids ?? [userId] }
}

export function MeetingDialog({ projectId, meeting, team, userId, canManage, canSync, googleConnected, instant, close, saved }: {
  projectId: string; meeting: Meeting | null; team: TeamMember[]; userId: string
  canManage: boolean; canSync: boolean; googleConnected: boolean; instant: boolean; close: () => void; saved: (cancelled: boolean, warning?: string, openId?: string) => void
}) {
  const node = useRef<HTMLDialogElement>(null)
  const inFlight = useRef(false)
  const allowNavigation = useRef(false)
  const [id] = useState(() => meeting?.id ?? crypto.randomUUID())
  const [initial] = useState(() => initialForm(meeting, userId, instant))
  const [provider, setProvider] = useState<'external' | 'google'>(() => meeting?.meeting_provider ?? (googleConnected ? 'google' : 'external'))
  const [draft, setDraft] = useState(initial)
  const [editing, setEditing] = useState(!meeting)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial) || (!meeting && provider === 'google' && !googleConnected)
  const writable = canManage && !meeting?.cancelled_at
  const blocker = useBlocker(() => !allowNavigation.current && (inFlight.current || dirty))
  const times = useMemo(() => {
    try {
      const starts = timeCandidates(draft.starts_at, draft.time_zone)
      const ends = timeCandidates(draft.ends_at, draft.time_zone)
      return { starts, ends, error: !starts.length || !ends.length ? 'This time does not exist in the selected time zone because the clocks move forward. Choose another time.' : '' }
    } catch (cause) { return { starts: [], ends: [], error: cause instanceof RangeError ? 'Enter a valid IANA time zone, such as Asia/Dhaka or Europe/London.' : cause instanceof Error ? cause.message : 'Check the meeting times.' } }
  }, [draft.starts_at, draft.ends_at, draft.time_zone])
  // Preserve the exact stored instant when only notes/details change, including
  // timestamps created by another client with seconds or subsecond precision.
  const start = meeting && draft.starts_at === initial.starts_at && draft.time_zone === initial.time_zone && draft.startChoice === initial.startChoice
    ? new Date(meeting.starts_at).toISOString() : times.starts.length === 1 ? times.starts[0] : times.starts.find((v) => v === draft.startChoice)
  const end = meeting && draft.ends_at === initial.ends_at && draft.time_zone === initial.time_zone && draft.endChoice === initial.endChoice
    ? new Date(meeting.ends_at).toISOString() : times.ends.length === 1 ? times.ends[0] : times.ends.find((v) => v === draft.endChoice)

  useEffect(() => { const dialog = node.current!; dialog.showModal(); return () => dialog.close() }, [])
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (inFlight.current || !window.confirm('Discard your unsaved meeting changes?')) blocker.reset()
    else blocker.proceed()
  }, [blocker])
  useEffect(() => {
    if (!dirty && !busy) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    const signOut = (e: Event) => { if (inFlight.current || !window.confirm('Sign out and discard your unsaved meeting changes?')) e.preventDefault(); else allowNavigation.current = true }
    window.addEventListener('beforeunload', warn)
    window.addEventListener('scholaris:before-sign-out', signOut)
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener('scholaris:before-sign-out', signOut) }
  }, [dirty, busy])
  function dismiss() {
    if (inFlight.current || (dirty && !window.confirm('Discard your unsaved meeting changes?'))) return
    allowNavigation.current = true; close()
  }
  async function submit(cancelling = false) {
    if (inFlight.current || !writable) return
    setError('')
    if (!cancelling) {
      if (times.error) { setError(times.error); return }
      if (!start || !end) { setError('Choose which occurrence to use for each repeated clock time.'); return }
      if (end <= start) { setError('The meeting must end after it starts.'); return }
      if (provider === 'external' && draft.join_url.trim() && !safeMeetingUrl(draft.join_url.trim())) { setError('Use a complete HTTPS meeting link without a username or password.'); return }
      if (provider === 'google' && !meeting && !googleConnected) { setError('Close this form and connect Google from the Meetings page first.'); return }
    }
    inFlight.current = true; setBusy(true)
    try {
      if (cancelling && meeting) await cancelMeeting(projectId, id, meeting.revision)
      else await saveMeeting(projectId, id, meeting?.revision ?? 0, { ...draft, title: draft.title.trim(), starts_at: start!, ends_at: end!, join_url: provider === 'google' ? meeting?.join_url ?? '' : draft.join_url.trim() ? safeMeetingUrl(draft.join_url.trim())! : '' })
      let warning = ''
      if (provider === 'google') {
        if (!meeting || meeting.google_owner_id === userId) {
          try {
            const result = await syncGoogleMeeting(id)
            if (result.status === 'error' || result.status === 'pending') warning = 'Saved in Scholaris. ' + (result.error || 'Google is generating the meeting link. Check its status below.')
          } catch (cause) { warning = 'Saved in Scholaris. ' + (cause instanceof Error ? cause.message : 'Google synchronization is pending. Retry from the meeting details.') }
        } else warning = 'Saved in Scholaris. The connected organizer must synchronize these changes with Google.'
      }
      allowNavigation.current = true; setEditing(false); saved(cancelling, warning, provider === 'google' ? id : undefined)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save this meeting.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  async function synchronize() {
    if (inFlight.current || !meeting || !canSync || (meeting.meeting_provider === 'google' ? meeting.google_owner_id !== userId : meeting.created_by !== userId || !!meeting.cancelled_at)) return
    if (meeting.meeting_provider !== 'google' && meeting.join_url && !window.confirm('Replace this external link with a new Google Meet event on your calendar?')) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      const result = await syncGoogleMeeting(meeting.id)
      allowNavigation.current = true
      saved(!!meeting.cancelled_at, result.status === 'ready' ? 'Google Meet is ready. Use the link below to join.' : result.status === 'cancelled' ? 'Google Calendar event cancelled.' : result.error || 'Google is generating the link. Check again shortly.', meeting.id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to synchronize with Google.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  const people = [...team.map((person) => ({ user_id: person.user_id, name: person.name, is_member: true })), ...(meeting?.attendees.filter((a) => !team.some((m) => m.user_id === a.user_id)) ?? []).map((a) => ({ ...a, is_member: false }))]
  const joinUrl = meeting && safeMeetingUrl(meeting.join_url)
  return <dialog ref={node} className="project-dialog meeting-dialog" aria-labelledby="meeting-dialog-title" onCancel={(e) => { e.preventDefault(); dismiss() }}>
    <div className="meeting-dialog-heading"><div><p className="eyebrow">PROJECT MEETING</p><h2 id="meeting-dialog-title">{meeting ? editing ? 'Edit meeting' : meeting.title : instant ? 'Start a Google Meet' : 'Schedule a meeting'}</h2></div><button type="button" className="meeting-close" onClick={dismiss} disabled={busy} aria-label="Close meeting" autoFocus><X size={20} /></button></div>
    {meeting && <p className="form-note">Organized by {meeting.organizer_name}{meeting.cancelled_at ? ' · Cancelled' : ''}</p>}
    {error && <p className="notice error-notice" role="alert">{error}</p>}
    {confirmCancel ? <section className="notice error-notice"><h3>Cancel this meeting?</h3><p>It will move to Cancelled. Its agenda, notes, and history remain available. Unsaved edits will be discarded. Let your attendees know separately.</p><div className="dialog-actions"><button className="button secondary" disabled={busy} onClick={() => setConfirmCancel(false)}>Keep meeting</button><button className="button team-danger-button" disabled={busy} onClick={() => void submit(true)}>{busy ? 'Cancelling…' : 'Cancel meeting'}</button></div></section> : editing ? <form onSubmit={(e) => { e.preventDefault(); void submit() }} aria-busy={busy}>
      <fieldset disabled={busy || !writable} className="meeting-fields">
        <label>Meeting title<input required maxLength={160} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Weekly research check-in" /></label>
        <label>Time zone<input required list="meeting-time-zones" value={draft.time_zone} onChange={(e) => setDraft({ ...draft, time_zone: e.target.value, startChoice: '', endChoice: '' })} autoComplete="off" spellCheck={false} /><datalist id="meeting-time-zones">{[...new Set([viewerZone(), 'UTC', 'Asia/Dhaka', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Tokyo', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney'])].map((zone) => <option key={zone} value={zone} />)}</datalist></label>
        <p className="form-note">Enter both times in this zone. Changing the zone keeps the entered clock times.</p>
        <div className="meeting-form-grid">
          <label>Starts<input type="datetime-local" required min="2000-01-01T00:00" max="2100-12-31T23:59" value={draft.starts_at} onChange={(e) => setDraft({ ...draft, starts_at: e.target.value, startChoice: '' })} /></label>
          <label>Ends<input type="datetime-local" required min="2000-01-01T00:00" max="2100-12-31T23:59" value={draft.ends_at} onChange={(e) => setDraft({ ...draft, ends_at: e.target.value, endChoice: '' })} /></label>
        </div>
        {times.error && <p className="notice error-notice" role="status">{times.error}</p>}
        {([{ label: 'Start', values: times.starts, key: 'startChoice' }, { label: 'End', values: times.ends, key: 'endChoice' }] as const).map(({ label, values, key }) => values.length > 1 && <label key={key}>{label} time occurs twice — choose one<select required value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}><option value="">Choose an occurrence</option>{values.map((value, index) => <option value={value} key={value}>{index === 0 ? 'First' : 'Second'} occurrence · {new Date(value).toLocaleString(undefined, { timeZone: draft.time_zone, hour: '2-digit', minute: '2-digit', timeZoneName: 'shortOffset' })} · {value.slice(11, 16)} UTC</option>)}</select></label>)}
        {start && end && !times.error && <p className="meeting-time-preview">Your time ({viewerZone()}):<br />{meetingTime(start)} – {meetingTime(end)}</p>}
        <fieldset className="meeting-attendees"><legend>Attendees <span className="muted">Optional</span></legend><div>{people.map((person) => <label key={person.user_id}><input type="checkbox" checked={draft.attendee_ids.includes(person.user_id)} disabled={!person.is_member && !draft.attendee_ids.includes(person.user_id)} onChange={(e) => setDraft({ ...draft, attendee_ids: e.target.checked ? [...draft.attendee_ids, person.user_id] : draft.attendee_ids.filter((id) => id !== person.user_id) })} /><span>{person.name || 'Teammate'}{!person.is_member && <small>Former teammate</small>}</span></label>)}</div></fieldset>
        {!meeting && <label>Meeting location<select value={provider} onChange={(e) => setProvider(e.target.value as 'google' | 'external')}><option value="google" disabled={!googleConnected}>Google Meet — generate automatically{!googleConnected ? ' (connect Google first)' : ''}</option><option value="external">External link or no online meeting</option></select></label>}
        {provider === 'google' ? <p className="notice">A Google Calendar event and Meet link will be managed for this meeting. Its title, schedule, and agenda are sent to Google. Shared notes and attendee selections stay in Scholaris.</p> : <label>Meeting link <span className="muted">Optional</span><input type="url" maxLength={2048} placeholder="https://meet.google.com/…" value={draft.join_url} onChange={(e) => setDraft({ ...draft, join_url: e.target.value })} /></label>}
        <label>Agenda <span className="muted">Optional</span><textarea rows={4} maxLength={10000} value={draft.agenda} onChange={(e) => setDraft({ ...draft, agenda: e.target.value })} placeholder="What would you like to discuss?" /></label>
        <label>Shared notes <span className="muted">Optional</span><textarea rows={6} maxLength={20000} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Capture decisions and next steps for the team." /></label>
      </fieldset>
      <p className="form-note">Visible to the project team. Scholaris alerts teammates when this meeting is scheduled and starting.</p>
      <div className="meeting-dialog-actions">{meeting && <button type="button" className="button secondary compact-button" disabled={busy} onClick={() => { if (!dirty || window.confirm('Discard your unsaved meeting changes?')) { setDraft(initial); setEditing(false); setError('') } }}>Back to details</button>}<button className="button primary compact-button" disabled={busy || !writable}>{busy ? provider === 'google' ? 'Saving and contacting Google…' : 'Saving…' : meeting ? 'Save changes' : instant ? 'Create meeting & get link' : 'Schedule meeting'}</button></div>
    </form> : meeting && <div className="meeting-detail">
      <div className="meeting-schedule"><CalendarDays size={23} aria-hidden="true" /><div><strong>{meetingTime(meeting.starts_at)}</strong><span>Until {meetingTime(meeting.ends_at)}</span><small>Your time · {viewerZone()}</small></div></div>
      <p className="form-note">Scheduled in {meeting.time_zone}: {meetingTime(meeting.starts_at, meeting.time_zone)} – {meetingTime(meeting.ends_at, meeting.time_zone)}</p>
      {joinUrl && !meeting.cancelled_at && <a className="button primary compact-button" href={joinUrl} target="_blank" rel="noopener noreferrer">Open meeting link <ExternalLink size={15} aria-hidden="true" /></a>}
      {meeting.meeting_provider === 'google' && <p className="notice" role="status">{meeting.google_status === 'ready' ? 'Google Meet ready. Schedule changes made in Scholaris are sent to the organizer’s calendar.' : meeting.google_status === 'cancelled' ? 'The Google Calendar event has been cancelled.' : meeting.google_error || 'Google synchronization is pending.'}{meeting.google_status !== 'ready' && meeting.google_status !== 'cancelled' && meeting.google_owner_id !== userId && ' The connected organizer must finish synchronizing this meeting.'}</p>}
      {canSync && googleConnected && (meeting.meeting_provider === 'google' ? meeting.google_owner_id === userId : meeting.created_by === userId && !meeting.cancelled_at) && <button className="button secondary compact-button" disabled={busy} onClick={() => void synchronize()}>{busy ? 'Contacting Google…' : meeting.meeting_provider === 'google' ? 'Check Google status / sync' : 'Generate Google Meet link'}</button>}
      {meeting.meeting_provider === 'google' && meeting.google_owner_id === userId && !googleConnected && canSync && <p className="form-note">Close this dialog and reconnect the original Google account to synchronize this event.</p>}
      <section><h3>Attendees <span className="muted">({meeting.attendees.length})</span></h3>{meeting.attendees.length ? <ul className="meeting-people">{meeting.attendees.map((a) => <li key={a.user_id}>{a.name}{!a.is_member && <small>Former teammate</small>}</li>)}</ul> : <p className="muted">No attendees selected.</p>}</section>
      <section><h3>Agenda</h3><p className="meeting-prose">{meeting.agenda || 'No agenda added yet.'}</p></section>
      <section><h3>Shared notes</h3><p className="meeting-prose">{meeting.notes || 'Decisions and next steps will appear here.'}</p></section>
      <p className="form-note">Updated {meetingTime(meeting.updated_at)}. The organizer and project owner manage meeting details and notes.</p>
      {writable && <div className="meeting-dialog-actions"><button className="button secondary compact-button" onClick={() => setConfirmCancel(true)}>Cancel meeting</button><button className="button primary compact-button" onClick={() => setEditing(true)}>Edit meeting & notes</button></div>}
    </div>}
  </dialog>
}
