import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const code = ts.transpileModule(await readFile('src/features/paper/pdf-tools.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { clampPdfPage, pdfScale, findPdfPages } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
assert.equal(clampPdfPage(8, 3), 3, 'shorter recompile clamps the retained page')
assert.equal(clampPdfPage(-2, 3), 1)
assert.equal(clampPdfPage(NaN, 3), 1)
assert.equal(pdfScale('page', 1, { width: 600, height: 400 }, { width: 600, height: 800 }), .5)
assert.equal(pdfScale('page', 1, { width: 600, height: 400 }, { width: 800, height: 600 }), 2 / 3, 'rotated page fits both dimensions')
assert.equal(pdfScale('width', 1, { width: 600, height: 400 }, { width: 800, height: 600 }), .75)
assert.equal(pdfScale('custom', 1.5, { width: 600, height: 400 }, { width: 800, height: 600 }), 1.5)
let reads = []
const pdf = { numPages: 3, async getPage(page) { reads.push(page); return { async getTextContent() { return { items: [{ str: ['A Research paper', 'Literal [sample] text', 'RESEARCH findings'][page - 1] }] } } } } }
assert.deepEqual((await findPdfPages(pdf, ' research ', () => false)).map(hit => hit.page), [1, 3])
assert.deepEqual((await findPdfPages(pdf, '[sample]', () => false)).map(hit => hit.page), [2], 'query is literal, not a regex')
assert.deepEqual(await findPdfPages(pdf, 'missing', () => false), [])
reads = []
assert.deepEqual(await findPdfPages(pdf, ' ', () => false), [])
assert.deepEqual(reads, [])
assert.deepEqual(await findPdfPages(pdf, 'research', () => reads.length > 0), [])
assert.deepEqual(reads, [1], 'cancelled search stops before reading more pages')
console.log('PASS PDF page clamping, fit/rotation geometry, literal multi-page search, empty query and cancellation')
