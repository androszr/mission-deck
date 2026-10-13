# Mission Deck - getting started

Welcome. Mission Deck is a light, local cockpit for a product team: a vanilla-JS SPA plus a
single-file Node server, no database, no bundler.
The full technical picture: [CLAUDE.md](../../CLAUDE.md).
All agents: [.claude/agents/README.md](../../.claude/agents/README.md).
All skills: [.claude/skills/README.md](../../.claude/skills/README.md).

## First-day checklist

Requirements: Node.js 24 (on macOS through Homebrew, on Windows `winget install OpenJS.NodeJS.LTS`),
Git (on Windows "Git for Windows" with the default options), Python 3.10+ (`brew install python`
or `winget install Python.Python.3.12`), and Claude Code. Bitwarden CLI is optional and only needed
if you keep tokens in a vault. The full list with commands for both systems is in
[README.md](../../README.md).

Clone the repository somewhere **outside OneDrive and iCloud** (for example `~/Projects/mission-deck`).

```bash
git clone https://github.com/androszr/mission-deck.git && cd mission-deck
npm install
npm run setup                 # once: Chromium (Playwright) + the code graph (GitNexus)
npm start                     # server on http://localhost:3001, the browser opens by itself
```

You do not need a `.env` file to start. The port defaults to 3001, the module catalog is the
local `catalog/` folder, and everything that talks to an outside system (a team data repository,
Jira, Confluence, a prototype host) is off until you configure it. `.env.example` lists every
setting.

On the first start Mission Deck opens the **Start here** wizard: environment, Bitwarden vault
(optional), access to the app repository, encryption keys, team data, update and the Academy.
You can return to it at any time from **Start here** in the side menu, just above Settings.

After `npm run setup`, restart Claude Code - only then does it see the MCP server with the code graph.

`npm run setup` is two scripts you can also run on their own:
`node scripts/bootstrap-playwright.js` downloads the Chromium used by visual verification
(`npm install` deliberately does not fetch it - it is about 150 MB), and
`node scripts/bootstrap-gitnexus.js` builds the code graph. Both behave the same on macOS and Windows.

## Want to contribute code?

`npm install` above installs the starter profile: only what the running app needs, without
`eslint` and `lint-staged`. Before you commit code, add the full toolset with one command:

```bash
npm install --include=dev     # or: npm run setup:dev
```

`npm run lint`, `npm test` and the git hooks (`pre-commit`, `pre-push`) then work as documented.
Without this step a commit of a `.js`/`.mjs`/`.cjs` file stops with a message that the developer
tools are missing.

## Tokens - vault item names

You never type a token into a file. When you use Bitwarden, the server reads tokens from the vault
when you unlock it (Settings > Keys > **Unlock Bitwarden vault**) and keeps them in memory only.

| Bitwarden item | Variable | What for |
|---|---|---|
| `COCKPIT-APP` | `COCKPIT_APP_TOKEN` | app repository: updates, merge requests |
| `COCKPIT-DATA` | `COCKPIT_DATA_TOKEN` | team data repository (`data-tier-0`) |
| `COCKPIT-MODULES` | `COCKPIT_MODULES_TOKEN` | a shared GitLab module catalog (opt-in only) |
| `<first-last>-jira` | `JIRA_TOKEN` | Jira - your personal token |
| `JIRA_TECH_COCKPIT` | `JIRA_TECH_TOKEN` | Jira - a service account (fallback) |
| `CONFLUENCE_TOKEN=` in a note | `CONFLUENCE_TOKEN` | reading and writing Confluence pages |
| `GITLAB-PERSONAL` | `COCKPIT_OWNER_TOKEN` | creating project tokens from Settings |
| `FIGMA` | `FIGMA_TOKEN` | Figma: specs and file scans |
| `COCKPIT-PROTO-DEPLOY` | `PROTO_DEPLOY_TOKEN` | prototype publishing (optional) |
| `GEMINI` | `GEMINI_PERSONAL_TOKEN` | Google Gemini: text to speech and audio transcription |
| `AMPLITUDE-COCKPIT` / `-SECRET` | `AMPLITUDE_COCKPIT_API_KEY` / `_SECRET_KEY` | Amplitude: usage analytics (the usage-analytics module) |

Every row is optional. A missing one shows as a grey dot in Settings > Keys and nothing else happens.

The `COCKPIT-` prefix matters for **project tokens** (app repository, team data repository,
module catalog): it is what stops an unrelated item in a shared collection from supplying a token
for those repositories. **Personal tokens** (`GITLAB-PERSONAL`, `-jira`, `JIRA_TECH_COCKPIT`,
`CONFLUENCE_TOKEN`, `FIGMA`, `COCKPIT-PROTO-DEPLOY`, `GEMINI`) and the Amplitude keys are a
deliberate exception: none of them belongs to one repository.

Both project tokens can be created from Settings (Keys > **Create token**), one card per
repository. The form asks for your first and last name because the token name is built from them
(`first-last-COCKPIT-APP`), and the app token's name is also how Mission Deck recognises you. Copy
the value into the `COCKPIT-APP` or `COCKPIT-DATA` item in Bitwarden - the app never stores tokens.
Creating either needs only a `GITLAB-PERSONAL` item.

The default access levels differ on purpose: the app token gets Developer (30) because it only
pushes work branches; the data token gets Maintainer (40) because sync writes straight to the data
repository's default branch, and a protected branch refuses a Developer only at push time.

## Which skill to use

| What you want | Use |
|---|---|
| Add a view, an endpoint, a fix | `/new-idea "describe the idea"` |
| Check changes before a commit | `/pre-ship-audit` |
| Review a branch with blast-radius analysis | `/review-pr` |
| Propose a commit message | `/commit-message` |
| Clean up branches after a merge | `/sync-after-merge` |
| Review the whole test suite | `/qa-audit` |
| Create a Jira issue | `/jira` |
| Read or write a Confluence page | `/confluence` |
| Write a document (story, brief, notes, workshop) | copy from `templates/`, save in `user-data/` |

## Key ideas

- **View** - one `#view-<id>` section in `index.html` plus a module in `js/`. Adding a view is
  always the same set: the HTML section, a `VIEW_REGISTRY` entry (`js/view-registry.js`) and a page
  on a hub in `js/core-hubs.mjs`. `node scripts/new-view.js` does all of it.
- **Hub** - hovering a rail item opens a flyout with its pages. Declared once, no extra HTML.
- **Modules** - new things are built as modules under `modules/` (template: `modules-template/`),
  not as changes to the core. A module survives an app update; a core edit does not. Shared
  modules live in the local catalog under `catalog/`.
- **Team data `data-tier-0`** - a separate git repository you point `DATA_TIER_0_REPO_URL` at,
  cloned as an encrypted mirror and decrypted into `data-sub-repositories/ds-data/`. Never run
  `git add/commit/push` there by hand - the Sync button in the top bar does that.
- **Design System** - `css/ds-tokens.css` and `css/ds.css`. Every button carries `ds-btn ds-btn--*`.
- **Templates** - `templates/` has ready documents: user story, task, UX brief, requirements,
  estimate, research, interview, notes, workshop, eight meeting-note variants and an HTML report.
  Copy a template into `user-data/` and fill it in. Index: `templates/README.md`.
- **Delivery path** - `/new-idea`: a planner writes a plan with acceptance criteria, you accept it,
  an implementer builds it, a blind verifier checks the criteria, GitNexus measures the blast
  radius, and a bug scan ends with SHIP or ITERATE.

## Five traps

1. **Working on `main`.** Skills refuse to implement on `main`. Create a work branch:
   `git checkout -b feat/<name>`.
2. **Restarting the server.** Use `curl -s -X POST http://localhost:3001/api/settings/restart`
   (in Windows PowerShell: `curl.exe`, because plain `curl` is an alias of `Invoke-WebRequest`).
   Never a second `npm start`, `pkill` or `kill -9`.
3. **`git reset --hard` is blocked** by a permission rule and a hook. Use `git stash`,
   `git restore` or `git reset --soft`.
4. **ASCII-only code.** Identifiers, comments, file names and log lines stay ASCII.
5. **Design System classes are mandatory.** A bare `<button>` without `ds-btn` is a block in the
   conventions review.

## Where next

- [CLAUDE.md](../../CLAUDE.md) - the full truth: stack, architecture, conventions, commands
- [README.md](../../README.md) - install, tokens, running
- [INSTALL.html](INSTALL.html) - step-by-step installation
- [token-security.html](token-security.html) - handling tokens
- [repo-guide.md](repo-guide.md) - the repository explained for people
- [templates/README.md](../../templates/README.md) - document templates
