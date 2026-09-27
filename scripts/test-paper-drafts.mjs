import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const code = ts.transpileModule(await readFile('src/features/paper/draft-store.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { PaperDraftStore } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const wait = () => new Promise(resolve => setTimeout(resolve, 25))
const file = (id = 'a', content = 'base', version = 1) => ({ id, path: `${id}.tex`, kind: 'text', content, version, updated_at: '2026-09-27T00:00:00Z' })
const make = (overrides = {}) => {
  const remote = new Map([['a', file()], ['b', file('b')]])
  const writes = []
  const store = new PaperDraftStore({
    persist: async document => { writes.push(document.text) },
    latest: async id => remote.get(id) ?? null,
    save: async (base, text) => {
      const current = remote.get(base.id)
      if (current.version !== base.version) throw new Error('Conflict')
      const next = { ...current, content: text, version: current.version + 1 }
      remote.set(base.id, next); return next
    }, ...overrides,
  }, 5)
  store.configure(true, true); store.reconcile([...remote.values()])
  return { store, remote, writes }
}

{
  const { store, remote } = make()
  store.edit('a', 'chapter A'); store.edit('b', 'chapter B')
  await wait()
  assert.equal(remote.get('a').content, 'chapter A'); assert.equal(remote.get('b').content, 'chapter B')
  assert.equal(store.getSnapshot().a.saving, false)
  store.stop()
}
{
  let release; let calls = 0
  const { store } = make({ save: async (base, text) => {
    calls++
    if (calls === 1) await new Promise(resolve => { release = resolve })
    return { ...base, content: text, version: base.version + 1 }
  } })
  store.edit('a', 'first'); const saving = store.save('a')
  store.edit('a', 'typed while saving'); release(); await saving
  assert.equal(store.getSnapshot().a.text, 'typed while saving')
  assert.equal(store.getSnapshot().a.base.content, 'first')
  await store.saveAll()
  assert.equal(store.getSnapshot().a.base.content, 'typed while saving'); assert.equal(calls, 2)
  store.reconcile([file('a', 'stale response', 1), file('b')])
  assert.equal(store.getSnapshot().a.base.content, 'typed while saving', 'Old read cannot roll back acknowledged version')
  store.stop()
}
{
  const { store, remote } = make()
  store.edit('a', 'local'); remote.set('a', file('a', 'teammate', 2))
  await assert.rejects(store.save('a'))
  assert.equal(store.getSnapshot().a.text, 'local')
  assert.equal(store.getSnapshot().a.base.content, 'base')
  assert.equal(store.getSnapshot().a.remote.content, 'teammate')
  await assert.rejects(store.saveAll())
  store.resolve('a', 'merged'); await store.saveAll()
  assert.equal(remote.get('a').content, 'merged'); store.stop()
}
{
  const { store } = make({ save: async () => { throw new Error('Response lost') }, latest: async () => file('a', 'committed', 2) })
  store.edit('a', 'committed'); await store.save('a')
  assert.equal(store.getSnapshot().a.base.content, 'committed'); assert.equal(store.getSnapshot().a.error, '')
  store.stop()
}
{
  const { store, remote } = make()
  store.configure(true, false); store.edit('a', 'offline draft'); await wait()
  assert.equal(remote.get('a').content, 'base'); assert.equal(store.getSnapshot().a.local, true)
  await assert.rejects(store.saveAll())
  store.configure(false, true); await assert.rejects(store.save('a'))
  store.edit('a', 'forbidden edit'); assert.equal(store.getSnapshot().a.text, 'offline draft')
  store.stop()
}
{
  const { store } = make({ persist: async () => { throw new Error('Quota full') } })
  store.configure(true, false); store.edit('a', 'keep in memory'); await wait()
  assert.equal(store.getSnapshot().a.local, false); assert.equal(store.getSnapshot().a.text, 'keep in memory')
  store.stop()
}
{
  const { store } = make()
  store.edit('a', 'draft'); store.reconcile([file('a', 'base', 2), file('b')])
  assert.equal(store.getSnapshot().a.remote.version, 2, 'Rename/version change demands deliberate review')
  store.reconcile([file('b')]); assert.equal(store.getSnapshot().a.remote, null)
  await assert.rejects(store.save('a')); assert.equal(store.getSnapshot().a.text, 'draft')
  store.discard('a'); store.reconcile([file('b')]); assert.equal(store.getSnapshot().a, undefined)
  store.stop()
}
{
  const { store } = make()
  store.reconcile([file('a', 'new server', 3), file('b')])
  await store.recover({ base: file(), text: 'recovery' })
  assert.equal(store.getSnapshot().a.text, 'recovery'); assert.equal(store.getSnapshot().a.remote.content, 'new server')
  await assert.rejects(store.save('a')); store.stop()
}
{
  const { store, remote } = make()
  await store.recover({ base: file(), text: 'recovery' }); await wait()
  assert.equal(remote.get('a').content, 'base', 'Recovery awaits explicit save')
  await store.saveAll(); assert.equal(remote.get('a').content, 'recovery'); store.stop()
}
{
  const { store, remote } = make()
  store.edit('a', 'unmounted'); store.stop(); await wait()
  assert.equal(remote.get('a').content, 'base', 'Unmount cancels autosave timers')
}
console.log('PASS: multi-file autosave, queued typing, stale reads, three-way conflicts, lost responses, offline/revoked access, storage failure, deleted files, explicit recovery, unmount cancellation.')
