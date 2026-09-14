import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AuthLayout } from './AuthLayout'
import { supabase } from '../../lib/supabase'
import { authContext } from './auth-navigation'

export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || busy) return
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password'))
    setError('')
    if (password !== form.get('confirmPassword')) { setError('Passwords do not match.'); return }
    setBusy(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setDone(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to update your password.') }
    finally { setBusy(false) }
  }
  return <AuthLayout title="Choose a new password" description="Use at least 8 characters.">
    {error && <p className="notice error-notice" role="alert">{error}</p>}
    {done ? <p role="status">Password updated. <Link to={'/login?' + authContext(params)}>Continue to your workspace</Link></p> :
      <form onSubmit={(event) => void submit(event)} aria-busy={busy}>
        <label>New password<input name="password" type="password" autoComplete="new-password" minLength={8} required disabled={busy} /></label>
        <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required disabled={busy} /></label>
        <button className="button primary" disabled={busy}>{busy ? 'Updating...' : 'Update password'}</button>
      </form>}
  </AuthLayout>
}
