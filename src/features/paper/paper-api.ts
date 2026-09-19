import { supabase } from '../../lib/supabase'
import type { Database } from '../../types/database'
import type { SourceFile } from './compiler'
import { imageType, validateTree, type TreeEntry } from './file-tree'

export type PaperFile = Omit<Database['public']['Tables']['paper_files']['Row'], 'kind'> & { kind: 'text' | 'folder' | 'image' }
function client() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}
export async function loadPaper(projectId: string, signal?: AbortSignal) {
  let query = client().from('paper_files').select('*').eq('project_id', projectId).order('path')
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data as PaperFile[]
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

export async function loadPaperSettings(projectId: string, signal?: AbortSignal) {
  let query = client().from('paper_workspaces').select('main_file,revision').eq('project_id', projectId)
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(error.message)
  return data
}
export async function loadPaperState(projectId: string, signal?: AbortSignal) {
  // Bracket the read with revisions to reject a tree assembled across concurrent writes.
  const before = await loadPaperSettings(projectId, signal)
  const files = await loadPaper(projectId, signal)
  const settings = await loadPaperSettings(projectId, signal)
  if (before?.revision !== settings?.revision) throw new Error('The paper changed while loading. Please reload.')
  return { files, settings }
}
export async function hydrateFigures(files: SourceFile[], signal: AbortSignal): Promise<SourceFile[]> {
  const result: SourceFile[] = []
  for (const file of files) {
    signal.throwIfAborted()
    if (file.kind !== 'image' || file.bytes) { result.push(file); continue }
    if (!file.storage_path) throw new Error(`Missing figure: ${file.path}`)
    const { data, error } = await client().storage.from('paper-figures').download(file.storage_path)
    signal.throwIfAborted()
    if (error) throw new Error(`Unable to load ${file.path}. Check your connection and project access.`)
    if (data.size > 5242880) throw new Error(`Figure too large: ${file.path}`)
    const bytes = new Uint8Array(await data.arrayBuffer())
    imageType(file.path, bytes)
    result.push({ ...file, bytes })
  }
  return result
}
export async function applyPaperTree(projectId: string, revision: number, entries: TreeEntry[], mainFile: string) {
  validateTree(entries, mainFile)
  const uploaded: string[] = []
  let committed = false
  try {
    const manifest = []
    for (const entry of entries) {
      let storagePath = entry.storage_path ?? null
      if (entry.kind === 'image' && entry.bytes) {
        const mime = imageType(entry.path, entry.bytes)
        storagePath = `${projectId}/${crypto.randomUUID()}.${mime === 'image/png' ? 'png' : 'jpg'}`
        const { error } = await client().storage.from('paper-figures').upload(storagePath, entry.bytes, { contentType: mime, upsert: false })
        if (error) throw new Error(`Unable to upload ${entry.path}: ${error.message}`)
        uploaded.push(storagePath)
      }
      manifest.push({ id: entry.id ?? null, path: entry.path, kind: entry.kind, content: entry.content, storage_path: storagePath })
    }
    const { error } = await client().rpc('apply_paper_manifest', { p_project_id: projectId, p_revision: revision, p_entries: manifest, p_main_file: mainFile })
    if (error) throw new Error(error.message)
    committed = true
  } finally {
    if (!committed && uploaded.length) await client().storage.from('paper-figures').remove(uploaded)
  }
}
export async function cleanupFigures(paths: string[]) {
  if (!paths.length) return true
  try {
    const { data, error } = await client().storage.from('paper-figures').remove(paths)
    return !error && data?.length === paths.length
  } catch { return false }
}
