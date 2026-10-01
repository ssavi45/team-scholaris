import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { buildOutline, type TextSource, type SourceLocation } from './editor-tools'
import './editor-tools.css'
import { PaperOutline } from './PaperOutline'

export function PaperNavigation({ files, mainFile, selectedFileId, navigate, children }: {
  files: TextSource[]; mainFile: string; selectedFileId?: string; children: ReactNode;
  navigate: (location: SourceLocation, expected: string) => void;
}) {
  const [filesShare, setFilesShare] = useState(35), [outlineExpanded, setOutlineExpanded] = useState(true)
  const deferredFiles = useDeferredValue(files)
  const outline = useMemo(() => buildOutline(deferredFiles, mainFile), [deferredFiles, mainFile])
  const open = (location: SourceLocation) => navigate(location, deferredFiles.find(file => file.id === location.fileId)!.content)
  return <div className={`paper-sidebar-stack${outlineExpanded ? '' : ' outline-collapsed'}`} style={{ '--paper-files-share': `${filesShare}%` } as CSSProperties}>
      <div className="paper-file-mode">{children}</div>
      {outlineExpanded && <div className="paper-sidebar-divider" role="separator" tabIndex={0} aria-label="Resize files and outline" aria-orientation="horizontal" aria-valuemin={25} aria-valuemax={75} aria-valuenow={filesShare}
        onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); setFilesShare(value => Math.min(75, Math.max(25, value + (event.key === 'ArrowUp' ? -5 : 5)))) } }}
        onDoubleClick={() => setFilesShare(35)}
        onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() }}
        onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) { const bounds = event.currentTarget.parentElement!.getBoundingClientRect(); if (bounds.height) setFilesShare(Math.min(75, Math.max(25, (event.clientY - bounds.top) / bounds.height * 100))) } }}
        onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}><span /></div>}
      <PaperOutline outline={outline} mainFile={mainFile} selectedFileId={selectedFileId} expanded={outlineExpanded} toggle={() => setOutlineExpanded(value => !value)} navigate={open} />
    </div>
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
