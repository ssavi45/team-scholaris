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
  const [a, b, c] = clients
  const create = (who, name) => who.rpc('create_project', { project_name: name, project_description: 'Research description' }).single()
  assert.ok((await create(client(), 'Anonymous')).error, 'Anonymous creation is denied')
  assert.ok((await create(a, '   ')).error, 'Blank names rejected')
  assert.ok((await create(a, 'x'.repeat(121))).error, 'Long names rejected')
  assert.ok((await a.rpc('create_project', { project_name: 'Long description', project_description: 'x'.repeat(5001) })).error)
  const project = ok(await create(a, '  Test research  '), 'Create project atomically')
  assert.equal(project.name, 'Test research')
  assert.equal(project.owner_id, ids[0])
  const members = ok(await a.from('project_members').select('*').eq('project_id', project.id), 'Read owner membership')
  assert.equal(members.length, 1)
  assert.equal(members[0].user_id, ids[0]); assert.equal(members[0].access_level, 'owner')
  assert.equal(ok(await b.from('projects').select('*').eq('id', project.id), 'Nonmember query').length, 0)
  assert.equal(ok(await b.from('project_members').select('*').eq('project_id', project.id), 'Nonmember membership query').length, 0)
  assert.ok((await client().from('projects').select('*')).error, 'Anonymous reads denied')
  assert.ok((await a.from('projects').insert({ name: 'Bypass', owner_id: ids[1] })).error, 'Direct inserts denied')
  assert.ok((await a.from('projects').update({ owner_id: ids[1] }).eq('id', project.id)).error, 'Ownership spoofing denied')
  assert.ok((await b.from('project_members').insert({ project_id: project.id, user_id: ids[1], access_level: 'owner' })).error, 'Self-join denied')
  assert.ok((await a.from('project_members').delete().eq('project_id', project.id)).error, 'Owner membership removal denied')
  assert.throws(() => sql(`delete from public.project_members where project_id = '${project.id}' and access_level = 'owner';`), 'Even privileged writes must preserve owner consistency')
  console.log('PASS validation, atomic owner creation, unauthorized isolation, privilege bypass rejection, owner invariant')

  sql(`insert into public.project_members(project_id,user_id,access_level,display_role) values ('${project.id}','${ids[1]}','member','Advisor'), ('${project.id}','${ids[2]}','viewer','Lead Author');`)
  for (const who of [b, c]) {
    assert.equal(ok(await who.from('projects').select('*').eq('id', project.id), 'Joined project visible').length, 1)
    assert.ok((await who.from('projects').update({ name: 'Forbidden' }).eq('id', project.id)).error, 'Display role grants no permissions')
  }
  // Eight simultaneous creates with four remaining slots: exactly four may commit.
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => create(a, `Concurrent ${i}`)))
  assert.equal(results.filter((r) => !r.error).length, 4, 'Concurrent requests cannot exceed the five-project cap')
  assert.equal(ok(await a.from('projects').select('id'), 'Dashboard after reload').length, 5)
  assert.equal((await create(a, 'Sixth')).error?.code, 'P0001')
  ok(await create(b, 'Own project despite membership'), 'Joined projects do not count against ownership')
  sql(`update public.projects set status = 'archived' where id = '${project.id}';`)
  assert.equal(ok(await b.from('projects').select('status').eq('id', project.id).single(), 'Archived readable').status, 'archived')
  assert.equal((await create(a, 'Still sixth')).error?.code, 'P0001', 'Archived projects count toward limit')
  sql(`update public.projects set deleted_at = now() where id = '${project.id}';`)
  assert.equal(ok(await a.from('projects').select('*').eq('id', project.id), 'Deleted projects hidden').length, 0)
  assert.equal(ok(await b.from('project_members').select('*').eq('project_id', project.id), 'Deleted memberships hidden').length, 0)
  console.log('PASS member/viewer reads, display-role separation, concurrent quota, joined allowance, archive/delete visibility')
} finally {
  for (const c of clients) await c.auth.signOut()
  if (ids.length) {
    const list = ids.map((id) => `'${id}'`).join(',')
    sql(`delete from public.projects where owner_id in (${list}); delete from auth.users where id in (${list});`)
  }
}
