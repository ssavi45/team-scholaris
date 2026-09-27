import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { avatarUrl, loadAccountProfile } from './profile-api'
import { ProfileContext } from './profile-context'
import type { AccountProfile } from './profile-types'

export function ProfileProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [profile, setProfile] = useState<AccountProfile | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    const request = ++generation.current
    try {
      const loaded = await loadAccountProfile(userId)
      const url = await avatarUrl(loaded.avatar_path)
      if (request !== generation.current) return
      setProfile(loaded); setImageUrl(url); setError('')
    } catch (cause) {
      if (request === generation.current) setError(cause instanceof Error ? cause.message : 'Unable to load your profile.')
    } finally { if (request === generation.current) setLoading(false) }
  }, [userId])
  const publish = useCallback(async (saved: AccountProfile) => {
    const request = ++generation.current
    setProfile(saved); setImageUrl(null); setError('')
    try { localStorage.setItem('scholaris:profile-updated', crypto.randomUUID()) } catch { /* Refresh on focus still works. */ }
    const url = await avatarUrl(saved.avatar_path)
    if (request === generation.current) setImageUrl(url)
  }, [])
  useEffect(() => {
    let active = true
    const invalidate = () => { ++generation.current }
    // Defer the initial request; StrictMode cleanup cancels the discarded mount.
    void Promise.resolve().then(() => { if (active) void refresh() })
    const onFocus = () => { void refresh() }
    const onStorage = (event: StorageEvent) => { if (event.key === 'scholaris:profile-updated') void refresh() }
    window.addEventListener('focus', onFocus)
    window.addEventListener('storage', onStorage)
    const timer = window.setInterval(onFocus, 45 * 60 * 1000)
    return () => { active = false; invalidate(); window.clearInterval(timer); window.removeEventListener('focus', onFocus); window.removeEventListener('storage', onStorage) }
  }, [refresh])
  return <ProfileContext.Provider value={{ profile, imageUrl, loading, error, refresh, publish }}>{children}</ProfileContext.Provider>
}
