import { useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

export function PdfPreview({ data }: { data: Uint8Array<ArrayBuffer> }) {
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [text, setText] = useState('')
  const [rendering, setRendering] = useState(true)
  const [width, setWidth] = useState(600)
  const canvas = useRef<HTMLCanvasElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const task = getDocument({ data: data.slice(), useSystemFonts: true })
    let cancelled = false
    void task.promise.then((pdf) => { if (!cancelled) setDocument(pdf) }).catch(() => { if (!cancelled) setError('Unable to display this PDF. Try compiling again.') })
    return () => { cancelled = true; void task.destroy() }
  }, [data])
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(160, entry.contentRect.width - 48)))
    observer.observe(viewport.current!)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!document || !canvas.current) return
    const target = canvas.current
    let cancelled = false
    let renderingTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined
    void document.getPage(page).then(async (pdfPage) => {
      if (cancelled) return
      setRendering(true); setError('')
      const natural = pdfPage.getViewport({ scale: 1 })
      const scale = width / natural.width * zoom
      const bounds = pdfPage.getViewport({ scale })
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2, 4096 / Math.max(bounds.width, bounds.height))
      target.width = Math.floor(bounds.width * pixelRatio)
      target.height = Math.floor(bounds.height * pixelRatio)
      target.style.width = `${bounds.width}px`; target.style.height = `${bounds.height}px`
      renderingTask = pdfPage.render({ canvas: target, viewport: bounds, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] })
      await renderingTask.promise
      const content = await pdfPage.getTextContent()
      if (!cancelled) { setText(content.items.map((item) => 'str' in item ? item.str : '').join(' ')); setRendering(false) }
    }).catch((cause: unknown) => {
      if (!cancelled && !(cause instanceof Error && cause.name === 'RenderingCancelledException')) { setError('This page could not be rendered. Try another page or recompile.'); setRendering(false) }
    })
    return () => { cancelled = true; renderingTask?.cancel() }
  }, [document, page, width, zoom])
  return <div className="pdf-viewer">
    <div className="pdf-controls">
      <div className="pdf-pagination"><button className="tool-button" aria-label="Previous PDF page" disabled={!document || page <= 1} onClick={() => setPage(page - 1)}>&larr;</button><span>{page} <span className="subtle">/ {document?.numPages ?? '...'}</span></span><button className="tool-button" aria-label="Next PDF page" disabled={!document || page >= document.numPages} onClick={() => setPage(page + 1)}>&rarr;</button></div>
      <label className="zoom-control"><span className="sr-only">PDF zoom</span><select value={zoom} onChange={(event) => setZoom(Number(event.target.value))}><option value={0.75}>75% of fit</option><option value={1}>Fit width</option><option value={1.25}>125% of fit</option><option value={1.5}>150% of fit</option></select></label>
    </div>
    {error && <p role="alert" className="notice error-notice">{error}</p>}
    <div className="pdf-viewport" ref={viewport} aria-busy={rendering}>
      {!document && !error && <p role="status" className="preview-loading">Opening PDF...</p>}
      <canvas ref={canvas} role="img" aria-label={`PDF page ${page}. A text version is available below.`} />
    </div>
    <details className="pdf-text"><summary>Page {page} text</summary><p>{text || 'No text on this page.'}</p></details>
  </div>
}
