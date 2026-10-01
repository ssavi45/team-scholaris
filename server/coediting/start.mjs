import { createServer as httpServer } from 'node:http'
import { createServer as httpsServer } from 'node:https'
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { SharedSessionService } from './session-service.mjs'
import { attachSharedSockets } from './websocket-server.mjs'

const env = process.env
const host = env.PAPER_SHARED_HOST || '127.0.0.1'
const port = Number(env.PAPER_SHARED_PORT || 5440)
const origins = (env.PAPER_SHARED_ORIGINS || '').split(',').filter(Boolean)
const projects = (env.PAPER_SHARED_PROJECTS || '').split(',').filter(Boolean)
const tls = env.PAPER_SHARED_TLS_KEY && env.PAPER_SHARED_TLS_CERT
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !origins.length
  || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('Configure backend Supabase credentials, allowed origins and a valid port.')
}
if (!tls && !['127.0.0.1', '::1'].includes(host)) throw new Error('TLS certificates are required for non-loopback hosting.')
const handler = (_req, res) => { res.writeHead(404); res.end() }
const server = tls
  ? httpsServer({ key: readFileSync(env.PAPER_SHARED_TLS_KEY), cert: readFileSync(env.PAPER_SHARED_TLS_CERT) }, handler)
  : httpServer(handler)
const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, options) => fetch(input, { ...options, signal: AbortSignal.timeout(10000) }) },
})
const gateway = attachSharedSockets(server, new SharedSessionService(admin, projects), { origins })
server.listen(port, host, () => console.log(`Paper transport listening on ${tls ? 'WSS' : 'loopback WS'} port ${port}; ${projects.length} pilot projects allowed.`))
let closing = false
async function close() {
  if (closing) return
  closing = true
  await gateway.close()
  server.close()
}
process.on('SIGINT', close)
process.on('SIGTERM', close)
