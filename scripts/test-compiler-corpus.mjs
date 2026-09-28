import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'
import { performance } from 'node:perf_hooks'
import ts from 'typescript'
import { fixturePng } from './lib/fixture-png.mjs'
process.on('uncaughtException', error => { console.error(error.message, error.log ?? ''); process.exit(1) })
const load = async file => import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(await readFile(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText).toString('base64'))
const { compilePaper } = await load('src/features/paper/compiler.ts')
const { parseCompileDiagnostics } = await load('src/features/paper/compile-diagnostics.ts')
const factory = () => {
  const worker = new Worker(new URL('./lib/compiler-node-worker.mjs', import.meta.url))
  const bridge = { postMessage: data => worker.postMessage(data), terminate: () => { void worker.terminate() } }
  worker.on('message', data => bridge.onmessage?.({ data })); worker.on('error', error => bridge.onerror?.(error))
  return bridge
}
const tex = body => String.raw`\documentclass{article}\begin{document}` + body + String.raw`\end{document}`
const fixtures = [
  { name: 'no bibliography', noBibErrors: true, files: [{ path: 'main.tex', content: tex('A paper without a bibliography.') }] },
  { name: 'inline bibliography', noBibErrors: true, files: [{ path: 'main.tex', content: tex(String.raw`See \cite{manual}.\begin{thebibliography}{1}\bibitem{manual}Author. Manual reference.\end{thebibliography}`) }] },
  { name: 'bibliography in included chapter', noBibErrors: true, files: [{ path: 'main.tex', content: tex(String.raw`\include{sections/chapter}`) }, { path: 'sections/chapter.tex', content: String.raw`See \cite{key}.\bibliographystyle{plain}\bibliography{references}` }, { path: 'references.bib', content: '@book{key,title={Book},author={Author},year={2020},publisher={Press}}' }] },
  { name: 'incomplete bibliography configuration', warning: /bibstyle/, files: [{ path: 'main.tex', content: tex(String.raw`\cite{key}\bibliography{references}`) }, { path: 'references.bib', content: '@book{key,title={Book},author={Author},year={2020},publisher={Press}}' }] },
  { name: 'custom class/style, math, table, accented Latin', files: [
    { path: 'main.tex', content: String.raw`\documentclass{scholaris}\usepackage{localstyle}\begin{document}Caf\'e. $E=mc^2$ \localword\begin{tabular}{cc}A&B\\1&2\end{tabular}\end{document}` },
    { path: 'scholaris.cls', content: String.raw`\NeedsTeXFormat{LaTeX2e}\ProvidesClass{scholaris}\LoadClass{article}` },
    { path: 'localstyle.sty', content: String.raw`\ProvidesPackage{localstyle}\newcommand{\localword}{Research}` },
  ] },
  { name: 'PNG and JPEG', files: [
    { path: 'main.tex', content: String.raw`\documentclass{article}\usepackage{graphicx}\begin{document}\includegraphics{plot.png}\includegraphics{plot.jpg}\end{document}` },
    { path: 'plot.png', kind: 'image', content: '', bytes: Uint8Array.from(fixturePng()) },
    { path: 'plot.jpg', kind: 'image', content: '', bytes: Uint8Array.from(await readFile('scripts/fixtures/compiler-figure.jpg')) },
  ] },
  { name: 'missing citation', warning: /Citation|database entry/, files: [{ path: 'main.tex', content: tex(String.raw`Missing \cite{absent}.\bibliographystyle{plain}\bibliography{references}`) }, { path: 'references.bib', content: '@book{other,title={Book},author={Author},year={2020},publisher={Press}}' }] },
  { name: 'missing package', failure: /not found|Emergency stop/, files: [{ path: 'main.tex', content: String.raw`\documentclass{article}\usepackage{scholaris-package-does-not-exist}\begin{document}Text\end{document}` }] },
  { name: 'bad command', failure: /Undefined control sequence/, files: [{ path: 'main.tex', content: tex(String.raw`\scholarisUnknownCommand`) }] },
  { name: 'unsupported Unicode', failure: /Unicode character|inputenc/, files: [{ path: 'main.tex', content: tex('বাংলা') }] },
  { name: 'missing database', warning: /database file|bibdata/, files: [{ path: 'main.tex', content: tex(String.raw`\cite{key}\bibliographystyle{plain}\bibliography{missing}`) }] },
  { name: 'malformed bibliography', warning: /expecting|error message|Warning/, files: [{ path: 'main.tex', content: tex(String.raw`\cite{broken}\bibliographystyle{plain}\bibliography{references}`) }, { path: 'references.bib', content: '@book{broken, title={Unclosed' }] },
]
for (const fixture of fixtures) {
  const start = performance.now()
  let result
  try { result = await compilePaper(fixture.files, new AbortController().signal, () => {}, factory, 120000) }
  catch (error) {
    if (!fixture.failure) throw error
    assert.match(error.log, fixture.failure, fixture.name)
    assert.ok(parseCompileDiagnostics(error.log, fixture.files.map(f => f.path)).length, 'Failure has actionable diagnostics')
  }
  if (fixture.failure) assert.equal(result, undefined, fixture.name)
  else {
    assert.ok(result.pdf.length > 1000, fixture.name)
    if (fixture.noBibErrors) assert.doesNotMatch(result.log, /I found no \\bib(?:data|style)|error messages|Citation .*undefined/)
    if (fixture.warning) { assert.match(result.log, fixture.warning, fixture.name); assert.ok(parseCompileDiagnostics(result.log, fixture.files.map(f => f.path)).length, result.log) }
  }
  console.log(`PASS ${fixture.name}: ${Math.round(performance.now() - start)} ms`)
}
// Rebuilding a new project cannot inherit localstyle.sty or auxiliary files.
await assert.rejects(compilePaper([{ path: 'main.tex', content: String.raw`\documentclass{article}\usepackage{localstyle}\begin{document}Text\end{document}` }], new AbortController().signal, () => {}, factory), error => /not found/.test(error.log))
for (let i = 0; i < 2; i++) {
  const start = performance.now()
  await compilePaper([{ path: 'main.tex', content: tex('Independent clean build.') }], new AbortController().signal, () => {}, factory)
  console.log(`Fresh worker / warm harness package cache, run ${i + 1}: ${Math.round(performance.now() - start)} ms`)
}
console.log('PASS compiler corpus and cross-project filesystem isolation; Node/WASM harness timings are not browser cold-cache benchmarks')
