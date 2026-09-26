import { supabase } from '../../lib/supabase'
import type { MeetingDraft, MeetingView } from './meeting-types'

export const MEETING_PAGE_SIZE = 20
export type MeetingCursor = { at: string; id: string }
function client() { if (!supabase) throw new Error('Supabase is not configured.'); return supabase }
function check(error: { code?: string; message: string } | null) {
  if (!error) return
  if (error.code === '40001' || error.code === '22023') throw new Error(error.message)
  if (error.code === '42501') throw new Error('Your access changed or this project is read-only. Close and refresh to check your permissions.')
  throw new Error('Unable to confirm the change. Your edits are still here; you can retry safely.')
}
export async function loadMeetings(projectId: string, view: MeetingView, signal: AbortSignal, cursor?: MeetingCursor, meetingId?: string) {
  if (meetingId && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(meetingId)) return []
  const { data, error } = await client().rpc('get_project_meetings', { p_project_id: projectId, p_view: view, p_limit: MEETING_PAGE_SIZE + 1, p_cursor_at: cursor?.at, p_cursor_id: cursor?.id, p_meeting_id: meetingId }).abortSignal(signal)
  if (error) throw new Error('Unable to load meetings. Refresh to check your connection and project access.')
  return data ?? []
}
export async function saveMeeting(projectId: string, id: string, revision: number, draft: MeetingDraft) {
  const { error } = await client().rpc('save_project_meeting', { p_project_id: projectId, p_meeting_id: id, p_revision: revision, p_title: draft.title.trim(), p_starts_at: draft.starts_at, p_ends_at: draft.ends_at, p_time_zone: draft.time_zone, p_agenda: draft.agenda, p_notes: draft.notes, p_join_url: draft.join_url.trim(), p_attendee_ids: draft.attendee_ids })
  check(error)
}
export async function cancelMeeting(projectId: string, id: string, revision: number) {
  const { error } = await client().rpc('cancel_project_meeting', { p_project_id: projectId, p_meeting_id: id, p_revision: revision })
  check(error)
}
