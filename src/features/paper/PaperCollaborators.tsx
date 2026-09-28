import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Users } from 'lucide-react'
import { getTeam, type TeamMember } from '../invitations/invitations-api'
import { loadProjectAvatars, type ChatAvatar } from '../chat/chat-api'
import { ProfileAvatar } from '../profile/ProfileAvatar'
import { useProfile } from '../profile/profile-context'
import { useAuth } from '../auth/auth-context'

export function PaperCollaborators({ projectId }: { projectId: string }) {
  const [team, setTeam] = useState<TeamMember[]>([])
  const [avatars, setAvatars] = useState<Record<string, ChatAvatar>>({})
  const { profile, imageUrl } = useProfile()
  const { user } = useAuth()
  useEffect(() => {
    const controller = new AbortController()
    async function refresh() {
      try {
        const [members, pictures] = await Promise.all([getTeam(projectId, controller.signal), loadProjectAvatars(projectId, controller.signal)])
        if (!controller.signal.aborted) { setTeam(members); setAvatars(pictures) }
      } catch { /* The team link remains available when preview loading fails. */ }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 45 * 60 * 1000)
    window.addEventListener('focus', refresh)
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener('focus', refresh) }
  }, [projectId])
  return <Link to={`/project/${projectId}/team`} className="paper-collaborators" title="Project members and sharing (not live presence)" aria-label="Open project team and sharing">
    {team.slice(0, 4).map(member => {
      const avatar = member.user_id === user?.id && profile ? { preset: profile.avatar_preset, imageUrl } : avatars[member.user_id]
      return <span key={member.user_id} title={member.name}>{avatar ? <ProfileAvatar preset={avatar.preset} imageUrl={avatar.imageUrl} size={28} /> : member.name.slice(0, 1).toUpperCase()}</span>
    })}
    <Users size={16} /><span className="paper-team-label">Team{team.length > 4 ? ` +${team.length - 4}` : ''}</span>
  </Link>
}
