import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { parseEnv } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { SharedSessionService } from '../server/coediting/session-service.mjs'
import { attachSharedSockets } from '../server/coediting/websocket-server.mjs'
import { SharedClient } from '../src/features/paper/shared-client.ts'
import { sharedStorage, clearSharedRecovery } from '../src/features/paper/shared-storage.ts'
import 'fake-indexeddb/auto'

assert.ok(process.argv.includes('--local'), 'Local fixture test only.')
const env = parseEnv(execFileSync(process.execPath, ['node_modules/supabase/dist/supabase.js', 'status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }))
assert.equal(env.API_URL, 'http://127.0.0.1:54321')
const config = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, config)
const origin = 'http://127.0.0.1:5173', accounts = [], servers = [], clients = [], documents = []
const ok = (result, label) => { assert.equal(result.error, null, label); return result.data }
let project, file, service
const liveClients = []
const waitFor = async predicate => {
  const until = Date.now() + 15000
  while (!predicate()) { if (Date.now() > until) throw new Error('Client condition timed out'); await new Promise(resolve => setTimeout(resolve, 50)) }
}
async function gateway(options = {}) {
  const http = createServer((_req, res) => { res.writeHead(404); res.end() })
  const sockets = attachSharedSockets(http, new SharedSessionService(admin, [project]), {
    origins: [origin], pollMs: 500, authTimeoutMs: 5000, ...options,
  })
  http.listen(0, '127.0.0.1'); await once(http, 'listening')
  const instance = { url: `ws://127.0.0.1:${http.address().port}/paper-shared`,
    close: async () => { await sockets.close(); await new Promise(resolve => http.close(resolve)) } }
  servers.push(instance); return instance
}
async function connect(url) {
  const ws = new WebSocket(url, 'scholaris-paper-v1', { origin })
  const inbox = [], waiting = []
  let closed
  ws.on('message', data => {
    const value = JSON.parse(data.toString())
    const index = waiting.findIndex(item => item.predicate(value))
    if (index < 0) inbox.push(value)
    else { const waiter = waiting.splice(index, 1)[0]; clearTimeout(waiter.timer); waiter.resolve(value) }
  })
  ws.on('close', code => {
    closed = code
    for (const waiter of waiting.splice(0)) { clearTimeout(waiter.timer); waiter.reject(new Error(`Socket closed: ${code}`)) }
  })
  await once(ws, 'open')
  const client = { ws, inbox,
    send: value => ws.send(JSON.stringify(value)),
    next: predicate => new Promise((resolve, reject) => {
      const index = inbox.findIndex(predicate)
      if (index >= 0) { resolve(inbox.splice(index, 1)[0]); return }
      if (closed !== undefined) { reject(new Error(`Socket closed: ${closed}`)); return }
      const waiter = { predicate, resolve, reject, timer: null }
      waiter.timer = setTimeout(() => { waiting.splice(waiting.indexOf(waiter), 1); reject(new Error('Timed out waiting for socket message')) }, 10000)
      waiting.push(waiter)
    }),
    closed: () => closed !== undefined ? Promise.resolve(closed) : new Promise((resolve, reject) => {
      const done = code => { clearTimeout(timer); resolve(code) }
      const timer = setTimeout(() => { ws.off('close', done); reject(new Error('Socket did not close in time')) }, 10000)
      ws.once('close', done)
    }),
  }
  clients.push(client); return client
}
async function join(server, account, epoch) {
  const client = await connect(server.url)
  client.send({ type: 'join', token: account.token, file, epoch })
  const state = await client.next(value => value.type === 'state')
  return { client, state }
}
try {
  for (let i = 0; i < 5; i++) {
    const email = `transport-${randomUUID()}@example.test`, password = randomUUID() + 'Aa1!'
    const user = ok(await admin.auth.admin.createUser({ email, password, email_confirm: true }), 'Fixture user').user
    const client = createClient(env.API_URL, env.ANON_KEY, config)
    const auth = ok(await client.auth.signInWithPassword({ email, password }), 'Fixture login')
    accounts.push({ id: user.id, token: auth.session.access_token, client })
  }
  project = ok(await accounts[0].client.rpc('create_project', { project_name: 'Socket fixture' }).single(), 'Project').id
  ok(await accounts[0].client.rpc('initialize_paper', { p_project_id: project }), 'Initialize')
  for (const account of accounts.slice(1)) ok(await admin.from('project_members').insert({ project_id: project, user_id: account.id, access_level: 'member' }), 'Member')
  file = ok(await accounts[0].client.from('paper_files').select('id').eq('project_id', project).eq('path','main.tex').single(), 'Source').id
  service = new SharedSessionService(admin, [project])
  const initial = await service.enable(accounts[0].token, file)
  const first = await gateway(), second = await gateway()
  const joined = await Promise.all(accounts.map((account, index) => join(index % 2 ? second : first, account)))
  const updates = joined.map(({ state }, index) => {
    const doc = new Y.Doc(); documents.push(doc)
    Y.applyUpdate(doc, Buffer.from(state.state, 'base64'))
    const vector = Y.encodeStateVector(doc)
    doc.getText('source').insert(0, `Socket author ${index}\n`)
    return Buffer.from(Y.encodeStateAsUpdate(doc, vector)).toString('base64')
  })
  await Promise.all(joined.map(async ({ client }, index) => {
    client.send({ type: 'update', id: `edit-${index}`, epoch: initial.session.epoch, update: updates[index] })
    await client.next(value => value.type === 'ack' && value.id === `edit-${index}`)
  }))
  for (const { client } of joined) {
    const latest = await client.next(value => value.type === 'state' && value.sequence === 5)
    const doc = new Y.Doc(); documents.push(doc); Y.applyUpdate(doc, Buffer.from(latest.state, 'base64'))
    for (let i = 0; i < 5; i++) assert.ok(doc.getText('source').toString().includes(`Socket author ${i}\n`))
  }
  console.log('PASS five socket writers across two gateways and permission-checked fan-out')
  const owner = joined[0].client
  owner.ws.terminate(); await owner.closed()
  const reconnected = (await join(second, accounts[0], initial.session.epoch)).client
  reconnected.send({ type: 'update', id: 'lost-ack-retry', epoch: initial.session.epoch, update: updates[0] })
  assert.equal((await reconnected.next(v => v.type === 'ack')).sequence, 5)
  reconnected.send({ type: 'refresh', token: accounts[0].token })
  assert.equal((await reconnected.next(v => v.type === 'state')).sequence, 5)
  reconnected.send({ type: 'update', id: 'invalid-crdt', epoch: initial.session.epoch, update: '////' })
  await reconnected.next(v => v.type === 'rejected' && v.id === 'invalid-crdt')
  assert.equal((await service.read(accounts[0].token, file)).session.sequence, 5, 'Rejected update never persisted')
  assert.ok(!reconnected.inbox.some(v => v.type === 'ack' && v.id === 'invalid-crdt'), 'No success ACK on rejection')
  await first.close()
  const fresh = await gateway()
  assert.equal((await join(fresh, accounts[0])).state.sequence, 5)
  // Membership changes are observed even when a client sends no more messages.
  const demoted = joined[1].client
  ok(await admin.from('project_members').update({ access_level: 'viewer' }).eq('project_id', project).eq('user_id', accounts[1].id), 'Demotion')
  await demoted.next(v => v.type === 'state' && v.editable === false)
  demoted.send({ type: 'update', id: 'viewer-edit', epoch: initial.session.epoch, update: updates[1] })
  await demoted.next(v => v.type === 'rejected')
  ok(await admin.from('project_members').delete().eq('project_id', project).eq('user_id', accounts[1].id), 'Revocation')
  assert.equal(await demoted.closed(), 4403)
  const switcher = (await join(fresh, accounts[0])).client
  switcher.send({ type: 'refresh', token: accounts[3].token })
  assert.equal(await switcher.closed(), 4401)
  console.log('PASS reconnect/idempotent replay, new gateway, refresh, viewer and idle revocation')
  const archiveClient = (await join(fresh, accounts[0])).client
  ok(await admin.from('projects').update({ status: 'archived' }).eq('id', project), 'Archive fixture')
  await archiveClient.next(v => v.type === 'state' && v.editable === false)
  archiveClient.send({ type: 'update', id: 'archived-edit', epoch: initial.session.epoch, update: updates[0] })
  await archiveClient.next(v => v.type === 'rejected')
  ok(await admin.from('projects').update({ status: 'active' }).eq('id', project), 'Unarchive fixture')
  const denied = new WebSocket(second.url, 'scholaris-paper-v1', { origin: 'https://untrusted.example' })
  assert.match((await once(denied, 'error'))[0].message, /403/)
  const queryToken = new WebSocket(second.url + '?token=forbidden', 'scholaris-paper-v1', { origin })
  assert.match((await once(queryToken, 'error'))[0].message, /403/)
  const unauthenticated = await connect(second.url)
  assert.equal(await unauthenticated.closed(), 4401)
  const invalid = await connect(second.url)
  invalid.send({ type: 'join', token: 'invalid', file })
  assert.equal(await invalid.closed(), 4403)
  const oversized = await connect(second.url)
  oversized.ws.send('x'.repeat(360001))
  assert.equal(await oversized.closed(), 1009)
  const malformed = (await join(second, accounts[0])).client
  malformed.ws.send('{')
  assert.equal(await malformed.closed(), 1008)
  const limitedServer = await gateway({ messagesPerMinute: 2 })
  const limited = (await join(limitedServer, accounts[0])).client
  limited.send({ type: 'sync' }); await limited.next(v => v.type === 'state')
  limited.send({ type: 'sync' }); assert.equal(await limited.closed(), 4429)
  // Run the exact frontend provider against real sockets with durable IDB semantics.
  globalThis.WebSocket = class extends WebSocket {
    constructor(url, protocols) { super(url, protocols, { origin }) }
  }
  const recoveryKey = `fixture:${project}:${file}`
  const options = { url: fresh.url, file, user: accounts[0].id, key: recoveryKey,
    version: 1, enable: false, token: async () => accounts[0].token,
    storage: sharedStorage(recoveryKey, accounts[0].id) }
  const live = new SharedClient(options); liveClients.push(live)
  await live.start(); await waitFor(() => live.ready)
  live.doc.getText('source').insert(0, 'Frontend live edit\n')
  await waitFor(() => live.pending.length === 0)
  assert.ok((await service.read(accounts[0].token, file)).file.content.includes('Frontend live edit'))
  live.socket.terminate(); await waitFor(() => live.status.includes('Offline'))
  live.doc.getText('source').insert(0, 'Recovered offline edit\n')
  await live.close()
  assert.ok((await options.storage.load()).text.includes('Recovered offline edit'))
  const restored = new SharedClient(options); liveClients.push(restored)
  await restored.start(); await waitFor(() => restored.ready)
  assert.ok(restored.recovery, 'Reload requires explicit recovery decision')
  assert.ok(!restored.doc.getText('source').toString().includes('Recovered offline edit'), 'Recovery never silently merges')
  restored.restore(); await waitFor(() => restored.pending.length === 0)
  assert.ok((await service.read(accounts[0].token, file)).file.content.includes('Recovered offline edit'))
  const peer = (await join(fresh, accounts[3])).client
  restored.cursor(2, 6)
  const presence = await peer.next(value => value.type === 'peers' && value.peers.some(item => item.userId === accounts[0].id && item.cursor))
  const own = presence.peers.find(item => item.userId === accounts[0].id && item.cursor)
  assert.ok(own.name && /^#[0-9a-f]{6}$/i.test(own.color))
  assert.equal(own.userId, accounts[0].id, 'Avatar identity comes from the authenticated actor')
  assert.ok(presence.peers.some(item => item.userId === accounts[3].id), 'Presence includes the viewing coauthor')
  await waitFor(() => restored.peers.some(item => item.userId === accounts[3].id))
  assert.ok(restored.peers.some(item => item.userId === accounts[0].id), 'Frontend presence includes the local coauthor too')
  assert.equal(restored.peers.find(item => item.userId === accounts[3].id).color,
    presence.peers.find(item => item.userId === accounts[3].id).color, 'Participant colors are consistent across viewers')
  assert.equal(Y.createAbsolutePositionFromRelativePosition(own.cursor.head, restored.doc).index, 6)
  peer.send({ type: 'end' })
  assert.equal(await peer.closed(), 4403, 'Only owner can end a session')
  await restored.close()
  await clearSharedRecovery(accounts[0].id)
  assert.equal(await options.storage.load(), undefined)
  console.log('PASS frontend provider live sync, IDB offline/reload/explicit restore, named relative cursor and account cleanup')
  const ending = (await join(fresh, accounts[0])).client
  ending.send({ type: 'end' }); await ending.next(value => value.type === 'ended')
  const legacy = await service.read(accounts[0].token, file)
  assert.equal(legacy.session, null)
  const enrolling = await connect(fresh.url)
  enrolling.send({ type: 'join', token: accounts[0].token, file, enable: true, version: legacy.file.version })
  assert.notEqual((await enrolling.next(value => value.type === 'state')).epoch, initial.session.epoch)
  const stale = await connect(second.url)
  stale.send({ type: 'join', token: accounts[0].token, file, epoch: initial.session.epoch })
  assert.equal(await stale.closed(), 4409)
  console.log('PASS origin/query denial, auth deadline, invalid auth, payload/protocol/rate limits and stale reconnect')
} finally {
  for (const client of liveClients) await client.close()
  for (const client of clients) client.ws.terminate()
  for (const server of servers) await server.close()
  for (const doc of documents) doc.destroy()
  if (project) await admin.from('projects').update({ status: 'active' }).eq('id', project)
  if (service && file && (await service.read(accounts[0].token, file)).session) await service.disable(accounts[0].token, file)
  if (project) ok(await admin.from('projects').delete().eq('id', project), 'Fixture cleanup')
  for (const account of accounts) ok(await admin.auth.admin.deleteUser(account.id), 'User cleanup')
}
