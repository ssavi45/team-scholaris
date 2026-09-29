import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { EditorState, EditorSelection } from '@codemirror/state'
import { history, undo } from '@codemirror/commands'

async function load(name) {
  let code = ts.transpileModule(await readFile(`src/features/paper/${name}.ts`, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  code = code.replace(/from '(@[^']+)'/g, (_, specifier) => `from '${import.meta.resolve(specifier)}'`)
  return import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
}
const { buildOutline, searchProject, replacementPreview, approximateWords } = await load('editor-tools')
const file = (id, content, kind = 'text') => ({ id, path: `${id}.tex`, kind, content, version: 7 })
const files = [file('main', '\\section{Intro}\n% \\section{Hidden}\n\\input{sections/method}\n\\input{missing}'), file('sections/method', '\\section{Method}\n\\input{main}\n\\begin{verbatim}\\section{Hidden}\\end{verbatim}')]
assert.deepEqual(buildOutline(files, 'main.tex').headings.map(h => [h.title, h.path]), [['Intro', 'main.tex'], ['Method', 'sections/method.tex']])
assert.deepEqual(buildOutline(files, 'main.tex').unresolved, ['missing.tex'])
const sources = [file('a', 'İ\nA.b a.b\nnext'), file('b', 'A.b'), file('image', 'A.b', 'image')]
const hits = searchProject(sources, 'a.b', false).hits
assert.equal(hits.length, 3)
assert.deepEqual(hits.map(h => [h.from, h.line]), [[2, 2], [6, 2], [0, 1]])
assert.equal(searchProject(sources, 'a.b', true).hits.length, 1)
assert.equal(searchProject([file('a', 'x'.repeat(501))], 'x', true).truncated, true)
const preview = replacementPreview(sources, 'a.b', '$&', false)
assert.equal(preview.count, 3)
assert.equal(preview.entries[0].content, 'İ\n$& $&\nnext')
assert.equal(preview.entries[0].version, 7)
assert.equal(preview.entries[2], sources[2])
assert.equal(sources[0].content, 'İ\nA.b a.b\nnext', 'Preview must not mutate input')
assert.throws(() => replacementPreview(sources, '', 'x', false))
assert.throws(() => replacementPreview([file('a', 'x'.repeat(10001))], 'x', 'y', true))
assert.equal(approximateWords('Hello \\textbf{world}. % hidden words\n$x+y$ \\cite{greenwade93}'), 2)
const prefs = await load('editor-preferences')
assert.equal(prefs.normalizePreferences({ fontSize: 90, split: -1 }).fontSize, 24)
assert.equal(prefs.normalizePreferences({ fontSize: NaN, split: -1 }).split, 25)
const storage = new Map()
globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) }
prefs.saveEditorPreferences('one', { ...prefs.defaultPreferences, fontSize: 20 })
assert.equal(prefs.readEditorPreferences('one').fontSize, 20)
assert.equal(prefs.readEditorPreferences('two').fontSize, 14)
storage.set('scholaris:editor:one', 'invalid JSON')
assert.equal(prefs.readEditorPreferences('one').fontSize, 14)
const { insertSnippet } = await load('editor-snippets')
const view = { state: EditorState.create({ doc: 'hello', selection: EditorSelection.range(0, 5), extensions: [history()] }), dispatch(spec) { this.state = this.state.update(spec).state }, focus() {} }
assert.equal(insertSnippet(view, 0), true)
assert.equal(view.state.doc.toString(), '\\textbf{hello}')
assert.equal(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to), 'hello')
assert.equal(undo({ state: view.state, dispatch: tr => { view.state = tr.state } }), true)
assert.equal(view.state.doc.toString(), 'hello')
view.state = EditorState.create({ doc: 'locked', extensions: [EditorState.readOnly.of(true)] })
assert.equal(insertSnippet(view, 0), false)
assert.equal(view.state.doc.toString(), 'locked')
console.log('Paper editor: outline, literal search/replacement, word count, preferences, snippet undo and read-only checks passed.')
