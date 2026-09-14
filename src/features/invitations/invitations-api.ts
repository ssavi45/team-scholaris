import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
export type Invitation = { id: string; project_id: string; project_name: string; email: string; access_level: 'member' | 'viewer'; expires_at: string; accepted_at: string | null; revoked_at: string | null }
export type TeamMember = { user_id: string; name: string; access_level: 'owner' | 'member' | 'viewer'; display_role: string | null }
function client() { if (!supabase) throw new Error('Supabase is not configured.'); return supabase }
export async function listInvitations(signal: AbortSignal, projectId?: string, token?: string) {
  const { data, error } = await client().rpc('list_project_invitations', { p_project_id: projectId, p_token: token }).abortSignal(signal).returns<Invitation[]>()
  if (error) throw new Error('Unable to load invitations. Please try again.')
  return data
}
export async function sendInvitation(projectId: string, email: string, accessLevel: string) {
  const { error } = await client().functions.invoke('send-project-invitation', { body: { projectId, email, accessLevel } })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = await error.context.json().catch(() => null)
      if (typeof body?.error === 'string') throw new Error(body.error)
    }
    throw new Error('Unable to send the invitation. Check your connection and pending invitations before retrying.')
  }
}
export async function acceptInvitation(id: string, token?: string) {
  const { data, error } = await client().rpc('accept_project_invitation', { p_invitation_id: id, p_token: token })
  if (error) throw new Error('This invitation cannot be accepted. It may have expired, been revoked, or belong to another email address.')
  return data
}
export async function revokeInvitation(id: string) {
  const { error } = await client().rpc('revoke_project_invitation', { p_invitation_id: id })
  if (error) throw new Error('Unable to revoke this invitation. Please try again.')
}
export async function getTeam(projectId: string, signal: AbortSignal) {
  const { data, error } = await client().rpc('get_project_team', { p_project_id: projectId }).abortSignal(signal).returns<TeamMember[]>()
  if (error) throw new Error('Unable to load the team. Please try again.')
  return data
}
