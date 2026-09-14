import { createBrowserRouter, Navigate } from 'react-router'
import { AuthPage } from '../features/auth/AuthPage'
import { ProtectedRoute } from '../features/auth/ProtectedRoute'
import { AuthCallbackPage } from '../features/auth/AuthCallbackPage'
import { ResetPasswordPage } from '../features/auth/ResetPasswordPage'
import { AppShell } from '../components/layout/AppShell'
import { DashboardPage } from '../features/projects/DashboardPage'
import { ProjectPage } from '../features/projects/ProjectPage'
import { NotFoundPage, RouteErrorPage } from './status-pages'

export const router = createBrowserRouter([{
  errorElement: <RouteErrorPage />,
  children: [
    { path: '/', element: <Navigate to="/login" replace /> },
    { path: '/login', element: <AuthPage key="login" mode="login" /> },
    { path: '/register', element: <AuthPage key="register" mode="register" /> },
    { path: '/forgot-password', element: <AuthPage key="reset" mode="reset" /> },
    { path: '/auth/callback', element: <AuthCallbackPage /> },
    {
      element: <ProtectedRoute />,
      children: [{ path: '/reset-password', element: <ResetPasswordPage /> }, {
        element: <AppShell />,
        children: [
          { path: '/app', element: <DashboardPage /> },
          { path: '/project/:projectId', element: <ProjectPage /> },
          { path: '/project/:projectId/paper', lazy: async () => ({ Component: (await import('../features/paper/PaperPage')).PaperPage }) },
        ],
      }],
    },
    { path: '*', element: <NotFoundPage /> },
  ],
}])
