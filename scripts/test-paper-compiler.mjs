import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import ts from 'typescript'
process.on('uncaughtException', (error) => { console.error(error.message, error.log ?? ''); process.exit(1) })

const source = await readFile('src/features/paper/compiler.ts', 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText
const { compilePaper, validateSources } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
let terminated = 0
function factory() {
  const worker = new Worker(new URL('./lib/compiler-node-worker.mjs', import.meta.url))
  const bridge = { postMessage: (data) => worker.postMessage(data), terminate: () => { terminated++; void worker.terminate() } }
  worker.on('message', (data) => bridge.onmessage?.({ data }))
  worker.on('error', (error) => { console.error(error.message); bridge.onerror?.(error) })
  return bridge
}
const files = [
  { path: 'main.tex', content: String.raw`\documentclass{article}
\usepackage{amsmath}
\title{Scholaris compilation test}
\begin{document}
\maketitle
\input{sections/introduction}
An equation: $E=mc^2$. See Section~\ref{sec:research} and \cite{knuth}.
\bibliographystyle{plain}
\bibliography{references}
\newpage
Second page of the research paper.
\end{document}` },
  { path: 'sections/introduction.tex', content: String.raw`\section{Research}\label{sec:research}Nested source is included.` },
  { path: 'references.bib', content: '@book{knuth, author={Donald Knuth}, title={The TeXbook}, year={1984}, publisher={Addison-Wesley}}' },
]
assert.throws(() => validateSources([{ path: '../main.tex', content: '' }]))
assert.throws(() => validateSources([...files, { path: 'main.tex/child.tex', content: '' }]))
let previous = ''
const progress = (text) => { if (text !== previous) { console.log(text); previous = text } }
const result = await compilePaper(files, new AbortController().signal, progress, factory, 180000)
assert.ok(result.pdf.length > 1000)
assert.doesNotMatch(result.log, /Citation .+ undefined|Reference .+ undefined/)
const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
const pdfTask = getDocument({ data: result.pdf.slice(), isEvalSupported: false })
const pdf = await pdfTask.promise
assert.equal(pdf.numPages, 2)
let text = ''
for (let i = 1; i <= pdf.numPages; i++) text += (await (await pdf.getPage(i)).getTextContent()).items.map((item) => item.str ?? '').join(' ')
assert.match(text, /Nested source is included/)
assert.match(text, /The TeXbook/)
await pdfTask.destroy()
await writeFile(join(tmpdir(), 'scholaris-compiler-test.pdf'), result.pdf)
await assert.rejects(compilePaper([{ path: 'main.tex', content: String.raw`\documentclass{article}\begin{document}\undefinedScholarisCommand\end{document}` }], new AbortController().signal, () => {}, factory), (error) => /Undefined control sequence/.test(error.log))
await assert.rejects(compilePaper(files, new AbortController().signal, () => {}, factory, 1), /timed out/)
const cancel = new AbortController()
const pending = compilePaper(files, cancel.signal, () => {}, factory)
cancel.abort()
await assert.rejects(pending, { name: 'AbortError' })
assert.equal(terminated, 4, 'Every successful, failed, timed out or cancelled job terminates its worker')
console.log('PASS real WASM compilation, nested source, math, BibTeX, cross-references, two-page PDF parsing, syntax failure, timeout, cancellation, worker cleanup')
