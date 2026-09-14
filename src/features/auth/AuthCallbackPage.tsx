import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { AuthLayout } from './AuthLayout'
import { supabase } from '../../lib/supabase'
import { authContext, postAuthDestination } from './auth-navigation'

// React StrictMode can mount the callback twice. Exchange each one-time code once.
let exchange: { code: string; task: ReturnType<NonNullable<typeof supabase>['auth']['exchangeCodeForSession']> } | null = null
export function AuthCallbackPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const code = params.get('code')
  const providerError = params.has('error') || params.has('error_description')
  useEffect(() => {
    let active = true
    async function complete() {
      if (!supabase) { setError('Authentication is not configured.'); return }
      if (providerError || !code) {
        setError('This sign-in link is missing, expired, or was declined. Request a new link or sign in again.')
        return
      }
      try {
        if (!exchange || exchange.code !== code) exchange = { code, task: supabase.auth.exchangeCodeForSession(code) }
        const { data, error } = await exchange.task
        if (!active) return
        if (error || !data.user?.email_confirmed_at) {
          setError('This link could not be verified. Open it in the same browser that requested it, or request a new link.')
          return
        }
        if (params.get('mode') === 'recovery') {
          navigate('/reset-password?' + authContext(params), { replace: true })
        } else {
          navigate(postAuthDestination(params), { replace: true })
        }
      } catch {
        if (active) setError('Unable to verify this link. Check your connection and request a new link.')
      }
    }
    void complete()
    return () => { active = false }
  }, [code, providerError, params, navigate])
  return <AuthLayout title={error ? 'Unable to complete sign-in' : 'Verifying your account'} description={error || 'Please wait while we securely complete sign-in.'}>
    {error ? <Link to={'/login?' + authContext(params)}>Back to sign in</Link> : <p role="status">Verifying...</p>}
  </AuthLayout>
}
