import { useEffect, useRef } from 'react'
import { ChevronDown, ChevronRight, FileCode2, RotateCcw, ListChecks } from 'lucide-react'
import './compiler-menu.css'

export function CompilerMenu({ mainFile, changeDisabledReason, restartDisabled, changeMain, restart, showReport }: {
  mainFile: string; changeDisabledReason: string; restartDisabled: boolean;
  changeMain: () => void; restart: () => void; showReport: () => void;
}) {
  const root = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (root.current && event.target instanceof Node && !root.current.contains(event.target)) root.current.open = false
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [])
  function run(action: () => void) {
    if (root.current) { root.current.open = false; root.current.querySelector('summary')?.focus() }
    action()
  }
  return <details ref={root} className="paper-popover compiler-menu" onKeyDown={event => {
    if (event.key === 'Escape' && root.current?.open) { event.preventDefault(); event.stopPropagation(); root.current.open = false; root.current.querySelector('summary')?.focus() }
  }} onBlur={event => { if (root.current && event.relatedTarget instanceof Node && !root.current.contains(event.relatedTarget)) root.current.open = false }}>
    <summary aria-label="Compilation options" title="Compilation options"><ChevronDown size={16} /></summary>
    <div>
      <header className="compiler-menu-info"><strong>Compilation options</strong><dl><div><dt>Compiler</dt><dd>pdfLaTeX + BibTeX</dd></div><div><dt>Main file</dt><dd>{mainFile}</dd></div></dl></header>
      <div className="compiler-menu-actions">
        <button type="button" disabled={!!changeDisabledReason} title={changeDisabledReason || 'Choose the file that starts your paper'} onClick={() => run(changeMain)}><FileCode2 size={18} /><span><strong>Choose main file</strong><small>{changeDisabledReason || 'Set the starting file for your PDF.'}</small></span><ChevronRight size={15} /></button>
        <button type="button" disabled={restartDisabled} onClick={() => run(restart)}><RotateCcw size={18} /><span><strong>Restart &amp; recompile</strong><small>{restartDisabled ? 'Wait for the current operation to finish.' : 'Restart the compiler and build your PDF again.'}</small></span><ChevronRight size={15} /></button>
        <button type="button" onClick={() => run(showReport)}><ListChecks size={18} /><span><strong>View compilation report</strong><small>Review warnings, errors and the full log.</small></span><ChevronRight size={15} /></button>
      </div>
      <details className="compiler-menu-help"><summary>About this compiler <ChevronDown size={13} /></summary><p>Supports PNG/JPEG images and available TeX packages. XeLaTeX, LuaLaTeX, Biber and system fonts are not supported.</p><p>Regular recompiles reuse downloaded packages and unchanged figures. Restart if a build seems stuck or incorrect.</p></details>
    </div>
  </details>
}
