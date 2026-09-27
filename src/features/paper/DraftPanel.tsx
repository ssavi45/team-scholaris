import { useState } from 'react'
import type { PaperDraftStore, DraftDocument } from './draft-store'
import type { RecoveryDraft } from './draft-storage'
import { downloadDraft, draftStatus } from './draft-utils'
import './drafts.css'

export function DraftPanel({ store, documents, recovery, online, editable, busy, restore, discardRecovery, refresh }: {
  store: PaperDraftStore; documents: Record<string, DraftDocument>; recovery: RecoveryDraft[];
  online: boolean; editable: boolean; busy: boolean; restore: (record: RecoveryDraft) => void;
  discardRecovery: (record: RecoveryDraft) => void; refresh: () => void
}) {
  const dirty = Object.values(documents).filter(document => document.text !== document.base.content || document.error)
  const [error, setError] = useState('')
  async function saveAll() {
    try { setError(''); await store.saveAll() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save all files.') }
  }
  return <section className="paper-drafts" aria-label="Paper draft safety">
    <div className="draft-summary"><span role="status">{dirty.length ? `${dirty.length} file${dirty.length === 1 ? '' : 's'} pending` : 'All files saved'}{!online && ' - Offline'}</span>
      <button className="tool-button" disabled={!dirty.length || !editable || busy || !online} onClick={() => void saveAll()}>Save all</button>
      <button className="tool-button" disabled={busy} onClick={refresh}>Check server</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {!!recovery.length && <details open><summary>Recover unsaved work ({recovery.length} copies)</summary>
      <p>These copies stay on this browser for up to seven days. Review before restoring; another tab may still be editing. Browser storage can be cleared or unavailable. Sign-out clears account recovery copies.</p>
      {recovery.map(record => <div className="draft-recovery" key={record.key}>
        <strong>{record.base.path}</strong><time>{new Date(record.updated).toLocaleString()}</time>
        <details><summary>Review recovered text</summary><pre>{record.text}</pre></details>
        <div className="draft-actions"><button className="tool-button" disabled={busy || !editable || !documents[record.base.id] || documents[record.base.id]?.saving} onClick={() => restore(record)}>Restore for review</button>
          <button className="tool-button" onClick={() => downloadDraft(record.base.path, record.text)}>Download copy</button>
          <button className="tool-button" disabled={busy} onClick={() => discardRecovery(record)}>Discard copy</button></div>
      </div>)}
    </details>}
    {!!dirty.length && <details open={dirty.some(document => !!document.error || document.remote !== undefined || !document.local)}><summary>Drafts and save details</summary>
      {dirty.map(document => <div className="draft-recovery" key={document.base.id}>
        <strong>{document.base.path}</strong><span>{draftStatus(document, online)}</span>
        {document.savedAt && <small>Last server save: {new Date(document.savedAt).toLocaleString()}</small>}
        {!document.local && <p role="status">Local backup has not completed. If it stays unavailable, download a copy before leaving.</p>}
        {document.error && <p role="alert">{document.error}</p>}
        <div className="draft-actions"><button className="tool-button" onClick={() => downloadDraft(document.base.path, document.text)}>Download draft</button>
          <button className="tool-button" disabled={busy || document.saving || !editable || !online || document.remote !== undefined} onClick={() => void store.save(document.base.id).catch(cause => setError(String(cause.message)))}>Retry save</button>
          <button className="tool-button" disabled={busy || document.saving} onClick={() => { if (window.confirm('Discard this local draft and use the latest loaded server text?')) store.discard(document.base.id) }}>Discard local draft</button></div>
        {document.remote && <ConflictEditor key={`${document.base.id}:${document.remote.version}`} document={document} disabled={!editable || busy || document.saving || !online} resolve={text => {
          try { store.resolve(document.base.id, text); void store.save(document.base.id).catch(cause => setError(String(cause.message))) }
          catch (cause) { setError(String(cause)) }
        }} />}
      </div>)}
    </details>}
    <details><summary>How your drafts are protected</summary><p>Autosave runs after 1.5 seconds without typing. Only server-acknowledged text is marked Saved. Local recovery is a browser backup, not a cloud save. Switching files keeps edits and undo history for this visit. Ctrl/Cmd+S saves immediately. Use Check server after reconnecting or a failed save; conflicts require your review.</p></details>
  </section>
}
function ConflictEditor({ document, disabled, resolve }: { document: DraftDocument; disabled: boolean; resolve: (text: string) => void }) {
  const [merged, setMerged] = useState(document.text)
  return <details><summary>Compare and resolve</summary>
    <div className="draft-comparison"><label>Original base<textarea value={document.base.content} readOnly /></label><label>Current local draft<textarea value={document.text} readOnly /></label><label>Latest loaded server text<textarea value={document.remote?.content} readOnly /></label></div>
    <label>Resolved text<textarea value={merged} onChange={event => setMerged(event.target.value)} disabled={disabled} /></label>
    <p>Review all three versions and edit the resolved text. A further server change will be rejected safely.</p>
    <button className="tool-button" disabled={disabled} onClick={() => { if (window.confirm('Save this resolved text against the displayed server version?')) resolve(merged) }}>Save resolved version</button>
  </details>
}
