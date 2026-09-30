import { Transaction } from '@codemirror/state'
import { isolateHistory } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'
import { maskNonProse } from './editor-tools'

export type EquationMode = 'inline' | 'display' | 'numbered' | 'align'
export type EquationDraft = { body: string; mode: EquationMode; numbered: boolean; label: string }
export const equationTemplates = [
  { name: 'Fraction', text: '\\frac{a}{b}', select: 'a', at: 6 },
  { name: 'Power', text: 'x^{n}', select: 'n' },
  { name: 'Subscript', text: 'x_{i}', select: 'i' },
  { name: 'Root', text: '\\sqrt{x}', select: 'x' },
  { name: 'Sum', text: '\\sum_{i=1}^{n} x_i', select: 'n' },
  { name: 'Integral', text: '\\int_{a}^{b} f(x)\\,dx', select: 'a' },
  { name: 'Limit', text: '\\lim_{x \\to 0} f(x)', select: '0' },
  { name: 'Brackets', text: '\\left( x \\right)', select: 'x' },
  { name: 'Matrix', text: '\\begin{bmatrix}\na & b \\\\\nc & d\n\\end{bmatrix}', select: 'a', at: 16 },
  { name: 'Piecewise', text: '\\begin{cases}\nx & x \\ge 0 \\\\\n-x & x < 0\n\\end{cases}', select: 'x', at: 14 },
  { name: 'Aligned steps', text: 'a &= b + c \\\\\n  &= d', select: 'b', mode: 'align' as const },
  ...['alpha', 'beta', 'gamma', 'theta', 'lambda', 'mu', 'sigma', 'pi', 'infty', 'le', 'ge', 'times', 'cdot'].map(name => ({ name: '\\' + name, text: '\\' + name + ' ', select: '' })),
]

export function readEquation(text: string): EquationDraft {
  const trimmed = text.trim()
  let mode: EquationMode = 'display', body = trimmed, numbered = false, label = ''
  const environment = trimmed.match(/^\\begin\{(equation\*?|align\*?)\}([\s\S]*)\\end\{\1\}$/)
  if (environment) {
    mode = environment[1].startsWith('align') ? 'align' : environment[1] === 'equation' ? 'numbered' : 'display'
    numbered = !environment[1].endsWith('*'); body = environment[2].trim()
    // Extract a single label only; preserve complex multi-label align source verbatim.
    const labels = [...body.matchAll(/\\label\{([^{}]+)\}/g)]
    if (labels.length === 1 && body.endsWith(labels[0][0])) { label = labels[0][1]; body = body.slice(0, -labels[0][0].length).trim() }
  } else if (trimmed.startsWith('\\(') && trimmed.endsWith('\\)')) { mode = 'inline'; body = trimmed.slice(2,-2).trim() }
  else if (trimmed.startsWith('\\[') && trimmed.endsWith('\\]')) body = trimmed.slice(2,-2).trim()
  else if (trimmed.startsWith('$$') && trimmed.endsWith('$$') && trimmed.length >= 4) body = trimmed.slice(2,-2).trim()
  else if (/^\$[^$]*\$$/.test(trimmed)) { mode = 'inline'; body = trimmed.slice(1,-1).trim() }
  return { body, mode, numbered, label }
}
export function equationSource(draft: EquationDraft) {
  const body = draft.body.trim(), numbered = draft.mode === 'numbered' || draft.mode === 'align' && draft.numbered
  if (!body) throw new Error('Write an equation first.')
  if (body.length > 10000) throw new Error('Keep this equation within 10,000 characters; longer source can be edited directly.')
  if (numbered && draft.label && !/^[A-Za-z][A-Za-z0-9:._-]{0,159}$/.test(draft.label)) throw new Error('Use a label such as eq:energy (letters, numbers, colon, dot, dash or underscore).')
  const label = numbered && draft.label ? `\n\\label{${draft.label}}` : ''
  if (draft.mode === 'inline') return `\\(${body}\\)`
  if (draft.mode === 'display') return `\\[\n${body}\n\\]`
  const environment = draft.mode === 'numbered' ? 'equation' : draft.numbered ? 'align' : 'align*'
  return `\\begin{${environment}}\n${body}${label}\n\\end{${environment}}`
}
export function hasAmsmath(text: string) {
  return /\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\]\s*)?\{[^}]*\bamsmath\b[^}]*\}/.test(maskNonProse(text))
}
export function checkEquationLabels(source: string, otherSource: string) {
  const labels = [...maskNonProse(source).matchAll(/\\label\s*\{([^{}]+)\}/g)].map(match => match[1])
  const existing = new Set([...maskNonProse(otherSource).matchAll(/\\label\s*\{([^{}]+)\}/g)].map(match => match[1]))
  if (new Set(labels).size !== labels.length || labels.some(label => existing.has(label))) throw new Error('An equation label is already used. Choose unique labels.')
}
export function amsmathEdit(text: string) {
  if (hasAmsmath(text)) return null
  const at = maskNonProse(text).search(/\\begin\s*\{document\}/)
  if (at < 0) throw new Error('Cannot locate the main-file preamble. Add \\usepackage{amsmath} manually before \\begin{document}.')
  return { from: at, to: at, insert: '\\usepackage{amsmath}\n' }
}
export function insertEquation(view: EditorView, draft: EquationDraft, target: { doc: string; from: number; to: number }) {
  if (view.state.readOnly) throw new Error('This document is read-only.')
  if (view.state.doc.toString() !== target.doc) throw new Error('The source changed while this dialog was open. Copy your equation, reopen the dialog and try again.')
  const insert = equationSource(draft)
  view.dispatch({ changes: { from: target.from, to: target.to, insert }, selection: { anchor: target.from + insert.length }, annotations: [Transaction.userEvent.of('input.equation'), isolateHistory.of('full')], scrollIntoView: true })
  view.focus()
}
