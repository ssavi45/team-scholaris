import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { unzipSync, strFromU8 } from 'fflate'

const js = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText
const url = text => 'data:text/javascript;base64,' + Buffer.from(text).toString('base64')
const compilerUrl = url(js(await readFile('src/features/paper/compiler.ts', 'utf8')))
const { createCompilerSession } = await import(compilerUrl)
const db = { id: 'snapshot-1', title: 'Fixture', main: 'sections/paper.tex', revision: 20,
  files: [{ id: 'file-1', path: 'sections/paper.tex', content: '\\documentclass{article}\nCaptured source', kind: 'text' },
    { path: 'references.bib', content: '@book{a,title={Captured}}', kind: 'text' }], shared: [], expiresAt: new Date(Date.now() + 300000).toISOString() }
const releases = [], requests = []
let hydrate, failure, afterRead
globalThis.snapshotFixture = {
  rpc: (name, args) => {
    if (name === 'release_paper_snapshot') { releases.push(args.p_snapshot); return Promise.resolve({ error: null }) }
    requests.push(args)
    return { abortSignal: async signal => { signal.throwIfAborted(); const copy = structuredClone(db); afterRead?.(); return { data: copy, error: null } } }
  },
  hydrate: async (files, signal) => { await hydrate?.(); signal.throwIfAborted(); if (failure) throw new Error(failure); return files },
}
const clientUrl = url('export const supabase = globalThis.snapshotFixture')
const apiUrl = url('export const hydrateFigures = (...args) => globalThis.snapshotFixture.hydrate(...args)')
const source = (await readFile('src/features/paper/paper-snapshot.ts', 'utf8')).replace("'../../lib/supabase'", JSON.stringify(clientUrl)).replace("'./paper-api'", JSON.stringify(apiUrl)).replace("'./compiler'", JSON.stringify(compilerUrl))
const { capturePaperSnapshot, matchesPaperBuild } = await import(url(js(source)))
let writes = [], main, engines = 0
const session = createCompilerSession(() => {
  engines++
  const worker = { terminate() {}, postMessage(message) {
    if (message.cmd === 'reset-workspace') { writes = []; queueMicrotask(() => worker.onmessage({ data: { cmd: 'reset-workspace', result: 'ok' } })) }
    if (message.cmd === 'writefile') writes.push(message)
    if (message.cmd === 'setmainfile') main = message.url
    if (message.cmd === 'compilelatex') queueMicrotask(() => worker.onmessage({ data: { cmd: 'compile', result: 'ok', status: 0, needsRerun: false, pdf: new TextEncoder().encode('%PDF-1.7\nFixture\n%%EOF').buffer, log: '' } }))
  } }
  queueMicrotask(() => worker.onmessage({ data: { result: 'ok' } }))
  return worker
})
try {
  afterRead = () => { db.revision++; db.files[0].content = 'Later live edit'; db.main = 'different.tex' }
  const cut = { fileId: 'file-1', epoch: 'fixture-epoch', sequence: 4 }
  const snapshot = await capturePaperSnapshot('project-fixture', new AbortController().signal, cut)
  assert.equal(snapshot.revision, 20); assert.equal(snapshot.main, 'sections/paper.tex')
  assert.equal(snapshot.files[0].content, '\\documentclass{article}\nCaptured source')
  assert.deepEqual(requests[0], { p_project: 'project-fixture', p_file: 'file-1', p_epoch: 'fixture-epoch', p_sequence: 4 })
  const compiled = await session.compile(snapshot.files, new AbortController().signal, () => {}, undefined, snapshot.main)
  assert.ok(writes.some(file => file.url === 'sections/paper.tex' && file.src === snapshot.files[0].content))
  assert.ok(writes.some(file => file.url === main && file.src.includes('sections/paper.tex')), 'Uses captured nested entry point')
  const build = { ...compiled, snapshot, revision: snapshot.revision, main: snapshot.main, id: 1 }
  assert.ok(matchesPaperBuild(snapshot, build))
  assert.equal(matchesPaperBuild({ ...snapshot, main: 'different.tex' }, build), false)
  assert.equal(matchesPaperBuild({ ...snapshot, files: [{ ...snapshot.files[0], content: 'Later edit' }] }, build), false)
  const exportUrl = url(js((await readFile('src/features/paper/paper-export.ts', 'utf8')).replace("'./compiler'", JSON.stringify(compilerUrl)).replace("'fflate'", JSON.stringify(import.meta.resolve('fflate')))))
  const { sourceArchive } = await import(exportUrl)
  const zip = unzipSync(await sourceArchive(build.snapshot.files, new AbortController().signal))
  assert.equal(strFromU8(zip['sections/paper.tex']), snapshot.files[0].content, 'PDF source ZIP remains exact after live edits')
  await session.compile(snapshot.files, new AbortController().signal, () => {}, undefined, snapshot.main)
  assert.equal(engines, 1, 'Snapshot compilation reuses the warmed engine')
  afterRead = undefined; failure = 'Download denied'
  await assert.rejects(capturePaperSnapshot('project-fixture', new AbortController().signal), /Download denied/)
  failure = undefined
  const cancel = new AbortController(); hydrate = async () => cancel.abort()
  await assert.rejects(capturePaperSnapshot('project-fixture', cancel.signal), { name: 'AbortError' })
  hydrate = undefined; db.expiresAt = new Date(Date.now() - 1).toISOString()
  await assert.rejects(capturePaperSnapshot('project-fixture', new AbortController().signal), /expired/)
  assert.equal(releases.length, 4, 'Every completed capture releases its figure lease on success/error/cancel/expiry')
  console.log('PASS immutable preparation, captured main/revision, matching PDF/source ZIP, stale detection, warmed engine reuse and lease cleanup')
} finally { session.dispose(); delete globalThis.snapshotFixture }
