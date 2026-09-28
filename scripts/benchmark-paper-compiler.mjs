import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import ts from 'typescript'
process.on('uncaughtException', error => { console.error(error.message, error.log ?? ''); process.exit(1) })
const cacheDirectory = await mkdtemp(join(tmpdir(), 'scholaris-compiler-benchmark-'))
const code = ts.transpileModule(await readFile('src/features/paper/compiler.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText
const { compilePaper } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const factory = () => {
  const worker = new Worker(new URL('./lib/compiler-node-worker.mjs', import.meta.url), { workerData: { cacheDirectory } })
  const bridge = { postMessage: data => worker.postMessage(data), terminate: () => { void worker.terminate() } }
  worker.on('message', data => bridge.onmessage?.({ data })); worker.on('error', error => bridge.onerror?.(error))
  return bridge
}
for (const label of ['Cold package cache', 'Warm package cache']) {
  const start = performance.now()
  const result = await compilePaper([{ path: 'main.tex', content: String.raw`\documentclass{article}\begin{document}Scholaris benchmark.\end{document}` }], new AbortController().signal, () => {}, factory, 180000)
  console.log(`${label}: ${Math.round(performance.now() - start)} ms, ${result.pdf.length} PDF bytes`)
}
console.log(`Node ${process.version}, ${process.platform}/${process.arch}, fresh WASM worker each run. Cold uses public package-network downloads; warm uses a private temporary harness cache. These are not browser measurements.`)
