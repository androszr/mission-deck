# Security

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's
**private vulnerability reporting** on
[androszr/mission-deck](https://github.com/androszr/mission-deck/security/advisories/new)
and include what you found, how to reproduce it and what an attacker could
reach. You will get an answer as soon as the maintainer can look at it. This is
a side project maintained in spare time, so there is no formal response
window, but security reports go to the front of the queue.

Only the latest commit on `main` is supported.

## What Mission Deck opens, sends and stores

- **Listener.** One HTTP server (plus its WebSocket for the in-app terminal)
  bound to `127.0.0.1` on `PORT` (default 3001). Nothing listens on another
  interface. State-changing endpoints check the request origin.
- **Outbound calls.** Only to systems you configure: your git hosts (the app
  repository, the team data repository, an optional hosted module catalog and
  prototype remote), Jira and Confluence, Figma, Google Gemini and Amplitude.
  Each is an `.env` setting or a vault token; with none configured the app
  makes no outbound calls of its own beyond what `npm install` and the optional
  setup scripts download.
- **Tokens.** Never in `.env` and never on disk. They come from a Bitwarden
  vault you unlock in the app, live in the server process's memory, are kept
  out of every child process's environment, and reach a restarted server
  through an anonymous stdin pipe only. Git calls pass a token as a one-command
  argument, never in a stored remote URL.
- **Team data.** Plaintext lives only in `data-sub-repositories/ds-data/` on
  your disk. What reaches git is an encrypted mirror (AES-256-GCM, per-file HKDF
  subkeys, encrypted file names). The key is the gitignored `.encryption-key`,
  readable by its owner only; without it sync refuses rather than push
  plaintext. *End of day* can remove the plaintext copy once everything is
  safely in the mirror.
- **Telemetry.** Off by default. The vendored Amplitude SDK loads only when you
  configure an analytics key.
- **Modules.** A module runs with full rights in the browser and in the Node
  process; there is no sandbox. Install modules you trust, and review a module
  before publishing it to a shared catalog.
- **The in-app terminal** spawns Claude Code on your machine with your user's
  rights. It is reachable only from `localhost`.

## Handling tokens

The one-pager in [docs/guides/token-security.html](docs/guides/token-security.html)
has the rules for people: where tokens may live, scopes, expiry, and what to do
when one leaks.
