import { PROTOTYPE_CODES } from './prototype-codes'

const SLUG_TO_NAME: Record<string, string> = {}
for (const [code, slug] of Object.entries(PROTOTYPE_CODES)) {
  SLUG_TO_NAME[slug] = code
}

interface PrototypePlaceholderProps {
  slug: string
}

export function PrototypePlaceholder({ slug }: PrototypePlaceholderProps) {
  const code = SLUG_TO_NAME[slug] ?? ''
  const label = slug.replace(/-/g, ' ').replace(/^\w/, c => c.toUpperCase())

  return (
    <main className="shell">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="topbar-brand-name">Mission Deck</span>
        </div>
      </header>

      <section className="welcome-card">
        <h1>{label}</h1>
        <p>
          This prototype is being prepared. Come back soon to try it out.
        </p>
        {code ? <p className="placeholder-code">Invitation code: <strong>{code}</strong></p> : null}
        <a className="placeholder-back" href="/">← Back to the start page</a>
      </section>
    </main>
  )
}
