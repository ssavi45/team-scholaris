import { useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { connectGoogle, disconnectGoogle, type GoogleConnection } from './google-calendar-api'

export function GoogleConnectionPanel({ projectId, connection, error, writable, refresh }: { projectId: string; connection: GoogleConnection | null; error: string; writable: boolean; refresh: () => void }) {
  const [busy, setBusy] = useState(false)
  const guard = useRef(false)
  const [message, setMessage] = useState('')
  async function action(disconnect = false) {
    if (guard.current) return
    if (disconnect && !window.confirm('Disconnect Google? Existing calendar events and Meet links remain. Reconnect this same account to manage them from Scholaris.')) return
    guard.current = true; setBusy(true); setMessage('')
    try {
      if (disconnect) {
        const result = await disconnectGoogle()
        setMessage(result.revoked ? 'Google disconnected. Existing events have been kept.' : 'Disconnected locally. Google revocation could not be confirmed; you can remove Scholaris access from your Google account settings.')
        refresh()
      } else await connectGoogle(projectId)
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Unable to connect Google.') }
    finally { guard.current = false; setBusy(false) }
  }
  return <section className="google-connection" aria-label="Google Calendar connection" aria-busy={busy}>
    <CalendarDays size={24} aria-hidden="true" /><div className="google-connection-copy"><strong>{connection?.connected ? 'Google Calendar connected' : 'Create Google Meet links here'}</strong><p>{connection?.connected ? connection.email : error ? 'Google connection unavailable. Your other meetings are still available.' : connection?.configured === false ? 'Google Calendar setup is still being completed for this environment.' : connection ? 'Connect your Google account to start now or schedule a meeting with an automatic Meet link.' : 'Checking Google connection…'}</p>{(message || error) && <p role="status">{message || error}</p>}</div>
    <div className="google-connection-actions">{connection?.configured && (connection.connected ? <><button className="button secondary compact-button" disabled={busy} onClick={() => void action()}>Reconnect</button><button className="button secondary compact-button" disabled={busy} onClick={() => void action(true)}>Disconnect</button></> : writable && <button className="button primary compact-button" disabled={busy} onClick={() => void action()}>{busy ? 'Connecting…' : 'Connect Google'}</button>)}{error && <button className="button secondary compact-button" disabled={busy} onClick={refresh}>Retry connection</button>}</div>
  </section>
}
