import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { parseEnv } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import * as Y from 'yjs'
import { SharedSessionService } from '../server/coediting/session-service.mjs'

assert.ok(process.argv.includes('--local'), 'Disposable local fixtures only.')
const env = parseEnv(execFileSync(process.execPath, ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
assert.equal(env.API_URL, 'http://127.0.0.1:54321')
const config = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, config)
const accounts = [], docs = [], leases = []
const ok = (result, label) => { assert.equal(result.error, null, label); return result.data }
let project, file, asset, service
try {
  for (let i = 0; i < 5; i++) {
    const email = `snapshot-${randomUUID()}@example.test`, password = randomUUID() + 'Aa1!'
    const user = ok(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'Create account').user
    const client = createClient(env.API_URL, env.ANON_KEY, config)
    const session = ok(await client.auth.signInWithPassword({ email, password }), 'Sign in').session
    accounts.push({ id: user.id, client, token: session?.access_token })
  }
  const owner = accounts[0]
  project = ok(await owner.client.rpc('create_project', { project_name: 'Snapshot test' }).single(), 'Project').id
  ok(await owner.client.rpc('initialize_paper', { p_project_id: project }), 'Initialize')
  for (const account of accounts.slice(1, 4)) ok(await admin.from('project_members').insert({ project_id: project, user_id: account.id, access_level: account === accounts[3] ? 'viewer' : 'member' }), 'Membership')
  file = ok(await owner.client.from('paper_files').select('*').eq('project_id', project).eq('path', 'main.tex').single(), 'Main')
  let other = ok(await owner.client.rpc('create_paper_file', { p_project_id: project, p_path: 'sections/method.tex' }).single(), 'Second source')
  asset = `${project}/${randomUUID()}.png`
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
  ok(await owner.client.storage.from('paper-figures').upload(asset, png, { contentType: 'image/png' }), 'Figure upload')
  const workspace = ok(await owner.client.from('paper_workspaces').select('revision').eq('project_id', project).single(), 'Workspace')
  const entries = ok(await owner.client.from('paper_files').select('*').eq('project_id', project), 'Sources')
  ok(await owner.client.rpc('apply_paper_manifest', { p_project_id: project, p_revision: workspace.revision, p_main_file: 'main.tex', p_entries: [...entries, { path: 'figures/sample.png', kind: 'image', content: '', storage_path: asset }] }), 'Add figure')
  file = ok(await owner.client.from('paper_files').select('*').eq('id', file.id).single(), 'Refresh main version')
  other = ok(await owner.client.from('paper_files').select('*').eq('id', other.id).single(), 'Refresh second version')
  service = new SharedSessionService(admin, [project])
  const initial = await service.enable(owner.token, file.id)
  const capture = async (account = owner, cut = {}) => {
    const snapshot = ok(await account.client.rpc('capture_paper_snapshot', { p_project: project, ...cut }), 'Capture')
    leases.push({ id: snapshot.id, client: account.client }); return snapshot
  }
  const baseline = await capture()
  const frozen = JSON.stringify(baseline)
  // Writes to two sources race with six multi-file captures. Each snapshot's
  // project revision must agree with its saved source versions and CRDT sequences.
  const writers = accounts.slice(0, 3).map((account, index) => {
    const doc = new Y.Doc(); docs.push(doc); Y.applyUpdate(doc, Buffer.from(initial.session.state, 'base64'))
    const vector = Y.encodeStateVector(doc); doc.getText('source').insert(0, `% Author ${index}\n`)
    return service.update(account.token, file.id, initial.session.epoch, Y.encodeStateAsUpdate(doc, vector))
  })
  writers.push(owner.client.rpc('save_paper_file', { p_file_id: other.id, p_content: '% method revised', p_expected_version: other.version }).then(result => ok(result, 'Other source write')))
  const captures = Array.from({ length: 6 }, () => capture())
  const results = await Promise.all([...writers, ...captures])
  for (const snapshot of results.slice(writers.length)) {
    const main = snapshot.files.find(entry => entry.id === file.id), method = snapshot.files.find(entry => entry.id === other.id)
    const sequence = snapshot.shared.find(clock => clock.fileId === file.id).sequence
    assert.equal(main.version, file.version + sequence, 'Text version and shared clock agree')
    assert.equal(snapshot.revision - baseline.revision, (main.version - file.version) + (method.version - other.version), 'Revision covers exactly the captured writes')
    assert.equal(snapshot.main, 'main.tex')
  }
  assert.equal(JSON.stringify(baseline), frozen, 'Later edits never mutate a captured copy')
  const current = await service.read(owner.token, file.id)
  const cut = { p_file: file.id, p_epoch: current.session.epoch, p_sequence: current.session.sequence }
  const acknowledged = await capture(owner, cut)
  assert.ok(acknowledged.files.find(entry => entry.id === file.id).content.includes('Author 2'))
  assert.ok((await owner.client.rpc('capture_paper_snapshot', { p_project: project, ...cut, p_sequence: current.session.sequence + 1 })).error, 'Future ACK rejected')
  assert.ok((await owner.client.rpc('capture_paper_snapshot', { p_project: project, ...cut, p_epoch: randomUUID() })).error, 'Old epoch rejected')
  assert.ok((await owner.client.rpc('capture_paper_snapshot', { p_project: project, p_file: file.id })).error, 'Partial cut rejected')
  await capture(accounts[3]) // Viewers may compile/read saved source, never mutate it.
  assert.ok((await accounts[4].client.rpc('capture_paper_snapshot', { p_project: project })).error, 'Outsider denied')
  assert.ok((await accounts[3].client.from('paper_snapshot_leases').select('*')).error, 'No direct lease access')
  ok(await admin.from('project_members').delete().eq('project_id', project).eq('user_id', accounts[3].id), 'Revoke viewer')
  assert.ok((await accounts[3].client.rpc('capture_paper_snapshot', { p_project: project })).error, 'Removed viewer denied')
  assert.ok((await accounts[3].client.storage.from('paper-figures').download(asset)).error, 'Lease does not grant revoked asset access')
  ok(await admin.from('projects').update({ status: 'archived' }).eq('id', project), 'Archive fixture')
  await capture()
  ok(await admin.from('projects').update({ status: 'active' }).eq('id', project), 'Unarchive fixture')
  await service.disable(owner.token, file.id)
  assert.ok((await owner.client.rpc('capture_paper_snapshot', { p_project: project, ...cut })).error, 'Ended session cut rejected')
  // Remove live/history references only in this generated fixture to isolate the
  // lease. The existing deletion guard must keep its asset until hydration ends.
  ok(await admin.from('paper_files').delete().eq('project_id', project).eq('storage_path', asset), 'Remove fixture image')
  ok(await admin.from('paper_history').delete().eq('project_id', project), 'Remove fixture history')
  assert.equal(ok(await owner.client.rpc('paper_figure_referenced', { p_name: asset }), 'Lease pin'), true)
  const deletion = await owner.client.storage.from('paper-figures').remove([asset])
  assert.ok(deletion.error || deletion.data.length === 0, 'Leased figure deletion blocked')
  assert.deepEqual(Buffer.from(await ok(await owner.client.storage.from('paper-figures').download(asset), 'Pinned download').arrayBuffer()), png)
  for (const lease of leases) ok(await lease.client.rpc('release_paper_snapshot', { p_snapshot: lease.id }), 'Release own lease')
  assert.equal(ok(await owner.client.rpc('paper_figure_referenced', { p_name: asset }), 'Released pin'), false)
  console.log('PASS concurrent multi-file revision/clock capture, immutable copies, ACK/epoch guards, viewer/revocation permissions, archive reads and protected asset leases')
} finally {
  for (const doc of docs) doc.destroy()
  if (project && file && service) {
    await admin.from('projects').update({ status: 'active' }).eq('id', project)
    if ((await service.read(accounts[0].token, file.id)).session) await service.disable(accounts[0].token, file.id)
  }
  if (project) ok(await admin.from('projects').delete().eq('id', project), 'Clean project')
  if (asset) ok(await admin.storage.from('paper-figures').remove([asset]), 'Clean asset')
  for (const account of accounts) ok(await admin.auth.admin.deleteUser(account.id), 'Clean account')
}
