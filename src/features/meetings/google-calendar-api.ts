import { supabase } from '../../lib/supabase'
import { environment } from '../../lib/env'

export type GoogleConnection = { configured: boolean; connected: boolean; email: string | null }
export type GoogleResult = { status: 'ready' | 'pending' | 'error' | 'cancelled'; error?: string | null }
async function request<T>(body: object, signal?: AbortSignal): Promise<T> {
  if (!supabase || !environment.config) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) throw new Error('Sign in again to connect Google.')
  const response = await fetch(environment.config.url + '/functions/v1/google-calendar', {
    method: 'POST', credentials: 'include', signal: signal ?? AbortSignal.timeout(150000),
    headers: { Authorization: 'Bearer ' + data.session.access_token, apikey: environment.config.publishableKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Google Calendar is unavailable. Try again shortly.')
  return result as T
}
export function googleStatus(signal?: AbortSignal) { return request<GoogleConnection>({ action: 'status' }, signal) }
export async function connectGoogle(projectId: string) {
  const { url } = await request<{ url: string }>({ action: 'connect', projectId })
  const destination = new URL(url)
  if (destination.origin !== 'https://accounts.google.com') throw new Error('Invalid Google authorization address.')
  window.location.assign(destination.href)
}
export function disconnectGoogle() { return request<{ disconnected: boolean; revoked: boolean }>({ action: 'disconnect' }) }
export async function syncGoogleMeeting(meetingId: string) {
  let result = await request<GoogleResult>({ action: 'sync', meetingId })
  // Google creates conference data asynchronously. Brief bounded polling makes
  // the usual path automatic while keeping a recoverable pending state.
  for (let attempt = 0; result.status === 'pending' && attempt < 4; attempt++) {
    await new Promise((resolve) => window.setTimeout(resolve, 2000))
    result = await request<GoogleResult>({ action: 'sync', meetingId })
  }
  return result
}
