import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { Worker } from 'node:worker_threads'
import { createClient } from '@supabase/supabase-js'
import ts from 'typescript'
import { fixturePng } from './lib/fixture-png.mjs'
process.on('uncaughtException', error => { console.error(error.message, error.log ?? ''); process.exit(1) })

const env = parseEnv(await readFile('.env.local', 'utf8'))
assert.equal(env.VITE_SUPABASE_URL, 'http://127.0.0.1:54321', 'Local tests only')
const client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
const sql = query => execFileSync('docker', ['exec', '-i', 'supabase_db_team-scholaris', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
const ok = (result, label) => { assert.equal(result.error, null, label); return result.data }
let userId, projectId, asset
try {
  const email = `history-${randomUUID()}@example.test`, password = randomUUID() + 'Aa1!'
  userId = ok(await client.auth.signUp({ email, password }), 'Sign up fixture').user.id
  sql(`update auth.users set email_confirmed_at=now() where id='${userId}';`)
  ok(await client.auth.signInWithPassword({ email, password }), 'Sign in fixture')
  projectId = ok(await client.rpc('create_project', { project_name: 'History integration fixture' }).single(), 'Project').id
  ok(await client.rpc('initialize_paper', { p_project_id: projectId }), 'Initialize')
  const state = async () => ({ files: ok(await client.from('paper_files').select('*').eq('project_id', projectId), 'Files'), settings: ok(await client.from('paper_workspaces').select('*').eq('project_id', projectId).single(), 'Settings') })
  const apply = (s, files) => client.rpc('apply_paper_manifest', { p_project_id: projectId, p_revision: s.settings.revision, p_entries: files, p_main_file: 'main.tex' })
  asset = `${projectId}/${randomUUID()}.png`
  const png = fixturePng()
  ok(await client.storage.from('paper-figures').upload(asset, png, { contentType: 'image/png' }), 'Upload real figure')
  let s = await state()
  ok(await apply(s, [...s.files.map(f => f.path === 'main.tex' ? { ...f, content: String.raw`\documentclass{article}\usepackage{graphicx}\begin{document}\input{sections/chapter}\includegraphics{figures/plot.png}\end{document}` } : f), { path: 'sections/chapter.tex', kind: 'text', content: 'Recovered chapter from history.' }, { path: 'figures/plot.png', kind: 'image', content: '', storage_path: asset }]), 'Register chapter and figure')
  s = await state()
  const snapshotId = ok(await client.rpc('create_paper_checkpoint', { p_project_id: projectId, p_revision: s.settings.revision, p_label: 'Compile this recovered paper' }), 'Checkpoint')
  ok(await apply(s, s.files.filter(f => !f.path.includes('/'))), 'Delete chapter and figure')
  await client.storage.from('paper-figures').remove([asset])
  assert.equal(ok(await client.storage.from('paper-figures').download(asset), 'History retains real figure').size, png.length)
  s = await state()
  ok(await client.rpc('restore_paper_history', { p_project_id: projectId, p_history_id: snapshotId, p_revision: s.settings.revision }), 'Restore complete paper')
  const stale = await client.rpc('restore_paper_history', { p_project_id: projectId, p_history_id: snapshotId, p_revision: s.settings.revision })
  assert.equal(stale.status, 409, 'Stale restore returns a usable HTTP conflict, not a retryable outage')
  assert.equal(stale.error?.code, 'PT409')
  s = await state()
  const files = await Promise.all(s.files.map(async f => f.kind === 'image' ? { ...f, bytes: new Uint8Array(await ok(await client.storage.from('paper-figures').download(f.storage_path), 'Download restored figure').arrayBuffer()) } : f))
  assert.deepEqual(Buffer.from(files.find(f => f.kind === 'image').bytes), png)
  const code = ts.transpileModule(await readFile('src/features/paper/compiler.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText
  const { compilePaper } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
  const factory = () => {
    const worker = new Worker(new URL('./lib/compiler-node-worker.mjs', import.meta.url))
    const bridge = { postMessage: data => worker.postMessage(data), terminate: () => { void worker.terminate() } }
    worker.on('message', data => bridge.onmessage?.({ data })); worker.on('error', error => { console.error(error.message); bridge.onerror?.(error) })
    return bridge
  }
  const result = await compilePaper(files, new AbortController().signal, () => {}, factory, 180000, s.settings.main_file)
  assert.ok(result.pdf.length > 1000)
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({ data: result.pdf.slice(), isEvalSupported: false })
  const pdf = await task.promise
  const text = (await (await pdf.getPage(1)).getTextContent()).items.map(item => item.str ?? '').join(' ')
  assert.match(text, /Recovered chapter from history/)
  await task.destroy()
  console.log('PASS authenticated history, retained real Storage figure, whole-paper recovery, stale retry rejection and actual restored WASM PDF compilation')
} finally {
  if (projectId) {
    sql(`delete from public.paper_history where project_id='${projectId}'; delete from public.paper_files where project_id='${projectId}';`)
    if (asset) ok(await client.storage.from('paper-figures').remove([asset]), 'Fixture figure cleanup')
    sql(`delete from public.projects where id='${projectId}';`)
  }
  await client.auth.signOut()
  if (userId) sql(`delete from auth.users where id='${userId}';`)
}
