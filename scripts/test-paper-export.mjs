import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import ts from 'typescript'

const compile = (text) => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText
const asUrl = (text) => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64')
const compiler = asUrl(compile(await readFile('src/features/paper/compiler.ts', 'utf8')))
const source = (await readFile('src/features/paper/paper-export.ts', 'utf8')).replace("'./compiler'", JSON.stringify(compiler)).replace("'fflate'", JSON.stringify(import.meta.resolve('fflate')))
const { downloadName, exportSources, sourceArchive, pdfDownload, requestDownload } = await import(asUrl(compile(source)))
const files = [
  { path: 'main.tex', content: '\\documentclass{article}\nSaved source\n', privateMetadata: 'must not export' },
  { path: 'sections/research.tex', content: 'Unicode: café — বাংলা\n' },
  { path: 'references.bib', content: '' },
]
const draft = { path: 'main.tex', content: '\\documentclass{article}\nUnsaved draft\n' }
const snapshot = exportSources(files, draft, true)
assert.equal(snapshot[0].content, draft.content)
assert.equal(files[0].content, '\\documentclass{article}\nSaved source\n', 'Export leaves the saved source unchanged')
assert.deepEqual(Object.keys(snapshot[0]).sort(), ['content', 'path'], 'Only source paths and content leave the workspace')
assert.equal(exportSources(files, draft, false)[0].content, files[0].content)
assert.throws(() => exportSources(files, { path: 'missing.tex', content: '' }, true))
assert.throws(() => exportSources([...files, { path: '../escape.tex', content: '' }], null, false))
assert.throws(() => exportSources([...files, { path: 'main.tex', content: '' }], null, false))
assert.throws(() => exportSources(files, { path: 'main.tex', content: 'x'.repeat(524289) }, true))
const archive = await sourceArchive(snapshot, new AbortController().signal)
const decoded = unzipSync(archive)
assert.deepEqual(Object.keys(decoded).sort(), files.map((file) => file.path).sort())
for (const file of snapshot) assert.equal(strFromU8(decoded[file.path]), file.content)
await writeFile(join(tmpdir(), 'scholaris-source-export-test.zip'), archive)

const cancelled = new AbortController()
cancelled.abort()
await assert.rejects(sourceArchive(snapshot, cancelled.signal), { name: 'AbortError' })
const running = new AbortController()
const promise = sourceArchive([{ path: 'main.tex', content: 'x'.repeat(500000) }], running.signal)
running.abort()
await assert.rejects(promise, { name: 'AbortError' })
const pdf = new TextEncoder().encode('%PDF-1.7\ncompiled bytes\n%%EOF')
const blob = pdfDownload(pdf)
assert.equal(blob.type, 'application/pdf')
assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), pdf)
assert.throws(() => pdfDownload(new TextEncoder().encode('not a PDF')))
assert.equal(downloadName('../../My paper: <draft>', 'source'), 'My-paper-draft-source.zip')
assert.equal(downloadName('CON', 'pdf'), 'paper-CON.pdf')
assert.equal(downloadName('Paper', 'pdf', true), 'Paper-last-compiled.pdf')
assert.equal(downloadName('', 'pdf'), 'scholaris-paper.pdf')
assert.ok(downloadName('x'.repeat(300), 'source').length < 100)

const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL, timer: globalThis.setTimeout, document: globalThis.document }
let removed = 0; let clicked = 0; const revoked = []; const delayed = []
try {
  URL.createObjectURL = () => 'blob:test'
  URL.revokeObjectURL = (url) => revoked.push(url)
  globalThis.setTimeout = (callback, delay) => { delayed.push({ callback, delay }); return 1 }
  const link = { remove() { removed++ }, click() { clicked++ } }
  globalThis.document = { createElement: () => link, body: { append() {} } }
  requestDownload(blob, 'paper.pdf')
  assert.equal(link.download, 'paper.pdf'); assert.equal(link.href, 'blob:test')
  assert.equal(clicked, 1); assert.equal(removed, 1)
  assert.equal(revoked.length, 0, 'URL survives until browser has consumed it')
  assert.equal(delayed[0].delay, 60000); delayed[0].callback()
  assert.deepEqual(revoked, ['blob:test'])
  link.click = () => { throw new Error('Download blocked') }
  assert.throws(() => requestDownload(blob, 'paper.pdf'), /Download blocked/)
  assert.equal(removed, 2); assert.equal(revoked.length, 2)
} finally {
  URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke
  globalThis.setTimeout = original.timer; globalThis.document = original.document
}
console.log('PASS ZIP paths/UTF-8/empty bibliography, draft inclusion/exclusion, immutable snapshots, filename sanitization, PDF bytes, export cancellation, download cleanup')
