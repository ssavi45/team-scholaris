import { WebSocketServer, WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const protocol = 'scholaris-paper-v1'

// Enrollment is explicit, owner-authorized and restricted to allowlisted projects.
// The caller supplies an HTTP server on loopback, or an HTTPS server for WSS.
export function attachSharedSockets(server, service, {
  origins, pollMs = 2000, authTimeoutMs = 5000, maxConnections = 50,
  messagesPerMinute = 120,
} = {}) {
  if (!origins?.length || origins.some(origin => !/^https?:\/\//.test(origin) || new URL(origin).origin !== origin)) {
    throw new Error('Exact browser origins are required.')
  }
  const allowedOrigins = new Set(origins), connections = new Set(), rates = new Map(), ips = new Map(), peers = new Map()
  const wss = new WebSocketServer({ noServer: true, maxPayload: 360000, perMessageDeflate: false,
    handleProtocols: protocols => protocols.has(protocol) ? protocol : false })
  let stopped = false
  function send(ws, body) {
    if (ws.readyState !== WebSocket.OPEN) return
    if (ws.bufferedAmount > 3000000) { ws.close(1013, 'Slow connection; reconnect to synchronize.'); return }
    ws.send(JSON.stringify(body), error => { if (error) ws.terminate() })
  }
  function rate(key, maximum) {
    if (!rates.has(key) && rates.size >= 5000) return false
    const minute = Math.floor(Date.now() / 60000)
    const prior = rates.get(key)
    const count = prior?.minute === minute ? prior.count + 1 : 1
    rates.set(key, { minute, count })
    return count <= maximum
  }
  const upgrade = (req, socket, head) => {
    // Reject queries entirely: access tokens must never enter URL/access logs.
    if (stopped || req.url !== '/paper-shared' || !allowedOrigins.has(req.headers.origin)
      || !req.headers['sec-websocket-protocol']?.split(',').map(x => x.trim()).includes(protocol)
      || connections.size >= maxConnections) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return
    }
    const ip = req.socket.remoteAddress
    if ((ips.get(ip) ?? 0) >= 10 || !rate(`ip:${ip}`, 60)) {
      socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n'); return
    }
    wss.handleUpgrade(req, socket, head, ws => {
      ips.set(ip, (ips.get(ip) ?? 0) + 1)
      wss.emit('connection', ws, ip)
    })
  }
  server.on('upgrade', upgrade)
  wss.on('connection', (ws, ip) => {
    connections.add(ws)
    const peerId = randomUUID()
    let token, file, actor, epoch, sequence = -1, editable, pending = 0, chain = Promise.resolve(), alive = true
    const timeout = setTimeout(() => ws.close(4401, 'Authentication required.'), authTimeoutMs)
    ws.on('error', () => {}) // Transport failures are handled through close/reconnect.
    ws.on('pong', () => { alive = true })
    ws.on('close', () => {
      clearTimeout(timeout); clearInterval(poll); clearInterval(heartbeat)
      token = undefined; connections.delete(ws)
      peers.delete(peerId)
      const count = (ips.get(ip) ?? 1) - 1
      if (count) ips.set(ip, count); else ips.delete(ip)
    })
    function queue(work) {
      if (pending >= 8) { ws.close(4429, 'Too many pending requests.'); return }
      pending++
      chain = chain.then(async () => {
        if (ws.readyState === WebSocket.OPEN) await work()
      }).catch(() => {
        // Never serialize database errors, JWTs or manuscript data into diagnostics.
        ws.close(4403, 'Session unavailable. Keep local edits and reconnect.')
      }).finally(() => { pending-- })
    }
    async function sync(force = false) {
      // Every outbound snapshot comes from a fresh authorized read. No unchecked
      // room broadcast; polling also observes other gateway processes' commits.
      const current = await service.read(token, file)
      if (!current.session || current.session.epoch !== epoch) {
        ws.close(4409, 'Document session changed. Preserve local edits separately.'); return false
      }
      if (force || current.session.sequence !== sequence || current.editable !== editable) {
        sequence = current.session.sequence; editable = current.editable
        send(ws, { type: 'state', epoch, sequence, editable, state: current.session.state })
      }
      const own = peers.get(peerId)
      if (own) own.checked = Date.now()
      send(ws, { type: 'peers', peers: [...peers.values()].filter(peer => peer.file === file && peer.epoch === epoch && Date.now() - peer.checked < 5000).map(({ id, userId, name, color, cursor }) => ({ id, userId, name, color, cursor })) })
      return true
    }
    ws.on('message', (bytes, binary) => {
      if (binary) { ws.close(1008, 'JSON protocol required.'); return }
      let message
      try { message = JSON.parse(bytes.toString()) } catch { ws.close(1008, 'Invalid message.'); return }
      if (!message || typeof message !== 'object' || Array.isArray(message)) { ws.close(1008, 'Invalid message.'); return }
      queue(async () => {
        if (!actor) {
          if (message.type !== 'join' || typeof message.token !== 'string' || message.token.length > 8192 || !uuid.test(message.file ?? '')) {
            ws.close(4401, 'Join with a valid session.'); return
          }
          const verified = await service.actor(message.token)
          if (!rate(`user:${verified}`, messagesPerMinute)) { ws.close(4429, 'Rate limit.'); return }
          let current = await service.read(message.token, message.file)
          if (!current.session && message.enable === true && Number.isInteger(message.version)) current = await service.enable(message.token, message.file, message.version)
          if (!current.session) { ws.close(4409, 'Shared session is not enabled.'); return }
          actor = verified; token = message.token; file = message.file; epoch = current.session.epoch
          const profile = await service.admin.from('profiles').select('name').eq('id', actor).maybeSingle()
          const palette = ['#b45309','#2563eb','#9333ea','#c2410c','#0f766e']
          peers.set(peerId, { id: peerId, userId: actor, file, epoch, name: (profile.data?.name || 'Coauthor').slice(0,80), color: palette[parseInt(actor.slice(0,8),16) % palette.length], cursor: null, checked: Date.now(), notify: () => { if (pending === 0) queue(() => sync()) } })
          clearTimeout(timeout)
          // Disconnected old-epoch clients must not merge into a replacement.
          if (message.epoch && message.epoch !== epoch) { ws.close(4409, 'Document session changed.'); return }
          await sync(true); return
        }
        if (message.type === 'cursor') {
          if (!rate(`cursor:${actor}`, 300)) return
          if (JSON.stringify(message.cursor).length > 2048) { ws.close(1008, 'Cursor too large.'); return }
          // Presence is ephemeral. Fresh access checks prevent writes after revocation.
          const current = await service.read(token, file)
          if (!current.session || current.session.epoch !== epoch) { ws.close(4409, 'Session changed.'); return }
          const own = peers.get(peerId)
          if (own) { own.cursor = message.cursor; own.checked = Date.now() }
          for (const peer of peers.values()) if (peer.id !== peerId && peer.file === file && peer.epoch === epoch) peer.notify()
          return
        }
        if (!rate(`user:${actor}`, messagesPerMinute)) { ws.close(4429, 'Rate limit.'); return }
        if (message.type === 'refresh') {
          if (typeof message.token !== 'string' || message.token.length > 8192 || await service.actor(message.token) !== actor) {
            ws.close(4401, 'Account changed. Reconnect.'); return
          }
          token = message.token
          await sync(true); return
        }
        if (message.type === 'sync') { await sync(true); return }
        if (message.type === 'end') {
          await service.disable(token, file)
          send(ws, { type: 'ended' }); ws.close(1000, 'Shared session ended.'); return
        }
        if (message.type !== 'update' || typeof message.id !== 'string' || !/^[\w-]{1,64}$/.test(message.id)
          || message.epoch !== epoch || typeof message.update !== 'string' || message.update.length > 349528
          || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(message.update)) {
          ws.close(1008, 'Invalid update envelope.'); return
        }
        let committed
        try { committed = await service.update(token, file, epoch, Buffer.from(message.update, 'base64')) }
        catch {
          send(ws, { type: 'rejected', id: message.id, code: 'UPDATE_REJECTED', message: 'Edit was not acknowledged. Keep your local copy and synchronize before retrying.' })
          await sync(); return
        }
        if (await sync()) {
          send(ws, { type: 'ack', id: message.id, epoch, sequence: committed.session.sequence })
          for (const peer of peers.values()) if (peer.id !== peerId && peer.file === file && peer.epoch === epoch) peer.notify()
        }
      })
    })
    const poll = setInterval(() => { if (actor && pending === 0) queue(() => sync()) }, pollMs)
    const heartbeat = setInterval(() => {
      if (!alive) { ws.terminate(); return }
      alive = false; ws.ping()
    }, 15000)
  })
  const cleanup = setInterval(() => {
    const minute = Math.floor(Date.now() / 60000)
    for (const [key, value] of rates) if (value.minute < minute) rates.delete(key)
  }, 60000)
  cleanup.unref()
  return {
    async close() {
      stopped = true; clearInterval(cleanup); server.off('upgrade', upgrade)
      for (const ws of connections) ws.terminate()
      await new Promise(resolve => wss.close(resolve))
    },
  }
}
