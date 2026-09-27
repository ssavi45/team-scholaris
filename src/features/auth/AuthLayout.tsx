import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { BrandLogo } from '../../components/BrandLogo'
import { ThemeToggle } from '../../components/ThemeToggle'

export function AuthLayout({ title, description, children }: {
  title: string; description: string; children: ReactNode
}) {
  return <main className="auth-page">
    <div className="auth-theme-control"><ThemeToggle /></div>
    <div className="auth-container">
      <Link className="brand" to="/"><BrandLogo /></Link>
      <section className="auth-card" aria-labelledby="auth-title">
        <h1 id="auth-title">{title}</h1>
        <p className="auth-description">{description}</p>
        {children}
      </section>
      <p className="auth-footer">A shared space for your research.</p>
    </div>
  </main>
}
