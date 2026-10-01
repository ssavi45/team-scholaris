import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import { Search, RotateCw, Maximize2, Minimize2, Minus, Plus, X, PanelLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import { clampPdfPage, pdfScale, findPdfPages, layoutPdfPages, visiblePdfPages, pdfAnchor, restorePdfAnchor, safePdfUrl, type PdfHit, type PdfSize } from './pdf-tools'
import { PdfPageSurface } from './PdfPageSurface'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import './pdf-reader.css'

GlobalWorkerOptions.workerSrc = workerUrl

type Outline = { title: string; dest: unknown; url?: string | null; items: Outline[] }
type Model = { id: number; pdf: PDFDocumentProxy; source: Uint8Array<ArrayBuffer>; sizes: PdfSize[]; outline: Outline[] }
export type PdfSearchRequest = { text: string; token: number }
export function PdfPreview({ data, fullscreen, onFullscreen, stale, searchRequest, findSource }: {
  data: Uint8Array<ArrayBuffer>; fullscreen: boolean; onFullscreen: () => void; stale: boolean;
  searchRequest: PdfSearchRequest | null; findSource?: (text: string) => void;
}) {
  const generation = useRef(0)
  const [loaded, setLoaded] = useState<Model | null>(null)
  const model = loaded?.source === data ? loaded : null
  const pdf = model?.pdf
  const currentPdf = useRef(pdf)
  useEffect(() => { currentPdf.current = pdf }, [pdf])
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(1), [fit, setFit] = useState<'width' | 'page' | 'custom'>('width')
  const [rotation, setRotation] = useState(0)
  const [dimensions, setDimensions] = useState({ width: 600, height: 700 })
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const [navigator, setNavigator] = useState(false), [navigationTab, setNavigationTab] = useState<'pages' | 'outline'>('pages')
  const [searchState, setSearchState] = useState({ open: false, query: '', token: 0 })
  const externalSearch = searchRequest && searchRequest.token !== searchState.token
  const searchOpen = externalSearch ? true : searchState.open
  const query = externalSearch ? searchRequest.text : searchState.query
  const updateSearch = (query: string, open = true) => setSearchState({ query, open, token: searchRequest?.token ?? 0 })
  const [search, setSearch] = useState<{ source: typeof data; query: string; hits: PdfHit[]; error?: string } | null>(null)
  const [activeHit, setActiveHit] = useState<{ source: typeof data; query: string; index: number } | null>(null)
  const [text, setText] = useState<{ source: typeof data; page: number; value: string } | null>(null)
  const [selectedText, setSelectedText] = useState<{ source: typeof data; text: string } | null>(null)
  const selection = selectedText?.source === data ? selectedText.text : ''
  const setSelection = (text: string) => setSelectedText({ source: data, text })
  const viewport = useRef<HTMLDivElement>(null)
  const anchor = useRef({ page: 1, fraction: 0, left: 0 })
  const restoring = useRef(false)
  const pendingMatch = useRef<PdfHit | null>(null)
  const sizes = useMemo(() => model?.sizes.map(size => rotation % 180 ? { width: size.height, height: size.width } : size) ?? [], [model, rotation])
  // A single document scale keeps differently-sized pages in their true proportions.
  const scale = sizes.length ? pdfScale(fit, zoom, { width: Math.max(100, dimensions.width - 32), height: Math.max(100, dimensions.height - 32) }, sizes[0]) : 1
  const rows = useMemo(() => layoutPdfPages(sizes, scale), [sizes, scale])
  const page = rows.length ? pdfAnchor(rows, scroll.top + 2).page : 1
  const visible = visiblePdfPages(rows, scroll.top, dimensions.height)
  const results = search?.source === data && search.query === query ? search : null
  const hitIndex = activeHit?.source === data && activeHit.query === query ? activeHit.index : -1
  const hit = hitIndex >= 0 && searchOpen ? results?.hits[hitIndex] : undefined
  const totalHeight = rows.length ? rows.at(-1)!.top + rows.at(-1)!.height + 16 : 0
  const totalWidth = Math.max(dimensions.width, ...rows.map(row => row.width + 32))

  useEffect(() => {
    const task = getDocument({ data: data.slice(), useSystemFonts: true })
    let cancelled = false
    void (async () => {
      try {
        const document = await task.promise
        const sizes: PdfSize[] = []
        for (let i = 1; i <= document.numPages; i++) {
          if (cancelled) return
          const item = await document.getPage(i), size = item.getViewport({ scale: 1 })
          sizes.push({ width: size.width, height: size.height })
        }
        const outline = await document.getOutline().catch(() => null)
        if (!cancelled) { setLoaded({ id: ++generation.current, pdf: document, source: data, sizes, outline: outline ?? [] }); setError('') }
      } catch { if (!cancelled) setError('Unable to display this PDF. Recompile to retry.') }
    })()
    return () => { cancelled = true; void task.destroy() }
  }, [data])
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0 && entry.contentRect.height > 0) setDimensions({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(viewport.current!)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    const node = viewport.current
    if (!node || !rows.length) return
    restoring.current = true
    const top = restorePdfAnchor(rows, anchor.current)
    node.scrollTop = top; node.scrollLeft = anchor.current.left
    // Match browser clamping near the end of a shorter document.
    setScroll({ top: node.scrollTop, left: node.scrollLeft })
    anchor.current = { ...pdfAnchor(rows, node.scrollTop), left: node.scrollLeft }
    const frame = requestAnimationFrame(() => { restoring.current = false })
    return () => cancelAnimationFrame(frame)
  }, [rows])
  useEffect(() => {
    if (!pdf) return
    let cancelled = false
    void pdf.getPage(page).then(item => item.getTextContent()).then(content => {
      if (!cancelled) setText({ source: data, page, value: content.items.map(item => 'str' in item ? item.str : '').join(' ') })
    }).catch(() => { if (!cancelled) setText({ source: data, page, value: 'Text unavailable.' }) })
    return () => { cancelled = true }
  }, [pdf, page, data])
  useEffect(() => {
    if (!pdf || !searchOpen || !query.trim()) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      void findPdfPages(pdf, query, () => cancelled).then(hits => { if (!cancelled) setSearch({ source: data, query, hits }) })
        .catch(() => { if (!cancelled) setSearch({ source: data, query, hits: [], error: 'Search failed. Try again after recompiling.' }) })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [pdf, query, searchOpen, data])
  function go(number: number, fraction = 0) {
    const node = viewport.current
    if (!pdf || !node || !Number.isFinite(number)) return
    node.scrollTop = restorePdfAnchor(rows, { page: clampPdfPage(number, pdf.numPages), fraction })
    anchor.current = { ...pdfAnchor(rows, node.scrollTop), left: node.scrollLeft }
    setScroll({ top: node.scrollTop, left: node.scrollLeft })
  }
  async function navigate(destination: unknown) {
    if (!pdf) return
    try {
      const dest = typeof destination === 'string' ? await pdf.getDestination(destination) : destination
      if (!Array.isArray(dest) || !dest.length) return
      const index = typeof dest[0] === 'number' ? dest[0] : await pdf.getPageIndex(dest[0])
      // Follow the real destination page. Coordinates are intentionally not guessed for rotated destinations.
      if (currentPdf.current === pdf && Number.isInteger(index) && index >= 0 && index < pdf.numPages) go(index + 1)
    } catch { if (currentPdf.current === pdf) setError('This PDF reference could not be resolved.') }
  }
  function changeZoom(direction: number) { setFit('custom'); setZoom(Math.max(.25, Math.min(3, Math.round(scale * 4 + direction) / 4))) }
  function match(index: number) {
    if (!results?.hits.length) return
    const next = (index + results.hits.length) % results.hits.length
    pendingMatch.current = results.hits[next]
    setActiveHit({ source: data, query, index: next }); go(results.hits[next].page)
  }
  function bookmarks(items: Outline[], depth = 0): React.ReactNode {
    if (depth > 20) return null
    return <ul>{items.map((item, index) => <li key={index}>{safePdfUrl(item.url) ? <a href={safePdfUrl(item.url)!} target="_blank" rel="noopener noreferrer">{item.title}</a> : <button disabled={!item.dest} onClick={() => void navigate(item.dest)}>{item.title}</button>}{item.items?.length > 0 && bookmarks(item.items, depth + 1)}</li>)}</ul>
  }
  return <div className="pdf-viewer pdf-continuous" onKeyDown={event => {
    if (!(event.ctrlKey || event.metaKey) || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
    if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(1) }
    if (event.key === '-') { event.preventDefault(); changeZoom(-1) }
    if (event.key === 'f') { event.preventDefault(); updateSearch(query) }
  }}>
    <div className="pdf-controls">
      <button className="tool-button" title="Pages and bookmarks" aria-label="Pages and bookmarks" aria-expanded={navigator} onClick={() => setNavigator(!navigator)}><PanelLeft size={16} /></button>
      <div className="pdf-page-navigation" role="group" aria-label="Page navigation">
        <button className="tool-button" title="Previous page" aria-label="Scroll to previous PDF page" disabled={!pdf || page <= 1} onClick={() => go(page - 1)}><ChevronLeft size={18} /></button>
        <form className="pdf-page-box" onSubmit={event => { event.preventDefault(); const input = event.currentTarget.elements.namedItem('page') as HTMLInputElement; go(Number(input.value)) }}>
          <input key={page} name="page" className="pdf-page-number" type="text" inputMode="numeric" pattern="[0-9]+" required aria-label="PDF page number; press Enter to jump" title="Type a page number and press Enter" defaultValue={page} disabled={!pdf} />
          <span className="pdf-page-count">/ {pdf?.numPages ?? '…'}</span>
        </form>
        <button className="tool-button" title="Next page" aria-label="Scroll to next PDF page" disabled={!pdf || page >= pdf.numPages} onClick={() => go(page + 1)}><ChevronRight size={18} /></button>
      </div>
      <div className="pdf-zoom-controls" role="group" aria-label="PDF zoom">
        <button className="tool-button" title="Zoom out" aria-label="Zoom out" disabled={!pdf || scale <= .25} onClick={() => changeZoom(-1)}><Minus size={15} /></button>
        <select disabled={!pdf} aria-label="PDF zoom and fit" title="Zoom or fit the page" value={fit === 'custom' ? zoom : fit} onChange={event => { const value = event.target.value; if (value === 'width' || value === 'page') setFit(value); else { setFit('custom'); setZoom(Number(value)) } }}><option value="width">Fit width{fit === 'width' && pdf ? ' · ' + Math.round(scale * 100) + '%' : ''}</option><option value="page">Fit page{fit === 'page' && pdf ? ' · ' + Math.round(scale * 100) + '%' : ''}</option>{Array.from({ length: 12 }, (_, i) => (i + 1) / 4).map(value => <option key={value} value={value}>{value * 100}%</option>)}</select>
        <button className="tool-button" title="Zoom in" aria-label="Zoom in" disabled={!pdf || scale >= 3} onClick={() => changeZoom(1)}><Plus size={15} /></button>
      </div>
      <div className="pdf-view-actions" role="group" aria-label="PDF view tools">
        <button className="tool-button" title="Rotate clockwise" aria-label="Rotate PDF clockwise" disabled={!pdf} onClick={() => setRotation(value => (value + 90) % 360)}><RotateCw size={16} /></button>
        <button className="tool-button" title="Search PDF" aria-label="Search PDF text" aria-expanded={searchOpen} onClick={() => updateSearch(query, !searchOpen)}><Search size={16} /></button>
        <button className="tool-button" title={fullscreen ? 'Exit full screen' : 'Full screen'} aria-label={fullscreen ? 'Exit full-screen PDF' : 'Full-screen PDF'} onClick={onFullscreen}>{fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
      </div>
    </div>
    {searchOpen && <div className="pdf-search"><div><label><span className="sr-only">Search PDF text (literal)</span><input autoFocus type="search" value={query} placeholder="Search PDF text…" onChange={event => updateSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); match(hitIndex + (event.shiftKey ? -1 : 1)) } }} /></label><button className="tool-button" aria-label="Previous match" disabled={!results?.hits.length} onClick={() => match(hitIndex - 1)}>↑</button><button className="tool-button" aria-label="Next match" disabled={!results?.hits.length} onClick={() => match(hitIndex + 1)}>↓</button><button className="tool-button" aria-label="Close PDF search" onClick={() => updateSearch(query, false)}><X size={16} /></button></div><p role="status">{!query.trim() ? 'Literal PDF text search; not exact source mapping.' : !results ? 'Searching…' : results.error || `${hitIndex >= 0 ? hitIndex + 1 : 0} / ${results.hits.length}${results.hits.length === 1000 ? '+' : ''} matches`}</p></div>}
    {error && <p role="alert" className="notice error-notice">{error}</p>}
    <div className="pdf-reader-body">
      {navigator && <aside className="pdf-reader-navigation" aria-label="PDF navigation"><div><button aria-pressed={navigationTab === 'pages'} onClick={() => setNavigationTab('pages')}>Pages</button><button aria-pressed={navigationTab === 'outline'} onClick={() => setNavigationTab('outline')}>Bookmarks</button><button aria-label="Close PDF navigation" onClick={() => setNavigator(false)}>×</button></div>{navigationTab === 'outline' ? model?.outline.length ? bookmarks(model.outline) : <p>No PDF bookmarks.</p> : pdf && <><button disabled={page <= 3} onClick={() => go(Math.max(1, page - 5))}>Earlier pages</button>{rows.slice(Math.max(0, page - 3), Math.min(rows.length, page + 2)).map((row, i) => { const number = Math.max(0, page - 3) + i + 1; return <button className="pdf-thumbnail" aria-label={`Go to page ${number}`} aria-current={page === number ? 'page' : undefined} key={`${model?.id}:${number}:${rotation}`} onClick={() => go(number)}><div style={{ width: 100, height: 100 * row.height / row.width }}><PdfPageSurface pdf={pdf} number={number} scale={100 / sizes[number - 1].width} rotation={rotation} navigate={() => {}} thumbnail /></div><span>{number}</span></button> })}<button disabled={page >= rows.length - 2} onClick={() => go(Math.min(rows.length, page + 5))}>Later pages</button></>}</aside>}
      <div className="pdf-viewport" ref={viewport} tabIndex={0} aria-label="Continuous PDF document. Scroll to read all pages." aria-busy={!pdf} onPointerUp={() => { const current = window.getSelection(); setSelection(current?.anchorNode && viewport.current?.contains(current.anchorNode) ? current.toString().trim().slice(0, 200) : '') }} onKeyUp={() => { const current = window.getSelection(); setSelection(current?.anchorNode && viewport.current?.contains(current.anchorNode) ? current.toString().trim().slice(0, 200) : '') }} onScroll={event => {
        if (!pdf || restoring.current || !rows.length) return
        const node = event.currentTarget
        anchor.current = { ...pdfAnchor(rows, node.scrollTop), left: node.scrollLeft }
        setScroll({ top: node.scrollTop, left: node.scrollLeft })
      }}>
        {!pdf && !error && <p role="status">Opening PDF…</p>}
        <div className="pdf-document-stack" style={{ height: totalHeight, width: totalWidth }}>{pdf && visible.map(index => { const row = rows[index]; return <section key={`${model?.id}:${index}:${scale}:${rotation}`} className="pdf-continuous-page" aria-label={`Page ${index + 1}`} style={{ top: row.top, left: Math.max(16, (totalWidth - row.width) / 2), width: row.width, height: row.height }}><PdfPageSurface pdf={pdf} number={index + 1} scale={scale} rotation={rotation} hit={hit?.page === index + 1 ? hit : undefined} revealMatch={node => { const target = pendingMatch.current; if (!target || target.page !== index + 1 || target !== hit) return; pendingMatch.current = null; const scroller = viewport.current; if (scroller) scroller.scrollTop += node.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 70 }} navigate={destination => void navigate(destination)} /></section> })}</div>
      </div>
    </div>
    <div className="pdf-reading-status"><span>Continuous scroll · Page {page}</span>{findSource && <button className="tool-button" disabled={stale || !selection} title={stale ? 'Recompile before looking up source text' : 'Select PDF text, then search current source; not exact SyncTeX mapping'} onClick={() => findSource(selection)}>Find selection in source</button>}{stale && <span>Outdated PDF</span>}</div>
    <details className="pdf-text"><summary>Page {page} text alternative</summary><p>{text?.source === data && text.page === page ? text.value || 'No text on this page.' : 'Loading page text…'}</p></details>
  </div>
}
