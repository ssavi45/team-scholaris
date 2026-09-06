import type { ReactNode } from 'react'
import { Link } from 'react-router'

export function AuthLayout({ title, description, children }: {
  title: string; description: string; children: ReactNode
}) {
  return <main className="auth-page">
    <div className="auth-container">
      <Link className="brand" to="/">Team Scholaris</Link>
      <section className="auth-card" aria-labelledby="auth-title">
        <h1 id="auth-title">{title}</h1>
        <p className="auth-description">{description}</p>
        {children}
      </section>
      <p className="auth-footer">A shared space for your research.</p>
    </div>
  </main>
}
