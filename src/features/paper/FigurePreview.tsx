import { useEffect, useState } from 'react'
import { hydrateFigures, type PaperFile } from './paper-api'
import { imageType } from './file-tree'
export default function FigurePreview({ file }: { file: PaperFile }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController(); let objectUrl = ''
    void hydrateFigures([file], controller.signal).then(([figure]) => {
      if (controller.signal.aborted || !figure.bytes) return
      objectUrl = URL.createObjectURL(new Blob([figure.bytes], { type: imageType(file.path, figure.bytes) })); setUrl(objectUrl)
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Unable to load figure.') })
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [file])
  return <div className="figure-preview">{error ? <p role="alert">{error}</p> : url ? <img src={url} alt={file.path} /> : <p role="status">Loading figure...</p>}<p>Use <code>{`\\includegraphics{${file.path}}`}</code> in your LaTeX source.</p></div>
}
