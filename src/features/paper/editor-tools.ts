export type TextSource = { id: string; path: string; kind: string; content: string }
export type SourceLocation = { fileId: string; path: string; line: number; from: number; to: number }
export type SearchHit = SourceLocation & { excerpt: string }
export type OutlineHeading = SourceLocation & { title: string; level: number }
export type OutlineNode = OutlineHeading & { id: string; children: OutlineNode[] }

export function nestOutline(headings: OutlineHeading[]): OutlineNode[] {
  const roots: OutlineNode[] = [], parents: OutlineNode[] = []
  const occurrences = new Map<string, number>()
  for (const heading of headings) {
    const identity = JSON.stringify([heading.fileId, heading.level, heading.title])
    const occurrence = occurrences.get(identity) ?? 0
    occurrences.set(identity, occurrence + 1)
    const node: OutlineNode = { ...heading, id: `${identity}:${occurrence}`, children: [] }
    while (parents.length && parents[parents.length - 1].level >= heading.level) parents.pop()
    if (parents.length) parents[parents.length - 1].children.push(node)
    else roots.push(node)
    parents.push(node)
  }
  return roots
}
const blanks = (text: string) => text.replace(/[^\n]/g, ' ')
export function maskNonProse(text: string) {
  return text.replace(/\\begin\{(verbatim\*?|lstlisting|minted|comment)\}[\s\S]*?\\end\{\1\}/g, blanks)
    .replace(/\\verb\*?([^\w\s])[^\n]*?\1/g, blanks).replace(/(?<!\\)(?:\\\\)*%.*/g, blanks)
}
export function buildOutline(files: TextSource[], main: string) {
  const headings: OutlineHeading[] = []
  const visited = new Set<string>(), unresolved = new Set<string>()
  const levels = ['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph']
  function visit(path: string) {
    if (visited.has(path)) return
    visited.add(path)
    const file = files.find(item => item.path === path && item.kind === 'text')
    if (!file) { unresolved.add(path); return }
    const text = maskNonProse(file.content)
    for (const match of text.matchAll(/\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph|input|include)\*?\s*(?:\[[^\]\n]*\]\s*)?\{([^{}\n]*)\}/g)) {
      const [, command, argument] = match
      if (command === 'input' || command === 'include') {
        if (!/^[\w./-]+$/.test(argument)) { unresolved.add(argument); continue }
        const target = argument.endsWith('.tex') ? argument : argument + '.tex'
        const relative = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) + target : target
        visit(files.some(item => item.path === target) ? target : relative)
      } else headings.push({ fileId: file.id, path, line: text.slice(0, match.index).split('\n').length, from: match.index, to: match.index + match[0].length, title: argument, level: levels.indexOf(command) })
    }
  }
  visit(main)
  return { headings, unresolved: [...unresolved], visited: [...visited] }
}
const pattern = (query: string, matchCase: boolean) => new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), matchCase ? 'g' : 'gi')
export function searchProject(files: TextSource[], query: string, matchCase: boolean, limit = 500) {
  const hits: SearchHit[] = []
  if (!query) return { hits, truncated: false }
  for (const file of files.filter(item => item.kind === 'text')) {
    let line = 1, last = 0
    for (const match of file.content.matchAll(pattern(query, matchCase))) {
      if (hits.length === limit) return { hits, truncated: true }
      line += file.content.slice(last, match.index).split('\n').length - 1; last = match.index
      hits.push({ fileId: file.id, path: file.path, line, from: match.index, to: match.index + match[0].length,
        excerpt: file.content.slice(Math.max(file.content.lastIndexOf('\n', match.index - 1) + 1, match.index - 40), match.index + match[0].length + 90).split('\n')[0] })
    }
  }
  return { hits, truncated: false }
}
export function replacementPreview<T extends TextSource>(files: T[], query: string, replacement: string, matchCase: boolean) {
  if (!query) throw new Error('Enter text to find before replacing.')
  let count = 0
  const changes: { before: T; after: T; count: number }[] = []
  const entries = files.map(file => {
    if (file.kind !== 'text') return file
    let matches = 0
    const content = file.content.replace(pattern(query, matchCase), () => { matches++; if (++count > 10000) throw new Error('More than 10,000 replacements. Narrow the search first.'); return replacement })
    const after = { ...file, content }
    if (matches && content !== file.content) changes.push({ before: file, after, count: matches })
    return after
  })
  return { entries, changes, count: changes.reduce((sum, change) => sum + change.count, 0) }
}
export function approximateWords(source: string) {
  const text = maskNonProse(source)
    .replace(/\\begin\{(equation\*?|align\*?|gather\*?|math|displaymath)\}[\s\S]*?\\end\{\1\}/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$|\$(?:\\.|[^$])*\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g, ' ')
    .replace(/\\(?:cite\w*|ref|eqref|label|includegraphics|input|include|bibliography|bibliographystyle|documentclass|usepackage)\*?(?:\[[^\]]*\])?\{[^}]*\}/g, ' ')
    .replace(/\\(?:begin|end)\{[^}]*\}|\\[a-zA-Z@]+\*?/g, ' ')
  return (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length
}
