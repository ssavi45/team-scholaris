// Test-only child: credentials arrive through IPC, never process arguments/logs.
import { createServer } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import { SharedSessionService } from '../server/coediting/session-service.mjs'
import { attachSharedSockets } from '../server/coediting/websocket-server.mjs'
process.once('message', ({ url, key, project, mode }) => {
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  const service = new SharedSessionService(admin, [project])
  const update = service.update.bind(service)
  service.update = async (...args) => {
    if (mode === 'before') { process.send({ boundary: 'before' }); await new Promise(() => {}) }
    const result = await update(...args)
    if (mode === 'after') { process.send({ boundary: 'after' }); await new Promise(() => {}) }
    return result
  }
  const server = createServer((_req,res) => { res.writeHead(404); res.end() })
  attachSharedSockets(server, service, { origins: ['http://127.0.0.1:5173'], pollMs: 500 })
  server.listen(0,'127.0.0.1',() => process.send({ port: server.address().port }))
})
