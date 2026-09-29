import assert from 'node:assert/strict'
import { Worker } from 'node:worker_threads'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const worker = new Worker(new URL('./lib/compiler-node-worker.mjs', import.meta.url))
let receive
const wait = () => new Promise((resolve, reject) => { receive = { resolve, reject } })
worker.on('error', error => receive?.reject(error))
worker.on('message', data => { if (data.cmd !== 'package') receive?.resolve(data) })
const timeout = setTimeout(() => { receive?.reject(new Error('Probe timed out')); void worker.terminate() }, 180000)
try {
  assert.equal((await wait()).result, 'ok')
  worker.postMessage({ cmd: 'mkdir', url: 'paper' })
  worker.postMessage({ cmd: 'writefile', url: 'main.tex', src: '\\input{paper/article.tex}' })
  worker.postMessage({ cmd: 'writefile', url: 'paper/article.tex', src: String.raw`\ifdefined\synctex\synctex=1\message{SCHOLARIS-SYNCTEX-AVAILABLE}\else\message{SCHOLARIS-SYNCTEX-UNAVAILABLE}\fi
\documentclass{article}\usepackage{hyperref}\begin{document}\input{chapter}\cite{test}\bibliographystyle{plain}\bibliography{references}` + Array.from({ length: 11 }, (_, i) => `\\newpage\\section{Chapter ${i + 2}}Reading fixture ${i + 2}. \\href{https://example.org}{Safe reference}`).join('\n') + '\\end{document}' })
  worker.postMessage({ cmd: 'writefile', url: 'chapter.tex', src: '\\section{Nested chapter}Source mapping probe.' })
  worker.postMessage({ cmd: 'writefile', url: 'references.bib', src: '@book{test,author={Test Author},title={Probe},year={2026},publisher={Test}}' })
  worker.postMessage({ cmd: 'setmainfile', url: 'main.tex' })
  // Setup acknowledgements precede compile responses; consume only compile output.
  let pdfBytes
  for (let pass = 0; pass < 3; pass++) {
    worker.postMessage({ cmd: 'compilelatex' })
    let result
    do { result = await wait() } while (result.cmd !== 'compile')
    assert.equal(result.status, 0, result.log)
    pdfBytes = new Uint8Array(result.pdf)
    if (pass === 2) console.log(result.log.match(/SCHOLARIS-SYNCTEX-(?:UNAVAILABLE|AVAILABLE)/)?.[0] ?? 'Primitive availability not reported')
  }
  worker.postMessage({ cmd: 'inspect-synctex' })
  const result = await wait()
  console.log(JSON.stringify(result))
  console.log('Probe compiled nested main, included chapter and bibliography; exact mapping requires usable SyncTeX output.')
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({ data: pdfBytes })
  try {
    const pdf = await task.promise
    assert.equal(pdf.numPages, 12)
    const outline = await pdf.getOutline()
    assert.ok(outline.length >= 11)
    const destination = typeof outline[0].dest === 'string' ? await pdf.getDestination(outline[0].dest) : outline[0].dest
    assert.ok(destination)
    assert.ok((await (await pdf.getPage(2)).getAnnotations()).some(item => item.url === 'https://example.org/'))
    const code = ts.transpileModule(await readFile('src/features/paper/pdf-tools.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
    const { findPdfPages } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
    const hits = await findPdfPages(pdf, 'Reading fixture 8', () => false)
    assert.equal(hits[0].page, 8)
    assert.ok(hits[0].to > hits[0].from)
    console.log('PASS actual 12-page PDF: text occurrence search, bookmarks, destinations and external link annotations')
  } finally { await task.destroy() }
} finally { clearTimeout(timeout); await worker.terminate() }
