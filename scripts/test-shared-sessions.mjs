import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { parseEnv } from 'node:util'
import * as Y from 'yjs'
import { SharedSessionService, validateDocument } from '../server/coediting/session-service.mjs'

assert.ok(process.argv.includes('--local'), 'Explicit --local required; creates disposable local accounts only.')
const env = parseEnv(execFileSync(process.execPath, ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }))
assert.equal(env.API_URL, 'http://127.0.0.1:54321')
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, options)
const accounts = [], docs = []
const ok = (r, label) => { assert.equal(r.error, null, label); return r.data }
let project, file
try {
  for (let i = 0; i < 5; i++) {
    const email = `shared-${randomUUID()}@example.test`, password = randomUUID() + 'Aa1!'
    const user = ok(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'Create local account').user
    const client = createClient(env.API_URL, env.ANON_KEY, options)
    const session = ok(await client.auth.signInWithPassword({ email, password }), 'Sign in').session
    accounts.push({ id: user.id, client, token: session.access_token })
  }
  const owner = accounts[0]
  project = ok(await owner.client.rpc('create_project', { project_name: 'Shared session test' }).single(), 'Project').id
  ok(await owner.client.rpc('initialize_paper', { p_project_id: project }), 'Initialize')
  for (const account of accounts.slice(1)) ok(await admin.from('project_members').insert({ project_id: project, user_id: account.id, access_level: 'member' }), 'Membership')
  file = ok(await owner.client.from('paper_files').select('*').eq('project_id', project).eq('path', 'main.tex').single(), 'Source')
  const service = new SharedSessionService(admin, [project])
  await assert.rejects(new SharedSessionService(admin).enable(owner.token, file.id), /pilot/)
  await assert.rejects(service.read('invalid', file.id))
  assert.ok((await owner.client.rpc('paper_shared_session', { p_actor: owner.id, p_file: file.id, p_action: 'read' })).error, 'Client cannot impersonate trusted gateway')
  const enrolled = await service.enable(owner.token, file.id)
  assert.ok((await owner.client.rpc('save_paper_file', { p_file_id: file.id, p_content: 'old tab', p_expected_version: file.version })).error, 'Legacy autosave fenced')
  const workspace = ok(await owner.client.from('paper_workspaces').select('*').eq('project_id', project).single(), 'Workspace')
  assert.ok((await owner.client.rpc('apply_paper_manifest', { p_project_id: project, p_revision: workspace.revision, p_entries: [], p_main_file: '' })).error, 'Legacy delete-all fenced')
  const updates = accounts.map((_, index) => {
    const doc = new Y.Doc(); docs.push(doc)
    Y.applyUpdate(doc, Buffer.from(enrolled.session.state, 'base64'))
    const vector = Y.encodeStateVector(doc)
    doc.getText('source').insert(0, `Author ${index}\n`)
    return Y.encodeStateAsUpdate(doc, vector)
  })
  await Promise.all(accounts.map((account, index) => new SharedSessionService(admin, [project]).update(account.token, file.id, enrolled.session.epoch, updates[index])))
  let current = await service.read(owner.token, file.id)
  for (let i = 0; i < 5; i++) assert.ok(current.file.content.includes(`Author ${i}\n`), 'Every concurrent edit survives')
  assert.equal(current.session.sequence, 5)
  await service.update(owner.token, file.id, enrolled.session.epoch, updates[0])
  assert.equal((await service.read(owner.token, file.id)).session.sequence, 5, 'Lost ACK retry is idempotent')
  const restarted = new SharedSessionService(createClient(env.API_URL, env.SERVICE_ROLE_KEY, options), [project])
  assert.equal((await restarted.read(owner.token, file.id)).session.state, current.session.state, 'New gateway reads only durable state')
  await assert.rejects(service.update(owner.token, file.id, randomUUID(), updates[0]), /Session changed/)
  await assert.rejects(service.update(owner.token, file.id, enrolled.session.epoch, new Uint8Array([255,255])))
  await assert.rejects(validateDocument({ content: 'a'.repeat(524289) }))
  const evil = new Y.Doc(); evil.getMap('unexpected').set('x', 'y')
  await assert.rejects(service.update(owner.token, file.id, enrolled.session.epoch, Y.encodeStateAsUpdate(evil)))
  evil.destroy()
  ok(await admin.from('project_members').update({ access_level: 'viewer' }).eq('project_id', project).eq('user_id', accounts[1].id), 'Demote')
  assert.equal((await service.read(accounts[1].token, file.id)).editable, false)
  await assert.rejects(service.update(accounts[1].token, file.id, enrolled.session.epoch, updates[1]), /read-only/)
  ok(await admin.from('project_members').delete().eq('project_id', project).eq('user_id', accounts[2].id), 'Revoke')
  await assert.rejects(service.read(accounts[2].token, file.id), /unavailable/)
  ok(await admin.from('projects').update({ status: 'archived' }).eq('id', project), 'Archive')
  await assert.rejects(service.update(owner.token, file.id, enrolled.session.epoch, updates[0]), /read-only/)
  ok(await admin.from('projects').update({ status: 'active' }).eq('id', project), 'Reactivate fixture')
  await service.disable(owner.token, file.id)
  const next = await service.enable(owner.token, file.id)
  assert.notEqual(next.session.epoch, enrolled.session.epoch)
  await assert.rejects(service.update(owner.token, file.id, enrolled.session.epoch, updates[0]), /Session changed/)
  await service.disable(owner.token, file.id)
  current = await service.read(owner.token, file.id)
  ok(await owner.client.rpc('save_paper_file', { p_file_id: file.id, p_content: current.file.content + '\n% legacy restored', p_expected_version: current.file.version }), 'Rollback restores versioned editing')
  console.log('PASS five authenticated writers, durable CAS merge, duplicate retry, gateway recreation, schema limits, legacy fences, demotion/revocation/archive, rollback and epoch fencing')
} finally {
  for (const doc of docs) doc.destroy()
  if (project && file && accounts[0]) {
    await admin.from('projects').update({ status: 'active' }).eq('id', project)
    const service = new SharedSessionService(admin, [project])
    if ((await service.read(accounts[0].token, file.id)).session) await service.disable(accounts[0].token, file.id)
  }
  if (project) ok(await admin.from('projects').delete().eq('id', project), 'Cleanup fixture project')
  for (const account of accounts) ok(await admin.auth.admin.deleteUser(account.id), 'Cleanup fixture account')
}
