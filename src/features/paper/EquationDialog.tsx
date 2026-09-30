import { useEffect, useRef, useState } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { equationSource, equationTemplates, readEquation, type EquationDraft, type EquationMode } from './equations'
import './equations.css'

const modes: { value: EquationMode; title: string; help: string }[] = [
  { value: 'inline', title: 'Inline', help: 'Within a sentence' },
  { value: 'display', title: 'Display', help: 'On its own line' },
  { value: 'numbered', title: 'Numbered', help: 'With an equation number' },
  { value: 'align', title: 'Multiple lines', help: 'Aligned steps or derivations' },
]

export default function EquationDialog({ initial, readOnly, amsmath, mainPath, setup, insert, close }: {
  initial: string; readOnly: boolean; amsmath: boolean; mainPath: string;
  setup: () => void; insert: (draft: EquationDraft) => void; close: () => void
}) {
  const [draft, setDraft] = useState(() => readEquation(initial))
  const [error, setError] = useState(''), [previewError, setPreviewError] = useState('')
  const [allowUnsupported, setAllowUnsupported] = useState(false)
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLTextAreaElement>(null), preview = useRef<HTMLDivElement>(null)
  useEffect(() => { const node = dialog.current!; node.showModal(); input.current?.focus(); return () => node.close() }, [])
  useEffect(() => {
    const timer = setTimeout(() => {
      const node = preview.current; if (!node) return
      node.replaceChildren()
      try {
        if (draft.body.length > 10000) throw new Error('Preview is limited to 10,000 characters.')
        if (draft.body.trim()) katex.render(draft.mode === 'align' ? `\\begin{aligned}${draft.body}\\end{aligned}` : draft.body, node, { displayMode: draft.mode !== 'inline', throwOnError: true, trust: false, strict: 'error', maxExpand: 500, maxSize: 20, macros: {}, output: 'htmlAndMathml' })
        setPreviewError('')
      } catch (cause) { setPreviewError(cause instanceof Error ? cause.message.replace(/^KaTeX parse error:\s*/, '') : 'This expression cannot be previewed.') }
    }, 200)
    return () => clearTimeout(timer)
  }, [draft.body, draft.mode])
  const numbered = draft.mode === 'numbered' || draft.mode === 'align' && draft.numbered
  const update = (patch: Partial<EquationDraft>) => { setDraft(current => ({ ...current, ...patch })); setError(''); setAllowUnsupported(false) }
  function buildingBlock(item: typeof equationTemplates[number]) {
    const node = input.current; if (!node) return
    const from = node.selectionStart, to = node.selectionEnd
    if (draft.body.length - (to - from) + item.text.length > 10000) { setError('Equation is too long.'); return }
    update({ body: draft.body.slice(0,from) + item.text + draft.body.slice(to), ...('mode' in item ? { mode: item.mode } : {}) })
    requestAnimationFrame(() => { node.focus(); const start = from + (item.select ? 'at' in item ? item.at! : item.text.indexOf(item.select) : item.text.length); node.setSelectionRange(start, start + item.select.length) })
  }
  return <dialog ref={dialog} className="project-dialog equation-dialog" aria-labelledby="equation-title" onCancel={event => { event.preventDefault(); close() }}>
    <header className="equation-heading"><div><h2 id="equation-title">{initial ? 'Edit selected equation' : 'Insert equation'}</h2><p>Write your own LaTeX or use a building block to get started.</p></div><button className="button secondary compact-button" onClick={close}>Close</button></header>
    <div className="equation-body">
      <fieldset className="equation-modes"><legend>How should it appear?</legend>{modes.map(mode => <label key={mode.value} className={draft.mode === mode.value ? 'selected' : ''}><input type="radio" name="equation-mode" value={mode.value} checked={draft.mode === mode.value} onChange={() => update({ mode: mode.value })} /><span><strong>{mode.title}</strong><small>{mode.help}</small></span></label>)}</fieldset>
      <details className="equation-blocks"><summary>Building blocks &amp; symbols <span>Optional templates</span></summary><div>{equationTemplates.map(item => <button key={item.name} className="button secondary compact-button" onClick={() => buildingBlock(item)} title={item.text}>{item.name}</button>)}</div><p>Select the placeholder text and replace it with your values.</p></details>
      <label className="equation-label" htmlFor="equation-source">Equation LaTeX <span>Enter the expression without outer math delimiters.</span></label>
      <textarea ref={input} id="equation-source" spellCheck={false} maxLength={10000} value={draft.body} placeholder={'e.g. \\frac{a}{b} + \\sqrt{x}'} onChange={event => update({ body: event.target.value })} />
      {draft.mode === 'align' && <><p className="equation-help">Use <code>&amp;</code> at the alignment point and <code>{'\\\\'}</code> between rows.</p><label className="equation-check"><input type="checkbox" checked={draft.numbered} onChange={event => update({ numbered: event.target.checked })} />Number the rows</label></>}
      {numbered && <label className="equation-label">Reference label <span>Optional{draft.mode === 'align' ? '; labels the last row. Add other row labels in the source.' : '; use it later with a cross-reference.'}</span><input value={draft.label} maxLength={160} placeholder="eq:energy" onChange={event => update({ label: event.target.value })} /></label>}
      {!amsmath && <div className="equation-package"><p>No explicit <code>amsmath</code> import found in {mainPath}. Multiple lines, matrices and piecewise expressions need it; your class or included preamble may already load it.</p><button className="button secondary compact-button" disabled={readOnly} onClick={() => { try { setup(); setError('') } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to add package.') } }}>Add amsmath to {mainPath}</button><small>This is a separate source edit, saved through autosave.</small></div>}
      <section className="equation-preview-section" aria-label="Equation preview"><div className="equation-preview-heading"><strong>Live preview</strong><span>Final numbering follows your paper</span></div><div className="equation-preview" ref={preview} />{!draft.body.trim() && <p className="equation-help">Your equation will appear here as you type.</p>}{previewError && <><p role="status" className="equation-warning">Preview unavailable: {previewError}</p><label className="equation-check"><input type="checkbox" checked={allowUnsupported} onChange={event => setAllowUnsupported(event.target.checked)} />Insert source anyway and check with Recompile</label></>}<p className="equation-help">Local preview supports common math. Custom macros and packages may only render during full compilation.</p></section>
      <details className="equation-output"><summary>LaTeX to insert</summary><pre>{draft.body.trim() ? (() => { try { return equationSource(draft) } catch { return 'Check the equation and label above.' } })() : 'Write an expression above.'}</pre></details>
      {error && <p role="alert" className="notice error-notice">{error}</p>}
    </div>
    <footer className="equation-footer"><span>{readOnly ? 'This file is read-only.' : initial ? 'Replaces your selection. Undo restores the original.' : 'Inserts at your cursor. Undo removes the insertion.'}</span><button className="button secondary" onClick={close}>Cancel</button><button className="button primary" disabled={readOnly || !draft.body.trim() || !!previewError && !allowUnsupported} onClick={() => { try { insert(draft); close() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to insert equation.') } }}>{initial ? 'Replace selection' : 'Insert equation'}</button></footer>
  </dialog>
}
