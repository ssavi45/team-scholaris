const CONTEXT_KEY = 'scholaris.pending-auth-context'
export function safeDestination(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/app'
  try {
    const url = new URL(value, 'https://scholaris.invalid')
    if (url.origin !== 'https://scholaris.invalid' ||
      !(url.pathname === '/app' || /^\/project\/[A-Za-z0-9_-]+(?:\/paper)?$/.test(url.pathname))) return '/app'
    return url.pathname + url.search
  } catch { return '/app' }
}

export function authContext(params: URLSearchParams): URLSearchParams {
  const result = new URLSearchParams()
  result.set('next', safeDestination(params.get('next')))
  const invite = params.get('invite')
  if (invite && invite.length <= 2048) result.set('invite', invite)
  return result
}

export function callbackUrl(params: URLSearchParams, recovery = false): string {
  const context = authContext(params)
  try { sessionStorage.setItem(CONTEXT_KEY, context.toString()) } catch { /* URL carries context if storage is blocked. */ }
  if (recovery) context.set('mode', 'recovery')
  return `${window.location.origin}/auth/callback?${context}`
}

export function postAuthDestination(params: URLSearchParams): string {
  let context = params
  try {
    if (!params.has('next') && !params.has('invite')) {
      context = new URLSearchParams(sessionStorage.getItem(CONTEXT_KEY) ?? '')
    }
    sessionStorage.removeItem(CONTEXT_KEY)
  } catch { /* Use the callback's context. */ }
  const target = new URL(safeDestination(context.get('next')), window.location.origin)
  const invite = context.get('invite')
  if (invite && invite.length <= 2048) target.searchParams.set('invite', invite)
  return target.pathname + target.search
}
