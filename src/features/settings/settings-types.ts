import type { Project } from '../projects/projects-api'

export type SettingsProject = Project & { settings_revision: number }
export type SettingsMember = {
  user_id: string
  name: string
  access_level: 'owner' | 'member' | 'viewer'
  eligible_owner: boolean
}
export type SettingsSnapshot = {
  project: SettingsProject
  members: SettingsMember[]
  has_google_meetings: boolean
}
export type TrashProject = {
  id: string
  name: string
  deleted_at: string
  recover_until: string
  settings_revision: number
  can_restore: boolean
  restore_blocked_reason: 'quota' | 'expired' | null
}
export type SettingsAction =
  | { kind: 'details'; name: string; description: string }
  | { kind: 'archive'; archived: boolean }
  | { kind: 'transfer'; recipientId: string }
  | { kind: 'trash' }
  | { kind: 'restore' }
export type SettingsRequest = {
  projectId: string
  revision: number
  operationId: string
  action: SettingsAction
}
export type SettingsResult = { project_id: string; revision: number; action: string }
export type TrashCursor = { deleted_at: string; id: string }
