import { RouterProvider } from 'react-router/dom'
import { router } from './app/router'
import { AuthProvider } from './features/auth/AuthProvider'
import { useTheme } from './theme/theme-store'

export default function App() {
  // Keep OS/storage synchronization active on every route, even error screens.
  useTheme()
  return <AuthProvider><RouterProvider router={router} /></AuthProvider>
}
