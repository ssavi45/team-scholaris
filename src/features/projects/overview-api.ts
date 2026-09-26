import { supabase } from '../../lib/supabase'
import { loadProject } from './projects-api'
import { localDate } from '../tasks/task-types'

function successful<T extends { error: unknown }>(result: PromiseSettledResult<T>) {
  return result.status === 'fulfilled' && !result.value.error ? result.value : null
}

export async function loadOverview(projectId: string, signal: AbortSignal) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const project = await loadProject(projectId, signal)
  if (!project) return null

  // Counts and the same durable event stream used by the Activity tab.
  const results = await Promise.allSettled([
    supabase.from('paper_files').select('id', { count: 'exact', head: true }).eq('project_id', projectId).neq('kind', 'folder').abortSignal(signal),
    supabase.from('project_files').select('id', { count: 'exact', head: true }).eq('project_id', projectId).abortSignal(signal),
    supabase.rpc('get_project_activity', { p_project_id: projectId, p_limit: 8 }).abortSignal(signal),
    supabase.rpc('get_project_task_summary', { p_project_id: projectId, p_today: localDate() }).abortSignal(signal).single(),
    supabase.rpc('get_project_meetings', { p_project_id: projectId, p_limit: 1 }).abortSignal(signal),
  ])
  signal.throwIfAborted()
  const paper = successful(results[0]), files = successful(results[1]), history = successful(results[2])
  const tasks = successful(results[3])
  const meetings = successful(results[4])
  // Recheck access after the parallel reads: a revoked membership should replace
  // the whole Overview with the unavailable state, not misleading zero counts.
  const current = await loadProject(projectId, signal)
  if (!current) return null
  return {
    ...current,
    paperCount: paper?.count ?? null,
    fileCount: files?.count ?? null,
    taskSummary: tasks?.data ?? null,
    nextMeeting: meetings?.data?.[0] ?? null,
    activity: history?.data ?? [],
    unavailable: [!paper && 'paper', !files && 'files', !history && 'activity', !tasks && 'tasks', !meetings && 'meetings'].filter((name): name is string => !!name),
  }
}
