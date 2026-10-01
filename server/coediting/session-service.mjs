// Trusted server module. Never import into Vite or expose the service-role client.
import { Worker } from 'node:worker_threads'

export function validateDocument(input) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./document-worker.mjs', import.meta.url), {
      workerData: input, resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 2 },
    })
    const timer = setTimeout(() => finish(new Error('Shared document validation timed out.')), 3000)
    let settled = false
    function finish(error, result) {
      if (settled) return
      settled = true; clearTimeout(timer); void worker.terminate()
      if (error) reject(error); else resolve(result)
    }
    worker.once('message', result => finish(result.error ? new Error(result.error) : null, result))
    worker.once('error', () => finish(new Error('Shared document validation failed.')))
    worker.once('exit', () => finish(new Error('Shared document validation stopped.')))
  })
}

export class SharedSessionService {
  constructor(admin, allowedProjects = []) {
    this.admin = admin
    this.allowedProjects = new Set(allowedProjects)
    this.pending = 0
  }
  async actor(token) {
    // Auth server validates signature, expiry and user existence on every operation.
    const { data, error } = await this.admin.auth.getUser(token)
    if (error || !data.user?.email_confirmed_at) throw new Error('Sign in with a verified account.')
    return data.user.id
  }
  async rpc(actor, file, action, extra = {}) {
    const { data, error } = await this.admin.rpc('paper_shared_session', {
      p_actor: actor, p_file: file, p_action: action, ...extra,
    })
    if (error) {
      const failure = new Error(error.message); failure.code = error.code; throw failure
    }
    return data
  }
  async read(token, file) {
    const actor = await this.actor(token)
    const result = await this.rpc(actor, file, 'read')
    if (!this.allowedProjects.has(result.file.project_id)) throw new Error('Shared editing is not enabled for this pilot project.')
    return result
  }
  async validate(input) {
    if (this.pending >= 8) throw new Error('Shared editing is busy. Retry shortly.')
    this.pending++
    try { return await validateDocument(input) } finally { this.pending-- }
  }
  async enable(token, file, expectedVersion) {
    const current = await this.read(token, file)
    if (expectedVersion !== undefined && expectedVersion !== current.file.version) throw new Error('Source changed. Reload before starting shared editing.')
    const candidate = await this.validate({ content: current.file.content })
    return this.rpc(await this.actor(token), file, 'enable', {
      p_version: current.file.version, p_content: candidate.content, p_state: candidate.state,
    })
  }
  async update(token, file, epoch, update) {
    if (!(update instanceof Uint8Array) || update.byteLength === 0 || update.byteLength > 262144) {
      throw new Error('Invalid update size.')
    }
    // PostgreSQL compare-and-swap allows multiple gateway instances without
    // trusting process-local ownership. A losing writer merges onto fresh state.
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await this.read(token, file)
      if (!current.editable) throw new Error('This paper is read-only.')
      if (!current.session || current.session.epoch !== epoch) throw new Error('Session changed. Recover your local edits separately.')
      const candidate = await this.validate({ state: current.session.state, update })
      try {
        return await this.rpc(await this.actor(token), file, 'commit', {
          p_epoch: epoch, p_sequence: current.session.sequence,
          p_state: candidate.state, p_content: candidate.content,
        })
      } catch (error) { if (error.code !== 'PT409' || attempt === 4) throw error }
    }
  }
  async disable(token, file) {
    const current = await this.read(token, file)
    if (!current.session) throw new Error('No shared session.')
    return this.rpc(await this.actor(token), file, 'disable', {
      p_epoch: current.session.epoch, p_sequence: current.session.sequence,
    })
  }
}
