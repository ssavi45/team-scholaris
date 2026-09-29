import { useEffect, useRef, type ReactNode } from 'react'
import { basicSetup } from 'codemirror'
import { Compartment, EditorState, StateEffect, Prec } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { HighlightStyle, StreamLanguage, syntaxHighlighting, indentUnit } from '@codemirror/language'
import { openSearchPanel, gotoLine, search } from '@codemirror/search'
import { Search, Plus, Settings2, Wrench, Bold, Italic } from 'lucide-react'
import { EditorMenu } from './EditorMenu'
import { toggleComment } from '@codemirror/commands'
import { snippets, insertSnippet, latexCompletions } from './editor-snippets'
import type { EditorPreferences } from './editor-preferences'
import { tags as t } from '@lezer/highlight'
import { stex } from '@codemirror/legacy-modes/mode/stex'
import { useTheme } from '../../theme/theme-store'

const lightTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: '#ffffff', color: '#16261a' },
  '.cm-scroller': { overflow: 'auto', lineHeight: '1.75' },
  '.cm-content': { fontFamily: "'Cascadia Code', 'Consolas', monospace", fontSize: '14px', padding: '10px 0' },
  '.cm-line': { padding: '0 20px' },
  '.cm-gutters': { backgroundColor: '#fafbf9', color: '#65766b', border: 'none' },
  '.cm-activeLine': { backgroundColor: '#f2f6f2' },
  '.cm-activeLineGutter': { backgroundColor: '#eaf0ea', color: '#395443' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#1f4331' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: '#d5e6db' },
  '.cm-searchMatch': { backgroundColor: '#d9e9df' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#a9d4ba' },
})

const lightHighlight = HighlightStyle.define([
  { tag: [t.tagName, t.function(t.variableName), t.definitionKeyword], color: '#245aa1' },
  { tag: [t.meta, t.attributeName], color: '#795095' },
  { tag: t.keyword, color: '#1f4331', fontWeight: '600' },
  { tag: t.atom, color: '#27523c' },
  { tag: t.number, color: '#8c4b1d' },
  { tag: t.comment, color: '#526f5b', fontStyle: 'italic' },
  { tag: t.string, color: '#2b6343' },
  { tag: t.bracket, color: '#4d6153' },
  { tag: t.operator, color: '#234a35' },
])

const darkTheme = EditorView.theme({
  '&': { height: '100%', backgroundColor: '#101713', color: '#EDF3EE' },
  '.cm-scroller': { overflow: 'auto', lineHeight: '1.75' },
  '.cm-content': { fontFamily: "'Cascadia Code', 'Consolas', monospace", fontSize: '14px', padding: '10px 0', caretColor: '#95D5AC' },
  '.cm-line': { padding: '0 20px' },
  '.cm-gutters': { backgroundColor: '#141c17', color: '#a3b5a7', border: 'none' },
  '.cm-activeLine': { backgroundColor: '#18241c' },
  '.cm-activeLineGutter': { backgroundColor: '#1d2e23', color: '#95D5AC' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#95D5AC' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { backgroundColor: '#264231' },
  '.cm-searchMatch': { backgroundColor: '#243e2f' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: '#3b664d' },
}, { dark: true })

const darkHighlight = HighlightStyle.define([
  { tag: [t.tagName, t.function(t.variableName), t.definitionKeyword], color: '#a6e2bd' },
  { tag: [t.meta, t.attributeName], color: '#b1cbff' },
  { tag: t.invalid, color: '#ffb4ac', textDecoration: 'underline' },
  { tag: t.keyword, color: '#95D5AC', fontWeight: '600' },
  { tag: t.atom, color: '#a6e2bd' },
  { tag: t.number, color: '#e5b378' },
  { tag: t.comment, color: '#a3b5a7', fontStyle: 'italic' },
  { tag: t.string, color: '#bce4cb' },
  { tag: t.bracket, color: '#b5c3b8' },
  { tag: t.operator, color: '#95D5AC' },
])

function themeExtensions(isDark: boolean) {
  return [
    isDark ? darkTheme : lightTheme,
    syntaxHighlighting(isDark ? darkHighlight : lightHighlight),
  ]
}

export type EditorMemory = Map<string, { state: EditorState; top: number; left: number }>

export function SourceEditor({ value, readOnly, onChange, onSave, fileId, memory, jump, preferences, setPreferences, quickSwitch, reopen, compile, findPdf, canFindPdf, fileActions }: {
  value: string; readOnly: boolean; onChange: (value: string) => void; onSave: () => void
  fileId: string; memory: EditorMemory
  jump?: { fileId: string; line: number; token: number; from?: number; to?: number } | null
  preferences: EditorPreferences; setPreferences: (patch: Partial<EditorPreferences>) => void
  quickSwitch: () => void; reopen: () => void; compile: () => void
  findPdf: (text: string) => void; canFindPdf: boolean; fileActions: ReactNode
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const access = useRef(new Compartment())
  const themeCompartment = useRef(new Compartment())
  const preferencesCompartment = useRef(new Compartment())
  const currentTheme = useTheme()
  const callbacks = useRef({ onChange, onSave, quickSwitch, reopen, compile })
  useEffect(() => { callbacks.current = { onChange, onSave, quickSwitch, reopen, compile } }, [onChange, onSave, quickSwitch, reopen, compile])

  const initialTheme = useRef(currentTheme)
  const initialReadOnly = useRef(readOnly)
  const initialValue = useRef(value)
  const initialPreferences = useRef(preferences)

  useEffect(() => {
    const extensions = [
        basicSetup,
        search({ top: true }),
        EditorState.phrases.of({ 'Find': 'Find in this file', 'Replace': 'Replace with', 'next': 'Next', 'previous': 'Previous', 'all': 'Select all matches', 'match case': 'Match case', 'regexp': 'Regular expression', 'by word': 'Whole words', 'replace': 'Replace next', 'replace all': 'Replace all', 'close': 'Close search', 'Go to line': 'Go to line', 'go': 'Go' }),
        StreamLanguage.define(stex),
        themeCompartment.current.of(themeExtensions(initialTheme.current === 'dark')),
        access.current.of(EditorState.readOnly.of(initialReadOnly.current)),
        preferencesCompartment.current.of(preferenceExtensions(initialPreferences.current)),
        EditorState.languageData.of(() => [{ autocomplete: latexCompletions, commentTokens: { line: '%' } }]),
        EditorView.contentAttributes.of({ 'aria-label': 'LaTeX source editor' }),
        Prec.high(keymap.of([
          { key: 'Mod-s', run: () => { callbacks.current.onSave(); return true } },
          { key: 'Mod-b', run: editor => insertSnippet(editor, 0) },
          { key: 'Mod-i', run: editor => insertSnippet(editor, 1) },
          { key: 'Mod-g', run: gotoLine },
          { key: 'Mod-p', run: () => { callbacks.current.quickSwitch(); return true } },
          { key: 'Mod-Shift-t', run: () => { callbacks.current.reopen(); return true } },
          { key: 'Mod-Enter', run: () => { callbacks.current.compile(); return true } },
        ])),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) callbacks.current.onChange(update.state.doc.toString())
        }),
      ]
    const cached = memory.get(fileId)
    const editor = new EditorView({ parent: host.current!, state: cached?.state ?? EditorState.create({ doc: initialValue.current, extensions }) })
    if (cached) {
      editor.dispatch({ effects: StateEffect.reconfigure.of(extensions) })
      editor.scrollDOM.scrollTop = cached.top; editor.scrollDOM.scrollLeft = cached.left
    }
    view.current = editor
    return () => {
      memory.set(fileId, { state: editor.state, top: editor.scrollDOM.scrollTop, left: editor.scrollDOM.scrollLeft })
      editor.destroy(); view.current = null
    }
  }, [fileId, memory])

  useEffect(() => {
    view.current?.dispatch({
      effects: themeCompartment.current.reconfigure(themeExtensions(currentTheme === 'dark')),
    })
  }, [currentTheme])

  useEffect(() => {
    const editor = view.current
    if (editor && editor.state.doc.toString() !== value) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } })
  }, [value])

  useEffect(() => {
    view.current?.dispatch({ effects: access.current.reconfigure(EditorState.readOnly.of(readOnly)) })
  }, [readOnly])

  useEffect(() => {
    view.current?.dispatch({ effects: preferencesCompartment.current.reconfigure(preferenceExtensions(preferences)) })
  }, [preferences])

  useEffect(() => {
    const editor = view.current
    if (!editor || !jump || jump.fileId !== fileId) return
    const line = editor.state.doc.line(Math.min(Math.max(1, jump.line), editor.state.doc.lines))
    const from = Math.min(jump.from ?? line.from, editor.state.doc.length), to = Math.min(jump.to ?? line.to, editor.state.doc.length)
    editor.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: 'center' }) })
    editor.focus()
  }, [jump, fileId])

  return <><div className="paper-edit-tools editor-toolbar" aria-label="Writing tools">
    {fileActions}
    <span className="editor-tool-divider" aria-hidden="true" />
    <button className="tool-button editor-find-button" onClick={() => view.current && openSearchPanel(view.current)} title="Find or replace text in this file (Ctrl/Cmd+F)"><Search size={15} aria-hidden="true" />Find &amp; replace</button>
    <EditorMenu label="Insert" icon={<Plus size={15} aria-hidden="true" />}>
      <p className="editor-menu-caption">Add to your paper</p>
      {snippets.map((snippet, index) => <button key={snippet.label} disabled={readOnly} onClick={() => { if (view.current) insertSnippet(view.current, index) }}>{snippet.label === 'List' ? 'Bullet list' : snippet.label === 'Equation' ? 'Math equation' : snippet.label === 'Figure' ? 'Figure template' : snippet.label === 'Bold' ? 'Bold text' : snippet.label === 'Italic' ? 'Italic text' : snippet.label}{index < 2 && (index === 0 ? <Bold size={14} aria-hidden="true" /> : <Italic size={14} aria-hidden="true" />)}</button>)}
    </EditorMenu>
    <EditorMenu label="Tools" icon={<Wrench size={15} aria-hidden="true" />}>
      <button onClick={() => view.current && gotoLine(view.current)}>Go to line<span className="editor-shortcut">Ctrl/Cmd G</span></button>
      <button disabled={readOnly} title="Add or remove % at the start of selected lines" onClick={() => { if (view.current) { toggleComment(view.current); view.current.focus() } }}>Comment / uncomment lines</button>
      <button disabled={!canFindPdf} title={canFindPdf ? 'Search the PDF for selected text, or the current line' : 'Compile your latest changes to search the PDF'} onClick={() => { const editor = view.current; if (!editor) return; const range = editor.state.selection.main; findPdf((range.empty ? editor.state.doc.lineAt(range.head).text : editor.state.sliceDoc(range.from, range.to)).trim().slice(0, 200)) }}>Search this text in PDF</button>
      <p className="editor-menu-caption">{canFindPdf ? 'PDF lookup searches text; it may not match LaTeX commands.' : 'PDF lookup is available after compiling your latest changes.'}</p>
    </EditorMenu>
    <EditorMenu label="Editor settings" icon={<Settings2 size={15} aria-hidden="true" />} settings>
      <label>Text size <select value={preferences.fontSize} onChange={event => setPreferences({ fontSize: Number(event.target.value) })}>{Array.from({ length: 14 }, (_, i) => i + 11).map(size => <option key={size} value={size}>{size} px</option>)}</select></label>
      <label className="editor-check"><input type="checkbox" checked={preferences.wrap} onChange={event => setPreferences({ wrap: event.target.checked })} /> Wrap long lines</label>
      <label>Indentation <select value={preferences.indent} onChange={event => setPreferences({ indent: Number(event.target.value) })}><option value={2}>2 spaces</option><option value={4}>4 spaces</option></select></label>
      <details className="editor-shortcuts"><summary>Keyboard shortcuts</summary><dl>{[['Find & replace', 'Ctrl/Cmd F'], ['Open file', 'Ctrl/Cmd P'], ['Go to line', 'Ctrl/Cmd G'], ['Bold / italic', 'Ctrl/Cmd B / I'], ['Comment lines', 'Ctrl/Cmd /'], ['Reopen tab', 'Ctrl/Cmd Shift T'], ['Compile PDF', 'Ctrl/Cmd Enter'], ['Save', 'Ctrl/Cmd S'], ['Suggestions', 'Ctrl Space'], ['Exit focus mode', 'Escape']].map(([action, key]) => <div key={action}><dt>{action}</dt><dd><kbd>{key}</kbd></dd></div>)}</dl></details>
    </EditorMenu>
  </div><div ref={host} className="source-editor" /></>

}

function preferenceExtensions(preferences: EditorPreferences) {
  return [preferences.wrap ? EditorView.lineWrapping : [], indentUnit.of(' '.repeat(preferences.indent)), EditorState.tabSize.of(preferences.indent),
    EditorView.theme({ '.cm-content': { fontSize: `${preferences.fontSize}px` } })]
}
