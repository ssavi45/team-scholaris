import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useBlocker, useParams } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { loadProject } from '../projects/projects-api'
import { createPaperFile, hydrateFigures, initializePaper, loadPaperSettings, loadPaperState, savePaperFile, type PaperFile } from './paper-api'
import { SourceEditor } from './SourceEditor'
import { compilePaper, CompileError, sourceSignature, type Compilation } from './compiler'
import type { ExportSnapshot } from './ExportDialog'

const PdfPreview = lazy(async () => ({ default: (await import('./PdfPreview')).PdfPreview }))
const ExportDialog = lazy(() => import('./ExportDialog'))
const FileManager = lazy(() => import('./FileManager'))
const FigurePreview = lazy(() => import('./FigurePreview'))

export function PaperPage() {
  const { projectId = '' } = useParams()
  const { user } = useAuth()
  return <PaperWorkspace key={`${projectId}:${user?.id}`} projectId={projectId} />
}

function FileTree({ files, selected, choose, prefix = '' }: {
  files: PaperFile[]; selected?: string; choose: (file: PaperFile) => void; prefix?: string
}) {
  const folders = [...new Set(files.filter((file) => file.kind === 'folder' || file.path.slice(prefix.length).includes('/')).map((file) => file.path.slice(prefix.length).split('/')[0]))].sort()
  return <ul className="source-tree">
    {folders.map((folder) => <li key={folder}><details open><summary>{folder}</summary><FileTree files={files.filter((file) => file.path.startsWith(`${prefix}${folder}/`))} selected={selected} choose={choose} prefix={`${prefix}${folder}/`} /></details></li>)}
    {files.filter((file) => file.kind !== 'folder' && !file.path.slice(prefix.length).includes('/')).map((file) => <li key={file.id}><button type="button" aria-current={selected === file.id ? 'true' : undefined} onClick={() => choose(file)}>{file.path.slice(prefix.length)}</button></li>)}
  </ul>
}

function PaperWorkspace({ projectId }: { projectId: string }) {
  const { user } = useAuth()
  const [project, setProject] = useState<Awaited<ReturnType<typeof loadProject>>>(null)
  const [files, setFiles] = useState<PaperFile[]>([])
  const [selected, setSelected] = useState<PaperFile | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [path, setPath] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [sidebar, setSidebar] = useState(true)
  const [viewMode, setViewMode] = useState<'split' | 'source' | 'pdf'>('split')
  const [split, setSplit] = useState(50)
  const panels = useRef<HTMLDivElement>(null)
  const [compiling, setCompiling] = useState(false)
  const [compileStatus, setCompileStatus] = useState('Ready to compile')
  const [compileError, setCompileError] = useState('')
  const [compileLog, setCompileLog] = useState('')
  const [logOpen, setLogOpen] = useState(false)
  const [output, setOutput] = useState<(Compilation & { id: number }) | null>(null)
  const job = useRef<AbortController | null>(null)
  const [exportSnapshot, setExportSnapshot] = useState<ExportSnapshot | null>(null)
  const [settings, setSettings] = useState<{ main_file: string; revision: number } | null>(null)
  const [manager, setManager] = useState(false)
  const mainFile = settings?.main_file ?? 'main.tex'
  const dirty = selected !== null && draft !== selected.content
  const access = project?.members.find((member) => member.user_id === user?.id)?.access_level
  const editable = project?.project.status === 'active' && (access === 'owner' || access === 'member')
  const blocker = useBlocker(dirty || busy)
  const savedSignature = useMemo(() => sourceSignature(files, mainFile), [files, mainFile])
  const stale = !!output && (dirty || output.signature !== savedSignature)
  const warningCount = (compileLog.match(/(?:LaTeX|Package [\w-]+) Warning:/g) ?? []).length

  useEffect(() => () => { job.current?.abort(); job.current = null }, [])

  async function recompile() {
    if (job.current || inFlight.current || !project || !files.length) return
    const controller = new AbortController()
    let preparing = true
    job.current = controller; setCompiling(true); setCompileError(''); setCompileStatus(dirty ? 'Saving changes...' : 'Reading source...')
    inFlight.current = true; setBusy(true)
    try {
      if (dirty && selected) {
        if (!editable) throw new Error('Reload project access before compiling unsaved edits.')
        const saved = await savePaperFile(selected, draft)
        if (controller.signal.aborted) return
        setSelected(saved); setFiles((items) => items.map((file) => file.id === saved.id ? saved : file))
      }
      const data = await loadProject(projectId, controller.signal)
      if (!data) throw new Error('Project unavailable. Your previous preview has been cleared.')
      const loaded = await loadPaperState(projectId, controller.signal)
      const snapshot = loaded.files
      if (controller.signal.aborted) return
      setProject(data); setFiles(snapshot); setSettings(loaded.settings)
      const current = snapshot.find((file) => file.id === selected?.id) ?? snapshot[0] ?? null
      setSelected(current); setDraft(current?.content ?? '')
      inFlight.current = false; setBusy(false); preparing = false
      setCompileStatus('Loading paper figures...')
      const sources = await hydrateFigures(snapshot, controller.signal)
      const result = await compilePaper(sources, controller.signal, setCompileStatus, undefined, undefined, loaded.settings?.main_file ?? 'main.tex')
      if (controller.signal.aborted) return
      setOutput({ ...result, id: Date.now() }); setCompileLog(result.log); setCompileStatus('PDF compiled successfully'); setLogOpen(false)
    } catch (cause) {
      if (!controller.signal.aborted) {
        const detail = message(cause)
        if (detail.startsWith('Project unavailable')) setOutput(null)
        setCompileError(detail); setCompileLog(cause instanceof CompileError ? cause.log : ''); setCompileStatus('Compilation failed'); setLogOpen(true)
      }
    } finally {
      if (job.current === controller) {
        job.current = null; setCompiling(false)
        if (preparing) { inFlight.current = false; setBusy(false) }
      }
    }
  }
  function cancelCompile() { job.current?.abort(); setCompileStatus('Compilation cancelled') }
  function openExport() {
    if (inFlight.current || !project || !files.length) return
    setExportSnapshot({
      title: project.project.name,
      files: files.map(({ path, content, kind, storage_path }) => ({ path, content, kind, storage_path })),
      draft: dirty && selected ? { path: selected.path, content: draft } : null,
      pdf: output?.pdf ?? null,
      olderPdf: stale || !!compileError || compiling,
      warnings: /Warning:/.test(output?.log ?? ''),
    })
  }

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const data = await loadProject(projectId, controller.signal)
        const loaded = data ? await loadPaperState(projectId, controller.signal) : { files: [], settings: null }
        const sources = loaded.files
        if (controller.signal.aborted) return
        setProject(data); setFiles(sources); setSettings(loaded.settings)
        const first = sources.find((file) => file.path === loaded.settings?.main_file) ?? sources.find((file) => file.kind === 'text') ?? null
        setSelected(first); setDraft(first?.content ?? ''); setLoading(false)
      } catch (cause) {
        if (!controller.signal.aborted) { setError(message(cause)); setLoading(false) }
      }
    })()
    return () => controller.abort()
  }, [projectId, attempt])
  useEffect(() => {
    if (!dirty && !busy) return
    const signOut = (event: Event) => {
      if (busy || !window.confirm('Sign out and discard your unsaved paper edits?')) event.preventDefault()
    }
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('scholaris:before-sign-out', signOut)
    window.addEventListener('beforeunload', warn)
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener('scholaris:before-sign-out', signOut) }
  }, [dirty, busy])

  function choose(file: PaperFile) {
    if (inFlight.current || selected?.id === file.id) return
    if (dirty && !window.confirm('Discard unsaved changes to this file?')) return
    setSelected(file); setDraft(file.content); setError(''); setStatus('')
  }
  async function perform(action: () => Promise<void>) {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(''); setStatus('')
    try { await action() } catch (cause) { setError(message(cause)) }
    finally { inFlight.current = false; setBusy(false) }
  }
  function save() {
    if (!selected || !dirty || !editable) return
    void perform(async () => {
      const saved = await savePaperFile(selected, draft)
      setFiles((items) => items.map((file) => file.id === saved.id ? saved : file))
      setSelected(saved); setStatus('Saved to your project.')
    })
  }
  function reload() {
    if (dirty && !window.confirm('Reload from the database and discard unsaved edits? Copy any edits you want to keep first.')) return
    void perform(async () => {
      const data = await loadProject(projectId, new AbortController().signal)
      if (!data) throw new Error('Project unavailable. Your current edits have been kept.')
      const loaded = await loadPaperState(projectId)
      const sources = loaded.files
      const current = sources.find((file) => file.id === selected?.id) ?? sources[0] ?? null
      setProject(data); setFiles(sources); setSettings(loaded.settings); setSelected(current); setDraft(current?.content ?? ''); setStatus('Latest source loaded.')
    })
  }
  return <div className="paper-workbench">
    <header className="paper-project-bar">
      <Link className="project-back" to={`/project/${projectId}`} aria-label="Back to project">&larr;</Link>
      <div className="paper-project-name"><p className="eyebrow">PROJECT / PAPER</p><h1>{project?.project.name ?? 'Paper workspace'}</h1></div>
      <span className="paper-access"><span className="access-dot" />{editable ? 'Can edit' : 'Read-only'}</span>
      <Link className="project-overview-link" to={`/project/${projectId}`}>Project overview &#8599;</Link>
    </header>
    {error && <div role="alert" className="notice error-notice paper-notice">{error}</div>}
    {loading ? <div className="paper-welcome" role="status"><span className="loading-spinner" /><p>Opening your workspace...</p></div> : !project ? <div className="paper-welcome"><h2>Paper unavailable</h2><p>The project does not exist or you do not have access.</p><button className="button secondary compact-button" onClick={() => { setLoading(true); setError(''); setAttempt((value) => value + 1) }}>Try again</button></div> : <>
      {!editable && <p className="paper-readonly">{project.project.status === 'archived' ? 'Archived project' : 'Viewer access'} &middot; You can read the source and compile a preview. Editing is disabled.</p>}
      {!files.length ? <section className="paper-welcome"><div className="paper-document-icon">T<span>E</span>X</div><p className="eyebrow">A SPACE FOR YOUR NEXT IDEA</p><h2>Every paper starts with a blank page.</h2><p>Create your LaTeX source, bring your research together,<br />and see it take shape alongside a PDF preview.</p>{editable ? <button className="button primary compact-button" disabled={busy} onClick={() => void perform(async () => {
        const sources = await initializePaper(projectId); setFiles(sources)
        setSettings(await loadPaperSettings(projectId))
        const first = sources.find((file) => file.path === 'main.tex') ?? sources[0]
        setSelected(first); setDraft(first.content)
      })}>{busy ? 'Creating...' : 'Create your paper'}</button> : <p>An owner or member can initialize this paper.</p>}</section> : <>
        <div className="workbench-toolbar">
          <button className="tool-button files-toggle" aria-expanded={sidebar} aria-controls="paper-file-sidebar" onClick={() => setSidebar(!sidebar)}><Icon name="files" />Files</button>
          <span className="toolbar-divider" />
          <div className="view-switch" aria-label="Workspace view">{(['source', 'split', 'pdf'] as const).map((mode) => <button className={mode === 'split' ? 'split-option' : ''} key={mode} aria-pressed={viewMode === mode} onClick={() => setViewMode(mode)}>{mode === 'pdf' ? 'PDF' : mode === 'split' ? 'Split view' : 'Source'}</button>)}</div>
          <div className="compile-actions"><button className="tool-button export-trigger" disabled={busy} onClick={openExport} aria-label="Export paper"><span aria-hidden="true">&#8595;</span><span className="export-trigger-label">Export</span></button><span className="engine-label">pdfLaTeX</span>{compiling ? <button className="compile-button compiling" onClick={cancelCompile}><span className="loading-spinner" />Cancel compilation</button> : <button className="compile-button" disabled={busy} onClick={() => void recompile()}><Icon name="play" />{dirty && editable ? 'Save & compile' : 'Recompile'}</button>}</div>
        </div>
        <div className={`paper-layout${sidebar ? ' files-open' : ''}`}>
          <aside id="paper-file-sidebar" className="paper-files" aria-label="Paper source files" hidden={!sidebar}>
            <div className="sidebar-heading"><h2>EXPLORER</h2><span>{files.length} files</span></div>
            {editable && <button className="tool-button manage-files-button" disabled={busy || dirty || compiling} title={dirty ? 'Save or discard source edits before managing files.' : 'Import, upload, rename, move, or delete files'} onClick={() => void perform(async () => { const loaded = await loadPaperState(projectId); setFiles(loaded.files); setSettings(loaded.settings); setManager(true) })}>Manage files / Import</button>}
            <FileTree files={files} selected={selected?.id} choose={(file) => { choose(file); if (window.matchMedia('(max-width: 900px)').matches && !dirty && !busy) setSidebar(false) }} />
            {editable && <details className="add-source"><summary>+ Add source file</summary><form onSubmit={(event) => {
              event.preventDefault()
              void perform(async () => { const file = await createPaperFile(projectId, path.trim()); setFiles((items) => [...items, file].sort((a, b) => a.path.localeCompare(b.path))); setPath(''); setStatus(`Created ${file.path}.`) })
            }}><label>File path<input value={path} onChange={(event) => setPath(event.target.value)} placeholder="sections/methods.tex" required maxLength={240} disabled={busy} /></label><button className="button secondary" disabled={busy}>Create file</button><p className="muted">Use / for folders. .tex, .bib, .sty, .cls and .txt supported.</p></form></details>}
            <div className="sidebar-footer"><span className="file-language">TEX</span><div><strong>{mainFile}</strong><p>Compilation entry point</p></div></div>
          </aside>
          <div className="paper-panels" ref={panels} data-view={viewMode} style={{ '--editor-share': `${split}%` } as CSSProperties}>
            <section className="paper-source" aria-label="Source editor">
              <div className="paper-toolbar"><span className="file-language">{selected?.path.endsWith('.bib') ? 'BIB' : 'TEX'}</span><strong>{selected?.path}</strong><span className={`save-indicator${dirty ? ' unsaved' : ''}`} title={status} role="status">{busy ? 'Saving...' : dirty ? 'Unsaved' : 'Saved'}</span><button className="tool-button" disabled={busy} onClick={reload} title="Reload source from the database" aria-label="Reload source"><Icon name="reload" /></button>{editable && <button className="tool-button save-button" disabled={busy || !dirty} onClick={save}>Save</button>}</div>
              {selected?.kind === 'image' ? <Suspense fallback={<p>Loading figure...</p>}><FigurePreview key={selected.storage_path} file={selected} /></Suspense> : selected && <SourceEditor key={selected.id} value={draft} onChange={setDraft} readOnly={!editable || busy} onSave={save} />}
              <div className="editor-footer"><span>{draft.split('\n').length} lines <span className="footer-dot">&middot;</span> UTF-8</span><span>Ctrl/Cmd + S to save</span></div>
            </section>
            <div className="panel-resizer" role="separator" tabIndex={0} aria-label="Resize source and preview" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={75} aria-valuenow={split}
              onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setSplit((value) => Math.max(25, Math.min(75, value + (event.key === 'ArrowLeft' ? -2 : 2)))) } }}
              onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() }}
              onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId) && panels.current) { const rect = panels.current.getBoundingClientRect(); setSplit(Math.round(Math.max(25, Math.min(75, (event.clientX - rect.left) / rect.width * 100)))) } }}
              onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}><span /></div>
            <section className="paper-preview" aria-label="PDF preview">
              <div className="preview-heading"><Icon name="document" /><h2>PDF preview</h2>{output && <span className={stale ? 'preview-badge outdated' : 'preview-badge'}>{stale ? 'Source changed' : 'Compiled'}</span>}<button className="tool-button log-toggle" aria-expanded={logOpen} aria-controls="compile-log" onClick={() => setLogOpen(!logOpen)}><Icon name="log" />Log{warningCount > 0 && <span className="warning-count">{warningCount}</span>}</button></div>
              {(stale || compileError) && output && <div className="preview-stale">{compileError ? 'Showing the last successful PDF.' : 'Your source has changed. Recompile to update this preview.'}</div>}
              {compileError && <p role="alert" className="compile-error">{compileError}</p>}
              {logOpen && <div id="compile-log" className="compile-log" role="region" aria-label="Compilation log"><pre>{compileLog || 'No log yet. Compile your paper to see engine output here.'}</pre></div>}
              {output ? <Suspense fallback={<p className="preview-loading" role="status">Loading PDF viewer...</p>}><PdfPreview key={output.id} data={output.pdf} /></Suspense> : <div className="preview-empty"><div className="preview-sheet"><Icon name="document" /><span /><span /><span /><span /></div><h3>{compiling ? 'Bringing your paper to life' : 'Your paper, beautifully typeset.'}</h3><p>{compiling ? 'The first compile downloads the packages your paper needs.' : 'Compile your LaTeX source to see the finished paper here.'}</p>{!compiling && <button className="preview-start" disabled={busy} onClick={() => void recompile()}>Compile your paper <span>&rarr;</span></button>}</div>}
            </section>
          </div>
        </div>
        <footer className="workbench-status"><span className={compileError ? 'status-error' : ''} role="status">{compiling ? <span className="loading-spinner" /> : <span className="status-dot" />}{compileStatus}</span><span>Compiles in your browser <span className="footer-dot">&middot;</span> <a href={`${import.meta.env.BASE_URL}vendor/swiftlatex/NOTICE.txt`} target="_blank" rel="noreferrer">Compiler credits</a></span></footer>
      </>}
    </>}
    {blocker.state === 'blocked' && <LeaveDialog busy={busy} stay={() => blocker.reset()} leave={() => blocker.proceed()} />}
    {exportSnapshot && <Suspense fallback={<p role="status" className="export-loading">Opening export...</p>}><ExportDialog snapshot={exportSnapshot} close={() => setExportSnapshot(null)} /></Suspense>}
    {manager && settings && <Suspense fallback={<p role="status" className="export-loading">Opening file manager...</p>}><FileManager projectId={projectId} files={files} settings={settings} close={() => setManager(false)} onBusy={(value) => { inFlight.current = value; setBusy(value) }} applied={() => { setManager(false); setLoading(true); setAttempt((value) => value + 1) }} /></Suspense>}
  </div>
}

function Icon({ name }: { name: 'files' | 'play' | 'reload' | 'document' | 'log' }) {
  const paths = { files: 'M3 4h14v12H3z M7 4v12 M10 8h4 M10 11h4', play: 'm7 4 9 6-9 6z', reload: 'M16 8a6 6 0 1 0 0 5 M16 3v5h-5', document: 'M5 2h7l4 4v12H5z M12 2v5h4 M8 11h5 M8 14h5', log: 'M4 5h12 M4 10h12 M4 15h8' }
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}

function LeaveDialog({ busy, stay, leave }: { busy: boolean; stay: () => void; leave: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close() }, [])
  return <dialog ref={ref} className="project-dialog" aria-labelledby="leave-title" onCancel={(event) => { event.preventDefault(); stay() }}><h2 id="leave-title">{busy ? 'Please wait for the operation to finish' : 'Leave without saving?'}</h2><p className="muted">Stay to keep editing and save your changes.</p><div className="dialog-actions"><button className="button secondary" onClick={stay} autoFocus>Stay</button><button className="button primary" disabled={busy} onClick={leave}>Discard and leave</button></div></dialog>
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'Unable to complete the paper operation. Please try again.' }
