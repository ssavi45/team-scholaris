import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import ts from 'typescript'

const env = parseEnv(await readFile('.env.local', 'utf8'))
assert.equal(env.VITE_SUPABASE_URL, 'http://127.0.0.1:54321', 'Local fixtures only')
const client = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
const sql = (input) => execFileSync('docker', ['exec', '-i', 'supabase_db_team-scholaris', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
const ok = (result, label) => { assert.equal(result.error, null, `${label}: ${result.error?.message ?? ''}`); return result.data }
const denied = (result, label) => assert.ok(result.error, label)
const run = randomUUID().slice(0, 8), ids = [], clients = []
const email = (n) => `team-test-${run}-${n}@example.test`
let projectId, storagePath

// Fail before signup if Docker is unavailable, avoiding orphaned fixture users.
sql('select 1;')

try {
  for (let n = 0; n < 4; n++) {
    const c = client(), password = randomUUID() + 'Aa1!'; clients.push(c)
    const user = ok(await c.auth.signUp({ email: email(n), password, options: { data: { name: `Team tester ${n}` } } }), 'Sign up').user
    assert.match(user.id, /^[a-f0-9-]{36}$/); ids.push(user.id)
    sql(`update auth.users set email_confirmed_at = now() where id = '${user.id}';`)
    ok(await c.auth.signInWithPassword({ email: email(n), password }), 'Sign in')
  }
  const [owner, member, viewer, outsider] = clients
  projectId = ok(await owner.rpc('create_project', { project_name: 'Team regression fixture' }).single(), 'Create project').id
  const invite = async (n, access) => ok(await owner.rpc('create_project_invitation', { p_project_id: projectId, p_email: email(n), p_access_level: access }).single(), 'Invite')
  const invitation = await invite(1, 'member')
  ok(await member.rpc('accept_project_invitation', { p_token: invitation.invitation_token }), 'Accept member')
  const viewerInvite = await invite(2, 'viewer')
  ok(await viewer.rpc('accept_project_invitation', { p_token: viewerInvite.invitation_token }), 'Accept viewer')
  const team = async () => ok(await owner.rpc('get_project_team', { p_project_id: projectId }), 'Load team')
  const find = async (n) => (await team()).find((m) => m.user_id === ids[n])
  const args = (n, access = 'viewer', role = null, expected = 'member', expectedRole = null) => ({ p_project_id: projectId, p_user_id: ids[n], p_access_level: access, p_display_role: role, p_expected_access_level: expected, p_expected_display_role: expectedRole })
  const remove = (n, expected = 'member') => ({ p_project_id: projectId, p_user_id: ids[n], p_expected_access_level: expected })

  // Exercise the actual frontend API against the local database.
  const source = (await readFile('src/features/team/team-api.ts', 'utf8')).replace("import { supabase } from '../../lib/supabase'", 'const supabase = globalThis.__teamTestClient')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText
  globalThis.__teamTestClient = owner
  const api = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
  delete globalThis.__teamTestClient

  for (const c of [member, viewer, outsider, client()]) {
    denied(await c.rpc('update_project_member', args(1)), 'Only owner can edit access')
    denied(await c.rpc('remove_project_member', remove(1)), 'Only owner can remove others')
  }
  denied(await outsider.rpc('leave_project', { p_project_id: projectId }), 'Outsider cannot leave')
  denied(await owner.from('project_members').update({ access_level: 'owner' }).eq('project_id', projectId), 'No direct membership writes')
  denied(await owner.rpc('update_project_member', args(1, 'owner')), 'Cannot create another owner')
  denied(await owner.rpc('update_project_member', args(0, 'member', null, 'owner')), 'Cannot demote owner')
  denied(await owner.rpc('remove_project_member', remove(0, 'owner')), 'Cannot remove owner')
  denied(await owner.rpc('leave_project', { p_project_id: projectId }), 'Cannot leave as owner')
  denied(await owner.rpc('update_project_member', args(1, 'admin')), 'Invalid access denied')
  denied(await owner.rpc('update_project_member', args(1, 'member', 'x'.repeat(121))), 'Role length enforced')
  sql(`update auth.users set email_confirmed_at = null where id = '${ids[0]}';`)
  denied(await owner.rpc('update_project_member', args(1)), 'Unverified caller denied despite existing session')
  sql(`update auth.users set email_confirmed_at = now() where id = '${ids[0]}';`)
  await api.updateMember(projectId, await find(0), 'owner', ' Supervisor ')
  assert.equal((await find(0)).display_role, 'Supervisor')
  console.log('PASS owner/verified-identity checks, direct-write protection, owner invariants, research-role validation')

  // Create real contributions before changing access, using only browser-safe credentials.
  ok(await member.rpc('initialize_paper', { p_project_id: projectId }), 'Initialize paper')
  const paper = ok(await member.from('paper_files').select('*').eq('project_id', projectId).eq('path', 'main.tex').single(), 'Read paper')
  const message = ok(await member.from('project_messages').insert({ project_id: projectId, sender_id: ids[1], content: 'Contribution preserved after departure' }).select().single(), 'Write chat')
  const fileId = randomUUID(), bytes = Buffer.from('Team fixture')
  storagePath = `${projectId}/${fileId}-team.txt`
  ok(await member.storage.from('project-files').upload(storagePath, bytes, { contentType: 'text/plain' }), 'Upload file')
  ok(await member.from('project_files').insert({ id: fileId, project_id: projectId, name: 'team.txt', storage_path: storagePath, size_bytes: bytes.length, mime_type: 'text/plain', uploaded_by: ids[1] }), 'Register upload')
  const oldMember = await find(1)
  await api.updateMember(projectId, oldMember, 'viewer', 'Lead author')
  assert.equal((await find(1)).access_level, 'viewer')
  await assert.rejects(api.updateMember(projectId, oldMember, 'member', ''), /membership changed/i, 'Stale frontend edit rejected')
  denied(await owner.rpc('remove_project_member', remove(1)), 'Stale removal rejected')
  denied(await member.rpc('save_paper_file', { p_file_id: paper.id, p_content: 'forbidden', p_expected_version: paper.version }), 'Cached session cannot save after demotion')
  denied(await member.from('project_messages').insert({ project_id: projectId, sender_id: ids[1], content: 'forbidden' }), 'Demoted author cannot chat')
  denied(await member.storage.from('project-files').upload(`${projectId}/${randomUUID()}-denied.txt`, bytes), 'Demoted member cannot upload')
  assert.equal(ok(await member.from('project_files').update({ name: 'forbidden.txt' }).eq('id', fileId).select(), 'Rename check').length, 0, 'Demoted uploader cannot rename old file')
  ok(await member.storage.from('project-files').download(storagePath), 'Viewer can still download')
  assert.equal(ok(await member.rpc('get_project_messages', { p_project_id: projectId }), 'Viewer can read').length, 1)
  console.log('PASS demotion blocks Paper/Files/Chat writes in existing session, preserves reads, rejects stale edits')

  // Same snapshot used concurrently: exactly one edit wins.
  const races = await Promise.all([owner.rpc('update_project_member', args(1, 'member', 'Editor A', 'viewer', 'Lead author')), owner.rpc('update_project_member', args(1, 'member', 'Editor B', 'viewer', 'Lead author'))])
  assert.equal(races.filter((r) => !r.error).length, 1)
  assert.equal(races.filter((r) => r.error?.code === '40001').length, 1)
  await api.removeMember(projectId, await find(1))
  assert.equal(ok(await member.from('projects').select('id').eq('id', projectId), 'Removed project read').length, 0)
  assert.equal(ok(await member.from('paper_files').select('id').eq('project_id', projectId), 'Removed paper read').length, 0)
  denied(await member.rpc('get_project_team', { p_project_id: projectId }), 'Removed team denied')
  denied(await member.rpc('get_project_messages', { p_project_id: projectId }), 'Removed chat denied')
  denied(await member.rpc('get_project_files', { p_project_id: projectId }), 'Removed files denied')
  denied(await member.storage.from('project-files').download(storagePath), 'Removed storage access denied')
  denied(await member.rpc('accept_project_invitation', { p_token: invitation.invitation_token }), 'Used invitation cannot undo removal')
  const history = ok(await owner.rpc('get_project_messages', { p_project_id: projectId }), 'History remains')
  assert.equal(history.find((m) => m.id === message.id).sender_name, 'Team tester 1')
  const files = ok(await owner.rpc('get_project_files', { p_project_id: projectId }), 'Upload attribution remains')
  assert.equal(files.find((f) => f.id === fileId).uploaded_by, ids[1])
  assert.equal(files.find((f) => f.id === fileId).uploader_name, 'Team tester 1')
  assert.equal(ok(await owner.from('paper_files').select('content').eq('id', paper.id).single(), 'Paper retained').content, paper.content)
  console.log('PASS concurrent updates, removal revokes project/paper/chat/file access, old invite cannot rejoin, contributions retained')

  sql(`update public.projects set status = 'archived' where id = '${projectId}';`)
  denied(await owner.rpc('update_project_member', args(2, 'member', null, 'viewer')), 'Archived edit denied')
  denied(await owner.rpc('remove_project_member', remove(2, 'viewer')), 'Archived removal denied')
  denied(await owner.rpc('leave_project', { p_project_id: projectId }), 'Archived owner cannot leave')
  ok(await viewer.rpc('leave_project', { p_project_id: projectId }), 'Viewer may leave an archived project')
  sql(`update public.projects set status = 'active' where id = '${projectId}'; update public.project_invitations set created_at = now() - interval '2 minutes' where project_id = '${projectId}';`)
  denied(await viewer.rpc('accept_project_invitation', { p_token: viewerInvite.invitation_token }), 'Old invite cannot undo leaving')
  const fresh = await invite(1, 'member')
  ok(await member.rpc('accept_project_invitation', { p_token: fresh.invitation_token }), 'Fresh invitation can rejoin')
  ok(await member.rpc('leave_project', { p_project_id: projectId }), 'Member can leave active project')
  assert.equal((await team()).length, 1, 'Owner remains after everyone leaves')
  console.log('PASS archived rules, member/viewer leave, owner retained, explicit fresh invitation can rejoin')
  console.log('ALL TEAM-01 LOCAL TESTS PASSED')
} finally {
  if (projectId) {
    sql(`update public.projects set status = 'active' where id = '${projectId}'; delete from public.project_files where project_id = '${projectId}';`)
    if (storagePath) ok(await clients[0].storage.from('project-files').remove([storagePath]), 'Remove fixture object')
    sql(`delete from public.projects where id = '${projectId}';`)
  }
  for (const id of ids) sql(`delete from auth.users where id = '${id}';`)
  for (const c of clients) await c.auth.signOut()
}
