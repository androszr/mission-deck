---
name: prototype
description: >-
  Plans and builds a screen prototype. A new prototype is React (index.tsx with a
  default export, breakpoints, demoStates) + styles.css (design tokens,
  @container proto) + spec.json, in the team data repo
  `data-sub-repositories/ds-data/prototypes/<id>/` - exactly the path and the
  `{ items: [...] }` registry the "Design -> Prototypes" screen reads. The id
  always comes from `POST /api/prototypes`, never invented. The older `render.js`
  contract (no React) is still supported for maintenance, never for a new
  screen. Use when the user says "prototype", "mockup", "add a screen to the
  prototype", names a prototype id or invokes /prototype. Light flow: planner ->
  frontend-implementer -> proto-ds-guardian + blind on-disk verification ->
  Playwright with screenshots. No backend, tests or lead review. Never runs git
  in the data repo - the user syncs through the app's Sync bar.
---

# Prototype

> **TL;DR:** The prototype-only sibling of `/new-idea`. Overwatch plans, Mira builds, Quiet
> enforces the DS catalog and the prototype contract, Ledger verifies the ACs on disk,
> Proxy drives the browser and captures screenshots, Relay patches gaps. No Vex (backend),
> no Watch (tests), no Nyx (lead) - a prototype has none of those layers. Prototypes live in
> the team data repo clone `data-sub-repositories/ds-data/prototypes/<id>/` - the SAME
> registry (`prototypes.json`, `{ items: [...] }`) and directory the "Design -> Prototypes" screen
> reads. Every edit is a filesystem write there, NEVER a git operation - the user syncs through the
> app's Sync bar. The contract is summarised below; the gates are `scripts/check-proto-ds.js` and
> `scripts/proto-preflight.js`.

## Args

`/prototype <idea>` - optional. May name a prototype id or just describe the change. Empty -> ask
once for the idea.

## The prototype contract

Summary:

| File | Role |
|---|---|
| `index.tsx` | React 18 function component, `export default`, `export const breakpoints: number[]` (built widths from `[375, 768, 960, 1280, 1536, 1920]`), `export const demoStates: DemoStateDef[]`. Imports only from `react`, `./styles.css`, `../_shared/*` (`demo-state` ships with the build shell), the optional team layers `../../ds` (component adapters) and `../../components`, plus the named library exception - schedulers = `@bryntum/scheduler` (`-react`, `-trial`), export = `write-excel-file`, `jspdf`, `html2canvas`. The ONE list is `scripts/_proto-imports.js` (read by both `_protoValidateTsx` in `server.js` and `scripts/check-proto-ds.js`); do not restate it elsewhere. No sibling `.ts`/`.tsx` file - the pipeline copies only `index.tsx` + `styles.css`. |
| `styles.css` | Own `.<id>-*` rules. Tokens from the build shell (`templates/prototype-build-shell/src/tokens.css`) and the app tokens it receives (`css/ds-tokens.css`), zero hex. `@container proto (min-width: ...)` - NEVER `@media`, the canvas can be narrower than the browser window. |
| `spec.json` | Scope source of truth: `{ id, title, summary, updated, scope: [{ title, items[] }], releases: [{ date, note }], customElements: [{ name, reason, note, lead_confirmed, owns? }], figmaSource?, figmaDeviations? }`. `figmaDeviations[]` = `{ frameId, screen, what, why, decidedBy: "user", date }`, one per user-approved departure from the Figma. Mandatory both modes. |
| `compliance.json` | Only for requirements-driven prototypes: `{ source, groups: [{ title, requirements: [{ id, text, status, coverage, gap, shots[] }] }] }`. |
| `assets/*.png` | Screenshots captured in Phase 6g, copied from `user-data/screenshots/`. |
| `../prototypes.json` | Registry `{ items: [{ id, name, area, owners, created_at, updated_at, discoveryTaskId? }] }` - the SAME file and shape `POST /api/prototypes` writes; `id` always comes from that endpoint, never invented locally. |

The older `index.html` + `render.js` + `styles.css` contract (no React, tokens from
`css/ds-tokens.css`/`css/ds.css` host DS) is still supported, but no prototype in the data uses it
by default. Maintaining one
that comes back from an archive is allowed; a NEW prototype is always React -
`node scripts/check-proto-ds.js <dir>` detects the format from the presence of `index.tsx` and
never expects `render.js`/`index.html` from a React build.

DS source of truth for React: the build shell's tokens plus, when the team provides them, the
adapters in `../../ds` and `../../components`. The design-system catalog the app ships stays the
source of truth for component SHAPE that the guardian mirrors against; `css/ds.css` /
`css/ds-tokens.css` are the app HOST's own DS - read-only here, never the prototype's source.
Preview and local build: the `local-preview` and `deploy-stream` endpoints in `server.js`
(publishing needs `PROTO_BUILD_REPO_URL` and `PROTO_PAGES_BASE_URL` in `.env`).

## Automation

| Step | Command |
|---|---|
| Plan preflight (4.5) | `node scripts/proto-preflight.js <plan> --json` (the 20 generic rules plus P1-P17) |
| Plan render (4.6, 7) | `node scripts/plan-to-html.js <plan>` |
| DS baseline (before 6, existing prototype only) | `node scripts/check-proto-ds.js <prototype_dir> --json > user-data/proto-baselines/<id>.json`, plus a copy of `index.tsx` + `styles.css` into `user-data/proto-baselines/<id>/` |
| DS linter (6e, hard gate) | new prototype: `node scripts/check-proto-ds.js <prototype_dir> --json`; existing: `node scripts/check-proto-ds.js <prototype_dir> --baseline user-data/proto-baselines/<id>.json --json` (blocks only NEW findings) |
| Type check (6, 6g) | `cd data-sub-repositories/data-prototypes && npx tsc -b` (only once the shell clone exists; writes `*.tsbuildinfo`) |
| Local preview (6g) | `curl -s -X POST http://localhost:3001/api/prototypes/local-preview/<id>` |
| Handoff (7) | `node scripts/plan-status.js <plan> --status <s> --ac "..."` |

## Agent spawn visual convention

Same as `/new-idea`: the `PreToolUse` hook on `Agent` (`scripts/hook-agent-banner.js`) shows the
banner from `prototype/banners/` before every `Agent({...})` call - one single banner per call,
so the 6e+6f parallel spawn shows Quiet and Ledger one under the other. Do not run
`scripts/agent-banner.js` for a spawn and do not paste a banner yourself. The ONE banner you still
render and paste is `intro` in Phase 0: it precedes no agent, so no hook fires for it -
`node scripts/agent-banner.js prototype/intro`, pasted as a fenced code block.

| Agent | Phase | Banner |
|---|---|---|
| Proto Lab (intro) | 0 | `intro` (no agent) |
| Overwatch (planner) | 4 | `planner` -> `idea-planner` |
| Mira (frontend) | 6 | `frontend` -> `frontend-implementer` |
| Quiet (proto-ds-guardian) | 6e | `guardian` -> `proto-ds-guardian` |
| Ledger (verifier) | 6f | `verifier` -> `ac-verifier` |
| Quiet + Ledger | 6e+6f parallel | `parallel-guardian-verifier` |
| Proxy (playwright) | 6g | `playwright` -> `playwright-specialist` |
| Relay (gap fix) | retry | `gapfix` -> `frontend-implementer` |

## Phases

### Phase 0: bootstrap

1. Print the `intro` banner.
2. `ls data-sub-repositories/ds-data/ 2>/dev/null` - the team data repo must be cloned
   (the Sync window in the app does that). Missing -> tell the user to sync the team data first
   and stop.
3. `mkdir -p data-sub-repositories/ds-data/prototypes` is fine (a directory, not a git
   operation). Missing `prototypes.json` -> normal (nothing created yet); the first
   `POST /api/prototypes` (Phase 6) creates it.

### Phase 1: identify the prototype and its mode

1. Capture the idea. Resolve `prototype_id` from the idea or from
   `ls data-sub-repositories/ds-data/prototypes/`; ambiguous with several existing -> ask
   which. **A brand-new prototype is created NOW, not planned as a future step:** call
   `POST http://localhost:3001/api/prototypes` with `{ "name": "<short name>" }` (server
   must be reachable - Phase 6g's restart recipe applies here too if it is not). The response's
   `item.id` is the canonical `prototype_id` from this point on; the server already staged the
   React starter (`index.tsx`, `styles.css`, `spec.json`) into
   `data-sub-repositories/ds-data/prototypes/<id>/` atomically - if `starter` comes back
   `missing-template`, stop and tell the user the starter template is not deployed yet (do not
   hand-write one). The rest of this skill plans and builds the REAL scope on top of that starter,
   never a second parallel registry or a locally invented id.
2. **`prototype_format`** (existing prototype only - a new build is always `react`): `index.tsx`
   present -> `react`; only `render.js` present -> `vanilla` (legacy, maintain-only). Read
   `export const breakpoints` from whichever file exists.
3. `prototype_mode`: `requirements-driven` when `compliance.json` exists with requirement entries
   or the user supplies a requirements document, or step 5 finds a `confluence` / `knowledge-base`
   requirements link on the initiative; otherwise `spec-driven` (the default for a new prototype).
4. **Reference selection (optional).** When the team data carries a reference-screen catalog
   (`data-sub-repositories/ds-data/reference-screens/manifest.json`, `projects[].pages[].screens[]`,
   each `{ name, desc, file, platform }`), read ONLY the manifest and match on its text, never by
   opening the PNGs here. Offer the top matches with one `AskUserQuestion` (always with an explicit
   "none" option) and record `matched_reference_screens` and `reference_intent`
   (`rebuild` | `inspire` | `none`). No manifest -> ask once whether the user has a reference (an
   existing prototype, a Figma link, a description) or builds from scratch; record the answer as
   `matched_reference_screens: manual - <answer>` or `none`. Never block on it.
5. **Initiative and Jira context (`jira_context`).** Read the prototype's `discoveryTaskId` from
   `prototypes.json`; when present, read
   `data-sub-repositories/ds-data/discovery-tasks/<discoveryTaskId>.json` and take `title` (the initiative),
   `links[]` (`{ type, label, url }`, `type` one of `confluence`, `figma`, `knowledge-base`,
   `meeting`), `ticket` (the Jira epic key) and `jiraTasks[]`. A `confluence` or
   `knowledge-base` link also makes the mode `requirements-driven` (step 3). For the epic and each
   `jiraTasks[]` key relevant to the scope call
   `curl -s "http://localhost:3001/api/jira/issue-detail?key=<KEY>"` - description, status,
   comments, issue links and subtasks; the endpoint does not return attachments, so name the
   attachments as absent rather than guessing them. The Jira token stays in the server process:
   never export it to the shell, never call Jira directly, never read `/api/bitwarden/*` for it.
   Fail open - `503 token_missing` (vault closed), `502` (Jira unreachable, usually the VPN), no
   `discoveryTaskId` or no `ticket` -> record the gap in one line, set `jira_context: none` and
   continue.
6. **Figma reference (`figma_reference_dir`) - mandatory when a Figma link exists.** Collect links
   from the idea text (any `figma.com` URL), `links[]` entries with `type: 'figma'` (step 5) and the
   existing `spec.json` `figmaSource` (`fileKey`, `referenceNodeId`, `nodeIds[]`, `fileUrl`). No
   link anywhere -> `figma_reference_dir: none`, continue silently. Otherwise:
   - **The ingest is the Figma reference extractor**,
     `scripts/figma_reference.py` (Figma REST API, Python standard library only), run by the server
     behind `GET /api/figma-reference/stream?file=<fileKey>&node=<nodeId>&id=<prototype id>[&scale=1|2][&overwrite=1]`
     (SSE: `progress`, `log`, `done`, `error`). `FIGMA_TOKEN` lives in the server's heap and reaches
     the child as ONE JSON line on stdin - the skill never exports it and never calls
     `api.figma.com` itself. The `figma-remote` MCP (`get_metadata`, `get_design_context`,
     `get_screenshot`) is NOT the ingest any more: a whole section overflows its size limit and its
     dev-mode tree is truncated for big frames; use it only to spot-check ONE frame the extractor
     flagged.
   - **Layout** of `user-data/figma-reference/<id>/` (gitignored, never inside `prototype_dir`):
     `frames.json` (per frame in scope `{ frameId, name, width, height, platform, section,
     lastModified, fileKey }`), `section-<slug>.md` (the layout tree of one section: per node
     direction, `W x H`, `gap`, `pad`, radius, background, `[inst]` for a component instance, plus
     a `### Text elements` table of style / exact string / colour), `screenshots/<frameId>.png`,
     and `token-map.md` (every hex in the trees -> the app token or build-shell token that
     expresses it, resolved against `css/ds-tokens.css` and
     `templates/prototype-build-shell/src/tokens.css`; `NO-MATCH` when none does). Format and consumption rules: `.claude/agents/references/figma-fidelity.md`.
   - **Freshness.** `curl -s "http://localhost:3001/api/figma-reference/status?id=<id>"` answers
     `exists`, `fileKey`, `nodeId`, `figmaLastModified` and `fetchedAt`. The reference is fresh when
     `exists` is true and it was taken for the same `fileKey` and node; the Figma side has no cheap
     "changed since" probe here, so when the user says the design moved, re-ingest with `overwrite=1`.
   - **Missing or stale -> ingest now:** `curl -sN -H 'Origin: http://localhost:3001'
     "http://localhost:3001/api/figma-reference/stream?file=<fileKey>&node=<nodeId>&id=<id>&scale=1&overwrite=1"`
     and relay the `progress` lines; `done` carries the frame and section counts. A reference made for
     another file or node is refused with `scope-mismatch` unless `overwrite=1`. The node is the
     section or page in `spec.json` `figmaSource.referenceNodeId` (or the node in the link).
     Output: `frames.json`, `index.md`, `section-<slug>.md`, `typography.md`, `colors.md`,
     `components.md`, `layout.md`, `token-map.md`, `hygiene.json`, `screenshots/`.
   - **Refusals** (`no-token` - vault closed, `no-python`, `busy`, `test-mode`, `script-failed`) ->
     `AskUserQuestion`: (a) "Fix and retry" (Recommended - open the vault / retry once),
     (b) "Build without the Figma reference". Only an explicit (b) is a waiver: record
     `figma_reference: WAIVED by user (<date>)` and pass it to the planner. Never waive on your own.
7. **Registered deviations (`figma_deviations`).** Whenever `spec.json` carries `figmaDeviations[]`
   (with or without an ingested reference), read it and pass the entries
   for the touched screens to the planner. Entry shape:
   `{ frameId, screen, what, why, decidedBy: "user", date }`. These are USER-approved product
   decisions: no plan, build or audit re-flags them or silently "fixes" them back to the Figma. A
   NEW deviation is added only in Phase 6g after `AskUserQuestion`.
8. **Shared-component boundary.** If the idea needs a change in `../../ds`, `../../components`,
   `prototypes/_shared/`, `css/ds*.css`, `js/`, `index.html`, `server.js` or the catalog, it is not
   prototype work - it affects the whole cockpit or every prototype. `AskUserQuestion`: route to
   `/new-idea` (recommended) or re-scope to a prototype-local approximation (own markup + own
   `styles.css`, shared files untouched).

### Phase 2: light interview

One or two `AskUserQuestion` calls at most: the breakpoints touched (a subset of
`[375, 768, 960, 1280, 1536, 1920]`, or mobile / desktop / both - answer from the existing
`export const breakpoints` when unambiguous), the demo-state matrix to add or extend (baseline,
every new screen, empty / loading / error, every open layer - popover, sheet, menu, modal; default
to deriving it from the scope and ask only when it stays open), and, only when
requirements-driven, which requirement **Etap** this addresses - the source of truth is the
Confluence **Etap** column of the requirements page, NOT the "Priorytet" label of a local markdown
copy (the two can disagree); spec-driven skips this question entirely and invents no requirements.
"Go with your recommendations" -> apply defaults and exit.

### Phase 3: plan path

Slug `proto-<id>-<change>` (<=40 chars, ASCII). Path `plans/<YYYY-MM-DD>-<slug>.md`, collision ->
`-2`. Template: `.claude/skills/prototype/templates/plan-prototype.md`.

### Phase 4: planner

The spawn hook shows banner `planner`; then:

```
Agent({
  subagent_type: "idea-planner",
  description: "Plan (proto): <slug>",
  prompt: "Mode: new
Idea: <idea>
Surface: view (prototype)
Answers:
- <key>: <value>
plan_path: <absolute>
template_path: <absolute path to .claude/skills/prototype/templates/plan-prototype.md>
repo_map_path: <absolute path to .claude/skills/new-idea/templates/repo-map/overview.md>
conventions_path: <absolute path to .claude/agents/references/cockpit-conventions.md>
prototype_id: <id - from POST /api/prototypes for a new build, from Phase 1 for an existing one>
prototype_dir: data-sub-repositories/ds-data/prototypes/<id>/
prototype_format: <react | vanilla>
prototype_mode: <requirements-driven | spec-driven>
reference_intent: <rebuild | inspire | none>
matched_reference_screens: <from Phase 1 step 4, or `manual - <user answer>`, or `none`>
jira_context: <from Phase 1 step 5 - { ticket, title, links[], issues: [{ key, summary, description, status, comments[] }] }, or `none`>
figma_reference_dir: <from Phase 1 step 6 - `user-data/figma-reference/<id>/`, `WAIVED by user (<date>)`, or `none`>
figma_deviations: <from Phase 1 step 7 - relevant figmaDeviations[] entries as JSON, or `none`>
prototype_is_new: <true when Phase 1 created it with POST /api/prototypes, else false>
fidelity_ref: .claude/agents/references/figma-fidelity.md

Follow your 'Prototype plans' section: read the prototype on disk (index.tsx or render.js per prototype_format, styles.css,
spec.json) instead of relying on the repo map, plan only files inside prototype_dir, write grep ACs
against that directory (verified on disk, not in the diff), keep spec.json current in every plan,
compliance.json only when requirements-driven, extend demoStates (never replace) for prototype_format
react, and fill ## Visual verification (Playwright) with the preview URL. Every floating layer is a
DSPopover or DSDropdown. Any claim that an icon/component is absent from the catalog carries the
ls/grep evidence. Cite jira_context keys in ## Context when used. When figma_reference_dir is a real
path, fill the template's figma_reference blocks (per-screen frame id + section file + screenshot,
numbers lifted from the trees, colours through token-map.md, AC_FIG/AC_FID criteria, fidelity pairs).
Respect figma_deviations - never plan a 'fix' that reverts one; list NEW deviations explicitly for
the user's confirmation in Phase 6g."
})
```

`iterate` -> the same call with `Mode: iterate` plus `Feedback:`.

### Phase 4.5: preflight

`node scripts/proto-preflight.js <plan> --json`. Runs the 20 `/new-idea` rules (sections, status,
ASCII, hex, verifiable ACs, forbidden operations, git-in-sub-repo, business description) plus:
**Prototype format defaults to `react`** when the field is absent; `vanilla` only applies to an
existing legacy prototype and must be written out explicitly.

| Rule | Check | Severity |
|---|---|---|
| P1 | `**Prototype id:**` present and every path in `## Files to change` / `## New files` is inside `data-sub-repositories/ds-data/prototypes/<id>/` (or `prototypes.json`); `**Prototype format:** vanilla` must be written out explicitly for a legacy prototype | BLOCK |
| P2 | `## Visual verification (Playwright)` present, no unfilled `{{...}}` | BLOCK |
| P3 | `## Steps` mentions `spec.json`; when `**Prototype mode:** requirements-driven`, also `compliance.json` | BLOCK |
| P4 | no step proposes `import ... from '/js/` or a react import outside the allowlist in `scripts/_proto-imports.js` (libraries exception: Bryntum scheduler, write-excel-file, jspdf, html2canvas). A prose line that names `main.tsx` or the shell and not `index.tsx` describes the shell's OWN imports and is skipped (heuristic); name `index.tsx` on a line only when it really proposes a prototype import | BLOCK |
| P5 | no `@media (min/max-width` when `**Prototype format:** react` (BLOCK - must be `@container proto`); legacy vanilla stays WARN | BLOCK/WARN |
| P6 | `## Test plan` names `node scripts/check-proto-ds.js` | BLOCK |
| P7 | react format: `## Steps` covers `index.tsx`, `demoStates`, `useDemoState`, `breakpoints`, `../../ds` and `@container proto`; unsupported `**Prototype format:**` value | BLOCK (`demoStates`/`useDemoState` markers: WARN "migrate on next touch" when `<id>/index.tsx` already exists on disk without `demoStates`) |
| P8 | plan names an overlay (`DSBottomSheet`/`DSModal`) and puts `transform` on an ancestor (`text-transform` and `transform: none` do not count). A `transform` on a card INSIDE the modal is a known false positive, so the rule only warns - ignore it when the element sits inside the overlay and say so in the plan | WARN |
| P9 | claim "absent from the catalog" (`no icon`, `not in the catalog`, ...) with no `ls`/`grep` evidence | WARN |
| P10 | invented `min/max-width/height` with no layout-tree or `section-*.md` citation in the same step (`@container` queries exempt). A negation (`never`, `do not add`) silences only its own clause - split on `;`, `,` and ` and ` - so a px value in the next clause still warns | WARN |
| P11 | new desktop screen with no scroll-to-top on navigation | WARN |
| P12 | icon tinted through an `svg` selector, hand-rolled `mask` or `filter: invert` (`DSIcon` is a `currentColor` mask) | BLOCK |
| P13 | form control with no `:focus` / `:hover` state | WARN |
| P14 | `--state-*-border` token on a visible border (those tokens can be `transparent`) | WARN |
| P15 | custom element with no `ds/<file>:<line>` citation of the DS* props it mirrors | WARN |
| P16 | helper source file next to `index.tsx` (the shell stages only `index.tsx`, `styles.css`, `*.json`, `assets/`) | BLOCK |
| P17 | own demo-state switcher, `replaceState` or `PopStateEvent` (the shell owns the "Stany demo" selector) | WARN |

Any BLOCK -> show the abstract plus the BLOCK lines, prompt `iterate` / `stop`. WARN only -> one
line and continue. Re-run after every `iterate`.

### Phase 4.6: `node scripts/plan-to-html.js <plan>` (non-blocking).

### Phase 5: review loop

Print `## Business description` verbatim, then the abstract, then `accept` / `iterate` / `stop`, exactly
as `/new-idea` Phase 5.

### Phase 6: frontend implementation

No branch gate and no path decision - the prototype is not in this repo, so the current branch is
irrelevant and there is always one frontend slice. The starter files already exist on disk from
Phase 1's `POST /api/prototypes` (new build) or were already there (existing prototype); this
phase builds the plan's REAL scope on top of them.

**Iteration baseline (existing prototype only, BEFORE the first edit).** Most existing prototypes
do not pass the linter clean today (measured 2026-09-29: BLOCK on 10 of 12 React directories), so
"exit 0" would turn every one-screen fix into a whole-file migration. Capture the baseline once:
`mkdir -p user-data/proto-baselines/<id> && node scripts/check-proto-ds.js <prototype_dir> --json >
user-data/proto-baselines/<id>.json && cp <prototype_dir>/index.tsx <prototype_dir>/styles.css
user-data/proto-baselines/<id>/` - never inside `prototype_dir` (the team data is synced, so a
file there would show up as unsent). The two copied sources let the guardian's manual sweeps
and Proxy's INTERACTION pass judge only what this build changed (`diff` against the copy):
legacy hits in untouched code are reported as a count, never as a failure of this build. Every later gate on that prototype runs
`node scripts/check-proto-ds.js <prototype_dir> --baseline user-data/proto-baselines/<id>.json`
and blocks only NEW findings. A new prototype gets no baseline and no flag. Re-captured only on a
fresh `/prototype` run, never between a gap-fix and its re-check.

The spawn hook shows banner `frontend`; then:

```
Agent({
  subagent_type: "frontend-implementer",
  description: "Build proto: <slug>",
  prompt: "plan_path: <absolute>
conventions_path: <absolute path to .claude/agents/references/cockpit-conventions.md>
gitnexus_available: false
backend_contract: n/a
prototype_dir: data-sub-repositories/ds-data/prototypes/<id>/
prototype_format: <react | vanilla>
prototype_mode: <mode>
figma_reference_dir: <from Phase 1 step 6 - path, `WAIVED by user (<date>)` or `none`>
ds_baseline: <user-data/proto-baselines/<id>.json for an existing prototype, `none` for a new one>
fidelity_ref: .claude/agents/references/figma-fidelity.md

This is a PROTOTYPE plan - follow your 'Prototypes' section. Every write goes inside prototype_dir
(filesystem only, NEVER git there). READ fidelity_ref in full before the first screen - it is
mandatory, with or without a Figma reference (the Figma-only sections say so). React contract:
index.tsx (default export, export const breakpoints, export const demoStates wired through
useDemoState from ../_shared/demo-state, imports only from react/./styles.css/../_shared//../../ds/
../../components plus the named scheduler/export exception listed in scripts/_proto-imports.js) +
styles.css (design tokens, zero hex, @container proto not @media) + spec.json (mandatory) +
compliance.json (requirements-driven only) + the entry in ../prototypes.json (already created by
POST /api/prototypes - do not duplicate it). Interaction affordances and URL screen state are
part of the contract. Never add transform on an ancestor of
DSBottomSheet/DSModal. When figma_reference_dir is a real path work FIGMA-FIRST, screen by screen.
Respect spec.json figmaDeviations[]; a NEW deviation is flagged in your report, never self-approved.
Gate: `node scripts/check-proto-ds.js <prototype_dir>` exits 0 for a new prototype, or with
`--baseline <ds_baseline>` for an existing one (zero NEW BLOCK). Then, only when
data-sub-repositories/data-prototypes/ exists, `cd data-sub-repositories/data-prototypes && npx tsc -b`
after a successful local preview (writes *.tsbuildinfo, no git). Report changed files, which
companion artifacts you updated and any new Figma deviation you needed."
})
```

`blocked` -> Phase 7 with the failure surfaced.

### Phase 6e+6f: proto-ds-guardian + blind verifier (parallel)

Both always run. **Grep-AC fast path first:** when every non-`AC_VIS` AC is a runnable command,
run them with Bash against the directory on disk; all pass -> record `AC: PASS (n/n on disk)` and
skip Ledger, still spawn Quiet. Otherwise (the spawn hook shows one banner per agent) one message
with both calls:

```
Agent({
  subagent_type: "proto-ds-guardian",
  description: "Proto DS check: <slug>",
  prompt: "mode: review-impl
plan_path: <absolute>
prototype_id: <id>
prototype_dir: data-sub-repositories/ds-data/prototypes/<id>/
prototype_format: <react | vanilla>
changed_files: <files the implementer reported>
ds_baseline: <user-data/proto-baselines/<id>.json or `none`>
figma_reference_dir: <path, `WAIVED by user (<date>)` or `none`>

Run `node scripts/check-proto-ds.js <prototype_dir> --json` FIRST (with `--baseline <ds_baseline>`
for an existing prototype) and merge its findings verbatim, then do the semantic
component-mirroring review against the app's design-system catalog (mobile first), applying
.claude/agents/references/figma-fidelity.md:
re-run every catalog-absence claim with ls/grep, the dead-selector and token sweep (svg rules,
tokens resolving to transparent, :focus per control, hashed class names), floating layers through
DSPopover/DSDropdown, shells from ../../components, and the phone geometry. Skip every entry in
spec.json figmaDeviations[]."
})
Agent({
  subagent_type: "ac-verifier",
  description: "Verify AC (proto): <slug>",
  prompt: "plan_path: <absolute>
branch_name: <current branch>
prototype_dir: data-sub-repositories/ds-data/prototypes/<id>/

This is a PROTOTYPE plan: the build lives in prototype_dir, which is a separate data repo and never
appears in this repo's git diff. Verify every AC against the files on disk there. AC_VIS* are DEFERRED."
})
```

**Blind verifier contract:** Ledger's prompt carries only the plan path, the branch and the
on-disk instruction - never the implementer's report, the guardian's verdict or any "done" phrasing.

- Guardian `FAIL` -> the BLOCKs become a gap report for `frontend-implementer` (a `gap_report:`
  block at the start of a line in the prompt, the `/new-idea` shape - that line is what makes the
  spawn hook show `gapfix` instead of `frontend`; shared retry cap 2), then re-spawn the guardian.
- Verifier `FAIL` -> gap report, same retry loop, then re-spawn only the verifier.
- Every retry spawn (gap-fix implementer, re-spawned guardian, re-spawned Proxy) carries the SAME
  fields as its first prompt - `ds_baseline`, `figma_reference_dir`, `fidelity_ref` and, for Proxy,
  the same `prototype_url` - plus `gap_report`. A retry without `ds_baseline` falls back to a plain
  exit 0 and fails on findings the baseline already carried.
- Both `PASS` -> Phase 6g when any `AC_VIS` is deferred (always, for a real build).

### Phase 6g: Playwright visual verification + screenshots

Server check: `curl -s -o /dev/null -w '%{http_code}' http://localhost:3001/api/app/version`; not
200 -> `curl -s -X POST http://localhost:3001/api/settings/restart` and poll. Never `npm start`.

**Start the preview yourself - never take a URL from a report.** For a React prototype:

```
curl -s -X POST http://localhost:3001/api/prototypes/local-preview/<id>
```

The route uses `checkOriginNoBody`, so a bare `curl -X POST` with no body and no `Origin` passes.
It copies the sources into the build shell (a filesystem write, never git) and answers
`{ url }`, e.g. `http://localhost:<PROTO_VITE_PORT>/<slug>` (default port 5173 - take the URL from
the answer, never build it yourself). With `prebuilt: true` the prototype ships a ready bundle and
the URL already ends in `/<slug>/index.html` - pass it through unchanged. **Any non-200 (503, 400,
500) -> Phase 6g `blocked`** with the server's `message` quoted verbatim in the handoff (a 503
typically means a missing library or Vite did not start); do
not spawn Proxy against a guessed URL. After a 200, run the type check the preview does not do:
`cd data-sub-repositories/data-prototypes && npx tsc -b` - a failure goes to the gap loop like a
guardian BLOCK (Vite's dev transform never type-checks, so a 200 alone is not "it builds").

The spawn hook shows banner `playwright`; then:

```
Agent({
  subagent_type: "playwright-specialist",
  description: "Visual verify (proto): <slug>",
  prompt: "mode: visual-verify
plan_path: <absolute>
base_url: http://localhost:3001
prototype_url: <the `url` field of the local-preview answer above, unchanged>
prototype_dir: data-sub-repositories/ds-data/prototypes/<id>/
figma_reference_dir: <path or `none`>

Follow your 'Prototype target' section: open prototype_url, resize to each width in the plan's
breakpoints, walk ## Visual verification (Playwright) including every demoStates scenario the plan
lists (?state=<id> or the viewer's Stany demo control), take screenshots into
user-data/screenshots/ (the only path the capture tool may write), then COPY the files the recipe
names into <prototype_dir>/assets/ with the exact filenames the plan gives - that copy is a normal
filesystem write in the data repo, never git. Always run the INTERACTION pass and read every PNG
back; run the NUMERIC pass only when figma_reference_dir is a real path (figma-fidelity.md section
13). Skip every deviation registered in spec.json figmaDeviations[]. Report MAJOR and MINOR
discrepancies separately."
})
```

`FAIL` (any failing `AC_VIS*`, or any MAJOR fidelity or interaction discrepancy) -> visual gap
report to `frontend-implementer` (separate cap 2), re-spawn Proxy. MINOR discrepancies never fail
the phase - carry them to the Phase 7 handoff as a list of decisions for the user.

**New-deviation confirmation.** When the plan or the build proposed a NEW departure from the Figma,
confirm each one now with `AskUserQuestion`: (a) "Register the deviation" -> append
`{ frameId, screen, what, why, decidedBy: "user", date }` to `spec.json` `figmaDeviations[]` (a
filesystem write in the data repo), (b) "Fix to match the Figma" -> the gap loop. Never
register a deviation without the user's explicit choice.

### Phase 7: handoff

```
node scripts/plan-status.js <plan> --status done|partial|blocked --ac "AC1=pass,...,AC_VIS1=pass" \
  --iteration-note "Proto-DS: <PASS|FAIL>. Visual: <PASS|FAIL|n/a>. Fidelity: <PASS|FAIL|n/a> (<M> MAJOR / <m> MINOR). tsc -b: <PASS|FAIL|n/a>. Demo states: <N> (<id, id, ...>). Ref: <screen names + role, or none>. Figma ref: <figma_reference_dir, none or WAIVED>."
```

Then tell the user, making the sync step explicit:

> Prototype `<id>` built (status: `<status>`). Files in the local clone
> `data-sub-repositories/ds-data/prototypes/<id>/` (index.tsx, styles.css, spec.json,
> assets/). Also visible in **Design -> Prototypes** in the app - the same entry.
> **Sync through the Sync bar in the app** - Claude never runs git in the data repo.
> Local preview: `<url from Phase 6g>` (or the local preview button on the prototype screen).
> Publishing (when planned) is a separate, deliberate step - the publish window in
> **Design -> Prototypes**; send the team data in the Sync window first, or the next publish from
> another computer refuses (`stale-source`).
> Demo states (the "Demo states" picker in the preview, `?state=<id>`): `<N>` - `<id: label, ...>`.

Append these lines when they apply (omit a line whose subject did not happen):

> Figma fidelity: `<ZERO MAJOR | N MAJOR unresolved>`; MINOR to decide: `<list or "none">`.
> New deviations registered in `spec.json` `figmaDeviations[]`: `<list or "none">`.
> Based on / inspired by reference screens: `<project / page / name [role]>, ...`.

## Hard rules

- **Filesystem-only in the data repo.** Never `git add/commit/push` under `data-sub-repositories/`.
- **Frontend-only roster.** Server, tests or host-DS work is `/new-idea`, not a prototype.
- **One registry, one id source.** Never write a second `prototypes.json`-like file; never invent
  an id - it always comes from `POST /api/prototypes`.
- **`index.tsx` imports only from `react`, `./styles.css`, `../_shared/*`, `../../ds`,
  `../../components`**, plus the named exception - schedulers = `@bryntum/scheduler`
  (`-react`, `-trial`), export = `write-excel-file`, `jspdf`, `html2canvas` - kept as ONE list in
  `scripts/_proto-imports.js`. Never a design-system package directly. No sibling `.ts`/`.tsx` file next to
  it - the pipeline never copies one.
- **A 200 from local preview is not a compile gate.** Vite's dev transform never type-checks; run
  `cd data-sub-repositories/data-prototypes && npx tsc -b` (once the shell clone exists, after the
  preview staged the files) before claiming a prototype builds. It writes `*.tsbuildinfo` in the
  shell - a file write, not git. Precedent: two prototypes passed every
  other gate while `tsc -b` failed with 12 errors.
- **Interaction affordances are part of the contract, not polish.** Every clickable row, card or
  list item gets `cursor: pointer` and a visible hover state from a real token; every checkbox and
  radio toggles when its LABEL or row is clicked (the `DSRadio` label has no `htmlFor` - forward
  the click to the preceding `[role="radio"]`); a control nested in a clickable row toggles exactly
  once. Precedent 2026-09-11: every defect the user reported after all automated gates passed was
  an interaction state.
- **Screen state belongs in the URL.** A prototype with more than one screen keeps the active
  screen (and selected record) in the hash (`parseHash` / `hashForState`); `?state=` belongs to
  `useDemoState`, so a demo state wins when present.
- **Deviations are user decisions.** Every intentional divergence from the Figma lives in
  `spec.json` `figmaDeviations[]` (`{frameId, screen, what, why, decidedBy: "user", date}`), added
  only after an `AskUserQuestion` confirmation. Registered deviations are never re-flagged and
  never silently reverted.
- **Figma-first when a link exists.** A Figma link triggers the Phase 1 ingest through the
  `scripts/figma_reference.py` (server stream) into `user-data/figma-reference/<id>/`; only an explicit user waiver skips it.
- **Existing prototypes are gated against their baseline.** `--baseline` blocks only NEW findings;
  a new prototype runs the linter without it. The baseline file never lives in `prototype_dir`.
- **The Figma->CSS contract and the fidelity rules that apply without Figma live in
  `.claude/agents/references/figma-fidelity.md`** (instance sizes, no invented constraints,
  ellipsis for data text, scroll reset, `DSIcon` = `currentColor`, resolve a token before use,
  interactive states with the control, override by structure, measure instead of looking,
  evidence for "absent from the catalog"). The implementer reads it before the first screen; the
  guardian and Proxy apply it. Extend that file with the precedent when a new class of fidelity
  bug appears, instead of growing this list.
- **Zero hex** in `index.tsx` / `render.js`, `styles.css`. Tokens only - build-shell and app
  tokens for React, `css/ds-tokens.css` for legacy vanilla.
- **`@container proto`, never `@media`, in React CSS.** The canvas can be narrower than the window.
- **Catalog is the sole DS-shape authority**, mobile-first; components render through `../../ds`
  adapters (React) or `ds-*` classes (legacy vanilla) - never the host's `css/ds.css` as the
  prototype's own surface. Custom elements only with the guardian's confirmation, registered in
  `spec.json` `customElements[]` (`{ name, reason, note, lead_confirmed, owns? }`) and marked
  `/* CUSTOM */`; a raw tag inside a registered element's function (or one in its `owns[]`) is a
  NOTE, the same tag outside any such scope is a BLOCK.
- **`spec.json` mandatory in both modes; `compliance.json` only requirements-driven.**
- **Host DS is read-only here.** A needed `css/ds.css` fix goes through `/new-idea`.
- **No restoring the removed compliance tab or `/api/lab/chat`.** Requirements coverage lives in
  `compliance.json` and the plan, not a UI screen.
- **Never commit** in this repo either - plans are reviewed by the human.

## Notes

- `/new-idea` redirects here when someone aims it at a prototype.
- The shared agents (`idea-planner`, `frontend-implementer`, `ac-verifier`, `playwright-specialist`)
  carry a short prototype section each; this skill is only the orchestrator.
- Models: defaults from `.claude/default-models.json` (`proto-ds-guardian` on Sonnet).
