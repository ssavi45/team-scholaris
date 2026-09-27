import type { PaperFile } from './paper-api'
import type { RecoveryDraft } from './draft-storage'

export type DraftDocument = {
  base: PaperFile; text: string; remote?: PaperFile | null; saving: boolean;
  error: string; local: boolean; savedAt?: string
}
type Dependencies = {
  save: (base: PaperFile, text: string) => Promise<PaperFile>
  latest: (id: string) => Promise<PaperFile | null>
  persist: (document: DraftDocument) => Promise<void>
}
export class PaperDraftStore {
  private documents: Record<string, DraftDocument> = {}
  private listeners = new Set<() => void>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private jobs = new Map<string, Promise<void>>()
  private enabled = false
  private active = true
  private online = true
  private dependencies: Dependencies
  private delay: number
  constructor(dependencies: Dependencies, delay = 1500) { this.dependencies = dependencies; this.delay = delay }
  getSnapshot = () => this.documents
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private emit() { this.documents = { ...this.documents }; this.listeners.forEach(listener => listener()) }
  private update(id: string, patch: Partial<DraftDocument>) {
    if (!this.active || !this.documents[id]) return
    this.documents[id] = { ...this.documents[id], ...patch }; this.emit()
  }
  private persist(id: string) {
    const document = this.documents[id]
    void this.dependencies.persist(document).then(() => {
      if (this.documents[id]?.text === document.text && this.documents[id]?.base.version === document.base.version) this.update(id, { local: true })
    }).catch(() => this.update(id, { local: false }))
  }
  start() { this.active = true }
  stop() { this.active = false; this.timers.forEach(clearTimeout); this.timers.clear() }
  revoke() { this.stop(); this.documents = {}; this.emit() }
  configure(enabled: boolean, online: boolean) {
    this.enabled = enabled; this.online = online
    if (!enabled || !online) { this.timers.forEach(clearTimeout); this.timers.clear() }
  }
  reconcile(files: PaperFile[]) {
    for (const file of files.filter(file => file.kind === 'text')) {
      const current = this.documents[file.id]
      if (current && file.version < current.base.version) continue
      if (!current) this.documents[file.id] = { base: file, text: file.content, saving: false, error: '', local: true, savedAt: file.updated_at }
      else if (!current.saving) {
        if (current.text === file.content || current.text === current.base.content) {
          this.documents[file.id] = { ...current, base: file, text: file.content, remote: undefined, error: '', savedAt: file.updated_at }
        } else if (current.base.version !== file.version) {
          this.documents[file.id] = { ...current, remote: file, error: 'The server file changed. Compare both versions before saving.' }
        } else this.documents[file.id] = { ...current, base: file }
      }
    }
    for (const [id, document] of Object.entries(this.documents)) {
      if (!files.some(file => file.id === id && file.kind === 'text') && !document.saving) {
        if (document.text === document.base.content) delete this.documents[id]
        else this.documents[id] = { ...document, remote: null, error: 'This file was deleted or is no longer accessible. It will not be recreated automatically.' }
      }
    }
    this.emit()
    for (const id of Object.keys(this.documents)) this.persist(id)
  }
  edit(id: string, text: string) {
    const document = this.documents[id]
    if (!document || !this.enabled) return
    this.update(id, { text, local: false })
    this.persist(id); this.schedule(id)
  }
  private schedule(id: string) {
    clearTimeout(this.timers.get(id))
    const document = this.documents[id]
    if (!this.active || !this.enabled || !this.online || document.remote !== undefined || document.error || document.text === document.base.content) return
    this.timers.set(id, setTimeout(() => { this.timers.delete(id); void this.save(id).catch(() => {}) }, this.delay))
  }
  async save(id: string): Promise<void> {
    if (this.jobs.has(id)) { await this.jobs.get(id); return this.save(id) }
    const document = this.documents[id]
    if (!document || document.text === document.base.content) return
    if (!this.active || !this.enabled || !this.online) throw new Error('Saving is paused. Check your connection and current project access.')
    if (document.remote !== undefined) throw new Error('Resolve the file conflict before saving.')
    clearTimeout(this.timers.get(id)); this.timers.delete(id)
    const text = document.text
    this.update(id, { saving: true, error: '' })
    const job = (async () => {
      try {
        const saved = await this.dependencies.save(document.base, text)
        this.update(id, { base: saved, savedAt: saved.updated_at, error: '', remote: undefined })
      } catch (cause) {
        // Read after failure also reconciles a successful save whose response was lost.
        try {
          const remote = await this.dependencies.latest(id)
          if (remote?.content === text) this.update(id, { base: remote, savedAt: remote.updated_at, error: '', remote: undefined })
          else {
            this.update(id, { remote: !remote || remote.version !== document.base.version ? remote : undefined,
              error: cause instanceof Error ? cause.message : 'Save failed. Retry after checking your connection.' })
            throw cause
          }
        } catch (failure) {
          if (!this.documents[id]?.error) this.update(id, { error: cause instanceof Error ? cause.message : 'Save failed. Your draft is retained.' })
          throw failure
        }
      } finally {
        this.update(id, { saving: false })
        if (this.active) this.persist(id)
      }
    })()
    this.jobs.set(id, job)
    try { await job } finally { this.jobs.delete(id); if (this.active) this.schedule(id) }
  }
  async saveAll() {
    // Capture IDs, then drain edits queued during an active save. Compile freezes input separately.
    for (const id of Object.keys(this.documents)) {
      await this.save(id)
      if (this.documents[id]?.text !== this.documents[id]?.base.content) await this.save(id)
    }
    if (Object.values(this.documents).some(document => document.text !== document.base.content)) throw new Error('Some edits are still unsaved. Try Save all again.')
  }
  async recover(record: RecoveryDraft) {
    const current = this.documents[record.base.id]
    if (!current || current.saving || current.text !== current.base.content) throw new Error('Save or resolve the current draft before restoring this recovery copy.')
    const remote = current.base
    const matches = remote.version === record.base.version || remote.content === record.text
    this.update(remote.id, { base: matches ? remote : record.base, text: record.text,
      remote: matches ? undefined : remote, error: matches ? '' : 'Recovered text differs from the server. Compare before saving.', local: false })
    // Await durable replacement before deleting the original recovery copy.
    await this.dependencies.persist(this.documents[remote.id])
    this.update(remote.id, { local: true })
    // Recovery is deliberate but saving is a separate explicit action.
  }
  resolve(id: string, text: string) {
    const document = this.documents[id]
    if (!document?.remote || document.saving) throw new Error('Refresh the server version before resolving this conflict.')
    this.update(id, { base: document.remote, text, remote: undefined, error: '', local: false })
    this.persist(id)
  }
  discard(id: string) {
    const document = this.documents[id]
    if (!document || document.saving) return
    const base = document.remote ?? document.base
    this.update(id, { base, text: base.content, remote: undefined, error: '', local: false })
    this.persist(id)
  }
}
