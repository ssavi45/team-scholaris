import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import * as Y from 'yjs'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { yCollab } from 'y-codemirror.next'

const dom = new JSDOM('<div id="one"></div><div id="two"></div>', { pretendToBeVisual: true })
for (const name of ['window','document','MutationObserver','HTMLElement','Node','getComputedStyle','requestAnimationFrame','cancelAnimationFrame']) {
  Object.defineProperty(globalThis, name, { configurable: true, value: typeof dom.window[name] === 'function' && ['getComputedStyle','requestAnimationFrame','cancelAnimationFrame'].includes(name) ? dom.window[name].bind(dom.window) : dom.window[name] })
}
const a = new Y.Doc(), b = new Y.Doc()
a.getText('source').insert(0, 'paper')
Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
const undoA = new Y.UndoManager(a.getText('source')), undoB = new Y.UndoManager(b.getText('source'))
const make = (doc, undoManager, id) => new EditorView({ parent: document.getElementById(id), state: EditorState.create({ doc: doc.getText('source').toString(), extensions: [yCollab(doc.getText('source'), null, { undoManager })] }) })
const editorA = make(a, undoA, 'one'), editorB = make(b, undoB, 'two')
try {
  const baseline = Y.encodeStateVector(a)
  editorA.dispatch({ changes: { from: 0, insert: 'Alice ' } })
  editorB.dispatch({ changes: { from: 5, insert: ' Bob' } })
  const changeA = Y.encodeStateAsUpdate(a, baseline), changeB = Y.encodeStateAsUpdate(b, baseline)
  Y.applyUpdate(a, changeB, 'remote'); Y.applyUpdate(b, changeA, 'remote')
  assert.equal(editorA.state.doc.toString(), editorB.state.doc.toString())
  assert.equal(editorA.state.doc.toString(), 'Alice paper Bob')
  const beforeUndo = Y.encodeStateVector(a)
  undoA.undo()
  assert.equal(editorA.state.doc.toString(), 'paper Bob', 'Undo leaves remote author intact')
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, beforeUndo), 'remote')
  assert.equal(editorB.state.doc.toString(), 'paper Bob')
  undoA.redo()
  assert.equal(editorA.state.doc.toString(), 'Alice paper Bob')
  console.log('PASS actual CodeMirror DOM binding, concurrent changes and own-author undo/redo')
} finally {
  editorA.destroy(); editorB.destroy(); undoA.destroy(); undoB.destroy(); a.destroy(); b.destroy(); dom.window.close()
}
