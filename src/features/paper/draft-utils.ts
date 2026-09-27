import type { DraftDocument } from './draft-store'
import { requestDownload } from './paper-export'

export function downloadDraft(path: string, text: string) {
  requestDownload(new Blob([text], { type: 'text/plain;charset=utf-8' }), `recovered-${path.split('/').pop() || 'paper.tex'}`)
}
export function draftStatus(document: DraftDocument, online: boolean) {
  if (document.saving) return 'Saving...'
  if (document.remote !== undefined) return document.remote ? 'Conflict' : 'File unavailable'
  if (document.error) return 'Save failed'
  if (document.text === document.base.content) return 'Saved'
  if (!online) return document.local ? 'Local only / offline' : 'Offline / not backed up'
  return document.local ? 'Saved on this device' : 'Unsaved / backing up'
}

