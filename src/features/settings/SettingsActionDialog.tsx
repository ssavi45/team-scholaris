import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { MAX_OWNED_PROJECTS } from '../../lib/constants'
import { applySettings, SettingsError } from './settings-api'
import type { SettingsMember, SettingsRequest } from './settings-types'

export type SettingsDialogAction = 'archive' | 'unarchive' | 'transfer' | 'trash' | 'restore'
const labels: Record<SettingsDialogAction, string> = {
  archive: 'Archive project', unarchive: 'Unarchive project', transfer: 'Transfer ownership',
  trash: 'Move to Trash', restore: 'Restore project',
}
const descriptions: Record<SettingsDialogAction, string> = {
  archive: 'Your paper, files, discussions, tasks and meetings stay readable. Editing and invitations stop until you unarchive. This project still counts toward your ownership limit.',
  unarchive: 'Editing and invitations will become available to the team again. Review the Team tab first if access should change.',
  transfer: 'The selected member becomes the owner immediately. You remain a member, keep your contributions, and give up management access. Pending invitations will be revoked.',
  trash: 'This project will disappear from everyone’s workspace. Its research and membership are retained, and pending invitations are revoked. You can restore it from Dashboard Trash within 30 days. Existing downloaded copies or temporary links cannot be recalled.',
  restore: 'The project returns archived and read-only. Retained teammates regain read access to its research. Review the team before unarchiving. Revoked invitations remain revoked.',
}

export function SettingsActionDialog({ kind, project, members = [], hasGoogleMeetings = false, close, saved, onBusy }: {
  kind: SettingsDialogAction
  project: { id: string; name: string; settings_revision: number }
  members?: SettingsMember[]
  hasGoogleMeetings?: boolean
  close: () => void
  saved: () => void
  onBusy: (busy: boolean) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const inFlight = useRef(false)
  const pending = useRef<SettingsRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [error, setError] = useState('')
  const [recipient, setRecipient] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const eligible = members.filter((person) => person.eligible_owner)
  const typedConfirmation = kind === 'transfer' || kind === 'trash'

  useEffect(() => {
    const node = dialog.current!
    const previous = document.activeElement
    node.showModal()
    return () => { node.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus() }
  }, [])

  function dismiss() {
    if (inFlight.current) return
    if ((uncertain || confirmation || recipient || acknowledged) && !window.confirm(uncertain
      ? 'The result is still unconfirmed. Close and refresh the project before making another change?'
      : 'Discard this confirmation and close?')) return
    close()
  }

  async function submit() {
    if (inFlight.current) return
    if (!pending.current) {
      if (typedConfirmation && confirmation !== project.name) { setError('Type the project name exactly to confirm.'); return }
      if ((kind === 'transfer' || kind === 'restore') && !acknowledged) { setError('Please acknowledge the access change.'); return }
      if (kind === 'transfer' && !eligible.some((person) => person.user_id === recipient)) { setError('Choose an eligible member.'); return }
      pending.current = { projectId: project.id, revision: project.settings_revision, operationId: crypto.randomUUID(),
        action: kind === 'archive' || kind === 'unarchive' ? { kind: 'archive', archived: kind === 'archive' }
          : kind === 'transfer' ? { kind: 'transfer', recipientId: recipient } : { kind } }
    }
    inFlight.current = true; setBusy(true); onBusy(true); setError('')
    try {
      await applySettings(pending.current)
      pending.current = null
      saved()
    } catch (cause) {
      const retryable = cause instanceof SettingsError && cause.retryable
      setUncertain(retryable)
      if (!retryable) pending.current = null
      setError(cause instanceof Error ? cause.message : 'Unable to update this project.')
    } finally { inFlight.current = false; setBusy(false); onBusy(false) }
  }

  return <dialog ref={dialog} className="project-dialog settings-dialog" aria-labelledby="settings-action-title" aria-describedby="settings-action-description" onCancel={(event) => { event.preventDefault(); dismiss() }}>
    <div className="settings-dialog-heading"><div><p className="eyebrow">PROJECT SETTINGS</p><h2 id="settings-action-title">{labels[kind]}?</h2></div><button type="button" className="meeting-close" aria-label="Close confirmation" autoFocus disabled={busy} onClick={dismiss}><X size={18} /></button></div>
    <p className="settings-confirm-project">{project.name}</p>
    <p id="settings-action-description" className="muted">{descriptions[kind]}</p>
    {hasGoogleMeetings && <p className="notice">Linked Google Calendar events and Meet calls are not changed by this action. The original organizer must manage those separately.</p>}
    <form onSubmit={(event) => { event.preventDefault(); void submit() }} aria-busy={busy}>
      <fieldset className="settings-fields" disabled={busy || uncertain}>
        {kind === 'transfer' && <>
          <label>New owner<select required value={recipient} onChange={(event) => setRecipient(event.target.value)}><option value="">Choose a verified member</option>{eligible.map((person) => <option value={person.user_id} key={person.user_id}>{person.name}</option>)}</select></label>
          <p className="form-note">The recipient must have fewer than {MAX_OWNED_PROJECTS} owned projects, including archived projects. Viewers must first be promoted in Team.</p>
          {!eligible.length && <p className="notice">No eligible members. Invite a teammate or update their access in Team first.</p>}
        </>}
        {typedConfirmation && <label>Type the project name to confirm<input required autoComplete="off" spellCheck={false} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>}
        {(kind === 'transfer' || kind === 'restore') && <label className="settings-acknowledgement"><input type="checkbox" required checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span>{kind === 'transfer' ? 'I understand that ownership moves immediately and I will become a member.' : 'I understand that retained teammates regain read access after restoration.'}</span></label>}
      </fieldset>
      {error && <p className="notice error-notice" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={dismiss}>Cancel</button><button className={`button ${kind === 'trash' || kind === 'transfer' ? 'team-danger-button' : 'primary'}`} disabled={busy || (!uncertain && ((typedConfirmation && confirmation !== project.name) || (kind === 'transfer' && !recipient) || ((kind === 'transfer' || kind === 'restore') && !acknowledged)))}>{busy ? 'Confirming…' : uncertain ? 'Retry same request' : labels[kind]}</button></div>
    </form>
  </dialog>
}
