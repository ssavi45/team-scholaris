import { createClient } from '@supabase/supabase-js'
import { environment } from './env'
import type { Database } from '../types/database'

// Only browser-safe public credentials reach this client; authorization lives in RLS.
export const supabase = environment.config
  ? createClient<Database>(environment.config.url, environment.config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' },
    })
  : null
