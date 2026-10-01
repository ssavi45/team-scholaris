import { parentPort, workerData } from 'node:worker_threads'
import * as Y from 'yjs'

const doc = new Y.Doc()
try {
  const source = doc.getText('source')
  if (workerData.state) Y.applyUpdate(doc, Buffer.from(workerData.state, 'base64'))
  else source.insert(0, workerData.content)
  if (workerData.update) Y.applyUpdate(doc, workerData.update)
  if (doc.share.size !== 1 || source.toDelta().some(part => typeof part.insert !== 'string' || part.attributes)) {
    throw new Error('Only plain source text is supported.')
  }
  const content = source.toString(), state = Y.encodeStateAsUpdate(doc)
  if (Buffer.byteLength(content) > 524288 || state.byteLength > 2097152) throw new Error('Shared document size limit reached.')
  parentPort.postMessage({ content, state: Buffer.from(state).toString('base64') })
} catch {
  parentPort.postMessage({ error: 'Invalid or oversized shared document update.' })
} finally {
  doc.destroy()
}
