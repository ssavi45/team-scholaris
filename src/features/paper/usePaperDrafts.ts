import { useEffect, useState, useSyncExternalStore } from 'react'
import { PaperDraftStore } from './draft-store'
import { loadPaperFile, savePaperFile } from './paper-api'
import { writeRecovery } from './draft-storage'

export function usePaperDrafts(userId: string, projectId: string) {
  const [store] = useState(() => {
    const writer = crypto.randomUUID()
    return new PaperDraftStore({
      save: savePaperFile, latest: loadPaperFile,
      persist: document => {
        const key = `${userId}:${projectId}:${document.base.id}:${writer}`
        return writeRecovery(document.text !== document.base.content ? {
          key, userId, projectId, writer, base: document.base, text: document.text, updated: Date.now(),
        } : null, key, userId)
      },
    })
  })
  useEffect(() => {
    store.start()
    const stop = () => store.stop()
    const start = () => store.start()
    window.addEventListener('scholaris:clear-paper-recovery', stop)
    window.addEventListener('scholaris:resume-paper-recovery', start)
    return () => { store.stop(); window.removeEventListener('scholaris:clear-paper-recovery', stop); window.removeEventListener('scholaris:resume-paper-recovery', start) }
  }, [store])
  const documents = useSyncExternalStore(store.subscribe, store.getSnapshot)
  return { store, documents }
}
