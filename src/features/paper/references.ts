import type { TextSource, SourceLocation } from './editor-tools'
import { maskNonProse } from './editor-tools'

export type BibField = { name: string; value: string; from: number; to: number }
export type BibEntry = SourceLocation & { type: string; key: string; keyFrom: number; keyTo: number; raw: string; fields: BibField[] }
export type ReferenceNotice = SourceLocation & { message: string }
export type KeyUse = SourceLocation & { key: string; kind: 'citation' | 'reference' | 'label'; command: string }
export const commonBibFields = ['author', 'title', 'year', 'journal', 'booktitle', 'publisher', 'volume', 'number', 'pages', 'doi', 'url'] as const
export const validReferenceKey = (key: string) => /^[A-Za-z0-9][A-Za-z0-9_:.+/-]{0,159}$/.test(key)
const location = (file: TextSource, from: number, to: number): SourceLocation => ({ fileId: file.id, path: file.path, line: file.content.slice(0, from).split('\n').length, from, to })
const escaped = (text: string, at: number) => { let i = at - 1; while (i >= 0 && text[i] === '\\') i--; return (at - i - 1) % 2 === 1 }
function skip(text: string, at: number, end = text.length) {
  while (at < end) {
    if (/\s/.test(text[at])) at++
    else if (text[at] === '%') { const next = text.indexOf('\n', at); at = next < 0 ? end : next + 1 }
    else break
  }
  return at
}
// Read one raw BibTeX value, respecting nested braces, quoted values and # strings.
function valueEnd(text: string, start: number, end: number) {
  let depth = 0, quoted = false
  for (let i = start; i < end; i++) {
    const c = text[i]
    if (escaped(text, i)) continue
    if (c === '{') depth++
    else if (c === '}') { if (!depth) throw new Error('Unexpected closing brace'); depth-- }
    else if (c === '"' && !depth) quoted = !quoted
    else if (c === ',' && !depth && !quoted) return i
    else if (c === '%' && !depth && !quoted) { const n = text.indexOf('\n', i); i = n < 0 ? end : n }
  }
  if (depth || quoted) throw new Error('Unclosed field value')
  return end
}
function significantValueEnd(text: string, start: number, end: number) {
  let depth = 0, quote = false, last = start
  for (let i = start; i < end; i++) {
    const c = text[i]
    if (!escaped(text, i)) {
      if (c === '%' && !depth && !quote) { const newline = text.indexOf('\n', i); i = newline < 0 ? end : newline; continue }
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '"' && !depth) quote = !quote
    }
    if (!/\s/.test(c)) last = i + 1
  }
  return last
}
export function parseBibFile(file: TextSource) {
  const entries: BibEntry[] = [], notices: ReferenceNotice[] = []
  let cursor = 0
  while (cursor < file.content.length) {
    const text = file.content
    cursor = skip(text, cursor)
    if (cursor >= text.length) break
    if (text[cursor] !== '@') { cursor++; continue }
    const start = cursor, head = /^@([A-Za-z]+)\s*([{(])/.exec(text.slice(start))
    if (!head) { notices.push({ ...location(file, start, start + 1), message: 'Malformed BibTeX entry header.' }); cursor++; continue }
    const type = head[1].toLowerCase(), opener = head[2], closer = opener === '{' ? '}' : ')'
    const body = start + head[0].length
    let depth = 0, quote = false, end = body
    for (; end < text.length; end++) {
      const c = text[end]
      if (escaped(text, end)) continue
      if (c === '"' && depth === 0) quote = !quote
      if (c === '{') depth++
      else if (c === '}') { if (opener === '{' && depth === 0 && !quote) break; depth-- }
      else if (c === closer && !depth && !quote) break
      else if (c === '%' && !depth && !quote) { const n = text.indexOf('\n', end); end = n < 0 ? text.length : n }
    }
    if (end >= text.length || depth < 0 || quote) { notices.push({ ...location(file, start, text.length), message: 'Unclosed BibTeX entry. Repair it in source before editing or importing.' }); break }
    cursor = end + 1
    if (['comment', 'string', 'preamble'].includes(type)) continue
    const keyFrom = skip(text, body, end), comma = text.indexOf(',', keyFrom)
    if (comma < 0 || comma > end) { notices.push({ ...location(file, start, end + 1), message: 'Entry needs a key followed by a comma.' }); continue }
    const key = text.slice(keyFrom, comma).trim(), keyTo = keyFrom + key.length
    if (!validReferenceKey(key)) { notices.push({ ...location(file, keyFrom, comma), message: 'Unsupported citation key. Use letters, numbers and simple punctuation.' }); continue }
    const fields: BibField[] = []
    try {
      let at = comma + 1
      while ((at = skip(text, at, end)) < end) {
        const field = /^([A-Za-z][A-Za-z0-9_-]*)\s*=\s*/.exec(text.slice(at, end))
        if (!field) throw new Error('Expected a field name and =')
        const from = at + field[0].length, stop = valueEnd(text, from, end)
        const value = text.slice(from, significantValueEnd(text, from, stop))
        if (!value) throw new Error('Empty field value')
        // A concatenation consists of braced/quoted literals or string/number tokens.
        if (!validBibValue(value)) throw new Error('Malformed field value or missing comma')
        const name = field[1].toLowerCase()
        if (fields.some(item => item.name === name)) throw new Error('Duplicate field ' + name)
        fields.push({ name, value, from, to: from + value.length }); at = stop + 1
      }
      entries.push({ ...location(file, start, end + 1), type, key, keyFrom, keyTo, raw: text.slice(start, end + 1), fields })
    } catch (error) { notices.push({ ...location(file, start, end + 1), message: error instanceof Error ? error.message : 'Malformed entry' }) }
  }
  return { entries, notices }
}
function validBibValue(value: string) {
  let at = 0
  while (at < value.length) {
    at = skip(value, at)
    if (at >= value.length) return false
    if (value[at] === '{' || value[at] === '"') {
      const quote = value[at] === '"'; let depth = quote ? 0 : 1; let closed = false
      for (at++; at < value.length; at++) {
        if (escaped(value, at)) continue
        if (value[at] === '{') depth++
        else if (value[at] === '}') { depth--; if (!quote && !depth) { at++; closed = true; break } }
        else if (quote && value[at] === '"' && !depth) { at++; closed = true; break }
        if (depth < 0) return false
      }
      if (!closed) return false
    } else {
      const token = /^[A-Za-z0-9_:.+/-]+/.exec(value.slice(at)); if (!token) return false
      at += token[0].length
    }
    at = skip(value, at)
    if (at === value.length) return true
    if (value[at++] !== '#') return false
  }
  return false
}
export function bibDisplay(entry: BibEntry, field: string) {
  const value = entry.fields.find(item => item.name === field)?.value ?? ''
  return ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('"') && value.endsWith('"')) ? value.slice(1, -1) : value).replace(/[{}]/g, '')
}
export function scanKeys(files: TextSource[]) {
  const uses: KeyUse[] = [], unsupported: ReferenceNotice[] = []
  for (const file of files.filter(item => item.kind === 'text' && /\.(tex|sty|cls)$/.test(item.path))) {
    const text = maskNonProse(file.content)
    for (const match of text.matchAll(/\\([A-Za-z]+)\*?/g)) {
      if (escaped(text, match.index)) continue
      const command = match[1]
      const kind = /^(cite|citep|citet|citeauthor|citeyear|citeyearpar|nocite)$/.test(command) ? 'citation' : /^(ref|eqref|pageref|autoref)$/.test(command) ? 'reference' : command === 'label' ? 'label' : null
      if (!kind) { if (/cite|ref/i.test(command) && !['bibliographystyle'].includes(command)) unsupported.push({ ...location(file, match.index, match.index + match[0].length), message: `Unsupported command \\${command}; review manually.` }); continue }
      const argument = /^\s*(?:\[[^\]\n]*\]\s*){0,2}\{([^{}\n]*)\}/.exec(text.slice(match.index + match[0].length))
      if (!argument || /\\|#/.test(argument[1])) { unsupported.push({ ...location(file, match.index, match.index + match[0].length), message: `Dynamic or malformed \\${command}; review manually.` }); continue }
      const from = match.index + match[0].length + argument[0].indexOf('{') + 1
      for (const keyMatch of argument[1].matchAll(/[^,\s]+/g)) {
        const key = keyMatch[0]
        if (key === '*' && command === 'nocite') continue
        if (!validReferenceKey(key)) { unsupported.push({ ...location(file, from, from + argument[1].length), message: 'Unsupported key expression; review manually.' }); continue }
        uses.push({ ...location(file, from + keyMatch.index, from + keyMatch.index + key.length), key, kind, command })
      }
    }
    for (const match of text.matchAll(/\\(?:newcommand|renewcommand|providecommand|def|let)\b/g)) unsupported.push({ ...location(file, match.index, match.index + match[0].length), message: 'Custom macro definition: key uses may be hidden. Review before renaming.' })
  }
  return { uses, unsupported }
}
export function indexReferences(files: TextSource[]) {
  const parsed = files.filter(file => file.kind === 'text' && file.path.endsWith('.bib')).map(parseBibFile)
  const entries = parsed.flatMap(item => item.entries), notices = parsed.flatMap(item => item.notices)
  const { uses, unsupported } = scanKeys(files), labels = uses.filter(use => use.kind === 'label')
  const duplicateCitations = new Set(entries.filter((item, index) => entries.findIndex(other => other.key === item.key) !== index).map(item => item.key))
  const duplicateLabels = new Set(labels.filter((item, index) => labels.findIndex(other => other.key === item.key) !== index).map(item => item.key))
  for (const entry of entries) if (duplicateCitations.has(entry.key)) notices.push({ ...entry, message: `Duplicate citation key: ${entry.key}` })
  for (const label of labels) if (duplicateLabels.has(label.key)) notices.push({ ...label, message: `Duplicate label: ${label.key}` })
  for (const use of uses) if (use.kind !== 'label' && !(use.kind === 'citation' ? entries : labels).some(item => item.key === use.key)) notices.push({ ...use, message: `Missing ${use.kind === 'citation' ? 'citation' : 'label'}: ${use.key}` })
  return { entries, labels, notices, unsupported, uses, duplicateCitations, duplicateLabels }
}
export type ReferenceIndex = ReturnType<typeof indexReferences>
type Edit = { from: number; to: number; insert: string }
export function applyTextEdits(text: string, edits: Edit[]) {
  for (const edit of [...edits].sort((a, b) => b.from - a.from)) text = text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
  return text
}
export function renameCitation<T extends TextSource>(files: T[], oldKey: string, key: string) {
  if (!validReferenceKey(key)) throw new Error('Enter a valid citation key.')
  const index = indexReferences(files), matches = index.entries.filter(entry => entry.key === oldKey)
  if (matches.length !== 1) throw new Error('Resolve missing or duplicate keys before renaming.')
  if (key === oldKey || index.entries.some(entry => entry.key === key)) throw new Error('Choose a different, unused key.')
  if (files.filter(file => file.path.endsWith('.bib')).some(file => parseBibFile(file).notices.length)) throw new Error('Repair malformed bibliography entries before renaming.')
  const entry = matches[0], uses = index.uses.filter(use => use.kind === 'citation' && use.key === oldKey)
  const warnings = [...index.unsupported]
  for (const file of files.filter(item => item.kind === 'text' && /\.(tex|sty|cls)$/.test(item.path))) {
    const source = maskNonProse(file.content)
    for (let at = source.indexOf(oldKey); at >= 0; at = source.indexOf(oldKey, at + oldKey.length)) {
      if (!uses.some(use => use.fileId === file.id && use.from === at && use.to === at + oldKey.length)) warnings.push({ ...location(file, at, at + oldKey.length), message: `Key ${oldKey} occurs outside a supported citation command; review manually.` })
    }
  }
  // crossref and xdata are BibTeX dependencies, not citation commands; never rewrite them silently.
  for (const bib of index.entries) for (const field of bib.fields) if (['crossref', 'xdata', 'related', 'entryset'].includes(field.name)) warnings.push({ ...bib, message: `Review ${field.name} dependency in ${bib.key} manually.` })
  return { entries: files.map(file => {
    const edits: Edit[] = uses.filter(use => use.fileId === file.id).map(use => ({ ...use, insert: key }))
    if (entry.fileId === file.id) edits.push({ from: entry.keyFrom, to: entry.keyTo, insert: key })
    return { ...file, content: applyTextEdits(file.content, edits) }
  }), uses, warnings }
}
export function editBibFields(text: string, entry: BibEntry, changes: Record<string, string>) {
  const edits: Edit[] = [], added: string[] = []
  for (const [name, value] of Object.entries(changes)) {
    if (!(commonBibFields as readonly string[]).includes(name)) throw new Error('Unsupported form field.')
    const literal = '{' + value + '}'
    if (!validBibValue(literal)) throw new Error(`Unbalanced braces in ${name}.`)
    const field = entry.fields.find(item => item.name === name)
    if (field) edits.push({ from: field.from, to: field.to, insert: literal })
    else if (value.trim()) added.push(`  ${name} = ${literal}`)
  }
  if (added.length) {
    const last = entry.fields.at(-1)
    // Add the separator immediately after the last value, before any trailing comment.
    if (last && !text.slice(last.to, entry.to - 1).replace(/%.*/g, '').includes(',')) edits.push({ from: last.to, to: last.to, insert: ',' })
    edits.push({ from: entry.to - 1, to: entry.to - 1, insert: '\n' + added.join(',\n') + '\n' })
  }
  return applyTextEdits(text, edits)
}

export type ImportChoice = { action: 'keep' | 'replace' | 'rename'; key?: string }
export function mergeBibImport<T extends TextSource>(files: T[], target: string, raw: string, choices: Record<string, ImportChoice>) {
  if (new TextEncoder().encode(raw).length > 524288 || raw.includes('\0')) throw new Error('Use UTF-8 BibTeX up to 512 KiB.')
  const incoming = parseBibFile({ id: 'import', path: 'import.bib', kind: 'text', content: raw })
  if (incoming.notices.length) throw new Error(incoming.notices.map(item => `Line ${item.line}: ${item.message}`).join('\n'))
  if (!incoming.entries.length) throw new Error('No valid BibTeX entries found.')
  if (new Set(incoming.entries.map(entry => entry.key)).size !== incoming.entries.length) throw new Error('Resolve duplicate keys within the imported text first.')
  const existing = indexReferences(files), patches = new Map<string, Edit[]>(), incomingEdits: Edit[] = []
  const reserved = new Set([...existing.entries, ...incoming.entries].map(entry => entry.key))
  for (const entry of incoming.entries) {
    const matches = existing.entries.filter(item => item.key === entry.key)
    if (!matches.length) continue
    const choice = Object.hasOwn(choices, entry.key) ? choices[entry.key] : undefined
    if (!choice || !['keep', 'replace', 'rename'].includes(choice.action)) throw new Error(`Choose how to handle duplicate key ${entry.key}.`)
    if (choice.action === 'keep') incomingEdits.push({ from: entry.from, to: entry.to, insert: '' })
    else if (choice.action === 'rename') {
      if (!choice.key || !validReferenceKey(choice.key) || reserved.has(choice.key)) throw new Error(`Choose an unused valid key for ${entry.key}.`)
      reserved.add(choice.key); incomingEdits.push({ from: entry.keyFrom, to: entry.keyTo, insert: choice.key })
    } else {
      if (matches.length !== 1) throw new Error(`Resolve existing duplicate ${entry.key} in source before replacing.`)
      const old = matches[0]
      patches.set(old.fileId, [...(patches.get(old.fileId) ?? []), { from: old.from, to: old.to, insert: entry.raw }])
      incomingEdits.push({ from: entry.from, to: entry.to, insert: '' })
    }
  }
  // All untouched strings/comments/preambles and unfamiliar fields remain byte-for-byte.
  const appended = applyTextEdits(raw, incomingEdits)
  const result = files.map(file => ({ ...file, content: applyTextEdits(file.content, patches.get(file.id) ?? []) }))
  const destination = result.find(file => file.path === target)
  if (!destination || destination.kind !== 'text' || !target.endsWith('.bib')) throw new Error('Choose an existing .bib file as the destination.')
  destination.content += '\n' + appended + '\n'
  return result
}
