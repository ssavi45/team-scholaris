import { supabase } from '../../lib/supabase'

export type Project = {
  id: string; name: string; description: string; owner_id: string
  status: 'active' | 'archived'; created_at: string; updated_at: string
}
export type Membership = { user_id: string; access_level: 'owner' | 'member' | 'viewer'; display_role: string | null }
const columns = 'id,name,description,owner_id,status,created_at,updated_at'

export async function listProjects(signal: AbortSignal) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.from('projects').select(columns)
    .order('updated_at', { ascending: false }).abortSignal(signal).returns<Project[]>()
  if (error) throw new Error('Unable to load projects. Check your connection and try again.')
  return data
}

export async function createProject(name: string, description: string) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.rpc('create_project', { project_name: name, project_description: description }).single<Project>()
  if (error) {
    if (error.code === 'P0001') throw new Error('You have reached the owned-project limit. Refresh your dashboard to see your projects.')
    if (error.code === '22023') throw new Error(error.message)
    throw new Error('Could not confirm project creation. Check your dashboard before trying again.')
  }
  return data
}

export async function loadProject(id: string, signal: AbortSignal) {
  if (!supabase) throw new Error('Supabase is not configured.')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null
  const { data: project, error } = await supabase.from('projects').select(columns).eq('id', id)
    .abortSignal(signal).maybeSingle<Project>()
  if (error) throw new Error('Unable to load this project. Check your connection and try again.')
  if (!project) return null
  const { data: members, error: membersError } = await supabase.from('project_members')
    .select('user_id,access_level,display_role').eq('project_id', id).abortSignal(signal).returns<Membership[]>()
  if (membersError) throw new Error('Unable to load project membership. Please try again.')
  return { project, members }
}
