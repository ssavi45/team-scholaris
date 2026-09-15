import type { SourceFile } from './compiler'
export type TreeEntry = SourceFile & { id?: string; kind: 'text' | 'image' | 'folder'; size_bytes?: number }
export const textExtension = /\.(tex|bib|sty|cls|txt|bst|clo|cfg|def)$/
export const imageExtension = /\.(png|jpg|jpeg)$/
export function validPath(path: string) {
  return path.length <= 240 && /^[A-Za-z0-9_-][A-Za-z0-9_.-]*(\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*$/.test(path)
    && path.split('/').every((part) => !part.endsWith('.') && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part))
}
export function validateTree(entries: TreeEntry[], mainFile?: string) {
  if (entries.length > 100) throw new Error('Limit: 100 files and folders.')
  const seen = new Set<string>(); let textSize = 0; let imageSize = 0
  for (const entry of entries) {
    if (!validPath(entry.path) || seen.has(entry.path.toLowerCase())) throw new Error(`Invalid or conflicting path: ${entry.path}`)
    seen.add(entry.path.toLowerCase())
    if (entry.kind === 'text') {
      const size = new TextEncoder().encode(entry.content).length
      if (!textExtension.test(entry.path) || size > 524288) throw new Error(`Unsupported source type or file over 512 KiB: ${entry.path}`)
      textSize += size
    } else if (entry.kind === 'image') {
      const size = entry.bytes?.length ?? entry.size_bytes ?? 0
      if (!imageExtension.test(entry.path) || size < 1 || size > 5242880) throw new Error(`Unsupported figure or file over 5 MiB: ${entry.path}`)
      imageSize += size
    }
    if (entries.some((parent) => parent.kind !== 'folder' && entry.path.toLowerCase().startsWith(parent.path.toLowerCase() + '/'))) throw new Error(`File/folder conflict: ${entry.path}`)
  }
  if (textSize > 5242880 || imageSize > 26214400) throw new Error('Workspace limit: 5 MiB source and 25 MiB figures.')
  if (mainFile !== undefined && !entries.some((entry) => entry.path === mainFile && entry.kind === 'text' && entry.path.endsWith('.tex'))) throw new Error('Choose an existing .tex file as the main file.')
}
export function moveEntries(entries: TreeEntry[], from: string, to: string) {
  if (!validPath(to) || to.startsWith(from + '/')) throw new Error('Choose a valid destination outside this folder.')
  const result = entries.map((entry) => entry.path === from || entry.path.startsWith(from + '/') ? { ...entry, path: to + entry.path.slice(from.length) } : entry)
  validateTree(result); return result
}
export function removeEntries(entries: TreeEntry[], path: string) { return entries.filter((entry) => entry.path !== path && !entry.path.startsWith(path + '/')) }
export function mergeEntries(entries: TreeEntry[], incoming: TreeEntry[], replace: boolean) {
  const result = [...entries]
  for (const file of incoming) {
    const at = result.findIndex((entry) => entry.path.toLowerCase() === file.path.toLowerCase())
    if (at < 0) result.push(file)
    else if (file.kind === 'folder' && result[at].kind === 'folder') continue
    else if (replace) result[at] = { ...file, id: result[at].id }
    else throw new Error(`Already exists: ${file.path}. Enable replacement or rename the incoming file.`)
  }
  validateTree(result); return result
}
export function imageType(path: string, bytes: Uint8Array) {
  const png = bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((value, i) => bytes[i] === value)
  const jpeg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  if (path.endsWith('.png') && png) return 'image/png'
  if (/\.(jpg|jpeg)$/.test(path) && jpeg) return 'image/jpeg'
  throw new Error(`Image contents do not match the filename: ${path}`)
}
