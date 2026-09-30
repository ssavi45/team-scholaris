import type { CompletionContext } from '@codemirror/autocomplete'
import type { EditorView } from '@codemirror/view'
import { Transaction } from '@codemirror/state'
import { isolateHistory } from '@codemirror/commands'
import type { ReferenceIndex } from './references'
import { bibDisplay, validReferenceKey } from './references'
import { maskNonProse } from './editor-tools'

export function insertReference(view: EditorView, key: string, command: string) {
  if (view.state.readOnly || !validReferenceKey(key) || !['cite', 'citep', 'citet', 'ref', 'eqref', 'pageref', 'autoref'].includes(command)) return false
  const selection = view.state.selection.main, insert = '\\' + command + '{' + key + '}'
  view.dispatch({ changes: { from: selection.from, to: selection.to, insert }, selection: { anchor: selection.from + insert.length }, annotations: [Transaction.userEvent.of('input.reference'), isolateHistory.of('full')], scrollIntoView: true })
  view.focus()
  return true
}

export function referenceCompletions(context: CompletionContext, index: ReferenceIndex) {
  if (context.state.readOnly) return null
  const before = context.state.sliceDoc(Math.max(0, context.pos - 500), context.pos)
  const match = /\\(cite|citep|citet|citeauthor|citeyear|citeyearpar|nocite|ref|eqref|pageref|autoref)\*?\s*(?:\[[^\]\n]*\]\s*){0,2}\{([^{}\n]*)$/.exec(before)
  if (!match || /\\|#/.test(match[2])) return null
  const commandFrom = context.pos - before.length + match.index
  const source = context.state.doc.toString()
  if (maskNonProse(source).slice(commandFrom, context.pos) !== source.slice(commandFrom, context.pos)) return null
  let backslashes = 0
  for (let i = commandFrom - 1; i >= 0 && source[i] === '\\'; i--) backslashes++
  if (backslashes % 2) return null
  const citation = match[1].includes('cite'), fragment = match[2].split(',').at(-1)!.trimStart()
  const entries = citation ? index.entries.filter(entry => !index.duplicateCitations.has(entry.key)) : index.labels.filter(label => !index.duplicateLabels.has(label.key))
  return { from: context.pos - fragment.length, options: entries.map(entry => ({ label: entry.key, type: 'constant', detail: entry.path, info: 'fields' in entry ? [bibDisplay(entry, 'author'), bibDisplay(entry, 'title'), bibDisplay(entry, 'year')].filter(Boolean).join(' · ') : `Label at ${entry.path}:${entry.line}` })), validFor: /^[A-Za-z0-9_:.+/-]*$/ }
}
