import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { Compartment, EditorState, StateEffect } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
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

export function SourceEditor({ value, readOnly, onChange, onSave, fileId, memory, jump }: {
  value: string; readOnly: boolean; onChange: (value: string) => void; onSave: () => void
  fileId: string; memory: EditorMemory
  jump?: { fileId: string; line: number; token: number } | null
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const access = useRef(new Compartment())
  const themeCompartment = useRef(new Compartment())
  const currentTheme = useTheme()
  const callbacks = useRef({ onChange, onSave })
  useEffect(() => { callbacks.current = { onChange, onSave } }, [onChange, onSave])

  const initialTheme = useRef(currentTheme)
  const initialReadOnly = useRef(readOnly)
  const initialValue = useRef(value)

  useEffect(() => {
    const extensions = [
        basicSetup,
        StreamLanguage.define(stex),
        themeCompartment.current.of(themeExtensions(initialTheme.current === 'dark')),
        access.current.of(EditorState.readOnly.of(initialReadOnly.current)),
        EditorView.contentAttributes.of({ 'aria-label': 'LaTeX source editor' }),
        keymap.of([{ key: 'Mod-s', run: () => { callbacks.current.onSave(); return true } }]),
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
    const editor = view.current
    if (!editor || !jump || jump.fileId !== fileId) return
    const line = editor.state.doc.line(Math.min(Math.max(1, jump.line), editor.state.doc.lines))
    editor.dispatch({ selection: { anchor: line.from, head: line.to }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
    editor.focus()
  }, [jump, fileId])

  return <div ref={host} className="source-editor" />
}
