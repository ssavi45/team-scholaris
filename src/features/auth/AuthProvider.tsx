import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { AuthContext } from './auth-context'
import type { AuthState } from './auth-context'
import { allowUserRecovery, clearUserRecovery } from '../paper/draft-storage'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: !!supabase, error: null })
  useEffect(() => {
    if (!supabase) return
    let active = true
    let changed = false
    let previousUser: string | undefined
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (previousUser && previousUser !== session?.user.id) void clearUserRecovery(previousUser).catch(() => {})
      previousUser = session?.user.id
      if (previousUser) allowUserRecovery(previousUser)
      changed = true
      if (active) setState({ user: session?.user ?? null, loading: false, error: null })
    })
    void supabase.auth.getSession().then(({ data, error }) => {
      if (active && (!changed || error)) setState({
        user: error ? null : data.session?.user ?? null, loading: false,
        error: error ? 'Unable to restore your session. Check your connection and reload.' : null,
      })
    }).catch(() => {
      if (active) setState({ user: null, loading: false, error: 'Unable to restore your session. Check your connection and reload.' })
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [])
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}
