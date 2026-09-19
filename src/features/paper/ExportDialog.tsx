import { useEffect, useRef, useState } from 'react'
import type { SourceFile } from './compiler'
import { downloadName, exportSources, pdfDownload, requestDownload, sourceArchive } from './paper-export'
import { hydrateFigures } from './paper-api'

export type ExportSnapshot = {
  title: string
  files: SourceFile[]
  draft: SourceFile | null
  pdf: Uint8Array<ArrayBuffer> | null
  olderPdf: boolean
  warnings: boolean
}

export default function ExportDialog({ snapshot, close }: { snapshot: ExportSnapshot; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const job = useRef<AbortController | null>(null)
  const [includeDraft, setIncludeDraft] = useState(!!snapshot.draft)
  const [acceptOlder, setAcceptOlder] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  useEffect(() => {
    const node = dialog.current!
    node.showModal()
    return () => { job.current?.abort(); node.close() }
  }, [])

  async function downloadZip() {
    if (job.current) return
    const controller = new AbortController()
    job.current = controller; setBusy(true); setError(''); setStatus('Preparing source ZIP...')
    try {
      const files = exportSources(snapshot.files, snapshot.draft, includeDraft)
      const hydrated = await hydrateFigures(files, controller.signal)
      const bytes = await sourceArchive(hydrated, controller.signal)
      if (controller.signal.aborted) return
      requestDownload(new Blob([bytes], { type: 'application/zip' }), downloadName(snapshot.title, 'source'))
      setStatus('Source ZIP download requested. Check your browser downloads.')
    } catch (cause) {
      if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : 'Unable to export source.'); setStatus('') }
    } finally {
      job.current = null
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  function downloadPdf() {
    if (!snapshot.pdf || (snapshot.olderPdf && !acceptOlder)) return
    setError(''); setStatus('')
    try {
      requestDownload(pdfDownload(snapshot.pdf), downloadName(snapshot.title, 'pdf', snapshot.olderPdf))
      setStatus('PDF download requested. Check your browser downloads.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to download PDF.') }
  }
  return <dialog ref={dialog} className="project-dialog export-dialog" aria-labelledby="export-title" aria-describedby="export-description" onCancel={(event) => { event.preventDefault(); close() }}>
    <div className="export-heading"><div><p className="eyebrow">TAKE YOUR WORK WITH YOU</p><h2 id="export-title">Export paper</h2></div><button className="tool-button" aria-label="Close export" onClick={close} autoFocus>&times;</button></div>
    <p id="export-description" className="muted">Download a copy of the paper open in this workspace. Exporting does not save or change your project.</p>
    <section className="export-option" aria-labelledby="export-pdf-title"><span className="export-format">PDF</span><div><h3 id="export-pdf-title">Compiled paper</h3><p>The exact PDF from your last successful compilation.</p>
      {!snapshot.pdf ? <p className="export-hint">Compile your paper first to enable PDF download.</p> : <>
        {snapshot.olderPdf && <label className="export-checkbox"><input type="checkbox" checked={acceptOlder} onChange={(event) => setAcceptOlder(event.target.checked)} />Download the previous PDF. It may not reflect my latest source or compilation.</label>}
        {snapshot.warnings && <p className="export-hint">This PDF compiled with warnings. Review the log before sharing.</p>}
      </>}
      <button className="button secondary compact-button" disabled={!snapshot.pdf || busy || (snapshot.olderPdf && !acceptOlder)} onClick={downloadPdf}>{snapshot.olderPdf ? 'Download last compiled PDF' : 'Download PDF'}</button>
    </div></section>
    <section className="export-option" aria-labelledby="export-source-title"><span className="export-format">ZIP</span><div><h3 id="export-source-title">LaTeX source</h3><p>{snapshot.files.length} entries, including sources, bibliography files, and figures, with folder paths preserved. Uses the files loaded in this workspace when you opened Export.</p>
      {snapshot.draft && <label className="export-checkbox"><input type="checkbox" checked={includeDraft} disabled={busy} onChange={(event) => setIncludeDraft(event.target.checked)} />Include unsaved edits to {snapshot.draft.path}</label>}
      {snapshot.draft && <p className="export-hint">{includeDraft ? 'Your draft will be included in this copy. It remains unsaved in the project.' : 'The ZIP will use the last loaded saved version of this file.'}</p>}
      <button className="button primary compact-button" disabled={busy} onClick={() => void downloadZip()}>{busy ? 'Preparing ZIP...' : 'Download source ZIP'}</button>
    </div></section>
    {error && <p role="alert" className="notice error-notice">{error}</p>}
    <p className="export-status" role="status">{status}</p>
    <div className="dialog-actions"><button className="button secondary" onClick={close}>{busy ? 'Cancel export' : 'Done'}</button></div>
  </dialog>
}
