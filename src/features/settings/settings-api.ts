import { supabase } from '../../lib/supabase'
import type { SettingsRequest, SettingsResult, SettingsSnapshot, TrashCursor, TrashProject } from './settings-types'

function client() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

export class SettingsError extends Error {
  readonly retryable: boolean
  constructor(message: string, retryable = false) {
    super(message)
    this.name = 'SettingsError'
    this.retryable = retryable
  }
}

export async function loadSettings(projectId: string, signal: AbortSignal) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) return null
  const { data, error } = await client().rpc('get_project_settings', { p_project_id: projectId }).abortSignal(signal)
  if (error) throw new Error('Unable to load project settings. Check your connection and try again.')
  return data as unknown as SettingsSnapshot | null
}

export async function loadTrash(cursor: TrashCursor | null, signal: AbortSignal): Promise<TrashProject[]> {
  const { data, error } = await client().rpc('list_deleted_owned_projects', {
    p_limit: 21, ...(cursor ? { p_before_at: cursor.deleted_at, p_before_id: cursor.id } : {}),
  }).abortSignal(signal)
  if (error) throw new Error('Unable to load Trash. Check your connection and try again.')
  return data
}

export async function applySettings(request: SettingsRequest): Promise<SettingsResult> {
  const args = { p_project_id: request.projectId, p_expected_revision: request.revision, p_operation_id: request.operationId }
  const { action } = request
  try {
    const result = action.kind === 'details'
      ? await client().rpc('update_project_details', { ...args, p_name: action.name, p_description: action.description })
      : action.kind === 'archive'
        ? await client().rpc('set_project_archived', { ...args, p_archived: action.archived })
        : action.kind === 'transfer'
          ? await client().rpc('transfer_project_ownership', { ...args, p_recipient_id: action.recipientId })
          : action.kind === 'trash'
            ? await client().rpc('trash_project', args)
            : await client().rpc('restore_project', args)
    if (result.error) {
      const { code, message } = result.error
      if (['40001', '22023', 'P0001', '42501'].includes(code)) throw new SettingsError(message)
      throw new SettingsError('The result could not be confirmed. Retry this same request to check its outcome safely.', true)
    }
    if (!result.data) throw new SettingsError('The result could not be confirmed. Retry this same request.', true)
    window.dispatchEvent(new Event('scholaris:projects-changed'))
    return result.data as unknown as SettingsResult
  } catch (cause) {
    if (cause instanceof SettingsError) throw cause
    throw new SettingsError('Connection interrupted. Retry this same request to confirm whether it completed.', true)
  }
}
