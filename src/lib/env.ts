type SupabaseConfig = { url: string; publishableKey: string }
type Environment =
  | { status: 'ready'; config: SupabaseConfig; message: string }
  | { status: 'missing' | 'invalid'; config: null; message: string }

function isBrowserSafeKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return false
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true

  // Legacy hosted and local CLI anon keys are JWTs. Inspect their declared
  // role, not just their shape, so service_role and user tokens are rejected.
  // This is configuration validation, NOT cryptographic JWT verification.
  const parts = key.split('.')
  if (parts.length !== 3 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return false
  try {
    const decode = (part: string): unknown => {
      const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
      return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')))
    }
    const header = decode(parts[0])
    const payload = decode(parts[1])
    return typeof header === 'object' && header !== null &&
      'alg' in header && typeof header.alg === 'string' &&
      header.alg.length > 0 && header.alg.toLowerCase() !== 'none' &&
      typeof payload === 'object' && payload !== null &&
      'role' in payload && payload.role === 'anon'
  } catch {
    return false
  }
}

export function validateEnvironment(url?: string, key?: string): Environment {
  if (!url?.trim() && !key?.trim()) {
    return { status: 'missing', config: null, message: 'Supabase is not configured. See .env.example for the public environment variables.' }
  }
  try {
    const parsed = new URL(url?.trim() ?? '')
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    if ((parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) ||
      parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
      throw new Error('Invalid Supabase URL')
    }
    const publishableKey = key?.trim() ?? ''
    if (!isBrowserSafeKey(publishableKey)) {
      throw new Error('Invalid public API key')
    }
    return {
      status: 'ready', config: { url: parsed.origin, publishableKey },
      message: 'Supabase configuration is present. Backend connectivity and authentication have not been verified.',
    }
  } catch {
    return { status: 'invalid', config: null, message: 'Supabase configuration is incomplete or invalid. Use a project URL and a publishable or legacy anon key, never a secret or service-role key; see .env.example.' }
  }
}

export const environment = validateEnvironment(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
)
