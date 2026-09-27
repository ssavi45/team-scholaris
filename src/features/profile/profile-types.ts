export type AccountProfile = {
  id: string
  name: string
  username: string
  badge_display: 'username' | 'email'
  avatar_preset: number
  avatar_path: string | null
  avatar_url: string | null
  affiliation: string
  bio: string
  created_at: string
  updated_at: string
}
export type ProfileDraft = Pick<AccountProfile, 'name' | 'username' | 'badge_display' | 'avatar_preset' | 'avatar_path' | 'affiliation' | 'bio'>
export function profileDraft(profile: AccountProfile): ProfileDraft {
  return { name: profile.name, username: profile.username, badge_display: profile.badge_display,
    avatar_preset: profile.avatar_preset, avatar_path: profile.avatar_path,
    affiliation: profile.affiliation, bio: profile.bio }
}
