import { createClient } from '@supabase/supabase-js'
import { environment } from './env'

// Preparation only: auth actions are not connected in this frontend foundation.
export const supabase = environment.config
  ? createClient(environment.config.url, environment.config.publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' },
    })
  : null
