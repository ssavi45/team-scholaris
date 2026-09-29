import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createContext, runInContext } from 'node:vm'
// Exercise the package adapter with a deterministic storage double; no UI emulation.
const source = (await readFile('public/vendor/swiftlatex/scholaris-worker.js', 'utf8')).split('async function initializeEngine()')[0]
const records = new Map()
let network = 0
const store = {
  put(value) { records.set(value.url, structuredClone(value)); return {} },
  openCursor() {
    const request = {}, entries = [...records.values()]
    let index = 0
    const advance = () => queueMicrotask(() => {
      const value = entries[index++]
      request.result = value ? { value, delete() { records.delete(value.url) }, continue: advance } : null
      request.onsuccess?.()
    })
    advance(); return request
  },
}
const indexedDB = { open() { const request = {}; queueMicrotask(() => { request.result = { close() {}, transaction() { return { objectStore: () => store } } }; request.onsuccess?.() }); return request } }
function runtime(database = indexedDB) {
  class XHR {
    open(method, url) { this.url = url }
    send() { network++; this.status = this.url.includes('missing') ? 404 : this.url.includes('failure') ? 500 : 200; this.response = new Uint8Array([1, 2, 3]).buffer; this.readyState = 4 }
    getResponseHeader(name) { return name === 'fileid' ? 'article.cls' : null }
  }
  const context = createContext({ URL, ArrayBuffer, Uint8Array, Map, Promise, Date, setTimeout, clearTimeout, self: { XMLHttpRequest: XHR, indexedDB: database, location: { href: 'http://localhost/vendor/swiftlatex/scholaris-worker.js', origin: 'http://localhost' }, postMessage() {} } })
  runInContext(source + ';self.api = { PackageRequest, loadPackageCache, packageCache, rememberPackage };', context)
  return context.self.api
}
const url = name => `https://texlive.texlyre.org/pdftex/26/${name}`
function fetch(api, name) { const xhr = new api.PackageRequest(); xhr.open('GET', url(name), false); xhr.responseType = 'arraybuffer'; xhr.send(); return xhr }
const first = runtime(); await first.loadPackageCache()
assert.equal(fetch(first, 'article.cls').status, 200)
assert.equal(fetch(first, 'missing.vf').status, 301)
assert.equal(network, 2)
assert.equal(fetch(first, 'main.aux').status, 301)
assert.equal(records.size, 2, 'Generated manuscript artifacts are not persisted')
const reopened = runtime(); await reopened.loadPackageCache()
assert.equal(fetch(reopened, 'article.cls').getResponseHeader('fileid'), 'article.cls')
assert.equal(fetch(reopened, 'missing.vf').status, 301)
assert.equal(network, 2, 'Success and missing-public-package responses survive workspace restart')
fetch(reopened, 'failure.sty'); assert.equal(records.size, 2, 'Server failures never persist')
records.get(url('missing.vf')).time = Date.now() - 2 * 86400000
const expired = runtime(); await expired.loadPackageCache(); fetch(expired, 'missing.vf')
assert.equal(network, 4, 'Expired negative entry is retried')
const unavailable = runtime(null); await unavailable.loadPackageCache()
assert.equal(fetch(unavailable, 'article.cls').status, 200)
assert.throws(() => new unavailable.PackageRequest().open('GET', 'https://untrusted.test/article.cls', false))
// The real format is ~10 MB; do not accidentally exclude it with a tiny entry cap.
first.rememberPackage(url('swiftlatexpdftex.fmt'), { status: 200, response: new ArrayBuffer(11 * 1024 * 1024), getResponseHeader: () => 'swiftlatexpdftex.fmt' })
assert.ok(records.has(url('swiftlatexpdftex.fmt')))
console.log('PASS public package persistence, negative-cache expiry, generated-artifact exclusion, failure fallback and origin restriction')
