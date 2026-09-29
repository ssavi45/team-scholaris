import { useEffect, useRef, useState } from 'react'
import { applyPaperTree, loadPaperState, type PaperFile } from './paper-api'
import { replacementPreview } from './editor-tools'
import { sourceDiff } from './history-diff'
type Preview = ReturnType<typeof replacementPreview<PaperFile>> & { revision: number; main: string }
export default function ReplaceProjectDialog({ projectId, query, replacement, matchCase, blocked, close, onBusy, applied }: {
  projectId: string; query: string; replacement: string; matchCase: boolean; blocked: boolean;
  close: () => void; onBusy: (value: boolean) => void; applied: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null), working = useRef(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {
    const node = dialog.current!; node.showModal()
    const controller = new AbortController()
    void loadPaperState(projectId, controller.signal).then(state => {
      if (controller.signal.aborted) return
      if (!state.settings) throw new Error('Paper unavailable.')
      setPreview({ ...replacementPreview(state.files, query, replacement, matchCase), revision: state.settings.revision, main: state.settings.main_file })
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to prepare replacement preview.') })
    return () => { controller.abort(); node.close() }
  }, [projectId, query, replacement, matchCase])
  async function apply() {
    if (!preview || blocked || working.current || !preview.count) return
    working.current = true; setBusy(true); onBusy(true); setError('')
    try { await applyPaperTree(projectId, preview.revision, preview.entries, preview.main); await applied(); close() }
    catch (cause) { setError(`${cause instanceof Error ? cause.message : 'Replacement failed.'} Close and preview again before retrying. Your drafts are preserved.`) }
    finally { working.current = false; setBusy(false); onBusy(false) }
  }
  return <dialog ref={dialog} className="project-dialog replace-project-dialog" aria-labelledby="replace-project-title" onCancel={event => { event.preventDefault(); if (!busy) close() }}><h2 id="replace-project-title">Preview project replacement</h2><p>Literal text: <code>{query}</code> → <code>{replacement || '(empty)'}</code>. {matchCase ? 'Case-sensitive.' : 'Case-insensitive.'}</p><p>Applies atomically to saved revision {preview?.revision ?? '…'}. Other tabs cannot silently overwrite this preview. Paper history records the before/after manifests.</p>{error && <p role="alert" className="notice error-notice">{error}</p>}{blocked && !busy && <p>Save pending drafts and resolve conflicts before applying.</p>}{!preview && !error && <p role="status">Loading saved source...</p>}{preview && <><strong>{preview.count} replacements across {preview.changes.length} files</strong><div className="replace-project-changes">{preview.changes.map(change => { const diff = sourceDiff(change.before.content, change.after.content); return <details key={change.before.id}><summary>{change.before.path} · {change.count} replacements</summary><p>Changed block at line {diff.firstLine}; display limited to 200 lines per side.</p><pre>{diff.removed.slice(0, 200).map(line => '- ' + line).join('\n')}{'\n'}{diff.added.slice(0, 200).map(line => '+ ' + line).join('\n')}</pre></details> })}</div></>}<div className="history-actions"><button className="button secondary" disabled={busy} onClick={close}>Cancel</button><button className="button primary" disabled={!preview?.count || blocked || busy || !!error} onClick={() => void apply()}>{busy ? 'Applying...' : 'Apply replacements'}</button></div></dialog>
}
