import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const code = ts.transpileModule(await readFile('src/features/paper/history-diff.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
const { compareHistory, sourceDiff } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const file = (id, path, content = '') => ({ id, path, content, kind: 'text', storage_path: null })
const changes = compareHistory([file('a','main.tex','old'),file('b','deleted.tex')], [file('a','paper.tex','new'),file('c','added.tex')])
assert.deepEqual(changes.find(row => row.id === 'a').changes, ['Renamed','Modified'])
assert.deepEqual(changes.find(row => row.id === 'b').changes, ['Deleted since snapshot'])
assert.deepEqual(changes.find(row => row.id === 'c').changes, ['Added since snapshot'])
for (const [before, after] of [['a\nb\nc','a\nB\nc'],['','new'],['old',''],['same','same'],['a\na\nb','a\nb\nb']]) {
  const diff = sourceDiff(before, after)
  const lines = before.split('\n')
  lines.splice(diff.firstLine - 1, diff.removed.length, ...diff.added)
  assert.equal(lines.join('\n'), after, 'applying the changed block reconstructs the compared source')
}
const huge = Array.from({ length: 50000 }, (_, i) => `line ${i}`).join('\n')
assert.deepEqual(sourceDiff(huge, huge + '\nlast').added, ['last'])
console.log('PASS identity-based rename/add/delete comparison, reconstructable source diff, repeated lines and large manuscript')
