import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { EditorState, Compartment, StateEffect, StateField, Prec } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, drawSelection, Decoration, WidgetType, type DecorationSet } from '@codemirror/view'
import { defaultKeymap } from '@codemirror/commands'
import { searchKeymap, search } from '@codemirror/search'
import { StreamLanguage, syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import * as Y from 'yjs'
import { supabase } from '../../lib/supabase'
import { SharedClient } from './shared-client'
import { sharedStorage } from './shared-storage'
import type { PaperFile } from './paper-api'
import './shared-writing.css'
import { useTheme } from '../../theme/theme-store'
import { Play, X } from 'lucide-react'
import { SharedCoauthors } from './SharedCoauthors'
import type { PaperBuild, SharedCut } from './paper-snapshot'
import { CompileDiagnostics } from './CompileDiagnostics'
import { parseCompileDiagnostics } from './compile-diagnostics'

const PdfPreview = lazy(async () => ({ default: (await import('./PdfPreview')).PdfPreview }))
const HistoryPanel = lazy(() => import('./HistoryPanel'))
type SavedCut = (signal: AbortSignal) => Promise<SharedCut>
type Report = { compiling: boolean; status: string; error: string; log: string; outcome: 'idle' | 'success' | 'failed' | 'cancelled'; timing: string; stale: boolean; diagnosticsStale: boolean; snapshot: { paths: string[]; files: PaperFile[]; revision: number; main: string } | null }

const decorations = StateEffect.define<DecorationSet>()
const cursors = StateField.define<DecorationSet>({ create: () => Decoration.none,
  update: (value, tx) => { for (const effect of tx.effects) if (effect.is(decorations)) return effect.value; return value.map(tx.changes) },
  provide: field => EditorView.decorations.from(field),
})
class Cursor extends WidgetType {
  name: string; color: string
  constructor(name: string, color: string) { super(); this.name = name; this.color = color }
  toDOM() { const element = document.createElement('span'); element.className = 'shared-cursor'; element.style.borderColor = this.color; element.setAttribute('aria-label', `${this.name}'s cursor`); const label = document.createElement('span'); label.textContent = this.name; label.style.background = this.color; element.append(label); return element }
}
export default function SharedWriting({ file: suppliedFile, projectId, userId, owner, close, compile, exportPaper, cancelCompile, build, busy, report }: {
  file: PaperFile; projectId: string; userId: string; owner: boolean; close: () => void;
  compile: (cut: SavedCut) => Promise<void>; exportPaper: (cut: SavedCut) => Promise<void>; cancelCompile: () => void;
  build: PaperBuild | null; busy: boolean; report: Report;
}) {
  // Parent polling must never replace a live document or restart its connection.
  const [file] = useState(suppliedFile)
  const enrollmentOwner = useRef(owner)
  const following = useRef('')
  const [followed, setFollowed] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false), [historyBusy, setHistoryBusy] = useState(false)
  const theme = useTheme()
  const themeMode = useRef(new Compartment())
  const initialTheme = useRef(theme)
  const dialog = useRef<HTMLDialogElement>(null), host = useRef<HTMLDivElement>(null)
  const client = useRef<SharedClient | null>(null), editor = useRef<EditorView | null>(null), undo = useRef<Y.UndoManager | null>(null)
  const [started, setStarted] = useState(false), [status, setStatus] = useState('Connect to write together in this file.')
  const [session, setSession] = useState<SharedClient | null>(null)
  const [preview, setPreview] = useState(true), [previewOnly, setPreviewOnly] = useState(false), [logOpen, setLogOpen] = useState(false)
  const [actionError, setActionError] = useState('')
  const [exporting, setExporting] = useState(false)
  const issues = useMemo(() => parseCompileDiagnostics(report.log, report.snapshot?.paths ?? []), [report.log, report.snapshot])
  const savedFile = build?.snapshot.entries.find(item => item.id === file.id)
  const stale = report.stale || (!!build && (!session?.ready || !!session.pending.length || !!session.recovery || (session.path || file.path) !== savedFile?.path || session.doc.getText('source').toString() !== savedFile?.content))
  const diagnosticsStale = report.diagnosticsStale || (!!report.snapshot && session?.doc.getText('source').toString() !== report.snapshot.files.find(item => item.id === file.id)?.content)
  const captureDisabled = !session?.ready || session.blocked || !!session.recovery || busy
  const [, redraw] = useState(0)
  useEffect(() => { dialog.current?.showModal() }, [])
  useEffect(() => { editor.current?.dispatch({ effects: themeMode.current.reconfigure(sharedTheme(theme === 'dark')) }) }, [theme])
  useEffect(() => {
    if (!started) return
    let disposed = false, release: (() => void) | undefined, unsubscribe: (() => void) | undefined
    let cursorTimer: ReturnType<typeof setTimeout>, frame = 0
    const lock = `scholaris-live:${userId}:${projectId}:${file.id}`
    const readOnly = new Compartment()
    const setup = async () => {
      if (!navigator.locks) { setStatus('This browser cannot safely isolate recovery copies. Use a current browser on HTTPS or localhost.'); return }
      await navigator.locks.request(lock, { ifAvailable: true }, async grant => {
        if (!grant || disposed) { if (!disposed) setStatus('This file is already open for live writing in another tab. Close it there first.'); return }
        const session = new SharedClient({ url: import.meta.env.VITE_PAPER_SHARED_URL, file: file.id, version: file.version,
          user: userId, key: lock, enable: enrollmentOwner.current, storage: sharedStorage(lock, userId), token: async () => {
            const result = await supabase!.auth.getSession()
            if (result.data.session?.user.id !== userId) throw new Error('Account changed.')
            return result.data.session.access_token
          } })
        client.current = session
        setSession(session)
        unsubscribe = session.subscribe(() => {
          if (disposed) return
          setStatus(session.status); redraw(value => value + 1)
          cancelAnimationFrame(frame)
          frame = requestAnimationFrame(() => {
            if (disposed || !host.current) return
            const canEdit = session.ready && session.editable && !session.blocked && !session.recovery
            if (session.ready && !editor.current) {
              undo.current = new Y.UndoManager(session.doc.getText('source'))
              editor.current = new EditorView({ parent: host.current, state: EditorState.create({ doc: session.doc.getText('source').toString(), extensions: [
                lineNumbers(), drawSelection(), search({ top: true }), StreamLanguage.define(stex), themeMode.current.of(sharedTheme(initialTheme.current === 'dark')),
                readOnly.of(EditorState.readOnly.of(!canEdit)), yCollab(session.doc.getText('source'), null, { undoManager: undo.current }),
                Prec.highest(EditorView.domEventHandlers({ beforeinput: (event, view) => view.state.readOnly && ['historyUndo', 'historyRedo'].includes(event.inputType) })),
                keymap.of(yUndoManagerKeymap.map(binding => ({ ...binding, run: view => view.state.readOnly || (binding.run?.(view) ?? false), shift: binding.shift ? view => view.state.readOnly || (binding.shift?.(view) ?? false) : undefined }))), keymap.of([...searchKeymap, ...defaultKeymap]), cursors,
                EditorView.contentAttributes.of({ 'aria-label': `Live LaTeX editor: ${file.path}` }),
                EditorView.theme({ '&': { height: '100%', color: 'var(--text-primary)', background: 'var(--bg-surface)' }, '.cm-scroller': { overflow: 'auto', fontFamily: 'Consolas, monospace' }, '.cm-gutters': { background: 'var(--bg-surface)', color: 'var(--text-secondary)' }, '.cm-content': { padding: '12px' } }),
                EditorView.updateListener.of(update => {
                  if (update.selectionSet && following.current) { following.current = ''; setFollowed('') }
                  if (update.selectionSet || update.docChanged) {
                    clearTimeout(cursorTimer); cursorTimer = setTimeout(() => session.cursor(update.state.selection.main.anchor, update.state.selection.main.head), 350)
                  }
                }),
              ] }) })
            }
            const view = editor.current
            if (!view) return
            const marks = session.peers.flatMap(peer => {
              try {
                if (peer.userId === userId || !peer.cursor) return []
                const anchor = Y.createAbsolutePositionFromRelativePosition(peer.cursor.anchor, session.doc)
                const head = Y.createAbsolutePositionFromRelativePosition(peer.cursor.head, session.doc)
                if (!anchor || !head || anchor.type !== session.doc.getText('source') || head.type !== anchor.type) return []
                const from = Math.min(anchor.index, head.index), to = Math.max(anchor.index, head.index)
                return [Decoration.widget({ widget: new Cursor(peer.name, peer.color), side: 1 }).range(head.index),
                  ...(from < to ? [Decoration.mark({ attributes: { style: `background:${peer.color}30` } }).range(from, to)] : [])]
              } catch { return [] }
            })
            view.dispatch({ effects: [readOnly.reconfigure(EditorState.readOnly.of(!canEdit)), decorations.of(Decoration.set(marks, true))] })
            if (following.current) {
              const peer = session.peers.find(item => item.userId === following.current && item.cursor)
              if (!peer) { following.current = ''; setFollowed('') }
              else {
                try {
                  const at = Y.createAbsolutePositionFromRelativePosition(peer.cursor!.head, session.doc)
                  if (at?.type === session.doc.getText('source')) view.dispatch({ effects: EditorView.scrollIntoView(at.index, { y: 'center' }) })
                } catch { /* Invalid or deleted anchors never move the selection. */ }
              }
            }
          })
        })
        await session.start()
        if (!disposed) await new Promise<void>(resolve => { release = resolve })
      })
    }
    void setup().catch(() => setStatus('Unable to start live writing. Close and retry.'))
    const refresh = () => { void client.current?.refresh().catch(() => {}) }
    const timer = setInterval(refresh, 30000)
    const beforeUnload = (event: BeforeUnloadEvent) => { if (client.current?.pending.length) event.preventDefault() }
    const beforeSignOut = (event: Event) => { if (client.current?.pending.length || client.current?.recovery) { event.preventDefault(); setStatus('Download or synchronize the live draft before signing out.') } }
    window.addEventListener('beforeunload', beforeUnload); window.addEventListener('scholaris:before-sign-out', beforeSignOut)
    return () => { disposed = true; unsubscribe?.(); clearInterval(timer); clearTimeout(cursorTimer); cancelAnimationFrame(frame); editor.current?.destroy(); editor.current = null; undo.current?.destroy(); const current = client.current; client.current = null; if (current) void current.close().finally(() => release?.()); else release?.(); window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('scholaris:before-sign-out', beforeSignOut) }
  }, [started, file.id, file.path, file.version, projectId, userId])
  function leave() { if (!session?.pending.length || window.confirm('Leave live writing? Completed local recovery copies remain on this device. Download your draft first if recovery storage failed.')) close() }
  function download() {
    const text = session?.recovery?.text ?? session?.doc.getText('source').toString() ?? file.content
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' })), link = document.createElement('a'); link.href = url; link.download = (session?.path || file.path).split('/').pop() || 'draft.tex'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function run(action: 'compile' | 'export') {
    if (!session || captureDisabled) return
    setActionError('')
    try {
      const cut = session.snapshotBarrier()
      if (action === 'compile') { setPreview(true); await compile(cut) }
      else { setExporting(true); await exportPaper(cut) }
    } catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Unable to capture the saved paper. Retry when connected.') }
    finally { setExporting(false) }
  }
  return <dialog className={`shared-writing${started ? ' shared-writing-active' : ''}`} ref={dialog} onCancel={event => { event.preventDefault(); leave() }} aria-labelledby="shared-title">
    <header><div><h2 id="shared-title">Live writing · {session?.path || file.path}</h2><p role="status">{status}</p></div><button className="button secondary" aria-label="Close live writing" title="Close this window; the shared session stays available" onClick={leave}><X size={16} aria-hidden="true" />Close</button></header>
    {!started && <section><p>Work in the same file with your coauthors. Undo affects your own changes. Local recovery stays on this device for up to seven days.</p><p>Renaming keeps the session connected. Replacing, deleting or restoring a live file requires owner confirmation and ends its session. Saved work is preserved in history; unsent drafts stay on each device.</p><button className="button primary" onClick={() => setStarted(true)}>{owner && !file.shared_epoch ? 'Start session' : 'Join session'}</button></section>}
    {started && <><nav aria-label="Live writing controls"><button className="button secondary" disabled={!session?.editable || session.blocked || !!session.recovery} onClick={() => undo.current?.undo()}>Undo</button><button className="button secondary" disabled={!session?.editable || session.blocked || !!session.recovery} onClick={() => undo.current?.redo()}>Redo</button><button className="button secondary" onClick={download}>Download draft</button><button className="button secondary" aria-pressed={preview} onClick={() => { setPreview(!preview); setPreviewOnly(false) }}>{preview ? 'Hide PDF' : 'Show PDF'}</button>{!preview && <>{report.compiling ? <button className="button secondary" onClick={cancelCompile}>Cancel compile</button> : <button className="button primary" disabled={captureDisabled} onClick={() => void run('compile')}>Recompile</button>}<button className="button secondary" disabled={captureDisabled || exporting} onClick={() => void run('export')}>{exporting ? 'Preparing…' : 'Export'}</button></>}{owner && <button className="button secondary" title="End live writing for everyone in this file" disabled={!session?.ready || session.blocked || !!session.pending.length || !!session.recovery || busy} onClick={() => { if (window.confirm('End live writing for everyone? Saved edits are kept. Unsent edits on other devices must be recovered separately.')) session?.end() }}>End session</button>}<button className="button secondary" disabled={captureDisabled || historyBusy} onClick={() => setHistoryOpen(true)}>History</button><SharedCoauthors projectId={projectId} userId={userId} peers={session?.peers ?? []} following={followed} follow={id => { following.current = following.current === id ? '' : id; setFollowed(following.current); setPreviewOnly(false); void session?.refresh() }} /></nav>
    {followed && <p className="shared-build-notice" role="status">Following {session?.peers.find(peer => peer.userId === followed)?.name ?? 'coauthor'}. Move your cursor or click their avatar to stop.</p>}
    {historyOpen && <Suspense fallback={<p role="status">Opening history...</p>}><HistoryPanel projectId={projectId} title={session?.path || file.path} editable={!!session?.editable} blocked={!!session?.pending.length || !!session?.recovery || !!session?.blocked || busy} close={() => setHistoryOpen(false)} onBusy={setHistoryBusy} restored={async () => { await session?.refresh() }} /></Suspense>}
    {actionError && <p className="shared-build-notice" role="alert">{actionError}</p>}
    {session?.recovery && <section role="alert"><p>A local draft has unsent edits.</p><button className="button primary" disabled={!session.editable || session.blocked} onClick={() => session.restore()}>Restore local edits</button><button className="button secondary" onClick={() => { if (window.confirm('Discard this local recovery copy?')) session.discard() }}>Discard copy</button></section>}
    <div className={`shared-body${preview ? ' shared-with-preview' : ''}${previewOnly ? ' shared-preview-only' : ''}`}>
      <div className="shared-editor" ref={host} />
      {preview && <aside className="shared-pdf" aria-label="Live writing PDF preview">
        <div className="shared-pdf-heading"><strong>PDF preview</strong><div><button className="button secondary" disabled={captureDisabled || exporting} onClick={() => void run('export')}>{exporting ? 'Preparing…' : 'Export'}</button><button className="button secondary" aria-expanded={logOpen} onClick={() => setLogOpen(!logOpen)}>Log{issues.length ? ` (${issues.length})` : ''}</button>{report.compiling ? <button className="button secondary" onClick={cancelCompile}>Cancel compile</button> : <button className="button primary" disabled={captureDisabled} onClick={() => void run('compile')}><Play size={14} aria-hidden="true" />Recompile</button>}</div></div>
        <p className="shared-build-notice" role="status">{exporting ? 'Preparing a saved revision for export…' : report.compiling ? report.status : report.error ? `${report.error}${build ? ` Showing the last successful PDF, revision ${build.revision}.` : ''}` : report.outcome === 'cancelled' ? `Compilation cancelled.${build ? ` Showing revision ${build.revision}.` : ''}` : build ? `Revision ${build.revision} · ${build.main}${stale ? ' · Newer edits are not in this PDF' : ' · Saved source compiled'}` : 'Compile a saved revision. Everyone can keep writing.'}</p>
        {logOpen && <CompileDiagnostics issues={issues} log={report.log} status={report.status} outcome={report.outcome} compiling={report.compiling} stale={diagnosticsStale} summary={`Revision ${report.snapshot?.revision ?? '—'} · ${report.snapshot?.main ?? session?.path ?? file.path} · ${report.timing}`} close={() => setLogOpen(false)} canJump={issue => issue.file === report.snapshot?.files.find(item => item.id === file.id)?.path} jump={issue => {
          if (!issue.line || diagnosticsStale || !editor.current) return
          setPreviewOnly(false)
          const view = editor.current, line = view.state.doc.line(Math.min(issue.line, view.state.doc.lines))
          view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) }); view.focus()
        }} />}
        {build ? <Suspense fallback={<p role="status">Loading PDF viewer…</p>}><PdfPreview data={build.pdf} stale={stale} searchRequest={null} fullscreen={previewOnly} onFullscreen={() => setPreviewOnly(!previewOnly)} findSource={text => {
          if (stale || !editor.current) return
          const view = editor.current, index = view.state.doc.toString().indexOf(text)
          if (index < 0) { setActionError('This passage is not in the live file. Open the relevant source file and use Find & replace.'); return }
          setPreviewOnly(false); view.dispatch({ selection: { anchor: index, head: index + text.length }, effects: EditorView.scrollIntoView(index, { y: 'center' }) }); view.focus()
        }} /></Suspense> : <div className="shared-pdf-empty"><p>{report.error ? 'No successful PDF yet. Open Log for details, then recompile.' : 'Your saved paper will appear here.'}</p></div>}
      </aside>}
    </div></>}
  </dialog>
}

function sharedTheme(dark: boolean) {
  return [syntaxHighlighting(HighlightStyle.define([
    { tag: [tags.tagName, tags.function(tags.variableName), tags.keyword], color: dark ? '#a6e2bd' : '#245aa1' },
    { tag: [tags.meta, tags.attributeName], color: dark ? '#b1cbff' : '#795095' },
    { tag: tags.comment, color: dark ? '#a3b5a7' : '#526f5b' },
  ])), EditorView.theme({ '.cm-cursor': { borderLeftColor: dark ? '#a6e2bd' : '#1f4331' }, '&.cm-focused .cm-selectionBackground': { background: dark ? '#315341' : '#d5e6db' } }, { dark })]
}
