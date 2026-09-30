import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { PaperFile } from './paper-api'
const FigurePreview = lazy(() => import('./FigurePreview'))
import { figureSnippet } from './asset-tools'
import './references.css'

export function FigurePicker({ files, insert, close }: { files: PaperFile[]; insert: (text: string) => void; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const figures = files.filter(file => file.kind === 'image')
  const [path, setPath] = useState(figures[0]?.path ?? ''), [caption, setCaption] = useState(''), [label, setLabel] = useState('fig:results'), [error, setError] = useState('')
  const file = figures.find(item => item.path === path)
  useEffect(() => { const node = dialog.current!; node.showModal(); return () => node.close() }, [])
  return <dialog ref={dialog} className="project-dialog reference-dialog" aria-labelledby="figure-picker-title" onCancel={event => { event.preventDefault(); close() }}><h2 id="figure-picker-title">Insert a figure</h2><p>Upload PNG/JPEG figures through Explorer → + → Upload / import first. Add <code>{'\\usepackage{graphicx}'}</code> to your preamble.</p>{figures.length ? <><label>Figure<select value={path} onChange={e => setPath(e.target.value)}>{figures.map(item => <option key={item.id}>{item.path}</option>)}</select></label>{file && <div style={{ maxHeight: 200, overflow: 'auto' }}><Suspense fallback={<p>Loading preview?</p>}><FigurePreview key={file.id} file={file} /></Suspense></div>}<label>Caption<input maxLength={1000} value={caption} onChange={e => setCaption(e.target.value)} /></label><label>Unique label<input maxLength={160} value={label} onChange={e => setLabel(e.target.value)} placeholder="fig:results" /></label></> : <p>No figures uploaded yet.</p>}{error && <p role="alert">{error}</p>}<div className="dialog-actions"><button className="button secondary" onClick={close}>Cancel</button><button className="button primary" disabled={!file} onClick={() => { try { if (files.some(item => item.kind === 'text' && item.content.includes(`\\label{${label}}`))) throw new Error('This label is already used. Choose another.'); insert(figureSnippet(path, caption, label)); close() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to insert figure.') } }}>Insert figure</button></div></dialog>
}
