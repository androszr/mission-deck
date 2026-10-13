# Repo conventions — mission-deck

Repo-level rules for the audit lenses. UI, Design System and cockpit-specific rules live in
`.claude/agents/references/cockpit-conventions.md` — this file does not repeat them; the
`cockpit-guardian` agent owns that surface.

## Language and encoding

- **ASCII-only** in identifiers, comments, log lines, file names and commit messages.
- **Plain English in every user-visible string**; ids, paths, keys and compared values stay ASCII even inside quotes.
- Check: `LC_ALL=C grep -rn '[^[:print:][:space:]]' <paths>`.
- Skill and agent descriptions are English and ASCII. `CLAUDE.md` is English.

## Lint and formatting

- `eslint.config.mjs`, run as `npm run lint` with `--max-warnings 0` over
  `js/`, `server.js`, `scripts/*.js`, `tests/*.js`.
- `js/` modules are ES modules with browser globals; `server.js`, `scripts/` and `tests/` are
  CommonJS with Node globals.
- A new `eslint-disable` line is a finding unless the diff explains why in a comment on the same
  line.

## Hooks

- husky `pre-commit` runs lint-staged (ESLint on staged `.js` / `.mjs`); `pre-push` runs the test
  suite. **`--no-verify` is forbidden** — its presence anywhere in a diff or a script is a BLOCKER.

## Tests

- `tests/test_*.mjs` — unit tests via `node --test` (`npm test`). No server, no network.
- `tests/test_api_*.js` — API tests that spawn the server; they run sequentially
  (`--test-concurrency=1`) because they share the port and the `data/` cache.
- Every new route in `server.js` needs at least one `tests/test_api_*.js` case.
- Every new branching helper in `js/` needs a `tests/test_*.mjs` case.
- There is no coverage tooling — do structural gap analysis, never request a coverage number.

## Files and layout

- One file per view module in `js/`, named after the view id.
- `scripts/` holds Node helper scripts only. No Python anywhere in this repo.
- Generated or user-specific output goes to `user-data/` (gitignored): screenshots, audits,
  working notes, `agent-model-preferences.json`.
- Application cache goes to `data/` (gitignored): `server-<port>.pid`, `app-update.json`,
  `sync-log.json`.
- `plans/` is committed: `YYYY-MM-DD-<slug>.md` plus its rendered `.html` sibling.

## Git scope

- All git operations target the main repository at the working-directory root.
- `data-sub-repositories/ds-data/` is a separate repo — never `git add/commit/push` inside it.
  It is synced through the app UI and `/api/data-tier-0/*`.
- A hard reset (`git reset` with `--hard`, `--merge` or `--keep`) is forbidden: deny rule plus a
  `PreToolUse` hook. Use `git stash`, `git restore`, or a soft reset.
- Agents never commit. The human reviews the diff and commits.

## Configuration

- `.env` carries configuration only, never secrets. Tokens come from Bitwarden at runtime.
- `PORT` is read once from `.env` (fallback 3001) — no other port literal in the code.
- `JIRA_BASE_URL` is one constant derived from `JIRA_URL`, not a repeated literal.

## Process

- Restart the server with `curl -s -X POST http://localhost:3001/api/settings/restart`, then poll
  `GET /api/app/version`. Never `npm start` from an agent, never `kill -9`.
- `POST /api/app/update` is a user action from the Settings UI only — never called from agent code.
