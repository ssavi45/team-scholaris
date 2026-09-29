import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

// Exercise the component's actual effects with controlled render promises. This
// checks ownership/cancellation ordering, not browser appearance or PDF rasterization.
class Element {
  children = []
  width = 300
  height = 150
  style = { setProperty() {} }
  setAttribute() {}
  replaceChildren(...children) {
    this.children.forEach(child => { child.parent = null })
    this.children = children
    children.forEach(child => { child.parent = this })
  }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this) }
}
const effects = [], states = [], jobs = []
const jsx = (type, props) => ({ type, props })
const react = {
  useRef: current => ({ current }),
  useState: initial => [initial, value => states.push(value)],
  useEffect: effect => effects.push(effect),
}
const context = {
  exports: {},
  require: name => {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    if (name === 'pdfjs-dist') return { TextLayer: class {
      textDivs = []; textContentItemsStr = []
      async render() {}
      cancel() {}
    } }
    if (name === './pdf-tools') return { safePdfUrl: () => null }
    throw new Error(`Unexpected import: ${name}`)
  },
  document: { createElement: () => new Element() },
  window: { devicePixelRatio: 2 },
}
const source = await readFile('src/features/paper/PdfPageSurface.tsx', 'utf8')
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText, context)
let cleanups = 0
const page = {
  rotate: 0, userUnit: 1,
  getViewport: () => ({ width: 600, height: 800, transform: [1, 0, 0, 1, 0, 0] }),
  render({ canvas }) {
    let resolve
    const promise = new Promise(done => { resolve = done })
    const job = { canvas, promise, cancelled: false, cancel() { this.cancelled = true }, finish() { resolve() } }
    jobs.push(job)
    return job
  },
  async getTextContent() { return { items: [] } },
  async getAnnotations() { return [] },
  cleanup() { cleanups++ },
}
const tree = context.exports.PdfPageSurface({ pdf: { async getPage() { return page } }, number: 1, scale: 1, rotation: 0, navigate() {} })
function attach(node) {
  if (!node?.props) return
  if (node.props.ref) node.props.ref.current = new Element()
  for (const child of [node.props.children].flat()) attach(child)
}
attach(tree)
const hostNode = tree.props.children.find(child => child?.props?.className === 'pdf-bitmap')
// Compatible with the previous shared-canvas implementation, so it fails on regression.
const visibleCanvas = () => hostNode ? hostNode.props.ref.current.children[0] : tree.props.children.find(child => child.type === 'canvas').props.ref.current
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
effects[0](); effects[1]()
const renderEffect = effects[2]

// StrictMode: cleanup before the first asynchronous page lookup has completed.
const stopFirst = renderEffect()
stopFirst()
const stopSecond = renderEffect()
await flush()
assert.equal(jobs.length, 1)
const firstVisible = visibleCanvas()
assert.ok(firstVisible.width > 0 && firstVisible.height > 0, 'old cleanup must not zero the active canvas')

// Zoom/recompile: old cancelled render settles AFTER the replacement is painted.
stopSecond()
const stopThird = renderEffect()
await flush()
const replacement = visibleCanvas()
assert.notEqual(replacement, firstVisible, 'each render owns a different bitmap')
jobs[1].finish()
await flush()
jobs[0].finish()
await flush()
assert.ok(replacement.width > 0 && replacement.height > 0, 'late cleanup must not erase replacement PDF')
assert.equal(firstVisible.width, 0, 'cancelled bitmap is released')
assert.equal(cleanups, 0, 'a surface must not clean up the PDFPageProxy shared with thumbnails')
assert.ok(!states.some(value => typeof value === 'string' && value.includes('unavailable')))
stopThird()
await flush()
assert.equal(replacement.width, 0, 'unmounted bitmap is released')
console.log('PASS PDF surface: StrictMode replay, delayed cancellation, replacement canvas ownership and unmount release')
