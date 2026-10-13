# Prototypes: build, preview, publish

Detail behind the "Prototypes" rules in `CLAUDE.md`. `CLAUDE.md` keeps the rules; this file keeps
the reasoning. Add new detail HERE and at most one line to `CLAUDE.md`.

## Where prototypes live

A prototype is a React screen in the team data repo: `data-sub-repositories/ds-data/prototypes/<id>/`
(`index.tsx`, `styles.css`, `spec.json`, optional `compliance.json`, `assets/`), registered in
`prototypes/prototypes.json` (`{ items: [...] }`). The id always comes from `POST /api/prototypes`,
which also stages the starter (`templates/prototype/starter/`: one generic screen with four demo
states, no frame and no design-system package). The `_prototypes` row of `SYNC_CORE_SCOPES` owns
`prototypes/` in the sync window.

## The build shell

A React prototype does not render on its own: it needs a BUILD SHELL, a small Vite + React project
in which the prototype loads as one lazy route (`data-sub-repositories/data-prototypes/`). It has
two origins:

- the SEED in `templates/prototype-build-shell/`, copied when there is no clone. It builds and
  runs a prototype LOCALLY and is never a git repository. It ships its own neutral
  `src/tokens.css`, the viewer (`BreakpointViewer`: width presets and the "Demo states" picker) and
  a default `src/prototypes/_shared/demo-state.ts`; a team may override `_shared/` from
  `ds-data/prototypes/_shared/`, which `_protoSyncSharedDeps` copies over it before every preview
  and publish.
- a CLONE of the repository named by `PROTO_BUILD_REPO_URL` (env-only, no default). Only a clone
  can publish: publishing is a commit and a push there, and whatever hosting watches it (GitHub or
  GitLab Pages, Cloudflare Pages, Netlify, ...) serves the result under `PROTO_PAGES_BASE_URL`.

`PROTO_DEPLOY_TOKEN` (optional, vault item `COCKPIT-PROTO-DEPLOY`) authenticates HTTPS pushes.
It never becomes part of a stored address: every remote git call in the shell receives it through
a one-command `-c url.<with token>.insteadOf=<without>` in `_protoGitExec`, and a clone whose
`remote.origin.url` carries credentials is rewritten to the bare address
(`_protoStripUrlCredentials`) on its first remote operation. Without a token git uses the
machine's own credentials.

## Local preview

`POST /api/prototypes/local-preview/<id>` (`handlePrototypeLocalPreview` -> `_protoLocalPreviewRun`)
stages the sources into the shell, makes sure `node_modules` is healthy and starts (or reuses) a
Vite dev server. The install is single-flight per process (`_protoEnsureNodeModules` over
`_protoEnsureNodeModulesOnce`): a second click during a cold install waits on the same promise
instead of starting a parallel `npm install` in the same directory. The progress modal polls
`GET /api/prototypes/local-preview-status?id=` (phase `prepare` / `install` / `libs` / `vite` plus
the shared install state). `_protoEnsureViteRunning` restarts only its OWN recorded PID when a
config file is newer than the marker's `startedAt` (`_protoViteIsStale`); a marker with no PID is
a foreign server and is never touched. A 200 is not a compile gate - Vite's dev transform never
type-checks; `npx tsc -b` in the shell is.

## Imports and libraries

One import allowlist lives in `scripts/_proto-imports.js`, required by `_protoValidateTsx`, by the
`react-import` rule of `scripts/check-proto-ds.js` and by preflight P4, so the server and the gates
never give one file two verdicts. Local specifiers are limited to what `_protoStageSources`
copies (`./styles.css`, top-level `*.json`, `assets/`). The library exception is
`@bryntum/scheduler(-react|-trial)` plus `write-excel-file`, `jspdf` and `html2canvas`;
`_protoEnsureLibraryDeps` installs a missing export library (pinned by `PROTO_LIBRARY_PINS` only
when undeclared) and never installs a licensed `@bryntum/*` package (503 `deps-missing`).

## Publishing

`GET /api/prototypes/deploy-stream?id=<id>[&force=1]` (`handlePrototypeDeployStream`, modal
`js/proto-deploy.js`): clone or sync the shell, two guards, rewrite of the sources, ESLint,
production build, commit, push. Without `PROTO_BUILD_REPO_URL` it answers `no-remote`.

- **Stale-source guard** (`_protoPublishedGuard`, verdict `protoDeployStaleVerdict`). Runs after
  the shell sync and before any write. For every file the publish rewrites (`_protoPublishPairs`)
  whose published blob differs from the local plaintext, the published content is re-encrypted
  deterministically and looked up in the team data mirror's history (`_protoContentInMirrorHistory`,
  `git log --find-object`). Not found means somebody published from a machine that never synced its
  data; sending the local copy would erase that work, so the stream answers `stale-source`. Unknown
  (no mirror, no key, shallow clone) counts as not found. `force=1` is sent only from the modal's
  "publish anyway" button; ESLint and the build are never forced.
- **Unsent-source guard** (`_protoUnsentPublishFiles`). A publish file still pending in the team
  data refuses with `unsent-source` and no override: the hosting must never run ahead of the shared
  repository. The modal offers "send data and publish".
- **Narrow commit.** `_protoPublishAddPaths` names exactly the prototype's paths, the generated
  files, the shared dirs and the shell manifests (`PROTO_PUBLISH_SHELL_FILES`), never
  `git add src/ public/`; `_protoNarrowGeneratedForPublish` regenerates `registry.ts` and
  `prototype-codes.ts` from HEAD plus the published slug before the gates.
- **Quarantine.** Lint and build read the whole shell, so untracked preview copies of other
  prototypes and orphan files of the shared dirs are moved into `data/proto-preview-quarantine/`
  for the duration of the gates (`_protoQuarantineUntracked`) and restored in a `finally`; never
  overwritten, never deleted, healed by the next publish after a crash (`_protoQuarantineRecover`).
  `protoGateErrorHint` names the first file with an ERROR.
- **Shell sync.** `_protoShellSyncWithOrigin` parks every file changed both locally and upstream in
  a named stash before `pull --rebase`, and refuses with `shell-conflict` when an unmerged path is
  left - git's exit code is never the gate (rule `proto-shell-autostash`).
- `PROTO_DEPLOY_DRY_RUN` skips the push only for `1`/`true`/`yes`. A successful `done` carries
  `unsynced` (pending team data files), shown under the success callout.

Covered by `tests/test_proto_deploy_guard.mjs`, `tests/test_proto_deploy.mjs`,
`tests/test_proto_shell_sync.mjs`, `tests/test_proto_quarantine.mjs`, `tests/test_proto_imports.mjs`,
`tests/test_proto_shell_upkeep.mjs`, `tests/test_proto_build.mjs`, `tests/test_check_proto_ds.mjs`
and `tests/test_proto_preflight.mjs`.

## Gates

`scripts/check-proto-ds.js <dir>` is the design-system gate: hardcoded colours, unknown tokens
(resolved against the shell's `tokens.css` and `css/ds-tokens.css`), unknown icon and illustration
slugs, the import allowlist, the React contract and the custom-element registry. `--baseline <json>`
blocks only NEW findings for an EXISTING prototype (fingerprints over rule, file, message and a
normalised snippet); a new prototype never gets a baseline. `scripts/proto-preflight.js <plan>`
checks a `/prototype` plan (P1-P17).

## Demo export

The demo presentation can be published as an ordinary prototype: `scripts/demo-export.js` writes
the iframe wrapper (`templates/prototype/demo-export/`), a merged `spec.json` and a flat `assets/`
with every URL rewritten. After any change in `demo/`, re-run the export, send the team data, then
publish - publishing first answers `stale-source`.
