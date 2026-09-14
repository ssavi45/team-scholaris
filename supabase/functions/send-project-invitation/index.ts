// No service-role key is used: database RPCs run as the verified caller.
Deno.serve(async (request: Request) => {
  const appOrigin = Deno.env.get('APP_ORIGIN')
  const cors = { 'Access-Control-Allow-Origin': appOrigin ?? '', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' }
  const reply = (status: number, body: object) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
  if (!appOrigin) return reply(503, { error: 'Invitation email is not configured for this environment.' })
  if (request.headers.get('Origin') && request.headers.get('Origin') !== appOrigin) return reply(403, { error: 'Origin not allowed.' })
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return reply(405, { error: 'POST required.' })
  try {
    const authorization = request.headers.get('Authorization') ?? ''
    if (!authorization.startsWith('Bearer ')) return reply(401, { error: 'Sign in to invite people.' })
    const base = Deno.env.get('SUPABASE_URL')!
    const keys = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}')
    const publicKey = keys.default || Deno.env.get('SUPABASE_ANON_KEY')
    const headers = { Authorization: authorization, apikey: publicKey, 'Content-Type': 'application/json' }
    const userResponse = await fetch(base + '/auth/v1/user', { headers, signal: AbortSignal.timeout(15000) })
    if (!userResponse.ok) return reply(401, { error: 'Your session is invalid. Sign in again.' })
    const user = await userResponse.json()
    if (!user.id || !user.email_confirmed_at) return reply(403, { error: 'Verify your email first.' })
    const provider = Deno.env.get('INVITE_EMAIL_PROVIDER')
    const mailpit = Deno.env.get('INVITE_MAILPIT_URL')
    const resendKey = Deno.env.get('RESEND_API_KEY')
    const from = Deno.env.get('INVITE_FROM')
    if (!(provider === 'mailpit' && mailpit) && !(provider === 'resend' && resendKey && from)) {
      return reply(503, { error: 'Invitation email is not configured for this environment.' })
    }
    const text = await request.text()
    if (text.length > 4096) return reply(400, { error: 'Request is too large.' })
    let input: { projectId?: string; email?: string; accessLevel?: string }
    try { input = JSON.parse(text) } catch { return reply(400, { error: 'Invalid request.' }) }
    if (!input || typeof input.projectId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.projectId) || typeof input.email !== 'string' || !['member', 'viewer'].includes(input.accessLevel ?? '')) {
      return reply(400, { error: 'Provide a project, email, and member or viewer access.' })
    }
    const result = await fetch(base + '/rest/v1/rpc/create_project_invitation', {
      method: 'POST', headers, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ p_project_id: input.projectId, p_email: input.email, p_access_level: input.accessLevel }),
    })
    const data = await result.json()
    if (!result.ok) return reply(result.status === 403 ? 403 : 400, { error: ['42501', '22023', 'P0001'].includes(data.code) ? data.message : 'Unable to create invitation.' })
    const invitation = data[0]
    const link = new URL('/app', appOrigin)
    link.searchParams.set('invite', invitation.invitation_token)
    const body = `You have been invited to join "${invitation.project_name}" on Team Scholaris as a ${input.accessLevel}.\n\nSign in or create an account using ${invitation.recipient_email}, then accept your invitation:\n${link.href}\n\nThis invitation expires on ${invitation.expires_at}. If you were not expecting it, you can ignore this email.`
    let delivered = false
    try {
      const delivery = provider === 'mailpit'
        ? await fetch(mailpit + '/api/v1/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000), body: JSON.stringify({ From: { Email: 'invitations@teamscholaris.test', Name: 'Team Scholaris' }, To: [{ Email: invitation.recipient_email }], Subject: 'Your Team Scholaris project invitation', Text: body }) })
        : await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + resendKey, 'Content-Type': 'application/json', 'Idempotency-Key': invitation.invitation_id }, signal: AbortSignal.timeout(15000), body: JSON.stringify({ from, to: [invitation.recipient_email], subject: 'Your Team Scholaris project invitation', text: body }) })
      delivered = delivery.ok
    } catch { /* The invitation remains available in the recipient's dashboard. */ }
    if (!delivered) return reply(502, { error: 'Invitation saved, but email delivery could not be confirmed. The recipient can accept from their dashboard. Wait a minute before sending a replacement.' })
    return reply(200, { sent: true, expiresAt: invitation.expires_at })
  } catch {
    return reply(503, { error: 'Unable to complete the request. Check pending invitations before retrying.' })
  }
})
