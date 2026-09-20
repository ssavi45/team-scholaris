import { supabase } from '../../lib/supabase'
import { localDate } from './task-types'
import type { Task, TaskFilter, TaskRow } from './task-types'

export const TASK_PAGE_SIZE = 30
function client() { if (!supabase) throw new Error('Supabase is not configured.'); return supabase }
function check(error: { code?: string; message: string } | null) {
  if (!error) return
  if (error.code === '40001' || error.code === '22023') throw new Error(error.message)
  if (error.code === '42501') throw new Error('Your access changed or this project is read-only. Close the form and refresh to check your permissions.')
  throw new Error('Unable to confirm the task change. Keep your edits and refresh the list before trying again.')
}
export async function loadTasks(projectId: string, userId: string, filter: TaskFilter, search: string, page: number, signal: AbortSignal, today = localDate()) {
  let query = client().rpc('get_project_tasks', { p_project_id: projectId }, { count: 'exact' })
  if (filter === 'mine') query = query.eq('assignee_id', userId).neq('status', 'done')
  if (filter === 'unassigned') query = query.is('assignee_id', null).neq('status', 'done')
  if (filter === 'completed') query = query.eq('status', 'done')
  if (filter === 'open' || filter === 'overdue') query = query.neq('status', 'done')
  if (filter === 'overdue') query = query.lt('due_date', today)
  if (search.trim()) query = query.ilike('title', `%${search.trim().replace(/[\\%_]/g, '\\$&')}%`)
  const { data, count, error } = await query.order('created_at', { ascending: false }).order('id').range(page * TASK_PAGE_SIZE, (page + 1) * TASK_PAGE_SIZE - 1).abortSignal(signal)
  if (error) throw new Error('Unable to load tasks. Check your connection and project access, then refresh.')
  return { tasks: data ?? [], count: count ?? 0 }
}
export async function loadTaskSummary(projectId: string, signal: AbortSignal, today = localDate()) {
  const { data, error } = await client().rpc('get_project_task_summary', { p_project_id: projectId, p_today: today }).single().abortSignal(signal)
  if (error) throw new Error('Unable to load task counts.')
  return data
}
export type TaskDraft = Pick<Task, 'title' | 'description' | 'assignee_id' | 'status' | 'priority' | 'due_date'>
export async function saveTask(projectId: string, id: string, revision: number, draft: TaskDraft) {
  const { data, error } = await client().rpc('save_project_task', {
    p_project_id: projectId, p_task_id: id, p_revision: revision, p_title: draft.title.trim(),
    p_description: draft.description, p_assignee_id: draft.assignee_id, p_status: draft.status,
    p_priority: draft.priority, p_due_date: draft.due_date,
  }).single<TaskRow>()
  check(error)
  return data
}
export async function deleteTask(projectId: string, task: Task) {
  const { error } = await client().rpc('delete_project_task', { p_project_id: projectId, p_task_id: task.id, p_revision: task.revision })
  check(error)
}
