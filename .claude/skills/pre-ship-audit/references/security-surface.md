# Security surface — mission-deck

What an attacker (or a careless diff) can actually reach in this app. The server binds to
`127.0.0.1` only and there is no authentication layer — that is by design for a local desktop
cockpit, so do not report it as a finding. Everything below IS in scope.

## 1. Subprocess execution

`server.js` shells out to:

| Binary | Reached from | User-controlled input |
|---|---|---|
| `git` | data-repo routes, app-update | branch names, remote URLs, commit messages |
| `bw` (Bitwarden CLI) | `/api/bitwarden/*` | master password, collection name, item names |
| `node` | restart child, scripts | script paths |

**Findings:** any request value reaching a shell string without an allowlist regex. Branch names
must match something like `^[A-Za-z0-9._/-]{1,100}$`; a remote URL must be validated as https and
host-checked. Prefer the argv form of `spawn` over a shell string. A master password or a token
must never appear in an argv that is later logged.

## 2. Path traversal

Request-controlled path segments are used by:

- `serveStatic` for `index.html`, `js/`, `css/`, `assets/`, `fonts/`, `docs/`
- the static mount for `/data-sub-repositories/ds-data/...`
- any handler reading or writing under `user-data/` or `data/`

**Findings:** a handler that joins a request path onto a base directory without `path.resolve` plus
a prefix re-check, or that trusts a decoded `..`. `serveStatic` already has the guard — a new
handler that bypasses it is a BLOCKER.

## 3. Secrets

Tokens live in memory after a Bitwarden unlock, never in `.env` and never in the repo:
`COCKPIT_APP_TOKEN`, `COCKPIT_DATA_TOKEN`, `CONFLUENCE_TOKEN`, `JIRA_TOKEN`, `JIRA_TECH_TOKEN`.

**Findings:** a token logged, echoed into a JSON response, written into a plan, an audit file or
`sync-log.json`, interpolated into a git remote URL that is then printed, or streamed through an
SSE progress line. Also: a new file that could hold secrets and is not covered by `.gitignore`
(`.env`, `user-data/`, `data/`, `data-sub-repositories/` are).

## 4. Request hardening

Existing protections that a new route must not lose: security headers, the Origin check on
state-changing methods, and the rate limiter.

**Findings:** a new POST/PUT/DELETE route registered outside the guarded path; a state mutation
behind a `GET`; an SSE endpoint streaming raw subprocess output (token leakage); a response that
reflects request input into HTML without escaping.

## 5. Data integrity

- Shared JSON writes go through `withLock` and tmp+rename. An unlocked read-modify-write on a file
  two clients can touch loses data.
- Import and merge paths must merge by key, not overwrite the whole file.
- `POST /api/app/update` fetches and hard-resets the working tree to `FETCH_HEAD`, and is allowed
  only on `main`. Any change widening that condition is a BLOCKER.

## 6. External calls

Jira (`JIRA_URL`, default `https://jira.example.com`) and Confluence (`CONFLUENCE_BASE_URL`) are
called with a bearer token. `VERIFY_SSL=false` disables certificate verification for internal CAs —
flag any diff that widens where that flag applies, or that sends a token to a host taken from
request input rather than from `.env`.

## Out of scope

TLS configuration, CSP tuning, dependency CVEs (two runtime dependencies: `ws`, `node-pty`),
localhost-only binding, and generic "add authentication" advice.
