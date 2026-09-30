import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { EditorState } from '@codemirror/state'
import { CompletionContext } from '@codemirror/autocomplete'
import { history, undo } from '@codemirror/commands'
const urls = new Map()
async function moduleUrl(name) {
  if (urls.has(name)) return urls.get(name)
  let code = ts.transpileModule(await readFile(`src/features/paper/${name}.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  for (const match of [...code.matchAll(/from '\.\/([^']+)'/g)]) code = code.replace(match[0], `from '${await moduleUrl(match[1])}'`)
  code = code.replace(/from '(@[^']+)'/g, (_, specifier) => `from '${import.meta.resolve(specifier)}'`)
  const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64'); urls.set(name, url); return url
}
const { parseBibFile, indexReferences, mergeBibImport, renameCitation, editBibFields, bibDisplay } = await import(await moduleUrl('references'))
const { referenceCompletions, insertReference } = await import(await moduleUrl('reference-completion'))
const file = (path, content) => ({ id: path, path, kind: 'text', content })
const raw = String.raw`% keep this comment
@string{pub = "Archive"}
@preamble{"preserved"}
@article{greenwade93,
 author = "George D. Greenwade",
 title = {The {C}omprehensive {TeX} {A}rchive {N}etwork ({CTAN})},
 journal = "TUGBoat", year = 1993,
 volume = {14}, number = {3}, pages = {342--351},
 custom = pub # { {nested} field},
 note = {An escaped \{ brace and \"accent}
}
@book(other, author = {Other Author}, title = "Other (Book)", year = 2026, publisher = pub)
`
const bib = file('references.bib', raw)
const parsed = parseBibFile(bib)
assert.deepEqual(parsed.notices, [])
assert.equal(parsed.entries.length, 2)
assert.equal(bibDisplay(parsed.entries[0], 'author'), 'George D. Greenwade')
assert.match(bibDisplay(parsed.entries[0], 'title'), /Comprehensive TeX/)
assert.equal(parsed.entries[0].raw, raw.slice(parsed.entries[0].from, parsed.entries[0].to))
assert.equal(editBibFields(raw, parsed.entries[0], {}), raw, 'no-op preserves every byte')
const edited = editBibFields(raw, parsed.entries[0], { year: '1994', doi: '10.1234/example' })
assert.match(edited, /year = \{1994\}/)
assert.ok(edited.includes('custom = pub # { {nested} field}'))
assert.ok(edited.includes('@string{pub = "Archive"}'))
assert.deepEqual(parseBibFile(file('refs.bib', edited)).notices, [])
assert.throws(() => editBibFields(raw, parsed.entries[0], { title: 'broken}' }), /Unbalanced/)
for (const malformed of ['@article{bad, title={unclosed}', '@article{bad,title={yes} year=2026}', '@article{bad,title="oops}', '@book{bad,title={a},title={b}}']) assert.ok(parseBibFile(file('bad.bib', malformed)).notices.length, malformed)
const noTrailingComma = '@book{a,title={A} % trailing comment\n}'
assert.deepEqual(parseBibFile(file('t.bib', editBibFields(noTrailingComma, parseBibFile(file('t.bib', noTrailingComma)).entries[0], { year: '2026' }))).notices, [])
const tex = file('main.tex', String.raw`\documentclass{article}
\begin{document}
\section{Intro}\label{sec:intro}
\cite{greenwade93, other} \citep[see][p. 1]{greenwade93} \ref{sec:intro}
% \cite{hidden}
\begin{verbatim}\cite{hidden}\end{verbatim}
\customcite{greenwade93}
\bibliographystyle{plain}\bibliography{references}
\end{document}`)
let index = indexReferences([tex, bib])
assert.equal(index.notices.length, 0)
assert.equal(index.uses.filter(use => use.kind === 'citation').length, 3)
assert.ok(index.unsupported.some(item => /customcite/.test(item.message)))
index = indexReferences([tex, bib, file('another.bib', '@book{greenwade93,title={Duplicate}}'), file('missing.tex', '\\cite{lost} \\ref{gone} \\label{sec:intro}')])
assert.ok(index.duplicateCitations.has('greenwade93')); assert.ok(index.duplicateLabels.has('sec:intro'))
assert.ok(index.notices.some(item => item.message === 'Missing citation: lost'))
const renamed = renameCitation([tex, bib], 'greenwade93', 'greenwade1993')
assert.equal(renamed.uses.length, 2)
assert.ok(renamed.entries[0].content.includes('\\cite{greenwade1993, other}'))
assert.ok(renamed.entries[0].content.includes('\\customcite{greenwade93}'), 'unsupported macro is left untouched and flagged')
assert.ok(renamed.entries[0].content.includes('% \\cite{hidden}'))
assert.match(renamed.entries[1].content, /@article\{greenwade1993,/)
assert.throws(() => renameCitation([tex, bib], 'greenwade93', 'other'), /unused/)
assert.equal(bib.content, raw, 'preview must not mutate source')
const incoming = '@article{greenwade93,title={Replacement},author={A},year={2026}}\n@misc{fresh,title={New},custom={untouched}}'
assert.throws(() => mergeBibImport([bib], bib.path, incoming, {}), /Choose how/)
assert.ok(mergeBibImport([bib], bib.path, incoming, { greenwade93: { action: 'keep' } })[0].content.includes(parsed.entries[0].raw))
const replaced = mergeBibImport([bib], bib.path, incoming, { greenwade93: { action: 'replace' } })[0]
assert.equal(parseBibFile(replaced).entries.filter(entry => entry.key === 'greenwade93').length, 1)
assert.equal(bibDisplay(parseBibFile(replaced).entries[0], 'title'), 'Replacement')
assert.ok(replaced.content.includes('@string{pub = "Archive"}'))
assert.ok(mergeBibImport([bib], bib.path, incoming, { greenwade93: { action: 'rename', key: 'greenwadeCopy' } })[0].content.includes('@article{greenwadeCopy,'))
assert.throws(() => mergeBibImport([bib], bib.path, incoming, { greenwade93: { action: 'rename', key: 'fresh' } }), /unused/)
assert.throws(() => mergeBibImport([bib], bib.path, incoming + incoming, {}), /duplicate keys/)
const specialKey = file('special.bib', '@book{constructor,title={Original}}')
assert.throws(() => mergeBibImport([specialKey], specialKey.path, '@book{constructor,title={Replacement}}', {}), /Choose how/, 'inherited object properties must never select replacement')
assert.throws(() => mergeBibImport([bib], bib.path, incoming, { greenwade93: { action: 'unknown' } }), /Choose how/)
assert.ok(renameCitation([file('custom.tex', '\\mycitation{greenwade93}'), bib], 'greenwade93', 'newKey').warnings.some(item => /outside a supported/.test(item.message)))
const complete = (doc, readOnly = false) => referenceCompletions(new CompletionContext(EditorState.create({ doc, extensions: [EditorState.readOnly.of(readOnly)] }), doc.length, true), indexReferences([tex, bib]))
assert.ok(complete('\\cite{gree').options.some(item => item.label === 'greenwade93'))
assert.equal(complete('\\cite{other, gree').from, 13)
assert.equal(complete('\\ref{sec:').options[0].label, 'sec:intro')
assert.equal(complete('% \\cite{gree'), null)
assert.equal(complete('\\cite{gree', true), null)
assert.equal(complete('\\\\cite{gree'), null, 'escaped command does not complete')
const view = { state: EditorState.create({ doc: 'A selected B', selection: { anchor: 2, head: 10 }, extensions: [history()] }), dispatch(spec) { this.state = this.state.update(spec).state }, focus() {} }
assert.equal(insertReference(view, 'greenwade93', 'cite'), true)
assert.equal(view.state.doc.toString(), 'A \\cite{greenwade93} B')
assert.equal(undo({ state: view.state, dispatch: tr => { view.state = tr.state } }), true)
assert.equal(view.state.doc.toString(), 'A selected B')
assert.equal(insertReference(view, 'bad}key', 'cite'), false)
view.state = EditorState.create({ doc: 'read only', extensions: [EditorState.readOnly.of(true)] })
assert.equal(insertReference(view, 'greenwade93', 'cite'), false)
assert.equal(view.state.doc.toString(), 'read only')
console.log('PASS BibTeX preservation, malformed/nested/quoted fixtures, field edits, duplicate import choices, rename preview, missing keys and completion')

if (process.argv.includes('--compile')) {
  const { Worker } = await import('node:worker_threads')
  const { compilePaper } = await import(await moduleUrl('compiler'))
  const compilerFactory = () => {
    const worker = new Worker(new URL('./lib/compiler-node-worker.mjs', import.meta.url))
    const bridge = { postMessage: value => worker.postMessage(value), terminate: () => void worker.terminate() }
    worker.on('message', value => bridge.onmessage?.({ data: value })); worker.on('error', error => bridge.onerror?.(error))
    return bridge
  }
  const main = file('main.tex', String.raw`\documentclass{article}\begin{document}CTAN research \cite{greenwade93}.\bibliographystyle{plain}\bibliography{references}\end{document}`)
  const empty = file('references.bib', '')
  assert.ok(indexReferences([main, empty]).notices.some(item => item.message.includes('greenwade93')))
  const repaired = mergeBibImport([main, empty], 'references.bib', parsed.entries[0].raw.replace('custom = pub # { {nested} field},', ''), {})
  const result = await compilePaper(repaired, new AbortController().signal, () => {}, compilerFactory, 180000)
  assert.doesNotMatch(result.log, /Citation .+ undefined|didn't find a database entry|Empty.*thebibliography/)
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({ data: result.pdf.slice(), isEvalSupported: false })
  try {
    const pdf = await task.promise
    const text = (await (await pdf.getPage(1)).getTextContent()).items.map(item => item.str ?? '').join(' ')
    assert.match(text, /Greenwade/); assert.match(text, /1993/)
  } finally { await task.destroy() }
  console.log('PASS greenwade93 repair through import planner and real WASM bibliography compilation/PDF text')
}
