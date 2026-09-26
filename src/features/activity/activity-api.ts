import { supabase } from '../../lib/supabase'
import { activityCategories, activityDateBoundary, emptyActivityFilters } from './activity-types'
import type { ActivityCursor, ActivityFilters } from './activity-types'

export const ACTIVITY_PAGE_SIZE = 30
export async function loadActivity(projectId: string, signal: AbortSignal, filters: ActivityFilters = emptyActivityFilters, cursor: ActivityCursor | null = null, size = ACTIVITY_PAGE_SIZE) {
  if (!supabase) throw new Error('Supabase is not configured.')
  if (filters.category && !Object.hasOwn(activityCategories, filters.category)) throw new Error('Choose a valid activity category.')
  if (filters.actor && !/^[0-9a-f-]{36}$/i.test(filters.actor)) throw new Error('Choose a valid person.')
  if (filters.from && filters.to && filters.from > filters.to) throw new Error('The end date must be on or after the start date.')
  const { data, error } = await supabase.rpc('get_project_activity', {
    p_project_id: projectId, p_limit: size + 1,
    p_category: filters.category || undefined, p_actor_id: filters.actor || undefined,
    p_from: activityDateBoundary(filters.from), p_to: activityDateBoundary(filters.to, true),
    p_before_at: cursor?.at, p_before_id: cursor?.id,
  }).abortSignal(signal)
  if (error) throw new Error('Unable to load activity. Check your connection and project access, then refresh.')
  const events = (data ?? []).slice(0, size)
  const last = events.at(-1)
  return { events, next: data && data.length > size && last ? { at: last.created_at, id: last.id } : null }
}
export async function loadActivityActors(projectId: string, signal: AbortSignal) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.rpc('get_project_activity_actors', { p_project_id: projectId }).abortSignal(signal)
  if (error) throw new Error('Unable to load the people filter. Refresh to try again.')
  return data ?? []
}
