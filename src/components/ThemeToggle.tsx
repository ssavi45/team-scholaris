import { Moon, Sun } from 'lucide-react'
import { toggleTheme, useTheme } from '../theme/theme-store'

export function ThemeToggle() {
  const theme = useTheme()
  return <button
    type="button"
    className="theme-toggle"
    aria-label="Dark mode"
    aria-pressed={theme === 'dark'}
    title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    onClick={toggleTheme}
  >
    <span className="theme-toggle-track" aria-hidden="true">
      <span className="theme-toggle-thumb" />
      <Sun className="theme-sun" size={16} />
      <Moon className="theme-moon" size={16} />
    </span>
  </button>
}
