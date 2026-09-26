import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ArchiveRestore, RefreshCw, Trash2 } from 'lucide-react'
import { loadTrash } from './settings-api'
import { SettingsActionDialog } from './SettingsActionDialog'
import type { TrashCursor, TrashProject } from './settings-types'
import { useSettingsGuard } from './useSettingsGuard'

export function ProjectTrash() {
  const [state, setState] = useState<{ rows: TrashProject[]; loading: boolean; error: string }>({ rows: [], loading: true, error: '' })
  const [cursor, setCursor] = useState<TrashCursor | null>(null)
  const [previous, setPrevious] = useState<(TrashCursor | null)[]>([])
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<TrashProject | null>(null)
  const [busy, setBusy] = useState(false)
  const [restored, setRestored] = useState<{ id: string; name: string } | null>(null)
  useSettingsGuard(!!selected, busy)

  useEffect(() => {
    const controller = new AbortController()
    void loadTrash(cursor, controller.signal).then((rows) => {
      if (!controller.signal.aborted) setState({ rows, loading: false, error: '' })
    }).catch((cause) => {
      if (!controller.signal.aborted) setState({ rows: [], loading: false, error: cause instanceof Error ? cause.message : 'Unable to load Trash.' })
    })
    return () => controller.abort()
  }, [cursor, attempt])

  useEffect(() => {
    const refresh = () => {
      if (selected || busy) return
      setState({ rows: [], loading: true, error: '' }); setCursor(null); setPrevious([]); setAttempt((value) => value + 1)
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('scholaris:projects-changed', refresh)
    return () => { window.removeEventListener('focus', refresh); window.removeEventListener('scholaris:projects-changed', refresh) }
  }, [selected, busy])

  function refresh() {
    setState({ rows: [], loading: true, error: '' }); setCursor(null); setPrevious([]); setAttempt((value) => value + 1)
  }
  const rows = state.rows.slice(0, 20)
  const hasOlder = state.rows.length > 20

  return <section aria-labelledby="trash-title" className="trash-workspace">
    <div className="settings-page-heading"><div><h2 id="trash-title">Project Trash</h2><p className="muted">A second chance for research you want to keep.</p></div><button className="button secondary compact-button" disabled={state.loading || !!selected || busy} onClick={refresh}><RefreshCw size={14} aria-hidden="true" /> Refresh</button></div>
    <p className="notice">Only you can see projects you own in Trash. Restore within 30 days to return the project archived, with its retained team and research. Expired recovery does not mean the retained data has been permanently erased.</p>
    {restored && <p className="notice" role="status">“{restored.name}” was restored in archived mode. <Link to={`/project/${restored.id}/settings`}>Review settings</Link> and <Link to={`/project/${restored.id}/team`}>team access</Link> before unarchiving.</p>}
    {state.loading ? <p className="empty-state" role="status">Loading Trash…</p> : state.error ? <div className="empty-state"><p role="alert">{state.error}</p><button className="button secondary compact-button" onClick={refresh}>Try again</button></div> : !rows.length ? <div className="empty-state trash-empty"><Trash2 size={30} aria-hidden="true" /><h3>{cursor ? 'No more projects here' : 'Your Trash is empty'}</h3><p>Projects you move to Trash will appear here for recovery.</p></div> : <ul className="trash-list">{rows.map((project) => <li className="settings-card trash-card" key={project.id}>
      <div className="trash-card-title"><span className="trash-project-icon"><ArchiveRestore size={21} aria-hidden="true" /></span><div><h3>{project.name}</h3><p className="form-note">Moved to Trash {new Date(project.deleted_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p></div></div>
      <div className="trash-card-actions"><div>{project.restore_blocked_reason === 'expired' ? <><strong>Recovery window expired</strong><p className="form-note">Self-service restoration is no longer available.</p></> : <><strong>Recover by {new Date(project.recover_until).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</strong>{project.restore_blocked_reason === 'quota' && <p className="settings-field-error">Your ownership limit is full. Free a project slot, then refresh. Archiving does not free a slot.</p>}</>}</div><button className="button secondary compact-button" disabled={!project.can_restore || busy || !!selected} onClick={() => setSelected(project)}><ArchiveRestore size={15} aria-hidden="true" /> Restore</button></div>
    </li>)}</ul>}
    {(previous.length > 0 || hasOlder) && <nav className="trash-pagination" aria-label="Trash pages"><button className="button secondary compact-button" disabled={state.loading || !!selected || !previous.length} onClick={() => { setState({ rows: [], loading: true, error: '' }); setCursor(previous[previous.length - 1]); setPrevious((values) => values.slice(0, -1)) }}>Newer</button><span className="form-note">Page {previous.length + 1}</span><button className="button secondary compact-button" disabled={state.loading || !!selected || !hasOlder} onClick={() => { const last = rows[rows.length - 1]; setPrevious((values) => [...values, cursor]); setCursor({ id: last.id, deleted_at: last.deleted_at }); setState({ rows: [], loading: true, error: '' }) }}>Older</button></nav>}
    {selected && <SettingsActionDialog kind="restore" project={selected} close={() => setSelected(null)} onBusy={setBusy} saved={() => { setRestored({ id: selected.id, name: selected.name }); setSelected(null); refresh() }} />}
  </section>
}
