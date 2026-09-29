import type { PDFDocumentProxy } from 'pdfjs-dist'

export type PdfHit = { page: number; excerpt: string; from: number; to: number }
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
  const term = query.trim()
  const hits: PdfHit[] = []
  if (!term) return hits
  for (let page = 1; page <= pdf.numPages; page++) {
    if (cancelled()) return []
    const item = await pdf.getPage(page)
    if (cancelled()) return []
    const content = await item.getTextContent()
    if (cancelled()) return []
    const source = content.items.map(part => 'str' in part ? part.str : '').join(' ')
    const expression = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    for (const match of source.matchAll(expression)) {
      hits.push({ page, from: match.index, to: match.index + match[0].length, excerpt: source.slice(Math.max(0, match.index - 45), match.index + match[0].length + 100) })
      if (hits.length >= 1000) return hits
    }
  }
  return hits
}

export type PdfSize = { width: number; height: number }
export type PdfLayout = PdfSize & { top: number; scale: number }
export function layoutPdfPages(sizes: PdfSize[], scale: number): PdfLayout[] {
  let top = 16
  return sizes.map(size => { const row = { width: size.width * scale, height: size.height * scale, scale, top }; top += row.height + 20; return row })
}
export function pdfPageAt(rows: PdfLayout[], top: number) {
  let low = 0, high = rows.length - 1
  while (low < high) { const middle = Math.ceil((low + high) / 2); if (rows[middle].top <= top) low = middle; else high = middle - 1 }
  return low
}
export function pdfAnchor(rows: PdfLayout[], top: number) {
  if (!rows.length) return { page: 1, fraction: 0 }
  const index = pdfPageAt(rows, top)
  return { page: index + 1, fraction: Math.max(0, Math.min(1, (top - rows[index].top) / rows[index].height)) }
}
export function restorePdfAnchor(rows: PdfLayout[], anchor: { page: number; fraction: number }) {
  const row = rows[clampPdfPage(anchor.page, rows.length) - 1]
  return row ? row.top + Math.max(0, Math.min(1, anchor.fraction)) * row.height : 0
}
export function visiblePdfPages(rows: PdfLayout[], top: number, height: number) {
  if (!rows.length) return []
  const first = Math.max(0, pdfPageAt(rows, top) - 1)
  const last = Math.min(rows.length - 1, pdfPageAt(rows, top + height) + 1, first + 11)
  return Array.from({ length: last - first + 1 }, (_, i) => first + i)
}
export function safePdfUrl(value: unknown) {
  if (typeof value !== 'string') return null
  try { const url = new URL(value); return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null } catch { return null }
}
