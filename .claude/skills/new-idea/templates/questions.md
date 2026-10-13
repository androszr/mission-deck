# Question Bank (mission-deck)

The `new-idea` skill loads this file in Phase 2 and walks only the branches relevant to the
classified surface. **At most 5 questions**, one at a time via `AskUserQuestion` (max 4 options
per call). Answer from the codebase first — if `js/view-registry.js`, `js/sidebar-flyout-config.js`
or `server.js` already answer a branch, record the answer and skip the question.

## Branch table by surface

| Surface | Branches to resolve (in order) |
|---|---|
| `view` | Q1 placement (module vs core), Q1b core hub, Q1c business area, Q1d dashboard widget, Q2 data source, Q3 interaction, Q6 out-of-scope |
| `server-endpoint` | Q4 endpoint shape, Q2 data source, Q5 tests, Q6 out-of-scope |
| `data` | Q2 data source, Q4 endpoint shape, Q6 out-of-scope |
| `cross-cutting` | Q1 placement, Q1b core hub, Q1c business area, Q1d dashboard widget, Q4 endpoint shape, Q5 tests, Q6 out-of-scope |
| `bugfix` | Q7 repro, Q5 tests, Q6 out-of-scope |
| `refactor` | Q8 blast radius, Q5 tests, Q6 out-of-scope |

---

## Q1 — Where does this live?

- `module` — a plug & play module in `modules/<id>/` (**the default**). Its pages land in one of
  the rail's CORE hubs (`sidebar.kind: "page"` + `sidebar.hub`, see Q1b) — a module does not get a
  rail item of its own unless there is a reason (Q1b, last option). The core is not edited at all.
  It lives locally until someone publishes it, which always goes through a branch and a merge
  request against the shared catalog repo (Settings > Modules > Publish).
- `settings` — a new tab inside Settings (core: the tab strip in `index.html`, `SETT_TAB_IDS`
  and a `js/settings-<name>.js` renderer).
- `dashboard` — a card or section on the existing dashboard, no new view.
- `core-view` — a page in the shell itself. Needs the full view triple AND its own hub, since
  `HUB_FLYOUT` ships empty. Ask for a reason before choosing this over `module`.

**Skip if:** the idea names the destination, or the change is server-only.

**Note:** `area-a` and `area-b` placeholder hubs no longer exist — the placeholder hubs were removed when the
module system landed. Never offer them.

## Q1b — Which core hub does the page land in?

**Ask whenever Q1 resolved to `module` and the idea does not name a hub.** The rail's hubs belong
to the core and are declared in ONE place, `js/core-hubs.mjs` — read `CORE_HUBS` from that file
at question time and never keep a copy of the list here. Today: Team (`team`), Activity
(`activity`), Finance (`finance`), Initiatives (`initiatives`), Support (`support`), Knowledge
(`knowledge`), Design (`assets`), Apps (`apps`). A module cannot add a ninth.

`AskUserQuestion` takes at most 4 options, so: the three hubs that fit the idea's domain best
(the first one marked `(Recommended)`), plus `Another hub / own rail item`. When the person
picks the last option, ask once more with the remaining hubs plus `Own rail item (item)`
and `Own flyout (hub, 2+ views)`; either of those two needs one sentence of reason, which the
planner writes into `## Context`.

The answer reaches the planner as `hub: <id>` (or `hub: item` / `hub: hub` with the reason) and
becomes `node scripts/new-module.js <id> "<Label>" --hub <hub> --area "<Area>"` in `## Steps`. Rule 21 of the
preflight WARNs on a module plan that names no hub and gives no reason.

**Skip if:** the idea names the hub ("in Support", "under Team", "into the Knowledge hub"), or Q1 is not
`module`.

## Q1c — Which business area does the module belong to?

Resolve for every new module, independently of its menu hub. Offer Product, Engineering,
Operations, or another explicitly named area. These are suggestions, not a closed
list. Record exactly one `area: <name>` in the planner answers and `## Context`, and carry
it into `--area "<name>"` in the scaffold step. Never silently assign an area.
Rule 22 warns when a new-module scaffold command omits this argument.

**Skip if:** the request already names the area, or the change extends an existing module
with a valid `area` in its manifest (reuse that value). Not applicable to core-only changes.
If the question budget is exhausted, resolve data/test choices from existing conventions
rather than dropping the required area.

## Q1d — Does the module get a dashboard tile?

Ask when Q1 is `module` (a new module), or when the plan extends an existing module whose
`module.json` has no `widgets[]`. Options:

- `none` — a shortcut tile from the manifest (the core derives it; no `widgets[]`)
- `KPI` — one to three numbers (presets `s,m`)
- `list` — latest entries (presets `m,l`)
- `other` — give the id, label and presets (`s` Small 2x1, `s2` 2x2, `m` Medium 3x1, `m2` 3x2, `l` Wide 6x1, `xl` 6x2)

The answer reaches the planner as `widgets: <spec>` (`<id>:<Label>[:<presets>][;...]`) and
becomes `--widgets "<spec>"` on the `new-module.js` step, or a `widgets[]` entry plus a
`client/widget.js` step for an existing module (contract: `modules-template/README.md`,
"Dashboard widget"). Within the 5-question budget: when it is exhausted, default to `none`
and say so in `## Context`.

**Skip if:** the change is core-only, or the request already names the widget.

## Q2 — Where does the data come from?

- `data-tier-0` — a JSON file in the cloned data repo (`data-sub-repositories/ds-data/`)
- `server-api` — a new or existing `/api/...` endpoint backed by `data/`
- `jira` / `confluence` — proxied through the existing `/api/jira/*` or `/api/knowledge-base/*` routes
- `static` — hardcoded English sample data in the module, no persistence

**Skip if:** the idea names the source explicitly.

## Q3 — What is the main interaction?

- `read-only` — render and refresh, no writes
- `crud` — the user creates/edits/deletes records (needs `withLock` + a write endpoint)
- `form` — one submit action
- `action` — a single button that triggers a server-side job

## Q4 — What is the endpoint shape?

- `GET` read-only, `jsonResponse` with ETag
- `GET` + `POST` pair (read + write, write wrapped in `withLock`)
- `SSE` stream (progress reporting, `text/event-stream`)
- `none` — reuse an existing endpoint

## Q5 — What is the test budget?

- `api` — one `tests/test_api_*.js` case per new route (default when `server.js` changes)
- `unit` — `tests/test_*.mjs` for a new pure helper
- `both`
- `none` — pure markup/style change with no branching logic

**Rule:** a new endpoint always gets at least one API test. `none` is not a valid answer when
`server.js` gains a route.

## Q6 — What is explicitly out of scope?

Free text. Capture what a reasonable reader might assume is included but is not (e.g. "no dark
mode tuning", "no Jira write-back in this pass").

## Q7 — How do we reproduce the bug?

- Exact steps + expected vs actual. If the user cannot repro on demand, ask for the view id and
  the console/network symptom.

## Q8 — How wide is the refactor?

- `single-module` — one file, no exported API change
- `exported-api` — changes a signature other modules import (planner must list the callers;
  the implementer runs `impact` first)
- `server-section` — moves or renames a `server.js` section
