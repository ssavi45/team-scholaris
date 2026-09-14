import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { AuthLayout } from './AuthLayout'
import { environment } from '../../lib/env'
import { supabase } from '../../lib/supabase'
import { useAuth } from './auth-context'
import { authContext, callbackUrl, postAuthDestination } from './auth-navigation'

type Mode = 'login' | 'register' | 'reset'
const copy = {
  login: { title: 'Sign in to your account', description: 'Welcome back to Team Scholaris.', action: 'Sign in' },
  register: { title: 'Create your account', description: 'Start your research together.', action: 'Create account' },
  reset: { title: 'Reset your password', description: 'We will email you a link to choose a new password.', action: 'Send reset link' },
}

export function AuthPage({ mode }: { mode: Mode }) {
  const [params] = useSearchParams()
  const { user, loading, error: sessionError } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [destination, setDestination] = useState<string | null>(null)
  const [verificationEmail, setVerificationEmail] = useState('')
  const content = copy[mode]
  const query = '?' + authContext(params).toString()
  const disabled = busy || !supabase || loading
  const googleEnabled = import.meta.env.VITE_GOOGLE_AUTH_ENABLED === 'true'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || busy) return
    const values = new FormData(event.currentTarget)
    const email = String(values.get('email') ?? '').trim()
    const password = String(values.get('password') ?? '')
    const name = String(values.get('name') ?? '').trim()
    setError(''); setMessage('')
    if (mode === 'register' && !name) { setError('Enter your name.'); return }
    if (mode === 'register' && password !== values.get('confirmPassword')) {
      setError('Passwords do not match.'); return
    }
    setBusy(true)
    try {
      if (mode === 'login') {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) {
          if (error.code === 'email_not_confirmed') setVerificationEmail(email)
          throw error
        }
        if (!data.user.email_confirmed_at) throw new Error('Verify your email before signing in.')
        setDestination(postAuthDestination(params))
      } else if (mode === 'register') {
        const { error } = await supabase.auth.signUp({
          email, password, options: { data: { name }, emailRedirectTo: callbackUrl(params) },
        })
        if (error) throw error
        setVerificationEmail(email)
        setMessage('Check your email for a verification link. If you already have an account, sign in or reset your password.')
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: callbackUrl(params, true) })
        if (error) throw error
        setMessage('If an account exists for this email, a password reset link has been sent.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to complete this request. Please try again.')
    } finally { setBusy(false) }
  }

  async function googleSignIn() {
    if (!supabase || busy) return
    setBusy(true); setError('')
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google', options: { redirectTo: callbackUrl(params) },
      })
      if (error) throw error
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Google sign-in could not start.')
    } finally { setBusy(false) }
  }

  async function resendVerification() {
    if (!supabase || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup', email: verificationEmail, options: { emailRedirectTo: callbackUrl(params) },
      })
      if (error) throw error
      setMessage('If verification is pending, a new link has been sent. Check your email.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to resend verification.')
    } finally { setBusy(false) }
  }

  if (destination) return <Navigate to={destination} replace />
  // Keep explicit navigation in an effect/event-free render; context is carried in the URL.
  if (user?.email_confirmed_at && mode === 'login') {
    const context = authContext(params)
    const target = new URL(context.get('next') ?? '/app', window.location.origin)
    if (context.has('invite')) target.searchParams.set('invite', context.get('invite')!)
    return <Navigate to={target.pathname + target.search} replace />
  }
  return <AuthLayout title={content.title} description={content.description}>
    {!supabase && <div className="notice" role="status"><strong>Authentication is not configured</strong><p>{environment.message}</p></div>}
    {(error || sessionError) && <p className="notice error-notice" role="alert">{error || sessionError}</p>}
    {message && <p className="notice" role="status">{message}</p>}
    {mode !== 'reset' && <>
      <button className="button secondary" type="button" disabled={disabled || !googleEnabled} onClick={() => void googleSignIn()}>Continue with Google</button>
      {!googleEnabled && <p className="form-note">Google sign-in is not configured for this environment yet.</p>}
      <div className="divider"><span>or</span></div>
    </>}
    <form onSubmit={(event) => void submit(event)} aria-busy={busy}>
      {mode === 'register' && <label>Name<input name="name" autoComplete="name" maxLength={120} required disabled={disabled} /></label>}
      <label>Email<input name="email" type="email" autoComplete="email" placeholder="you@university.edu" required disabled={disabled} /></label>
      {mode !== 'reset' && <label>Password<input name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} minLength={mode === 'register' ? 8 : undefined} required disabled={disabled} /></label>}
      {mode === 'register' && <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required disabled={disabled} /></label>}
      {mode === 'login' && <Link className="forgot-link" to={'/forgot-password' + query}>Forgot password?</Link>}
      {mode === 'register' && <p className="form-note">Use at least 8 characters. You will need to verify your email.</p>}
      <button className="button primary" type="submit" disabled={disabled}>{busy ? 'Please wait...' : content.action}</button>
    </form>
    {verificationEmail && <button className="button secondary resend-button" disabled={disabled} onClick={() => void resendVerification()}>Resend verification email</button>}
    <p className="switch-auth">
      {mode === 'login'
        ? <>Need an account? <Link to={'/register' + query}>Create account</Link></>
        : <>{mode === 'register' ? 'Already have an account? ' : ''}<Link to={'/login' + query}>Back to sign in</Link></>}
    </p>
  </AuthLayout>
}
