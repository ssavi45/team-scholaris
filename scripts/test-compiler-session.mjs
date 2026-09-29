import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'
import ts from 'typescript'
const code = ts.transpileModule(await readFile('src/features/paper/compiler.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText
const { compilePaper, createCompilerSession } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
let started = 0, terminated = 0, packages = 0
function factory(forceThree = false) {
  started++
  const worker = new Worker(new URL('./lib/compiler-node-worker.mjs', import.meta.url))
  const bridge = { postMessage: data => worker.postMessage(data), terminate() { terminated++; void worker.terminate() } }
  worker.on('message', data => { if (data.cmd === 'package') packages++; if (forceThree) delete data.needsRerun; bridge.onmessage?.({ data }) })
  worker.on('error', error => bridge.onerror?.(error))
  return bridge
}
const source = text => [{ path: 'main.tex', content: `\\documentclass{article}\\begin{document}${text}\\end{document}` }]
async function timed(label, operation) { const start = performance.now(); const result = await operation(); console.log(`${label}: ${Math.round(performance.now() - start)} ms, ${result.passes} passes`); return result }
const session = createCompilerSession(factory)
try {
  await timed('Baseline: fresh engine, forced three passes (harness package cache)', () => compilePaper(source('Benchmark.'), new AbortController().signal, () => {}, () => factory(true)))
  await session.warm()
  const first = await timed('Workspace first compile (ready engine)', () => session.compile(source('First version.'), new AbortController().signal, () => {}))
  const downloaded = packages, workers = started
  const second = await timed('One-line edit, same workspace', () => session.compile(source('Changed line.'), new AbortController().signal, () => {}))
  assert.equal(started, workers, 'Successful jobs reuse engine')
  assert.equal(packages, downloaded, 'One-line edit reuses downloaded packages')
  assert.ok(first.passes < 3 && second.passes < 3)
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({ data: second.pdf.slice() })
  const pdf = await task.promise
  const text = (await (await pdf.getPage(1)).getTextContent()).items.map(item => item.str ?? '').join(' ')
  assert.match(text, /Changed line/); assert.doesNotMatch(text, /First version/)
  await task.destroy()
  await session.compile([...source('\\input{chapter}'), { path: 'chapter.tex', content: 'PRIVATE CHAPTER' }], new AbortController().signal, () => {})
  await assert.rejects(session.compile(source('\\input{chapter}'), new AbortController().signal, () => {}), /could not build/)
  assert.equal(terminated, 2, 'Failure retires the reused engine; first termination was baseline')
  const good = await session.compile(source('Recovered.'), new AbortController().signal, () => {})
  assert.ok(good.pdf.length > 1000)
  const cancel = new AbortController()
  const pending = session.compile(source('Cancelled.'), cancel.signal, () => {})
  cancel.abort(); await assert.rejects(pending, { name: 'AbortError' })
  const refs = [{ path: 'main.tex', content: String.raw`\documentclass{article}\begin{document}\section{Intro}\label{sec:a}See \ref{sec:a} and \cite{test}.\bibliographystyle{plain}\bibliography{references}\end{document}` }, { path: 'references.bib', content: '@book{test,author={A Writer},title={A Book},year={2026},publisher={Press}}' }]
  const referenced = await session.compile(refs, new AbortController().signal, () => {})
  assert.doesNotMatch(referenced.log, /Citation .+ undefined|Reference .+ undefined/)
  console.log('PASS reused engine, clean deleted-source isolation, changed PDF, adaptive passes, failure/cancel recovery and bibliography references')
  console.log('Node harness timings, not browser/network benchmarks. Persistent browser IndexedDB cache requires manual validation.')
} finally { session.dispose() }
assert.equal(started, terminated, 'Every workspace-owned engine is eventually terminated')
