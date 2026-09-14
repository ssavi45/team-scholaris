import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const env = new Map([['APP_ORIGIN', 'http://127.0.0.1:5173'], ['SUPABASE_URL', 'http://supabase.test'], ['SUPABASE_ANON_KEY', 'public-test-key'], ['INVITE_EMAIL_PROVIDER', 'mailpit'], ['INVITE_MAILPIT_URL', 'http://mailpit.test']])
let handler, verified = true, authorized = true, delivered = true, rpcCalls = 0, mailCalls = 0
globalThis.Deno = { env: { get: (key) => env.get(key) }, serve: (fn) => { handler = fn } }
globalThis.fetch = async (url) => {
  if (url.endsWith('/auth/v1/user')) return Response.json(verified ? { id: 'user', email_confirmed_at: '2026-09-12' } : {}, { status: verified ? 200 : 401 })
  if (url.endsWith('/rpc/create_project_invitation')) {
    rpcCalls++
    return Response.json(authorized ? [{ invitation_id: 'test-id', invitation_token: 'secret-link-token', recipient_email: 'recipient@example.test', project_name: 'Research', expires_at: '2026-09-19' }] : { code: '42501', message: 'Not owner' }, { status: authorized ? 200 : 403 })
  }
  if (url.endsWith('/api/v1/send')) { mailCalls++; return Response.json({}, { status: delivered ? 200 : 500 }) }
  throw new Error('Unexpected request')
}
const source = await readFile('supabase/functions/send-project-invitation/index.ts', 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText
await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
const request = (origin = 'http://127.0.0.1:5173', body = JSON.stringify({ projectId: '00000000-0000-0000-0000-000000000001', email: 'recipient@example.test', accessLevel: 'member' })) => new Request('http://function.test', { method: 'POST', headers: { Origin: origin, Authorization: 'Bearer test' }, body })
assert.equal((await handler(request('http://evil.test'))).status, 403)
verified = false
assert.equal((await handler(request())).status, 401)
assert.equal(rpcCalls, 0); assert.equal(mailCalls, 0)
verified = true
env.delete('INVITE_EMAIL_PROVIDER')
assert.equal((await handler(request())).status, 503)
assert.equal(rpcCalls, 0, 'Missing delivery config must not create invitations')
env.set('INVITE_EMAIL_PROVIDER', 'mailpit')
assert.equal((await handler(request(undefined, 'not-json'))).status, 400)
authorized = false
assert.equal((await handler(request())).status, 403)
assert.equal(mailCalls, 0, 'Unauthorized callers cannot send mail')
authorized = true; delivered = false
const failed = await handler(request())
assert.equal(failed.status, 502)
assert.match((await failed.json()).error, /Invitation saved, but email delivery could not be confirmed/)
delivered = true
const success = await handler(request())
assert.equal(success.status, 200)
const body = await success.json()
assert.equal(body.sent, true)
assert.ok(!JSON.stringify(body).includes('secret-link-token'), 'No invitation token in response')
console.log('PASS origin/auth rejection, missing config, input errors, owner checks, delivery failure, success response')
