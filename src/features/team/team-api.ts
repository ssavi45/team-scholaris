import { supabase } from '../../lib/supabase'
import type { TeamMember } from '../invitations/invitations-api'

function client() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

function check(error: { code?: string; message: string } | null) {
  if (!error) return
  if (error.code === '40001' || error.code === '22023') throw new Error(error.message)
  if (error.code === '42501') throw new Error('Your access may have changed, or this project is archived. Refresh the team and try again.')
  throw new Error('Unable to update the team. Check your connection and refresh before retrying.')
}

export async function updateMember(projectId: string, member: TeamMember, access: TeamMember['access_level'], role: string) {
  const { error } = await client().rpc('update_project_member', {
    p_project_id: projectId, p_user_id: member.user_id, p_access_level: access,
    p_display_role: role.trim() || null, p_expected_access_level: member.access_level,
    p_expected_display_role: member.display_role,
  })
  check(error)
}

export async function removeMember(projectId: string, member: TeamMember) {
  const { error } = await client().rpc('remove_project_member', {
    p_project_id: projectId, p_user_id: member.user_id, p_expected_access_level: member.access_level,
  })
  check(error)
}

export async function leaveProject(projectId: string) {
  const { error } = await client().rpc('leave_project', { p_project_id: projectId })
  check(error)
}
