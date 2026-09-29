import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link, useBlocker, useParams } from 'react-router'
import { useAuth } from '../auth/auth-context'
import { loadProject } from '../projects/projects-api'
import { hydrateFigures, initializePaper, loadPaperSettings, loadPaperState, type PaperFile } from './paper-api'
import { SourceEditor, type EditorMemory } from './SourceEditor'
import { EditorMenu } from './EditorMenu'
import { CompilerMenu } from './CompilerMenu'
import { usePaperDrafts } from './usePaperDrafts'
import { readRecovery, deleteRecovery, clearProjectRecovery, type RecoveryDraft } from './draft-storage'
import { DraftPanel } from './DraftPanel'
import { PaperExplorer, type ManageRequest } from './PaperExplorer'
import { PaperCollaborators } from './PaperCollaborators'
import { History, ArrowLeft, PanelLeft, Columns2, PanelRight, Maximize2, Minimize2, Info, MoreHorizontal, FileText, X, Check } from 'lucide-react'
import './workspace-layout.css'
import { createCompilerSession, CompileError, sourceSignature, waitForPreparation, type Compilation } from './compiler'
import { parseCompileDiagnostics, type CompileIssue } from './compile-diagnostics'
import { CompileDiagnostics } from './CompileDiagnostics'
import { PaperNavigation, QuickFileSwitch } from './PaperNavigation'
import { approximateWords, type SourceLocation } from './editor-tools'
import { readEditorPreferences, saveEditorPreferences, type EditorPreferences } from './editor-preferences'
import type { ExportSnapshot } from './ExportDialog'

const PdfPreview = lazy(async () => ({ default: (await import('./PdfPreview')).PdfPreview }))
const ExportDialog = lazy(() => import('./ExportDialog'))
const FileManager = lazy(() => import('./FileManager'))
const HistoryPanel = lazy(() => import('./HistoryPanel'))
const ReplaceProjectDialog = lazy(() => import('./ReplaceProjectDialog'))
const FigurePreview = lazy(() => import('./FigurePreview'))

export function PaperPage() {
  const { projectId = '' } = useParams()
  const { user } = useAuth()
  return <PaperWorkspace key={`${projectId}:${user?.id}`} projectId={projectId} />
}

function PaperWorkspace({ projectId }: { projectId: string }) {
  const { user } = useAuth()
  const userId = user?.id ?? ''
  const [compilerSession] = useState(() => createCompilerSession())
  const [figureCache] = useState(() => new Map<string, Uint8Array<ArrayBuffer>>())
  useEffect(() => () => figureCache.clear(), [figureCache])
  useEffect(() => { void compilerSession.warm().catch(() => {}); return () => compilerSession.dispose() }, [compilerSession])
  const [initialPreferences] = useState(() => readEditorPreferences(userId))
  const [textPreferences, setTextPreferences] = useState(initialPreferences)
  const [project, setProject] = useState<Awaited<ReturnType<typeof loadProject>>>(null)
  const { store, documents } = usePaperDrafts(user?.id ?? '', projectId)
  const [serverFiles, setServerFiles] = useState<PaperFile[]>([])
  const files = useMemo(() => serverFiles.map(file => documents[file.id]?.remote ?? documents[file.id]?.base ?? file), [serverFiles, documents])
  const setFiles = useCallback((sources: PaperFile[]) => { store.reconcile(sources); setServerFiles(sources) }, [store])
  const [selectedEntry, setSelected] = useState<PaperFile | null>(null)
  const selected = selectedEntry ? documents[selectedEntry.id]?.remote ?? documents[selectedEntry.id]?.base ?? selectedEntry : null
  const activeDocument = selected ? documents[selected.id] : undefined
  const draft = activeDocument?.text ?? selected?.content ?? ''
  const [editorMemory] = useState<EditorMemory>(() => new Map())
  const [recovery, setRecovery] = useState<RecoveryDraft[]>([])
  const [recoveryError, setRecoveryError] = useState('')
  const [online, setOnline] = useState(navigator.onLine)
  const setDraft = (text: string) => { if (selected) store.edit(selected.id, text) }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [opened, setOpened] = useState<string[]>([])
  const [explorerWidth, setExplorerWidth] = useState(initialPreferences.explorerWidth)
  const [focus, setFocus] = useState<'source' | 'pdf' | null>(() => window.matchMedia('(max-width: 900px)').matches ? null : initialPreferences.focus)
  const [pdfSearchRequest, setPdfSearchRequest] = useState<{ text: string; token: number } | null>(null)
  const [sourceSearchRequest, setSourceSearchRequest] = useState({ text: '', token: 0 })
  const [navigationMode, setNavigationMode] = useState<'files' | 'outline' | 'search'>('files')
  const [quickSwitch, setQuickSwitch] = useState(false)
  const [closedTabs, setClosedTabs] = useState<string[]>([])
  const [revealToken, setRevealToken] = useState(0)
  const [replacementRequest, setReplacementRequest] = useState<{ query: string; replacement: string; matchCase: boolean } | null>(null)
  const [saveDetails, setSaveDetails] = useState(false)
  const [managerRequest, setManagerRequest] = useState<ManageRequest>({})
  const attention = !online || !!recoveryError || recovery.length > 0 || Object.values(documents).some(item => !!item.error || item.remote !== undefined)
  const tabs = [...new Set([...opened, ...(selected ? [selected.id] : [])])].flatMap(id => { const file = files.find(item => item.id === id); return file && file.kind !== 'folder' ? [file] : [] })
  useEffect(() => {
    document.documentElement.classList.toggle('paper-writing-focus', !!focus)
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || (event.target instanceof Element && event.target.closest('dialog'))) return
      const menus = document.querySelectorAll<HTMLDetailsElement>('.paper-studio .paper-popover[open]')
      if (menus.length) { menus.forEach(menu => { menu.open = false }); return }
      setFocus(null)
    }
    const dismiss = (event: PointerEvent) => {
      document.querySelectorAll<HTMLDetailsElement>('.paper-studio .paper-popover[open]').forEach(menu => { if (event.target instanceof Node && !menu.contains(event.target)) menu.open = false })
    }
    window.addEventListener('keydown', escape)
    window.addEventListener('pointerdown', dismiss)
    return () => { document.documentElement.classList.remove('paper-writing-focus'); window.removeEventListener('keydown', escape); window.removeEventListener('pointerdown', dismiss) }
  }, [focus])
  const [attempt, setAttempt] = useState(0)
  const [sidebar, setSidebar] = useState(() => !window.matchMedia('(max-width: 900px)').matches && initialPreferences.sidebar)
  const [viewMode, setViewMode] = useState<'split' | 'source' | 'pdf'>(() => window.matchMedia('(max-width: 900px)').matches && initialPreferences.mode === 'split' ? 'source' : initialPreferences.mode)
  const [split, setSplit] = useState(initialPreferences.split)
  useEffect(() => { saveEditorPreferences(userId, { ...textPreferences, explorerWidth, focus, sidebar, mode: viewMode, split }) }, [userId, textPreferences, explorerWidth, focus, sidebar, viewMode, split])
  const updatePreferences = (patch: Partial<EditorPreferences>) => setTextPreferences(current => ({ ...current, ...patch }))
  const panels = useRef<HTMLDivElement>(null)
  const [compiling, setCompiling] = useState(false)
  const [compileStatus, setCompileStatus] = useState('Ready to compile')
  const [compileError, setCompileError] = useState('')
  const [compileLog, setCompileLog] = useState('')
  const [compileOutcome, setCompileOutcome] = useState<'idle' | 'success' | 'failed' | 'cancelled'>('idle')
  const [compiledSnapshot, setCompiledSnapshot] = useState<{ signature: string; revision: number; main: string; paths: string[] } | null>(null)
  const [compileTiming, setCompileTiming] = useState('')
  const [editorJump, setEditorJump] = useState<{ fileId: string; line: number; token: number; from?: number; to?: number } | null>(null)
  const [logOpen, setLogOpen] = useState(false)
  const [output, setOutput] = useState<(Compilation & { id: number; revision: number; main: string }) | null>(null)
  const job = useRef<AbortController | null>(null)
  const [exportSnapshot, setExportSnapshot] = useState<ExportSnapshot | null>(null)
  const [settings, setSettings] = useState<{ main_file: string; revision: number } | null>(null)
  const [manager, setManager] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const mainFile = settings?.main_file ?? 'main.tex'
  const dirty = Object.values(documents).some(document => document.text !== document.base.content)
  const saving = Object.values(documents).some(document => document.saving)
  const access = project?.members.find((member) => member.user_id === user?.id)?.access_level
  const editable = project?.project.status === 'active' && (access === 'owner' || access === 'member')
  const blocker = useBlocker(dirty || busy || saving || recovery.length > 0)
  const savedSignature = useMemo(() => sourceSignature(files, mainFile), [files, mainFile])
  const stale = !!output && (dirty || output.signature !== savedSignature)
  const issues = useMemo(() => parseCompileDiagnostics(compileLog, compiledSnapshot?.paths ?? []), [compileLog, compiledSnapshot])
  const warningCount = issues.filter(issue => issue.severity === 'warning').length
  const diagnosticErrorCount = issues.filter(issue => issue.severity === 'error').length
  const diagnosticsStale = !!compiledSnapshot && (dirty || compiledSnapshot.signature !== savedSignature)
  const navigationFiles = useMemo(() => files.map(file => ({ ...file, content: documents[file.id]?.text ?? file.content })), [files, documents])
  const wordCount = useMemo(() => approximateWords(draft), [draft])
  const replaceBlocked = !editable || dirty || saving || busy || compiling || attention || !!recoveryError
  function navigateSource(location: SourceLocation, expected: string) {
    const file = navigationFiles.find(item => item.id === location.fileId)
    if (!file || file.content !== expected) { setStatus('The source changed. Select the refreshed result again.'); return }
    choose(file); setFocus(null); setViewMode(window.matchMedia('(max-width: 900px)').matches ? 'source' : 'split')
    if (window.matchMedia('(max-width: 900px)').matches) setSidebar(false)
    setEditorJump(previous => ({ ...location, token: (previous?.token ?? 0) + 1 }))
  }
  function jumpToIssue(issue: CompileIssue) {
    if (diagnosticsStale || !issue.file || !issue.line) return
    const file = files.find(item => item.path === issue.file && item.kind === 'text')
    if (!file) return
    choose(file); setFocus(null); setViewMode(window.matchMedia('(max-width: 900px)').matches ? 'source' : 'split')
    setEditorJump(previous => ({ fileId: file.id, line: issue.line!, token: (previous?.token ?? 0) + 1 }))
  }

  useEffect(() => () => { job.current?.abort(); job.current = null }, [])
  useEffect(() => { store.configure(!!editable, online) }, [store, editable, online])
  // Refresh only while idle; store reconciliation retains every dirty draft.
  useEffect(() => {
    let active = true
    let running = false
    async function checkAccess() {
      if (running || inFlight.current) return
      running = true
      const previous = store.getSnapshot()
      try {
        const data = await loadProject(projectId, new AbortController().signal)
        const loaded = data ? await loadPaperState(projectId) : { files: [], settings: null }
        if (!active) return
        setProject(data); setOnline(navigator.onLine)
        if (previous === store.getSnapshot()) { setFiles(loaded.files); setSettings(loaded.settings) }
        if (!data) { job.current?.abort(); compilerSession.dispose(); figureCache.clear(); store.revoke(); setOutput(null); setRecovery([]); editorMemory.clear(); void clearProjectRecovery(userId, projectId).catch(() => {}) }
      } catch { if (active) setOnline(false) }
      finally { running = false }
    }
    const onFocus = () => { void checkAccess() }
    const onOffline = () => { store.configure(!!editable, false); setOnline(false) }
    window.addEventListener('focus', onFocus); window.addEventListener('online', onFocus); window.addEventListener('offline', onOffline)
    const timer = window.setInterval(onFocus, 30000)
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', onFocus); window.removeEventListener('online', onFocus); window.removeEventListener('offline', onOffline) }
  }, [projectId, store, setFiles, editable, userId, editorMemory, compilerSession, figureCache])

  async function recompile() {
    if (job.current || inFlight.current || !project || !files.length) return
    const controller = new AbortController()
    const started = performance.now()
    let timedOut = false
    const deadline = window.setTimeout(() => { timedOut = true; controller.abort() }, 180000)
    let preparing = true
    job.current = controller; setCompiling(true); setCompileError(''); setCompileLog(''); setCompileTiming(''); setCompileOutcome('idle'); setCompiledSnapshot(null); setCompileStatus(dirty ? 'Saving changes...' : 'Reading source...')
    inFlight.current = true; setBusy(true)
    try {
      if (recovery.length) throw new Error('Review recovery copies before compiling.')
      if (dirty) {
        if (!editable) throw new Error('Resolve or discard unsaved edits before compiling in read-only mode.')
        await waitForPreparation(store.saveAll(), controller.signal)
      }
      const intended = Object.values(store.getSnapshot()).map(document => ({ id: document.base.id, text: document.text }))
      const data = await loadProject(projectId, controller.signal)
      if (!data) { compilerSession.dispose(); figureCache.clear(); throw new Error('Project unavailable. Your previous preview has been cleared.') }
      const loaded = await loadPaperState(projectId, controller.signal)
      const snapshot = loaded.files
      if (controller.signal.aborted) return
      if (intended.some(item => snapshot.find(file => file.id === item.id)?.content !== item.text)) {
        setFiles(snapshot)
        throw new Error('Source changed before compilation. Review the refreshed files and compile again.')
      }
      setProject(data); setFiles(snapshot); setSettings(loaded.settings)
      const current = snapshot.find((file) => file.id === selected?.id && file.kind !== 'folder') ?? snapshot.find((file) => file.path === loaded.settings?.main_file) ?? snapshot.find((file) => file.kind === 'text') ?? null
      setSelected(current)
      inFlight.current = false; setBusy(false); preparing = false
      setCompileStatus('Loading paper figures...')
      const hydrationStarted = performance.now()
      const sources = await hydrateFigures(snapshot, controller.signal, figureCache)
      const prepared = performance.now()
      const main = loaded.settings?.main_file ?? 'main.tex', revision = loaded.settings?.revision ?? 0
      setCompiledSnapshot({ signature: sourceSignature(sources, main), revision, main, paths: sources.map(file => file.path) })
      const result = await compilerSession.compile(sources, controller.signal, text => { if (job.current === controller && !controller.signal.aborted) setCompileStatus(text) }, undefined, main)
      if (controller.signal.aborted || job.current !== controller) return
      const resultIssues = parseCompileDiagnostics(result.log, sources.map(file => file.path))
      setOutput({ ...result, id: Date.now(), revision, main }); setCompileLog(result.log); setCompileStatus(resultIssues.length ? 'PDF produced with diagnostics' : 'PDF compiled successfully'); setCompileOutcome('success'); setLogOpen(resultIssues.some(issue => issue.severity === 'error'))
      setCompileTiming(`Read/save ${(hydrationStarted - started).toFixed(0)} ms; figures ${(prepared - hydrationStarted).toFixed(0)} ms; engine ${(performance.now() - prepared).toFixed(0)} ms; ${result.passes ?? 3} LaTeX passes`)
    } catch (cause) {
      if (!controller.signal.aborted && job.current === controller) {
        const detail = message(cause)
        if (detail.startsWith('Project unavailable')) setOutput(null)
        setCompileError(detail); setCompileLog(cause instanceof CompileError ? cause.log : ''); setCompileStatus('Compilation failed'); setCompileOutcome('failed'); setLogOpen(true)
      }
    } finally {
      window.clearTimeout(deadline)
      if (job.current === controller) {
        if (controller.signal.aborted) {
          setCompileOutcome(timedOut ? 'failed' : 'cancelled'); setCompileStatus(timedOut ? 'Compilation timed out' : 'Compilation cancelled')
          if (timedOut) { setCompileError('Preparation or compilation exceeded three minutes. Check the network and source, then retry.'); setLogOpen(true) }
        }
        job.current = null; setCompiling(false)
        if (preparing) { inFlight.current = false; setBusy(false) }
      }
    }
  }
  function cancelCompile() { job.current?.abort(); setCompileStatus('Compilation cancelled') }
  function openExport() {
    if (inFlight.current || !project || !files.length) return
    if (Object.values(documents).some(document => document.remote === null && document.text !== document.base.content)) { setError('Download drafts of unavailable files separately before exporting.'); return }
    setExportSnapshot({
      title: project.project.name,
      files: files.map(({ path, content, kind, storage_path }) => ({ path, content, kind, storage_path })),
      draft: null,
      drafts: Object.values(documents).filter(document => document.text !== document.base.content).map(document => ({ path: document.remote?.path ?? document.base.path, content: document.text })),
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
        if (data && userId) {
          try {
            const copies = await readRecovery(userId, projectId)
            if (controller.signal.aborted) return
            setRecovery(copies.filter(copy => sources.find(file => file.id === copy.base.id)?.content !== copy.text))
          } catch { setRecoveryError('Local recovery is unavailable. Keep this tab open until saved, or download your drafts.') }
        }
        const first = sources.find((file) => file.path === loaded.settings?.main_file) ?? sources.find((file) => file.kind === 'text') ?? null
        setSelected(first); setLoading(false)
      } catch (cause) {
        if (!controller.signal.aborted) { setError(message(cause)); setLoading(false) }
      }
    })()
    return () => controller.abort()
  }, [projectId, attempt, setFiles, userId])
  useEffect(() => {
    if (!dirty && !busy && !saving && !recovery.length) return
    const signOut = (event: Event) => {
      if (busy || saving || !window.confirm('Sign out and clear all local recovery copies for this account? Download or save unsaved work first.')) event.preventDefault()
    }
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('scholaris:before-sign-out', signOut)
    window.addEventListener('beforeunload', warn)
    return () => { window.removeEventListener('beforeunload', warn); window.removeEventListener('scholaris:before-sign-out', signOut) }
  }, [dirty, busy, saving, recovery.length])

  function openManager(request: ManageRequest = {}) {
    if (!editable || busy || saving || dirty || compiling || recovery.length) return
    void perform(async () => {
      const loaded = await loadPaperState(projectId)
      setFiles(loaded.files); setSettings(loaded.settings); setManagerRequest(request); setManager(true)
    })
  }
  function closeTab(id: string) {
    if (busy) return
    const remaining = tabs.filter(file => file.id !== id)
    setOpened(remaining.map(file => file.id))
    setClosedTabs(current => [...current.filter(item => item !== id), id].slice(-20)); setEditorJump(null)
    if (selected?.id === id) setSelected(remaining.at(-1) ?? null)
  }
  function choose(file: PaperFile) {
    if (inFlight.current) return
    setEditorJump(null)
    if (viewMode === 'pdf') setViewMode(window.matchMedia('(max-width: 900px)').matches ? 'source' : 'split')
    if (selected?.id === file.id) return
    setOpened(tabs.map(item => item.id).concat(file.id)); setSelected(file); setError(''); setStatus('')
  }
  function reopenTab() {
    const id = [...closedTabs].reverse().find(item => files.some(file => file.id === item))
    if (!id || inFlight.current) return
    setClosedTabs(current => current.filter(item => item !== id)); choose(files.find(file => file.id === id)!)
  }
  async function perform(action: () => Promise<void>) {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(''); setStatus('')
    try { await action() } catch (cause) { setError(message(cause)) }
    finally { inFlight.current = false; setBusy(false) }
  }
  function save() {
    if (!selected || !editable) return
    void store.save(selected.id).catch(cause => setError(message(cause)))
  }
  function reload() {
    void perform(async () => {
      const data = await loadProject(projectId, new AbortController().signal)
      if (!data) { setProject(null); setOutput(null); store.revoke(); editorMemory.clear(); await clearProjectRecovery(userId, projectId); throw new Error('Project access is no longer available.') }
      const loaded = await loadPaperState(projectId)
      setProject(data); setFiles(loaded.files); setSettings(loaded.settings); setOnline(navigator.onLine)
      setStatus('Server versions checked. Local drafts have been preserved.')
    })
  }
  async function restoreCopy(record: RecoveryDraft) {
    try {
      await store.recover(record)
      await deleteRecovery(record.key)
      setRecovery(rows => rows.filter(row => row.key !== record.key))
      setSelected(record.base); setStatus('Recovered for review. Save when ready.')
    } catch (cause) { setError(message(cause)) }
  }
  async function discardCopy(record: RecoveryDraft) {
    if (!window.confirm('Permanently discard this recovery copy?')) return
    try { await deleteRecovery(record.key); setRecovery(rows => rows.filter(row => row.key !== record.key)) }
    catch (cause) { setError(message(cause)) }
  }
  const fileActions = <EditorMenu label="File" icon={<FileText size={15} aria-hidden="true" />}>
    <button disabled={busy} onClick={() => setQuickSwitch(true)}>Open a file<span className="editor-shortcut">Ctrl/Cmd P</span></button>
    <button disabled={busy || !closedTabs.some(id => files.some(file => file.id === id))} onClick={reopenTab}>Reopen closed tab</button>
    <button disabled={!selected} onClick={() => { setFocus(null); setSidebar(true); setNavigationMode('files'); setRevealToken(value => value + 1) }}>Show current file in sidebar</button>
  </EditorMenu>
  return <div className={`paper-workbench paper-studio${focus ? ' paper-focused' : ''}`} onClick={event => {
    if (event.target instanceof Element && event.target.closest('button, a')) {
      const menu = event.target.closest<HTMLDetailsElement>('.paper-popover')
      if (menu) menu.open = false
    }
  }}>
    <header className="paper-project-compact">
      <Link className="tool-button paper-back-button" to={`/project/${projectId}`} aria-label="Back to project" title="Back to project"><ArrowLeft size={18} strokeWidth={1.8} aria-hidden="true" /></Link>
      <h1 title={project?.project.name}>{project?.project.name ?? 'Paper workspace'}</h1>
      <span className="paper-permission">{editable ? 'Can edit' : 'Read-only'}</span>
      <button className={`tool-button paper-save-state${attention ? ' needs-attention' : ''}`} aria-controls="paper-save-details" aria-expanded={saveDetails || attention} onClick={() => setSaveDetails(!saveDetails)} title={status || 'Save status and draft protection'}>{attention ? <Info size={14} /> : saving ? <span className="loading-spinner" /> : !dirty ? <Check size={14} /> : null}{!online ? 'Offline' : attention ? 'Review drafts' : saving ? 'Saving...' : dirty ? 'Unsaved changes' : 'Saved'}</button>
      {project && !!files.length && <button className="tool-button" title="Paper history" disabled={busy} onClick={() => setHistoryOpen(true)}><History size={16} /><span className="paper-history-label">History</span></button>}
      {project && <PaperCollaborators projectId={projectId} />}
      <div className="paper-layout-controls" aria-label="Workspace layout">
        <button className="tool-button" title="Toggle explorer" aria-label="Toggle explorer" aria-expanded={sidebar && !focus} onClick={() => { setSidebar(focus ? true : !sidebar); setFocus(null) }}><Icon name="files" /></button>
        {(['source', 'split', 'pdf'] as const).map(mode => { const Glyph = mode === 'source' ? PanelLeft : mode === 'split' ? Columns2 : PanelRight; return <button className={mode === 'split' ? 'tool-button studio-split' : 'tool-button'} key={mode} title={mode === 'source' ? 'Editor only' : mode === 'pdf' ? 'PDF only' : 'Split view'} aria-label={mode === 'source' ? 'Editor only' : mode === 'pdf' ? 'PDF only' : 'Split view'} aria-pressed={(focus ?? viewMode) === mode} onClick={() => { setFocus(null); setViewMode(mode) }}><Glyph size={17} /></button> })}
      </div>
      {focus && <button className="tool-button" onClick={() => setFocus(null)}><Minimize2 size={16} />Exit full screen</button>}
      <details className="paper-popover paper-project-actions"><summary aria-label="Project actions" title="Project actions"><MoreHorizontal size={18} /></summary><div>
        <Link to={`/project/${projectId}`}>Project overview</Link><Link to={`/project/${projectId}/files`}>Shared project files</Link><Link to={`/project/${projectId}/chat`}>Project chat</Link>
        <button onClick={() => setSaveDetails(true)}><Info size={15} />Draft protection</button>
      </div></details>
    </header>
    {recoveryError && <p role="alert" className="notice error-notice">{recoveryError}</p>}
    {error && <div role="alert" className="notice error-notice paper-notice">{error}</div>}
    {loading ? <div className="paper-welcome" role="status"><span className="loading-spinner" /><p>Opening your workspace...</p></div> : !project ? <div className="paper-welcome"><h2>Paper unavailable</h2><p>The project does not exist or you do not have access.</p><button className="button secondary compact-button" onClick={() => { setLoading(true); setError(''); setAttempt((value) => value + 1) }}>Try again</button></div> : <>
      {!editable && <p className="paper-readonly">{project.project.status === 'archived' ? 'Archived project' : 'Viewer access'} &middot; You can read the source and compile a preview. Editing is disabled.</p>}
      <div id="paper-save-details" className="paper-save-drawer" hidden={!saveDetails && !attention}><DraftPanel store={store} documents={documents} recovery={recovery} online={online} editable={!!editable} busy={busy || saving} restore={record => void restoreCopy(record)} discardRecovery={record => void discardCopy(record)} refresh={reload} /><button className="tool-button" disabled={attention} onClick={() => setSaveDetails(false)}>Close details</button></div>
      {!files.length ? <section className="paper-welcome"><div className="paper-document-icon">T<span>E</span>X</div><p className="eyebrow">A SPACE FOR YOUR NEXT IDEA</p><h2>Every paper starts with a blank page.</h2><p>Create your LaTeX source, bring your research together,<br />and see it take shape alongside a PDF preview.</p>{editable ? <button className="button primary compact-button" disabled={busy} onClick={() => void perform(async () => {
        const sources = await initializePaper(projectId); setFiles(sources)
        setSettings(await loadPaperSettings(projectId))
        const first = sources.find((file) => file.path === 'main.tex') ?? sources[0]
        setSelected(first)
      })}>{busy ? 'Creating...' : 'Create your paper'}</button> : <p>An owner or member can initialize this paper.</p>}</section> : <>
        <div className={`paper-layout${sidebar && !focus ? ' files-open' : ''}`} style={{ '--explorer-width': `${explorerWidth}px` } as CSSProperties}>
          <aside id="paper-file-sidebar" className="paper-files" aria-label="Paper source files" hidden={!sidebar || !!focus}>
            <PaperNavigation key={sourceSearchRequest.token} initialQuery={sourceSearchRequest.text} files={navigationFiles} mainFile={mainFile} mode={navigationMode} setMode={setNavigationMode} navigate={navigateSource} canReplace={!replaceBlocked} replace={(query, replacement, matchCase) => setReplacementRequest({ query, replacement, matchCase })}>
              <PaperExplorer files={files} selected={selected?.id} mainFile={mainFile} editable={!!editable} disabled={busy || saving || dirty || compiling || recovery.length > 0} choose={file => { choose(file); if (window.matchMedia('(max-width: 900px)').matches) setSidebar(false) }} manage={openManager} close={() => setSidebar(false)} revealToken={revealToken} />
            </PaperNavigation>
          </aside>
          {sidebar && !focus && <div className="explorer-resizer" role="separator" tabIndex={0} aria-label="Resize explorer" aria-orientation="vertical" aria-valuemin={170} aria-valuemax={380} aria-valuenow={explorerWidth}
            onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setExplorerWidth(value => Math.min(380, Math.max(170, value + (event.key === 'ArrowLeft' ? -10 : 10)))) } }}
            onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() }}
            onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setExplorerWidth(Math.max(170, Math.min(380, event.clientX - event.currentTarget.parentElement!.getBoundingClientRect().left))) }}
            onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }} />}
          <div className="paper-panels" ref={panels} data-view={focus ?? viewMode} style={{ '--editor-share': `${split}%` } as CSSProperties}>
            <section className="paper-source" aria-label="Source editor">
              <div className="paper-document-tabs" aria-label="Open documents">
                {tabs.map(file => <div className={`paper-document-tab${selected?.id === file.id ? ' active' : ''}`} key={file.id}>
                  <button title={file.path} aria-pressed={selected?.id === file.id} onClick={() => choose(file)}><FileText size={14} />{file.path.split('/').pop()}{documents[file.id]?.remote !== undefined && <span title="Conflict — review drafts" aria-label="Conflict">!</span>}{documents[file.id]?.text !== undefined && documents[file.id].text !== documents[file.id].base.content && <span title="Unsaved draft" aria-label="Unsaved draft">&#9679;</span>}</button>
                  <button disabled={busy} aria-label={`Close ${file.path} tab (draft retained)`} onClick={() => closeTab(file.id)}><X size={13} /></button>
                </div>)}
                <button className="tool-button" title="Distraction-free editor" aria-label="Distraction-free editor" onClick={() => setFocus(focus === 'source' ? null : 'source')}><Maximize2 size={16} /></button>
              </div>
              {(!selected || selected.kind !== 'text') && <div className="paper-edit-tools editor-toolbar">{fileActions}</div>}
              {(focus ?? viewMode) === 'source' && <div className="paper-source-actions"><button className="tool-button" disabled={busy || compiling} onClick={() => { setFocus(null); setViewMode(window.matchMedia('(max-width: 900px)').matches ? 'pdf' : 'split'); void recompile() }}><Icon name="play" />Compile and show PDF</button></div>}
              {!selected && <div className="paper-editor-empty">Select a file from Explorer to continue writing. Closed tabs retain unsaved drafts.</div>}
              {selected?.kind === 'image' ? <Suspense fallback={<p>Loading figure...</p>}><FigurePreview key={selected.storage_path} file={selected} /></Suspense> : selected && <SourceEditor fileActions={fileActions} key={selected.id} fileId={selected.id} memory={editorMemory} value={draft} onChange={setDraft} readOnly={!editable || busy || activeDocument?.remote === null} onSave={save} jump={editorJump} preferences={textPreferences} setPreferences={updatePreferences} quickSwitch={() => setQuickSwitch(true)} reopen={reopenTab} compile={() => void recompile()} canFindPdf={!!output && !stale} findPdf={text => { if (!text || !output || stale) return; setPdfSearchRequest(previous => ({ text, token: (previous?.token ?? 0) + 1 })); setFocus(null); setViewMode(window.matchMedia('(max-width: 900px)').matches ? 'pdf' : 'split') }} />}
              <div className="editor-footer"><span>{draft.split('\n').length} lines · UTF-8</span>{selected?.kind === 'text' && <span title="Approximate count for this file; excludes common math, commands and comments. Not a publisher word count.">~{wordCount} words (this file)</span>}<span>Ctrl/Cmd + S to save</span></div>
            </section>
            <div className="panel-resizer" role="separator" tabIndex={0} aria-label="Resize source and preview" aria-orientation="vertical" aria-valuemin={25} aria-valuemax={75} aria-valuenow={split}
              onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setSplit((value) => Math.max(25, Math.min(75, value + (event.key === 'ArrowLeft' ? -2 : 2)))) } }}
              onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() }}
              onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId) && panels.current) { const rect = panels.current.getBoundingClientRect(); setSplit(Math.round(Math.max(25, Math.min(75, (event.clientX - rect.left) / rect.width * 100)))) } }}
              onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}><span /></div>
            <section className="paper-preview" aria-label="PDF preview">
              <div className="preview-heading"><Icon name="document" /><h2>PDF preview</h2>
                <span className={`preview-badge${stale || compileError || diagnosticErrorCount ? ' outdated' : ''}`} role="status">{compiling ? 'Compiling...' : compileOutcome === 'cancelled' ? 'Cancelled' : compileOutcome === 'failed' ? 'Failed' : !output ? 'Not compiled' : stale ? 'Outdated' : diagnosticErrorCount ? `${diagnosticErrorCount} errors · PDF produced` : warningCount ? `${warningCount} warnings` : 'Compiled'}</span>
                <button className="tool-button paper-export-button" title="Export PDF or source" disabled={busy} onClick={openExport}>Export</button>
                <button className="tool-button" title="Compilation diagnostics" aria-label="Compilation diagnostics" aria-expanded={logOpen} aria-controls="compile-log" onClick={() => setLogOpen(!logOpen)}><Icon name="log" />{issues.length ? 'Issues' : 'Log'}</button>
                <div className="paper-compile-group">{compiling ? <button className="compile-button" onClick={cancelCompile}>Cancel</button> : <button className="compile-button" disabled={busy} onClick={() => void recompile()}><Icon name="play" />Recompile</button>}
                  <CompilerMenu mainFile={mainFile} changeDisabledReason={!editable ? 'Only project editors can change the main file.' : busy || compiling ? 'Wait for the current operation to finish.' : recovery.length > 0 ? 'Resolve recovered drafts first.' : dirty || saving ? 'Save your changes first.' : ''} restartDisabled={busy || compiling} changeMain={() => openManager()} restart={() => { compilerSession.dispose(); figureCache.clear(); void recompile() }} showReport={() => setLogOpen(true)} />
                </div>
              </div>
              {(stale || compileError || compileOutcome === 'cancelled') && output && <div className="preview-stale">{compileError || compileOutcome === 'cancelled' ? `Showing the last successful PDF (revision ${output.revision}, ${output.main}).` : 'Your source has changed. Recompile to update this preview.'}</div>}
              {compileError && <p role="alert" className="compile-error">{compileError}</p>}
              {logOpen && <CompileDiagnostics key={compileLog} close={() => setLogOpen(false)} issues={issues} log={compileLog} status={compileStatus} outcome={compileOutcome} compiling={compiling} stale={diagnosticsStale} jump={jumpToIssue} summary={[compiledSnapshot && `Revision ${compiledSnapshot.revision} · ${compiledSnapshot.main}`, compileTiming].filter(Boolean).join(' · ')} />}
              {output ? <Suspense fallback={<p className="preview-loading" role="status">Loading PDF viewer...</p>}><PdfPreview stale={stale} searchRequest={pdfSearchRequest} findSource={text => { if (stale) return; setSourceSearchRequest(previous => ({ text, token: previous.token + 1 })); setNavigationMode('search'); setSidebar(true); setFocus(null); setViewMode(window.matchMedia('(max-width: 900px)').matches ? 'source' : 'split') }} data={output.pdf} fullscreen={focus === 'pdf'} onFullscreen={() => setFocus(focus === 'pdf' ? null : 'pdf')} /></Suspense> : <div className="preview-empty"><div className="preview-sheet"><Icon name="document" /><span /><span /><span /><span /></div><h3>{compiling ? 'Bringing your paper to life' : 'Your paper, beautifully typeset.'}</h3><p>{compiling ? 'The first compile downloads the packages your paper needs.' : 'Compile your LaTeX source to see the finished paper here.'}</p>{!compiling && <button className="preview-start" disabled={busy} onClick={() => void recompile()}>Compile your paper <span>&rarr;</span></button>}</div>}
            </section>
          </div>
        </div>

      </>}
    </>}
    {blocker.state === 'blocked' && <LeaveDialog busy={busy || saving} stay={() => blocker.reset()} leave={() => blocker.proceed()} />}
      {exportSnapshot && <Suspense fallback={<p role="status" className="export-loading">Opening export...</p>}><ExportDialog snapshot={exportSnapshot} close={() => setExportSnapshot(null)} /></Suspense>}
      {quickSwitch && project && <QuickFileSwitch files={navigationFiles} choose={id => { const file = files.find(item => item.id === id); if (file) choose(file) }} close={() => setQuickSwitch(false)} />}
      {replacementRequest && project && <Suspense fallback={<p role="status">Opening replacement preview...</p>}><ReplaceProjectDialog projectId={projectId} {...replacementRequest} blocked={replaceBlocked} close={() => setReplacementRequest(null)} onBusy={value => { inFlight.current = value; setBusy(value) }} applied={async () => { const loaded = await loadPaperState(projectId); setFiles(loaded.files); setSettings(loaded.settings); setStatus('Project replacements saved. Recompile to update the PDF.') }} /></Suspense>}
    {historyOpen && project && <Suspense fallback={<p role="status" className="export-loading">Opening history...</p>}><HistoryPanel projectId={projectId} title={project.project.name} editable={!!editable} blocked={dirty || saving || busy || compiling || recovery.length > 0 || !!recoveryError || Object.values(documents).some(item => !!item.error || item.remote !== undefined)} close={() => setHistoryOpen(false)} onBusy={value => { inFlight.current = value; setBusy(value) }} restored={async () => {
      const loaded = await loadPaperState(projectId)
      setFiles(loaded.files); setSettings(loaded.settings); editorMemory.clear()
      setSelected(loaded.files.find(file => file.id === selected?.id) ?? loaded.files.find(file => file.path === loaded.settings?.main_file) ?? null)
      setOpened([]); setStatus('Historical version restored. Recompile to update the PDF.')
    }} /></Suspense>}
    {manager && settings && <Suspense fallback={<p role="status" className="export-loading">Opening file manager...</p>}><FileManager initialPath={managerRequest.path} initialKind={managerRequest.kind} projectId={projectId} files={files} settings={settings} close={() => setManager(false)} onBusy={(value) => { inFlight.current = value; setBusy(value) }} applied={(warning) => { setError(warning ?? ''); setManager(false); setLoading(true); setAttempt((value) => value + 1) }} /></Suspense>}
  </div>
}

function Icon({ name }: { name: 'files' | 'play' | 'reload' | 'document' | 'log' }) {
  const paths = { files: 'M3 4h14v12H3z M7 4v12 M10 8h4 M10 11h4', play: 'm7 4 9 6-9 6z', reload: 'M16 8a6 6 0 1 0 0 5 M16 3v5h-5', document: 'M5 2h7l4 4v12H5z M12 2v5h4 M8 11h5 M8 14h5', log: 'M4 5h12 M4 10h12 M4 15h8' }
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>
}

function LeaveDialog({ busy, stay, leave }: { busy: boolean; stay: () => void; leave: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close() }, [])
  return <dialog ref={ref} className="project-dialog" aria-labelledby="leave-title" onCancel={(event) => { event.preventDefault(); stay() }}><h2 id="leave-title">{busy ? 'Please wait for the operation to finish' : 'Leave without saving?'}</h2><p className="muted">Stay to save or download your drafts. Leaving keeps completed local recovery copies on this browser, but they are not cloud saves.</p><div className="dialog-actions"><button className="button secondary" onClick={stay} autoFocus>Stay</button><button className="button primary" disabled={busy} onClick={leave}>Leave with recovery</button></div></dialog>
}
function message(cause: unknown) { return cause instanceof Error ? cause.message : 'Unable to complete the paper operation. Please try again.' }
