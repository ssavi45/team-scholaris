import { createContext, useContext } from 'react'
import type { AccountProfile } from './profile-types'
export type ProfileContextValue = {
  profile: AccountProfile | null; imageUrl: string | null; loading: boolean; error: string;
  refresh: () => Promise<void>; publish: (profile: AccountProfile) => Promise<void>
}
export const ProfileContext = createContext<ProfileContextValue | null>(null)
export function useProfile() {
  const context = useContext(ProfileContext)
  if (!context) throw new Error('ProfileProvider is required')
  return context
}
