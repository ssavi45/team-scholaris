export type TaskStatus = 'todo' | 'in_progress' | 'blocked' | 'done'
export type TaskPriority = 'low' | 'normal' | 'high'
export type TaskRow = {
  id: string; project_id: string; title: string; description: string
  created_by: string; assignee_id: string | null; status: TaskStatus; priority: TaskPriority
  due_date: string | null; completed_at: string | null; revision: number
  created_at: string; updated_at: string; deleted_at: string | null
}
export type Task = Omit<TaskRow, 'deleted_at'> & { creator_name: string; assignee_name: string | null }
export type TaskSummary = { open_count: number; overdue_count: number; mine_count: number; done_count: number }
export type TaskFilter = 'all' | 'mine' | 'unassigned' | 'completed' | 'open' | 'overdue'
export const taskStatuses: Record<TaskStatus, string> = { todo: 'To do', in_progress: 'In progress', blocked: 'Blocked', done: 'Done' }
export const taskPriorities: Record<TaskPriority, string> = { low: 'Low', normal: 'Normal', high: 'High' }
export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export function dueLabel(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
export function isOverdue(task: Pick<Task, 'status' | 'due_date'>, today = localDate()) {
  return task.status !== 'done' && !!task.due_date && task.due_date < today
}
