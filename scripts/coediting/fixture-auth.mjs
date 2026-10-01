// Signed local test identities, NOT Supabase users or production authentication.
import { createHmac, timingSafeEqual } from 'node:crypto'
export function fixtureAuth(secret) {
  const sign = payload => createHmac('sha256', secret).update(payload).digest('base64url')
  return {
    issue(sub, options = {}) {
      const payload = Buffer.from(JSON.stringify({ sub, project: 'fixture-project', exp: Date.now() + 60000, ...options })).toString('base64url')
      return payload + '.' + sign(payload)
    },
    verify(token) {
      const [payload, signature, extra] = String(token).split('.')
      if (!payload || !signature || extra) throw new Error('Unauthorized')
      const actual = Buffer.from(signature), expected = Buffer.from(sign(payload))
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Unauthorized')
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
      if (typeof claims.sub !== 'string' || !Number.isFinite(claims.exp) || claims.exp <= Date.now()) throw new Error('Expired identity')
      return claims
    },
  }
}
