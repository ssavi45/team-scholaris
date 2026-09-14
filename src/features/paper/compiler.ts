export type SourceFile = { path: string; content: string }
export type Compilation = { pdf: Uint8Array<ArrayBuffer>; log: string; signature: string }
export class CompileError extends Error {
  log: string
  constructor(message: string, log = '') { super(message); this.name = 'CompileError'; this.log = log }
}
export function sourceSignature(files: SourceFile[]) {
  return JSON.stringify(files.map(({ path, content }) => [path, content]).sort((a, b) => a[0].localeCompare(b[0])))
}
export function validateSources(files: SourceFile[]) {
  if (!files.some((file) => file.path === 'main.tex')) throw new CompileError('Add main.tex before compiling.')
  if (files.length > 100) throw new CompileError('A paper can contain up to 100 source files.')
  const paths = new Set<string>()
  let size = 0
  for (const file of files) {
    if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*(\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*\.(tex|bib|sty|cls|txt)$/.test(file.path) || file.path.length > 240 || paths.has(file.path)) throw new CompileError('The paper contains an invalid or duplicate source path.')
    paths.add(file.path)
    const bytes = new TextEncoder().encode(file.content).length
    if (bytes > 524288) throw new CompileError('Each source file must be at most 512 KiB.')
    size += bytes
  }
  if (size > 5242880) throw new CompileError('Paper source files must total at most 5 MiB.')
  for (const path of paths) {
    const parts = path.split('/')
    while (parts.length > 1) { parts.pop(); if (paths.has(parts.join('/'))) throw new CompileError('A source file conflicts with a folder.') }
  }
}

// A fresh worker gives each job an isolated memory filesystem. No project credentials enter it.
export async function compilePaper(files: SourceFile[], signal: AbortSignal, progress: (status: string) => void,
  workerFactory = () => new Worker(`${import.meta.env.BASE_URL}vendor/swiftlatex/scholaris-worker.js`), timeoutMs = 120000): Promise<Compilation> {
  validateSources(files)
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
        if (data.cmd === 'package') { progress(`Loading package: ${data.name}`); return }
        if (!initialized && data.result === 'ok' && !data.cmd) {
          initialized = true
          const folders = new Set<string>()
          for (const file of files) {
            const parts = file.path.split('/'); parts.pop()
            for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join('/'))
          }
          for (const folder of [...folders].sort((a, b) => a.split('/').length - b.split('/').length)) worker.postMessage({ cmd: 'mkdir', url: folder })
          for (const file of files) worker.postMessage({ cmd: 'writefile', url: file.path, src: file.content })
          worker.postMessage({ cmd: 'setmainfile', url: 'main.tex' })
          pass = 1; progress('Typesetting, pass 1 of 3...'); worker.postMessage({ cmd: 'compilelatex' })
          return
        }
        if (data.result === 'failed' && data.cmd !== 'compile') { reject(new CompileError('Unable to load a source file into the compiler.')); return }
        if (data.cmd !== 'compile') return
        log = typeof data.log === 'string' ? data.log.slice(-150000) : ''
        if (data.result !== 'ok' || data.status !== 0 || !(data.pdf instanceof ArrayBuffer)) {
          reject(new CompileError('LaTeX could not build this paper. Review the compilation log below.', log)); return
        }
        if (pass < 3) { pass++; progress(`Resolving references, pass ${pass} of 3...`); worker.postMessage({ cmd: 'compilelatex' }); return }
        const pdf = new Uint8Array(data.pdf)
        if (pdf.length > 20 * 1024 * 1024 || new TextDecoder().decode(pdf.slice(0, 5)) !== '%PDF-') { reject(new CompileError('The compiler did not produce a supported PDF.', log)); return }
        resolve({ pdf, log, signature: sourceSignature(files) })
      }
    })
  } finally {
    clearTimeout(timer); signal.removeEventListener('abort', abort); worker.terminate()
  }
}
