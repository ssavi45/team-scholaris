import { supabase } from '../../lib/supabase'
import type { Database } from '../../types/database'

export type ProjectMessage = Database['public']['Functions']['get_project_messages']['Returns'][number]
export type ChatAvatar = { preset: number; imageUrl: string | null }

export async function loadProjectAvatars(projectId: string, signal: AbortSignal): Promise<Record<string, ChatAvatar>> {
  const { data, error } = await client().rpc('get_project_avatars', { p_project_id: projectId }).abortSignal(signal)
  if (error) throw new Error('Unable to load team avatars. Refresh to retry.')
  const paths = data.flatMap(row => row.avatar_path ? [row.avatar_path] : [])
  const signed = paths.length ? await client().storage.from('profile-avatars').createSignedUrls(paths, 3600) : null
  if (signal.aborted) return {}
  const urls = new Map(signed?.data?.map(item => [item.path, item.signedUrl]))
  return Object.fromEntries(data.map(row => [row.user_id, {
    preset: row.avatar_preset, imageUrl: row.avatar_path ? urls.get(row.avatar_path) || null : null,
  }]))
}

function client() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

export async function loadProjectMessages(
  projectId: string,
  limit = 100,
  signal?: AbortSignal,
  channel?: string
): Promise<ProjectMessage[]> {
  const args: { p_project_id: string; p_limit: number; p_channel?: string } = {
    p_project_id: projectId,
    p_limit: limit,
  }
  if (channel) {
    args.p_channel = channel
  }

  let query = client().rpc('get_project_messages', args)

  if (signal) {
    query = query.abortSignal(signal)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data as ProjectMessage[]) ?? []
}

export async function sendProjectMessage(
  projectId: string,
  content: string,
  channel = 'discussion'
): Promise<void> {
  const trimmed = content.trim()
  if (!trimmed) throw new Error('Message cannot be empty.')
  if (trimmed.length > 4000) throw new Error('Message exceeds 4,000 characters limit.')

  const { data: userData, error: userError } = await client().auth.getUser()
  if (userError || !userData?.user) throw new Error('Authentication required to send messages.')

  const { error } = await client()
    .from('project_messages')
    .insert({
      project_id: projectId,
      sender_id: userData.user.id,
      content: trimmed,
      channel,
    })

  if (error) throw new Error(error.message)
}

export async function deleteProjectMessage(messageId: string): Promise<void> {
  const { data, error } = await client().from('project_messages').delete().eq('id', messageId).select('id').single()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Message was not deleted. Refresh and check your access.')
}

export type ChatConnection = 'connecting' | 'connected' | 'disconnected'

export function subscribeProjectChat(
  projectId: string,
  onChange: () => void,
  onDelete: (messageId: string) => void,
  onStatus: (status: ChatConnection) => void
): () => void {
  let active = true
  const channel = client()
    .channel(`project-chat:${projectId}:${crypto.randomUUID()}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'project_messages',
        filter: `project_id=eq.${projectId}`,
      },
      () => { if (active) onChange() }
    )
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'project_messages',
      },
      (payload) => {
        const oldRecord = payload.old as { id?: string }
        // With RLS, deleted rows only expose their primary key. The consumer
        // removes this ID only if it belongs to its already-authorized snapshot.
        if (active && oldRecord?.id) {
          onDelete(oldRecord.id)
        }
      }
    )
    .subscribe((status) => {
      if (!active) return
      onStatus(status === 'SUBSCRIBED' ? 'connected' : status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED' ? 'disconnected' : 'connecting')
      if (status === 'SUBSCRIBED') onChange() // Reconcile initial/reconnected gaps.
    })

  return () => {
    active = false
    void client().removeChannel(channel)
  }
}
