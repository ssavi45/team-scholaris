export type SharedRecovery = { key: string; user: string; epoch: string; state: string; text: string; pending: string[]; updated: number }
const blocked = new Set<string>()
let queue: Promise<unknown> = Promise.resolve()
async function access<T>(action: (store: IDBObjectStore, done: (value: T) => void) => void): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let expired = false
    const timer = setTimeout(() => { expired = true; reject(new Error('Local recovery storage timed out.')) }, 5000)
    const request = indexedDB.open('scholaris-shared-recovery', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('copies', { keyPath: 'key' })
    request.onsuccess = () => { clearTimeout(timer); if (expired) request.result.close(); else resolve(request.result) }
    request.onerror = request.onblocked = () => { clearTimeout(timer); expired = true; reject(new Error('Local recovery storage unavailable.')) }
  })
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('copies', 'readwrite'); let value: T
      tx.oncomplete = () => resolve(value)
      tx.onerror = tx.onabort = () => reject(new Error('Local recovery could not be saved. Download your draft.'))
      action(tx.objectStore('copies'), result => { value = result })
    })
  } finally { db.close() }
}
export function sharedStorage(key: string, user: string) {
  blocked.delete(user)
  return {
    load: () => access<SharedRecovery | undefined>((store, done) => {
      const request = store.get(key)
      request.onsuccess = () => {
        const record = request.result as SharedRecovery | undefined
        if (record && Date.now() - record.updated > 7 * 86400000) { store.delete(key); done(undefined) }
        else done(record)
      }
    }),
    save: (record: SharedRecovery | null) => {
      const next = queue.catch(() => {}).then(() => blocked.has(user) ? undefined : access<void>((store, done) => { if (record) store.put(record); else store.delete(key); done() }))
      queue = next; return next
    },
  }
}
export async function clearSharedRecovery(user: string) {
  blocked.add(user)
  await queue.catch(() => {})
  await access<void>((store, done) => {
    const request = store.openCursor()
    request.onsuccess = () => { const cursor = request.result; if (cursor) { if (cursor.value.user === user) cursor.delete(); cursor.continue() } else done() }
  })
}
