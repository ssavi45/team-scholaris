import { NavLink, Outlet } from 'react-router'

export function AppShell() {
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="app-header">
      <NavLink className="brand" to="/app">Team Scholaris</NavLink>
      <nav aria-label="Main navigation"><NavLink to="/app">Dashboard</NavLink></nav>
    </header>
    <main id="main-content" className="workspace" tabIndex={-1}><Outlet /></main>
  </div>
}
