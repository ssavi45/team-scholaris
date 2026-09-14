import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
const env = parseEnv(await readFile('.env.local', 'utf8'))
const url = env.VITE_SUPABASE_URL, key = env.VITE_SUPABASE_PUBLISHABLE_KEY
assert.equal(url, 'http://127.0.0.1:54321', 'This test is local only')
const makeClient = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'pkce' } })
const sql = (input) => execFileSync('docker', ['exec', '-i', 'supabase_db_team-scholaris', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
const ok = (result, label) => { assert.equal(result.error, null, label); return result.data }
const run = randomUUID().slice(0, 8), password = randomUUID() + 'Aa1!'
const ids = [], clients = [], consumed = new Set()
const email = (suffix) => `invite-test-${run}-${suffix}@example.test`
async function signup(suffix, verify = true, inviteToken) {
  const c = makeClient(); clients.push(c)
  const context = new URLSearchParams({ next: '/app' })
  if (inviteToken) context.set('invite', inviteToken)
  const data = ok(await c.auth.signUp({ email: email(suffix), password, options: { data: { name: 'Invitation Test ' + suffix }, emailRedirectTo: 'http://127.0.0.1:5173/auth/callback?' + context } }), 'Signup')
  const id = data.user.id; assert.match(id, /^[a-f0-9-]{36}$/); ids.push(id)
  if (verify) { sql(`update auth.users set email_confirmed_at = now() where id = '${id}';`); ok(await c.auth.signInWithPassword({ email: email(suffix), password }), 'Login') }
  return c
}
async function messageFor(recipient, subject) {
  for (let i = 0; i < 20; i++) {
    const inbox = await fetch('http://127.0.0.1:54324/api/v1/messages').then((r) => r.json())
    const message = inbox.messages?.find((m) => !consumed.has(m.ID) && m.To.some((to) => to.Address === recipient) && (!subject || m.Subject.includes(subject)))
    if (message) { consumed.add(message.ID); return fetch('http://127.0.0.1:54324/api/v1/message/' + message.ID).then((r) => r.json()) }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('Email not captured in Mailpit')
}
try {
  const a = await signup('a'), c = await signup('c')
  const project = ok(await a.rpc('create_project', { project_name: 'Invitation research' }).single(), 'Project creation')
  const send = async (who, recipient, accessLevel = 'member') => {
    const session = ok(await who.auth.getSession(), 'Session').session
    return fetch(url + '/functions/v1/send-project-invitation', { method: 'POST', headers: { apikey: key, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:5173' }, body: JSON.stringify({ projectId: project.id, email: recipient, accessLevel }) })
  }
  const unauthorized = await fetch(url + '/functions/v1/send-project-invitation', { method: 'POST', headers: { apikey: key, Authorization: 'Bearer forged' }, body: '{}' })
  assert.equal(unauthorized.status, 401, 'Forged sessions rejected by function')
  assert.equal((await send(c, email('b'))).status, 403, 'Nonowner send denied')
  assert.equal((await send(a, email('b'), 'owner')).status, 400, 'Owner invitations denied')
  const delivery = await send(a, email('b').toUpperCase())
  const deliveryBody = await delivery.json()
  assert.equal(delivery.status, 200, JSON.stringify(deliveryBody))
  assert.equal(deliveryBody.sent, true)
  assert.equal('invitation_token' in deliveryBody, false, 'Function does not expose tokens')
  const emailMessage = await messageFor(email('b'), 'Team Scholaris')
  const token = emailMessage.Text.match(/invite=([a-f0-9]{64})/)?.[1]
  assert.ok(token, 'Email contains a 256-bit invitation token')
  assert.equal((await send(a, email('b'))).status, 400, 'Repeated sends rate limited')
  assert.ok((await c.rpc('accept_project_invitation', { p_token: token })).error, 'Wrong email cannot accept')
  assert.equal(ok(await c.rpc('list_project_invitations', { p_token: token }), 'Wrong-email preview').length, 0)
  assert.ok((await c.from('project_invitations').select('*')).error, 'Invitation table and hashes private')
  assert.ok((await c.rpc('get_project_team', { p_project_id: project.id })).error, 'Nonmember names private')

  // Invite precedes signup; follow the real verification email, then accept explicitly.
  const b = await signup('b', false, token)
  assert.equal((await b.auth.signInWithPassword({ email: email('b'), password })).error?.code, 'email_not_confirmed')
  const verification = await messageFor(email('b'), 'Confirm')
  const verificationUrl = verification.HTML.match(/href="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&')
  assert.equal(new URL(verificationUrl).origin, url)
  const verifyResponse = await fetch(verificationUrl, { redirect: 'manual' })
  const callback = new URL(verifyResponse.headers.get('location'))
  assert.equal(callback.searchParams.get('invite'), token, 'Signup verification preserves the pending invitation')
  ok(await b.auth.exchangeCodeForSession(callback.searchParams.get('code')), 'New user email verification')
  const pending = ok(await b.rpc('list_project_invitations'), 'Recipient dashboard invitations')
  assert.equal(pending.length, 1); assert.equal(pending[0].access_level, 'member')
  const raw = sql(`select encode(token_hash, 'hex') from public.project_invitations where id = '${pending[0].id}';`).trim()
  assert.notEqual(raw, token, 'Raw token is not stored in database')
  const accepted = await Promise.all([b.rpc('accept_project_invitation', { p_token: token }), b.rpc('accept_project_invitation', { p_token: token })])
  for (const result of accepted) assert.equal(ok(result, 'Concurrent acceptance is idempotent'), project.id)
  assert.equal(ok(await b.from('projects').select('id'), 'Joined dashboard access').length, 1)
  const team = ok(await b.rpc('get_project_team', { p_project_id: project.id }), 'Member team read')
  assert.equal(team.length, 2)
  assert.equal(team.find((m) => m.user_id === ids[2]).access_level, 'member')
  assert.ok((await b.rpc('create_project_invitation', { p_project_id: project.id, p_email: email('d'), p_access_level: 'viewer' })).error, 'Member cannot invite')
  assert.ok((await a.rpc('create_project_invitation', { p_project_id: project.id, p_email: email('b'), p_access_level: 'viewer' })).error, 'Existing member cannot be reinvited or downgraded')
  console.log('PASS email delivery, auth/owner checks, hashed tokens, invite-before-signup, verified matching-email acceptance, concurrent acceptance, shared access')

  const invite = async (recipient) => ok(await a.rpc('create_project_invitation', { p_project_id: project.id, p_email: recipient, p_access_level: 'viewer' }).single(), 'Viewer invite')
  const expired = await invite(email('c'))
  sql(`update public.project_invitations set expires_at = now() - interval '1 second', created_at = now() - interval '2 minutes' where id = '${expired.invitation_id}';`)
  assert.ok((await c.rpc('accept_project_invitation', { p_token: expired.invitation_token })).error, 'Expired token denied')
  const revoked = await invite(email('c'))
  assert.ok((await c.rpc('revoke_project_invitation', { p_invitation_id: revoked.invitation_id })).error, 'Nonowner revoke denied')
  ok(await a.rpc('revoke_project_invitation', { p_invitation_id: revoked.invitation_id }), 'Owner revoke')
  assert.ok((await c.rpc('accept_project_invitation', { p_token: revoked.invitation_token })).error)
  sql(`update public.project_invitations set created_at = now() - interval '2 minutes' where id = '${revoked.invitation_id}';`)
  const viewer = await invite(email('c'))
  sql(`update public.projects set status = 'archived' where id = '${project.id}';`)
  assert.ok((await c.rpc('accept_project_invitation', { p_token: viewer.invitation_token })).error, 'Archived acceptance denied')
  assert.ok((await a.rpc('create_project_invitation', { p_project_id: project.id, p_email: email('d'), p_access_level: 'member' })).error, 'Archived invitation denied')
  sql(`update public.projects set status = 'active' where id = '${project.id}';`)
  assert.equal(ok(await c.rpc('accept_project_invitation', { p_invitation_id: viewer.invitation_id }), 'Dashboard acceptance by verified recipient'), project.id)
  assert.equal(ok(await c.from('project_members').select('access_level').eq('project_id', project.id).eq('user_id', ids[1]).single(), 'Viewer membership').access_level, 'viewer')
  assert.equal(ok(await c.rpc('list_project_invitations'), 'Accepted invitation removed').length, 0)
  assert.ok((await c.rpc('accept_project_invitation', { p_token: 'invalid' })).error)
  assert.ok((await makeClient().rpc('accept_project_invitation', { p_token: token })).error, 'Anonymous acceptance denied')
  console.log('PASS expiry, revocation, role separation, archived rules, dashboard acceptance, token rejection')
} finally {
  for (const c of clients) await c.auth.signOut()
  if (ids.length) { const list = ids.map((id) => `'${id}'`).join(','); sql(`delete from public.projects where owner_id in (${list}); delete from auth.users where id in (${list});`) }
}
