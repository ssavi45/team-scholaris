import { supabase } from '../../lib/supabase'
import type { Database } from '../../types/database'
import type { SourceFile } from './compiler'
import { imageType, imageDimensions, validateTree, type TreeEntry } from './file-tree'

export type PaperFile = Omit<Database['public']['Tables']['paper_files']['Row'], 'kind'> & { kind: 'text' | 'folder' | 'image'; shared_epoch?: string }
function client() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}
export async function loadPaper(projectId: string, signal?: AbortSignal) {
  let query = client().from('paper_files').select('*').eq('project_id', projectId).order('path')
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  const shared = await client().rpc('list_shared_paper_files', { p_project: projectId })
  if (shared.error) throw new Error('Unable to check shared editing sessions. Apply the current database migrations and retry.')
  return (data as PaperFile[]).map(file => ({ ...file, shared_epoch: shared.data.find(item => item.file_id === file.id)?.epoch }))
}
export async function initializePaper(projectId: string) {
  const { error } = await client().rpc('initialize_paper', { p_project_id: projectId })
  if (error) throw new Error(error.message)
  return loadPaper(projectId)
}
export async function createPaperFile(projectId: string, path: string) {
  const { data, error } = await client().rpc('create_paper_file', { p_project_id: projectId, p_path: path }).single()
  if (error) throw new Error(error.message)
  return data as PaperFile
}
export async function savePaperFile(file: PaperFile, content: string) {
  const { data, error } = await client().rpc('save_paper_file', { p_file_id: file.id, p_content: content, p_expected_version: file.version }).single()
  if (error) throw new Error(error.message)
  return data as PaperFile
}
export async function loadPaperFile(id: string) {
  const { data, error } = await client().from('paper_files').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data as PaperFile | null
}

export async function loadPaperSettings(projectId: string, signal?: AbortSignal) {
  let query = client().from('paper_workspaces').select('main_file,revision').eq('project_id', projectId)
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(error.message)
  return data
}
export async function loadPaperState(projectId: string, signal?: AbortSignal) {
  let query = client().rpc('read_paper_state', { p_project: projectId })
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data as unknown as { files: PaperFile[]; settings: { revision: number; main_file: string } | null }
}
export async function hydrateFigures(files: SourceFile[], signal: AbortSignal, cache?: Map<string, Uint8Array<ArrayBuffer>>): Promise<SourceFile[]> {
  // Storage objects are immutable. Caller scopes this optional cache to one authorized workspace.
  const live = new Set(files.filter(file => file.kind === 'image').map(file => file.storage_path))
  if (cache) for (const key of cache.keys()) if (!live.has(key)) cache.delete(key)
  const result: SourceFile[] = []
  for (const file of files) {
    signal.throwIfAborted()
    if (file.kind !== 'image' || file.bytes) { result.push(file); continue }
    if (!file.storage_path) throw new Error(`Missing figure: ${file.path}`)
    const cached = cache?.get(file.storage_path)
    if (cached) { imageType(file.path, cached); result.push({ ...file, bytes: cached }); continue }
    const { data, error } = await client().storage.from('paper-figures').download(file.storage_path, {}, { signal })
    signal.throwIfAborted()
    if (error) throw new Error(`Unable to load ${file.path}. Check your connection and project access.`)
    if (data.size > 5242880) throw new Error(`Figure too large: ${file.path}`)
    const bytes = new Uint8Array(await data.arrayBuffer())
    imageType(file.path, bytes)
    if (cache && [...cache.values()].reduce((sum, item) => sum + item.byteLength, 0) + bytes.byteLength <= 26214400) cache.set(file.storage_path, bytes)
    result.push({ ...file, bytes })
  }
  return result
}
export async function applyPaperTree(projectId: string, revision: number, entries: TreeEntry[], mainFile: string, confirmShared = false) {
  validateTree(entries, mainFile)
  const uploaded: string[] = []
  let committed = false
  try {
    const manifest = []
    for (const entry of entries) {
      let storagePath = entry.storage_path ?? null
      if (entry.kind === 'image' && entry.bytes) {
        const mime = imageType(entry.path, entry.bytes)
        imageDimensions(entry.path, entry.bytes)
        storagePath = `${projectId}/${crypto.randomUUID()}.${mime === 'image/png' ? 'png' : 'jpg'}`
        const { error } = await client().storage.from('paper-figures').upload(storagePath, entry.bytes, { contentType: mime, upsert: false })
        if (error) throw new Error(`Unable to upload ${entry.path}: ${error.message}`)
        uploaded.push(storagePath)
      }
      manifest.push({ id: entry.id ?? null, path: entry.path, kind: entry.kind, content: entry.content, storage_path: storagePath })
    }
    const { error } = await client().rpc('apply_shared_paper_manifest', { p_project_id: projectId, p_revision: revision, p_entries: manifest, p_main_file: mainFile, p_confirm_shared: confirmShared })
    if (error) throw new Error(error.message)
    committed = true
  } finally {
    if (!committed && uploaded.length) await client().storage.from('paper-figures').remove(uploaded)
  }
}
export async function cleanupFigures(paths: string[]) {
  if (!paths.length) return true
  try {
    const unreferenced: string[] = []
    for (const path of paths) {
      const { data, error } = await client().rpc('paper_figure_referenced', { p_name: path })
      if (error) return false
      if (!data) unreferenced.push(path)
    }
    if (!unreferenced.length) return true
    const { data, error } = await client().storage.from('paper-figures').remove(unreferenced)
    return !error && data?.length === unreferenced.length
  } catch { return false }
}
