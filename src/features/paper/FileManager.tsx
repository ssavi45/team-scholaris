import { useEffect, useRef, useState } from 'react'
import { applyPaperTree, cleanupFigures, type PaperFile } from './paper-api'
import { imageExtension, imageType, imageDimensions, mergeEntries, removeEntries, textExtension, validateTree, type TreeEntry } from './file-tree'
import { planMove, reviewImport, mainCandidates, compatibilityWarnings, type ConflictChoice } from './asset-tools'
import { starterNames, starterTemplate } from './starter-templates'
import type { ZipImport } from './zip-import'

export default function FileManager({ initialPath = '', initialKind = 'folder', projectId, files, settings, close, applied, onBusy }: {
  initialPath?: string; initialKind?: 'text' | 'folder'; projectId: string; files: PaperFile[]; settings: { revision: number; main_file: string }
  close: () => void; applied: (warning?: string) => void; onBusy: (busy: boolean) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [entries, setEntries] = useState<TreeEntry[]>(files)
  const [main, setMain] = useState(settings.main_file)
  const [selected, setSelected] = useState(initialPath)
  const [destination, setDestination] = useState(initialPath)
  const [newPath, setNewPath] = useState('')
  const [newKind, setNewKind] = useState<'text' | 'folder'>(initialKind)
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
    try { const next = action(); validateTree(next); setEntries(next); setMove(null); setChanged(true); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid file change.') }
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
        setChoices({}); setIncoming(imported)
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
        validateTree(imported); setChoices({}); setIncoming({ entries: imported, skipped: [] })
      }
      setMessage('Review the incoming files before adding them to the staged tree.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to read files.'); setMessage('') }
    finally { reader.current?.terminate(); reader.current = null; working.current = false; setBusy(false) }
  }
  async function save() {
    if (working.current) return
    try { validateTree(entries, main) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid tree.'); return }
    working.current = true; setBusy(true); onBusy(true); setError(''); setMessage('Uploading figures and applying changes...')
    try {
      await applyPaperTree(projectId, settings.revision, entries, main)
      const kept = new Set(entries.filter((entry) => !entry.bytes).map((entry) => entry.storage_path))
      const cleaned = await cleanupFigures(files.map((file) => file.storage_path).filter((path): path is string => !!path && !kept.has(path)))
      applied(cleaned ? undefined : 'File changes were saved, but cleanup of unused figures could not be confirmed.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to apply changes.'); setMessage('') }
    finally { working.current = false; setBusy(false); onBusy(false) }
  }
  return <dialog ref={dialog} className="project-dialog file-manager" aria-labelledby="files-title" onCancel={(event) => { event.preventDefault(); if (!busy) close() }}>
    <div className="export-heading"><div><p className="eyebrow">PAPER WORKSPACE</p><h2 id="files-title">Manage files</h2></div><button className="tool-button" onClick={close} disabled={busy} aria-label="Close file manager">&times;</button></div>
    <p className="muted">Review file changes before applying. Saved changes are recorded in Paper history and can be restored. Limits: 100 entries, 512 KiB per source, 5 MiB per PNG/JPEG, 25 MiB total figures; 16,000px per side and 40 megapixels per image. PDF/SVG/EPS figures require conversion outside this workspace.</p>
    {error && <p role="alert" className="notice error-notice">{error}</p>}
    <div className="manager-grid"><section><h3>File tree <span className="muted">({entries.length}/100)</span></h3><div className="manager-tree"><select size={10} aria-label="File or folder to manage" value={selected} onChange={(event) => { setMove(null); setSelected(event.target.value); setDestination(event.target.value) }}>{paths.map((path) => <option key={path} value={path}>{entries.find((entry) => entry.path === path)?.kind === 'folder' || !entries.some((entry) => entry.path === path) ? '\u25b8 ' : ''}{path}{path === main ? ' (main)' : ''}</option>)}</select></div>
      <label>Rename or move to<input value={destination} onChange={(event) => { setMove(null); setDestination(event.target.value) }} placeholder="figures/result.png" disabled={!selected || busy} /></label>
      <div className="manager-actions"><button className="button secondary compact-button" disabled={!selected || busy} onClick={() => { try { setMove(planMove(entries, selected, destination.trim(), main)); setRewrite(true); setError('') } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to preview move.') } }}>Preview rename / move</button><button className="button secondary compact-button" disabled={!selected || busy} onClick={() => {
        const count = entries.filter((entry) => entry.path === selected || entry.path.startsWith(selected + '/')).length
        if (window.confirm(`Stage deletion of ${selected} and its contents (${count} entries)? This is applied only when you save changes.`)) stage(() => { const next = removeEntries(entries, selected); setSelected(''); return next })
      }}>Delete</button></div>
    </section><section className="manager-tools"><label>Main .tex file<select value={main} disabled={busy} onChange={(event) => { setMove(null); setMain(event.target.value); setChanged(true) }}><option value="">Choose main file</option>{entries.filter((entry) => entry.kind === 'text' && entry.path.endsWith('.tex')).map((entry) => <option key={entry.path}>{entry.path}</option>)}</select></label>
      <form onSubmit={(event) => { event.preventDefault(); stage(() => { const next = mergeEntries(entries, [{ path: newPath.trim(), kind: newKind, content: '' }], false); setNewPath(''); return next }) }}><label>Create<select value={newKind} onChange={(event) => setNewKind(event.target.value as 'folder' | 'text')} disabled={busy}><option value="folder">Folder</option><option value="text">Source file</option></select></label><label>Relative path<input value={newPath} onChange={(event) => setNewPath(event.target.value)} placeholder="sections or sections/methods.tex" required disabled={busy} /></label><button className="button secondary" disabled={busy}>Stage new {newKind === 'text' ? 'file' : 'folder'}</button></form>
      <label className="manager-upload">Upload sources or figures<input type="file" multiple accept=".tex,.bib,.sty,.cls,.txt,.bst,.clo,.cfg,.def,.png,.jpg,.jpeg" disabled={busy} onChange={(event) => { void upload(event.target.files, false); event.target.value = '' }} /></label>
      <label className="manager-upload">Import LaTeX ZIP<input type="file" accept=".zip" disabled={busy} onChange={(event) => { void upload(event.target.files, true); event.target.value = '' }} /></label>
    </section></div>
    {move && <section className="import-review"><h3>Review rename / move</h3><p>{selected} ? {destination}</p><p>Main file: {move.main}. {move.changes.length} supported path updates.</p><ul>{move.changes.map((change,i) => <li key={i}>{change.path}: <code>{change.before}</code> ? <code>{change.after}</code></li>)}</ul>{move.warnings.map(warning => <p key={warning} className="notice">{warning}</p>)}<p>Only literal paths are updated. Review custom commands and compile afterward.</p><label className="export-checkbox"><input type="checkbox" checked={rewrite} onChange={e => setRewrite(e.target.checked)} />Update supported LaTeX paths</label><button className="button secondary" disabled={busy} onClick={() => { stage(() => rewrite ? move.entries : move.moved); setMain(move.main); setMove(null); setSelected('') }}>Stage reviewed move</button><button className="button secondary" onClick={() => setMove(null)}>Cancel move</button></section>}
    <section className="import-review"><h3>Start from a template</h3><p>Original starter documents. Review conflicts before replacing any existing files.</p><label>Starter<select value={template} disabled={busy} onChange={e => setTemplate(e.target.value as keyof typeof starterNames)}>{Object.entries(starterNames).map(([key,name]) => <option key={key} value={key}>{name}</option>)}</select></label><button className="button secondary" disabled={busy || !!incoming || !!move} onClick={() => { setChoices({}); setIncoming({ entries: starterTemplate(template), skipped: [] }) }}>Preview starter files</button></section>
    {incoming && <section className="import-review"><h3>Import preview</h3><p>{incoming.entries.length} supported entries; {incoming.skipped.length} skipped. Renaming imported paths may require repairing their LaTeX references.</p>{compatibilityWarnings(incoming.entries).map(warning => <p key={warning} className="notice">{warning}</p>)}<p>Detected main files: {mainCandidates(incoming.entries).join(', ') || 'None. Choose the main .tex file after staging.'}</p><ul>{incoming.entries.map(entry => { const collision = entries.some(current => current.path.toLowerCase() === entry.path.toLowerCase() && !(current.kind === 'folder' && entry.kind === 'folder')); const choice = Object.hasOwn(choices,entry.path) ? choices[entry.path] : undefined; return <li key={entry.path}><strong>{entry.path}</strong>{collision && <><label>Existing path ? choose an action<select value={choice?.action ?? ''} onChange={e => setChoices(prev => ({ ...prev, [entry.path]: { action: e.target.value as ConflictChoice['action'], path: choice?.path } }))}><option value="">Choose?</option><option value="keep">Keep existing</option><option value="replace">Replace existing</option><option value="rename">Import at a different path</option></select></label>{choice?.action === 'rename' && <label>New path<input value={choice.path ?? ''} onChange={e => setChoices(prev => ({ ...prev, [entry.path]: { action: 'rename', path: e.target.value } }))} /></label>}</>}</li> })}</ul>{incoming.skipped.length > 0 && <details><summary>Skipped files ? check compatibility</summary><p>{incoming.skipped.join(', ')}</p></details>}<button className="button secondary" disabled={busy || !incoming.entries.length || !!move} onClick={() => stage(() => { const next = reviewImport(entries, incoming.entries, choices); setIncoming(null); return next })}>Stage reviewed import</button><button className="button secondary" disabled={busy} onClick={() => setIncoming(null)}>Discard import</button></section>}
    <p role="status" className="export-status">{message || (changed ? 'Changes staged. Your project is unchanged until you apply them.' : 'No changes staged.')}</p>
    <div className="dialog-actions"><button className="button secondary" disabled={busy} onClick={close}>Cancel</button><button className="button primary" disabled={busy || !changed || !!incoming || !!move} onClick={() => void save()}>{busy ? 'Working...' : 'Apply changes'}</button></div>
  </dialog>
}
