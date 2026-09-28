import type { PDFDocumentProxy } from 'pdfjs-dist'

export type PdfHit = { page: number; excerpt: string }
export function clampPdfPage(page: number, count: number) {
  return Math.max(1, Math.min(Number.isFinite(page) ? Math.floor(page) : 1, count))
}
export function pdfScale(fit: 'width' | 'page' | 'custom', zoom: number, available: { width: number; height: number }, natural: { width: number; height: number }) {
  return fit === 'custom' ? zoom : fit === 'page'
    ? Math.min(available.width / natural.width, available.height / natural.height)
    : available.width / natural.width
}
// Search sequentially to bound memory and allow cancellation between page reads.
export async function findPdfPages(pdf: Pick<PDFDocumentProxy, 'numPages' | 'getPage'>, query: string, cancelled: () => boolean): Promise<PdfHit[]> {
  const term = query.trim().toLocaleLowerCase()
  const hits: PdfHit[] = []
  if (!term) return hits
  for (let page = 1; page <= pdf.numPages; page++) {
    if (cancelled()) return []
    const item = await pdf.getPage(page)
    if (cancelled()) return []
    const content = await item.getTextContent()
    if (cancelled()) return []
    const source = content.items.map(part => 'str' in part ? part.str : '').join(' ')
    const index = source.toLocaleLowerCase().indexOf(term)
    if (index >= 0) hits.push({ page, excerpt: source.slice(Math.max(0, index - 45), index + term.length + 100) })
  }
  return hits
}
