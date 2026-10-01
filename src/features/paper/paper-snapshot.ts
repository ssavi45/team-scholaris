import { supabase } from '../../lib/supabase'
import { hydrateFigures, type PaperFile } from './paper-api'
import { sourceSignature, type Compilation, type SourceFile } from './compiler'

export type SharedCut = { fileId: string; epoch: string; sequence: number }
export type PaperSnapshot = {
  id: string; title: string; revision: number; main: string; files: SourceFile[];
  entries: PaperFile[]; shared: SharedCut[]
}
export type PaperBuild = Compilation & { id: number; revision: number; main: string; snapshot: PaperSnapshot }

export async function capturePaperSnapshot(projectId: string, signal: AbortSignal, cut?: SharedCut, cache?: Map<string, Uint8Array<ArrayBuffer>>): Promise<PaperSnapshot> {
  if (!supabase) throw new Error('Supabase is not configured.')
  signal.throwIfAborted()
  const { data, error } = await supabase.rpc('capture_paper_snapshot', {
    p_project: projectId, ...(cut ? { p_file: cut.fileId, p_epoch: cut.epoch, p_sequence: cut.sequence } : {}),
  }).abortSignal(signal)
  if (error) throw new Error(error.message)
  const saved = data as unknown as { id: string; title: string; revision: number; main: string; files: PaperFile[]; shared: SharedCut[]; expiresAt: string }
  try {
    const files = await hydrateFigures(saved.files, signal, cache)
    signal.throwIfAborted()
    if (Date.now() >= Date.parse(saved.expiresAt)) throw new Error('Snapshot preparation expired. Capture the paper again.')
    return { id: saved.id, title: saved.title, revision: saved.revision, main: saved.main, entries: saved.files, shared: saved.shared, files }
  } finally {
    // Failed/cancelled requests also expire safely if release cannot reach the DB.
    void supabase.rpc('release_paper_snapshot', { p_snapshot: saved.id }).then(() => {}, () => {})
  }
}

export function matchesPaperBuild(snapshot: PaperSnapshot, build: PaperBuild | null) {
  return !!build && build.signature === sourceSignature(snapshot.files, snapshot.main)
}
