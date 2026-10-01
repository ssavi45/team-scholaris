import { useEffect, useRef, useState } from 'react'
import { applyPaperTree, loadPaperState, type PaperFile } from './paper-api'
import { chooseMainFile, mergeEntries, validateTree } from './file-tree'

export default function CreatePaperEntryDialog({ kind, projectId, files, settings, close, onBusy, created }: {
  kind: 'text' | 'folder'; projectId: string; files: PaperFile[]
  settings: { revision: number; main_file: string }; close: () => void
  onBusy: (busy: boolean) => void
  created: (state: Awaited<ReturnType<typeof loadPaperState>>, path: string) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null), working = useRef(false)
  const [name, setName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const source = kind === 'text'
  useEffect(() => { const node = dialog.current!; node.showModal(); return () => node.close() }, [])
  async function submit() {
    if (working.current) return
    working.current = true; setBusy(true); onBusy(true); setError('')
    try {
      const path = savedPath ?? name.trim()
      if (!savedPath) {
        if (!path) throw new Error(source ? 'Enter a filename and extension, such as main.tex.' : 'Enter a folder name.')
        if (files.some(file => file.path.toLowerCase() === path.toLowerCase() || file.path.toLowerCase().startsWith(path.toLowerCase() + '/'))) throw new Error('That name already exists. Choose another.')
        const entries = mergeEntries(files, [{ path, kind, content: '' }], false)
        const main = chooseMainFile(entries, settings.main_file)
        validateTree(entries, main)
        await applyPaperTree(projectId, settings.revision, entries, main)
        setSavedPath(path)
      }
      created(await loadPaperState(projectId), path)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create this item.') }
    finally { working.current = false; setBusy(false); onBusy(false) }
  }
  return <dialog ref={dialog} className="project-dialog" aria-labelledby="create-paper-entry-title" onCancel={event => { event.preventDefault(); if (!working.current) close() }}>
    <h2 id="create-paper-entry-title">{source ? 'New source file' : 'New folder'}</h2>
    <form onSubmit={event => { event.preventDefault(); void submit() }}>
      <label>{source ? 'File name with extension' : 'Folder name'}<input autoFocus required maxLength={240} value={name} disabled={busy || !!savedPath} onChange={event => setName(event.target.value)} placeholder={source ? 'main.tex' : 'sections'} autoComplete="off" spellCheck={false} /></label>
      <p className="muted">{source ? 'Include the extension: .tex, .bib, .sty, .cls, .bst, .clo, .cfg, .def or .txt. You can use a path such as sections/methods.tex.' : 'Use a name such as figures, or a nested path such as sections/appendices.'}</p>
      {savedPath && <p role="status">Created successfully. Refreshing the file list will not create it again.</p>}
      {error && <p role="alert" className="notice error-notice">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={close}>{savedPath ? 'Close' : 'Cancel'}</button><button className="button primary" disabled={busy || !name.trim()}>{busy ? 'Working...' : savedPath ? 'Refresh files' : source ? 'Create file' : 'Create folder'}</button></div>
    </form>
  </dialog>
}
