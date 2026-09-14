import { supabase } from '../../lib/supabase'
import type { Database } from '../../types/database'

export type PaperFile = Database['public']['Tables']['paper_files']['Row']
function client() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}
export async function loadPaper(projectId: string, signal?: AbortSignal) {
  let query = client().from('paper_files').select('*').eq('project_id', projectId).order('path')
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data
}
export async function initializePaper(projectId: string) {
  const { error } = await client().rpc('initialize_paper', { p_project_id: projectId })
  if (error) throw new Error(error.message)
  return loadPaper(projectId)
}
export async function createPaperFile(projectId: string, path: string) {
  const { data, error } = await client().rpc('create_paper_file', { p_project_id: projectId, p_path: path }).single()
  if (error) throw new Error(error.message)
  return data
}
export async function savePaperFile(file: PaperFile, content: string) {
  const { data, error } = await client().rpc('save_paper_file', { p_file_id: file.id, p_content: content, p_expected_version: file.version }).single()
  if (error) throw new Error(error.message)
  return data
}
