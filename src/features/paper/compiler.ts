export type SourceFile = { path: string; content: string; kind?: 'text' | 'folder' | 'image'; storage_path?: string | null; bytes?: Uint8Array<ArrayBuffer> }
export type Compilation = { pdf: Uint8Array<ArrayBuffer>; log: string; signature: string; passes?: number }
export class CompileError extends Error {
  log: string
  constructor(message: string, log = '') { super(message); this.name = 'CompileError'; this.log = log }
}

// Cancel waiting for an in-flight draft save without cancelling the save itself.
// Its eventual result still belongs to the draft store, never to a cancelled job.
export function waitForPreparation<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Compilation cancelled.', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
  })
}
export function sourceSignature(files: SourceFile[], mainFile = 'main.tex') {
  return JSON.stringify([mainFile, files.map((file) => [file.path, file.kind ?? 'text', file.kind === 'image' ? file.storage_path : file.content]).sort((a, b) => (a[0] ?? '').localeCompare(b[0] ?? ''))])
}
export function validateSources(files: SourceFile[], mainFile: string | null = 'main.tex') {
  if (mainFile && !files.some((file) => file.path === mainFile && (file.kind ?? 'text') === 'text' && file.path.endsWith('.tex'))) throw new CompileError('Select an existing .tex file before compiling.')
  if (files.length > 100) throw new CompileError('A paper can contain up to 100 source files.')
  const paths = new Set<string>()
  let size = 0
  let imageSize = 0
  for (const file of files) {
    if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*(\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/.test(file.path) || file.path.endsWith('.') || file.path.length > 240 || [...paths].some((path) => path.toLowerCase() === file.path.toLowerCase())) throw new CompileError('The paper contains an invalid or duplicate source path.')
    paths.add(file.path)
    if (file.kind === 'folder') continue
    if (file.kind === 'image') {
      if (!/\.(png|jpg|jpeg)$/.test(file.path) || !file.bytes || file.bytes.length > 5242880) throw new CompileError('A figure is missing or exceeds 5 MiB.')
      imageSize += file.bytes.length; continue
    }
    if (!/\.(tex|bib|sty|cls|txt|bst|clo|cfg|def)$/.test(file.path)) throw new CompileError('Unsupported source file type.')
    const bytes = new TextEncoder().encode(file.content).length
    if (bytes > 524288) throw new CompileError('Each source file must be at most 512 KiB.')
    size += bytes
  }
  if (size > 5242880) throw new CompileError('Paper source files must total at most 5 MiB.')
  if (imageSize > 26214400) throw new CompileError('Paper figures must total at most 25 MiB.')
  for (const path of paths) {
    const parts = path.split('/')
    while (parts.length > 1) { parts.pop(); if (files.some((file) => file.path.toLowerCase() === parts.join('/').toLowerCase() && file.kind !== 'folder')) throw new CompileError('A source file conflicts with a folder.') }
  }
}

// Standalone calls use a fresh worker. Workspace sessions lease a reset worker with public packages retained.
// No project credentials enter either worker.
export async function compilePaper(files: SourceFile[], signal: AbortSignal, progress: (status: string) => void,
  workerFactory = () => new Worker(`${import.meta.env.BASE_URL}vendor/swiftlatex/scholaris-worker.js`), timeoutMs = 120000, mainFile = 'main.tex'): Promise<Compilation> {
  validateSources(files, mainFile)
  signal.throwIfAborted()
  const worker = workerFactory()
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: () => void = () => {}
  try {
    return await new Promise<Compilation>((resolve, reject) => {
      let pass = 0
      let initialized = false
      let log = ''
      abort = () => reject(new DOMException('Compilation cancelled.', 'AbortError'))
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) { abort(); return }
      timer = setTimeout(() => reject(new CompileError('Compilation timed out. Check for a LaTeX loop or unavailable package, then try again.', log)), timeoutMs)
      worker.onerror = () => reject(new CompileError('The LaTeX engine could not run. Reload and try again.', log))
      worker.onmessageerror = () => reject(new CompileError('The compiler returned an unreadable response.', log))
      progress('Loading LaTeX engine...')
      worker.onmessage = ({ data }: MessageEvent) => {
        if (signal.aborted) return
        if (data.cmd === 'resource-error') { reject(new CompileError(`Unable to download compiler dependency ${data.name}. Check your network and retry.`, log)); return }
        if (data.cmd === 'package') { progress(`Loading package: ${data.name}`); return }
        if (!initialized && data.result === 'ok' && !data.cmd) {
          initialized = true
          const folders = new Set<string>()
          for (const file of files) {
            const parts = file.path.split('/'); if (file.kind !== 'folder') parts.pop()
            for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join('/'))
          }
          for (const folder of [...folders].sort((a, b) => a.split('/').length - b.split('/').length)) worker.postMessage({ cmd: 'mkdir', url: folder })
          for (const file of files) if (file.kind !== 'folder') worker.postMessage({ cmd: 'writefile', url: file.path, src: file.bytes ?? file.content })
          // SwiftLaTeX looks for PDF/BibTeX output using the entry path, while
          // pdfTeX writes the basename at the working root. Use a private root
          // entry for nested mains, keeping all source paths relative to root.
          let entryPoint = mainFile
          if (mainFile.includes('/')) {
            let suffix = 0
            const paths = new Set(files.flatMap((file) => [file.path.toLowerCase(), file.path.split('/')[0].toLowerCase()]))
            do { entryPoint = `scholaris-entry-${suffix++}.tex` } while (paths.has(entryPoint))
            worker.postMessage({ cmd: 'writefile', url: entryPoint, src: `\\input{${mainFile}}\n` })
          }
          worker.postMessage({ cmd: 'setmainfile', url: entryPoint })
          pass = 1; progress('Typesetting, pass 1...'); worker.postMessage({ cmd: 'compilelatex' })
          return
        }
        if (data.result === 'failed' && data.cmd !== 'compile') { reject(new CompileError('Unable to load a source file into the compiler.')); return }
        if (data.cmd !== 'compile') return
        log = typeof data.log === 'string' ? data.log.slice(-150000) : ''
        if (data.result !== 'ok' || data.status !== 0 || !(data.pdf instanceof ArrayBuffer)) {
          reject(new CompileError('LaTeX could not build this paper. Review the compilation log below.', log)); return
        }
        if (pass < 3 && data.needsRerun !== false) { pass++; progress(`Resolving references, pass ${pass}...`); worker.postMessage({ cmd: 'compilelatex' }); return }
        const pdf = new Uint8Array(data.pdf)
        if (pdf.length > 20 * 1024 * 1024 || new TextDecoder().decode(pdf.slice(0, 5)) !== '%PDF-') { reject(new CompileError('The compiler did not produce a supported PDF.', log)); return }
        resolve({ pdf, log, signature: sourceSignature(files, mainFile), passes: pass })
      }
    })
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', abort); worker.terminate()
  }
}

/** Workspace-owned engine: retain public packages, never reuse paper output between jobs. */
export function createCompilerSession(factory = () => new Worker(`${import.meta.env.BASE_URL}vendor/swiftlatex/scholaris-worker.js`)) {
  let worker: Worker | null = null
  let ready = false, running = false
  let client: Worker | null = null
  let warming: Promise<void> | null = null
  let rejectWarm: ((reason: Error) => void) | null = null
  let warmTimer: ReturnType<typeof setTimeout> | undefined
  function dispose() {
    const active = client
    client = null
    worker?.terminate(); worker = null; ready = false; warming = null
    clearTimeout(warmTimer)
    rejectWarm?.(new DOMException('Compiler session closed.', 'AbortError')); rejectWarm = null
    active?.onerror?.({ message: 'Compiler session closed.' } as ErrorEvent)
  }
  function warm() {
    if (ready) return Promise.resolve()
    if (warming) return warming
    warming = new Promise<void>((resolve, reject) => {
      rejectWarm = reject
      try {
        const engine = factory(); worker = engine
        warmTimer = setTimeout(() => { reject(new Error('Engine warm-up timed out.')); dispose() }, 30000)
        engine.onmessage = event => {
          if (worker !== engine) return
          if (!ready && event.data.result === 'ok' && !event.data.cmd) { ready = true; clearTimeout(warmTimer); rejectWarm = null; resolve(); return }
          if (event.data.cmd === 'reset-workspace' && event.data.result === 'ok') {
            client?.onmessage?.({ data: { result: 'ok' } } as MessageEvent); return
          }
          client?.onmessage?.(event)
        }
        engine.onerror = event => { if (client) client.onerror?.(event); else { reject(new Error('Engine failed to load.')); dispose() } }
        engine.onmessageerror = event => { if (client) client.onmessageerror?.(event); else { reject(new Error('Engine response could not be read.')); dispose() } }
      } catch (cause) { reject(cause); worker = null }
    })
    // Prewarming is optional; failures must not become unhandled rejections.
    const pending = warming
    void pending.catch(() => { if (warming === pending && !ready) warming = null })
    return warming
  }
  async function compile(files: SourceFile[], signal: AbortSignal, progress: (text: string) => void, timeoutMs = 120000, main = 'main.tex') {
    if (running) throw new CompileError('A compilation is already running.')
    validateSources(files, main); signal.throwIfAborted(); running = true
    try {
      progress(ready ? 'Using ready LaTeX engine...' : 'Loading LaTeX engine...')
      await waitForPreparation(warm(), signal)
      signal.throwIfAborted()
      return await compilePaper(files, signal, progress, () => {
        // compilePaper owns the lease; the workspace owns the underlying engine.
        const lease = { postMessage: (data: unknown) => worker?.postMessage(data), terminate: () => { client = null } } as Worker
        client = lease
        worker!.postMessage({ cmd: 'reset-workspace' })
        return lease
      }, timeoutMs, main)
    } catch (cause) { dispose(); throw cause }
    finally { running = false }
  }
  return { warm, compile, dispose }
}
