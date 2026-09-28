import { useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import { Search, RotateCw, Maximize2, Minimize2, Minus, Plus, X } from 'lucide-react'
import { clampPdfPage, pdfScale, findPdfPages, type PdfHit } from './pdf-tools'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

export function PdfPreview({ data, fullscreen, onFullscreen }: { data: Uint8Array<ArrayBuffer>; fullscreen: boolean; onFullscreen: () => void }) {
  const [loaded, setLoaded] = useState<{ pdf: PDFDocumentProxy; source: Uint8Array<ArrayBuffer> } | null>(null)
  const pdf = loaded?.source === data ? loaded.pdf : null
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [fit, setFit] = useState<'width' | 'page' | 'custom'>('width')
  const [rotation, setRotation] = useState(0)
  const [text, setText] = useState('')
  const [rendering, setRendering] = useState(true)
  const [dimensions, setDimensions] = useState({ width: 600, height: 700 })
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<{ source: typeof data; query: string; hits: PdfHit[]; complete: boolean; error?: string } | null>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const savedScroll = useRef({ top: 0, left: 0 })
  const painting = useRef(false)
  const renderedScale = useRef(1)
  useEffect(() => {
    const task = getDocument({ data: data.slice(), useSystemFonts: true })
    let cancelled = false
    void task.promise.then(document => { if (!cancelled) { setPage(current => clampPdfPage(current, document.numPages)); setLoaded({ pdf: document, source: data }); setError('') } })
      .catch(() => { if (!cancelled) setError('Unable to display this PDF. Try compiling again.') })
    return () => { cancelled = true; void task.destroy() }
  }, [data])
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0 && entry.contentRect.height > 0) setDimensions({ width: Math.max(100, entry.contentRect.width - 40), height: Math.max(100, entry.contentRect.height - 40) })
    })
    observer.observe(viewport.current!)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!pdf || !canvas.current) return
    const target = canvas.current
    let cancelled = false
    let renderTask: ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['render']> | undefined
    painting.current = true
    void pdf.getPage(page).then(async pdfPage => {
      if (cancelled) return
      setRendering(true); setError('')
      const angle = (pdfPage.rotate + rotation) % 360
      const natural = pdfPage.getViewport({ scale: 1, rotation: angle })
      const scale = pdfScale(fit, zoom, dimensions, natural)
      renderedScale.current = scale
      const bounds = pdfPage.getViewport({ scale, rotation: angle })
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2, 4096 / Math.max(bounds.width, bounds.height))
      target.width = Math.floor(bounds.width * pixelRatio); target.height = Math.floor(bounds.height * pixelRatio)
      target.style.width = `${bounds.width}px`; target.style.height = `${bounds.height}px`
      renderTask = pdfPage.render({ canvas: target, viewport: bounds, transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] })
      await renderTask.promise
      const content = await pdfPage.getTextContent()
      if (!cancelled) {
        setText(content.items.map(item => 'str' in item ? item.str : '').join(' ')); setRendering(false)
        if (viewport.current) { viewport.current.scrollTop = savedScroll.current.top; viewport.current.scrollLeft = savedScroll.current.left }
        painting.current = false
      }
    }).catch((cause: unknown) => {
      if (!cancelled && !(cause instanceof Error && cause.name === 'RenderingCancelledException')) { setError('This page could not be rendered. Try another page or recompile.'); setRendering(false); painting.current = false }
    })
    return () => { cancelled = true; renderTask?.cancel() }
  }, [pdf, page, dimensions, zoom, fit, rotation])
  useEffect(() => {
    if (!pdf || !searchOpen || !query.trim()) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const hits = await findPdfPages(pdf, query, () => cancelled)
          if (!cancelled) setSearch({ source: data, query, hits, complete: true })
        } catch { if (!cancelled) setSearch({ source: data, query, hits: [], complete: true, error: 'Search failed. Recompile or try again.' }) }
      })()
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [pdf, query, searchOpen, data])
  function go(number: number) {
    if (!pdf || !Number.isFinite(number)) return
    savedScroll.current = { top: 0, left: 0 }
    if (viewport.current) viewport.current.scrollTo(0, 0)
    setPage(clampPdfPage(number, pdf.numPages))
  }
  const results = search?.source === data && search.query === query ? search : null
  return <div className="pdf-viewer">
    <div className="pdf-controls">
      <button className="tool-button" aria-label="Previous PDF page" disabled={!pdf || page <= 1} onClick={() => go(page - 1)}>&larr;</button>
      <input className="pdf-page-number" type="number" min={1} max={pdf?.numPages ?? 1} aria-label="PDF page number" value={page} disabled={!pdf} onChange={event => { if (event.target.value) go(Number(event.target.value)) }} />
      <span className="pdf-page-count">/ {pdf?.numPages ?? '...'}</span>
      <button className="tool-button" aria-label="Next PDF page" disabled={!pdf || page >= pdf.numPages} onClick={() => go(page + 1)}>&rarr;</button>
      <button className="tool-button" aria-label="Zoom out" disabled={fit === 'custom' && zoom <= .25} onClick={() => { setFit('custom'); setZoom(Math.max(.25, Math.min(3, Math.round(renderedScale.current * 4 - 1) / 4))) }}><Minus size={14} /></button>
      <select aria-label="PDF zoom and fit" value={fit === 'custom' ? zoom : fit} onChange={event => { const value = event.target.value; if (value === 'width' || value === 'page') setFit(value); else { setFit('custom'); setZoom(Number(value)) } }}>
        <option value="width">Fit width</option><option value="page">Fit page</option>{Array.from({ length: 12 }, (_, i) => (i + 1) / 4).map(value => <option key={value} value={value}>{value * 100}%</option>)}
      </select>
      <button className="tool-button" aria-label="Zoom in" disabled={fit === 'custom' && zoom >= 3} onClick={() => { setFit('custom'); setZoom(Math.max(.25, Math.min(3, Math.round(renderedScale.current * 4 + 1) / 4))) }}><Plus size={14} /></button>
      <button className="tool-button" title="Rotate clockwise" aria-label="Rotate PDF clockwise" onClick={() => setRotation(value => (value + 90) % 360)}><RotateCw size={16} /></button>
      <button className="tool-button" title="Search PDF text" aria-label="Search PDF text" aria-expanded={searchOpen} onClick={() => setSearchOpen(!searchOpen)}><Search size={16} /></button>
      <button className="tool-button" title={fullscreen ? 'Exit full screen' : 'Full-screen PDF'} aria-label={fullscreen ? 'Exit full-screen PDF' : 'Full-screen PDF'} onClick={onFullscreen}>{fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
    </div>
    {searchOpen && <div className="pdf-search"><div><label><span className="sr-only">Search document text</span><input type="search" placeholder="Search PDF text..." value={query} onChange={event => setQuery(event.target.value)} autoFocus /></label><button className="tool-button" aria-label="Close PDF search" onClick={() => setSearchOpen(false)}><X size={16} /></button></div>
      {query.trim() && <div className="pdf-search-results" role="status">{!pdf ? 'Compile a PDF to search.' : !results ? 'Searching...' : results.error || (results.hits.length ? `${results.hits.length} matching pages` : 'No matching text.')}
        {results?.hits.map(hit => <button key={hit.page} onClick={() => go(hit.page)}><strong>Page {hit.page}</strong> {hit.excerpt}</button>)}
      </div>}
    </div>}
    {error && <p role="alert" className="notice error-notice">{error}</p>}
    <div className="pdf-viewport" ref={viewport} aria-busy={rendering || !pdf} onScroll={event => { if (pdf && !painting.current && event.currentTarget.clientWidth > 0) savedScroll.current = { top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft } }}>
      {!pdf && !error && <p role="status">Opening PDF...</p>}
      <canvas ref={canvas} role="img" aria-label={`PDF page ${page}. A text version is available below.`} />
    </div>
    <details className="pdf-text"><summary>Page {page} text</summary><p>{text || 'No text on this page.'}</p></details>
  </div>
}
