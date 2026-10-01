import * as Y from 'yjs'
import type { SharedRecovery } from './shared-storage'
export type Peer = { id: string; userId: string; name: string; color: string; cursor: { anchor: Y.RelativePosition; head: Y.RelativePosition } | null }
type Storage = { load: () => Promise<SharedRecovery | undefined>; save: (record: SharedRecovery | null) => Promise<void> }
export const encode = (bytes: Uint8Array) => { let text = ''; for (const byte of bytes) text += String.fromCharCode(byte); return btoa(text) }
export const decode = (text: string) => Uint8Array.from(atob(text), char => char.charCodeAt(0))
export class SharedClient {
  doc = new Y.Doc()
  epoch = ''
  status = 'Connecting…'
  ready = false
  editable = false
  peers: Peer[] = []
  pending: string[] = []
  recovery?: SharedRecovery
  blocked = false
  socket?: WebSocket
  private closed = false
  private timer?: ReturnType<typeof setTimeout>
  private retry?: ReturnType<typeof setTimeout>
  private acknowledgement?: ReturnType<typeof setTimeout>
  private batch?: { id: string; count: number }
  private writes: Promise<void> = Promise.resolve()
  private listeners = new Set<() => void>()
  private options: { url: string; file: string; user: string; key: string; version: number; enable: boolean; token: () => Promise<string>; storage: Storage }
  constructor(options: SharedClient['options']) {
    this.options = options
    this.doc.getText('source')
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === 'remote' || origin === 'recovery') return
      this.pending.push(encode(update))
      if (this.pending.length > 2000) { this.blocked = true; this.status = 'Offline draft limit reached. Download your draft.' }
      else this.status = this.socket?.readyState === 1 ? 'Syncing…' : 'Saving local recovery…'
      this.persist(); this.changed(); this.schedule()
    })
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private changed() { for (const listener of this.listeners) listener() }
  async start() {
    try { this.recovery = await this.options.storage.load(); await this.connect() }
    catch { this.blocked = true; this.status = 'Connection or local recovery unavailable. Reopen to retry.'; this.changed() }
  }
  private persist() {
    const record: SharedRecovery | null = this.pending.length ? { key: this.options.key, user: this.options.user, epoch: this.epoch,
      state: encode(Y.encodeStateAsUpdate(this.doc)), text: this.doc.getText('source').toString(), pending: [...this.pending], updated: Date.now() } : null
    this.writes = this.writes.then(() => this.options.storage.save(record)).then(() => {
      if (!this.closed && !this.blocked && this.pending.length && this.socket?.readyState !== 1) { this.status = 'Offline — saved on this device'; this.changed() }
    }).catch(() => {
      this.blocked = true; this.status = 'Recovery storage failed. Download your draft before leaving.'; this.changed()
    })
  }
  async connect() {
    if (this.closed || this.blocked) return
    const token = await this.options.token()
    if (this.closed) return
    const ws = new WebSocket(this.options.url, 'scholaris-paper-v1'); this.socket = ws
    ws.onopen = () => ws.send(JSON.stringify({ type: 'join', token, file: this.options.file, epoch: this.epoch || this.recovery?.epoch, enable: this.options.enable, version: this.options.version }))
    ws.onmessage = event => {
      if (this.closed || this.socket !== ws) return
      const message = JSON.parse(event.data)
      if (message.type === 'state') {
        if (this.epoch && this.epoch !== message.epoch) { this.blocked = true; this.status = 'Session changed. Download your draft.'; this.changed(); return }
        this.epoch = message.epoch
        Y.applyUpdate(this.doc, decode(message.state), 'remote')
        this.editable = message.editable
        this.ready = true
        if (this.recovery?.pending.length) this.status = 'A local draft is available. Restore or discard it below.'
        else if (!this.editable) { this.status = 'Read-only — access changed'; this.peers = [] }
        else this.status = this.pending.length ? 'Syncing…' : 'Saved'
        this.changed(); this.schedule()
      } else if (message.type === 'ack' && this.batch && message.id === this.batch.id && message.epoch === this.epoch) {
        clearTimeout(this.acknowledgement)
        this.pending.splice(0, this.batch.count); this.batch = undefined; this.persist()
        this.status = this.pending.length ? 'Syncing…' : 'Saved'; this.changed(); this.schedule()
      } else if (message.type === 'rejected') {
        this.blocked = true; this.status = 'Changes were not accepted. Download your local draft.'; this.changed()
      } else if (message.type === 'peers') { this.peers = message.peers; this.changed() }
      else if (message.type === 'ended') { this.blocked = true; this.editable = false; this.status = 'Shared session ended. Close live writing to return to the editor.'; this.changed() }
    }
    ws.onclose = event => {
      if (this.closed || this.socket !== ws) return
      this.batch = undefined; this.peers = []
      clearTimeout(this.acknowledgement)
      if (this.blocked) { this.changed(); return }
      if ([4403,4409,1008,1009].includes(event.code)) { this.blocked = true; this.editable = false; this.status = 'Session unavailable or changed. Your local draft is retained.' }
      else { this.status = 'Offline — reconnecting'; this.retry = setTimeout(() => { void this.connect().catch(() => { this.status = 'Unable to reconnect. Reopen live writing to retry.'; this.changed() }) }, 2500) }
      this.changed()
    }
  }
  restore() {
    if (!this.recovery || !this.editable || this.recovery.epoch !== this.epoch) return
    Y.applyUpdate(this.doc, decode(this.recovery.state), 'recovery')
    this.pending.push(...this.recovery.pending); this.recovery = undefined; this.persist(); this.status = 'Syncing recovered edits…'; this.changed(); this.schedule()
  }
  discard() { this.recovery = undefined; this.persist(); this.status = this.editable ? 'Saved' : 'Read-only'; this.changed() }
  private schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => { void this.flush() }, 600) }
  async flush() {
    await this.writes
    if (this.closed || this.blocked || this.recovery || !this.editable || this.batch || !this.pending.length || this.socket?.readyState !== 1) return
    const update = Y.mergeUpdates(this.pending.map(decode))
    if (update.byteLength > 262144) { this.blocked = true; this.status = 'Draft exceeds sync limit. Download it before leaving.'; this.changed(); return }
    this.batch = { id: crypto.randomUUID(), count: this.pending.length }
    this.socket.send(JSON.stringify({ type: 'update', id: this.batch.id, epoch: this.epoch, update: encode(update) }))
    this.acknowledgement = setTimeout(() => { this.batch = undefined; this.schedule() }, 10000)
  }
  cursor(anchor: number, head: number) {
    if (this.socket?.readyState !== 1 || !this.ready || this.blocked) return
    const source = this.doc.getText('source')
    this.socket.send(JSON.stringify({ type: 'cursor', cursor: {
      anchor: Y.createRelativePositionFromTypeIndex(source, anchor), head: Y.createRelativePositionFromTypeIndex(source, head),
    } }))
  }
  async refresh() { const token = await this.options.token(); if (this.socket?.readyState === 1) this.socket.send(JSON.stringify({ type: 'refresh', token })) }
  end() { if (!this.pending.length && !this.recovery && this.socket?.readyState === 1) this.socket.send(JSON.stringify({ type: 'end' })) }
  close() { if (this.closed) return this.writes; this.closed = true; clearTimeout(this.timer); clearTimeout(this.retry); clearTimeout(this.acknowledgement); this.socket?.close(); this.peers = []; return this.writes.finally(() => this.doc.destroy()) }
}
