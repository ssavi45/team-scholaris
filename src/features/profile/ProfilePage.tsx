import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { ArrowLeft, Check, ImagePlus, Save, ShieldCheck, UserRound } from 'lucide-react'
import { useAuth } from '../auth/auth-context'
import { useSettingsGuard } from '../settings/useSettingsGuard'
import { useProfile } from './profile-context'
import { cleanupUnusedAvatars, loadAccountProfile, prepareAvatar, removeUnusedAvatar, saveAccountProfile, uploadAvatar } from './profile-api'
import { profileDraft, type AccountProfile, type ProfileDraft } from './profile-types'
import { ProfileAvatar } from './ProfileAvatar'
import { AVATAR_PRESETS } from './avatar-presets'
import './profile.css'

export function ProfilePage() {
  const { profile, loading, error, refresh } = useProfile()
  return <div className="profile-page">
    <Link to="/app" className="back-link"><ArrowLeft size={14} aria-hidden="true" /> Back to dashboard</Link>
    <div className="profile-page-heading"><p className="eyebrow">MAKE YOURSELF AT HOME</p><h1>Your profile</h1><p className="muted">A familiar face for your research workspace.</p></div>
    {loading && <p role="status" className="notice">Loading your profile...</p>}
    {error && <div className="notice error-notice" role="alert"><p>{error}</p><button className="button secondary compact-button" onClick={() => void refresh()}>Try again</button></div>}
    {profile && <ProfileForm key={profile.id} initial={profile} />}
  </div>
}

function ProfileForm({ initial }: { initial: AccountProfile }) {
  const { user } = useAuth()
  const { imageUrl, publish } = useProfile()
  const [saved, setSaved] = useState(initial)
  const [draft, setDraft] = useState(() => profileDraft(initial))
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const uploadedPath = useRef<string | null>(null)
  const previewUrl = useRef<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const dirty = !!photo || JSON.stringify(draft) !== JSON.stringify(profileDraft(saved))
  useSettingsGuard(dirty, busy, 'profile')
  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current) }, [])
  function showPreview(blob: Blob | null) {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    previewUrl.current = blob ? URL.createObjectURL(blob) : null
    setPreview(previewUrl.current)
  }
  function update<K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) {
    setDraft(current => ({ ...current, [key]: value })); setSuccess('')
  }
  async function selectPhoto(file: File | undefined) {
    if (!file || busy) return
    setBusy(true); setError(''); setSuccess('')
    try {
      const prepared = await prepareAvatar(file)
      setPhoto(prepared); showPreview(prepared); uploadedPath.current = null
      update('avatar_path', null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to open this photo.') }
    finally { setBusy(false); if (input.current) input.current.value = '' }
  }
  function choosePreset(index: number) {
    setPhoto(null); showPreview(null); uploadedPath.current = null
    setDraft(current => ({ ...current, avatar_preset: index, avatar_path: null })); setSuccess('')
  }
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!user || busy || !dirty) return
    const username = draft.username.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9_]{2,29}$/.test(username)) { setError('Use 3–30 letters, numbers or underscores; start with a letter or number.'); return }
    if (!draft.name.trim()) { setError('Enter your display name.'); return }
    setBusy(true); setError(''); setSuccess('')
    try {
      let path = draft.avatar_path
      if (photo) {
        uploadedPath.current ??= await uploadAvatar(user.id, photo)
        path = uploadedPath.current
      }
      const result = await saveAccountProfile({ ...draft, username, avatar_path: path }, saved.updated_at)
      const previous = saved.avatar_path
      setSaved(result); setDraft(profileDraft(result)); setPhoto(null); showPreview(null); uploadedPath.current = null
      await publish(result)
      setSuccess('Profile saved. Your account badge is up to date.')
      if (previous && previous !== result.avatar_path) void removeUnusedAvatar(previous).catch(() => {})
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save. Your changes are still here; retry or reload the saved profile.')
    } finally { setBusy(false) }
  }
  async function reloadSaved() {
    if (!user || busy || (dirty && !window.confirm('Discard your changes and reload the saved profile?'))) return
    setBusy(true); setError(''); setSuccess('')
    try {
      const latest = await loadAccountProfile(user.id)
      setSaved(latest); setDraft(profileDraft(latest)); setPhoto(null); showPreview(null); uploadedPath.current = null
      await publish(latest)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to reload.') }
    finally { setBusy(false) }
  }
  async function cleanPhotos() {
    if (!user || busy || !window.confirm('Remove uploaded photos that are not currently saved to your profile? Unsaved uploads in other tabs may need to be uploaded again.')) return
    setBusy(true); setError(''); setSuccess('')
    try { await cleanupUnusedAvatars(user.id); uploadedPath.current = null; setSuccess('Unused uploaded photos removed. Your saved avatar is unchanged.') }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to clean up photos.') }
    finally { setBusy(false) }
  }
  const displayedImage = photo ? preview : draft.avatar_path ? imageUrl : null
  const badgeText = draft.badge_display === 'email' ? user?.email : draft.username || 'your_username'
  return <form className="profile-layout" onSubmit={(event) => void submit(event)} aria-busy={busy}>
    <div className="profile-main">
      {error && <p className="notice error-notice" role="alert">{error}</p>}
      {success && <p className="notice" role="status">{success}</p>}
      <section className="profile-card" aria-labelledby="profile-details-title">
        <div className="profile-section-heading"><UserRound size={20} aria-hidden="true" /><div><h2 id="profile-details-title">The person behind the work</h2><p>Your display name identifies you in team and chat views.</p></div></div>
        <fieldset disabled={busy} className="profile-fields">
          <label>Display name<input value={draft.name} onChange={event => update('name', event.target.value)} required maxLength={120} autoComplete="name" /></label>
          <label>Username<input value={draft.username} onChange={event => update('username', event.target.value.toLowerCase())} required minLength={3} maxLength={30} pattern="[a-z0-9][a-z0-9_]{2,29}" autoComplete="username" autoCapitalize="none" spellCheck={false} aria-describedby="username-help" /></label>
          <p id="username-help" className="profile-help">Unique to you. Use 3–30 letters, numbers or underscores. Changing it does not change your sign-in email.</p>
          <label>University or affiliation <span className="profile-optional">Optional</span><input value={draft.affiliation} onChange={event => update('affiliation', event.target.value)} maxLength={120} autoComplete="organization" placeholder="e.g. Department of Computer Science" /></label>
          <label>Bio <span className="profile-optional">Optional</span><textarea value={draft.bio} onChange={event => update('bio', event.target.value)} maxLength={300} rows={3} placeholder="Your research interests, in a sentence or two." /></label>
          <p className="profile-help">{draft.bio.length} / 300 · Bio and affiliation are saved to your private account profile.</p>
        </fieldset>
      </section>
      <section className="profile-card" aria-labelledby="profile-avatar-title">
        <div className="profile-section-heading"><ImagePlus size={20} aria-hidden="true" /><div><h2 id="profile-avatar-title">Choose your look</h2><p>Pick an illustrated companion, or use a photo of your own.</p></div></div>
        <fieldset disabled={busy} className="profile-avatar-options"><legend className="sr-only">Profile artwork</legend>
          {AVATAR_PRESETS.map((name, index) => <button type="button" key={name} className="profile-avatar-choice" aria-label={name} title={name} aria-pressed={!photo && !draft.avatar_path && draft.avatar_preset === index + 1} onClick={() => choosePreset(index + 1)}>
            <ProfileAvatar preset={index + 1} size={64} /><span>{name}</span>
            {!photo && !draft.avatar_path && draft.avatar_preset === index + 1 && <Check className="profile-choice-check" size={16} aria-hidden="true" />}
          </button>)}
        </fieldset>
        <div className="profile-upload-actions">
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="profile-file-input" tabIndex={-1} aria-label="Upload a profile photo" disabled={busy} onChange={event => void selectPhoto(event.target.files?.[0])} />
          <button className="button secondary compact-button" type="button" disabled={busy} onClick={() => input.current?.click()}><ImagePlus size={16} />Upload photo</button>
          {(photo || draft.avatar_path) && <button className="button secondary compact-button" type="button" disabled={busy} onClick={() => choosePreset(draft.avatar_preset)}>Remove photo</button>}
        </div>
        <p className="profile-help">JPEG, PNG or WebP · Up to 5 MB. Photos are center-cropped to a square and resized to 512 px; embedded metadata is removed. Review the preview before saving.</p>
        <button type="button" className="profile-text-action" disabled={busy} onClick={() => void cleanPhotos()}>Clean up unused photos</button>
      </section>
      <section className="profile-card" aria-labelledby="badge-preference-title">
        <h2 id="badge-preference-title">Your account badge</h2><p className="profile-help">Choose what appears beside your avatar in the navbar. This does not change your name in team discussions.</p>
        <fieldset className="profile-badge-options" disabled={busy}><legend className="sr-only">Account badge label</legend>
          <label><input type="radio" name="badge-display" value="username" checked={draft.badge_display === 'username'} onChange={() => update('badge_display', 'username')} />Username</label>
          <label><input type="radio" name="badge-display" value="email" checked={draft.badge_display === 'email'} onChange={() => update('badge_display', 'email')} />Email address</label>
        </fieldset>
      </section>
      <div className="profile-save-bar"><p role="status">{busy ? 'Working...' : dirty ? 'You have unsaved changes.' : 'All changes saved.'}</p><div>
        <button type="button" className="button secondary compact-button" disabled={busy} onClick={() => void reloadSaved()}>Reload saved</button>
        <button type="submit" className="button primary compact-button" disabled={busy || !dirty}><Save size={16} />{busy ? 'Please wait...' : 'Save changes'}</button>
      </div></div>
    </div>
    <aside className="profile-sidebar">
      <section className="profile-card profile-preview"><p className="eyebrow">LIVE PREVIEW</p><ProfileAvatar preset={draft.avatar_preset} imageUrl={displayedImage} size={104} /><h2>{draft.name.trim() || 'Your name'}</h2><p>@{draft.username || 'your_username'}</p>
        <div className="profile-badge-preview"><ProfileAvatar preset={draft.avatar_preset} imageUrl={displayedImage} /><span><small>Your workspace</small><strong>{badgeText}</strong></span></div>
        <p className="profile-help">Your avatar and badge preference follow your account across devices.</p>
      </section>
      <section className="profile-card profile-account-info"><ShieldCheck size={22} aria-hidden="true" /><h2>Account details</h2><dl><dt>Sign-in email</dt><dd>{user?.email}</dd><dt>Email status</dt><dd>{user?.email_confirmed_at ? 'Verified' : 'Not verified'}</dd><dt>Member since</dt><dd>{new Date(saved.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</dd></dl><Link to="/reset-password">Change password</Link><p className="profile-help">Email remains your sign-in address. Your saved avatar is visible to current project teammates; other profile details remain private.</p></section>
    </aside>
  </form>
}
