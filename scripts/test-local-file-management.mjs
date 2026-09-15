import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'

const env = parseEnv(await readFile('.env.local', 'utf8'))
assert.equal(env.VITE_SUPABASE_URL, 'http://127.0.0.1:54321', 'Local tests only')
const client = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
const sql = (query) => execFileSync('docker', ['exec', '-i', 'supabase_db_team-scholaris', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
const ids = []
const clients = []
const run = randomUUID().slice(0, 8)
const ok = (result, label) => { assert.equal(result.error, null, label); return result.data }
let projectId; const uploaded = [];
try {
  for (let i = 0; i < 3; i++) {
    const c = client(); clients.push(c)
    const email = `project-test-${run}-${i}@example.test`
    const password = randomUUID() + 'Aa1!'
    const signup = ok(await c.auth.signUp({ email, password }), 'Create local test account')
    const id = signup.user.id; ids.push(id)
    assert.match(id, /^[a-f0-9-]{36}$/)
    // Administrative fixture setup only. Application requests below use public credentials.
    sql(`update auth.users set email_confirmed_at = now() where id = '${id}';`)
    ok(await c.auth.signInWithPassword({ email, password }), 'Sign in test account')
  }
  const [owner, member, viewer] = clients
  const project = ok(await owner.rpc('create_project', { project_name: 'File tree test' }).single(), 'Create fixture')
  const pid = projectId = project.id
  ok(await owner.rpc('initialize_paper', { p_project_id: pid }), 'Initialize')
  const read = async () => ({ files: ok(await owner.from('paper_files').select('*').eq('project_id', pid), 'Read tree'), settings: ok(await owner.from('paper_workspaces').select('*').eq('project_id', pid).single(), 'Read settings') })
  const apply = (who, state, entries = state.files, main = state.settings.main_file) => who.rpc('apply_paper_manifest', { p_project_id: pid, p_revision: state.settings.revision, p_entries: entries, p_main_file: main })
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=', 'base64'))
  const asset = pid + '/' + randomUUID() + '.png'; uploaded.push(asset)
  assert.ok((await member.storage.from('paper-figures').upload(asset, png, { contentType: 'image/png' })).error, 'Outsider upload denied')
  assert.ok((await member.storage.from('paper-figures').download(asset)).error, 'Outsider figure read denied')
  sql(`insert into public.project_members(project_id,user_id,access_level) values ('${pid}','${ids[1]}','member'), ('${pid}','${ids[2]}','viewer');`)
  assert.ok((await viewer.storage.from('paper-figures').upload(asset, png, { contentType: 'image/png' })).error, 'Viewer upload denied')
  ok(await owner.storage.from('paper-figures').upload(asset, png, { contentType: 'image/png' }), 'Private figure upload')
  assert.ok((await viewer.storage.from('paper-figures').download(asset)).error, 'Uncommitted figure not visible to viewer')
  let state = await read()
  assert.ok((await apply(viewer, state)).error, 'Viewer tree changes denied')
  const entry = { path: 'figures/plot.png', content: '', kind: 'image', storage_path: asset }
  const tree = [...state.files.map(f => f.path === 'main.tex' ? {...f,path:'paper.tex'} : f), {path:'figures',kind:'folder',content:''}, entry]
  ok(await apply(member, state, tree, 'paper.tex'), 'Atomic rename, figure registration, folder creation and main selection')
  assert.ok((await apply(owner, state)).error, 'Stale manifest rejected')
  state = await read()
  assert.equal(state.settings.main_file, 'paper.tex')
  assert.equal(state.files.length, 4)
  assert.equal(ok(await viewer.storage.from('paper-figures').download(asset), 'Viewer can read committed figure').size, png.length)
  assert.ok((await owner.storage.from('paper-figures').upload(asset, png, { contentType: 'image/png', upsert:true })).error, 'Registered figure is immutable')
  await owner.storage.from('paper-figures').remove([asset])
  ok(await owner.storage.from('paper-figures').download(asset), 'Referenced figure cannot be deleted through Storage')
  assert.ok((await apply(owner, state, [...state.files,{path:'../bad.tex',kind:'text',content:''}])).error, 'Traversal rejected')
  assert.ok((await apply(owner, state, [...state.files,{path:'PAPER.tex',kind:'text',content:''}])).error, 'Case collision rejected')
  assert.ok((await apply(owner, state, state.files, 'missing.tex')).error, 'Missing main rejected')
  assert.equal((await read()).settings.revision, state.settings.revision, 'Failed operations preserve revision')
  const text = state.files.find(f=>f.path==='paper.tex')
  ok(await member.rpc('save_paper_file',{p_file_id:text.id,p_expected_version:text.version,p_content:'New edit'}), 'Concurrent source save')
  assert.ok((await apply(owner,state)).error, 'Import cannot overwrite intervening source save')
  state=await read()
  const image=state.files.find(f=>f.kind==='image')
  assert.ok((await owner.rpc('save_paper_file',{p_file_id:image.id,p_expected_version:image.version,p_content:''})).error, 'Image cannot use source-save RPC')
  ok(await owner.rpc('create_paper_file',{p_project_id:pid,p_path:'figures/caption.tex'}), 'Create source inside explicit folder')
  state=await read()
  sql(`update public.projects set status='archived' where id='${pid}';`)
  assert.ok((await apply(owner,state)).error, 'Archived tree is immutable')
  ok(await viewer.storage.from('paper-figures').download(asset), 'Archived figure readable')
  sql(`update public.projects set status='active' where id='${pid}';`)
  state=await read()
  ok(await apply(owner,state,state.files.filter(f=>!f.path.startsWith('figures'))), 'Folder deletion removes descendants atomically')
  ok(await owner.storage.from('paper-figures').remove([asset]), 'Unreferenced figure cleanup')
  assert.ok((await owner.storage.from('paper-figures').download(asset)).error, 'Deleted figure absent')
  console.log('PASS atomic tree changes, revisions, main selection, conflicts, folders, private figure upload/read/immutability/cleanup, viewer and archive restrictions')
} finally {
  if(projectId && clients[0]) { sql(`update public.projects set status='active',deleted_at=null where id='${projectId}'; delete from public.paper_files where project_id='${projectId}';`); if(uploaded.length) await clients[0].storage.from('paper-figures').remove(uploaded) }
  for(const c of clients) await c.auth.signOut()
  if(ids.length) { const list=ids.map(id=>`'${id}'`).join(','); sql(`delete from public.projects where owner_id in (${list}); delete from auth.users where id in (${list});`) }
}
