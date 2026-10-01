import { supabase } from '../../lib/supabase'
import { cleanupFigures, type PaperFile } from './paper-api'

export type HistoryItem = {
  id: number; kind: 'automatic' | 'named' | 'safety'; label: string; actor_name: string;
  created_at: string; revision: number; main_file: string; size_bytes: number; file_count: number;
}
export type HistorySnapshot = Omit<HistoryItem, 'file_count'> & { files: PaperFile[] }
function client() { if (!supabase) throw new Error('Supabase is not configured.'); return supabase }
export async function listHistory(projectId: string, before?: number, signal?: AbortSignal) {
  let query = client().rpc('list_paper_history', { p_project_id: projectId, p_before: before })
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw new Error(error.code === 'PGRST202' ? 'History is not installed in this environment. Apply the PAPER-06 migration first.' : error.message)
  return data as unknown as HistoryItem[]
}
export async function getHistory(projectId: string, id: number, signal?: AbortSignal) {
  let query = client().rpc('get_paper_history', { p_project_id: projectId, p_history_id: id })
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data as unknown as HistorySnapshot
}
export async function checkpoint(projectId: string, revision: number, label: string) {
  const { data, error } = await client().rpc('create_shared_paper_checkpoint', { p_project_id: projectId, p_revision: revision, p_label: label })
  if (error) throw new Error(error.message)
  return data
}
export async function restoreHistory(projectId: string, snapshot: number, revision: number, fileId?: string, confirmShared = false) {
  const { data, error } = await client().rpc('restore_shared_paper_history', { p_project_id: projectId, p_history_id: snapshot, p_revision: revision, p_file_id: fileId, p_confirm_shared: confirmShared })
  if (error) throw new Error(error.message)
  return data
}
export async function deleteHistory(projectId: string, id: number) {
  const { error } = await client().rpc('delete_paper_checkpoint', { p_project_id: projectId, p_history_id: id })
  if (error) throw new Error(error.message)
}
export async function cleanupHistoryFigures(projectId: string) {
  const { data, error } = await client().rpc('paper_unused_figures', { p_project_id: projectId })
  if (error) throw new Error(error.message)
  if (!await cleanupFigures(data.map(item => item.path))) throw new Error('Some unused figures could not be removed. Retained history figures remain protected.')
  return data.length
}
