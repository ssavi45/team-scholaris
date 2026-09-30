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
  code = code.replace(/from '(@[^']+|fflate)'/g, (_, specifier) => `from '${import.meta.resolve(specifier)}'`)
  const url = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64'); urls.set(name, url); return url
}
const { planMove, reviewImport, figureSnippet, mainCandidates, insertFigure } = await import(await moduleUrl('asset-tools'))
const figureView = { state: EditorState.create({ doc: 'before selected after', extensions: [history()] }), dispatch(spec) { this.state = this.state.update(spec).state }, focus() {} }
const figureTarget = { doc: figureView.state.doc.toString(), from: 7, to: 15 }
insertFigure(figureView, 'FIGURE', figureTarget)
assert.equal(figureView.state.doc.toString(), 'before FIGURE after')
assert.equal(figureView.state.selection.main.head, 13)
assert.throws(() => insertFigure(figureView, 'STALE', figureTarget), /source changed/)
assert.equal(undo({ state: figureView.state, dispatch: tr => { figureView.state = tr.state } }), true)
assert.equal(figureView.state.doc.toString(), figureTarget.doc)
figureView.state = EditorState.create({ doc: figureTarget.doc, extensions: [EditorState.readOnly.of(true)] })
assert.throws(() => insertFigure(figureView, 'LOCKED', figureTarget), /read-only/)
assert.equal(figureView.state.doc.toString(), figureTarget.doc)
const { starterTemplate } = await import(await moduleUrl('starter-templates'))
const { imageDimensions, validateTree } = await import(await moduleUrl('file-tree'))
const source = (path, content) => ({path,content,kind:'text'})
const files = [source('main.tex', String.raw`\documentclass{article}
\input{chapters/intro}
% \input{chapters/intro}
\bibliography{references}`),source('chapters/intro.tex','Hello'),source('references.bib','')]
const move = planMove(files,'chapters','sections','main.tex')
assert.match(move.entries[0].content,/input\{sections\/intro\}/)
assert.match(move.entries[0].content,/% \\input\{chapters\/intro\}/)
assert.equal(move.entries[1].path,'sections/intro.tex')
assert.equal(files[1].path,'chapters/intro.tex')
assert.throws(()=>planMove(files,'chapters','../bad','main.tex'))
assert.throws(()=>reviewImport(files,[source('main.tex','New')],{}))
assert.equal(reviewImport(files,[source('main.tex','New')],{'main.tex':{action:'keep'}})[0].content, files[0].content)
assert.equal(reviewImport(files,[source('main.tex','New')],{'main.tex':{action:'replace'}})[0].content,'New')
assert.ok(reviewImport(files,[source('main.tex','New')],{'main.tex':{action:'rename',path:'new.tex'}}).some(e=>e.path==='new.tex'))
assert.match(figureSnippet('figures/a.png','10% & result','fig:result','main.tex'),/10\\% \\& result/)
assert.throws(()=>figureSnippet('a.png','x','bad}label','main.tex'))
for (const kind of ['article','report','thesis']) {
 const entries=starterTemplate(kind); validateTree(entries,'main.tex'); assert.deepEqual(mainCandidates(entries),['main.tex'])
 for(const entry of entries.filter(e=>e.kind==='image')) assert.deepEqual(imageDimensions(entry.path,entry.bytes),{width:1,height:1})
}
assert.throws(()=>imageDimensions('bad.jpg',new Uint8Array([255,216,255,217])))
const { sourceArchive } = await import(await moduleUrl('paper-export'))
const { readSourceZip } = await import(await moduleUrl('zip-import'))
const starter = starterTemplate('thesis')
const renamed = planMove(starter,'chapters/introduction.tex','chapters/background.tex','main.tex')
assert.match(renamed.entries[0].content,/chapters\/background/)
const archive = await sourceArchive(renamed.entries,new AbortController().signal)
const imported = readSourceZip(archive)
assert.deepEqual(imported.entries.map(e=>e.path).sort(),renamed.entries.map(e=>e.path).sort())
assert.equal(imported.entries.find(e=>e.path==='main.tex').content,renamed.entries[0].content)
assert.deepEqual(imported.entries.find(e=>e.kind==='image').bytes,starter.find(e=>e.kind==='image').bytes)
const nested = planMove([source('src/main.tex','\\input{chapters/intro}'),...files.slice(1)],'chapters','sections','src/main.tex')
assert.match(nested.entries[0].content,/sections\/intro/)
console.log('PASS asset move/import/figure/template checks')
if(process.argv.includes('--compile')) {
 const { Worker } = await import('node:worker_threads')
 const { compilePaper } = await import(await moduleUrl('compiler'))
 const factory = () => { const worker = new Worker(new URL('./lib/compiler-node-worker.mjs',import.meta.url)); const bridge={postMessage:value=>worker.postMessage(value),terminate:()=>void worker.terminate()}; worker.on('message',value=>bridge.onmessage?.({data:value})); worker.on('error',error=>bridge.onerror?.(error)); return bridge }
 for(const kind of ['article','report','thesis','renamed-import']) {
  const result=await compilePaper(kind === 'renamed-import' ? imported.entries : starterTemplate(kind),new AbortController().signal,()=>{},factory,180000).catch(error => { console.error(kind, error.message, error.log); process.exit(1) })
  assert.ok(result.pdf.length>0)
  assert.doesNotMatch(result.log,/Undefined control sequence|Fatal error|Citation .+ undefined/)
  console.log('PASS real compiler starter: '+kind)
 }
}
