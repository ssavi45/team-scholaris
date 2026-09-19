import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import ts from 'typescript'

const env = parseEnv(await readFile('.env.local', 'utf8'))
assert.equal(env.VITE_SUPABASE_URL, 'http://127.0.0.1:54321', 'Local tests only')

const client = () => createClient(
  env.VITE_SUPABASE_URL,
  env.VITE_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }
)

const sql = (query) => execFileSync(
  'docker',
  ['exec', '-i', 'supabase_db_team-scholaris', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
  { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
)

const ids = []
const clients = []
const run = randomUUID().slice(0, 8)
const ok = (result, label) => {
  assert.equal(result.error, null, `${label}: ${result.error?.message ?? ''}`)
  return result.data
}

let projectId
let unsubscribe

try {
  console.log('1. Setting up 4 test accounts (owner, member, viewer, stranger)...')
  for (let i = 0; i < 4; i++) {
    const c = client()
    clients.push(c)
    const email = `chat-test-${run}-${i}@example.test`
    const password = randomUUID() + 'Aa1!'
    const name = ['Alice Owner', 'Bob Member', 'Charlie Viewer', 'David Stranger'][i]
    const signup = ok(await c.auth.signUp({
      email,
      password,
      options: { data: { name } },
    }), `Create test account ${i}`)
    const id = signup.user.id
    ids.push(id)
    sql(`update auth.users set email_confirmed_at = now() where id = '${id}';`)
    ok(await c.auth.signInWithPassword({ email, password }), `Sign in test account ${i}`)
  }

  const [owner, member, viewer, stranger] = clients

  console.log('2. Owner creates a research project...')
  const project = ok(await owner.rpc('create_project', { project_name: 'Quantum Optics Discussion' }).single(), 'Create project')
  projectId = project.id

  console.log('3. Adding member and viewer roles to project...')
  sql(`insert into public.project_members (project_id, user_id, access_level) values ('${projectId}', '${ids[1]}', 'member'), ('${projectId}', '${ids[2]}', 'viewer');`)

  console.log('4. Owner posts first message...')
  const msg1 = ok(await owner.from('project_messages').insert({
    project_id: projectId,
    sender_id: ids[0],
    content: 'Welcome to the project! Please review the latest Hamiltonian derivation: $H = \\hbar \\omega (a^\\dagger a + 1/2)$',
  }).select().single(), 'Owner insert message')
  assert.equal(msg1.sender_id, ids[0])

  console.log('5. Member posts a response...')
  const msg2 = ok(await member.from('project_messages').insert({
    project_id: projectId,
    sender_id: ids[1],
    content: 'Looks great Alice, I checked the commutation relations.',
  }).select().single(), 'Member insert message')
  assert.equal(msg2.sender_id, ids[1])

  console.log('6. Stranger attempts to post message (must be denied by RLS)...')
  const strangerPost = await stranger.from('project_messages').insert({
    project_id: projectId,
    sender_id: ids[3],
    content: 'Unauthorized spam message',
  }).select()
  assert.ok(strangerPost.error, 'Stranger should fail to post')

  console.log('7. Viewer attempts to post message (must be denied - viewers are read-only)...')
  const viewerPost = await viewer.from('project_messages').insert({
    project_id: projectId,
    sender_id: ids[2],
    content: 'Can I write here as viewer?',
  }).select()
  assert.ok(viewerPost.error, 'Viewer should fail to post to chat')

  console.log('8. Verifying RPC get_project_messages returns enriched messages...')
  const { data: messages, error: rpcErr } = await viewer.rpc('get_project_messages', {
    p_project_id: projectId,
    p_limit: 50,
  })
  assert.equal(rpcErr, null)
  assert.equal(messages.length, 2)
  assert.equal(messages[0].content, 'Welcome to the project! Please review the latest Hamiltonian derivation: $H = \\hbar \\omega (a^\\dagger a + 1/2)$')
  assert.equal(messages[0].sender_name, 'Alice Owner')
  assert.equal(messages[1].content, 'Looks great Alice, I checked the commutation relations.')
  assert.equal(messages[1].sender_name, 'Bob Member')

  console.log('8a. Verify message identity and content cannot be rewritten through UPDATE...')
  assert.ok((await owner.from('project_messages').update({ sender_id: ids[1], content: 'Forged author' }).eq('id', msg1.id)).error)
  assert.ok((await member.from('project_messages').update({ content: 'Rewritten' }).eq('id', msg2.id)).error)
  sql(`update public.project_members set access_level = 'viewer' where project_id = '${projectId}' and user_id = '${ids[1]}';`)
  const demotedDelete = ok(await member.from('project_messages').delete().eq('id', msg2.id).select(), 'Demoted sender delete query')
  assert.equal(demotedDelete.length, 0, 'Demoted viewers cannot delete their earlier messages')
  sql(`update public.project_members set access_level = 'member' where project_id = '${projectId}' and user_id = '${ids[1]}';`)

  console.log('8b. Testing multi-channel filtering (experiments vs discussion)...')
  const expMsg = ok(await owner.from('project_messages').insert({
    project_id: projectId,
    sender_id: ids[0],
    channel: 'experiments',
    content: 'Initial Monte Carlo simulation converged in 4.2 seconds.',
  }).select().single(), 'Insert experiment message')

  const { data: expOnly } = await viewer.rpc('get_project_messages', {
    p_project_id: projectId,
    p_limit: 50,
    p_channel: 'experiments',
  })
  assert.equal(expOnly?.length, 1)
  assert.equal(expOnly[0].id, expMsg.id)

  const { data: discOnly } = await viewer.rpc('get_project_messages', {
    p_project_id: projectId,
    p_limit: 50,
    p_channel: 'discussion',
  })
  assert.equal(discOnly?.length, 2)
  // Clean up experiment message so subsequent count assertions remain clean
  await owner.from('project_messages').delete().eq('id', expMsg.id)

  console.log('9. Stranger attempts to call get_project_messages (must be denied)...')
  const strangerFetch = await stranger.rpc('get_project_messages', {
    p_project_id: projectId,
    p_limit: 50,
  })
  assert.ok(strangerFetch.error, 'Stranger should not access get_project_messages')

  console.log('10. Member deletes their own message...')
  const delMemberOwn = await member.from('project_messages').delete().eq('id', msg2.id)
  assert.equal(delMemberOwn.error, null)

  console.log('11. Member attempts to delete Owner message (must fail or affect 0 rows)...')
  const delOwnerByMember = await member.from('project_messages').delete().eq('id', msg1.id).select()
  // Under RLS delete returning, if policy does not match, 0 rows returned
  assert.equal(delOwnerByMember.data?.length ?? 0, 0, 'Member cannot delete owner message')

  console.log('12. Owner deletes remaining message (allowed as project owner)...')
  const delOwner = await owner.from('project_messages').delete().eq('id', msg1.id).select()
  assert.equal(delOwner.error, null)
  assert.equal(delOwner.data?.length, 1, 'Owner can delete project message')

  console.log('13. Verifying chat stream is now empty...')
  const { data: finalMessages } = await owner.rpc('get_project_messages', {
    p_project_id: projectId,
    p_limit: 50,
  })
  assert.equal(finalMessages?.length ?? 0, 0)

  console.log('14. Verify newest-window ordering and bounded limits with more than 100 messages...')
  sql(`insert into public.project_messages(project_id, sender_id, content, created_at)
    select '${projectId}', '${ids[0]}', 'History ' || n, now() - interval '1 day' + n * interval '1 second' from generate_series(1, 120) n;`)
  const recent = ok(await viewer.rpc('get_project_messages', { p_project_id: projectId, p_limit: 1000, p_channel: 'discussion' }), 'Latest messages')
  assert.equal(recent.length, 100)
  assert.equal(recent[0].content, 'History 21')
  assert.equal(recent.at(-1).content, 'History 120')
  assert.equal(ok(await viewer.rpc('get_project_messages', { p_project_id: projectId, p_limit: -1 }), 'Negative limit clamped').length, 1)

  console.log('15. Exercise the actual frontend subscription against local Realtime...')
  const source = (await readFile('src/features/chat/chat-api.ts', 'utf8')).replace("import { supabase } from '../../lib/supabase'", 'const supabase = globalThis.__chatTestClient')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText
  globalThis.__chatTestClient = viewer
  const api = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
  delete globalThis.__chatTestClient
  let refreshes = 0
  const deletedIds = []
  let connected = false
  const waitUntil = async (check, label) => {
    const deadline = Date.now() + 15000
    while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100))
    assert.ok(check(), label)
  }
  unsubscribe = api.subscribeProjectChat(projectId, () => { refreshes++ }, (id) => deletedIds.push(id), (state) => { connected = state === 'connected' })
  await waitUntil(() => connected, 'Realtime connects')
  const beforeInsert = refreshes
  const live = ok(await member.from('project_messages').insert({ project_id: projectId, sender_id: ids[1], content: 'Live message after 120 records' }).select().single(), 'Live insert')
  await waitUntil(() => refreshes > beforeInsert, 'Insert triggers reconciliation after more than five messages')
  assert.equal((await api.loadProjectMessages(projectId, 100, undefined, 'discussion')).at(-1).id, live.id)
  ok(await owner.from('project_messages').delete().eq('id', live.id), 'Owner moderates member message')
  await waitUntil(() => deletedIds.includes(live.id), 'Delete arrives with RLS and only the primary key')
  sql(`update public.projects set status = 'archived' where id = '${projectId}';`)
  assert.ok((await member.from('project_messages').insert({ project_id: projectId, sender_id: ids[1], content: 'Archived write' })).error)
  assert.equal(ok(await member.from('project_messages').delete().eq('project_id', projectId).select(), 'Archived delete').length, 0)

  console.log('All CHAT-01 integration tests passed successfully!')
} finally {
  unsubscribe?.()
  await Promise.all(clients.map((c) => c.removeAllChannels()))
  console.log('Cleaning up fixtures...')
  if (projectId) {
    try { sql(`delete from public.projects where id = '${projectId}';`) } catch {}
  }
  for (const id of ids) {
    try { sql(`delete from auth.users where id = '${id}';`) } catch {}
  }
}
