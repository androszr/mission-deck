# Sample mode

"Try it with sample data": the onboarding wizard (card 1) can point the team
data at a COPY of `examples/sample-team/ds-data/`, a generated, fictional team
("Northwind Product", see `examples/sample-team/README.md`). Nothing reaches git
or a remote. The same tree feeds the README screenshots
(`scripts/readme-shots.mjs`) and the tests.

## Where it lives

- **Server, `// -- Sample mode --` in `server.js`** plus a boot half next to `DATA_TIER_0_DIR`. `GET /api/sample-mode` -> `{ active, since, available, restartRequired, blockedByEnv }`; `POST /api/sample-mode/enter` and `/leave` (`checkOrigin`, one chain lock).
- **Marker** `data/sample-mode.json` (`{ active, since }`), read ONCE at boot, before any path is derived. **Copy** `data/sample-team/ds-data/`. Both are inside gitignored `data/`. `SAMPLE_DATA_DIR` relocates them (the tests and the screenshot script rely on it).
- **Enter** copies the tree, installs every local-catalog module that is not installed (loopback `POST /api/modules/install`, area from `catalog.json`), then writes the marker LAST. A module that fails is reported, never fatal. **Leave** removes the marker and the copy; modules stay installed.
- **Both need a restart** (the data folder is decided at boot); the client posts `/api/settings/restart` and reloads.
- **At boot**, with the marker, no explicit `DATA_TIER_0_DIR` and the copy present: `DATA_TIER_0_DIR` is the copy and `DATA_SUB_REPOS_DIR` is set to `data/sample-team` (modules read it themselves). `_restartChildEnv` strips that variable again so leaving really leaves. An explicit `DATA_TIER_0_DIR`, `DATA_SUB_REPOS_DIR` or `DATA_TIER_0_GIT_DIR` always wins and turns the mode off (`blockedByEnv`).
- **No network, no remote**: while active, `_autoCloneDataTier0` (startup, after a vault unlock) returns `{ skipped: 'sample-mode' }`, `_cocreatePushDataFile` (Academy autopublish) answers the sync state `{ state: 'skipped', reason: 'sample-mode' }`, `_repoRefreshRemote` skips data-tier-0, `check-update` answers `hasUpdate: false`, and `GET /api/prototypes/deploy-stream` is refused like a sync operation. Enter refuses (`already-active`) while on, and copies into a temp sibling before swapping.
- **Academy storage**: `_cocreateStorageReady()` treats the copy as storage (it has no clone and needs none), so progress and the mural read and write there; publishing is the skip above.
- **Static URLs** under `/data-sub-repositories/ds-data/` are served from the copy (the browser reads team data over HTTP).
- **Sync refusal**: `_sampleModeRefusesSync` runs in the router before any dispatch; every `data-tier-0` operation except `status` and `check-update` answers 409 `sample-mode`, on both the legacy and the `/api/data/<repoId>/<op>` paths.
- **Test mode**: the marker is honoured, and enter/leave work, only when `SAMPLE_DATA_DIR` is set, so no suite reads or writes a developer's real `data/`.

## Client

`js/sample-mode-helpers.mjs` (pure: status, copy, confirm), `js/sample-mode.js` (DOM, requests, restart), the badge slot `#topbar-sample-root` in `index.html`, the button in the wizard's first card. While active, `html[data-sample-mode="1"]` hides the Sync and End of day pills and module sync bars say "Sample data - a fictional team. Nothing is synced."

## The generator

`node scripts/sample-team.js [--out <dir>]` writes `<dir>/ds-data/` (default `examples/sample-team`). Seeded random generator, fixed clock, no network, Node built-ins only. Where a catalog module owns the file shape it calls that module's own builder (sprint stats, time log, costs, on-call, sprint review and planning, locations, usage analytics, DevOps stats). `tests/test_sample_team.mjs` checks determinism, that the committed tree is current, that every `dataRepos` path of every catalog module has data, that each module's own route reads it, and that the text is ASCII with no real host. Every person is a fruit with a face (`assets/avatars/fruit-avatars.mjs`, shared with Mini Deck's `scripts/mini-deck-avatars.js` and the demo walkthrough), never initials or a photo. Roadmap discovery tasks sit with the person holding that role and log time by day up to the fixed clock; Academy progress is one file per person in the server's shape.

## Known limits

- `rollout-waves` and a few widgets compute "today" from the real clock, so waves read as live and "this week" tiles may be empty.
- The Sync status rows still say "not cloned" (true: there is no clone).

Tests: `tests/test_sample_team.mjs`, `tests/test_api_sample_mode.js`, `tests/test_sample_mode_helpers.mjs`.
