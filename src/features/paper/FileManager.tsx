import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { applyPaperTree, cleanupFigures, type PaperFile } from './paper-api'
import { chooseMainFile, imageExtension, imageType, imageDimensions, mergeEntries, removeEntries, textExtension, validateTree, type TreeEntry } from './file-tree'
import { planMove, reviewImport, mainCandidates, compatibilityWarnings, type ConflictChoice } from './asset-tools'
import { starterNames, starterTemplate } from './starter-templates'
import type { ZipImport } from './zip-import'
import './file-manager.css'

export default function FileManager({ initialPath = '', initialKind, projectId, files, settings, close, applied, onBusy }: {
  initialPath?: string; initialKind?: 'text' | 'folder'; projectId: string; files: PaperFile[]; settings: { revision: number; main_file: string }
  close: () => void; applied: (warning?: string) => void; onBusy: (busy: boolean) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const uploadInput = useRef<HTMLInputElement>(null)
  const zipInput = useRef<HTMLInputElement>(null)
  const [entries, setEntries] = useState<TreeEntry[]>(files)
  const [main, setMain] = useState(settings.main_file)
  const [selected, setSelected] = useState(initialPath)
  const [destination, setDestination] = useState(initialPath)
  const [newPath, setNewPath] = useState('')
  const [newKind, setNewKind] = useState<'text' | 'folder'>(initialKind ?? 'folder')
  const [incoming, setIncoming] = useState<ZipImport | null>(null)
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({})
  const [move, setMove] = useState<ReturnType<typeof planMove> | null>(null)
  const [rewrite, setRewrite] = useState(true)
  const [template, setTemplate] = useState<keyof typeof starterNames>('article')
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  const reader = useRef<Worker | null>(null)
  const [error, setError] = useState('')
  const [changed, setChanged] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => { const node = dialog.current!; node.showModal(); return () => { reader.current?.terminate(); node.close() } }, [])
  const paths = [...new Set(entries.flatMap((entry) => { const parts = entry.path.split('/'); return parts.map((_, i) => parts.slice(0, i + 1).join('/')) }))].sort()
  function stage(action: () => TreeEntry[]) {
    try { const next = action(); validateTree(next); setEntries(next); setMain(chooseMainFile(next, main)); setMove(null); setChanged(true); setError(''); setMessage('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid file change.') }
  }
  function acceptUpload(imported: ZipImport) {
    const hasCollision = imported.entries.some(entry => entries.some(current => current.path.toLowerCase() === entry.path.toLowerCase()))
    if (hasCollision || imported.skipped.length) { setChoices({}); setIncoming(imported); setMessage('Review files that already exist or were skipped.'); return }
    stage(() => mergeEntries(entries, imported.entries, false))
  }
  function deletePath(path: string) {
    stage(() => removeEntries(entries, path))
    if (selected === path || selected.startsWith(path + '/')) setSelected('')
  }
  async function upload(list: FileList | null, zip: boolean) {
    if (!list?.length || working.current) return
    const selectedFiles = Array.from(list)
    working.current = true; setBusy(true); setError(''); setMessage('Reading files...')
    try {
      if (zip) {
        const file = selectedFiles[0]
        if (file.size > 20 * 1024 * 1024) throw new Error('ZIP uploads are limited to 20 MiB.')
        const buffer = await file.arrayBuffer()
        const worker = new Worker(new URL('./import.worker.ts', import.meta.url), { type: 'module' })
        reader.current = worker
        const imported = await new Promise<ZipImport>((resolve, reject) => {
          const timer = setTimeout(() => { worker.terminate(); reject(new Error('ZIP processing timed out. Try a smaller archive.')) }, 10000)
          worker.onmessage = ({ data }) => { clearTimeout(timer); if (data.error) reject(new Error(data.error)); else resolve(data.result) }
          worker.onerror = () => { clearTimeout(timer); reject(new Error('Unable to read this ZIP.')) }
          worker.postMessage(buffer, [buffer])
        })
        worker.terminate(); reader.current = null
        acceptUpload(imported)
      } else {
        const imported: TreeEntry[] = []
        if (selectedFiles.length > 100 || selectedFiles.reduce((sum, file) => sum + file.size, 0) > 30 * 1024 * 1024) throw new Error('Upload at most 100 files and 30 MiB at a time.')
        for (const file of selectedFiles) {
          if (file.size > 5242880) throw new Error(`File exceeds 5 MiB: ${file.name}`)
          const bytes = new Uint8Array(await file.arrayBuffer())
          if (imageExtension.test(file.name)) {
            imageType(file.name, bytes); imageDimensions(file.name, bytes)
            if (file.type && !['image/png', 'image/jpeg'].includes(file.type)) throw new Error('Figure MIME type must be PNG or JPEG.')
            imported.push({ path: file.name, content: '', kind: 'image', bytes, size_bytes: bytes.length })
          } else if (textExtension.test(file.name)) {
            const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
            if (content.includes('\0')) throw new Error('Source files must be UTF-8 text.')
            imported.push({ path: file.name, kind: 'text', content })
          } else throw new Error(`Unsupported file: ${file.name}. Use LaTeX sources, PNG or JPEG.`)
        }
        validateTree(imported); acceptUpload({ entries: imported, skipped: [] })
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to read files.'); setMessage('') }
    finally { reader.current?.terminate(); reader.current = null; working.current = false; setBusy(false) }
  }
  async function save() {
    if (working.current) return
    try { validateTree(entries, main) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid tree.'); return }
    const ending = files.filter(file => file.shared_epoch && !entries.some(entry => entry.id === file.id && entry.kind === 'text' && entry.content === file.content))
    if (ending.length && !window.confirm(`Replace or delete ${ending.length} live file(s)? Their sessions will end for everyone. Saved work and shared state are preserved in history. Ask coauthors to download unsent drafts first. Only the owner can confirm this change.`)) return
    working.current = true; setBusy(true); onBusy(true); setError(''); setMessage('Uploading figures and applying changes...')
    try {
      await applyPaperTree(projectId, settings.revision, entries, main, ending.length > 0)
      const kept = new Set(entries.filter((entry) => !entry.bytes).map((entry) => entry.storage_path))
      const cleaned = await cleanupFigures(files.map((file) => file.storage_path).filter((path): path is string => !!path && !kept.has(path)))
      applied(cleaned ? undefined : 'File changes were saved, but cleanup of unused figures could not be confirmed.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to apply changes.'); setMessage('') }
    finally { working.current = false; setBusy(false); onBusy(false) }
  }
  return <dialog ref={dialog} className="project-dialog file-manager" aria-labelledby="files-title" onCancel={(event) => { event.preventDefault(); if (!busy) close() }}>
    <div className="export-heading"><div><p className="eyebrow">PAPER WORKSPACE</p><h2 id="files-title">Manage files</h2></div><button type="button" className="file-manager-close" onClick={close} disabled={busy} aria-label="Close file manager" title="Close file manager"><X size={22} strokeWidth={2.25} aria-hidden="true" /></button></div>
    <p className="muted">Upload files or remove what you no longer need, then save. Cancel keeps your workspace unchanged.</p>
    <details className="manager-extra"><summary>Supported files and limits</summary><p>LaTeX sources (.tex, .bib, .sty, .cls, .bst, .clo, .cfg, .def, .txt), PNG and JPEG. Up to 100 files/folders, 512 KiB per source, 5 MiB per image and 25 MiB total images. ZIP: 20 MiB. PDF, SVG and EPS figures need conversion before uploading.</p></details>
    <div className="file-manager-primary-actions"><button className="button primary" disabled={busy || !!incoming} onClick={() => uploadInput.current?.click()}>Upload files</button><button className="button secondary" disabled={busy || !!incoming} onClick={() => zipInput.current?.click()}>Import ZIP</button><button className="button secondary" disabled={busy || !entries.length || !!incoming} onClick={() => { if (window.confirm('Remove every file and folder from this paper workspace? Save changes to confirm. Your project and Paper history will remain.')) { stage(() => []); setSelected(''); setDestination('') } }}>Delete all files</button></div>
    <input ref={uploadInput} hidden type="file" multiple accept=".tex,.bib,.sty,.cls,.txt,.bst,.clo,.cfg,.def,.png,.jpg,.jpeg" onChange={event => { void upload(event.target.files, false); event.target.value = '' }} />
    <input ref={zipInput} hidden type="file" accept=".zip" onChange={event => { void upload(event.target.files, true); event.target.value = '' }} />
    {error && <p role="alert" className="notice error-notice">{error}</p>}
    <section><h3>Files <span className="muted">({entries.length}/100)</span></h3><ul className="manager-file-list">{paths.map(path => <li key={path}><span title={path}>{path}{path === main && <small> Main file</small>}</span><button className="button secondary compact-button" disabled={busy || !!incoming} onClick={() => { setMove(null); setSelected(path); setDestination(path) }}>Rename</button><button className="button secondary compact-button" aria-label={`Delete ${path}`} disabled={busy || !!incoming} onClick={() => deletePath(path)}>Delete</button></li>)}</ul>{!entries.length && <p className="notice">Your workspace will be empty. Upload files now or save to start fresh. Previous saved files can be recovered from Paper history while retained.</p>}
    {selected && <div className="manager-rename">
      <label>Rename or move to<input value={destination} onChange={(event) => { setMove(null); setDestination(event.target.value) }} placeholder="figures/result.png" disabled={!selected || busy} /></label>
      <div className="manager-actions"><button className="button secondary compact-button" disabled={!selected || busy} onClick={() => { try { setMove(planMove(entries, selected, destination.trim(), main)); setRewrite(true); setError('') } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to preview move.') } }}>Review rename</button><button className="button secondary compact-button" onClick={() => { setSelected(''); setMove(null) }}>Cancel rename</button></div></div>}
    </section><details className="manager-extra" open={initialKind !== undefined}><summary>New file or folder</summary><section className="manager-tools">
      <form onSubmit={(event) => { event.preventDefault(); stage(() => { const next = mergeEntries(entries, [{ path: newPath.trim(), kind: newKind, content: '' }], false); setNewPath(''); return next }) }}><label>Create<select value={newKind} onChange={(event) => setNewKind(event.target.value as 'folder' | 'text')} disabled={busy}><option value="folder">Folder</option><option value="text">Source file</option></select></label><label>Relative path<input value={newPath} onChange={(event) => setNewPath(event.target.value)} placeholder="sections or sections/methods.tex" required disabled={busy} /></label><button className="button secondary" disabled={busy}>Add {newKind === 'text' ? 'file' : 'folder'}</button></form>
    </section></details>
    {!!main && <label>Main file to compile<select value={main} disabled={busy} onChange={event => { setMain(event.target.value); setChanged(true) }}>{entries.filter(entry => entry.kind === 'text' && entry.path.endsWith('.tex')).map(entry => <option key={entry.path}>{entry.path}</option>)}</select></label>}
    {move && <section className="import-review"><h3>Review rename / move</h3><p>{selected} ? {destination}</p><p>Main file: {move.main}. {move.changes.length} supported path updates.</p><ul>{move.changes.map((change,i) => <li key={i}>{change.path}: <code>{change.before}</code> ? <code>{change.after}</code></li>)}</ul>{move.warnings.map(warning => <p key={warning} className="notice">{warning}</p>)}<p>Only literal paths are updated. Review custom commands and compile afterward.</p><label className="export-checkbox"><input type="checkbox" checked={rewrite} onChange={e => setRewrite(e.target.checked)} />Update supported LaTeX paths</label><button className="button secondary" disabled={busy} onClick={() => { stage(() => rewrite ? move.entries : move.moved); setMain(move.main); setMove(null); setSelected('') }}>Confirm rename</button><button className="button secondary" onClick={() => setMove(null)}>Cancel move</button></section>}
    <details className="manager-extra"><summary>Start from a template</summary><section className="import-review"><p>Original starter documents. Review conflicts before replacing any existing files.</p><label>Starter<select value={template} disabled={busy} onChange={e => setTemplate(e.target.value as keyof typeof starterNames)}>{Object.entries(starterNames).map(([key,name]) => <option key={key} value={key}>{name}</option>)}</select></label><button className="button secondary" disabled={busy || !!incoming || !!move} onClick={() => { setChoices({}); setIncoming({ entries: starterTemplate(template), skipped: [] }) }}>Preview starter files</button></section></details>
    {incoming && <section className="import-review"><h3>Import preview</h3><p>{incoming.entries.length} supported entries; {incoming.skipped.length} skipped. Renaming imported paths may require repairing their LaTeX references.</p>{compatibilityWarnings(incoming.entries).map(warning => <p key={warning} className="notice">{warning}</p>)}<p>Detected main files: {mainCandidates(incoming.entries).join(', ') || 'None. Choose the main .tex file after adding them.'}</p><ul>{incoming.entries.map(entry => { const collision = entries.some(current => current.path.toLowerCase() === entry.path.toLowerCase() && !(current.kind === 'folder' && entry.kind === 'folder')); const choice = Object.hasOwn(choices,entry.path) ? choices[entry.path] : undefined; return <li key={entry.path}><strong>{entry.path}</strong>{collision && <><label>File already exists — choose an action<select value={choice?.action ?? ''} onChange={e => setChoices(prev => ({ ...prev, [entry.path]: { action: e.target.value as ConflictChoice['action'], path: choice?.path } }))}><option value="">Choose an action</option><option value="keep">Keep existing</option><option value="replace">Replace existing</option><option value="rename">Import at a different path</option></select></label>{choice?.action === 'rename' && <label>New path<input value={choice.path ?? ''} onChange={e => setChoices(prev => ({ ...prev, [entry.path]: { action: 'rename', path: e.target.value } }))} /></label>}</>}</li> })}</ul>{incoming.skipped.length > 0 && <details><summary>Skipped files — check compatibility</summary><p>{incoming.skipped.join(', ')}</p></details>}<button className="button secondary" disabled={busy || !incoming.entries.length || !!move} onClick={() => stage(() => { const next = reviewImport(entries, incoming.entries, choices); setIncoming(null); return next })}>Add files</button><button className="button secondary" disabled={busy} onClick={() => setIncoming(null)}>Discard import</button></section>}
    <p role="status" className="export-status">{message || (changed ? 'Ready to save. Your workspace is unchanged until you save.' : 'No unsaved file changes.')}</p>
    <div className="dialog-actions"><button className="button secondary" disabled={busy} onClick={close}>Cancel</button><button className="button primary" disabled={busy || !changed || !!incoming || !!move} onClick={() => void save()}>{busy ? 'Working...' : 'Save changes'}</button></div>
  </dialog>
}
