import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { buildOutline, searchProject, type TextSource, type SourceLocation } from './editor-tools'
import './editor-tools.css'

export function PaperNavigation({ files, mainFile, mode, setMode, navigate, replace, canReplace, children, initialQuery = '' }: {
  files: TextSource[]; mainFile: string; mode: 'files' | 'outline' | 'search'; setMode: (mode: 'files' | 'outline' | 'search') => void;
  navigate: (location: SourceLocation, expected: string) => void; replace: (query: string, replacement: string, matchCase: boolean) => void;
  canReplace: boolean; children: ReactNode; initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery), [replacement, setReplacement] = useState(''), [matchCase, setMatchCase] = useState(false)
  const deferredFiles = useDeferredValue(files), deferredQuery = useDeferredValue(query)
  const outline = useMemo(() => buildOutline(deferredFiles, mainFile), [deferredFiles, mainFile])
  const result = useMemo(() => searchProject(deferredFiles, deferredQuery, matchCase), [deferredFiles, deferredQuery, matchCase])
  const open = (location: SourceLocation) => navigate(location, deferredFiles.find(file => file.id === location.fileId)!.content)
  return <><nav className="paper-navigation-modes" aria-label="Sidebar mode">{(['files', 'outline', 'search'] as const).map(item => <button className="tool-button" key={item} aria-pressed={mode === item} onClick={() => setMode(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}</nav>
    <div className="paper-file-mode" hidden={mode !== 'files'}>{children}</div>
    {mode === 'outline' && <div className="paper-navigation-content"><p>From {mainFile}. Literal headings and input/include paths; macros and conditional TeX are not evaluated.</p>{!outline.headings.length && <p>No supported headings found.</p>}{outline.headings.map((heading, index) => <button className="paper-navigation-result" key={`${heading.fileId}:${index}`} style={{ paddingLeft: `${8 + Math.min(heading.level, 4) * 8}px` }} onClick={() => open(heading)}><strong>{heading.title}</strong><small>{heading.path}:{heading.line}</small></button>)}{!!outline.unresolved.length && <p>Unresolved inputs: {outline.unresolved.join(', ')}</p>}</div>}
    {mode === 'search' && <div className="paper-navigation-content"><label>Search all source files<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find text..." /></label><label className="paper-check"><input type="checkbox" checked={matchCase} onChange={event => setMatchCase(event.target.checked)} />Match case</label><label>Replace with<input value={replacement} onChange={event => setReplacement(event.target.value)} placeholder="Replacement text" /></label><button className="button secondary compact-button" disabled={!query || !canReplace} onClick={() => replace(query, replacement, matchCase)}>Preview replacements</button>{!canReplace && <p>Replacing requires edit access and saved, conflict-free drafts.</p>}<p role="status">{!query ? 'Search includes current local drafts. Literal text; no regular expressions.' : `${result.hits.length}${result.truncated ? '+' : ''} results${deferredQuery !== query || deferredFiles !== files ? ' · Updating...' : ''}`}</p>{result.hits.map(hit => <button className="paper-navigation-result" key={`${hit.fileId}:${hit.from}`} onClick={() => open(hit)}><strong>{hit.path}:{hit.line}</strong><small>{hit.excerpt}</small></button>)}{result.truncated && <p>Showing the first 500 matches. Narrow your search.</p>}</div>}
  </>
}

export function QuickFileSwitch({ files, choose, close }: { files: TextSource[]; choose: (id: string) => void; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState(''), [index, setIndex] = useState(0)
  const matches = files.filter(file => file.kind !== 'folder' && file.path.toLowerCase().includes(query.toLowerCase()))
  const active = Math.min(index, Math.max(0, matches.length - 1))
  useEffect(() => { const node = dialog.current!; node.showModal(); return () => node.close() }, [])
  useEffect(() => { dialog.current?.querySelector('[aria-current=true]')?.scrollIntoView({ block: 'nearest' }) }, [active, query])
  const pick = (id: string) => { choose(id); close() }
  return <dialog ref={dialog} className="project-dialog quick-file-dialog" aria-labelledby="quick-file-title" onCancel={event => { event.preventDefault(); close() }}><div className="history-heading"><h2 id="quick-file-title">Open a file</h2><button className="tool-button" onClick={close}>Close</button></div><input autoFocus type="search" aria-label="Find file by path" value={query} onChange={event => { setQuery(event.target.value); setIndex(0) }} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setIndex(Math.max(0, Math.min(matches.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)))) } if (event.key === 'Enter' && matches[active]) { event.preventDefault(); pick(matches[active].id) } }} /><div className="quick-file-results">{matches.map((file, i) => <button className="paper-navigation-result" aria-current={i === active ? 'true' : undefined} key={file.id} onClick={() => pick(file.id)}>{file.path}</button>)}{!matches.length && <p>No matching files.</p>}</div><p>Arrow keys to select, Enter to open, Escape to close.</p></dialog>
}
