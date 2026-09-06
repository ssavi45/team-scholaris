import { Link } from 'react-router'

export function NotFoundPage() {
  return <main className="status-page">
    <p className="eyebrow">404</p>
    <h1>Page not found</h1>
    <p>This address doesn’t lead to a page in Team Scholaris.</p>
    <Link to="/">Back to Team Scholaris</Link>
  </main>
}

export function RouteErrorPage() {
  return <main className="status-page" role="alert">
    <h1>Something went wrong</h1>
    <p>Reload the page to try again.</p>
    <a href="/">Return to Team Scholaris</a>
  </main>
}
