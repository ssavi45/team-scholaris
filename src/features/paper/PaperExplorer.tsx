import { useEffect, useRef, useState } from 'react'
import { FileText, Folder, FolderPlus, FilePlus2, MoreHorizontal, Plus, Search, PanelLeftClose } from 'lucide-react'
import type { PaperFile } from './paper-api'

export type ManageRequest = { path?: string; kind?: 'text' | 'folder' }

export function PaperExplorer({ files, selected, mainFile, editable, disabled, choose, manage, close, revealToken }: {
  files: PaperFile[]; selected?: string; mainFile: string; editable: boolean; disabled: boolean;
  choose: (file: PaperFile) => void; manage: (request?: ManageRequest) => void; close: () => void
  revealToken: number
}) {
  const [filter, setFilter] = useState({ text: '', generation: revealToken })
  const query = filter.generation === revealToken ? filter.text : ''
  const setQuery = (text: string) => setFilter({ text, generation: revealToken })
  const [context, setContext] = useState<string | null>(null)
  const treeRoot = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!revealToken) return
    const node = treeRoot.current?.querySelector<HTMLElement>('[aria-current=true]')
    if (!node) return
    let parent = node.parentElement
    while (parent && parent !== treeRoot.current) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement }
    node.scrollIntoView({ block: 'nearest' }); node.focus()
  }, [revealToken])
  const visible = files.filter(file => file.path.toLowerCase().includes(query.toLowerCase()))
  function tree(prefix = '') {
    const folders = [...new Set(visible.filter(file => file.path.startsWith(prefix) && (file.kind === 'folder' || file.path.slice(prefix.length).includes('/')))
      .map(file => file.path.slice(prefix.length).split('/')[0]))].sort()
    return <ul className="paper-tree">
      {folders.map(folder => <li key={folder}><details open><summary><Folder size={15} />{folder}{editable && <button className="paper-folder-more" disabled={disabled} aria-label={`Manage folder ${prefix}${folder}`} title="Rename, move or delete folder" onClick={event => { event.preventDefault(); event.stopPropagation(); manage({ path: `${prefix}${folder}` }) }}><MoreHorizontal size={14} /></button>}</summary>{tree(`${prefix}${folder}/`)}</details></li>)}
      {visible.filter(file => file.kind !== 'folder' && file.path.startsWith(prefix) && !file.path.slice(prefix.length).includes('/')).map(file => <li key={file.id}>
        <div className={`paper-tree-row${selected === file.id ? ' selected' : ''}`} onKeyDown={event => { if (event.key === 'F2' && editable && !disabled) { event.preventDefault(); manage({ path: file.path }) } }} onContextMenu={event => { event.preventDefault(); setContext(file.path) }}>
          <button className="paper-file-choice" aria-current={selected === file.id ? 'true' : undefined} title={file.path} onClick={() => choose(file)}><FileText size={15} /><span>{file.path.slice(prefix.length)}</span>{file.path === mainFile && <span className="main-marker" title="Compilation entry point">main</span>}</button>
          {editable && <button className="paper-file-more" aria-label={`Actions for ${file.path}`} aria-expanded={context === file.path} onClick={() => setContext(context === file.path ? null : file.path)}><MoreHorizontal size={15} /></button>}
        </div>
        {context === file.path && <div className="paper-file-context" onKeyDown={event => { if (event.key === 'Escape') setContext(null) }}>
          <strong>{file.path}</strong>
          <button onClick={() => { choose(file); setContext(null) }}>Open file</button>
          {editable && <button disabled={disabled} onClick={() => { manage({ path: file.path }); setContext(null) }}>Manage this file...</button>}
          <button onClick={() => setContext(null)}>Dismiss</button>
        </div>}
      </li>)}
    </ul>
  }
  return <>
    <div className="paper-pane-title"><button className="tool-button" aria-label="Collapse explorer" title="Collapse explorer" aria-expanded={true} aria-controls="paper-file-sidebar" onClick={close}><PanelLeftClose size={17} /></button><strong>Explorer</strong>{editable && <details className="paper-popover paper-add"><summary title="Add or organize files" aria-label="Add or organize files"><Plus size={17} /></summary><div>
      <button disabled={disabled} onClick={() => manage({ kind: 'text' })}><FilePlus2 size={15} /> New source file</button>
      <button disabled={disabled} onClick={() => manage({ kind: 'folder' })}><FolderPlus size={15} /> New folder</button>
      <button disabled={disabled} onClick={() => manage()}>Upload or manage files</button>
    </div></details>}</div>
    <label className="paper-file-filter"><Search size={15} /><span className="sr-only">Filter paper files</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a file..." type="search" /></label>
    <div ref={treeRoot} className="paper-tree-scroll">{visible.length ? tree() : <p className="muted">No matching files.</p>}</div>
    {disabled && editable && <p className="paper-explorer-hint">Finish saving and review drafts before organizing files.</p>}
  </>
}
