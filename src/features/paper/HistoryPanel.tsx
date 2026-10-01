import { useEffect, useMemo, useRef, useState } from 'react'
import { checkpoint, cleanupHistoryFigures, deleteHistory, getHistory, listHistory, restoreHistory, type HistoryItem, type HistorySnapshot } from './history-api'
import { hydrateFigures, loadPaperState } from './paper-api'
import { compareHistory, sourceDiff } from './history-diff'
import { downloadName, requestDownload, sourceArchive } from './paper-export'
import './history.css'

export default function HistoryPanel({ projectId, title, editable, blocked, close, onBusy, restored }: {
  projectId: string; title: string; editable: boolean; blocked: boolean; close: () => void;
  onBusy: (value: boolean) => void; restored: () => Promise<void>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [rows, setRows] = useState<HistoryItem[]>([])
  const [more, setMore] = useState(false)
  const [base, setBase] = useState<Awaited<ReturnType<typeof loadPaperState>> | null>(null)
  const [snapshot, setSnapshot] = useState<HistorySnapshot | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const alive = useRef(true)
  const request = useRef<AbortController | null>(null)
  const working = useRef(false)
  useEffect(() => {
    alive.current = true
    const node = dialog.current!
    node.showModal()
    const controller = new AbortController(); request.current = controller
    void Promise.all([listHistory(projectId, undefined, controller.signal), loadPaperState(projectId, controller.signal)]).then(([items, state]) => {
      if (controller.signal.aborted) return
      setRows(items.slice(0, 20)); setMore(items.length > 20); setBase(state)
    }).catch(cause => { if (!controller.signal.aborted) setError(message(cause)) })
    return () => { alive.current = false; request.current?.abort(); node.close() }
  }, [projectId])
  async function refresh() {
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    const [items, state] = await Promise.all([listHistory(projectId, undefined, controller.signal), loadPaperState(projectId, controller.signal)])
    if (!alive.current || controller.signal.aborted) return
    setRows(items.slice(0, 20)); setMore(items.length > 20); setBase(state); setSnapshot(null); setSelectedId('')
  }
  async function run(action: () => Promise<void>, mutation = false) {
    if (working.current) return
    working.current = true; setBusy(true); setError(''); setStatus('')
    if (mutation) onBusy(true)
    try { await action() } catch (cause) { if (alive.current) setError(message(cause)) }
    finally { working.current = false; if (alive.current) setBusy(false); if (mutation) onBusy(false) }
  }
  async function select(item: HistoryItem) {
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    const detail = await getHistory(projectId, item.id, controller.signal)
    if (alive.current && !controller.signal.aborted) { setSnapshot(detail); setSelectedId(detail.files.find(file => file.path === detail.main_file)?.id ?? detail.files[0]?.id ?? '') }
  }
  const changes = useMemo(() => snapshot && base ? compareHistory(snapshot.files, base.files) : [], [snapshot, base])
  const chosen = changes.find(change => change.id === selectedId)
  const diff = useMemo(() => sourceDiff(chosen?.before?.content ?? '', chosen?.after?.content ?? ''), [chosen])
  const canWrite = editable && !blocked && !busy && !!base?.settings
  async function restore(fileId?: string) {
    if (!snapshot || !base?.settings || !canWrite) return
    if (!window.confirm(`Restore ${fileId ? chosen?.before?.path : 'the entire paper'} from "${snapshot.label}"? A protected checkpoint of the current paper will be created first. This creates a new revision; it does not erase history.`)) return
    const affected = base.files.filter(file => file.shared_epoch && (!fileId || file.id === fileId))
    if (affected.length && !window.confirm(`This ends live writing in ${affected.length} file(s). Ask coauthors to download unsent drafts first. Saved text and shared state are retained in the safety checkpoint. The owner must confirm; restored files start new sessions explicitly.`)) return
    await run(async () => {
      await restoreHistory(projectId, snapshot.id, base.settings!.revision, fileId, affected.length > 0)
      await restored()
      await refresh()
      setStatus('Restore completed as a new revision. The previous paper is preserved in a protected safety checkpoint. Recompile to update the PDF.')
    }, true)
  }
  return <dialog ref={dialog} className="project-dialog paper-history-dialog" aria-labelledby="paper-history-title" onCancel={event => { event.preventDefault(); if (!busy) close() }}>
    <div className="history-heading"><div><h2 id="paper-history-title">Paper history</h2><p>Compare saved versions before bringing work back.</p></div><button className="tool-button" disabled={busy} onClick={close} aria-label="Close paper history">&times;</button></div>
    {error && <p className="notice error-notice" role="alert">{error} If a request was interrupted, refresh history before trying it again.</p>}
    {blocked && <p className="notice" role="status">Save pending drafts and review recovery/conflicts before creating a checkpoint or restoring. You can still inspect history.</p>}
    <details className="history-limits"><summary>Retention, quotas and figure protection</summary><p>Automatic source snapshots are at most once per five minutes. Tree changes also capture before/after states. Up to 24 automatic snapshots are kept for seven days; older/over-quota automatic snapshots are pruned when capturing new history. Up to 20 named and pre-restore safety checkpoints are protected until explicitly deleted. Limits: 50 MiB snapshot data and 100 MiB distinct referenced figures per paper. Automatic source snapshots may be skipped when protected checkpoints fill the quota; explicit checkpoint/restore/tree changes fail safely. History starts when enabled, not before.</p><p>Figures remain private and cannot be deleted while live files or history reference them. After pruning/deletion, editors can remove unused figures older than one hour.</p>{editable && <button className="button secondary compact-button" disabled={!canWrite} onClick={() => void run(async () => { const count = await cleanupHistoryFigures(projectId); setStatus(`Cleanup requested for ${count} unreferenced figures (up to 100 per run).`) }, true)}>Clean up unused figures</button>}</details>
    <div className="history-grid"><aside className="history-list">
      <button className="button secondary compact-button" disabled={busy} onClick={() => void run(refresh)}>Refresh history</button>
      {editable && <form onSubmit={event => { event.preventDefault(); if (!canWrite) return; void run(async () => { await checkpoint(projectId, base!.settings!.revision, label); setLabel(''); await refresh(); setStatus('Named checkpoint created.') }, true) }}><label>Checkpoint name<input maxLength={120} value={label} onChange={event => setLabel(event.target.value)} placeholder="Advisor draft" required disabled={busy} /></label><button className="button primary compact-button" disabled={!canWrite || !label.trim()}>Create checkpoint</button></form>}
      {!base && !error && <p role="status">Loading history...</p>}
      {!!base && !rows.length && <p>No snapshots yet. Create a checkpoint to preserve this paper.</p>}
      {rows.map(item => <button className="history-item" aria-pressed={snapshot?.id === item.id} key={item.id} disabled={busy} onClick={() => void run(() => select(item))}><strong>{item.label || 'Automatic snapshot'}</strong><span>{item.kind === 'automatic' ? 'Automatic' : item.kind === 'safety' ? 'Protected safety checkpoint' : 'Named checkpoint'}</span><time>{new Date(item.created_at).toLocaleString()}</time><small>{item.actor_name} · {item.file_count} entries · revision {item.revision}</small></button>)}
      {more && <button className="button secondary compact-button" disabled={busy} onClick={() => void run(async () => { const items = await listHistory(projectId, rows.at(-1)?.id); if (alive.current) { setRows(current => [...current, ...items.slice(0, 20)]); setMore(items.length > 20) } })}>Load older snapshots</button>}
    </aside><section className="history-preview" aria-label="Snapshot comparison">
      {!snapshot ? <p>Select a snapshot to preview its sources and file changes. Your current editor remains untouched.</p> : <>
        <h3>{snapshot.label}</h3><p>Snapshot revision {snapshot.revision} compared with saved revision {base?.settings?.revision}. Unsaved local text is excluded.</p>
        <p>Main file: <strong>{snapshot.main_file}</strong>{snapshot.main_file !== base?.settings?.main_file && <> → current: <strong>{base?.settings?.main_file}</strong></>}</p>
        <div className="history-actions"><button className="button secondary compact-button" disabled={busy} onClick={() => void run(async () => {
          const controller = new AbortController(); request.current = controller
          const files = await hydrateFigures(snapshot.files, controller.signal)
          const bytes = await sourceArchive(files, controller.signal)
          if (alive.current) { requestDownload(new Blob([bytes], { type: 'application/zip' }), downloadName(`${title}-snapshot-${snapshot.id}`, 'source')); setStatus(`Snapshot ZIP download requested. Compile entry: ${snapshot.main_file}.`) }
        })}>Download snapshot ZIP</button>{editable && <><button className="button primary compact-button" disabled={!canWrite} onClick={() => void restore()}>Restore entire paper...</button><button className="button secondary compact-button" disabled={!canWrite} onClick={() => {
          if (window.confirm(`Permanently delete "${snapshot.label}"? Download it first if you need a copy. This cannot be undone.`)) void run(async () => { await deleteHistory(projectId, snapshot.id); await refresh(); setStatus('Snapshot deleted. Current paper is unchanged.') }, true)
        }}>Delete snapshot...</button></>}</div>
        <label>File to compare<select value={selectedId} onChange={event => setSelectedId(event.target.value)}>{changes.map(change => <option key={change.id} value={change.id}>{change.after?.path ?? change.before!.path} — {change.changes.join(', ') || 'Unchanged'}</option>)}</select></label>
        {chosen && <><p>{chosen.changes.join(' · ') || 'Unchanged'}{chosen.before?.path !== chosen.after?.path && <> · Snapshot path: {chosen.before?.path ?? '(absent)'}</>}</p>
          {chosen.before?.kind === 'text' || chosen.after?.kind === 'text' ? <>
            <details><summary>Full source preview</summary><div className="history-source-pair"><div><h4>Snapshot</h4><pre>{chosen.before?.content ?? '(Not in snapshot)'}</pre></div><div><h4>Current saved source</h4><pre>{chosen.after?.content ?? '(Deleted from current paper)'}</pre></div></div></details>
            <p>Changed block beginning at line {diff.firstLine}. Unchanged prefix/suffix omitted; separate edits may share one block.</p>
            <pre className="history-diff" aria-label="Source changes">{!diff.removed.length && !diff.added.length ? 'No source changes.' : <>{diff.removed.slice(0, 1000).map((line, index) => <span className="diff-removed" key={`r${index}`}>- {line}{'\n'}</span>)}{diff.added.slice(0, 1000).map((line, index) => <span className="diff-added" key={`a${index}`}>+ {line}{'\n'}</span>)}</>}</pre>
            {(diff.removed.length > 1000 || diff.added.length > 1000) && <p>Changed-block display limited to 1,000 lines per side. Full preview and ZIP retain all text.</p>}
          </> : <p>{chosen.before?.kind ?? chosen.after?.kind} · Snapshot: {chosen.before?.size_bytes ?? 0} bytes · Current: {chosen.after?.size_bytes ?? 0} bytes. Figure bytes are included in the snapshot ZIP.</p>}
          {editable && chosen.before && chosen.before.kind !== 'folder' && <button className="button secondary compact-button" disabled={!canWrite} onClick={() => void restore(chosen.id)}>Restore this file...</button>}
        </>}
      </>}
    </section></div><p role="status">{busy ? 'Working...' : status}</p>
  </dialog>
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'Unable to complete the history operation.' }
