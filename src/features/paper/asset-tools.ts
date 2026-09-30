import { moveEntries, mergeEntries, validPath, type TreeEntry } from './file-tree'
import { maskNonProse } from './editor-tools'
import type { EditorView } from '@codemirror/view'
import { Transaction } from '@codemirror/state'
import { isolateHistory } from '@codemirror/commands'

export function insertFigure(view: EditorView, text: string, target: { doc: string; from: number; to: number }) {
  if (view.state.readOnly) throw new Error('This document is read-only.')
  if (view.state.doc.toString() !== target.doc) throw new Error('The source changed while this dialog was open. Reopen Insert figure and try again.')
  view.dispatch({ changes: { from: target.from, to: target.to, insert: text }, selection: { anchor: target.from + text.length }, annotations: [Transaction.userEvent.of('input.figure'), isolateHistory.of('full')], scrollIntoView: true })
  view.focus()
}

export function planMove(entries: TreeEntry[], from: string, to: string, main: string) {
  if (!entries.some(e => e.path === from || e.path.startsWith(from + '/'))) throw new Error('Select an existing file or folder.')
  const moved = moveEntries(entries, from, to)
  const newPath = (path: string) => path === from || path.startsWith(from + '/') ? to + path.slice(from.length) : path
  const changes: { path: string; before: string; after: string }[] = []
  const warnings = new Set<string>()
  // Compiler executes from the project root, including when the entry file is nested.
  const newMain = newPath(main)
  const result = moved.map((entry, i) => {
    if (entry.kind !== 'text' || !/\.(tex|sty|cls)$/.test(entry.path)) return entry
    const original = entries[i], masked = maskNonProse(original.content)
    const edits: { from: number; to: number; value: string }[] = []
    if (/\\(?:graphicspath|import|subimport|newcommand|def|includeonly)\b/.test(masked)) warnings.add(`${original.path}: custom macros/search paths require manual review.`)
    const commands = [...masked.matchAll(/(?<!\\)\\(?:input|include|includegraphics|bibliography)\b/g)]
    const handled = new Set<number>()
    for (const match of masked.matchAll(/(?<!\\)\\(input|include|includegraphics|bibliography)\*?\s*(?:\[[^\]\n]*\]\s*)?\{([^{}\n]*)\}/g)) {
      handled.add(match.index!)
      const command = match[1], argument = match[2], start = match.index! + match[0].lastIndexOf('{') + 1
      let argumentOffset = 0
      for (const part of argument.split(',')) {
        const literal = part.trim(), at = start + argumentOffset + part.indexOf(literal)
        argumentOffset += part.length + 1
        if (!validPath(literal)) { warnings.add(`${original.path}: dynamic or unsupported path ${literal}.`); continue }
        if (command === 'includegraphics' && /\\graphicspath\b/.test(entries.filter(e => e.kind === 'text').map(e => maskNonProse(e.content)).join('\n'))) { warnings.add(`${original.path}: graphics search paths require manual repair of ${literal}.`); continue }
        const extensions = command === 'bibliography' ? ['', '.bib'] : command === 'includegraphics' ? ['', '.png', '.jpg', '.jpeg'] : ['', '.tex']
        const candidates = entries.filter(e => e.kind !== 'folder' && extensions.some(ext => e.path === literal + ext))
        if (candidates.length !== 1) { warnings.add(`${original.path}: cannot safely resolve ${literal}.`); continue }
        const target = candidates[0].path, renamed = newPath(target)
        if (renamed === target) continue
        let replacement = renamed
        if (!/\.[^/]+$/.test(literal)) replacement = replacement.replace(/\.(tex|bib|png|jpe?g)$/, '')
        edits.push({ from: at, to: at + literal.length, value: replacement })
        changes.push({ path: original.path, before: literal, after: replacement })
      }
    }
    if (commands.some(command => !handled.has(command.index!))) warnings.add(`${original.path}: an unbraced or dynamic path needs manual repair.`)
    let content = original.content
    for (const edit of edits.sort((a,b) => b.from - a.from)) content = content.slice(0,edit.from) + edit.value + content.slice(edit.to)
    return { ...entry, content }
  })
  return { entries: result, moved, main: newMain, changes, warnings: [...warnings] }
}

export type ConflictChoice = { action: 'keep' | 'replace' | 'rename'; path?: string }
export function reviewImport(entries: TreeEntry[], incoming: TreeEntry[], choices: Record<string, ConflictChoice>) {
  let result = [...entries]
  for (const item of incoming) {
    const existing = result.find(e => e.path.toLowerCase() === item.path.toLowerCase())
    if (!existing || existing.kind === 'folder' && item.kind === 'folder') { result = mergeEntries(result, [item], false); continue }
    const choice = Object.hasOwn(choices,item.path) ? choices[item.path] : undefined
    if (!choice) throw new Error(`Choose how to handle ${item.path}.`)
    if (choice.action === 'keep') continue
    if (choice.action === 'replace') result = mergeEntries(result, [item], true)
    else if (choice.action === 'rename') result = mergeEntries(result, [{ ...item, path: choice.path?.trim() || '' }], false)
    else throw new Error('Invalid conflict choice.')
  }
  return result
}
export function mainCandidates(entries: TreeEntry[]) { return entries.filter(e => e.kind === 'text' && e.path.endsWith('.tex') && /\\documentclass\b/.test(maskNonProse(e.content))).map(e => e.path) }
export function compatibilityWarnings(entries: TreeEntry[]) {
  return entries.filter(e => e.kind === 'text' && /\\(?:usepackage(?:\[[^\]]*\])?\{(?:fontspec|unicode-math|biblatex)|addbibresource|setmainfont)/.test(e.content)).map(e => `${e.path}: may require XeLaTeX, LuaLaTeX or Biber; this workspace uses pdfLaTeX + BibTeX.`)
}
export function figureSnippet(path: string, caption: string, label: string) {
  if (!validPath(path)) throw new Error('Choose a valid figure path.')
  if (!/^fig:[A-Za-z0-9:._-]+$/.test(label)) throw new Error('Use a unique label such as fig:results.')
  const escaped = caption.replace(/[\\{}%&#_$^~]/g, ch => ({ '\\': '\\textbackslash{}', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}' }[ch] ?? '\\' + ch))
  return `\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=\\linewidth]{${path}}\n  \\caption{${escaped}}\n  \\label{${label}}\n\\end{figure}\n`
}
