import { useState, type FormEvent } from 'react'
import { PROTOTYPE_CODES } from './prototype-codes'

export type Claims = Record<string, unknown>

interface LandingPageProps {
  claims: Claims | null
  error: string | null
}

function claimText(claims: Claims, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = claims[key]
    if (typeof value === 'string' && value.trim()) return value
  }

  return fallback
}

export function LandingPage({ claims, error }: LandingPageProps) {
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)

  const hasSession = Boolean(claims) && !error
  const displayName = claims ? claimText(claims, ['name'], 'Signed-in user') : ''
  const email = claims
    ? claimText(claims, ['email', 'preferred_username', 'unique_name', 'upn'], '')
    : ''

  function handleCodeChange(value: string) {
    setCode(value)
    if (codeError) setCodeError(null)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = code.trim().toLowerCase()
    const slug = PROTOTYPE_CODES[normalized]
    if (!slug) {
      setCodeError('Invalid code. Check the code and try again.')
      return
    }

    window.location.assign('/' + slug)
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div className="topbar-brand">
          <span className="topbar-brand-name">Mission Deck</span>
        </div>
        {hasSession ? (
          <div className="topbar-user">
            <span className="topbar-user-name">{displayName}</span>
            {email ? <span className="topbar-user-email">{email}</span> : null}
            <a className="topbar-logout" href="/auth/logout">
              Sign out
            </a>
          </div>
        ) : (
          <span className="topbar-user topbar-user--muted">session unavailable</span>
        )}
      </header>

      <section className="welcome-card">
        <h1>Product prototypes</h1>
        <p>
          This is where invited testers try out product prototypes. To open a prototype,
          enter the invitation code you received below.
        </p>

        <form className="code-form" onSubmit={handleSubmit} noValidate>
          <label className="code-form-field" htmlFor="prototype-code">
            <span className="code-form-label">Invitation code</span>
            <input
              id="prototype-code"
              className={codeError ? 'code-input is-error' : 'code-input'}
              type="text"
              inputMode="text"
              autoComplete="off"
              value={code}
              onChange={(event) => handleCodeChange(event.target.value)}
              aria-invalid={codeError ? true : undefined}
              aria-describedby={codeError ? 'prototype-code-error' : undefined}
            />
          </label>
          <button type="submit" className="code-submit" disabled={!code.trim()}>
            Open the prototype
          </button>
        </form>

        {codeError ? (
          <p id="prototype-code-error" className="code-error" role="alert" aria-live="polite">
            {codeError}
          </p>
        ) : null}
      </section>
    </main>
  )
}
