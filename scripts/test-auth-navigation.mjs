import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile('src/features/auth/auth-navigation.ts', 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2023 } }).outputText
const { safeDestination, authContext, callbackUrl, postAuthDestination } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'))
const storage = new Map()
globalThis.window = { location: { origin: 'http://127.0.0.1:5173' } }
globalThis.sessionStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) }

for (const unsafe of [null, '', 'https://evil.example', '//evil.example/app', '/\\evil.example/app', '/login', '/auth/callback', '/project/../login', 'javascript:alert(1)', '/%2f%2fevil.example']) {
  assert.equal(safeDestination(unsafe), '/app', 'Unsafe or unsupported destinations fall back to the dashboard')
}
assert.equal(safeDestination('/project/research-1?invite=pending'), '/project/research-1?invite=pending')
assert.equal(safeDestination('/project/research-1/paper'), '/project/research-1/paper')
assert.equal(safeDestination('/project/research-1/paper/unknown'), '/app')
const params = new URLSearchParams({ next: '/project/research-1', invite: 'pending-token', code: 'must-not-propagate' })
assert.equal(authContext(params).has('code'), false)
const callback = new URL(callbackUrl(params, true))
assert.equal(callback.pathname, '/auth/callback')
assert.equal(callback.searchParams.get('mode'), 'recovery')
assert.equal(postAuthDestination(new URLSearchParams()), '/project/research-1?invite=pending-token')
assert.equal(storage.size, 0, 'Consumed context is removed')
assert.equal(postAuthDestination(new URLSearchParams({ next: '//evil.example', invite: 'safe&next=evil' })), '/app?invite=safe%26next%3Devil')
assert.equal(authContext(new URLSearchParams({ invite: 'x'.repeat(2049) })).has('invite'), false)
globalThis.sessionStorage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }
assert.equal(new URL(callbackUrl(params)).searchParams.get('invite'), 'pending-token')
assert.equal(postAuthDestination(params), '/project/research-1?invite=pending-token')
console.log('PASS safe redirects, query filtering, invitation context, context cleanup, blocked storage fallback')
