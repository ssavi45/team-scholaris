import { useEffect, useRef, useState } from 'react'
import { applyPaperTree, cleanupFigures, type PaperFile } from './paper-api'
import { imageExtension, imageType, mergeEntries, moveEntries, removeEntries, textExtension, validateTree, type TreeEntry } from './file-tree'
import type { ZipImport } from './zip-import'

export default function FileManager({ projectId, files, settings, close, applied, onBusy }: {
  projectId: string; files: PaperFile[]; settings: { revision: number; main_file: string }
  close: () => void; applied: () => void; onBusy: (busy: boolean) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [entries, setEntries] = useState<TreeEntry[]>(files)
  const [main, setMain] = useState(settings.main_file)
  const [selected, setSelected] = useState('')
  const [destination, setDestination] = useState('')
  const [newPath, setNewPath] = useState('')
  const [newKind, setNewKind] = useState<'text' | 'folder'>('folder')
  const [incoming, setIncoming] = useState<ZipImport | null>(null)
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const working = useRef(false)
  const reader = useRef<Worker | null>(null)
  const [error, setError] = useState('')
  const [changed, setChanged] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => { const node = dialog.current!; node.showModal(); return () => { reader.current?.terminate(); node.close() } }, [])
  const paths = [...new Set(entries.flatMap((entry) => { const parts = entry.path.split('/'); return parts.map((_, i) => parts.slice(0, i + 1).join('/')) }))].sort()
  function stage(action: () => TreeEntry[]) {
    try { const next = action(); validateTree(next); setEntries(next); setChanged(true); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid file change.') }
  }
  async function upload(list: FileList | null, zip: boolean) {
    if (!list?.length || working.current) return
    working.current = true; setBusy(true); setError(''); setMessage('Reading files...')
    try {
      if (zip) {
        const file = list[0]
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
        setIncoming(imported)
      } else {
        const imported: TreeEntry[] = []
        for (const file of Array.from(list)) {
          if (file.size > 5242880) throw new Error(`File exceeds 5 MiB: ${file.name}`)
          const bytes = new Uint8Array(await file.arrayBuffer())
          if (imageExtension.test(file.name)) {
            imageType(file.name, bytes)
            imported.push({ path: file.name, content: '', kind: 'image', bytes, size_bytes: bytes.length })
          } else if (textExtension.test(file.name)) {
            const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
            if (content.includes('\0')) throw new Error('Source files must be UTF-8 text.')
            imported.push({ path: file.name, kind: 'text', content })
          } else throw new Error(`Unsupported file: ${file.name}. Use LaTeX sources, PNG or JPEG.`)
        }
        validateTree(imported); setIncoming({ entries: imported, skipped: [] })
      }
      setMessage('Review the incoming files before adding them to the staged tree.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to read files.'); setMessage('') }
    finally { working.current = false; setBusy(false) }
  }
  async function save() {
    if (working.current) return
    try { validateTree(entries, main) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid tree.'); return }
    working.current = true; setBusy(true); onBusy(true); setError(''); setMessage('Uploading figures and applying changes...')
    try {
      await applyPaperTree(projectId, settings.revision, entries, main)
      const kept = new Set(entries.filter((entry) => !entry.bytes).map((entry) => entry.storage_path))
      await cleanupFigures(files.map((file) => file.storage_path).filter((path): path is string => !!path && !kept.has(path)))
      applied()
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to apply changes.'); setMessage('') }
    finally { working.current = false; setBusy(false); onBusy(false) }
  }
  return <dialog ref={dialog} className="project-dialog file-manager" aria-labelledby="files-title" onCancel={(event) => { event.preventDefault(); if (!busy) close() }}>
    <div className="export-heading"><div><p className="eyebrow">PAPER WORKSPACE</p><h2 id="files-title">Manage files</h2></div><button className="tool-button" onClick={close} disabled={busy} aria-label="Close file manager">&times;</button></div>
    <p className="muted">Stage changes below, then apply them together. Rename and move do not rewrite LaTeX commands; update your input and image paths afterward.</p>
    {error && <p role="alert" className="notice error-notice">{error}</p>}
    <div className="manager-grid"><section><h3>File tree <span className="muted">({entries.length}/100)</span></h3><div className="manager-tree"><select size={10} aria-label="File or folder to manage" value={selected} onChange={(event) => { setSelected(event.target.value); setDestination(event.target.value) }}>{paths.map((path) => <option key={path} value={path}>{entries.find((entry) => entry.path === path)?.kind === 'folder' || !entries.some((entry) => entry.path === path) ? '\u25b8 ' : ''}{path}{path === main ? ' (main)' : ''}</option>)}</select></div>
      <label>Rename or move to<input value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="figures/result.png" disabled={!selected || busy} /></label>
      <div className="manager-actions"><button className="button secondary compact-button" disabled={!selected || busy} onClick={() => stage(() => { const next = moveEntries(entries, selected, destination.trim()); if (main === selected || main.startsWith(selected + '/')) setMain(destination.trim() + main.slice(selected.length)); setSelected(''); return next })}>Rename / move</button><button className="button secondary compact-button" disabled={!selected || busy} onClick={() => {
        const count = entries.filter((entry) => entry.path === selected || entry.path.startsWith(selected + '/')).length
        if (window.confirm(`Stage deletion of ${selected} and its contents (${count} entries)? This is applied only when you save changes.`)) stage(() => { const next = removeEntries(entries, selected); setSelected(''); return next })
      }}>Delete</button></div>
    </section><section className="manager-tools"><label>Main .tex file<select value={main} disabled={busy} onChange={(event) => { setMain(event.target.value); setChanged(true) }}><option value="">Choose main file</option>{entries.filter((entry) => entry.kind === 'text' && entry.path.endsWith('.tex')).map((entry) => <option key={entry.path}>{entry.path}</option>)}</select></label>
      <form onSubmit={(event) => { event.preventDefault(); stage(() => { const next = mergeEntries(entries, [{ path: newPath.trim(), kind: newKind, content: '' }], false); setNewPath(''); return next }) }}><label>Create<select value={newKind} onChange={(event) => setNewKind(event.target.value as 'folder' | 'text')} disabled={busy}><option value="folder">Folder</option><option value="text">Source file</option></select></label><label>Relative path<input value={newPath} onChange={(event) => setNewPath(event.target.value)} placeholder="sections or sections/methods.tex" required disabled={busy} /></label><button className="button secondary" disabled={busy}>Stage new {newKind === 'text' ? 'file' : 'folder'}</button></form>
      <label className="manager-upload">Upload sources or figures<input type="file" multiple accept=".tex,.bib,.sty,.cls,.txt,.bst,.clo,.cfg,.def,.png,.jpg,.jpeg" disabled={busy} onChange={(event) => { void upload(event.target.files, false); event.target.value = '' }} /></label>
      <label className="manager-upload">Import LaTeX ZIP<input type="file" accept=".zip" disabled={busy} onChange={(event) => { void upload(event.target.files, true); event.target.value = '' }} /></label>
    </section></div>
    {incoming && <section className="import-review"><h3>Import preview</h3><p className="muted">{incoming.entries.length} supported entries. {incoming.skipped.length} unsupported/generated entries skipped.</p><ul>{incoming.entries.map((entry) => <li key={entry.path}>{entry.path}{entries.some((current) => current.path.toLowerCase() === entry.path.toLowerCase()) ? ' — already exists' : ''}</li>)}</ul>{incoming.skipped.length > 0 && <details><summary>Skipped files</summary><p>{incoming.skipped.join(', ')}</p></details>}<label className="export-checkbox"><input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} />Replace matching paths in the staged tree</label><button className="button secondary compact-button" disabled={busy || !incoming.entries.length} onClick={() => stage(() => { const next = mergeEntries(entries, incoming.entries, replace); setIncoming(null); return next })}>Stage import</button></section>}
    <p role="status" className="export-status">{message || (changed ? 'Changes staged. Your project is unchanged until you apply them.' : 'No changes staged.')}</p>
    <div className="dialog-actions"><button className="button secondary" disabled={busy} onClick={close}>Cancel</button><button className="button primary" disabled={busy || !changed || !!incoming} onClick={() => void save()}>{busy ? 'Working...' : 'Apply changes'}</button></div>
  </dialog>
}
