import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { createProject } from './projects-api'

export function CreateProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const submitting = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => { element?.close() }
  }, [])
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    const form = new FormData(event.currentTarget)
    const name = String(form.get('name') ?? '').trim()
    if (!name) { setError('Enter a project name.'); return }
    submitting.current = true; setBusy(true); setError('')
    try {
      const project = await createProject(name, String(form.get('description') ?? '').trim())
      onCreated(project.id)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create project.') }
    finally { submitting.current = false; setBusy(false) }
  }
  return <dialog ref={dialog} className="project-dialog" aria-labelledby="create-title" onCancel={(event) => { if (busy) event.preventDefault(); else onClose() }}>
    <h2 id="create-title">New research project</h2>
    <p className="muted">A private workspace for your research. You will be its owner.</p>
    {error && <p className="notice error-notice" role="alert">{error}</p>}
    <form onSubmit={(event) => void submit(event)} aria-busy={busy}>
      <label>Project name<input name="name" maxLength={120} required autoFocus disabled={busy} placeholder="e.g. Plant disease detection" /></label>
      <label>Description <span className="muted">Optional</span><textarea name="description" maxLength={5000} rows={4} disabled={busy} placeholder="What are you researching?" /></label>
      <div className="dialog-actions">
        <button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="button primary" disabled={busy}>{busy ? 'Creating...' : 'Create project'}</button>
      </div>
    </form>
  </dialog>
}
