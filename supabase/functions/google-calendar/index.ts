// Server-only OAuth and Calendar integration. Never log credentials, callback
// query strings, Google response bodies, or Supabase service-role credentials.
const scope = 'https://www.googleapis.com/auth/calendar.events.owned'
const cookieName = 'scholaris_google_oauth'
const uuid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const env = (name: string) => Deno.env.get(name) ?? ''
const appOrigin = env('APP_ORIGIN')
const redirectUri = env('GOOGLE_CALENDAR_REDIRECT_URI')
const clientId = env('GOOGLE_CALENDAR_CLIENT_ID')
const clientSecret = env('GOOGLE_CALENDAR_CLIENT_SECRET')
const tokenKey = env('GOOGLE_CALENDAR_TOKEN_KEY')
const base = env('SUPABASE_URL')
const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY')
const publicKey = env('SUPABASE_ANON_KEY')
const configured = !!(appOrigin && redirectUri && clientId && clientSecret && /^[0-9a-f]{64}$/i.test(tokenKey) && serviceKey)
const cors = { 'Access-Control-Allow-Origin': appOrigin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' }
class SafeError extends Error {}
type Connection = { user_id: string; google_sub: string; email: string; refresh_cipher: string }
type Meeting = { id: string; project_id: string; title: string; agenda: string; starts_at: string; ends_at: string; time_zone: string; cancelled_at: string | null }
type Operation = { meeting_id: string; google_sub: string; event_id: string; lease_id: string; event_created: boolean }
type CalendarEvent = { id?: string; status?: string; etag?: string; summary?: string; description?: string; start?: { dateTime?: string }; end?: { dateTime?: string }; extendedProperties?: { private?: { scholarisMeeting?: string } }; conferenceData?: { createRequest?: { status?: { statusCode?: string } }; entryPoints?: { entryPointType: string; uri: string }[] } }
function reply(status: number, value: object, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(value), { status, headers: { ...cors, ...extra, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
}
function bytesToBase64(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') }
function base64ToBytes(value: string) { return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)) }
function random() { return bytesToBase64(crypto.getRandomValues(new Uint8Array(32))) }
async function hash(value: string) { return bytesToBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))) }
async function cipherKey() { return crypto.subtle.importKey('raw', Uint8Array.from(tokenKey.match(/../g)!.map((s) => parseInt(s, 16))), 'AES-GCM', false, ['encrypt', 'decrypt']) }
async function encrypt(value: string, userId: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(userId) }, await cipherKey(), new TextEncoder().encode(value))
  return bytesToBase64(iv) + '.' + bytesToBase64(new Uint8Array(encrypted))
}
async function decrypt(value: string, userId: string) {
  const [iv, data] = value.split('.')
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(iv), additionalData: new TextEncoder().encode(userId) }, await cipherKey(), base64ToBytes(data)))
}
async function db<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(base + '/rest/v1/' + path, { method, headers: { Authorization: 'Bearer ' + serviceKey, apikey: serviceKey, 'Content-Type': 'application/json', Prefer: 'return=representation,resolution=merge-duplicates' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) })
  const text = await response.text()
  const data = text ? JSON.parse(text) : null
  if (!response.ok) throw new SafeError(['42501', '22023', '40001'].includes(data?.code) ? data.message : 'Unable to save the Google operation. Refresh before retrying.')
  return data as T
}
async function connection(userId: string) { return (await db<Connection[]>('google_calendar_connections?user_id=eq.' + userId))[0] }
async function tokenRequest(parameters: Record<string, string>) {
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...parameters, client_id: clientId, client_secret: clientSecret }), signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new SafeError('Google authorization expired or was declined. Reconnect Google and retry.')
  return await response.json() as { access_token: string; refresh_token?: string; scope?: string }
}
function cookie(value: string, maxAge = 600) { return `${cookieName}=${value}; HttpOnly; SameSite=Lax; Path=/functions/v1/google-calendar; Max-Age=${maxAge}${redirectUri.startsWith('https:') ? '; Secure' : ''}` }
async function callback(request: Request) {
  const url = new URL(request.url)
  let destination = new URL('/app', appOrigin)
  let result = 'failed'
  try {
    if (!configured) throw new SafeError('Google is not configured.')
    const state = url.searchParams.get('state') ?? ''
    const browser = (request.headers.get('Cookie') ?? '').split(';').map((s) => s.trim()).find((s) => s.startsWith(cookieName + '='))?.slice(cookieName.length + 1) ?? ''
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(browser)) throw new SafeError('OAuth state missing.')
    const states = await db<{ user_id: string; project_id: string; verifier: string }[]>('rpc/consume_google_oauth_state', 'POST', { p_hash: await hash(state), p_browser: await hash(browser) })
    const record = states[0]
    if (!record) throw new SafeError('OAuth state expired.')
    destination = new URL(`/project/${record.project_id}/meetings`, appOrigin)
    if (url.searchParams.has('error')) { result = 'declined'; throw new SafeError('Declined') }
    const code = url.searchParams.get('code')
    if (!code || code.length > 4096) throw new SafeError('Invalid OAuth code.')
    const tokens = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: record.verifier })
    if (!tokens.scope?.split(' ').includes(scope)) { result = 'permission'; throw new SafeError('Calendar permission missing.') }
    const identity = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: 'Bearer ' + tokens.access_token }, signal: AbortSignal.timeout(15000) })
    if (!identity.ok) throw new SafeError('Unable to identify Google account.')
    const person = await identity.json() as { sub: string; email: string; email_verified: boolean }
    if (!person.sub || !person.email || !person.email_verified) throw new SafeError('Verified Google email required.')
    const existing = await connection(record.user_id)
    const refresh = tokens.refresh_token ? await encrypt(tokens.refresh_token, record.user_id) : existing?.google_sub === person.sub ? existing.refresh_cipher : null
    if (!refresh) throw new SafeError('Refresh authorization missing.')
    await db('rpc/complete_google_connection', 'POST', { p_hash: await hash(state), p_user_id: record.user_id, p_sub: person.sub, p_email: person.email, p_cipher: refresh })
    result = 'connected'
  } catch { /* Only a fixed result code is exposed to the browser. */ }
  destination.searchParams.set('google', result)
  return new Response(null, { status: 303, headers: { Location: destination.href, 'Set-Cookie': cookie('', 0), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
}
function escapeAgenda(value: string) { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') }
async function synchronize(userId: string, meetingId: string) {
  const { meeting, operation } = await db<{ meeting: Meeting; operation: Operation }>('rpc/begin_google_meeting', 'POST', { p_user_id: userId, p_meeting_id: meetingId })
  let created = operation.event_created
  async function finish(status: string, url: string | null = null, error: string | null = null) {
    await db('rpc/finish_google_meeting', 'POST', { p_user_id: userId, p_meeting_id: meetingId, p_lease: operation.lease_id, p_status: status, p_url: url, p_error: error, p_created: created })
    return { status, error }
  }
  try {
    const account = await connection(userId)
    if (!account || account.google_sub !== operation.google_sub) throw new SafeError('Reconnect the Google account originally used for this meeting.')
    const token = await tokenRequest({ grant_type: 'refresh_token', refresh_token: await decrypt(account.refresh_cipher, userId) })
    const calendarBase = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
    async function google(path: string, method = 'GET', body?: unknown, etag?: string) {
      const response = await fetch(calendarBase + path, { method, headers: { Authorization: 'Bearer ' + token.access_token, 'Content-Type': 'application/json', ...(etag ? { 'If-Match': etag } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) })
      if (![200, 201, 204, 404, 409, 410, 412].includes(response.status)) throw new SafeError(response.status === 401 ? 'Reconnect Google to renew calendar access.' : 'Google could not complete this request. Check calendar access and retry.')
      const text = await response.text()
      return { code: response.status, event: (text ? JSON.parse(text) : {}) as CalendarEvent }
    }
    const eventPath = '/' + operation.event_id
    let response = await google(eventPath)
    if (meeting.cancelled_at) {
      if (response.code === 200 && response.event.status !== 'cancelled') {
        if (response.event.extendedProperties?.private?.scholarisMeeting !== meetingId) throw new SafeError('The calendar event could not be verified. Review it in Google Calendar.')
        const deleted = await google(eventPath + '?sendUpdates=none', 'DELETE', undefined, response.event.etag)
        if (![204, 404, 410].includes(deleted.code)) throw new SafeError('Google event changed. Retry cancellation after refreshing.')
      } else if (![200, 404, 410].includes(response.code)) throw new SafeError('Unable to confirm Google cancellation. Retry after refreshing.')
      return await finish('cancelled')
    }
    const eventBody = { summary: meeting.title, description: escapeAgenda(meeting.agenda), start: { dateTime: meeting.starts_at, timeZone: meeting.time_zone }, end: { dateTime: meeting.ends_at, timeZone: meeting.time_zone } }
    const conference = () => ({ createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } })
    if (response.code === 404 && !created) {
      response = await google('?conferenceDataVersion=1&sendUpdates=none', 'POST', { ...eventBody, id: operation.event_id, extendedProperties: { private: { scholarisMeeting: meetingId } }, conferenceData: conference(), guestsCanModify: false, guestsCanInviteOthers: false })
      if (response.code === 409) response = await google(eventPath)
    }
    if (![200, 201].includes(response.code) || response.event.status === 'cancelled') throw new SafeError('The Google event is unavailable or was deleted. Review it in Google Calendar; create a new Scholaris meeting if needed.')
    if (response.event.extendedProperties?.private?.scholarisMeeting !== meetingId) throw new SafeError('The calendar event could not be verified. No changes were made to it.')
    created = true
    const event = response.event
    const changed = event.summary !== meeting.title || (event.description ?? '') !== eventBody.description || Date.parse(event.start?.dateTime ?? '') !== Date.parse(meeting.starts_at) || Date.parse(event.end?.dateTime ?? '') !== Date.parse(meeting.ends_at)
    const conferenceFailed = event.conferenceData?.createRequest?.status?.statusCode === 'failure'
    if (changed || conferenceFailed || !event.conferenceData) {
      response = await google(eventPath + '?conferenceDataVersion=1&sendUpdates=none', 'PATCH', { ...eventBody, ...(conferenceFailed || !event.conferenceData ? { conferenceData: conference() } : {}) }, event.etag)
      if (response.code !== 200) throw new SafeError('The Google event changed while saving. Retry after refreshing.')
    }
    const conferenceStatus = response.event.conferenceData?.createRequest?.status?.statusCode
    if (conferenceStatus === 'failure') throw new SafeError('Google could not generate a Meet link. Check that this account supports Google Meet, then retry.')
    const link = response.event.conferenceData?.entryPoints?.find((point) => point.entryPointType === 'video')?.uri
    if (link && /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(link)) return await finish('ready', link)
    return await finish('pending', null, 'Google is generating the Meet link. Use Check Google status in a moment.')
  } catch (cause) {
    const message = cause instanceof SafeError ? cause.message : 'Google synchronization could not be confirmed. Retry safely from this meeting.'
    await finish('error', null, message)
    return { status: 'error', error: message }
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === 'GET' && new URL(request.url).pathname.endsWith('/google-calendar/callback')) {
    if (!appOrigin) return new Response('Google integration is not configured.', { status: 503 })
    return callback(request)
  }
  if (request.headers.get('Origin') && request.headers.get('Origin') !== appOrigin) return reply(403, { error: 'Origin not allowed. Open Scholaris at its configured local address.' })
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return reply(405, { error: 'POST required.' })
  try {
    const authorization = request.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return reply(401, { error: 'Sign in first.' })
    const userResponse = await fetch(base + '/auth/v1/user', { headers: { Authorization: authorization, apikey: publicKey }, signal: AbortSignal.timeout(15000) })
    if (!userResponse.ok) return reply(401, { error: 'Sign in again to connect Google.' })
    const user = await userResponse.json() as { id: string; email_confirmed_at?: string }
    if (!user.id || !user.email_confirmed_at) return reply(403, { error: 'Verify your Scholaris email first.' })
    const text = await request.text()
    if (text.length > 4096) return reply(400, { error: 'Request is too large.' })
    const input = JSON.parse(text) as { action?: string; projectId?: string; meetingId?: string }
    if (input.action === 'status') {
      const account = configured ? await connection(user.id) : undefined
      return reply(200, { configured, connected: !!account, email: account?.email ?? null })
    }
    if (!configured) return reply(503, { error: 'Google Calendar is not configured on the server yet.' })
    if (input.action === 'connect') {
      if (!input.projectId || !uuid.test(input.projectId)) return reply(400, { error: 'Choose a project.' })
      const permission = await fetch(base + '/rest/v1/project_members?select=access_level&project_id=eq.' + input.projectId + '&user_id=eq.' + user.id, { headers: { Authorization: authorization, apikey: publicKey }, signal: AbortSignal.timeout(15000) })
      if (!permission.ok || !(await permission.json()).some((row: { access_level: string }) => ['owner', 'member'].includes(row.access_level))) return reply(403, { error: 'Project editing access required.' })
      const state = random(), browser = random(), verifier = random()
      await db('google_calendar_oauth_states?expires_at=lt.' + encodeURIComponent(new Date().toISOString()), 'DELETE')
      await db('google_calendar_oauth_states?user_id=eq.' + user.id, 'DELETE')
      await db('google_calendar_oauth_states', 'POST', { state_hash: await hash(state), browser_hash: await hash(browser), verifier, user_id: user.id, project_id: input.projectId })
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email ' + scope, access_type: 'offline', prompt: 'consent select_account', state, code_challenge: await hash(verifier), code_challenge_method: 'S256' }).toString()
      return reply(200, { url: url.href }, { 'Set-Cookie': cookie(browser) })
    }
    if (input.action === 'disconnect') {
      // Invalidate callbacks before deleting credentials; a late token exchange
      // must not silently reconnect an account after the user disconnects it.
      await db('google_calendar_oauth_states?user_id=eq.' + user.id, 'DELETE')
      const account = await connection(user.id)
      let revoked = !account
      if (account) {
        try {
          const response = await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: await decrypt(account.refresh_cipher, user.id) }), signal: AbortSignal.timeout(15000) })
          revoked = response.ok || response.status === 400
        } catch { /* Local disconnection still removes stored authorization. */ }
      }
      await db('google_calendar_connections?user_id=eq.' + user.id, 'DELETE')
      return reply(200, { disconnected: true, revoked })
    }
    if (input.action === 'sync' && input.meetingId && uuid.test(input.meetingId)) return reply(200, await synchronize(user.id, input.meetingId))
    return reply(400, { error: 'Unknown Google Calendar action.' })
  } catch (cause) {
    return reply(400, { error: cause instanceof SafeError ? cause.message : 'The Google request could not be completed. Refresh and try again.' })
  }
})
