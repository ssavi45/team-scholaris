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

const { readEquation, equationSource, equationTemplates, amsmathEdit, hasAmsmath, checkEquationLabels, insertEquation } = await import(await moduleUrl('equations'))
const katex = (await import('katex')).default
const base = { body: String.raw`\frac{a}{b}`, mode:'display', numbered:false, label:'' }
assert.equal(equationSource({...base,mode:'inline'}),String.raw`\(\frac{a}{b}\)`)
for(const mode of ['inline','display','numbered','align']) {
 const draft={...base,mode,numbered:mode==='align',label:mode==='numbered'?'eq:test':''}
 assert.equal(readEquation(equationSource(draft)).body,base.body)
}
const multiline=String.raw`\begin{align}a &= b \label{eq:first} \\ c &= d\end{align}`
assert.match(readEquation(multiline).body,/label/,'do not move a first-row label to the final row')
assert.equal(readEquation('$x+y$').mode,'inline')
assert.equal(readEquation('$$x+y$$').mode,'display')
assert.throws(()=>equationSource({...base,body:''}))
assert.throws(()=>equationSource({...base,mode:'numbered',label:'bad}label'}))
assert.throws(()=>checkEquationLabels(String.raw`\label{eq:x}`,String.raw`\label {eq:x}`))
assert.doesNotThrow(()=>checkEquationLabels(String.raw`\label{eq:x}`,String.raw`% \label{eq:x}`))
const doc=String.raw`\documentclass{article}
% \usepackage{amsmath}
\begin{document}
Hello
\end{document}`
assert.equal(hasAmsmath(doc),false)
const edit=amsmathEdit(doc), patched=doc.slice(0,edit.from)+edit.insert+doc.slice(edit.to)
assert.ok(hasAmsmath(patched)); assert.equal(amsmathEdit(patched),null)
assert.throws(()=>amsmathEdit('chapter source'))
const options={throwOnError:true,trust:false,strict:'error',maxExpand:500,maxSize:20}
for(const item of equationTemplates) {
 const text=item.mode==='align'?String.raw`\begin{aligned}`+item.text+String.raw`\end{aligned}`:item.text
 assert.ok(katex.renderToString(text,options).includes('katex'))
 if(item.at!==undefined) assert.equal(item.text.slice(item.at,item.at+item.select.length),item.select)
}
assert.throws(()=>katex.renderToString(String.raw`\notSupportedByPreview`,options))
const untrusted=katex.renderToString(String.raw`\href{https://example.com}{x}`,{...options,strict:'ignore',throwOnError:false})
assert.doesNotMatch(untrusted,/<a /)
const view={ state:EditorState.create({doc:'Before selected after',selection:{anchor:7,head:15},extensions:[history()]}), dispatch(spec){this.state=spec.state??this.state.update(spec).state},focus(){} }
const target={doc:view.state.doc.toString(),from:7,to:15}
insertEquation(view,base,target)
assert.ok(view.state.doc.toString().includes(equationSource(base)))
assert.ok(undo({state:view.state,dispatch:tr=>{view.state=tr.state}}))
assert.equal(view.state.doc.toString(),target.doc)
assert.throws(()=>insertEquation(view,base,{...target,doc:'stale'}))
view.state=EditorState.create({doc:target.doc,extensions:[EditorState.readOnly.of(true)]})
assert.throws(()=>insertEquation(view,base,target))
console.log('PASS equation modes, templates/preview, safe labels, preamble setup, selection replacement, undo, stale/read-only guards')
if(process.argv.includes('--compile')) {
 const { Worker }=await import('node:worker_threads')
 const { compilePaper }=await import(await moduleUrl('compiler'))
 const factory=()=>{const worker=new Worker(new URL('./lib/compiler-node-worker.mjs',import.meta.url));const bridge={postMessage:value=>worker.postMessage(value),terminate:()=>void worker.terminate()};worker.on('message',value=>bridge.onmessage?.({data:value}));worker.on('error',error=>bridge.onerror?.(error));return bridge}
 const body=equationTemplates.map(item=>equationSource({...base,body:item.text,mode:item.mode??'display'})).join('\n')
 const content=String.raw`\documentclass{article}\usepackage{amsmath}\begin{document}`+body+'\n'+equationSource({...base,mode:'numbered',label:'eq:ratio'})+'\n'+String.raw`Inline: `+equationSource({...base,mode:'inline'})+String.raw`\end{document}`
 const result=await compilePaper([{path:'main.tex',kind:'text',content}],new AbortController().signal,()=>{},factory,180000).catch(error=>{console.error(error.message,error.log);process.exit(1)})
 assert.ok(result.pdf.length);assert.doesNotMatch(result.log,/Undefined control sequence|Missing \$ inserted|Fatal error/)
 console.log('PASS real LaTeX compilation of equation layouts and all building blocks')
}
