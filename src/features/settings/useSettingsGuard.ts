import { useCallback, useEffect, useRef } from 'react'
import { useBlocker } from 'react-router'

// One guard per mounted page; dialogs report their dirty/busy state to the page.
export function useSettingsGuard(dirty: boolean, busy: boolean) {
  const allowNavigation = useRef(false)
  const blocker = useBlocker(() => !allowNavigation.current && (dirty || busy))
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (busy || !window.confirm('Leave this page and discard unsaved changes? If a result is unconfirmed, check the project before making another change.')) blocker.reset()
    else blocker.proceed()
  }, [blocker, busy])
  useEffect(() => {
    if (!dirty && !busy) return
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const signOut = (event: Event) => {
      if (busy || !window.confirm('Sign out and discard unsaved changes?')) event.preventDefault()
    }
    window.addEventListener('beforeunload', unload)
    window.addEventListener('scholaris:before-sign-out', signOut)
    return () => {
      window.removeEventListener('beforeunload', unload)
      window.removeEventListener('scholaris:before-sign-out', signOut)
    }
  }, [dirty, busy])
  return useCallback(() => { allowNavigation.current = true }, [])
}
