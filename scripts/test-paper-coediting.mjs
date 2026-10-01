import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, basename } from 'node:path'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import * as Y from 'yjs'
import { EditorState } from '@codemirror/state'
import { yCollab } from 'y-codemirror.next'
import { Gateway, seed, limits } from './coediting/gateway.mjs'
import { fixtureAuth } from './coediting/fixture-auth.mjs'

const directory = mkdtempSync(join(tmpdir(), 'scholaris-coediting-'))
const secret = randomBytes(32).toString('hex'), auth = fixtureAuth(secret)
const owner = auth.issue('owner'), alice = auth.issue('alice'), bob = auth.issue('bob'), viewer = auth.issue('viewer')
const members = { owner: 'owner', alice: 'member', bob: 'member', viewer: 'viewer' }
let fixture = 0
function gateway(content = 'Research\n', extra = {}) {
  return new Gateway(join(directory, `${fixture++}.json`), auth.verify, seed([
    { id: 'main', path: 'main.tex', content }, { id: 'methods', path: 'sections/methods.tex', content: 'Methods\n' },
  ], { ...members, ...extra }))
}
function client(server, token, id = 'main', epoch = 1) {
  const doc = new Y.Doc(), source = doc.getText('source')
  Y.applyUpdate(doc, Buffer.from(server.read(token, id, epoch).state, 'base64'), 'remote')
  const packets = []
  const local = Symbol('local')
  const undo = new Y.UndoManager(source, { trackedOrigins: new Set([local]), captureTimeout: 0 })
  doc.on('update', (update, origin) => { if (origin !== 'remote') packets.push(update) })
  return {
    doc, source, packets, undo,
    edit(text, at = source.length) { doc.transact(() => source.insert(at, text), local) },
    flush() { while (packets.length) { server.update(token, id, epoch, packets[0]); packets.shift() } },
    pull() { Y.applyUpdate(doc, Buffer.from(server.read(token, id, epoch).state, 'base64'), 'remote') },
    close() { undo.destroy(); doc.destroy() },
  }
}
try {
  const server = gateway(), a = client(server, alice), b = client(server, bob), other = client(server, bob, 'methods')
  a.edit('Alice ', 0); b.edit('Bob ', 0); other.edit('independent chapter')
  // Deliver dependent updates backwards and more than once.
  a.edit('second'); a.edit('third')
  for (const packet of [...a.packets].reverse()) { server.update(alice, 'main', 1, packet); server.update(alice, 'main', 1, packet) }
  a.flush(); b.flush(); other.flush(); a.pull(); b.pull()
  assert.equal(a.source.toString(), b.source.toString())
  assert.match(a.source.toString(), /Alice/); assert.match(a.source.toString(), /Bob/)
  assert.match(server.snapshot(owner).files[1].content, /independent chapter/)
  // Local undo must retain remote edits.
  a.undo.undo(); a.flush(); b.pull(); a.pull()
  assert.match(b.source.toString(), /Bob/); assert.doesNotMatch(b.source.toString(), /third/)
  a.undo.redo(); a.flush(); b.pull(); assert.match(b.source.toString(), /third/)
  // CodeMirror accepts the actual binding extension; rendering is a separate browser gate.
  const bound = EditorState.create({ doc: a.source.toString(), extensions: [yCollab(a.source, null, { undoManager: a.undo })] })
  assert.equal(bound.doc.toString(), a.source.toString())
  const snapshot = server.snapshot(owner)
  a.edit('offline edit'); b.edit('online edit'); b.flush(); a.pull(); a.flush(); b.pull()
  assert.equal(a.source.toString(), b.source.toString())
  assert.doesNotMatch(snapshot.files[0].content, /offline edit|online edit/)
  // Real child process restart reads only persisted state, not parent's memory.
  const restarted = spawnSync(process.execPath, ['scripts/coediting/restart-probe.mjs', server.path], { encoding: 'utf8', env: { ...process.env, PROTOTYPE_SECRET: secret } })
  assert.equal(restarted.status, 0, restarted.error?.message ?? restarted.stderr)
  assert.deepEqual(JSON.parse(restarted.stdout), server.snapshot(owner))
  const hydrated = new Gateway(server.path, auth.verify)
  const fresh = client(hydrated, alice)
  assert.equal(fresh.source.toString(), a.source.toString()); fresh.close()
  // Retry after an ACK was lost must not duplicate text or advance revision.
  const packet = Y.encodeStateAsUpdate(a.doc), beforeRetry = server.data.revision
  server.update(alice, 'main', 1, packet); server.update(alice, 'main', 1, packet)
  assert.equal(server.data.revision, beforeRetry)
  assert.throws(() => server.read('forged', 'main', 1), /Unauthorized/)
  assert.throws(() => server.read(auth.issue('alice', { exp: 0 }), 'main', 1), /Expired/)
  assert.throws(() => server.read(auth.issue('alice', { project: 'another-project' }), 'main', 1), /Unauthorized/)
  assert.throws(() => server.update(viewer, 'main', 1, packet), /Read-only/)
  assert.throws(() => server.legacySave(), /Protocol mismatch/)
  const rev = server.data.revision, disk = readFileSync(server.path, 'utf8')
  assert.throws(() => server.update(alice, 'main', 1, new Uint8Array(limits.update + 1)), /Update limit/)
  assert.throws(() => server.update(alice, 'main', 1, new Uint8Array([255])))
  const malicious = new Y.Doc(); malicious.getMap('permissions').set('alice', 'owner')
  assert.throws(() => server.update(alice, 'main', 1, Y.encodeStateAsUpdate(malicious)), /Only plain/)
  malicious.destroy()
  assert.equal(server.data.revision, rev); assert.equal(readFileSync(server.path, 'utf8'), disk)
  const full = gateway('x'.repeat(limits.text - 10)), fullClient = client(full, alice)
  fullClient.edit('y'.repeat(20))
  assert.throws(() => fullClient.flush(), /Text limit/)
  assert.equal(full.data.revision, 1); fullClient.close()
  const formatted = client(server, bob)
  formatted.doc.transact(() => formatted.source.format(0, 1, { bold: true }))
  assert.throws(() => formatted.flush(), /Only plain/); formatted.close()
  // Revocation and demotion affect a previously admitted client immediately.
  server.lifecycle(owner, 'member', { user: 'alice', role: 'viewer' })
  a.edit('rejected but retained locally')
  assert.throws(() => a.flush(), /Read-only/); assert.ok(a.packets.length)
  server.lifecycle(owner, 'member', { user: 'alice', role: null })
  assert.throws(() => a.pull(), /Access revoked/)
  server.lifecycle(owner, 'rename', { id: 'main', epoch: 1, path: 'paper.tex' })
  assert.equal(server.read(bob, 'main', 1).path, 'paper.tex')
  server.lifecycle(owner, 'restore', { id: 'main', epoch: 1, content: 'Restored checkpoint' })
  assert.throws(() => b.pull(), /generation changed/)
  assert.throws(() => server.update(bob, 'main', 1, packet), /generation changed/)
  assert.equal(server.snapshot(owner).files[0].content, 'Restored checkpoint')
  server.lifecycle(owner, 'delete', { id: 'main', epoch: 2 })
  assert.throws(() => server.update(bob, 'main', 2, packet), /File deleted/)
  server.lifecycle(owner, 'archive', {})
  assert.throws(() => server.update(bob, 'methods', 1, packet), /Read-only/)
  a.close(); b.close(); other.close()
  // Failed storage cannot receive a durable ACK or change accepted memory.
  const failing = gateway(), c = client(failing, alice); c.edit('not committed')
  const oldRevision = failing.data.revision
  failing.commit = () => { throw new Error('Disk unavailable') }
  assert.throws(() => c.flush(), /Disk unavailable/)
  assert.equal(failing.data.revision, oldRevision); assert.ok(c.packets.length); c.close()
  const throttled = gateway()
  for (let i = 0; i < limits.requests; i++) throttled.read(viewer, 'main', 1)
  assert.throws(() => throttled.read(viewer, 'main', 1), /Rate limit/)
  // 2/5 users editing representative synthetic TeX, with all writes persisted.
  const measurements = []
  for (const users of [2, 5]) for (const kb of [10, 100, 400]) {
    const identities = Object.fromEntries(Array.from({ length: users }, (_, i) => [`bench${i}`, 'member']))
    const base = '\\section{Results}\nRepresentative research text and $x^2$.\n'.repeat(Math.ceil(kb * 1024 / 56))
    const bench = gateway(base, identities), clients = Object.keys(identities).map(name => client(bench, auth.issue(name)))
    const samples = [], start = performance.now()
    for (let round = 0; round < 10; round++) {
      clients.forEach((peer, i) => peer.edit(` user${i}-round${round} `, Math.floor(peer.source.length / 2)))
      clients.forEach(peer => { const tick = performance.now(); peer.flush(); samples.push(performance.now() - tick) })
      clients.forEach(peer => peer.pull())
    }
    assert.ok(clients.every(peer => peer.source.toString() === clients[0].source.toString()))
    samples.sort((a, b) => a - b)
    measurements.push({ users, sourceKiB: kb, updates: samples.length, totalMs: Math.round(performance.now() - start), persistP95Ms: +samples[Math.ceil(samples.length * .95) - 1].toFixed(2), persistedBytes: readFileSync(bench.path).byteLength })
    clients.forEach(peer => peer.close())
  }
  console.log('PASS: merge, duplicate/reordered updates, offline recovery, own undo/redo, binding state, process restart, immutable snapshot, lost ACK retry, auth/roles/revocation, epoch fencing, delete/archive, storage failure and limits.')
  console.log(JSON.stringify({ environment: `${process.platform} ${process.version}`, peakProcessRssKiB: process.resourceUsage().maxRSS, transport: 'in-process fault injection; local durable disk, not browser/network latency', measurements }, null, 2))
} finally {
  const target = resolve(directory)
  if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('scholaris-coediting-')) throw new Error('Unsafe fixture cleanup path')
  rmSync(target, { recursive: true, force: true })
}
