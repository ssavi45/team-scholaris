import type { PaperFile } from './paper-api'

export type RecoveryDraft = { key: string; userId: string; projectId: string; writer: string; base: PaperFile; text: string; updated: number }
const RETENTION = 7 * 24 * 60 * 60 * 1000
let queue: Promise<unknown> = Promise.resolve()
const epochs = new Map<string, number>()
const closedAccounts = new Set<string>()
const pending = new Map<string, { record: RecoveryDraft | null; promise: Promise<void> }>()
export function allowUserRecovery(userId: string) { closedAccounts.delete(userId) }

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let finished = false
    const timer = setTimeout(() => { finished = true; reject(new Error('Local recovery storage did not respond.')) }, 5000)
    const request = indexedDB.open('scholaris-paper-recovery', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'key' })
    request.onsuccess = () => { clearTimeout(timer); if (finished) request.result.close(); else resolve(request.result) }
    request.onerror = () => { clearTimeout(timer); finished = true; reject(new Error('Local recovery storage is unavailable.')) }
    request.onblocked = () => { clearTimeout(timer); finished = true; reject(new Error('Close older Scholaris tabs to enable local recovery.')) }
  })
}
function serial<T>(action: () => Promise<T>): Promise<T> {
  const next = queue.then(action, action)
  queue = next.catch(() => {})
  return next
}
async function transaction<T>(action: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
  const db = await database()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite')
      let result: T
      tx.oncomplete = () => resolve(result)
      tx.onabort = () => reject(new Error('Local recovery could not be written. Download your unsaved drafts.'))
      tx.onerror = () => reject(new Error('Local recovery storage is full or unavailable.'))
      action(tx.objectStore('drafts'), value => { result = value })
    })
  } finally { db.close() }
}
export function writeRecovery(record: RecoveryDraft | null, key: string, userId: string) {
  const queued = pending.get(key)
  if (queued) { queued.record = record; return queued.promise }
  const epoch = epochs.get(userId)
  const item = { record, promise: Promise.resolve() }
  item.promise = serial(async () => {
    pending.delete(key)
    if (epoch !== epochs.get(userId) || closedAccounts.has(userId)) throw new Error('This recovery session has ended.')
    await transaction<void>(store => { if (item.record) store.put(item.record); else store.delete(key) })
  })
  pending.set(key, item)
  return item.promise
}
export function readRecovery(userId: string, projectId: string) {
  return serial(() => transaction<RecoveryDraft[]>((store, done) => {
    const request = store.getAll()
    request.onsuccess = () => {
      const rows = request.result as RecoveryDraft[]
      for (const row of rows) if (row.updated < Date.now() - RETENTION) store.delete(row.key)
      done(rows.filter(row => row.userId === userId && row.projectId === projectId && row.updated >= Date.now() - RETENTION))
    }
  }))
}
export function deleteRecovery(key: string) {
  return serial(() => transaction<void>(store => { store.delete(key) }))
}
export function clearUserRecovery(userId: string) {
  closedAccounts.add(userId)
  epochs.set(userId, (epochs.get(userId) ?? 0) + 1)
  return serial(() => transaction<void>(store => {
    const request = store.openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      if ((cursor.value as RecoveryDraft).userId === userId) cursor.delete()
      cursor.continue()
    }
  }))
}
export function hasUserRecovery(userId: string) {
  return serial(() => transaction<boolean>((store, done) => {
    const request = store.getAll()
    request.onsuccess = () => done((request.result as RecoveryDraft[]).some(row => row.userId === userId && row.updated >= Date.now() - RETENTION))
  }))
}
export function clearProjectRecovery(userId: string, projectId: string) {
  return serial(() => transaction<void>(store => {
    const request = store.openCursor()
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      const row = cursor.value as RecoveryDraft
      if (row.userId === userId && row.projectId === projectId) cursor.delete()
      cursor.continue()
    }
  }))
}
