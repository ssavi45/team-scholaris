import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { TextLayer, type PDFDocumentProxy } from 'pdfjs-dist'
import { safePdfUrl, type PdfHit } from './pdf-tools'

export function PdfPageSurface({ pdf, number, scale, rotation, hit, navigate, revealMatch, thumbnail = false }: {
  pdf: PDFDocumentProxy; number: number; scale: number; rotation: number; hit?: PdfHit;
  navigate: (destination: unknown) => void; revealMatch?: (node: HTMLElement) => void; thumbnail?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null)
  const canvasHost = useRef<HTMLDivElement>(null)
  const textHost = useRef<HTMLDivElement>(null)
  const linksHost = useRef<HTMLDivElement>(null)
  const layer = useRef<TextLayer | null>(null)
  const [ready, setReady] = useState(0)
  const [error, setError] = useState('')
  const callbacks = useRef(navigate)
  const reveal = useRef(revealMatch)
  useEffect(() => { reveal.current = revealMatch }, [revealMatch])
  useEffect(() => { callbacks.current = navigate }, [navigate])
  useEffect(() => {
    let cancelled = false
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined
    let page: Awaited<ReturnType<PDFDocumentProxy['getPage']>> | undefined
    // Each effect owns its bitmap. StrictMode replay/rapid changes can start a new
    // render before the previous render's asynchronous cancellation has settled.
    const target = document.createElement('canvas')
    target.setAttribute('aria-hidden', 'true')
    canvasHost.current!.replaceChildren(target)
    const textNode = textHost.current!, linksNode = linksHost.current!
    let ownedLayer: TextLayer | null = null
    void (async () => {
      try {
        page = await pdf.getPage(number)
        if (cancelled) return
        const bounds = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 })
        textNode.style.setProperty('--total-scale-factor', String(scale * page.userUnit))
        // Bound every bitmap independently, including high-DPI devices and large pages.
        const ratio = Math.min(window.devicePixelRatio || 1, 2, 2048 / Math.max(bounds.width, bounds.height))
        target.width = Math.max(1, Math.floor(bounds.width * ratio)); target.height = Math.max(1, Math.floor(bounds.height * ratio))
        target.style.width = `${bounds.width}px`; target.style.height = `${bounds.height}px`
        render = page.render({ canvas: target, viewport: bounds, transform: [ratio, 0, 0, ratio, 0, 0], background: '#ffffff' })
        await render.promise
        if (cancelled) return
        setError('')
        if (thumbnail) return
        const content = await page.getTextContent()
        if (cancelled) return
        const textLayer = new TextLayer({ textContentSource: content, container: textNode, viewport: bounds })
        ownedLayer = textLayer; layer.current = textLayer
        await textLayer.render()
        if (cancelled) return
        setReady(value => value + 1)
        const annotations = await page.getAnnotations({ intent: 'display' })
        if (cancelled) return
        for (const annotation of annotations) {
          if (annotation.subtype !== 'Link' || !Array.isArray(annotation.rect)) continue
          const url = safePdfUrl(annotation.url)
          if (!url && !annotation.dest) continue
          const [a, b, c, d, e, f] = bounds.transform
          const [x1, y1, x2, y2] = annotation.rect
          const rect = [a * x1 + c * y1 + e, b * x1 + d * y1 + f, a * x2 + c * y2 + e, b * x2 + d * y2 + f]
          const node = document.createElement(url ? 'a' : 'button')
          node.className = 'pdf-document-link'
          node.setAttribute('aria-label', url ? `Open ${url}` : 'Follow PDF reference')
          if (node instanceof HTMLAnchorElement && url) { node.href = url; node.target = '_blank'; node.rel = 'noopener noreferrer' }
          else { node.onclick = () => callbacks.current(annotation.dest) }
          Object.assign(node.style, { left: `${Math.min(rect[0], rect[2])}px`, top: `${Math.min(rect[1], rect[3])}px`, width: `${Math.abs(rect[2] - rect[0])}px`, height: `${Math.abs(rect[3] - rect[1])}px` })
          linksNode.append(node)
        }
      } catch (cause) { if (!cancelled && !(cause instanceof Error && cause.name === 'RenderingCancelledException')) setError('Page unavailable. Recompile to retry.') }
    })()
    return () => {
      cancelled = true; render?.cancel(); ownedLayer?.cancel()
      if (layer.current === ownedLayer) layer.current = null
      textNode.replaceChildren(); linksNode.replaceChildren()
      target.remove()
      // Release only this render's bitmap. PDFPageProxy is shared with thumbnails
      // and replacement surfaces; its resources belong to the document lifecycle.
      void Promise.resolve(render?.promise).catch(() => {}).then(() => { target.width = 0; target.height = 0 })
    }
  }, [pdf, number, scale, rotation, thumbnail])
  useEffect(() => {
    const textLayer = layer.current
    if (!textLayer || !ready) return
    let offset = 0, first: HTMLElement | null = null
    textLayer.textDivs.forEach((node, index) => {
      const value = textLayer.textContentItemsStr[index]
      node.textContent = value
      if (hit && hit.page === number && hit.from < offset + value.length && hit.to > offset) {
        const from = Math.max(0, hit.from - offset), to = Math.min(value.length, hit.to - offset)
        const mark = document.createElement('mark'); mark.className = 'pdf-text-match'; mark.textContent = value.slice(from, to)
        node.replaceChildren(document.createTextNode(value.slice(0, from)), mark, document.createTextNode(value.slice(to)))
        first ??= mark
      }
      offset += value.length + 1
    })
    if (first) reveal.current?.(first)
  }, [hit, number, ready])
  return <div ref={root} className="pdf-page-surface" style={{ '--total-scale-factor': scale } as CSSProperties}>
    <div ref={canvasHost} className="pdf-bitmap" />
    <div ref={textHost} className="pdf-selectable-text" />
    <div ref={linksHost} className="pdf-document-links" />
    {error && <p role="alert" className="pdf-page-error">{error}</p>}
  </div>
}
