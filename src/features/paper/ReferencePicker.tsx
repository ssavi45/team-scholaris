import { useEffect, useRef, useState } from 'react'
import { bibDisplay, type ReferenceIndex } from './references'
import './references.css'

export function ReferencePicker({ index, kind, readOnly, insert, close, manage }: {
  index: ReferenceIndex; kind: 'citation' | 'label'; readOnly: boolean;
  insert: (key: string, command: string) => void; close: () => void; manage: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState(''), [command, setCommand] = useState(kind === 'citation' ? 'cite' : 'ref')
  useEffect(() => { const node = ref.current!; node.showModal(); return () => node.close() }, [])
  const options = kind === 'citation' ? index.entries : index.labels
  const matches = options.filter(item => (item.key + ' ' + item.path + ('fields' in item ? ' ' + ['author', 'title', 'year'].map(field => bibDisplay(item, field)).join(' ') : '')).toLowerCase().includes(query.toLowerCase()))
  return <dialog ref={ref} className="project-dialog reference-dialog" aria-labelledby="reference-picker-title" onCancel={event => { event.preventDefault(); close() }}>
    <header className="reference-heading"><h2 id="reference-picker-title">{kind === 'citation' ? 'Insert a citation' : 'Insert a cross-reference'}</h2><button className="button secondary compact-button" onClick={close}>Close</button></header>
    <label>Search {kind === 'citation' ? 'author, title, year or key' : 'label or file'}<input autoFocus type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <label>Command<select value={command} onChange={event => setCommand(event.target.value)}>{(kind === 'citation' ? ['cite', 'citep', 'citet'] : ['ref', 'eqref', 'pageref', 'autoref']).map(item => <option key={item} value={item}>\{item}</option>)}</select></label>
    <p className="reference-help">{kind === 'citation' ? 'Keys from current .bib drafts. The bibliography must be included in your paper. citep/citet need a compatible package such as natbib.' : 'Labels from current source drafts. eqref requires amsmath; autoref requires hyperref.'}</p>
    <div className="reference-results">{matches.slice(0, 150).map((item, i) => {
      const duplicate = (kind === 'citation' ? index.duplicateCitations : index.duplicateLabels).has(item.key)
      return <button className="reference-pick" key={item.fileId + ':' + i} disabled={readOnly || duplicate} onClick={() => { insert(item.key, command); close() }}><strong>{'fields' in item ? bibDisplay(item, 'title') || item.key : item.key}</strong>{'fields' in item && <span>{bibDisplay(item, 'author')} {bibDisplay(item, 'year')}</span>}<small>{item.key} · {item.path}:{item.line}{duplicate ? ' · Duplicate key — resolve first' : ''}</small><span className="reference-pick-action">Insert \{command}{'{'}{item.key}{'}'}</span></button>
    })}{!matches.length && <p>No matching {kind === 'citation' ? 'citations' : 'labels'} found.</p>}{matches.length > 150 && <p>Showing 150 results. Narrow your search.</p>}</div>
    <button className="button secondary" onClick={() => { close(); manage() }}>Manage references &amp; check keys</button>
  </dialog>
}
