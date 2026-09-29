import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const load = async file => import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(await readFile(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText).toString('base64'))
const { parseCompileDiagnostics: parse, describeCompileIssue } = await load('src/features/paper/compile-diagnostics.ts')
for (const [message, title] of [
  [String.raw`Underfull \hbox (badness 1460) at lines 41--42`, 'Loose spacing in a paragraph'],
  [String.raw`Overfull \hbox (2pt too wide)`, 'Content extends past the margin'],
  [String.raw`Underfull \vbox (badness 10000)`, 'Extra vertical space on a page'],
  ['LaTeX Warning: Citation missing undefined', 'Citation could not be found'],
]) {
  const issue = { message, severity: 'warning', hint: 'Check source', count: 1 }
  const original = { ...issue }
  assert.equal(describeCompileIssue(issue).title, title)
  assert.deepEqual(issue, original, 'presentation must preserve original diagnostics')
}
const paths = ['main.tex', 'sections/chapter.tex', 'references.bib']
let issues = parse('(main.tex\n(./sections/chapter.tex\n! Undefined control sequence.\nl.8 \\unknown\n)\nLaTeX Warning: Citation `missing\' on page 1 undefined on input line 12.\n\n)', paths)
assert.equal(issues[0].file, 'sections/chapter.tex'); assert.equal(issues[0].line, 8)
assert.equal(issues[1].file, 'main.tex'); assert.equal(issues[1].line, 12)
assert.match(issues[1].hint, /citation key/)
issues = parse('! Undefined control sequence.\nl.9 \\oops\n\n! Undefined control sequence.\nl.9 \\oops', paths)
assert.equal(issues.length, 1); assert.equal(issues[0].count, 2); assert.equal(issues[0].file, undefined)
assert.equal(parse('sections/chapter.tex:42: Undefined control sequence.', paths)[0].line, 42)
assert.equal(parse('/tex/article.cls:42: Some package error', paths)[0].file, undefined)
assert.match(parse("I couldn't open database file missing.bib", paths)[0].hint, /bibliography filename/)
assert.match(parse("I couldn't open style file missing.bst", paths)[0].hint, /bibliographystyle/)
assert.match(parse('I was expecting a comma or a right brace', paths)[0].hint, /missing commas/)
const { waitForPreparation, compilePaper } = await load('src/features/paper/compiler.ts')
const controller = new AbortController()
let finish
const save = new Promise(resolve => { finish = resolve })
const waiting = waitForPreparation(save, controller.signal)
controller.abort(); await assert.rejects(waiting, { name: 'AbortError' }); finish('saved')
assert.equal(await save, 'saved', 'Cancelling compilation must not cancel a draft save')
let terminated = false
const factory = () => {
  const worker = { postMessage() {}, terminate() { terminated = true } }
  queueMicrotask(() => worker.onmessage({ data: { cmd: 'resource-error', name: 'article.cls' } }))
  return worker
}
await assert.rejects(compilePaper([{ path: 'main.tex', content: '' }], new AbortController().signal, () => {}, factory), /dependency article.cls/)
assert.equal(terminated, true)
console.log('PASS nested and explicit diagnostic locations, unknown-source restraint, repeated issue grouping, bibliography hints, preparation cancellation and dependency failure cleanup')
