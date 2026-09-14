// Execute the actual vendored WebAssembly engine in a Node worker for integration tests.
// This is a compiler harness, not a browser or UI emulator.
import { parentPort } from 'node:worker_threads'
import { createContext, runInContext } from 'node:vm'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const vendor = resolve('public/vendor/swiftlatex')
const cache = join(tmpdir(), 'scholaris-texlive-test-cache')
mkdirSync(cache, { recursive: true })
class XMLHttpRequest {
  open(method, url) { if (method !== 'GET') throw Error('GET only'); this.url = url }
  send() {
    const name = createHash('sha256').update(this.url).digest('hex') + '.json'
    const file = join(cache, name)
    let result
    if (existsSync(file)) result = JSON.parse(readFileSync(file, 'utf8'))
    else {
      const code = `const r = await fetch(process.argv[1], {signal: AbortSignal.timeout(15000)}); console.log(JSON.stringify({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer()).toString('base64')}));`
      result = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', code, this.url], { encoding: 'utf8', maxBuffer: 24 * 1024 * 1024, timeout: 20000 }))
      if (result.status === 200 || result.status === 404 || result.status === 301) writeFileSync(file, JSON.stringify(result))
    }
    this.status = result.status
    this.headers = result.headers
    this.response = Uint8Array.from(Buffer.from(result.body, 'base64')).buffer
    this.onload?.()
  }
  getResponseHeader(name) { return this.headers[name.toLowerCase()] ?? null }
}
const context = createContext({
  console: { log() {}, error() {}, warn() {} },
  process, require: createRequire(import.meta.url), __dirname: vendor,
  Uint8Array, ArrayBuffer, WebAssembly, TextDecoder, TextEncoder, URL, setTimeout, clearTimeout,
  XMLHttpRequest,
  location: { href: 'http://localhost/vendor/swiftlatex/scholaris-worker.js', origin: 'http://localhost' },
  postMessage: (data) => parentPort.postMessage(data), close: () => process.exit(0),
})
context.self = context
// Node's filesystem loader locates the same WASM bytes shipped to the browser.
const importScript = () => {
  context.importScripts = undefined
  runInContext(readFileSync(join(vendor, 'swiftlatexpdftex.js'), 'utf8'), context)
  context.importScripts = importScript
}
context.importScripts = importScript
runInContext(readFileSync(join(vendor, 'scholaris-worker.js'), 'utf8'), context)
parentPort.on('message', (data) => context.onmessage({ data }))
