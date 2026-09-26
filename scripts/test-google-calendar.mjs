import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const env = parseEnv(await readFile('.env.local', 'utf8'))
assert.equal(env.VITE_SUPABASE_URL, 'http://127.0.0.1:54321', 'Local test only')

const sql = (input) => execFileSync('docker', ['exec', '-i', 'supabase_db_team-scholaris', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })

const client = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})

const ok = (result, label) => {
  assert.equal(result.error, null, `${label}: ${result.error?.message ?? ''}`)
  return result.data
}

let userId, projectId
const userClient = client()

try {
  console.log('1. Setting up test account...')
  const run = randomUUID().slice(0, 8)
  const email = `meet-test-${run}@example.test`
  const password = randomUUID() + 'Aa1!'
  const signup = ok(await userClient.auth.signUp({
    email,
    password,
    options: { data: { name: 'Dr. Meet Tester' } },
  }), 'Sign up')
  userId = signup.user.id
  sql(`update auth.users set email_confirmed_at = now() where id = '${userId}';`)
  const session = ok(await userClient.auth.signInWithPassword({ email, password }), 'Sign in')

  console.log('2. Creating test project...')
  const project = ok(await userClient.rpc('create_project', {
    project_name: 'Google Meet Test Project',
    project_description: 'Testing Google Meet integration',
  }).single(), 'Create project')
  projectId = project.id

  console.log('3. Testing action: status on google-calendar function...')
  const token = session.session.access_token
  const statusRes = await fetch('http://127.0.0.1:54321/functions/v1/google-calendar', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
      Origin: 'http://127.0.0.1:5173',
    },
    body: JSON.stringify({ action: 'status' }),
  })
  assert.equal(statusRes.status, 200, `Status HTTP code should be 200, got ${statusRes.status}`)
  const statusData = await statusRes.json()
  console.log('Status result:', statusData)
  assert.equal(statusData.configured, true, 'Google Calendar should be configured!')
  assert.equal(statusData.connected, false, 'Should not be connected initially')

  console.log('4. Testing action: connect on google-calendar function...')
  const connectRes = await fetch('http://127.0.0.1:54321/functions/v1/google-calendar', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
      Origin: 'http://127.0.0.1:5173',
    },
    body: JSON.stringify({ action: 'connect', projectId }),
  })
  assert.equal(connectRes.status, 200, `Connect HTTP code should be 200, got ${connectRes.status}`)
  const connectData = await connectRes.json()
  console.log('Connect URL:', connectData.url)
  const authUrl = new URL(connectData.url)
  assert.equal(authUrl.origin, 'https://accounts.google.com')
  assert.equal(authUrl.pathname, '/o/oauth2/v2/auth')
  assert.equal(authUrl.searchParams.get('client_id'), '306972654976-qm2gkgkmrsia45lvkm6647mdoq0tkcdm.apps.googleusercontent.com')
  assert.equal(authUrl.searchParams.get('redirect_uri'), 'http://127.0.0.1:54321/functions/v1/google-calendar/callback')
  assert.ok(authUrl.searchParams.get('state'))
  assert.ok(authUrl.searchParams.get('code_challenge'))

  console.log('5. Verifying oauth state recorded in database...')
  const states = JSON.parse(sql(`select json_agg(s) from (select user_id, project_id, expires_at from public.google_calendar_oauth_states where user_id = '${userId}') s;`))
  assert.equal(states?.length, 1)
  assert.equal(states[0].project_id, projectId)

  console.log('ALL GOOGLE CALENDAR SETUP TESTS PASSED CLEANLY!')
} finally {
  console.log('Cleaning up test fixtures...')
  if (projectId) {
    try { sql(`delete from public.projects where id = '${projectId}';`) } catch {}
  }
  if (userId) {
    try { sql(`delete from auth.users where id = '${userId}';`) } catch {}
  }
}

