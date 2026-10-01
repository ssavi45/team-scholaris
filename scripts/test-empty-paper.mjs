import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import ts from 'typescript'

const source = ts.transpileModule(await readFile('src/features/paper/file-tree.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { validateTree, chooseMainFile, removeEntries } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
const entries = [{ path: 'main.tex', kind: 'text', content: '' }, { path: 'reference.bib', kind: 'text', content: '' }]
const supporting = removeEntries(entries, 'main.tex')
assert.equal(chooseMainFile(supporting, 'main.tex'), '')
assert.equal(chooseMainFile([{ path: 'article.tex', kind: 'text', content: '' }], ''), 'article.tex')
validateTree([], ''); validateTree(supporting, '')
assert.throws(() => validateTree(entries, ''))
assert.throws(() => validateTree([], 'main.tex'))
console.log('PASS empty/support-only manifest validation and main-file selection')
if (!process.argv.includes('--local')) process.exit(0)

const env = parseEnv(await readFile('.env.local', 'utf8'))
assert.equal(env.VITE_SUPABASE_URL, 'http://127.0.0.1:54321', 'Local fixtures only')
const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const sql = query => execFileSync('docker', ['exec', '-i', 'supabase_db_team-scholaris', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
const ok = (result, label) => { assert.equal(result.error, null, label); return result.data }
let userId, projectId, viewerId
try {
  const email = `empty-${randomUUID()}@example.test`, password = randomUUID() + 'Aa1!'
  userId = ok(await client.auth.signUp({ email, password }), 'Fixture signup').user.id
  sql(`update auth.users set email_confirmed_at=now() where id='${userId}';`)
  ok(await client.auth.signInWithPassword({ email, password }), 'Fixture sign in')
  projectId = ok(await client.rpc('create_project', { project_name: 'Empty workspace test' }).single(), 'Create fixture project').id
  ok(await client.rpc('initialize_paper', { p_project_id: projectId }), 'Initialize')
  const state = async () => ({ files: ok(await client.from('paper_files').select('*').eq('project_id', projectId), 'Files'), settings: ok(await client.from('paper_workspaces').select('*').eq('project_id', projectId).single(), 'Settings') })
  const apply = (revision, files, main) => client.rpc('apply_paper_manifest', { p_project_id: projectId, p_revision: revision, p_entries: files, p_main_file: main })
  let current = await state()
  const checkpoint = ok(await client.rpc('create_paper_checkpoint', { p_project_id: projectId, p_revision: current.settings.revision, p_label: 'Before clear' }), 'Checkpoint')
  ok(await apply(current.settings.revision, [], ''), 'Clear all files')
  current = await state(); assert.equal(current.files.length, 0); assert.equal(current.settings.main_file, '')
  ok(await client.rpc('initialize_paper', { p_project_id: projectId }), 'Reopening must not recreate defaults')
  assert.equal((await state()).files.length, 0)
  const emptyCheckpoint = ok(await client.rpc('create_paper_checkpoint', { p_project_id: projectId, p_revision: current.settings.revision, p_label: 'Empty workspace' }), 'Empty checkpoint')
  ok(await client.rpc('restore_paper_history', { p_project_id: projectId, p_history_id: checkpoint, p_revision: current.settings.revision }), 'Recover cleared files')
  current = await state(); assert.ok(current.files.some(file => file.path === 'main.tex'))
  ok(await client.rpc('restore_paper_history', { p_project_id: projectId, p_history_id: emptyCheckpoint, p_revision: current.settings.revision }), 'Restore empty checkpoint')
  current = await state(); assert.equal(current.files.length, 0)
  ok(await apply(current.settings.revision, supporting, ''), 'Upload bibliography before main source')
  current = await state()
  assert.ok((await apply(current.settings.revision, entries, '')).error, 'Missing main selection still rejected when TeX exists')
  ok(await apply(current.settings.revision, entries, 'main.tex'), 'Repopulate empty workspace')
  // A viewer must not clear a workspace using the same RPC.
  await client.auth.signOut()
  const viewerEmail = `viewer-${randomUUID()}@example.test`, viewerPassword = randomUUID() + 'Aa1!'
  viewerId = ok(await client.auth.signUp({ email: viewerEmail, password: viewerPassword }), 'Viewer signup').user.id
  sql(`update auth.users set email_confirmed_at=now() where id='${viewerId}'; insert into public.project_members(project_id,user_id,access_level) values('${projectId}','${viewerId}','viewer');`)
  ok(await client.auth.signInWithPassword({ email: viewerEmail, password: viewerPassword }), 'Viewer sign in')
  current = await state()
  assert.ok((await apply(current.settings.revision, [], '')).error, 'Viewer delete denied')
  assert.equal((await state()).files.length, 2)
  console.log('PASS local clear/reopen/repopulate, support-only imports, history recovery, empty history restore and viewer rejection')
} finally {
  if (projectId) sql(`delete from public.projects where id='${projectId}';`)
  await client.auth.signOut()
  if (userId) sql(`delete from auth.users where id='${userId}';`)
  if (viewerId) sql(`delete from auth.users where id='${viewerId}';`)
}
