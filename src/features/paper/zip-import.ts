import { inflateSync } from 'fflate'
import { imageExtension, imageType, textExtension, validPath, validateTree, type TreeEntry } from './file-tree'
export type ZipImport = { entries: TreeEntry[]; skipped: string[] }
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})
function crc32(bytes: Uint8Array) { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0 }

// Parse the central directory before allocating decompression buffers. Inflation has a fixed output size.
export function readSourceZip(bytes: Uint8Array<ArrayBuffer>): ZipImport {
  if (bytes.length > 20 * 1024 * 1024) throw new Error('ZIP uploads are limited to 20 MiB.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = -1
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50 && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) { end = offset; break }
  }
  if (end < 0) throw new Error('This is not a supported ZIP archive.')
  const count = view.getUint16(end + 10, true), directorySize = view.getUint32(end + 12, true), directoryOffset = view.getUint32(end + 16, true)
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || view.getUint16(end + 8, true) !== count || count > 500 || directoryOffset + directorySize !== end) throw new Error('Split, ZIP64, or oversized archives are not supported.')
  const entries: TreeEntry[] = [], skipped: string[] = [], names = new Set<string>()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let position = directoryOffset, total = 0
  for (let index = 0; index < count; index++) {
    if (position + 46 > end || view.getUint32(position, true) !== 0x02014b50) throw new Error('Invalid ZIP directory.')
    const flags = view.getUint16(position + 8, true), method = view.getUint16(position + 10, true)
    const expectedCrc = view.getUint32(position + 16, true), compressed = view.getUint32(position + 20, true), size = view.getUint32(position + 24, true)
    const nameLength = view.getUint16(position + 28, true), extraLength = view.getUint16(position + 30, true), commentLength = view.getUint16(position + 32, true)
    const attributes = view.getUint32(position + 38, true), localOffset = view.getUint32(position + 42, true)
    if (position + 46 + nameLength + extraLength + commentLength > end || (flags & 1) || ((attributes >>> 16) & 0xf000) === 0xa000 || ![0, 8].includes(method)) throw new Error('Encrypted, symbolic-link, or unsupported ZIP entries are not allowed.')
    const name = decoder.decode(bytes.subarray(position + 46, position + 46 + nameLength))
    position += 46 + nameLength + extraLength + commentLength
    const folder = name.endsWith('/'), path = folder ? name.slice(0, -1) : name
    if (name.startsWith('__MACOSX/') || /(^|\/)\.DS_Store$/.test(name)) { skipped.push(name); continue }
    if (!validPath(path) || names.has(path.toLowerCase())) throw new Error(`Unsafe or duplicate ZIP path: ${name}`)
    names.add(path.toLowerCase())
    if (size > 5242880 || compressed > bytes.length || (total += size) > 30 * 1024 * 1024) throw new Error('Expanded ZIP exceeds the paper limits.')
    if (!folder && !textExtension.test(path) && !imageExtension.test(path)) { skipped.push(path); continue }
    if (localOffset + 30 > directoryOffset || view.getUint32(localOffset, true) !== 0x04034b50 || (view.getUint16(localOffset + 6, true) & 1) || view.getUint16(localOffset + 8, true) !== method) throw new Error('Invalid ZIP file header.')
    const localNameLength = view.getUint16(localOffset + 26, true), start = localOffset + 30 + localNameLength + view.getUint16(localOffset + 28, true)
    if (start + compressed > directoryOffset || decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength)) !== name) throw new Error('ZIP file headers do not match.')
    if (folder) { if (size !== 0) throw new Error('ZIP folders must be empty.'); entries.push({ path, kind: 'folder', content: '' }); continue }
    if (textExtension.test(path) && size > 524288) throw new Error(`Source file exceeds 512 KiB: ${path}`)
    const input = bytes.subarray(start, start + compressed)
    const data = method === 0 ? input.slice() : inflateSync(input, { out: new Uint8Array(size) })
    if (data.length !== size || crc32(data) !== expectedCrc) throw new Error(`Corrupt ZIP entry: ${path}`)
    if (imageExtension.test(path)) {
      imageType(path, data); entries.push({ path, kind: 'image', content: '', bytes: Uint8Array.from(data), size_bytes: size })
    } else {
      const content = decoder.decode(data)
      if (content.includes('\0')) throw new Error(`Source must be UTF-8 text: ${path}`)
      entries.push({ path, kind: 'text', content })
    }
  }
  if (position !== end) throw new Error('Invalid ZIP directory length.')
  validateTree(entries)
  return { entries, skipped }
}
