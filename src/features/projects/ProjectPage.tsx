import { Link } from 'react-router'

export function ProjectPage() {
  return <>
    <Link to="/app">Back to dashboard</Link>
    <h1>Project workspace</h1>
    <div className="empty-state">
      <h2>Project access is not connected yet</h2>
      <p>Project details will appear here after server-enforced membership checks are implemented.</p>
    </div>
  </>
}
