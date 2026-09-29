import { EditorSelection, Transaction } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { snippetCompletion, type CompletionContext } from '@codemirror/autocomplete'
import { isolateHistory } from '@codemirror/commands'
export const snippets = [
  { label: 'Bold', before: '\\textbf{', after: '}', placeholder: 'text', command: 'textbf' },
  { label: 'Italic', before: '\\textit{', after: '}', placeholder: 'text', command: 'textit' },
  { label: 'Section', before: '\\section{', after: '}\n', placeholder: 'Heading', command: 'section' },
  { label: 'Subsection', before: '\\subsection{', after: '}\n', placeholder: 'Heading', command: 'subsection' },
  { label: 'List', before: '\\begin{itemize}\n  \\item ', after: '\n\\end{itemize}\n', placeholder: 'First item', command: 'itemize' },
  { label: 'Equation', before: '\\begin{equation}\n  ', after: '\n\\end{equation}\n', placeholder: 'E = mc^2', command: 'equation' },
  { label: 'Figure', before: '\\begin{figure}\n  \\centering\n  \\includegraphics[width=\\linewidth]{', after: '}\n  \\caption{Caption}\n  \\label{fig:example}\n\\end{figure}\n', placeholder: 'figures/plot.png', command: 'figure' },
]
export function insertSnippet(view: EditorView, index: number) {
  if (view.state.readOnly || !snippets[index]) return false
  const snippet = snippets[index]
  const transaction = view.state.changeByRange(range => {
    const selected = view.state.sliceDoc(range.from, range.to) || snippet.placeholder
    return { changes: { from: range.from, to: range.to, insert: snippet.before + selected + snippet.after }, range: EditorSelection.range(range.from + snippet.before.length, range.from + snippet.before.length + selected.length) }
  })
  view.dispatch({ ...transaction, scrollIntoView: true, annotations: [Transaction.userEvent.of('input.snippet'), isolateHistory.of('full')] })
  view.focus(); return true
}
export function latexCompletions(context: CompletionContext) {
  const word = context.matchBefore(/\\[A-Za-z]*/)
  if (!word || word.from === word.to) return null
  return { from: word.from, options: snippets.map(item => snippetCompletion(item.before + '${' + item.placeholder + '}' + item.after, { label: '\\' + item.command, detail: item.label, type: 'keyword' })) }
}
