import { supabase } from '../../lib/supabase'
import { loadProject } from './projects-api'

export type OverviewActivity = { id: string; kind: 'paper' | 'files' | 'chat' | 'project'; label: string; at: string }
const channels: Record<string, string> = { discussion: 'Project Discussion', announcements: 'Announcements', ideas: 'Ideas & References', experiments: 'Experiments', general: 'General' }
function successful<T extends { error: unknown }>(result: PromiseSettledResult<T>) {
  return result.status === 'fulfilled' && !result.value.error ? result.value : null
}

export async function loadOverview(projectId: string, signal: AbortSignal) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const project = await loadProject(projectId, signal)
  if (!project) return null

  // Fetch metadata only. Each source contributes up to eight candidates so the
  // combined eight newest items are correct even when one source dominates.
  const results = await Promise.allSettled([
    supabase.from('paper_files').select('id,path,updated_at', { count: 'exact' }).eq('project_id', projectId).neq('kind', 'folder').order('updated_at', { ascending: false }).order('id').limit(8).abortSignal(signal),
    supabase.from('project_files').select('id,name,created_at', { count: 'exact' }).eq('project_id', projectId).order('created_at', { ascending: false }).order('id').limit(8).abortSignal(signal),
    supabase.from('project_messages').select('id,channel,created_at').eq('project_id', projectId).order('created_at', { ascending: false }).order('id').limit(8).abortSignal(signal),
  ])
  signal.throwIfAborted()
  const paper = successful(results[0]), files = successful(results[1]), chat = successful(results[2])
  // Recheck access after the parallel reads: a revoked membership should replace
  // the whole Overview with the unavailable state, not misleading zero counts.
  const current = await loadProject(projectId, signal)
  if (!current) return null
  const activity: OverviewActivity[] = [
    { id: `project:${projectId}`, kind: 'project', label: 'Project created', at: current.project.created_at },
    ...(paper?.data ?? []).map((file) => ({ id: `paper:${file.id}`, kind: 'paper' as const, label: `Paper file updated: ${file.path}`, at: file.updated_at })),
    ...(files?.data ?? []).map((file) => ({ id: `files:${file.id}`, kind: 'files' as const, label: `File added: ${file.name}`, at: file.created_at })),
    ...(chat?.data ?? []).map((message) => ({ id: `chat:${message.id}`, kind: 'chat' as const, label: `Message posted in ${channels[message.channel] ?? 'Chat'}`, at: message.created_at })),
  ]
  activity.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id))
  return {
    ...current,
    paperCount: paper?.count ?? null,
    fileCount: files?.count ?? null,
    activity: activity.slice(0, 8),
    unavailable: [!paper && 'paper', !files && 'files', !chat && 'chat'].filter((name): name is string => !!name),
  }
}
