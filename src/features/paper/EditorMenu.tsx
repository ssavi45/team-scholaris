import { useEffect, useRef, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

/** Native disclosure with predictable keyboard and outside-click dismissal. */
export function EditorMenu({ label, icon, children, settings = false }: {
  label: string; icon?: ReactNode; children: ReactNode; settings?: boolean;
}) {
  const root = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target) && root.current) root.current.open = false
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [])
  return <details ref={root} className={`editor-menu${settings ? ' editor-menu-settings' : ''}`} onToggle={event => {
    const menu = event.currentTarget
    if (menu.open) menu.closest('.editor-toolbar')?.querySelectorAll<HTMLDetailsElement>('details.editor-menu').forEach(other => {
      if (other !== menu) other.open = false
    })
  }} onKeyDown={event => {
    if (event.key === 'Escape' && root.current?.open) { event.preventDefault(); event.stopPropagation(); root.current.open = false; root.current.querySelector('summary')?.focus() }
  }} onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false }}>
    <summary>{icon}<span>{label}</span><ChevronDown size={12} aria-hidden="true" /></summary>
    <div className="editor-menu-content" onClick={event => {
      if (!settings && event.target instanceof Element && event.target.closest('button:not(:disabled)') && root.current) {
        const menu = root.current
        const focusInside = menu.contains(document.activeElement)
        menu.open = false
        if (focusInside) menu.querySelector('summary')?.focus()
      }
    }}>{children}</div>
  </details>
}
