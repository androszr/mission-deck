<!--
Prototype plan template. NEVER REMOVE H2 SECTIONS - the generic preflight
(scripts/plan-preflight.js, reused by scripts/proto-preflight.js) requires them.

A prototype is a React screen in the team data repo clone
data-sub-repositories/ds-data/prototypes/{{proto-id}}/ (index.tsx + styles.css +
spec.json [+ compliance.json] + assets/) - the SAME registry and directory the cockpit's
"Design -> Prototypes" screen reads (prototypes.json, { items: [...] }). The id always comes from
POST /api/prototypes, which also stages the starter files; a plan never invents one. A change is
a FILESYSTEM write into that clone - never git there; the user syncs via the app. The files never
appear in this repo's git diff: ACs are verified ON DISK. Full contract: the "The prototype
contract" section of .claude/skills/prototype/SKILL.md.

The legacy render.js contract (no React) is still supported but no prototype in the data uses it
today; that format is maintain-only - never plan a NEW render.js.

Conditional blocks: {{#if figma_reference}} ... {{/if}} is filled only when /prototype Phase 1
ingested a Figma reference into user-data/figma-reference/<id>/ (delete the block otherwise);
{{#if existing_prototype}} / {{#if new_prototype}} pick the linter gate (baseline or plain). In
BOTH cases the {{#if}} / {{/if}} markers themselves are removed from the written plan - preflight
P2 blocks any {{...}} left in ## Visual verification.

Two modes (frontmatter "Prototype mode"):
  - requirements-driven: a linked requirements document exists -> compliance.json is mandatory.
  - spec-driven: exploratory mock -> spec.json alone is the scope source of truth.
-->

# {{title}}

**Date:** {{date}}
**Slug:** {{slug}}
**Status:** draft
**Surface:** view (prototype)
**Prototype id:** {{proto-id}}
**Prototype dir:** `data-sub-repositories/ds-data/prototypes/{{proto-id}}/`
**Prototype format:** {{react | vanilla}}
**Prototype mode:** {{requirements-driven | spec-driven}}
**Breakpoints:** {{e.g. [375, 768, 960, 1280, 1536, 1920]}}

## Business description

<!-- A section for the non-technical reader. Zero paths, zero file names, zero code concepts.
     3-5 points about the effect for the user. Preflight blocks jargon (rule 19). -->

**Why we are doing this:** {{whose problem this mockup solves and what its absence costs today}}

**What changes for the user:**

1. {{what the user will see / be able to try out on the mockup}}
2. {{...}}
3. {{...}}

**What the user will see after release:** {{specifics: which screen, which elements, which interaction}}

**What this does NOT change:** {{the mockup does not change the working app - one line}}

## Idea

{{one paragraph: the prototype id, the screen(s) touched, the breakpoints, what the change shows}}

## Context

- **Where it lives:** `data-sub-repositories/ds-data/prototypes/{{proto-id}}/` -
  `index.tsx` (`export default`, `export const breakpoints: number[]`,
  `export const demoStates: DemoStateDef[]`), `styles.css`, `spec.json`{{, `compliance.json`}},
  `assets/`. Registry entry: `data-sub-repositories/ds-data/prototypes/prototypes.json`
  (`{ items: [...] }`) - already created by `POST /api/prototypes`, never duplicated.
- **Screens and demo states (verify against index.tsx before quoting):** {{how screens map to
  demoStates today - list existing ids, then the ones this plan adds; `index.tsx:<line>` only
  after reading it}}
- **State:** {{component state reset by the one-shot effect keyed on
  `useDemoState(demoStates, '<defaultId>')` - every new demoState id gets a `case` in that switch}}
- **DS sources:** React components from the team's `../../ds` adapters and `../../components`
  when they exist, otherwise the prototype's own markup mirroring the catalog; never a raw `<button>`/`<input>`/`<select>`/
  `<textarea>`/`<table>` outside the body of a function registered in `spec.json`
  `customElements[]` (or its `owns[]`). Library exception (schedulers = `@bryntum/scheduler`
  `-react`/`-trial`, export = `write-excel-file`, `jspdf`, `html2canvas`): the one list is
  `scripts/_proto-imports.js`. Floating layers through `DSPopover` / `DSDropdown`. Every custom
  element cites the `path:line` of the nearest `DS*` props and the `ls`/`grep` that proves the
  catalog lacks it: {{citation or "no custom element"}}. Tokens from the build shell
  (`templates/prototype-build-shell/src/tokens.css`) and the app tokens (`css/ds-tokens.css`) via
  `var(--...)` in `styles.css`, zero hex. Icons by catalog slug (the catalog
  `scripts/check-proto-ds.js` validates against); component shapes from the app's DS catalog,
  mobile first, web as fallback.
- **Companion artifacts:** `spec.json` (`scope[]`, dated `releases[]`, `updated`,
  `customElements[]`) - MANDATORY both modes. `compliance.json` - {{requirements-driven: MANDATORY,
  requirement ids -> status/coverage/gap/shots[] | spec-driven: n/a, no linked requirements}}.
  Requirement Etap (requirements-driven only): {{Etap from the Confluence "Etap" column, not the markdown "Priorytet"}}.
- **Jira / initiative context:** {{jira_context - epic and issue keys used, or "none"}}
- **Interaction and URL state:** {{hover + `cursor: pointer` per clickable row/card; label-click per checkbox/radio; for more than one screen the hash route (`parseHash` / `hashForState`)}}
- **Registered Figma deviations (`spec.json` `figmaDeviations[]`):** {{existing entries relevant to the touched screens, or "none" - USER-approved decisions this plan never reverts; NEW deviations this plan needs are listed here explicitly and are confirmed by the user in Phase 6g}}
{{#if figma_reference}}
- **Figma reference (MANDATORY when the idea links Figma):** `user-data/figma-reference/{{proto-id}}/`
  ingested by `/prototype` Phase 1 with `scripts/figma_reference.py` - `frames.json`,
  `section-*.md` layout trees, `screenshots/<frameId>.png`, `token-map.md`. Numbers in `## Steps`
  come from the `[inst]` lines of the trees, never from a screenshot or a catalog aggregate;
  colours only through `token-map.md` (a `NO-MATCH` hex is surfaced here, never guessed). Contract:
  `.claude/agents/references/figma-fidelity.md`.
  - Screens in scope: {{one line each - `<frame name>` (`<frameId>`, `<width>`) -> `section-<slug>.md` + `screenshots/<frameId>.png`}}
  - `NO-MATCH` hexes: {{list or "none"}}
{{/if}}
- {{decisions from the interview, including matched_reference_screens if any}}

## Files to change

- `data-sub-repositories/ds-data/prototypes/{{proto-id}}/index.tsx` - {{new screen, demoStates entries, handlers}}
- `data-sub-repositories/ds-data/prototypes/{{proto-id}}/styles.css` - {{new `.{{proto-id}}-*` rules, tokens only, `@container proto (min-width)`}}
- `data-sub-repositories/ds-data/prototypes/{{proto-id}}/spec.json` - MANDATORY: scope items, `releases[]` entry dated {{date}}, `updated`
{{#if requirements_driven}}
- `data-sub-repositories/ds-data/prototypes/{{proto-id}}/compliance.json` - MANDATORY: addressed requirement(s) -> `status`, `coverage`, cleared `gap`, `shots[]`
{{/if}}

## New files

- `data-sub-repositories/ds-data/prototypes/{{proto-id}}/assets/{{screen}}.png` - screenshot captured in Phase 6g

## Steps

- [ ] 1. **Demo states (`index.tsx`).** {{extend `demoStates` with one `{ id, label, group }` entry
      per new screen / empty / loading / error / open layer; add the matching `case '<id>':` in the
      one-shot reset+apply effect driven by `useDemoState(demoStates, '<defaultId>')`}}
- [ ] 2. **Screen.** {{add the screen's JSX in `index.tsx`, composed from `../../ds` adapters and
      `../../components` shells}}
- [ ] 3. **Handlers.** {{event handlers as component state; no full remount that would drop focus mid-input}}
- [ ] 3b. **Interaction affordances and URL state.** {{per clickable row/card/list item: `cursor: pointer` + hover background from a real token (e.g. `--table-primary-hover-bg`); per checkbox/radio: label-click toggles (forward a `DSRadio` label click to the preceding `[role="radio"]`) and a nested control toggles once; for more than one screen: the active screen in the hash (never `?state=`), scroll reset on screen change}}
- [ ] 4. **DS.** Build from `../../ds` adapters (`DSButton`, `DSCard`, ...); icons via `<DSIcon name="<slug>">` (slug checked against the icon catalog, tinted via `color:` on the wrapper); floating layers via `DSPopover` / `DSDropdown`; custom markup only where no catalog component covers it, registered in `spec.json` `customElements[]` (`{ name, reason, note, lead_confirmed, owns? }`) with a `/* CUSTOM: <reason> */` marker in `styles.css`.
- [ ] 5. **CSS.** `.{{proto-id}}-*` rules in `styles.css`, `var(--...)` tokens only, zero hex, `@container proto (min-width: ...)` - never `@media`; `:hover` and `:focus` with every control, no bare `outline: none`; keep `export const breakpoints` in sync with what is built.{{#if figma_reference}} Every width/padding/gap/font size quotes its `[inst]` line from the cited `section-*.md`.{{/if}}
- [ ] 6. **spec.json (MANDATORY).** Scope items, `releases[]` entry dated {{date}}, bump `updated`.{{#if figma_reference}} Keep `figmaSource` (`fileKey`, `referenceNodeId`, `nodeIds[]`, `fileUrl`) current; a NEW deviation is NOT written here - it is listed in `## Context` and registered in `figmaDeviations[]` (`{ frameId, screen, what, why, decidedBy: "user", date }`) only after the user confirms it in Phase 6g.{{/if}}
{{#if requirements_driven}}
- [ ] 7. **compliance.json (MANDATORY).** Map the addressed requirement(s): `status`, `coverage`, cleared `gap`, `shots[]`.
{{/if}}
- [ ] 8. **Linter.** {{#if new_prototype}}`node scripts/check-proto-ds.js data-sub-repositories/ds-data/prototypes/{{proto-id}}` exits 0.{{/if}}{{#if existing_prototype}}`node scripts/check-proto-ds.js data-sub-repositories/ds-data/prototypes/{{proto-id}} --baseline user-data/proto-baselines/{{proto-id}}.json` exits 0 (zero NEW findings against the baseline captured before the first edit with `--json > user-data/proto-baselines/{{proto-id}}.json`).{{/if}}
- [ ] 8b. **Type check.** After a 200 from `POST /api/prototypes/local-preview/{{proto-id}}`, and only when `data-sub-repositories/data-prototypes/` exists: `cd data-sub-repositories/data-prototypes && npx tsc -b` exits 0 (the preview does not type-check; `tsc -b` writes `*.tsbuildinfo` in the shell - a file write, not git).
- [ ] 9. **Screenshots (Phase 6g).** Captured into `user-data/screenshots/`, then copied into `assets/` per `## Visual verification (Playwright)`.


## Risks & footguns

- **Filesystem-only, never git in the data repo.** Files under `data-sub-repositories/ds-data/` do not appear in `git diff HEAD` - verify on disk.
- **`index.tsx` import allowlist.** Only `react`, `./styles.css`, `../_shared/*`, `../../ds`, `../../components`, plus the named exception (schedulers = `@bryntum/scheduler` `-react`/`-trial`, export = `write-excel-file`, `jspdf`, `html2canvas`) - the one list is `scripts/_proto-imports.js`; anything else, and a DS package directly, is a BLOCK; no sibling `.ts`/`.tsx` file (the pipeline copies only `index.tsx` + `styles.css`).
- **A 200 from local preview is not a build.** Vite does not type-check; `tsc -b` (step 8b) is the gate.
- **Known traps (`.claude/agents/references/figma-fidelity.md`):** no `transform` on an ancestor of `DSBottomSheet`/`DSModal`; a rule on `svg` is dead (`DSIcon` is a `currentColor` mask); `--state-danger-border` is `transparent`; override DS components by structure, never a hashed class; ellipsis for data-bound text; the nested-control double toggle. {{keep the ones this plan's screens hit}}
- **`@container proto`, never `@media`.** The canvas can be narrower than the browser window; a viewport media query is not a canvas-width query.
- **Demo states are part of the contract.** A screen added without a `demoStates` entry + `case` is unreachable from the viewer's "Stany demo" popover.
- **Zero hex; tokens only.** No literal color anywhere in `styles.css` or a React inline `style`.
- **Companion artifacts stay current.** A screen change not reflected in `spec.json` {{and `compliance.json`}} leaves the reviewer blind - preflight P3 blocks it.
- {{prototype-specific risks}}

## Mandatory checklist

- [ ] `index.tsx` exports `default`, `breakpoints`, `demoStates`; imports only from the allowlist
- [ ] `styles.css`: tokens only, zero hex, `@container proto (min-width)` only
- [ ] every changed path is inside `data-sub-repositories/ds-data/prototypes/`
- [ ] DS from `../../ds` adapters, mobile-first catalog shape; custom elements registered and minimised
- [ ] `spec.json` updated (both modes){{; `compliance.json` updated (requirements-driven)}}
- [ ] `node scripts/check-proto-ds.js <dir>` exits 0 (new prototype) / with `--baseline` zero NEW findings (existing prototype)
- [ ] `npx tsc -b` in `data-sub-repositories/data-prototypes/` exits 0 (when the shell clone exists)
- [ ] every clickable row/card has `cursor: pointer` + hover; every checkbox/radio label toggles; multi-screen: hash state
- [ ] **Mobile fit:** chip/pill rows fit the 360px phone screen or wrap; bottom-anchored elements sit above the bottom chrome (read its real height from the chrome's CSS); floating elements match the named reference; section bars visibly separated
- [ ] registered `figmaDeviations[]` respected; new deviations listed for user confirmation
- [ ] Playwright recipe below filled in

## Visual verification (Playwright)

Phase 6g drives the running local-preview or deploy URL for `{{proto-id}}` at each width in
`**Breakpoints:**` and each scenario in `demoStates`, then copies the listed screenshots from
`user-data/screenshots/` into `data-sub-repositories/ds-data/prototypes/{{proto-id}}/assets/`.
Every field is required.

- **Reference screen (baseline):** {{an existing screen/demoState in the same prototype the new one must match}}
- **Golden path:**
  1. Open the preview URL at {{width}}, demo state `{{id}}` - assert the baseline screen renders.
  2. {{navigate/select the new demoState - assert its header text and one observable element}}
  3. {{exercise the interaction - assert the observable result}}
  4. Screenshot `{{screen}}.png` -> `assets/{{screen}}.png`.
- **DS audit targets:** new interactive elements come from `../../ds` adapters; no inline hex; no raw `<button>`/`<input>`/`<select>`.
- **Consistency landmarks:** shells match the reference screen; empty state uses `DSEmpty`; DevTools console clean.
- **Interaction targets (INTERACTION pass, every breakpoint):** {{each clickable row/card -> expected hover background; each checkbox/radio -> label-click toggles once; each form control -> visible focus; multi-screen: reload on `<screen>` returns there}}
{{#if figma_reference}}
- **Figma fidelity pairs (NUMERIC + VISUAL pass):** per screen in scope, `user-data/figma-reference/{{proto-id}}/screenshots/<frameId>.png` vs a capture at the EXACT frame width from `frames.json`, plus the `[inst]` numbers to measure: {{list the pairs}}. Registered `figmaDeviations[]` are skipped, never re-flagged.
{{/if}}

## Test plan

- [ ] `node scripts/check-proto-ds.js data-sub-repositories/ds-data/prototypes/{{proto-id}}` exits 0 {{#if existing_prototype}}with `--baseline user-data/proto-baselines/{{proto-id}}.json` (zero NEW findings){{/if}}
- [ ] `cd data-sub-repositories/data-prototypes && npx tsc -b` exits 0 - run only when that shell clone exists, after `POST /api/prototypes/local-preview/{{proto-id}}` answered 200; writes `*.tsbuildinfo` in the shell (file write, not git)
- [ ] `npm run lint` exits 0 (host untouched)
- [ ] `npm test` exits 0 (host untouched)
- [ ] Manual: open the preview URL, walk the golden path at each breakpoint and demoState, console clean

## Acceptance criteria

Verified ON DISK under `data-sub-repositories/ds-data/prototypes/{{proto-id}}/`, never in the diff.

- [ ] AC1: `grep -c '{{marker}}' data-sub-repositories/ds-data/prototypes/{{proto-id}}/index.tsx` returns >= 1
- [ ] AC2: `node -e "const r=require('./scripts/check-proto-ds.js').run(process.argv[1]);process.exit(r.findings.some((f)=>f.rule==='react-import')?1:0)" data-sub-repositories/ds-data/prototypes/{{proto-id}}` exits 0 (no import outside the one allowlist in `scripts/_proto-imports.js`; same result on GNU, BSD and ugrep machines, because no grep is involved)
- [ ] AC3: `spec.json` has a `releases[]` entry dated {{date}} and `updated` = {{date}} (read the file)
{{#if requirements_driven}}
- [ ] AC4: `compliance.json` - requirement {{id}} has `status` covered or partial with non-empty `coverage` and `shots[]`
{{/if}}
- [ ] AC5: `node scripts/check-proto-ds.js data-sub-repositories/ds-data/prototypes/{{proto-id}}{{#if existing_prototype}} --baseline user-data/proto-baselines/{{proto-id}}.json{{/if}}` exits 0
- [ ] AC6: `grep -cE '#[0-9a-fA-F]{3,8}\b' data-sub-repositories/ds-data/prototypes/{{proto-id}}/styles.css` returns 0
- [ ] AC_VIS1: PLAYWRIGHT - the golden path passes at every declared breakpoint and demoState, console clean
- [ ] AC_VIS2: PLAYWRIGHT - the new subtree uses only `../../ds` adapters or registered custom elements; no inline hex
- [ ] AC_VIS3: PLAYWRIGHT - landmarks match the reference screen; screenshots saved to `assets/`
- [ ] AC_VIS4: PLAYWRIGHT - INTERACTION pass: every clickable row/card has computed `cursor: pointer` and a visible hover change, every checkbox/radio toggles from its label and exactly once from the control, no default blue focus ring; multi-screen: reload returns to the screen
{{#if figma_reference}}
- [ ] AC_FIG1..N: numeric, grep-verifiable criteria lifted from the cited layout trees - 2-4 per screen, e.g. `grep -c 'max-width: 1060px' data-sub-repositories/ds-data/prototypes/{{proto-id}}/styles.css` >= 1 (frame `<frameId>`), `grep -c '24-ic-<slug>' data-sub-repositories/ds-data/prototypes/{{proto-id}}/index.tsx` >= 1. {{generate the concrete list from the trees}}
- [ ] AC_FID: PLAYWRIGHT - fidelity audit over the Figma pairs reports ZERO MAJOR discrepancies (MINOR listed in the handoff; `figmaDeviations[]` entries skipped)
- [ ] AC_FID_NUM: PLAYWRIGHT - NUMERIC pass: per screen an `element | Figma | measured | delta` table from the live page (`getBoundingClientRect` + `getComputedStyle`) - outer box, padding, gap, child sizes, font-size/line-height/colour, border colour, radius; every delta <= 2px and zero colour/token mismatches. Screenshot comparison alone does not satisfy this AC
- [ ] AC_FID_ICON: every icon the Figma nests in a coloured component renders in that colour - checked from the computed `background-color` of its `[data-icon]` mask span (`DSIcon` paints `currentColor`), and `grep -nE '(^|[^-a-z])svg[^{]*\{' data-sub-repositories/ds-data/prototypes/{{proto-id}}/styles.css` returns no rule setting `color`/`fill`/`stroke`
- [ ] AC_FID_STATE: every form control added/changed has a `:focus` rule sourced from its DS module, `outline: none` appears only with a visible replacement, and no visible border uses a token that resolves to `transparent` (resolve against `templates/prototype-build-shell/src/tokens.css` and `css/ds-tokens.css`)
{{/if}}

## Out of scope

- {{deferred features}}
- Anything in this repo: `js/`, `css/`, `index.html`, `server.js` - a host change is `/new-idea`.
- Shared prototype infra: `../../ds`, `../../components`, `prototypes/_shared/` - a change there
  affects every prototype and needs its own plan.
- Any `git` operation inside `data-sub-repositories/`.

## Iteration log

- {{date}} initial draft
