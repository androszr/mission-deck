# Prototypes: build, preview, publish

Detail behind the "Prototypes" rules in `CLAUDE.md`. `CLAUDE.md` keeps the rules; this file keeps
the reasoning. Add new detail HERE and at most one line to `CLAUDE.md`.

## Where prototypes live

A prototype is a React screen in the team data repo: `data-sub-repositories/ds-data/prototypes/<id>/`
(`index.tsx`, `styles.css`, `spec.json`, optional `compliance.json`, `assets/` with sub-folders; a briefing also `content.json` and `recording.json`), registered in
`prototypes/prototypes.json` (`{ items: [...] }`). The id always comes from `POST /api/prototypes`,
which also stages the starter of the chosen kind (see "Kinds and starters"). The `_prototypes` row of `SYNC_CORE_SCOPES` owns
`prototypes/` in the sync window.

## The build shell

A React prototype does not render on its own: it needs a BUILD SHELL, a small Vite + React project
in which the prototype loads as one lazy route (`data-sub-repositories/data-prototypes/`). It has
two origins:

- the SEED in `templates/prototype-build-shell/`, copied when there is no clone. It builds and
  runs a prototype LOCALLY and is never a git repository. It ships its own neutral
  `src/tokens.css`, the viewer (`BreakpointViewer`: width presets, the "Demo states" picker, the
  Analytics menu and the `?chrome=0` / `?w=` switches), a default
  `src/prototypes/_shared/demo-state.ts` and `analytics.ts`, the shared layer (`src/ds/`,
  `src/components/`, `src/recorder.ts`, see "The seed's shared layer"); a team may override `ds/`,
  `components/` and `_shared/` from team data, which `_protoSyncSharedDeps` copies over the shell
  before every preview and publish.
- a CLONE of the repository named by `PROTO_BUILD_REPO_URL` (env-only, no default). Only a clone
  can publish: publishing is a commit and a push there, and whatever hosting watches it (GitHub or
  GitLab Pages, Cloudflare Pages, Netlify, ...) serves the result under `PROTO_PAGES_BASE_URL`.

`PROTO_DEPLOY_TOKEN` (optional, vault item `COCKPIT-PROTO-DEPLOY`) authenticates HTTPS pushes.
It never becomes part of a stored address: every remote git call in the shell receives it through
a one-command `-c url.<with token>.insteadOf=<without>` in `_protoGitExec`, and a clone whose
`remote.origin.url` carries credentials is rewritten to the bare address
(`_protoStripUrlCredentials`) on its first remote operation. Without a token git uses the
machine's own credentials.

## Kinds and starters

`POST /api/prototypes` takes an optional `kind`: `desktop` (the default; application frame with a
side menu), `mobile` (phone frame with tabs), `briefing` (self-playing presentation) or `blank` (one
empty screen, no frame). `PROTO_KINDS`, `PROTO_KIND_FRAME` and `_protoKindOf` are in `server.js`;
the starters are `templates/prototype/starter/<kind>/` (`PROTOTYPE_STARTER_DIR` names the parent).
`_protoStageStarter` copies every file of the kind except `README.md` (documentation of the template)
and `spec.json` (generated, with `frame`: `app`, `phone`, `none`, `none`), substituting
`{{PROTO_NAME_JSON}}` and `{{PROTO_ID}}` in `index.tsx` only, atomically (temporary folder, one
rename). `kind` is written to the registry ONLY when the request named one: an entry without it reads
as `desktop`, no read or update path writes it back, and `PUT` ignores it (it chose the starter).
`GET /api/prototypes` returns `kind` only when stored, which is why the card shows a badge only then.
An unknown kind is `400 invalid-kind`. Every starter applies a demo state by remounting (the screen
is keyed on the id `useDemoState` returns and starts from the scenario's initial state) - never an
effect that sets state, which the shell's hooks 7 lint rejects.

## The seed's shared layer

The seed ships what a prototype builds with: the DS adapters `src/ds/` (button, card, input, table,
tabs, modal, sheet, toast, icon ...), the neutral frames `src/components/` (`AppFrame`, `PhoneFrame`,
`NotInPrototype`; brand, icon, persona and menu are props), `src/prototypes/_shared/analytics.ts`
and `src/recorder.ts`. `src/ds/tokens.css` is an ALIAS layer: every kit token name the shell does not
define is `var(--<shell token>)`, so retuning `src/tokens.css` retunes the kit. Nine names exist in
the shell with another value (`--radius-l`, `--text-base`, `--text-2xl`, `--text-3xl`, `--lh-xs`,
`--lh-base`, `--lh-xl`, `--lh-2xl`, `--lh-3xl`); the kit layouts use them as `--proto-<name>` instead
of redefining a shell token. `DSIcon` is a CSS mask over `/ds-icons/<slug>.svg` painted with
`currentColor`; `ICONS` maps an adapter name to a slug of `assets/icons/ds/manifest.json` (icons the
set lacked were added with `source: prototype-lab-kit:<name>`).

A clone never re-reads the seed, so `_protoEnsureShellSharedSeed` runs before every preview and
publish (before `_protoSyncSharedDeps`, so a team's own copy still wins): a seed file ABSENT from the
shell is copied, never overwritten; a file is replaced only when its sha256 is on the frozen
`PROTO_SEED_UPGRADES` map (an untouched earlier seed version: `BreakpointViewer.tsx`, its css,
`App.tsx`, `demo-state.ts`); any other differing file is a team's edit, is kept and yields one warning
line naming what will not work; nothing is deleted. `public/ds-icons/` is filled from
`assets/icons/ds/` the same way. `package.json` gets `devDependencies.playwright` only when absent and
no `package-lock.json` would go stale. The publish commit names `public/ds-icons/`, the viewer files
and `src/recorder.ts` (`_protoPublishAddPaths`), and the quarantine treats the seed's files as sources
so the adapters are never moved out as orphans.

## Analytics contract and the viewer

Every screen, step and window root carries `data-track-screen="Area > Screen"`; a DS layer carries
`trackScreen` (layers render outside the screen's subtree). `track(event, props)` calls
`window.analytics?.track`. The viewer installs `src/recorder.ts`: events and clicks (grouped by the
nearest `data-track-screen`, else "unknown screen") live in memory of the tab only and are listed in
the viewer's "Analytics" menu; nothing leaves the browser. The viewer reads `?state=`, `?w=<px>`
(an exact width that wins over the stored preset and is written on a preset click) and `?chrome=0` (the
bare prototype, no toolbar) through one parser, and keeps `data-proto-canvas` on the canvas in both
modes. Floating layers render into `[data-proto-overlay-root]` inside the canvas.

## Nested assets

`_protoCopyAssets` copies `assets/` recursively to `src/prototypes/<slug>/assets/` (so `./assets/...`
imports and `import.meta.glob` resolve through Vite) and to `public/proto-assets/<slug>/` (URL
references, kept for existing prototypes); `_protoPublishPairs` lists every file for both destinations,
so the stale-source guard and the narrow commit see all of them.

## The recording tool and briefings

A briefing is a prototype of kind `briefing`: `content.json` (chapters and steps; the caption is the
narration script, read by browser speech synthesis) plus `recording.json` (the steps to record).
`scripts/proto-record.mjs` opens the source prototypes bare (`<base>/<slug>?chrome=0&state=<state>`) in
the shell's own Playwright and writes a JPEG per frame plus a `<step>.json`; `scripts/proto-build-content.mjs`
copies them into `assets/frames/` and writes `frames` and the camera, cursor and event tracks
(`motionFor`) into `content.json`. `--check-frames` opens the built briefing and fails when no picture
is on the page, one did not load or the page raised an error. The browser is `PW_CHROMIUM_PATH`, else a
Chromium found under the folder `scripts/_playwright-paths.js` names; the shell's `playwright` pin must
equal `PLAYWRIGHT_VERSION` in `scripts/bootstrap-playwright.js` (a test guards it). The three example
prototypes (`examples/prototypes/`: dispatch console, technician app, operations briefing) are copied
byte for byte into the sample team data by `scripts/sample-team.js` (`writePrototypes`), frames
included. Workflow: the `/briefing` skill.

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
copies (`./styles.css`, top-level `*.json`, `assets/` with its sub-folders). A prototype may load its
own pictures by pattern with `import.meta.glob('./assets/...')` (`GLOB_RE`): the pattern is a
specifier too and must stay inside `./assets/` (no `..`), for the server, the gate and preflight P4. The library exception is
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
checks a `/prototype` plan (P1-P19).

The kit rules of the gate (React): `screen-marker` (BLOCK: hash routing or a DS layer with no
`data-track-screen`; WARN: a `DSModal` / `DSBottomSheet` without `trackScreen`), `spec-id` (BLOCK: `id`
not equal to the folder, `frame` outside `app` / `phone` / `none`), and WARNs `screen-deep-link`,
`own-switcher`, `analytics-missing`. `<DSIcon name>` passes for a manifest slug or a key of the seed's
`ICONS`; tokens of the seed's `ds/tokens.css` are known. A prototype that existed before a rule is
excused with `--baseline`; the rules are line-free so the fingerprints stay stable.
`scripts/proto-shell-check.js --prototypes <dirs> --out <tmp>` is the clean build check: it copies the
seed to a throwaway shell, stages the prototypes with the server's own helpers (the same ones the
preview uses), runs `npm install`, `eslint .`, `tsc -b` and `vite build`, and asserts the built
bundle holds the prototypes' pictures. Its optional `--check-frames <id>` serves `dist` with
`vite preview` and runs the frame smoke of `scripts/proto-record.mjs`.

## Demo export

The demo presentation can be published as an ordinary prototype: `scripts/demo-export.js` writes
the iframe wrapper (`templates/prototype/demo-export/`), a merged `spec.json` and a flat `assets/`
with every URL rewritten. After any change in `demo/`, re-run the export, send the team data, then
publish - publishing first answers `stale-source`.
