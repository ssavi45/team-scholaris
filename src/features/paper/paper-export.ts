import { zip, strToU8, type AsyncZippable } from 'fflate'
import { validateSources, type SourceFile } from './compiler'

export function downloadName(title: string, kind: 'pdf' | 'source', olderPdf = false) {
  const stem = title.normalize('NFKC').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'scholaris-paper'
  const safe = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(stem) ? `paper-${stem}` : stem
  return kind === 'source' ? `${safe}-source.zip` : `${safe}${olderPdf ? '-last-compiled' : ''}.pdf`
}

export function exportSources(files: SourceFile[], draft: SourceFile | null, includeDraft: boolean): SourceFile[] {
  if (includeDraft && draft && !files.some((file) => file.path === draft.path)) throw new Error('The draft does not match a source file.')
  const snapshot = files.map((file) => ({ path: file.path, content: includeDraft && draft?.path === file.path ? draft.content : file.content,
    ...(file.kind ? { kind: file.kind, storage_path: file.storage_path, bytes: file.bytes } : {}) }))
  // Figure bytes are loaded by the export dialog before building the archive.
  validateSources(snapshot.filter((file) => file.kind !== 'image'), null)
  return snapshot
}

export async function sourceArchive(files: SourceFile[], signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  validateSources(files, null)
  signal.throwIfAborted()
  const entries: AsyncZippable = Object.create(null)
  for (const file of files) entries[file.kind === 'folder' ? file.path + '/' : file.path] = file.bytes ?? strToU8(file.content)
  return new Promise((resolve, reject) => {
    let terminate: (() => void) | undefined
    const abort = () => { terminate?.(); reject(new DOMException('Export cancelled.', 'AbortError')) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      terminate = zip(entries, { level: 6 }, (error, bytes) => {
        signal.removeEventListener('abort', abort)
        if (signal.aborted) { reject(new DOMException('Export cancelled.', 'AbortError')); return }
        if (error) reject(new Error('Unable to create the ZIP. Please try again.'))
        else resolve(Uint8Array.from(bytes))
      })
      if (signal.aborted) abort()
    } catch (cause) { signal.removeEventListener('abort', abort); reject(cause) }
  })
}

export function pdfDownload(bytes: Uint8Array<ArrayBuffer>) {
  if (bytes.length > 20 * 1024 * 1024 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('No valid compiled PDF is available. Recompile first.')
  return new Blob([bytes], { type: 'application/pdf' })
}

export function requestDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.hidden = true
  try { document.body.append(link); link.click() }
  catch (cause) { URL.revokeObjectURL(url); throw cause }
  finally { link.remove() }
  // Allow the browser to consume the URL even if the dialog closes immediately.
  setTimeout(() => URL.revokeObjectURL(url), 60000)
}
