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
  const project = ok(await owner.rpc('create_project', { project_name: 'Paper test' }).single(), 'Create fixture project')
  const pid = project.id
  const init = (who) => who.rpc('initialize_paper', { p_project_id: pid })
  const read = (who) => who.from('paper_files').select('*').eq('project_id', pid).order('path')
  const add = (who, path) => who.rpc('create_paper_file', { p_project_id: pid, p_path: path }).single()
  const save = (who, file, content) => who.rpc('save_paper_file', { p_file_id: file.id, p_expected_version: file.version, p_content: content }).single()
  assert.ok((await init(member)).error, 'Nonmember cannot initialize')
  for (const result of await Promise.all([init(owner), init(owner)])) ok(result, 'Idempotent initialization')
  let files = ok(await read(owner), 'Read sources')
  assert.equal(files.length, 2)
  let main = files.find((file) => file.path === 'main.tex')
  assert.ok(main.content.startsWith(String.fromCharCode(92) + 'documentclass{article}'))
  assert.equal(ok(await read(member), 'Outsider isolation').length, 0)
  assert.ok((await read(client())).error, 'Anonymous source reads denied')
  sql(`insert into public.project_members(project_id,user_id,access_level) values ('${pid}','${ids[1]}','member'), ('${pid}','${ids[2]}','viewer');`)
  assert.equal(ok(await read(viewer), 'Viewer read').length, 2)
  for (const operation of [init(viewer), add(viewer, 'bad.tex'), save(viewer, main, 'bad')]) assert.ok((await operation).error, 'Viewer mutation denied')
  assert.ok((await owner.from('paper_files').update({ content: 'bypass' }).eq('id', main.id)).error, 'Direct mutation denied')
  assert.ok((await owner.rpc('require_paper_editor', { p_project_id: pid })).error, 'Private helper denied')
  for (const path of ['../escape.tex', '/absolute.tex', 'sections/../escape.tex', 'sections//file.tex', 'bad.exe', 'a'.repeat(241) + '.tex', 'main.tex/child.tex']) assert.ok((await add(owner, path)).error, path)
  ok(await add(member, 'sections/introduction.tex'), 'Member creates nested file')
  assert.ok((await add(owner, 'sections/introduction.tex')).error, 'Duplicate rejected')
  main = ok(await save(member, main, 'Member edit'), 'Member saves')
  assert.equal(main.version, 2)
  const races = await Promise.all([save(owner, main, 'Writer A'), save(member, main, 'Writer B')])
  assert.equal(races.filter((r) => !r.error).length, 1)
  assert.equal(races.find((r) => r.error).error.code, '40001')
  main = races.find((r) => !r.error).data
  assert.equal(ok(await owner.from('paper_files').select('*').eq('id', main.id).single(), 'Reload persistent save').content, main.content)
  assert.ok((await save(owner, main, 'x'.repeat(524289))).error, 'File size limit enforced')
  sql(`insert into public.paper_files(project_id,path,content) select '${pid}', 'quota-' || i || '.tex', repeat('x',524288) from generate_series(1,9) i;`)
  main = ok(await save(owner, main, 'x'.repeat(524288)), 'Exactly 5 MiB is allowed')
  sql(`update public.paper_files set content = 'x' where project_id = '${pid}' and path = 'references.bib';`)
  assert.ok((await save(owner, main, 'x'.repeat(524288))).error, 'Total source bytes capped at 5 MiB')
  sql(`delete from public.paper_files where project_id = '${pid}' and path like 'quota-%'; insert into public.paper_files(project_id,path) select '${pid}', 'quota-' || i || '.tex' from generate_series(1,97) i;`)
  assert.ok((await add(owner, 'overflow.tex')).error, 'File count capped at 100')
  sql(`delete from public.paper_files where project_id = '${pid}' and path like 'quota-%';`)
  sql(`update public.projects set status = 'archived' where id = '${pid}';`)
  assert.equal(ok(await read(viewer), 'Archived readable').length, 3)
  for (const operation of [init(owner), add(owner, 'archived.tex'), save(owner, main, 'bad')]) assert.ok((await operation).error, 'Archived mutation denied')
  sql(`update public.projects set status = 'active' where id = '${pid}'; delete from public.project_members where project_id = '${pid}' and user_id = '${ids[1]}';`)
  assert.equal(ok(await read(member), 'Removed member isolation').length, 0)
  assert.ok((await save(member, main, 'bad')).error, 'Removed member cannot save')
  sql(`update public.projects set deleted_at = now() where id = '${pid}';`)
  assert.equal(ok(await read(owner), 'Deleted project hidden').length, 0)
  assert.ok((await save(owner, main, 'bad')).error, 'Deleted project immutable')
  console.log('PASS paper initialization, persistence, concurrent saves, path validation, size limits, owner/member/viewer permissions, archive/delete/revoked access')
} finally {
  for (const c of clients) await c.auth.signOut()
  if (ids.length) {
    const list = ids.map((id) => `'${id}'`).join(',')
    sql(`delete from public.projects where owner_id in (${list}); delete from auth.users where id in (${list});`)
  }
}
