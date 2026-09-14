import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { StreamLanguage } from '@codemirror/language'
import { stex } from '@codemirror/legacy-modes/mode/stex'

export function SourceEditor({ value, readOnly, onChange, onSave }: {
  value: string; readOnly: boolean; onChange: (value: string) => void; onSave: () => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const access = useRef(new Compartment())
  const callbacks = useRef({ onChange, onSave })
  useEffect(() => { callbacks.current = { onChange, onSave } }, [onChange, onSave])
  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      extensions: [basicSetup, StreamLanguage.define(stex),
        access.current.of(EditorState.readOnly.of(true)),
        EditorView.contentAttributes.of({ 'aria-label': 'LaTeX source editor' }),
        keymap.of([{ key: 'Mod-s', run: () => { callbacks.current.onSave(); return true } }]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) callbacks.current.onChange(update.state.doc.toString())
        }),
        EditorView.theme({ '&': { height: '100%' }, '.cm-scroller': { overflow: 'auto', lineHeight: '1.75' }, '.cm-content': { fontFamily: "'Cascadia Code', 'Consolas', monospace", fontSize: '13px', padding: '20px 0' }, '.cm-line': { padding: '0 20px' }, '.cm-gutters': { backgroundColor: '#fafbf9', color: '#9ca69f', border: 'none' }, '.cm-activeLine': { backgroundColor: '#f2f6f2' }, '.cm-activeLineGutter': { backgroundColor: '#eaf0ea', color: '#395443' }, '&.cm-focused': { outline: 'none' } }),
      ],
    })
    view.current = editor
    return () => { editor.destroy(); view.current = null }
  }, [])
  useEffect(() => {
    const editor = view.current
    if (editor && editor.state.doc.toString() !== value) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } })
  }, [value])
  useEffect(() => {
    view.current?.dispatch({ effects: access.current.reconfigure(EditorState.readOnly.of(readOnly)) })
  }, [readOnly])
  return <div ref={host} className="source-editor" />
}
