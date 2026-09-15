import { readSourceZip } from './zip-import'
self.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
  try { self.postMessage({ result: readSourceZip(new Uint8Array(data)) }) }
  catch (cause) { self.postMessage({ error: cause instanceof Error ? cause.message : 'Unable to read ZIP.' }) }
}
