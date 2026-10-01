import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { SharedClient, encode } from '../src/features/paper/shared-client.ts'

const seed = new Y.Doc(); seed.getText('source').insert(0, 'Saved paper')
class Socket {
  readyState = 0
  updates = []
  constructor() { queueMicrotask(() => { this.readyState = 1; this.onopen?.() }) }
  send(text) {
    const message = JSON.parse(text)
    if (message.type === 'join') queueMicrotask(() => this.receive({ type: 'state', epoch: 'fixture-epoch', sequence: 0, editable: true, state: encode(Y.encodeStateAsUpdate(seed)) }))
    else if (message.type === 'update') this.updates.push(message)
  }
  receive(message) { this.onmessage?.({ data: JSON.stringify(message) }) }
  close() { this.readyState = 3; this.onclose?.({ code: 1000 }) }
}
globalThis.WebSocket = Socket
const waitFor = async predicate => {
  for (let i = 0; !predicate(); i++) { assert.ok(i < 100, 'Condition completes'); await new Promise(resolve => setTimeout(resolve, 5)) }
}
let localWrites = 0
const client = new SharedClient({ url: 'ws://fixture', file: 'fixture-file', user: 'fixture-user', key: 'fixture-key', version: 1, enable: false,
  token: async () => 'fixture-token', storage: { load: async () => undefined, save: async () => { localWrites++ } } })
try {
  await client.start(); await waitFor(() => client.ready)
  const source = client.doc.getText('source'), socket = client.socket
  source.insert(0, 'Before click: ')
  const barrier = client.snapshotBarrier()
  const cut = barrier(new AbortController().signal)
  await waitFor(() => socket.updates.length === 1)
  assert.ok(localWrites > 0, 'Recovery persists before sending')
  source.insert(source.length, ' After click')
  let finished = false; void cut.then(() => { finished = true })
  // State is not a durable ACK for this client's batch, even when its sequence moves.
  socket.receive({ type: 'state', epoch: 'fixture-epoch', sequence: 1, editable: true, state: encode(Y.encodeStateAsUpdate(seed)) })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(finished, false)
  socket.receive({ type: 'ack', id: socket.updates[0].id, epoch: 'fixture-epoch', sequence: 1 })
  assert.deepEqual(await cut, { fileId: 'fixture-file', epoch: 'fixture-epoch', sequence: 1 })
  assert.equal(client.pending.length, 1, 'Later typing does not delay the captured cut')
  assert.ok(source.toString().includes('After click'), 'Editor kept accepting edits')
  const controller = new AbortController()
  const cancelled = client.acknowledgedCut(controller.signal)
  controller.abort(); await assert.rejects(cancelled, { name: 'AbortError' })
  const offline = client.acknowledgedCut(new AbortController().signal)
  socket.close(); await assert.rejects(offline, /Connect/)
  assert.equal(client.pending.length, 1, 'Failed capture preserves pending edits')
  await assert.rejects(client.acknowledgedCut(new AbortController().signal), /Connect/)
  console.log('PASS saved-cut waits for ACK, permits later typing, persists before send, rejects offline/cancel and retains pending edits')
} finally { await client.close(); seed.destroy() }
