import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ListTree } from 'lucide-react'
import { nestOutline, type buildOutline, type OutlineNode, type SourceLocation } from './editor-tools'

export function PaperOutline({ outline, mainFile, selectedFileId, expanded, toggle, navigate }: {
  outline: ReturnType<typeof buildOutline>; mainFile: string; selectedFileId?: string;
  expanded: boolean; toggle: () => void; navigate: (location: SourceLocation) => void;
}) {
  const nodes = useMemo(() => nestOutline(outline.headings), [outline.headings])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [active, setActive] = useState('')
  function branch(items: OutlineNode[]) {
    return <ul className="paper-outline-tree">{items.map(node => {
      const open = !collapsed.has(node.id)
      return <li key={node.id}>
        <div className={`paper-outline-row${active === node.id && selectedFileId === node.fileId ? ' selected' : ''}`}>
          {node.children.length ? <button className="paper-outline-chevron" aria-label={`${open ? 'Collapse' : 'Expand'} ${node.title}`} aria-expanded={open} onClick={() => setCollapsed(prior => { const next = new Set(prior); if (open) next.add(node.id); else next.delete(node.id); return next })}><ChevronRight size={14} className={open ? 'is-open' : ''} aria-hidden="true" /></button> : <span className="paper-outline-chevron-spacer" />}
          <button className="paper-outline-link" aria-current={active === node.id && selectedFileId === node.fileId ? 'location' : undefined} title={`${node.title} — ${node.path}:${node.line}`} onClick={() => { setActive(node.id); navigate(node) }}>{node.title || 'Untitled heading'}</button>
        </div>
        {!!node.children.length && open && branch(node.children)}
      </li>
    })}</ul>
  }
  return <section className={`paper-outline${expanded ? '' : ' is-collapsed'}`} aria-label="Document outline">
    <button className="paper-outline-heading" onClick={toggle} aria-expanded={expanded} aria-controls="paper-outline-content"><ChevronDown size={15} className={expanded ? '' : 'is-closed'} aria-hidden="true" /><ListTree size={15} aria-hidden="true" /><strong>File outline</strong><span>{outline.headings.length}</span></button>
    <div className="paper-outline-content" id="paper-outline-content" hidden={!expanded}>
      {nodes.length ? branch(nodes) : <p className="paper-outline-empty">Add a section to your paper to see its outline here.</p>}
      {!!outline.unresolved.length && <p className="paper-outline-warning">Some included files could not be found: {outline.unresolved.join(', ')}</p>}
      <details className="paper-outline-help"><summary>About this outline</summary><p>From {mainFile}, including linked source files and local edits. Only literal LaTeX headings are shown; macros and conditional commands are not evaluated.</p></details>
    </div>
  </section>
}
