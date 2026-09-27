import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'
const storageKey = 'scholaris:theme'
const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()
function parsePreference(value: string | null): Theme | null {
  return value === 'light' || value === 'dark' ? value : null
}
let preference: Theme | null = null
try { preference = parsePreference(localStorage.getItem(storageKey)) } catch { /* Use system preference. */ }
let current: Theme = preference ?? (systemTheme.matches ? 'dark' : 'light')

function applyTheme() {
  current = preference ?? (systemTheme.matches ? 'dark' : 'light')
  document.documentElement.dataset.theme = current
  document.documentElement.style.colorScheme = current
  listeners.forEach(listener => listener())
}

function onStorage(event: StorageEvent) {
  if (event.key !== storageKey && event.key !== null) return
  // Ignore similarly named sessionStorage entries.
  try { if (event.storageArea && event.storageArea !== window.localStorage) return } catch { return }
  preference = parsePreference(event.newValue)
  applyTheme()
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    systemTheme.addEventListener('change', applyTheme)
    window.addEventListener('storage', onStorage)
    applyTheme()
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      systemTheme.removeEventListener('change', applyTheme)
      window.removeEventListener('storage', onStorage)
    }
  }
}

export function toggleTheme() {
  preference = current === 'dark' ? 'light' : 'dark'
  try { localStorage.setItem(storageKey, preference) } catch { /* Keep the choice in memory. */ }
  applyTheme()
}

export function useTheme() {
  return useSyncExternalStore(subscribe, () => current, () => 'light' as Theme)
}
