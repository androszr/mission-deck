<!-- BEGIN DARK ARMY PACK - managed, edits here are overwritten -->
# Project context - mission-deck

Ground truth for every agent in `.claude/agents/`. Read this first, before
exploring the tree. If something here contradicts the code, the code wins -
say so in your report rather than silently working around it.

Three sections here are read by machinery, not only by people, so keep their
shape: the **Identity** table (gates), the **Reviewers** table (which domain
reviewer fires on which paths) and the **Conventions** list (what the
preflight, the verifier and the reviewers enforce).

This file has been filled in for Mission Deck, so a Dark Army resync leaves
it alone. To take a newer template later, delete the file and resync.

## Identity

| Field | Value |
|---|---|
| `src_dir` | `js/` (browser), `server.js` + `scripts/` (Node), `demo/`, `apps/mini-deck/src/` |
| Framework | Vanilla-JS SPA (ES modules, no bundler) served by a single-file Node.js HTTP server; Mini Deck is Vite + React + TypeScript |
| Package manager | npm 11 (Node 24); `npm install --include=dev` for the gates |
| `lint_gate` | `npm run lint` |
| `typecheck_gate` | none (plain JavaScript; Mini Deck: `npm --prefix apps/mini-deck run build`) |
| `test_gate` | `npm test` |
| `build_gate` | `node scripts/demo-export.js --site _site` |
| Plans | `plans/<YYYY-MM-DD>-<slug>.md` |
| Scout reports | `scout/<YYYY-MM-DD>-<slug>/report.md` |
| Manual checks | `manual-check/<YYYY-MM-DD>-<slug>/check.md` |
| Reference docs | `CLAUDE.md`, then the topic docs in `docs/architecture/` it links |

**Every gate must pass before any handoff.** Run them in the order listed -
the fast ones fail first. Agents read the commands from this table; none of
them hardcodes one. `npm run test:core` is what `.husky/pre-push` and CI run.

## Reviewers

One row per domain reviewer. `/ship` Phase 6.8 greps the changed-file list
against each regex and spawns every reviewer that matches; `/review --deep`
hands the diff to the first one. The regex is a floor - a reviewer is also
spawned on judgment when the diff touches its domain through other files.

| Agent | Fires when a changed path matches |
|---|---|
| `md-security-reviewer` | `server\.js|scripts/crypto-sync|scripts/_cp|vault|token|bitwarden|\.env|package\.json` |
| `md-integration-reviewer` | `package\.json|package-lock\.json|\.github/workflows/|\.husky/|scripts/demo-export|apps/mini-deck/(package|vite)` |

## Architecture

`CLAUDE.md` is the architecture ground truth: the shell and views, the data
repositories and encrypted sync, modules and the module catalog, the vault,
the Academy, prototypes and the day cycle, each with a topic doc under
`docs/architecture/`. Read the topic doc for the area a change touches.

## Conventions

The project's own non-negotiables, stated in full in `CLAUDE.md`. A plan that
breaks one is a plan that will not pass.

1. **ASCII source, English copy.** Every string a person reads is English;
   identifiers, comments, file names and commit messages are ASCII.
2. **No hard-coded colours.** Design System tokens from `css/ds-tokens*.css`;
   `demo/` carries no hex colour at all (a test enforces it).
3. **Never `git reset --hard`**, never bypass hooks, never git inside
   `data-sub-repositories/`.
4. **Restart the server through the API**, never `npm start` from an agent,
   never `POST /api/app/update`.
5. **Plaintext team data never reaches git.** Sync encrypts first; an
   operation that would wipe the mirror refuses instead.
6. **Shared writes are locked** (`withLock` + tmp+rename); JSON leaves the
   server through `jsonResponse`.
7. **Persisted shapes are forward-compatible.** A new key gets a default on
   read, a removed key is tolerated on load.
8. **Never commit or push** unless explicitly asked.

## What the tests cannot see

The suite is hermetic. Green proves nothing about these surfaces:

- **A real machine.** Spawned tools, a real vault unlock, a real data-repo
  remote and Windows process handling are stubbed in the tests.
- **The published demo.** GitHub Pages serves `_site/`; only the built site in
  a browser shows layout and screen-size problems.
- **A phone.** Mini Deck's tests run in jsdom; touch, safe areas and the home
  screen install are only visible on a device.

## Interview branches

`/ship` asks at most three questions from `.claude/skills/ship/templates/questions.md`.
Branches that the architecture above already settles should be answered from
this file rather than asked.
<!-- END DARK ARMY PACK -->
