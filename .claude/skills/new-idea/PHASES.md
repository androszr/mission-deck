# /new-idea - per-phase detail

Loaded **only when a phase actually runs**. `SKILL.md` is the flow map plus the hard rules;
this file holds the prompt blocks, the call sequences and the loop mechanics.

Read the section for the phase you are in. Do not load the whole file.

---

## Phase 2 - interview

Load `.claude/skills/new-idea/templates/questions.md` and walk the relevant decision branches.
At most **5** questions.

1. **Answer from the codebase first** (Read/Grep/Glob, or `mcp__gitnexus__query` when available).
   If the code already answers a branch, record it and skip the question.
2. Ask one question at a time via `AskUserQuestion` (max 4 options per call - more throws
   `InputValidationError`). If the tool is not loaded, fetch it with `ToolSearch`
   `select:AskUserQuestion`.
3. "Go with your recommendations" -> apply your recommended answers to the remaining branches
   and exit the loop.
4. Capture every resolved answer as a key/value map for Phase 4.

---

## Phase 3 - plan path

1. Kebab-case `slug` from the idea (<=40 chars, ASCII, lowercase).
2. Path `plans/<YYYY-MM-DD>-<slug>.md`. On collision suffix `-2`, `-3`.
3. Template: always `.claude/skills/new-idea/templates/plan.md`.

---

## Phase 4 - planner

```
Agent({
  subagent_type: "idea-planner",
  description: "Plan: <slug>",
  prompt: "Mode: new
Idea: <idea text>
Surface: <surface>
Answers:
- <key>: <value>
plan_path: <absolute path to plans/<date>-<slug>.md>
template_path: <absolute path to .claude/skills/new-idea/templates/plan.md>
repo_map_path: <absolute path to .claude/skills/new-idea/templates/repo-map/overview.md>
conventions_path: <absolute path to .claude/agents/references/cockpit-conventions.md>

Write the plan per your brief. Read the repo map and the conventions file FIRST, then verify any
path/line reference against the real tree before quoting it."
})
```

Returns `PLAN: <path>` plus a 5-line abstract. Line 1 of the abstract is written for the
non-technical reviewer (plain English, no paths, no code concepts); lines 2-5 are technical. Phase 5
prints the plan's `## Business description` first and the abstract after it.

**Iterate mode:** same call with `Mode: iterate` plus a `Feedback:` block carrying the user's words
verbatim and the preflight findings that triggered the re-run.

**Scaffolding shortcut worth naming in the plan:** when the change is "add a page" (a module,
the default), "add a core view" or "add an endpoint", `## Steps` should say
`node scripts/new-module.js <id> "<Label>" --hub <core-hub> --area "<Area>"` /
`node scripts/new-view.js <id> "<Label>" --hub <hub>` / `node scripts/new-endpoint.js <METHOD>
<path>` rather than describing four hand edits. The implementer then fills in behaviour instead
of re-deriving the wiring. The `--hub` of a module is the Q1b answer, never a guess.
The required `--area` is the Q1c answer (business area, not menu placement); retain the
existing manifest's area for changes to an existing module unless a change was requested.

---

## Phase 4.5 - preflight

```
node scripts/plan-preflight.js <plan_path> --json
```

Exit 0 = clean or warnings only, 1 = at least one BLOCK, 2 = the file could not be read.
Each finding carries `rule`, `line`, `message`, `fix`. Rules are documented in
`PREFLIGHT-CHECKLIST.md` (documentation, not a to-do list - the script is the executable form).

- **Any BLOCK** -> do not continue. Show the abstract plus the BLOCK lines and their fix hints,
  prompt `iterate` or `stop`.
- **Only WARN** -> continue with a one-line notice naming the rule numbers.
- **Clean** -> continue silently.

Re-run after every `iterate` cycle. Never re-derive the rules by hand.

---

## Phase 6 - implementation (fast path or split path)

**Module-only check first.** When EVERY path in `## Files to change` and `## New files` matches
`^modules/<one id>/`, the branch gate does not apply (see SKILL.md Phase 6) - instead run
`git -C modules/<id> rev-parse --show-toplevel` and compare it to the absolute path of
`modules/<id>` itself. A mismatch (the parent mission-deck repo answered, because the module has no
`.git` of its own) or a not-yet-scaffolded `modules/<id>` whose steps do not call
`scripts/new-module.js` is a STOP: "Initialise the module repository (Settings > Modules or
`git -C modules/<id> init`) and accept again." Otherwise continue below.

**Path decision first.** Read the plan's `## Files to change` and `## New files`, count the
distinct paths and classify each:

| Layer | Paths |
|---|---|
| backend | `server.js`, `scripts/**`, `tests/test_api_*` |
| frontend | `index.html`, `js/**`, `styles.css`, `css/**`, `tests/test_*.mjs` |

- **Fast path** - at most 6 distinct paths AND only one layer touched -> one `idea-implementer`.
- **Split path** - more than 6 paths, or both layers touched -> 6a, then 6b, then 6c.

Print one line before spawning: `Path: fast (<n> files, <layer>)` or
`Path: split (<n> files, backend+frontend)`. The decision is made once; retries follow it.

### Worktree mode

**When.** The branch gate (SKILL.md Phase 6) ran `node scripts/worktree.js recommend --plan <plan>
--json` and the person picked "New worktree" - recommended when the plan touches the core AND
the main tree already has tracked changes outside the plan, `plans/` and `user-data/` (another
session works there), or the split path has a file in more than one layer. Never for module-only
plans, `/prototype` or `/mini`.

**How.** `node scripts/worktree.js create <slug>` -> `repo_root` = the printed path
(`.claude/worktrees/<slug>`), `branch_name` = `wt/<slug>`. The worktree has its own `.env` port
(3101-3199), a `node_modules` symlink, `.core-dev` only when the main tree has it, and EMPTY
`data/`, `user-data/`, `data-sub-repositories/` - no team data and no `.encryption-key`, ever.
Uncommitted changes of the main tree do not travel into it.

**What the agents get.** Every prompt block below (6 fast / 6a / 6b / 6c / retry) carries one
extra line `repo_root: <absolute worktree path>`; without it (branch mode) the line is omitted and
agents work in the main tree as before. Implementers run every command, scaffolder
(`node <repo_root>/scripts/new-view.js`, `new-endpoint.js`) and `node <repo_root>/scripts/gates.js`
from `repo_root`; `plan_path` stays absolute and lies OUTSIDE the worktree (plans are local to the
main tree). Add `owned_files: <comma-separated paths>` when the split path runs, or when two
sessions share one tree on purpose (see "File ownership" below).

**Gates.** API tests use fixed ports per file, so `npm run test:api` runs in ONE tree at a time on
this machine; serialize the gates of one plan and never run them in two trees at once.

**File ownership (the lighter alternative).** Several implementers may share ONE tree when their
file sets are disjoint: each prompt gets `owned_files:`, nobody touches `index.html` or `server.js`
from two sides, nobody switches branches, and the gates run on a quiet tree. After each slice
compare `files[]` of `node <repo_root>/scripts/diff-digest.js --base main --json` with that slice's
`owned_files`: a file outside the list is `partial` with the file named, never a silent accept.
When the sets overlap, use separate worktrees (`<slug>-a`, `<slug>-b`) and the person merges.

### Fast path

```
Agent({
  subagent_type: "idea-implementer",
  description: "Implement: <slug>",
  prompt: "plan_path: <absolute path>
conventions_path: <absolute path to .claude/agents/references/cockpit-conventions.md>
gitnexus_available: <true|false>
repo_root: <absolute worktree path - worktree mode only>

Read your brief, then the conventions file, then the plan, then execute ## Steps in order.
Scaffolding: `node scripts/new-view.js` and `node scripts/new-endpoint.js` write the whole
view triple / route + lock + test stub - use them instead of hand edits, then fill in behaviour.
Run `impact` before editing an existing symbol when gitnexus is available.
Gates: `node scripts/gates.js --lint --unit` (add `--api` when server.js or tests/ changed).
Do not commit. Report back per your brief."
})
```

`blocked` or `partial` -> surface it and continue to Phase 7 with the failure noted.

### Split path - Phase 6a: backend-implementer

Skip (note `6a: skipped, no backend files`) when the plan has no backend path. Otherwise (the spawn
hook shows banner `backend`):

```
Agent({
  subagent_type: "backend-implementer",
  description: "Backend impl: <slug>",
  prompt: "plan_path: <absolute path>
conventions_path: <absolute path to .claude/agents/references/cockpit-conventions.md>
gitnexus_available: <true|false>
repo_root: <absolute worktree path - worktree mode only>
owned_files: <the backend paths of the plan - split path>

Execute the backend slice only (server.js, scripts/, tests/test_api_*). Scaffold a new route
with `node scripts/new-endpoint.js <METHOD> <path> [--lock]`, then fill in behaviour. Gates:
`node scripts/gates.js --lint --unit --api`. Do not commit. Report back per your brief with the
Backend contract filled in."
})
```

Record the `Backend contract` block verbatim - Phase 6b carries it. `blocked` or `partial` ->
stop the split flow here and go to Phase 7 with the failure surfaced (the frontend would be
built against a contract that does not exist).

### Split path - Phase 6b: frontend-implementer

Skip (note `6b: skipped, no frontend files`) when the plan has no frontend path. Otherwise (the spawn
hook shows banner `frontend`):

```
Agent({
  subagent_type: "frontend-implementer",
  description: "Frontend impl: <slug>",
  prompt: "plan_path: <absolute path>
conventions_path: <absolute path to .claude/agents/references/cockpit-conventions.md>
gitnexus_available: <true|false>
backend_contract: <the Backend contract block from 6a, verbatim, or n/a>
repo_root: <absolute worktree path - worktree mode only>
owned_files: <the frontend paths of the plan - split path>

Execute the frontend slice only (index.html, js/, styles.css, css/, tests/test_*.mjs). Scaffold a
new view with `node scripts/new-view.js <id> \"<Label>\" --hub <hub>`, then fill in behaviour.
Every fetch() must match the backend contract. Gates: `node scripts/gates.js --lint --unit`.
Do not commit. Report back per your brief with the Frontend contract filled in."
})
```

Record the `Frontend contract` block. `blocked` or `partial` -> surface it, skip 6c, continue to
Phase 6d so the verifier still reports what exists.

**Test slice (inline by default).** The implementers write the tests of the slice they own, so
there is normally no separate QA step. Spawn `qa-automation-implementer` (the spawn hook shows banner `qa`, Watch
DiPierro) only when the plan's `## New files` lists a brand-new `tests/test_*.mjs` or
`tests/test_api_*.js` that does not exist on disk; it touches `tests/` and nothing else. Note
`QA: inline (no new test files in plan)` for Phase 7 when it is skipped.

### Split path - Phase 6c: engineering-lead-reviewer

Runs **only when both 6a and 6b ran** and neither was `blocked`. Otherwise note
`6c: skipped (single-layer split)` for Phase 7. Run `node scripts/diff-digest.js --base main --json`
first (it is the same digest Phase 6d needs - reuse it). The spawn hook shows banner `lead`; then:

```
Agent({
  subagent_type: "engineering-lead-reviewer",
  description: "Lead review: <slug>",
  prompt: "plan_path: <absolute path>
branch_name: <branch_name>
repo_root: <absolute worktree path - worktree mode only>
backend_report: <the backend implementer's report, verbatim>
frontend_report: <the frontend implementer's report, verbatim>
digest: <the diff-digest --json output>

Review the full diff for cross-layer integration: route URL and method, request and response
shape, view triple, cleanup registration, a test that exercises the new route. Apply glue fixes
ONLY. Gates after any fix. Do not commit. Report back per your brief."
})
```

Parse `LEAD REVIEW: pass | pass-with-fixes | partial`. `partial` is not a stop - carry the
`Issues NOT fixed` list into Phase 7 and continue, so the user sees every layer's feedback.

### Retry dispatch (gap report or bug report) - both paths

The retry reuses the implementation call with an extra block:

```
gap_report:
- <AC id>: <what the verifier found, verbatim>
```

or

```
bug_report:
<the bug-auditor report, verbatim>
```

**Banner.** The spawn hook shows `gapfix` (Relay), not the implementer's own banner, because
it sees the `gap_report:` / `bug_report:` block in the prompt - keep that block at the start of
a line. The map has no fixed entry for it on purpose - a retry can go to any implementer.

**Routing.** Fast path: always `idea-implementer`. Split path: split the items by the file they
name - backend paths -> `backend-implementer`, everything else -> `frontend-implementer`. Items
naming both layers: backend first, then frontend with the refreshed `Backend contract`. An item
that names no file goes to the frontend when it is an `AC_VIS` criterion and to the backend when
it mentions a route, a status code or a JSON key; otherwise to both. The lead is not re-run on a
retry - the blind verifier is. In worktree mode the retry prompt keeps the same `repo_root:`
(and `owned_files:`) lines as the first call.

---

## Phase 6d - digest

```
node scripts/diff-digest.js --base main --json
```

In worktree mode run it BY PATH: `node <repo_root>/scripts/diff-digest.js --base main --json` -
the script resolves its repository from its own location, so the main-tree copy would digest the
main tree instead. The same holds for 6c's digest and for every script below.

The digest is what every downstream agent prompt carries. **Never paste the full diff.** Fields:

| Field | Use |
|---|---|
| `files[]` | `changed_files` for the guardian and the auditors |
| `added_routes`, `added_views`, `added_symbols`, `added_tests` | the shape of the change |
| `cosmetic_files` | files an auditor can skip |
| `size_class` | `small` / `large` |
| `bug_scan_recommended` | whether Phase 6.7 runs at all |
| `touches_server_logic` | the other half of that gate |
| `agent_model` | the value for `Agent({model})` - `haiku` or `sonnet`. The tool's enum is `sonnet\|opus\|haiku\|fable`; a dashed id throws. |
| `model_tier` | the same choice as a dashed id (`claude-haiku-5-5` / `claude-sonnet-5-5`) - the vocabulary of `.claude/default-models.json`, for documentation and defaults, NOT for the spawn |

Read the fields; do not recompute the thresholds.

---

## Phase 6e - guardian (conditional)

Run `node scripts/check-conventions.js --base main --json` FIRST (worktree mode:
`node <repo_root>/scripts/check-conventions.js --base main --json`). It covers every mechanical
rule: DS classes, ASCII, the view triple in every direction, `data-perspective`, `jsonResponse`,
handler placement, a test per route, port drift, forbidden operations, the modal `.open` contract,
hex literals.

Spawn `cockpit-guardian` **only** when one of:

- the script emitted a finding that needs judgment (any `WARN` or `NOTE`, or a `BLOCK` whose
  message the implementer disputes), or
- the digest touches `css/ds.css` or `css/ds-tokens*.css` (Design System changes are judgment
  calls the script deliberately does not make).

Otherwise fold the script's findings straight into the gap report and skip the agent.

```
Agent({
  subagent_type: "cockpit-guardian",
  description: "Guardian: <slug>",
  prompt: "mode: review-impl
plan_path: <absolute path to plan file>
repo_root: <absolute worktree path - worktree mode only>
changed_files: <comma-separated list from the digest>
digest: <the diff-digest --json output>
script_findings: <the check-conventions --json output>

Read the changed files yourself. The mechanical rules are already checked - judge what the script
cannot: is this <div> a hand-rolled ds-card, is this the right DS component, does this async
handler need one outer try/finally."
})
```

---

## Phase 6f - blind verifier

Always runs. The prompt is deliberately narrow and MUST NOT contain the implementer's self-report.

```
Agent({
  subagent_type: "ac-verifier",
  model: "<digest.agent_model>",
  description: "Verify AC: <slug>",
  prompt: "plan_path: <absolute path to plan file>
branch_name: <branch_name>
repo_root: <absolute worktree path - worktree mode only>"
})
```

Parse `VERIFY VERDICT: PASS | FAIL`.

- **PASS** -> record the per-AC results for Phase 7 and continue.
- **FAIL** -> build a `gap_report` from the failing AC ids plus evidence. Retry cap **2** - if the
  counter would exceed 2, mark the implementation `partial` and go to Phase 7. Otherwise
  re-dispatch the implementer(s) per the Phase 6 retry routing with the gap report, then re-spawn
  only the verifier.

Guardian BLOCKs and `check-conventions` BLOCKs fold into the same gap report.

---

## Phase 6.6 - graph review (GitNexus, inline, no agent)

Unavailable tools -> print ``Run `node scripts/bootstrap-gitnexus.js` and restart Claude Code``
and skip. Never a gate.

1. `mcp__gitnexus__list_repos` - pick the entry whose path matches the working directory, save as
   `REPO_NAME`. Never hardcode the name.
2. `mcp__gitnexus__detect_changes({repo: REPO_NAME, scope: "compare", base_ref: "main"})`.
   **Worktree mode:** `detect_changes({repo: REPO_NAME, scope: "compare", base_ref: "main",
   worktree: <repo_root>})`. The index is the main tree's (`REPO_NAME` is still `mission-deck`);
   without `worktree:` the call answers ZERO changes and looks clean. When the call does not
   accept `worktree`, write `graph review: skipped (worktree)` into the plan and skip steps 3-5 -
   NEVER record it as clean. `impact` / `context` go to the main index as usual.
3. For every changed symbol: `mcp__gitnexus__impact({repo: REPO_NAME, target: <symbol>,
   file_path: <file>, direction: "upstream", maxDepth: 2, limit: 20})`. Use `summaryOnly: true`
   or a smaller `limit` on hub symbols so the output stays bounded.
4. Append to the plan file:

   ```
   ## Graph review

   | Symbol | File | Upstream callers | Affected flows | Risk |
   |---|---|---|---|---|
   | <name> | <file> | <n> | <flow names> | LOW/MEDIUM/HIGH/CRITICAL |

   Notes: <one line per HIGH/CRITICAL symbol - who breaks and whether a test covers it>
   ```

5. Carry every HIGH and CRITICAL row into Phase 6.7 as `graph_findings`.

---

## Phase 6g - visual verification (conditional)

Only when `## Acceptance criteria` contains at least one `AC_VIS` criterion.

```
Agent({
  subagent_type: "playwright-specialist",
  description: "Visual verify: <slug>",
  prompt: "mode: visual-verify
plan_path: <absolute path>
base_url: http://localhost:3001
server_url: <worktree serverUrl - worktree mode only>
view_id: <view id under test, if any>"
})
```

**Worktree mode:** start the worktree's own verification server first -
`node <repo_root>/scripts/worktree.js serve <slug>` (test mode, its own port, its own PID file) -
read `serverUrl` from `node scripts/worktree.js status <slug> --json`, pass it as
`server_url: <serverUrl>` (and as `base_url`), and run `node scripts/worktree.js stop <slug>`
after the verdict. Never `npm start` in a worktree, never restart the main server for it. The
worktree has no team data, so views that read team data show empty states there; such checks end
in the main tree after the merge (`MANUAL`).

Branch mode: the server must already be running. If not, `curl -s -X POST http://localhost:3001/api/settings/restart`
then poll `GET /api/app/version` - never `npm start`. Failures become gap-report items and route
through the Phase 6f retry budget (on the split path they go to `frontend-implementer`, unless the
evidence names a route or a response shape - then to `backend-implementer` first).

---

## Phase 6.7 - bug scan (conditional)

Skip entirely (set `bug_report = null`) when any of:

- the implementation is `blocked`, or the digest reports zero changed files, or
- `digest.bug_scan_recommended` is `false`.

Scoring matrix: FUNC (feature broken) 20/8, REQ (unmet step) 15/6, UX (usability) 4/2.
`SHIP_THRESHOLD = 5`. Any FUNC blocker forces `ITERATE` regardless of total score. `MAX_ITER = 3`.

Loop (`iter = 0`, while `iter < 3`):

1. ```
   Agent({
     subagent_type: "bug-auditor",
     model: "<digest.agent_model>",
     description: "Bug scan: <slug>",
     prompt: "plan_path: <absolute path>
   iteration: <iter+1> / 3
   repo_root: <absolute worktree path - worktree mode only>
   digest: <the diff-digest --json output>
   graph_findings: <HIGH/CRITICAL rows from Phase 6.6, or \"none\">
   <on later cycles also: previous_bug_report and fix_report>"
   })
   ```
2. `SHIP` -> exit the loop.
3. Otherwise re-dispatch the implementer(s) per the Phase 6 retry routing with `bug_report`,
   increment `iter`.

`SHIP` carries the final report into Phase 7; hitting the cap with bugs remaining marks the plan
`partial`.

---

## Phase 7 - handoff

One command does the whole phase:

```
node scripts/plan-status.js <plan_path> \
  --status done|partial|blocked \
  --ac "AC1=pass,AC2=fail:<one-line evidence>,AC_VIS1=manual" \
  --iteration-note "Graph review: <n> HIGH/CRITICAL. Bug scan: <SHIP|PARTIAL|skipped> after <n> iteration(s)."
```

It sets `**Status:**`, ticks the checkboxes (`pass` -> `[x]`, `fail` -> `[ ]` plus an inline
`<!-- FAIL: ... -->`, `manual` -> `[~]`, `deferred` -> `[ ]` plus `<!-- DEFERRED -->`), prepends
the `[IMPLEMENTED <date>]` banner above the H1 (idempotent - re-running replaces it), appends the
iteration-log line, and re-renders the HTML sibling via `scripts/plan-to-html.js`.

Exit 1 means an AC id in `--ac` was not found in the plan, or the plan has no `**Status:**` line -
read the warning line and fix the spec rather than editing the plan by hand.

Then:

1. Refresh the repo map when views, routes or modules changed:
   `node scripts/gen-repo-map.js` (or `--check` to see whether it is needed).
2. Tell the user: "Implementation ready on branch `<branch_name>`. The plan is marked as
   implemented. Review the diff and commit when ready." For a module-only plan
   (Phase 6 module-only check), say instead: "Implementation ready in `modules/<id>` (its own
   repository, no remote). The plan is marked as implemented. Review the changes and save a
   version - the Save version button on the module card, or `git -C modules/<id> commit`."
   In worktree mode, say instead: "Implementation ready in worktree `<repo_root>` on branch
   `wt/<slug>`. Review the changes there (`git -C <repo_root> diff`), commit them in the worktree,
   merge into your branch, then `node scripts/worktree.js remove <slug>`." `remove` refuses a dirty
   worktree, an unmerged branch (unless `--keep-branch`) and a running server, and says what to do.
3. Include in the handoff message: the path taken (`fast` / `split`, with the 6a/6b/6c skip notes
   and the lead's `Issues NOT fixed` when any), verifier verdict plus failing ACs, guardian /
   conventions BLOCKs, gate failures, graph review highlights, bug scan result (or "skipped, below
   the size threshold").
