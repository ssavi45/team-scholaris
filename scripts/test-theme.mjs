import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

// Exercise the real bootstrap/store against browser events without touching
// account sessions or requiring a running Supabase instance.
const storeSource = ts.transpileModule(readFileSync('src/theme/theme-store.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText
const bootstrap = readFileSync('public/theme-init.js', 'utf8')

function browser({ saved = null, dark = false, blocked = false } = {}) {
  const events = new Map()
  const mediaEvents = new Set()
  let stored = saved
  let subscription
  const storage = {
    getItem() { if (blocked) throw new Error('Storage denied'); return stored },
    setItem(_key, value) { if (blocked) throw new Error('Storage denied'); stored = value },
  }
  const media = {
    matches: dark,
    addEventListener(_type, listener) { mediaEvents.add(listener) },
    removeEventListener(_type, listener) { mediaEvents.delete(listener) },
  }
  const document = { documentElement: { dataset: {}, style: {} } }
  const window = {
    localStorage: storage,
    matchMedia: () => media,
    addEventListener(type, listener) { events.set(type, listener) },
    removeEventListener(type) { events.delete(type) },
  }
  const context = vm.createContext({ window, document, localStorage: storage, exports: {},
    require: () => ({ useSyncExternalStore(subscribe, snapshot) { subscription ??= subscribe(() => {}); return snapshot() } }),
  })
  vm.runInContext(bootstrap, context)
  const firstPaint = document.documentElement.dataset.theme
  vm.runInContext(storeSource, context)
  const api = context.exports
  return {
    firstPaint,
    get theme() { return api.useTheme() },
    get painted() { return document.documentElement.dataset.theme },
    get stored() { return stored },
    toggle() { api.toggleTheme() },
    os(value) { media.matches = value; mediaEvents.forEach(fn => fn()) },
    tab(value, key = 'scholaris:theme', storageArea = storage) {
      events.get('storage')?.({ newValue: value, key, storageArea })
    },
    dispose() { subscription?.(); assert.equal(mediaEvents.size, 0); assert.equal(events.size, 0) },
  }
}

for (const saved of [null, 'invalid', 'dark', 'light']) {
  for (const dark of [true, false]) {
    const app = browser({ saved, dark })
    const expected = saved === 'dark' || saved === 'light' ? saved : dark ? 'dark' : 'light'
    assert.equal(app.firstPaint, expected)
    assert.equal(app.theme, expected)
    app.dispose()
  }
}
const app = browser()
assert.equal(app.theme, 'light')
app.os(true)
assert.equal(app.theme, 'dark')
app.toggle()
assert.equal(app.theme, 'light')
assert.equal(app.stored, 'light')
app.os(true)
assert.equal(app.theme, 'light', 'Explicit selection overrides the OS')
app.tab('dark')
assert.equal(app.theme, 'dark')
assert.equal(app.painted, 'dark')
app.tab('light', 'unrelated')
app.tab('light', 'scholaris:theme', {})
assert.equal(app.theme, 'dark', 'Ignore unrelated keys and sessionStorage')
app.tab(null, null)
app.os(false)
assert.equal(app.theme, 'light', 'Clearing preferences resumes OS tracking')
app.dispose()

const privateMode = browser({ blocked: true, dark: true })
assert.equal(privateMode.firstPaint, 'dark')
assert.equal(privateMode.theme, 'dark')
privateMode.toggle()
assert.equal(privateMode.theme, 'light')
privateMode.os(true)
assert.equal(privateMode.theme, 'light', 'Blocked storage still retains the choice in memory')
privateMode.dispose()

// Check actual dark token pairs, rather than claiming whole-page compliance.
const css = readFileSync('src/index.css', 'utf8')
const start = css.indexOf(':root[data-theme="dark"]')
const darkTokens = Object.fromEntries([...css.slice(start, css.indexOf('}', start)).matchAll(/--([\w-]+):\s*(#[a-f\d]{6})/gi)].map(m => [m[1], m[2]]))
function luminance(hex) {
  const values = hex.slice(1).match(/../g).map(part => parseInt(part, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722
}
function ratio(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a)
  return (values[0] + .05) / (values[1] + .05)
}
let minimumText = Infinity
let minimumBorder = Infinity
for (const background of ['bg-page', 'bg-surface', 'bg-raised', 'bg-input', 'accent-light']) {
  for (const text of ['text-primary', 'text-secondary', 'text-muted', 'accent', 'text-danger', 'text-warning', 'text-info']) {
    const contrast = ratio(darkTokens[text], darkTokens[background])
    assert.ok(contrast >= 4.5, `${text} on ${background}: ${contrast.toFixed(2)}`)
    minimumText = Math.min(minimumText, contrast)
  }
  const border = ratio(darkTokens['border-control'], darkTokens[background])
  assert.ok(border >= 3, `Control border on ${background}: ${border.toFixed(2)}`)
  minimumBorder = Math.min(minimumBorder, border)
}
console.log(`Theme bootstrap, persistence/events and blocked-storage checks passed. Token minimums: text ${minimumText.toFixed(2)}:1, controls ${minimumBorder.toFixed(2)}:1. Browser layout acceptance remains manual.`)
