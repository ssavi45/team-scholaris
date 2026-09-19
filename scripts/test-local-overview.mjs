import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import ts from 'typescript'

const env = parseEnv(await readFile('.env.local', 'utf8'))
assert.equal(env.VITE_SUPABASE_URL, 'http://127.0.0.1:54321', 'Local test only')
const sql = (input) => execFileSync('docker', ['exec', '-i', 'supabase_db_team-scholaris', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
sql('select 1;') // Check fixture access before creating accounts.
const ok = (result, label) => { assert.equal(result.error, null, `${label}: ${result.error?.message ?? ''}`); return result.data }
const requests = [], ids = [], clients = []
let failFiles = false, projectId
const client = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    if (url.pathname.startsWith('/rest/')) requests.push(url)
    if (failFiles && url.pathname === '/rest/v1/project_files') return Promise.resolve(new Response(JSON.stringify({ message: 'Test-only failure' }), { status: 503, headers: { 'Content-Type': 'application/json' } }))
    return fetch(input, init)
  } },
})
const moduleUrl = (source) => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText).toString('base64')
async function api(c) {
  globalThis.__overviewTestClient = c
  const projectSource = (await readFile('src/features/projects/projects-api.ts', 'utf8')).replace("import { supabase } from '../../lib/supabase'", `const supabase = globalThis.__overviewTestClient // ${randomUUID()}`)
  const projectUrl = moduleUrl(projectSource)
  const overviewSource = (await readFile('src/features/projects/overview-api.ts', 'utf8')).replace("import { supabase } from '../../lib/supabase'", 'const supabase = globalThis.__overviewTestClient').replace("import { loadProject } from './projects-api'", `import { loadProject } from '${projectUrl}'`)
  const module = await import(moduleUrl(overviewSource))
  delete globalThis.__overviewTestClient
  return (id = projectId, signal = new AbortController().signal) => module.loadOverview(id, signal)
}

try {
  const run = randomUUID().slice(0, 8)
  for (let n = 0; n < 3; n++) {
    const c = client(), email = `overview-test-${run}-${n}@example.test`, password = randomUUID() + 'Aa1!'
    clients.push(c)
    const user = ok(await c.auth.signUp({ email, password, options: { data: { name: `Overview tester ${n}` } } }), 'Signup').user
    assert.match(user.id, /^[a-f0-9-]{36}$/); ids.push(user.id)
    sql(`update auth.users set email_confirmed_at = now() where id = '${user.id}';`)
    ok(await c.auth.signInWithPassword({ email, password }), 'Sign in')
  }
  const [owner, viewer, outsider] = clients
  projectId = ok(await owner.rpc('create_project', { project_name: 'Overview fixture' }).single(), 'Create project').id
  const ownerOverview = await api(owner), viewerOverview = await api(viewer), outsiderOverview = await api(outsider)
  const empty = await ownerOverview()
  assert.equal(empty.paperCount, 0); assert.equal(empty.fileCount, 0)
  assert.deepEqual(empty.unavailable, [])
  assert.equal(empty.activity.length, 1); assert.equal(empty.activity[0].kind, 'project')
  assert.equal(await outsiderOverview(), null, 'Private metadata stays private')
  assert.equal(await ownerOverview('not-a-uuid'), null)
  sql(`insert into public.project_members(project_id,user_id,access_level) values ('${projectId}','${ids[1]}','viewer');`)
  ok(await owner.rpc('initialize_paper', { p_project_id: projectId }), 'Initialize paper')
  for (let n = 0; n < 10; n++) ok(await owner.rpc('create_paper_file', { p_project_id: projectId, p_path: `section${n}.tex` }), 'Create paper file')
  sql(`insert into public.paper_files(project_id,path,kind) values ('${projectId}','notes','folder');`)
  requests.length = 0
  const populated = await viewerOverview()
  assert.equal(populated.paperCount, 12, 'Count covers all files, excludes folders, and is not capped at preview limit')
  assert.equal(populated.members.length, 2)
  assert.equal(populated.activity.length, 8)
  assert.equal(populated.activity.every((a) => a.kind === 'paper'), true)
  for (const request of requests.filter((url) => /\/(paper_files|project_files|project_messages)$/.test(url.pathname))) {
    assert.equal(request.searchParams.get('limit'), '8')
    assert.doesNotMatch(request.searchParams.get('select'), /content|storage_path|\*/)
  }
  console.log('PASS empty state, full counts beyond preview limit, folder exclusion, viewer reads, metadata-only bounded queries')

  for (let n = 0; n < 10; n++) ok(await owner.from('project_messages').insert({ project_id: projectId, sender_id: ids[0], channel: 'experiments', content: `Private message body ${n}` }), 'Post message')
  const recent = await ownerOverview()
  assert.equal(recent.activity.length, 8)
  assert.equal(recent.activity.every((a) => a.kind === 'chat'), true, 'All eight newest items may come from one source')
  assert.equal(recent.activity.every((a) => a.label === 'Message posted in Experiments'), true)
  assert.equal(JSON.stringify(recent).includes('Private message body'), false)
  failFiles = true
  const partial = await ownerOverview()
  assert.equal(partial.fileCount, null, 'Failed reads must not report zero')
  assert.deepEqual(partial.unavailable, ['files'])
  assert.equal(partial.paperCount, 12)
  assert.equal(partial.activity.length, 8)
  failFiles = false
  console.log('PASS newest-first cross-source activity, no message bodies, partial failures preserve useful summaries')

  sql(`update public.projects set status = 'archived' where id = '${projectId}';`)
  assert.equal((await viewerOverview()).project.status, 'archived', 'Archived overview remains readable')
  ok(await viewer.rpc('leave_project', { p_project_id: projectId }), 'Leave archived project')
  assert.equal(await viewerOverview(), null, 'Existing session loses all overview access after departure')
  const controller = new AbortController(); controller.abort()
  await assert.rejects(ownerOverview(projectId, controller.signal), 'Canceled reads cannot return a new snapshot')
  console.log('PASS archived reads, revoked membership, cancellation')
  console.log('ALL OVERVIEW-02 LOCAL TESTS PASSED')
} finally {
  failFiles = false
  if (projectId) sql(`delete from public.projects where id = '${projectId}';`)
  for (const id of ids) sql(`delete from auth.users where id = '${id}';`)
  for (const c of clients) await c.auth.signOut()
}
