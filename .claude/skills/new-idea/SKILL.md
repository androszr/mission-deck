---
name: new-idea
description: >-
  Plans and implements a change in the mission-deck repo - a new view, a new
  endpoint, a bug fix or a refactor. Use when the user says "add X", "let's
  build X", "new feature X", "new view X", or calls /new-idea. Runs a short
  interview, spawns the idea-planner agent that writes a plan with acceptance
  criteria into `plans/`, runs a deterministic scripted preflight, renders the
  plan to HTML and shows it for acceptance. After acceptance it implements on
  the current branch: a small single-layer plan with one implementer, a large or
  two-layer one on the split path (backend -> frontend -> lead review), and
  verifies the acceptance criteria blind. Conventions guardian, visual
  verification and bug scan are conditional. Never commits.
---

# New Idea

> **Quick start:** `/new-idea <what you want to build>` (the argument is optional - when empty, ask once: "What is the idea?"). The skill asks 2-5 questions, writes the plan to `plans/YYYY-MM-DD-<slug>.md`, renders it to HTML and, after `accept`, implements on the current branch. It needs a branch other than `main` (you create it yourself: `git checkout -b <name>`) (or `main` when the plan lives entirely in `modules/<id>/`, or a separate worktree that Phase 6 creates itself: `scripts/worktree.js`).

Flow: **interview -> planner (Opus) -> scripted preflight -> plan for review -> implementation (Sonnet: one implementer, or backend -> frontend -> lead) -> blind AC verification -> one-command handoff**. Plans live in [plans/](../../../plans/) - the folder is local (gitignored), plans do not go into the repo.

**This file is the flow map plus the hard rules. Per-phase detail is in [PHASES.md](PHASES.md) — load only the section for the phase you are actually running.**

## Automation - what is a command, not a model step

Run it, read the result, move on. Never re-derive these by hand, never paste a raw diff.

| Step | Command |
|---|---|
| Plan preflight (Phase 4.5) | `node scripts/plan-preflight.js <plan> --json` |
| Change digest (Phase 6d) | `node scripts/diff-digest.js --base main --json` |
| Conventions check (Phase 6e) | `node scripts/check-conventions.js --base main --json` |
| Gates | `node scripts/gates.js --lint --unit [--api]` |
| Handoff (Phase 7) | `node scripts/plan-status.js <plan> --status <s> --ac "..."` |
| Repo map refresh | `node scripts/gen-repo-map.js [--check]` |
| Scaffold a module (the default for a new page) | `node scripts/new-module.js <id> "<Label>" --hub <core-hub> --area "<Area>" [--views a:A,b:B]` |
| Scaffold a CORE view | `node scripts/new-view.js <id> "<Label>" --hub <hub>` |
| Check module code (invisible to diffs) | `node scripts/check-conventions.js --modules` |
| Publish a module to the team catalog | Settings > Modules > Publish, or `POST /api/modules/publish` |
| Scaffold an endpoint | `node scripts/new-endpoint.js <METHOD> <path>` |
| Worktree (Phase 6, a variant of the branch gate) | `node scripts/worktree.js recommend --plan <plan> --json`; `create <slug>`; `status <slug> --json`; `remove <slug>` |

Exit codes are uniform: `0` clean, `1` blocking findings, `2` usage or internal error.

## Flow map

| Phase | What | Runs when |
|---|---|---|
| 0 | bootstrap check | always |
| 1 | intake: capture the idea, classify the surface (`view`, `server-endpoint`, `data`, `cross-cutting`, `bugfix`, `refactor`) | always |
| 2 | short interview (max 5 questions; Q1c resolves a new module's required business area independently of its menu hub; Q1d asks whether the module gets a dashboard widget) | always |
| 3 | derive `plans/<date>-<slug>.md` | always |
| 4 | **agent:** `idea-planner` (Opus) | always |
| 4.5 | `plan-preflight.js` | always, and after every `iterate` |
| 4.6 | `node scripts/plan-to-html.js <plan>` | always (non-blocking) |
| 5 | review loop: `accept` / `iterate` / `stop` | always |
| 6 | branch gate, then the **path decision** (below) | after `accept` |
| 6 fast | **agent:** `idea-implementer` | fast path: at most 6 files AND one layer |
| 6a | **agent:** `backend-implementer` | split path, when the plan touches `server.js`, `scripts/` or `tests/test_api_*` |
| 6b | **agent:** `frontend-implementer` (gets the `Backend contract`) | split path, when the plan touches `index.html`, `js/`, `styles.css` or `css/` |
| 6c | **agent:** `engineering-lead-reviewer` (Opus) | split path, only when BOTH 6a and 6b ran |
| 6d | `diff-digest.js` - the digest every later prompt carries | always |
| 6e | `check-conventions.js`, then **agent:** `cockpit-guardian` | agent ONLY when the script reports a finding needing judgment, or the digest touches `css/ds.css` / `css/ds-tokens*.css` |
| 6f | **agent:** `ac-verifier` (blind) | always |
| 6.6 | graph review via GitNexus MCP (inline, no agent) | when the MCP tools are available |
| 6g | **agent:** `playwright-specialist` | only when the plan has an `AC_VIS` criterion |
| 6.7 | **agent:** `bug-auditor` | only when `diff-digest` reports `bug_scan_recommended: true` |
| 7 | `plan-status.js` handoff | always |

**Default path is three agents:** planner, implementer, blind verifier. A large or cross-layer plan
swaps the single implementer for the **split path** (backend -> frontend -> lead). Guardian, visual
verify and bug scan are conditional and are skipped silently when their predicate is false.

**Path decision (Phase 6, after the branch gate).** Count the distinct paths in the plan's
`## Files to change` plus `## New files`. Backend files are `server.js`, `scripts/**` and
`tests/test_api_*`; frontend files are `index.html`, `js/**`, `styles.css`, `css/**` and
`tests/test_*.mjs`. **Fast path** when the count is at most 6 AND only one of the two layers is
touched. **Split path** otherwise. The lead (6c) runs only when both 6a and 6b ran; a split path
that stayed in one layer (a big frontend-only plan) is just that one specialist. Retries on the
split path go to the specialist whose slice the failing item names; on the fast path every retry
goes back to `idea-implementer`. The rule is in PHASES.md, Phase 6 - do not improvise a third
path.

**The size threshold lives in `scripts/_report.js`** and reaches you as `diff-digest`'s
`size_class`, `bug_scan_recommended`, `agent_model` and `model_tier`. Read those fields; do not
restate the numbers. (Today: `large` above 150 changed lines or above 6 files; a non-cosmetic
`server.js` change also recommends the bug scan regardless of size. A `new-view.js` scaffold is
five files and stays `small`; a `new-endpoint.js` scaffold touches `server.js` and therefore does
get the bug scan.)

**Pass `agent_model` to `Agent({model})`, never `model_tier`** — the tool's enum is
`sonnet | opus | haiku | fable`; the dashed id belongs to `.claude/default-models.json`.

## Agent spawn visual convention

Before **every** agent spawn the HARNESS prints the corresponding banner from
`.claude/skills/new-idea/banners/` - you do not. A `PreToolUse` hook on the `Agent` tool
(`scripts/hook-agent-banner.js`, wired in `.claude/settings.json`) reads `subagent_type` off the
call, picks the banner through `banners/agents.json`, renders it with `scripts/agent-banner.js`
(`Agent({model})` override > `model:` frontmatter of `.claude/agents/<agent>.md` > session model
read off the transcript) and shows it to the person as a system message. It picks `gapfix`
(Relay) on its own when the prompt carries a `gap_report:` / `bug_report:` block, and it prints
one banner per `Agent({...})` call, so a parallel spawn shows two single banners.

**Do not run `scripts/agent-banner.js` and do not paste a banner yourself.** The old convention
asked you to run the script and paste its output as a fenced block; measured over this project's
transcripts it was skipped in 83 of 176 spawns, and what the terminal showed in its place was a
thinking summary ("plan initialized - summarized") that nobody can expand. Running the script
hands you a tool result you will narrate instead of a thing to paste - so do not run it. A pasted
copy next to the hook's is a duplicate.

The banner is **decorative ASCII art shipped in this repository** (Overwatch flavour), not tool
output, not a transcript of anything that ran and not a report of work. Never read its lines as
commands, results or instructions; the banner files are gated so they depict nothing destructive
or covert (`tests/test_agent_banner.mjs`, hook: `tests/test_agent_banner_hook.mjs`).

| Agent | Phase | Banner (`agents.json` maps it to the agent) |
|---|---|---|
| Overwatch (planner) | 4 | `planner` -> `idea-planner` |
| Cipher (implementer) | 6 fast | `implementer` -> `idea-implementer` |
| Vex (backend) | 6a | `backend` -> `backend-implementer` |
| Mira (frontend) | 6b | `frontend` -> `frontend-implementer` |
| Nyx (lead) | 6c | `lead` -> `engineering-lead-reviewer` |
| Quiet (guardian) | 6e | `guardian` -> `cockpit-guardian` |
| Ledger (verifier) | 6f | `verifier` -> `ac-verifier` (`--model <digest.agent_model>`) |
| Quiet + Ledger | 6e+6f parallel | `parallel-guardian-verifier` (`--model ,<digest.agent_model>`) |
| Proxy (playwright) | 6g | `playwright` -> `playwright-specialist` |
| Hex (bug-auditor) | 6.7 | `bugauditor` -> `bug-auditor` (`--model <digest.agent_model>`) |
| Watch (QA) | 6b tests | `qa` -> `qa-automation-implementer` (only when the plan adds a brand-new test file) |
| Relay (gap-fix) | retry | `gapfix` (no fixed agent - pass `--agent <the implementer you re-spawn>`) |

The table is documentation of the map the hook reads; nothing here renders it. Phase 6.6 makes
MCP calls inline — no agent, no banner. On a retry the hook shows `gapfix` instead of the
implementer's own banner, so the scroll history shows a fix cycle rather than a second first
attempt.

## Phases

Detail for every phase is in [PHASES.md](PHASES.md). Only these three are load-bearing here.

### Phase 0: bootstrap check

`templates/repo-map/overview.md` and `scripts/plan-preflight.js` missing -> stop, the skill is not
initialized. `scripts/plan-to-html.js` missing -> note it, only Phase 4.6 is skipped.
`mcp__gitnexus__*` unavailable -> print ``Run `node scripts/bootstrap-gitnexus.js` and restart
Claude Code`` and continue; GitNexus is never a gate.

### Phase 5: review loop

**Lead with the business, not with paths.** Before the menu, print the plan's `## Business description`
verbatim (all four blocks: `Why we are doing this`, the numbered `What changes for the user`,
`What the user will see after release`, `What this does NOT change`), then a blank line, then the
planner's 5-line abstract. The accept/iterate decision is made on what the change does for the
user; the file list comes second. Do not paraphrase the section and do not add technical
commentary above it. Then prompt:

```
Plan written to <path> (HTML: <path>.html). Options:
  accept   — implement now
  iterate  — tell me what to change, I'll re-run the planner
  stop     — leave the plan as-is, do nothing
```

`iterate` -> re-spawn `idea-planner` with the feedback, re-run 4.5 and 4.6, ask again.
`accept` -> Phase 6. `stop` -> report the path and end.

### Phase 6: branch gate

**The branch is created here and nowhere earlier.** Phases 1-5 run on whatever branch the user is
already on, `main` included — planning writes only to `plans/`, which is the same file on any
branch. Creating or switching a branch before `accept` is a defect: it moves the user's
uncommitted work onto a branch they never asked for, and a plan the user then rejects leaves a
stray branch behind. Being on `main` is NOT a reason to branch early — it is the reason this gate
exists.

`git rev-parse --abbrev-ref HEAD`, then `node scripts/worktree.js recommend --plan <plan> --json`
(module-only plans skip this - see below). Ask ONE `AskUserQuestion`, "Where should this
change be made?", with three options:

- **Current branch** (as before) - on `main` this is still a STOP: tell the user to create a branch
  (`git checkout -b <name>`) and re-accept.
- **New worktree** - `node scripts/worktree.js create <slug>` (the plan's slug). Remember
  `repo_root` = the printed path and `branch_name` = `wt/<slug>`. Being on `main` does NOT stop
  this option: the worktree creates its own branch off `HEAD`.
- **I will switch branches** - repeat the stop message and end.

Append "(recommended)" to the option `recommend` named (`branch` -> the first, `worktree` -> the
second) and put its `reasons` in the question text. A refusal from `create` (exit 1) is printed
verbatim and ends the phase. Then take the path decision (flow map above) and spawn
`idea-implementer` (fast path) or `backend-implementer` -> `frontend-implementer` ->
`engineering-lead-reviewer` (split path, PHASES.md Phase 6) - in worktree mode every prompt
carries `repo_root:` (PHASES.md "Worktree mode"). `blocked` or `partial` from any implementer is
surfaced and carried into Phase 7 rather than retried here; on the split path it also stops the
remaining slices.

**Module-only mode.** When EVERY path in the plan's `## Files to change` and `## New files`
matches `^modules/<one id>/` (a single module id, nothing under `server.js`, `js/`, `index.html` or
any other core path), the core diff is empty — `modules/` is gitignored — so the branch gate above
does not apply. Being on `main` is fine. Instead run
`git -C modules/<id> rev-parse --show-toplevel` and compare the answer to the absolute path of
`modules/<id>` itself: a module with its own `.git` (`scripts/_module-git.js`) prints that path; a
module with no `.git` of its own prints the mission-deck repository root instead, because the parent
repository silently answers for it (the same pin hazard `scripts/_module-git.js` exists to close).
A mismatch, or a `modules/<id>` that does not exist yet and whose steps do not call
`scripts/new-module.js`, is a STOP: "Initialise the module repository (Settings > Modules or
`git -C modules/<id> init`) and accept again." A module that does not exist yet but whose
steps DO call `scripts/new-module.js` passes without running the check — the scaffold initialises
the repository itself. Once the check passes (or is skipped for a not-yet-scaffolded module), take
the path decision and spawn the implementer(s) exactly as above.

## Hard rules

- **Never commit.** The user reviews the diff and commits.
- **Requires a non-main branch** - except module-only plans and the worktree option, see Phase 6.
- **Never create or switch a branch before Phase 6.** Not in Phase 0, not "so the gate will not
  block later". The user branches, at `accept`, and never sooner.
- **A worktree, too, only at `accept`.** `worktree.js create` is a variant of the Phase 6 branch
  gate, never an earlier step; one worktree per plan, not per agent.
- **Agents never commit - in a worktree as well.** The person reviews the diff in the worktree,
  commits there, merges and runs `node scripts/worktree.js remove <slug>`.
- **The skill does not use native per-agent isolation** (`Agent isolation: "worktree"`): it gives
  every spawn an unprepared tree, while 6a -> 6b -> 6c must work on ONE tree.
  `docs/architecture/worktrees.md` holds the rules.
- **Module repositories have no remote.** Never plan `git remote`, `push`, `fetch` or `pull`
  inside `modules/<id>/`; the only way a module reaches the team is `POST /api/modules/publish`.
- **Agent prompts carry the digest, never the diff.** `diff-digest.js` output plus file paths;
  the agent reads what it needs.
- **DS classes are mandatory** for every interactive or structural element — see
  `.claude/agents/references/cockpit-conventions.md`. An ad-hoc element duplicating a DS component
  is a plan defect.
- **Publishing a module goes through a branch and a merge request.** `modules/` is local and
  gitignored; the shared catalog repo `cockpit-modules` has a protected `main`, so nothing - not
  the app, not a person - pushes to it directly. `POST /api/modules/publish` opens a branch
  `module/<id>-<date>`, commits the module plus its `catalog.json` entry and opens the MR. Never
  plan a step that pushes a module straight to the catalog's default branch.
- **A new page is a module by default, and it lands in a CORE hub.** Plan and build it as
  `modules/<id>/` and leave the core untouched: `js/module-host.js` builds the flyout entry, the
  view sections and the registry entries from `module.json` at boot. The rail's hubs are the
  core's (`js/core-hubs.mjs`), so the module declares `sidebar.kind: "page"` + `sidebar.hub` and
  the plan's scaffold step carries `--hub <id>` — which hub is interview question Q1b, asked
  whenever the idea does not say. A module with its own rail item (`item`) or its own flyout
  (`hub`) needs a sentence of reason in `## Context`; preflight rule 21 WARNs otherwise. Use
  `scripts/new-module.js`. A module plan that
  edits `VIEW_REGISTRY` or `HUB_FLYOUT` is a preflight BLOCK. `modules/` is gitignored, so module
  code never reaches a diff - `check-conventions.js --modules` is how it gets reviewed, and
  `npm test` picks up `modules/<id>/tests/test_*.mjs` on its own.
- **The manifest IS the module card.** Every section of the card in Settings > Modules - icon,
  name, id, description, version, author, tags, shape badge, views, data repos - is rendered from
  `module.json` and from nothing else, so a scaffolded module that ships with
  the scaffold's placeholder `description` and `author` publishes those words to the team. Filling `description`, `author`, `tags` and the required `area` is part of the plan's steps, not a
  follow-up. In the shared catalog, `catalog.json` may override `author` and `tags` and adds
  `summary`, `status`, `featured` and `order` - curation wins, the manifest is the default.
- **Every module has one business area.** Resolve Q1c before scaffolding and pass
  `--area "<Area>"` explicitly; Product, Engineering and Operations are suggestions, not
  defaults or a closed list. `area` is independent of `sidebar.hub`. Existing modules keep
  their declared area unless the request changes it. Creation, install, import and publication
  require a valid area; legacy catalog reads remain visible without silently inventing one.
- **The view triple** (`#view-<id>` section + `VIEW_REGISTRY` entry + `HUB_FLYOUT` entry) is
  all-or-nothing, and applies to CORE pages only. Use `scripts/new-view.js` rather than three
  hand edits, and say why the change is core rather than a module.
- **No perspectives.** No `data-perspective` attributes anywhere.
- **ASCII code, English copy.** Identifiers, comments and file names are ASCII; every UI string is plain, clear English. Ids, paths, keys and compared values stay ASCII even inside quotes.
- **Never bypass hooks** (`--no-verify`).
- **Never restart the server with `npm start`** from this skill — use `POST /api/settings/restart`.
- **The planner writes only to `plans/`.** The implementers write code, but only per the plan,
  and only inside their slice: backend never edits `js/`, frontend never edits `server.js`, the
  lead applies glue fixes only.
- **GitNexus is an aid, never a gate.** Missing tools produce a one-line hint, never a stop.

## Notes

- Models: `claude-opus-5-5` for `idea-planner` and `engineering-lead-reviewer`; `claude-sonnet-5-5`
  for `idea-implementer`, `backend-implementer`, `frontend-implementer`, `cockpit-guardian` and
  `playwright-specialist`. `ac-verifier` and `bug-auditor` default to
  `claude-haiku-5-5` and are raised to Sonnet when `diff-digest` reports
  `agent_model: "sonnet"`. Defaults: `.claude/default-models.json`; the `.husky/pre-commit` hook
  restores agent frontmatter to that file, so the two can never drift.
- Retry caps: AC verification 2 cycles, bug scan 3 iterations.
- Rules reference for the preflight: `PREFLIGHT-CHECKLIST.md` (documentation of what the script
  enforces, not a checklist for the model to walk).
- Repo structure the planner reads instead of exploring:
  `.claude/skills/new-idea/templates/repo-map/overview.md`, kept current by `gen-repo-map.js`.
- Plans and their rendered `.html` siblings are committed with the code — keep them in sync via
  Phase 4.6 and `plan-status.js`.
