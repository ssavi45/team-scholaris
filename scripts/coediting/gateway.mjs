// PAPER-12 executable model, never imported by the application.
// Synchronous single-writer disk commits stand in for a future DB transaction.
import * as Y from 'yjs'
import { readFileSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync } from 'node:fs'

export const limits = { update: 256 * 1024, text: 512 * 1024, state: 2 * 1024 * 1024, requests: 120 }
const encode = doc => Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')
function hydrate(state) {
  const doc = new Y.Doc()
  doc.getText('source')
  Y.applyUpdate(doc, Buffer.from(state, 'base64'))
  return doc
}
export function seed(files, members) {
  return { revision: 1, active: true, members, files: Object.fromEntries(files.map(file => {
    const doc = new Y.Doc(); doc.getText('source').insert(0, file.content)
    const result = [file.id, { path: file.path, epoch: 1, deleted: false, state: encode(doc) }]
    doc.destroy(); return result
  })) }
}

export class Gateway {
  constructor(path, verify, initial, clock = Date.now) {
    this.path = path; this.verify = verify; this.clock = clock; this.rates = new Map()
    try { this.data = JSON.parse(readFileSync(path, 'utf8')) }
    catch (error) {
      if (error.code !== 'ENOENT' || !initial) throw error
      this.commit(initial)
    }
  }
  commit(next) {
    // ACK only after durable file write and atomic replacement. Not multi-process safe.
    const fd = openSync(this.path + '.next', 'w')
    try { writeFileSync(fd, JSON.stringify(next)); fsyncSync(fd) } finally { closeSync(fd) }
    renameSync(this.path + '.next', this.path)
    this.data = next
  }
  authorize(token, write = false, owner = false) {
    const identity = this.verify(token)
    if (!identity || identity.project !== 'fixture-project') throw new Error('Unauthorized')
    const role = Object.hasOwn(this.data.members, identity.sub) ? this.data.members[identity.sub] : null
    if (!['owner', 'member', 'viewer'].includes(role)) throw new Error('Access revoked')
    if (write && (!this.data.active || role === 'viewer')) throw new Error('Read-only')
    if (owner && role !== 'owner') throw new Error('Owner required')
    const minute = Math.floor(this.clock() / 60000)
    const previous = this.rates.get(identity.sub)
    const count = previous?.minute === minute ? previous.count + 1 : 1
    if (count > limits.requests) throw new Error('Rate limit')
    this.rates.set(identity.sub, { minute, count })
    return identity
  }
  file(id, epoch) {
    const file = Object.hasOwn(this.data.files, id) ? this.data.files[id] : null
    if (!file || file.deleted) throw new Error('File deleted')
    if (epoch !== file.epoch) throw new Error('Document generation changed; recover local edits separately')
    return file
  }
  read(token, id, epoch) {
    this.authorize(token)
    const file = this.file(id, epoch)
    return { revision: this.data.revision, ...file }
  }
  update(token, id, epoch, bytes) {
    this.authorize(token, true)
    const file = this.file(id, epoch)
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > limits.update) throw new Error('Update limit')
    const doc = hydrate(file.state)
    try {
      // Validate on an isolated candidate: rejected writes never pollute live state.
      Y.applyUpdate(doc, bytes)
      const source = doc.getText('source')
      if (doc.share.size !== 1 || source.toDelta().some(part => typeof part.insert !== 'string' || part.attributes)) throw new Error('Only plain source text is allowed')
      if (Buffer.byteLength(source.toString()) > limits.text) throw new Error('Text limit')
      const state = encode(doc)
      if (Buffer.from(state, 'base64').length > limits.state) throw new Error('State limit')
      if (state === file.state) return { revision: this.data.revision }
      const next = structuredClone(this.data)
      next.files[id].state = state; next.revision++
      this.commit(next)
      return { revision: next.revision }
    } finally { doc.destroy() }
  }
  snapshot(token) {
    this.authorize(token)
    // One synchronous serialization point includes all files at this revision.
    return { revision: this.data.revision, files: Object.entries(this.data.files).filter(([, file]) => !file.deleted).map(([id, file]) => {
      const doc = hydrate(file.state)
      try { return { id, path: file.path, epoch: file.epoch, content: doc.getText('source').toString() } }
      finally { doc.destroy() }
    }) }
  }
  lifecycle(token, operation, args) {
    this.authorize(token, true, true)
    const next = structuredClone(this.data)
    if (operation === 'member') next.members[args.user] = args.role
    else if (operation === 'archive') next.active = false
    else {
      this.file(args.id, args.epoch)
      if (operation === 'rename') next.files[args.id].path = args.path
      else if (operation === 'delete') { next.files[args.id].deleted = true; next.files[args.id].epoch++ }
      else if (operation === 'restore') {
        const doc = new Y.Doc(); doc.getText('source').insert(0, args.content)
        next.files[args.id].state = encode(doc); doc.destroy(); next.files[args.id].epoch++
      } else throw new Error('Unknown operation')
    }
    next.revision++; this.commit(next)
  }
  legacySave() { throw new Error('Protocol mismatch: whole-file saves disabled for shared documents') }
}
