import { Link, useSearchParams } from 'react-router'
import { AuthLayout } from './AuthLayout'
import { environment } from '../../lib/env'

type Mode = 'login' | 'register' | 'reset'
const copy = {
  login: { title: 'Sign in to your account', description: 'Welcome back to Team Scholaris.', action: 'Sign in' },
  register: { title: 'Create your account', description: 'Start your research together.', action: 'Create account' },
  reset: { title: 'Reset your password', description: 'Use the email address associated with your account.', action: 'Send reset link' },
}

export function AuthPage({ mode }: { mode: Mode }) {
  const [params] = useSearchParams()
  // Preserve context without trusting it. Validate redirects and invitation tokens
  // during backend integration, before ever acting on these parameters.
  const query = params.toString() ? `?${params.toString()}` : ''
  const content = copy[mode]
  return <AuthLayout title={content.title} description={content.description}>
    <div className="notice" id="auth-availability" role="status">
      <strong>Authentication is not available yet</strong>
      <p>This is a frontend preview. Signing in, creating accounts, and password resets are not connected.</p>
      {import.meta.env.DEV && <p className="setup-detail">{environment.message}</p>}
    </div>
    {mode !== 'reset' && <>
      <button className="button secondary" type="button" disabled aria-describedby="auth-availability">Continue with Google</button>
      <div className="divider"><span>or</span></div>
    </>}
    <form onSubmit={(event) => event.preventDefault()} aria-describedby="auth-availability">
      {mode === 'register' && <label>Name<input name="name" autoComplete="name" required disabled /></label>}
      <label>Email<input name="email" type="email" autoComplete="email" placeholder="you@university.edu" required disabled /></label>
      {mode !== 'reset' && <label>Password<input name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required disabled /></label>}
      {mode === 'register' && <label>Confirm password<input name="confirmPassword" type="password" autoComplete="new-password" required disabled /></label>}
      {mode === 'login' && <Link className="forgot-link" to={`/forgot-password${query}`}>Forgot password?</Link>}
      {mode === 'register' && <p className="form-note">Email verification will be required to use your account.</p>}
      <button className="button primary" type="submit" disabled>{content.action}</button>
    </form>
    <p className="switch-auth">
      {mode === 'login'
        ? <>Don’t have an account? <Link to={`/register${query}`}>Create account</Link></>
        : <>{mode === 'register' ? 'Already have an account? ' : ''}<Link to={`/login${query}`}>Back to sign in</Link></>}
    </p>
  </AuthLayout>
}
