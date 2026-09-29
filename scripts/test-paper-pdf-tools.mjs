import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const code = ts.transpileModule(await readFile('src/features/paper/pdf-tools.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { clampPdfPage, pdfScale, findPdfPages, layoutPdfPages, pdfAnchor, restorePdfAnchor, visiblePdfPages, safePdfUrl } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
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

const sizes = Array.from({ length: 1000 }, () => ({ width: 600, height: 800 }))
const rows = layoutPdfPages(sizes, 1)
const anchor = pdfAnchor(rows, rows[7].top + 320)
assert.deepEqual(anchor, { page: 8, fraction: .4 })
const zoomed = layoutPdfPages(sizes, 2)
assert.equal(restorePdfAnchor(zoomed, anchor), zoomed[7].top + 640)
const shortened = layoutPdfPages(sizes.slice(0, 3), 1)
assert.equal(restorePdfAnchor(shortened, anchor), shortened[2].top + 320)
assert.deepEqual(visiblePdfPages(rows, rows[500].top, 900), [499, 500, 501, 502])
assert.ok(visiblePdfPages(rows, 0, 100000).length <= 12, 'Canvas window stays bounded')
assert.deepEqual(visiblePdfPages([], 0, 800), [])
for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'file:///secret', '/relative']) assert.equal(safePdfUrl(url), null)
assert.equal(safePdfUrl('https://example.org/paper'), 'https://example.org/paper')
assert.equal(safePdfUrl('mailto:team@example.org'), 'mailto:team@example.org')
const multiple = { numPages: 1, async getPage() { return { async getTextContent() { return { items: [{ str: 'İ A.b a.b' }] } } } } }
assert.deepEqual((await findPdfPages(multiple, 'a.b', () => false)).map(hit => [hit.from, hit.to]), [[2, 5], [6, 9]])
assert.equal((await findPdfPages(multiple, 'İ', () => false))[0].from, 0)
console.log('PASS continuous layout, relative reading anchors, shorter recompiles, bounded visible canvas window, safe URLs and occurrence offsets')
