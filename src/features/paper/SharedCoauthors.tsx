import { useEffect, useState, type CSSProperties } from 'react'
import { loadProjectAvatars, type ChatAvatar } from '../chat/chat-api'
import { ProfileAvatar } from '../profile/ProfileAvatar'
import { useProfile } from '../profile/profile-context'
import type { Peer } from './shared-client'

export function SharedCoauthors({ projectId, userId, peers, following, follow }: { projectId: string; userId: string; peers: Peer[]; following?: string; follow?: (id: string) => void }) {
  const { profile, imageUrl } = useProfile()
  const [avatars, setAvatars] = useState<Record<string, ChatAvatar>>({})
  // One portrait per person even when they have multiple connected devices.
  const people = [...new Map(peers.map(peer => [peer.userId || peer.id, peer])).values()]
    .sort((a, b) => (a.userId || a.id).localeCompare(b.userId || b.id))
  const identities = people.map(peer => peer.userId).filter(Boolean).sort().join(',')
  useEffect(() => {
    if (!identities) return
    const controller = new AbortController()
    async function refresh() {
      try {
        const pictures = await loadProjectAvatars(projectId, controller.signal)
        if (!controller.signal.aborted) setAvatars(pictures)
      } catch { /* Initials remain available when portraits cannot be loaded. */ }
    }
    void refresh()
    // Private upload URLs expire after one hour; refresh while this window is open.
    const timer = window.setInterval(() => void refresh(), 45 * 60 * 1000)
    window.addEventListener('focus', refresh)
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [projectId, identities])

  return <div className="shared-coauthors" role="group" aria-label="Connected coauthors">
    {people.length ? people.map(peer => {
      const isSelf = peer.userId === userId
      const avatar = isSelf && profile ? { preset: profile.avatar_preset, imageUrl } : avatars[peer.userId]
      const label = `${peer.name}${isSelf ? ' (you)' : ''}`
      const initials = peer.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '?'
      return <button type="button" className="shared-coauthor" key={peer.userId || peer.id}
        disabled={!follow || isSelf || !peer.cursor} aria-pressed={following === peer.userId}
        onClick={() => follow?.(peer.userId)}
        aria-label={`${label}, ${isSelf || !peer.cursor ? 'connected coauthor' : following === peer.userId ? 'stop following' : 'follow cursor'}`} title={`${label} — ${isSelf ? 'you' : following === peer.userId ? 'following; click to stop' : peer.cursor ? 'click to follow cursor' : 'connected; no cursor yet'}`}
        style={{ '--coauthor-color': peer.color } as CSSProperties}>
        {avatar ? <ProfileAvatar preset={avatar.preset} imageUrl={avatar.imageUrl} size={28} /> : <span className="shared-coauthor-initials" aria-hidden="true">{initials}</span>}
      </button>
    }) : <span className="shared-coauthors-empty">No coauthors connected</span>}
  </div>
}
