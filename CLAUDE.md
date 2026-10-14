# Mission Deck

> **How this file is kept small.** Claude Code loads `CLAUDE.md` on every turn. This file holds the RULES; the reasoning and measurements behind them live in `docs/architecture/*.md` (one file per topic, linked below). New detail goes into the topic doc; this file gets at most one line for it. `tests/test_claude_md_budget.mjs` fails the suite when this file grows past its budget or a topic doc is not linked from here.

Mission Deck is a local, plug-and-play cockpit for a product team: a shared CORE (this repository) plus MODULES people build and share through a module catalog that ships in the same repository under `catalog/`. People-facing docs: `README.md`, `docs/guides/`.

## Stack

Vanilla-JS SPA (ES modules, no bundler) + a single-file Node.js HTTP server (`server.js`, no framework, runtime dependencies `ws` + optional `node-pty`). No database: application JSON lives in the gitignored `data/` cache, installed modules in the gitignored `modules/`, the module catalog in `catalog/` (`catalog.json` + `catalog/modules/<id>/`), and team data in a registry of cloned data repos (`DATA_REPOS` / `DATA_REPO_DEFS` in `server.js`) reached through `/api/data/<repoId>/<op>`. Detail: [docs/architecture/data-repos-and-sync.md](docs/architecture/data-repos-and-sync.md).

- **Rows.** `data-tier-0` ("Team data", plaintext in `data-sub-repositories/ds-data/`, remote from `DATA_TIER_0_REPO_URL`, legacy alias `/api/data-tier-0/*` kept permanently) is the only row the core ships. `DATA_REPO_DEFS` is the documented place to declare more (each `data-sub-repositories/ds-<id>/`, own `urlEnvVar`/`tokenEnvVar`/vault item, frozen `hkdfInfo`/`mirrorFormat`; a key born here joins `OWN_LINE_ONLY_IDS` in `scripts/crypto-sync.js`, created by `POST /api/settings/encryption-key/generate`, shared via `/export`). Every module keeps its data under its own path of `data-tier-0`. All rows share `_repoClone`/`_repoPull`/`_repoEncrypt`/`_repoDecrypt`. `DATA_SUB_REPOS_DIR` / `DATA_TIER_0_DIR` relocate the directories (API tests rely on it).
- **Plaintext vs mirror.** `ds-data/` is PLAINTEXT and never a git repo; the clone is the encrypted mirror (`*-encrypted/`, one `.enc` per file, names encrypted too). Push encrypts first, pull decrypts after, both through `scripts/crypto-sync.js` (AES-256-GCM, per-file HKDF subkey, deterministic salt/IV). Key = the repo's line in the gitignored `.encryption-key`; without it `encryptionReady` is false and sync refuses rather than push plaintext. Never point git at the plaintext dir or the static server at the mirror.
- **The dividing line is "does the op call `encryptFn`".** `encryptTree` unlinks every mirror `.enc` with no plaintext source, so against an empty or half-decrypted tree it would wipe the mirror and a push would publish the wipe. It refuses with `encrypt-destructive` (decided before any write) when the plaintext shares no file NAME with a non-empty mirror (`mirrorOverlap`) or would drop >30% of a mirror over 50 files; `_repoPull` then falls back to `encryptFn(log, { prune: false })`. `POST /api/data/<repoId>/decrypt` (`generic: true`, `prune: false`) applies a key that arrived late - the wizard's key step calls it, never a pull. Status rows carry `decrypted` (true/false/null).
- **Op capabilities.** `generic: true` on `DATA_REPO_OPERATIONS` marks exactly the non-encrypting ops (`clone`, `pull`, their streams, `clear-dir`, `decrypt`, `clear-plaintext`, `refresh`). `pull-overwrite`, conflict/rebase repairs and `local-changes` stay `data-tier-0` only; `push`/`push-stream` carry `writable: true`, open for `data-tier-0` and rows with `pushEnabled: true` (which also get a real chain lock `lockFn`). `GET /api/sync-overview` publishes `canPush` / `canListLocalChanges` per row - the browser keeps no second list.
- **Autostash conflict.** `git pull --rebase --autostash` exits 0 when the stash re-apply conflicts; `_repoAutostashConflict` (the unmerged index is the record) stops `_repoPull` before decrypt and refuses every later pull/push with `autostash-conflict` until `POST /api/data/<repoId>/resolve-autostash {keep: 'mine'|'team'}` takes the conflicted blobs from the autostash or HEAD and decrypts the WHOLE tree; the stash is never dropped. Before the pull `_repoReconcileBeforePull` merges files edited on both sides on the DECRYPTED text (`git merge-file`), all or nothing. Covered by `tests/test_repo_pull_autostash.mjs`, `tests/test_repo_pull_reconcile.mjs`.
- **Frozen per source.** `DATA_REPO_DEFS.hkdfInfo` (a different context string fails every GCM tag) and `mirrorFormat` (`'v1'`: `<relPath>.enc`; `'v2'`: HMAC name, `v2:` prefix, the default). `decryptTree` dispatches per FILE. `pushEnabled` (may write at all) and `mirrorFormat` (which layout) are independent.
- **`.syncignore`** at a tier's plaintext root (gitignore subset, itself encrypted) is honoured by `encryptTree`, `mirrorOverlap`, `plaintextAheadOfMirror` and `decryptTree`; a policy dropping >30% of a >50-file mirror is `encrypt-destructive`.
- **Status and counters.** `dirty = mirrorDirty || plaintextDirty` (`plaintextAheadOfMirror`, read-only; the status handler never encrypts). The send/fetch column renders `filesToSend`/`filesToFetch` (`_repoPendingFileCounts`), never `ahead`/`behind` (commits). `filesToFetch` reads `@{upstream}` with no network; `POST /api/sync-overview/refresh` (`git fetch --prune` per source, 45 s budget, 60 s TTL `remoteRefreshDue`, `force: true` bypasses) is the only refresh and is deliberately NOT in `_repoStatusPayload` (polled every 60 s). `repoStateBadge` lives in `js/sync-center-helpers.js`.
- **Per-module view.** `GET /api/sync-modules` classifies pending files by each enabled module's `dataRepos[].paths` (the core is the rest); `push-stream?module=<id>` (`_repoPushScoped`, `data-tier-0` only) encrypts and stages that module's files one by one, never through `encryptTree`. Module row dates are the module's own (`_repoCommitDatesByPath`), `null` when no commit touched it. **There is no scoped PULL and there must not be one** (a partial decrypt reads as deletions the next push would publish); "Pull" on a module row starts the source's pull. `dataRepos[].access: 'read'` is a VIEW on the reader's row; a read-only scope answers `read-only-scope`. The core keeps only `_academy`/`_team`/`_prototypes` scopes.
- **Language.** English UI: every string a person reads (HTML text, `placeholder`, `aria-label`, `title`, toasts, errors, docs, templates) is plain English. Source is ASCII: identifiers, comments, log lines, file names, view ids, API paths, CSS classes, slugs, commit messages. Same for `modules/` and `catalog/`.

## Working rules

1. **Act. Don't ask.** Reversible and cheap? Do it, then say so. Ask first only for anything reaching an audience, anything that cannot be undone, anything expensive. Something broken that you can fix - fix it.
2. **A question is a question.** When asked a question, answer it; do not implement it. Act when told to go.
3. **Done means done.** Five things asked means five delivered. If one is genuinely blocked, finish the rest and name the blocker in one sentence.

## Critical rules (read first)

- **NEVER `git reset --hard`** (nor `--merge` / `--keep`). It destroys uncommitted work. Use `git stash` or `git restore <path>` to discard, `git reset --soft` to move HEAD. Enforced by a `deny` rule plus a `PreToolUse` hook in `.claude/settings.json`.
- **Git scope: this repo only.** Never `git add/commit/push` inside `data-sub-repositories/` - team data is a separate repository, synced only through the app's sync UI and `/api/data/*`.
- **Never bypass hooks.** No `--no-verify`, no `eslint-disable` added just to pass a gate.
- **ASCII code, English copy.** See Language above. Modules follow the same rule (`modules-template/README.md`).
- **Restart the server with the API, never npm.** `curl -s -X POST http://localhost:3001/api/settings/restart`, then poll `curl -s http://localhost:3001/api/app/version`. Never `npm start` from an agent, never `kill -9`, never delete `data/server-<port>.pid` by hand.
- **Parallel core work goes into a git worktree**, created at plan `accept` only: `node scripts/worktree.js create <slug>` (`.claude/worktrees/<slug>`, branch `wt/<slug>`, own port 3101-3199). Its server runs only through `scripts/worktree.js serve|stop` (test mode); team data and `.encryption-key` are NEVER linked or copied into it; `remove` refuses dirty, unmerged or running worktrees. Detail: [docs/architecture/worktrees.md](docs/architecture/worktrees.md).
- **Never call `POST /api/app/update` from an agent.** It resets the working tree to the fetched commit - a user action from Settings only.
- **Agents never commit.** The human reviews the diff and commits.
- **The core is not where day-to-day work lands.** People build MODULES under `modules/` and publish them into `catalog/`. `scripts/_core-scope.js` holds that rule for `scripts/hook-core-scope.js` (last step of `.husky/pre-commit`) and the `core-scope` rule of `scripts/check-conventions.js`. ON by default, opted out per machine with a gitignored `.core-dev` marker (or `COCKPIT_CORE_DEV=1` for one command). It fires only in real-work scopes (`--staged`, `--base`, working tree); a file whose ENTIRE diff is one generated line (the `model:` preference, the GitNexus counts line) is a NOTE. A local hook is advice; the real lock is a protected `main` on the hosting side. Covered by `tests/test_core_scope.mjs`.

## Commands

| Command | Purpose |
|---|---|
| `npm start` | Start the server on `PORT` (default 3001). Humans only. |
| `npm stop` | Stop the server (`scripts/stop-server.js`, via `data/server-<port>.pid`). |
| `npm run lint` / `lint:fix` | ESLint over `js/`, `demo/`, `server.js`, `scripts/`, `tests/`, `--max-warnings 0`. Needs `npm install --include=dev` (the default install omits dev deps via `.npmrc`). |
| `npm run lint:modules` / `:fix` | The same ESLint over `modules/` and `catalog/modules/` alone - not part of `npm run lint` (`tests/test_gates_scope.mjs`). |
| `npm test` | Unit tests (`tests/test_*.mjs` plus installed modules' `tests/test_*.mjs`, `node --test`). |
| `npm run test:core` | The core suite alone (`--core`); what `.husky/pre-push` runs. |
| `npm run test:api` | API tests (`tests/test_api_*.js`, spawns the server, sequential). |
| `npm run test:all` | `npm test && npm run test:api`. |
| `node scripts/plan-to-html.js <plan.md>` | Render a plan to its `.html` sibling. |
| `node scripts/bootstrap-gitnexus.js` | (Re)build the GitNexus index. |

## Automation

These commands carry the deterministic half of the delivery method, so the model spends tokens on judgement and not on `grep`. Node built-ins only, all support `--help` and `--json`, same exit codes: **0** clean, **1** blocking findings, **2** usage or internal error. Detail: [docs/architecture/automation.md](docs/architecture/automation.md).

| Command | What it replaces |
|---|---|
| `node scripts/plan-preflight.js <plan>` | `/new-idea` Phase 4.5 by hand: every rule of `.claude/skills/new-idea/PREFLIGHT-CHECKLIST.md` in one pass. |
| `node scripts/check-conventions.js [--base main\|--staged\|--files a,b\|--diff-file f\|--modules]` | The mechanical half of `cockpit-guardian`: `BLOCK`/`WARN`/`NOTE` + `VERDICT`. `--modules` walks installed modules from disk. |
| `node scripts/diff-digest.js [--base main\|--staged\|--files a,b]` | Pasting raw diffs into prompts: changed files, symbols, routes/views/tests, `size_class`, `bug_scan_recommended`, `agent_model`, `model_tier`. |
| `node scripts/gates.js [--lint] [--unit] [--api] [--all]` | Running lint and the suites by hand; one line per gate. |
| `node scripts/plan-status.js <plan> --status done\|partial\|blocked --ac "AC1=pass"` | The `/new-idea` Phase 7 handoff (status, AC boxes, banner, log, HTML). Idempotent. |
| `node scripts/gen-repo-map.js [--check]` | Hand-updating the planner's repo map (`.claude/skills/new-idea/templates/repo-map/overview.md`, generated region only). |
| `node scripts/new-view.js <id> "<Label>" [--hub <hub>]` | The view checklist below in one go, plus a test stub. Refuses rather than overwrite. |
| `node scripts/new-endpoint.js <METHOD> <path> [--lock]` | Handler in the matching `// -- Name --` section, dispatch arm, chain lock for writes, `tests/test_api_*.js` stub. |
| `node scripts/new-module.js <id> "<Label>" --area "<Area>" [--views a:A,b:B] [--no-server]` | A whole module: `module.json`, client entry + stylesheet, `server/` `register(ctx)`, a contract test, a README. `--area` is required; two or more `--views` make it a `hub`. |
| `node scripts/worktree.js recommend\|create\|prepare\|serve\|stop\|list\|status\|remove\|prune` | Hand-made `git worktree add` plus `.env`, `node_modules` and a port. Rules in `scripts/_worktree.js`. |
| `node scripts/proto-preflight.js <plan>` | `/prototype` Phase 4.5: every plan-preflight rule plus the prototype rules (canonical directory, Playwright recipe, spec, no host imports, container queries, DS gate, React/demo-state contract). |
| `node scripts/check-proto-ds.js <prototype-dir> [--baseline <json>]` | The Design System gate for a prototype: hard-coded colour, unknown token or icon slug, `/js/` import. |
| `node scripts/demo-export.js --out <prototype-dir>` | Copying `demo/` into a prototype: iframe wrapper, merged `spec.json`, a FLAT `assets/` with rewritten URLs. |
| `node scripts/build-team-directory.js --source <dir> [--out <dir>]` | Hand-maintaining `team/team-members.json` and avatars in team data. |
| `node scripts/extract-transcript.js [--list\|--templates\|--slug "x"\|<file> --out <p>]` | `/summarize-meeting` plumbing: find and extract a transcript, list meeting templates. |
| `node scripts/agent-banner.js <skill>/<banner>` | Hand-maintained model ids in spawn banners; run by the `PreToolUse` hook `scripts/hook-agent-banner.js`. |

Shared plumbing is `scripts/_report.js` (severities, the `--json` envelope, arg parsing, diff-scope resolution, the non-ASCII scanner, and the **single** change-size threshold behind `diff-digest`, the bug-scan gate and model tiering).

## Agent model preferences and app update

Detail (dirt exemptions, stash door, stash pill, adopt, fetch): [docs/architecture/app-update.md](docs/architecture/app-update.md).

- Settings > Agents writes the `model:` line of `.claude/agents/*.md`; the preference lives in gitignored `data/agent-model-preferences/<slug>.json` and `_applyAgentModelPreferences()` re-patches on boot. `.husky/pre-commit` runs `scripts/restore-agent-models-for-commit.js`, which rewrites the STAGED blob back to `.claude/default-models.json`. Covered by `tests/test_agent_model_guard.mjs`.
- Both app-update guards (`handleAppUpdate`, `_autoUpdateAppOnStartup`) read ONE helper, `_appUpdateDirtEntries`, over `_APP_UPDATE_DIRT_EXEMPTIONS` (model-line-only agent diffs, edits only inside the `gitnexus:start`/`end` fence, `.claude/skills/gitnexus/`). Every ambiguous case BLOCKS - the permissive direction hard-resets somebody's work.
- `dirty-tree` answers `stashable` / `unstashable` / `canStash`; re-submitting with `stashDirty: true` runs `git stash push -u -m "cockpit-update <ISO> v<semver>" -- <paths>` inside `_appUpdateLockChain` after a confirm. `-u` with an explicit pathspec, **never bare, never `-a`**.
- The app **never pops**. `GET|POST /api/app/stash*` + the top-bar "Stash" pill (`js/stash-modal.js`, `js/stash-helpers.mjs`): entries addressed by commit SHA (`_stashResolve`), never `stash@{N}`; `apply` only, a conflict is reported as work in the tree with the entry kept; drop is a separate confirmed click. Writes refuse under `IS_TEST_MODE`.
- **There is no API test on `/api/app/update` and there cannot be** - its reset runs before the `IS_TEST_MODE` gate. Git behaviour is tested against throwaway repos (`tests/test_app_update_stash.mjs`, `tests/test_app_repo_adopt.mjs`, `tests/test_app_update_fetch.mjs`).
- A source archive without `.git` is ADOPTED on the first request holding a token (`scripts/_app-repo-adopt.js`): `git init`, one fetch, `update-ref` + `read-tree` to the commit named by `SOURCE_COMMIT` or found by tree match - never a checkout or reset. Every fetch names an explicit destination for `main` (`ORIGIN_MAIN_REFSPEC`; rule `app-fetch-refspec`). The token rides as an argument, never in `remote.origin.url`.

## Skills tab

Settings > Skills shows one card per skill in `.claude/skills/`, DERIVED server-side by `GET /api/skills/list` from the files (frontmatter description, `## Phase` headings, agents from `banners/agents.json` intersected with the roster, commands from the prose), so a card cannot drift from its skill. `GET /api/skills/read?skill=&file=` matches both parameters against the derived lists, never joins them into a path. Covered by `tests/test_skills_derivation.mjs`, `tests/test_api_agents.js`.

## Academy

Detail: [docs/architecture/academy.md](docs/architecture/academy.md).

- `#view-academy` (`js/academy.js`) is the training path from an empty VS Code to a published module. CORE view, `academy` is on `RESERVED_MODULE_IDS`, **no `HUB_FLYOUT` entry** (that would make it a hub); its rail item is static markup in `index.html`. Stage/step lists: `js/academy-stages.mjs`, the single source for view and server. Removing a step never renumbers the others (progress is keyed on step ids).
- Stage 1 step 3 opens `docs/guides/repo-guide.md` (the human digest of this file - when a rule here changes in a way people must know, update that guide); stage 3 `step-3b` opens `CLAUDE.md` and `README.md`. Steps may carry `guideDoc` (slug under `/docs/guides/`) and `openTab`.
- Progress = one file per person, `ds-data/academy/progress/<person_slug>.json`; mural = `academy/mural/<person_slug>.md`. Every verified step autopublishes that ONE file (`_cocreatePushDataFile`: pre-push pull, data-tier lock + repo file lock across encrypt and git, staging names the single `.enc` path). A publish that cannot happen is a `sync` state, never a failed step. No `ds-data` -> reads 200 `storage: 'unavailable'`, writes 409.
- Endpoints `/api/cocreate/*`: `progress`, `unlock`, `verify-step`, `modules`, `mural`, `open-file` (key from `COCREATE_OPEN_FILE_MAP`, never a path), `admin/reset` (off unless `COCREATE_ADMIN_RESET=1`). The section spawns NO child process. Covered by `tests/test_academy.mjs`, `tests/test_api_cocreate.js`.

## Hubs and assets

Detail: [docs/architecture/hubs-and-assets.md](docs/architecture/hubs-and-assets.md).

- Rail hubs belong to the CORE, declared once in `js/core-hubs.mjs` (eight: `team`, `activity`, `finance`, `initiatives`, `support`, `knowledge`, `assets` = "Design", `apps`). `js/sidebar-flyout-config.js` loops over it - never edit it by hand. Three copies of the id list (the ESM declaration, `CORE_HUB_IDS` in `server.js`, `scripts/new-module.js`) are kept identical by `tests/test_core_hubs.mjs`. Every hub id is a reserved module id.
- A module puts PAGES in a hub: `sidebar.kind` = `"page"` + `sidebar.hub` (normal), `"item"` (own rail item) or `"hub"` (own flyout, escape hatch). An unknown hub gets NO menu entry. `js/module-host.js` pushes into `HUB_FLYOUT[hub].items` IN PLACE.
- `assets` ("Design") is the one core hub with pages of its own (design system, icons, illustrations, mascot, prototypes); **no `#view-assets` section**. The mascot is Pip, an original robot (`assets/mascot/pip-*.svg`, `GET /api/assets/mascot`); animated SVGs render as `<img>`, never inline. Icons live in `assets/icons/ds/`. Teardowns are registered with `registerViewCleanup` where the resource is created. Covered by `tests/test_assets_hub.mjs`, `tests/test_api_assets_mascot.js`.

## Architecture

Detail per topic: [shell and views](docs/architecture/shell-and-views.md) · [modules](docs/architecture/modules.md) · [vault and tokens](docs/architecture/vault-and-tokens.md) · [Windows spawning](docs/architecture/windows-spawn.md) · [team directory, Users, Tools](docs/architecture/settings-tabs.md) · [onboarding wizard](docs/architecture/onboarding-wizard.md) · [event buses and module sync bar](docs/architecture/event-buses.md). Sample data mode (a fictional team, nothing synced): [sample mode](docs/architecture/sample-mode.md).

**Shell.** `index.html`: `js/theme-boot.js` blocking, then `styles.css` + the DS stylesheets, then `js/app.js` as a module. Hash navigation `#view-<id>` shows one `.view-section`. `js/view-registry.js` `VIEW_REGISTRY` maps ids to lazy `importFn` + `render`/`runInit`. Views with timers or listeners register with `runActiveViewCleanup` (`js/view-lifecycle.js`). Settings = one view, eight tabs (System, Keys, Agents, Skills, Modules, Users, Tools, Demo), each with a STATIC skeleton; a renderer never blanks a slot it is about to fill, every exit path overwrites it. `ENV_SCHEMA` keys carry `kind` (`secret`/`config`/`system`). `server.js` is one file in `// -- Name --` sections; all JSON leaves through `jsonResponse`, all shared writes use `withLock` + tmp+rename.

**Modules.** Plug & play directories under gitignored `modules/`, discovered at startup, routes under `/api/m/<id>/` (`ctx.dataRepoDir(name)` = plaintext dir of a DECLARED `dataRepos[]` repo, null otherwise, never created), client under `/modules/<id>/client/`, built apps under `/modules-data/<id>/public/` (the one frameable prefix). `GET /api/modules/manifest` = the BOOT snapshot (only `js/module-host.js` reads it); `GET /api/modules/installed` = a fresh disk scan. Each `modules/<id>/` is its own local git repo WITHOUT a remote (`scripts/_module-git.js`); overwrite/remove refuse `module-dirty`. Module ids, labels and areas are English; owners/authors are GitHub-style handles.

**Module catalog.** `modulesCatalogMode()` picks the source. Default: the LOCAL folder `catalog/` (`MODULES_CATALOG_DIR` moves it) - list and install read from disk, `POST /api/modules/publish` copies the module into `catalog/modules/<id>/` and upserts `catalog.json` (`upsertCatalogEntry`), which the person then commits or opens a pull request for; pending-MR chips answer empty. Opt-in: `MODULES_CATALOG_REPO_URL` points at a shared GitLab catalog read through REST only (`COCKPIT_MODULES_TOKEN`, never cloned), and publish opens a branch `module/<id>-<date>` + merge request. Both paths share the pure `parseModulesCatalog` / `mergeModulesCatalog`, `publishDeleteGuard` (`publish-tree-mismatch` no override, `publish-destructive` needs `confirmDeletes: true`), `MODULE_STATUSES` and `publishTakeover`. Dashboard tiles: optional `widgets[]` in `module.json`, per-machine layout in `data/dashboard-layout.json` behind `GET|PUT /api/dashboard/layout`. Covered by `tests/test_api_modules_catalog.js`, `tests/test_modules_publish.mjs`, `tests/test_dashboard_layout.mjs`.

**Vault and tokens.** Tokens **never live in `.env`**: `/api/bitwarden/unlock` maps vault items (`BW_ITEM_MAP`) to `COCKPIT_APP_TOKEN`, `COCKPIT_DATA_TOKEN`, `COCKPIT_MODULES_TOKEN`, Jira/Confluence/Figma/Gemini tokens, `PROTO_DEPLOY_TOKEN` and the Amplitude keys of the usage-analytics module. Project tokens are minted from Settings > Keys (`/api/gitlab-tokens/*`). A vault-loaded token lives in the process HEAP, **never in `process.env` of a spawned or restarted process**: `_restartChildEnv` strips every `ENV_SCHEMA` key and `BW_SESSION`; session and tokens cross to the restart child as one JSON line on an anonymous stdin pipe (`_parseRestartHandoff`). Every host (GitLab API, Jira, Confluence, prototype hosting) is an env setting with an `example.com` placeholder or empty default. Covered by `tests/test_restart_handoff.mjs`.

**Windows spawning.** `scripts/_cp.js` is required FIRST in `server.js` and patches `child_process` so every spawn gets `windowsHide`. **No literal `detached: true`**: use `detached: process.platform !== 'win32'`, kill trees with `taskkill /T` (`_toolKill`); rule `detached-on-win32`. A shell only for `.cmd` shims (`_toolShell`). Covered by `tests/test_cp.mjs`.

**Team directory and Settings tabs.** `ds-data/team/team-members.json` + `team/avatars/`; `js/team-directory.js` is the ONE resolver (team photo > GitLab avatar > initials). Settings > Users edits it via `/api/team/*`; uploaded photo names are derived server-side, format from magic bytes. Settings > Tools: `GET /api/tools/status` probes in parallel (60 s cache, always 200, facts only, copy and remedies client-side); `POST /api/tools/run {job}` runs one job from a CLOSED table, 202, chain-locked, refuses under `IS_TEST_MODE`. Covered by `tests/test_tools_status.mjs`, `tests/test_api_tools_status.js`.

**Onboarding wizard.** `#view-onboarding-wizard` (`js/onboarding-wizard.js`), CORE view, static rail item "Start here", **no `HUB_FLYOUT` entry**. Seven cards, every badge derived on entry; a locked vault is not "missing". Key step: `GET /api/settings/encryption-status`, `POST /api/settings/encryption-key` (`checkOrigin`, `KNOWN_REPO_IDS`, chain lock, never returns key material). Covered by `tests/test_onboarding_wizard.mjs`, `tests/test_api_encryption_key.js`.

**Event buses.** `js/secrets-events.js` (`cockpit:secrets-changed` after unlock / refresh-secrets - every token-painted slot re-fetches), `js/data-events.js` (`cockpit:data-changed`, emitted only on SUCCESS of a sync; ONE listener, `refreshActiveView()` in `js/app.js`; module views are RE-ENTERED with a cache-busted import or use an exported `onDataChanged()`) and `js/infra-events.js`. Events carry no trusted payload. Module views with `dataRepos` get the read-only module sync bar (`js/module-sync-bar.js`). Covered by `tests/test_secrets_events.mjs`, `tests/test_data_events.mjs`, `tests/test_module_sync_bar.mjs`.

## Prototypes

Detail: [docs/architecture/prototypes.md](docs/architecture/prototypes.md). People-facing: `docs/guides/prototypes.md`.

- Prototypes live in team data, `ds-data/prototypes/<id>/` (`_prototypes` sync row). `POST /api/prototypes` always copies `templates/prototype/starter/` (one generic screen with demo states). The build shell seed `templates/prototype-build-shell/` is self-contained.
- `GET /api/prototypes/deploy-stream?id=<id>[&force=1]`: clone/sync the shell (`data-sub-repositories/data-prototypes/`, remote `PROTO_BUILD_REPO_URL`, env-only; without it `no-remote`), rewrite sources, ESLint, build, commit, push; hosting serves `PROTO_PAGES_BASE_URL`. The shell syncs only through `_protoShellSyncWithOrigin`; never `--autostash` on `_protoGitExec` (rule `proto-shell-autostash`).
- **Stale-source guard** (`_protoPublishedGuard`): a published blob that differs from local plaintext must be found in the team data mirror's history; not found or unknown -> `stale-source`, `force=1` only from the modal's "publish anyway". `unsent-source` (a publish file still pending in team data) has NO force. Lint and build are never forced.
- The commit names exact paths (`_protoPublishAddPaths`), never `git add src/ public/`. `PROTO_DEPLOY_TOKEN` never enters a stored URL (one-command `-c url.<token>.insteadOf=`). One import allowlist in `scripts/_proto-imports.js`; `_protoEnsureLibraryDeps` **never installs `@bryntum/*`** (503 `deps-missing`).
- Tests: `tests/test_proto_deploy_guard.mjs`, `tests/test_proto_deploy.mjs`, `tests/test_proto_shell_sync.mjs`, `tests/test_proto_imports.mjs`, `tests/test_check_proto_ds.mjs`, `tests/test_proto_preflight.mjs`, `tests/test_prototype_contract.mjs`.

## End of day / Good morning

Detail: [docs/architecture/day-cycle.md](docs/architecture/day-cycle.md).

- ONE top-bar pill: `dayCycleMode(rows)` (`js/day-cycle-helpers.mjs`) is `morning` when any row has `wrappedUpAt`, else `wrapup`. Evening = `push-stream` then `POST /api/data/<repoId>/clear-plaintext`; morning = `POST /api/data/<repoId>/decrypt`.
- **`clear-plaintext` invariant:** eligibility (a FULL `plaintextAheadOfMirror` run with `added === 0 && changed === 0`) + clone + key are checked in the SAME call under the SAME locks immediately before `fs.rmSync`, always on `d.plainDir`. `key-missing` has **no override and no `force`**. Idempotent (`alreadyEmpty`).
- `data/day-cycle-state.json` exists for exactly two reasons (naming the wiped state; surviving a half-populated tree) and must not grow a third. `POST /api/settings/shutdown` = restart minus respawn. A modal that stays open uses a looping mascot pose. Covered by `tests/test_day_cycle_helpers.mjs`, `tests/test_api_data_day_cycle.js`.

## Adding a view - canonical checklist

**Fast path:** `node scripts/new-view.js <id> "<Label>" --hub <hub>` writes steps 1-4 plus a test stub (`--dry-run` to preview).

1. `index.html` - add `<div class="view-section" id="view-<id>">` inside the shell.
2. `js/<id>.js` - a module exporting `render<Name>View()` and `init<Name>()`.
3. `js/view-registry.js` - the `VIEW_REGISTRY` entry (`importFn`, `render`, `runInit`).
4. `js/core-hubs.mjs` - the `{ label, view }` entry in the `pages` of its hub.
5. Register cleanup with `runActiveViewCleanup` if the view starts timers or listeners.
6. DS classes only (`ds-btn`, `ds-card`, `ds-badge`, `ds-callout`, `ds-input`, `ds-tabs`, `ds-segmented`); toasts via `js/toast.js`, modals via `js/ds-modal.js`, icons from `/assets/icons/ds/`.
7. A new endpoint: `node scripts/new-endpoint.js <METHOD> <path>`.

Skipping step 3 or 4 leaves a view that exists but is unreachable: the most common defect here.

## Loading skeletons

Detail: [docs/architecture/loading-skeletons.md](docs/architecture/loading-skeletons.md).

- Skeletons are STATIC markup in `index.html` plus `js/skeleton.js` (`data-skel="1"`). `clearSkeleton(root)` belongs on EVERY early return that paints nothing; `hasSkeleton(root)` stops a painter from writing something SHORTER than the skeleton. Reserve the REAL, measured box.
- Whole-grid shifts are stamped on `<html>` by `js/theme-boot.js` from the last answer (`html[data-rail]`, `cockpit.updateBannerSeen`, `cockpit.infraBannerSeen`), each released on EVERY settled outcome.
- **Infra banner** (`js/infra-banner.js`, `js/infra-banner-helpers.mjs`): kinds `vault`, `network`, `access`, `both`. The network half comes from `GET /api/infra/status`, a REGISTER fed only by calls the process already makes; the server never probes except `POST /api/infra/recheck`. A refusal (401) is NOT a success; `GET /user` 2xx and any 404 prove nothing. Dismissal is per kind.
- `_createSwrMemo` is the one stale-while-revalidate memo; anything that reads a row to DECIDE re-reads past it. Covered by `tests/test_loading_skeletons.mjs`, `tests/test_infra_banner.mjs`, `tests/test_api_infra_status.js`.

## Design System

`css/ds-tokens.css`, `css/ds-tokens-dark.css` and `css/ds.css` are the design system: neutral `--ds-*` primitives under semantic tokens, Inter (`fonts/`, OFL) and the Lucide-based icon set in `assets/icons/ds/`. Never hard-code a hex colour - use a token. Full rules: `.claude/agents/references/cockpit-conventions.md`.

## Document templates

`templates/` holds document templates (product, research, eight meeting-note types, an HTML meeting report). Every template carries YAML frontmatter. Finished documents go to `user-data/`, never back into `templates/`. Index: `templates/README.md`. Process templates (plan, interview questions, repo map) live in `.claude/skills/new-idea/templates/`.

## Skills and agents routing

| I want to... | Use |
|---|---|
| Build a feature, view, endpoint or fix | `/new-idea` (plan -> review -> implement -> verify) |
| Build or extend a screen prototype | `/prototype` (React prototype in team data, DS gate) |
| Change a mini app (Vite + React + TypeScript) | `/mini` (registered under `.claude/skills/mini/projects/`) |
| Summarise a meeting transcript | `/summarize-meeting` |
| Celebrate a branch or MR with an HTML page | `/kudos` |
| Audit my diff before commit or push | `/pre-ship-audit` |
| Graph-aware review of a branch or PR | `/review-pr` |
| Review the whole test suite | `/qa-audit` |
| Draft a commit message | `/commit-message` |
| Clean up after a merge | `/sync-after-merge` |
| Create or update a Jira issue | `/jira` |
| Read or write a Confluence page | `/confluence` |
| Refresh the planner's repo map | `/refresh-repo-map` |

Agent roster and models: `.claude/agents/README.md`, `.claude/default-models.json`. Skill index: `.claude/skills/README.md`.

<!-- The block below is GENERATED by `gitnexus analyze`. It carries a -->
<!-- `gitnexus:keep` marker, so a reindex rewrites only its counts line. -->

> **In this repo the GitNexus index is built and refreshed by `node scripts/bootstrap-gitnexus.js`.**
> It is the only invocation that works in both states and the one the "Update map" button in
> Settings > Tools runs. `.gitnexus/` is gitignored, so a fresh machine has no `.gitnexus/run.cjs`
> and `node .gitnexus/run.cjs analyze` fails with `MODULE_NOT_FOUND` - a first index to build, not
> a stale one. The bootstrapper installs the CLI at the PIN (comparing versions) and runs the
> analyzer with `ANALYZE_ENV` from `scripts/_gitnexus-analyze.js`; without it `server.js` (past the
> analyzer's 512 KB default cap) drops out of the graph and every `impact`/`context` on a server
> symbol answers "not found" over a green index. Both callers analyze with **`--index-only`**
> (`analyzeCliArgs`), so indexing never rewrites this banner or `.claude/skills/gitnexus/`; the
> counts below change only by a deliberate run without the flag. `_isGitnexusBannerOnlyDiff` stays
> as the safety net. Covered by `tests/test_gitnexus_analyze.mjs`.

<!-- gitnexus:start -->
<!-- gitnexus:keep -->
# GitNexus - Code Intelligence

This project is indexed by GitNexus as **mission-deck** (4091 symbols, 11796 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale, or never built on this machine? Run `node scripts/bootstrap-gitnexus.js` from the
> project root - see the note above this block for why, in this repo, that is the command and
> not `node .gitnexus/run.cjs analyze` or `npx gitnexus analyze`.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol - callers, callees, which execution flows it participates in - use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source to sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace - use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/mission-deck/context` | Codebase overview, check index freshness |
| `gitnexus://repo/mission-deck/clusters` | All functional areas |
| `gitnexus://repo/mission-deck/processes` | All execution flows |
| `gitnexus://repo/mission-deck/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
