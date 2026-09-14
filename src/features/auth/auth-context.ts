import { createContext, useContext } from 'react'
import type { User } from '@supabase/supabase-js'

export type AuthState = { user: User | null; loading: boolean; error: string | null }
export const AuthContext = createContext<AuthState>({ user: null, loading: true, error: null })
export function useAuth() { return useContext(AuthContext) }
