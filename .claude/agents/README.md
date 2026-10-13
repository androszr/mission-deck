# Agents Index

All **22** agents in `.claude/agents/`. The `/new-idea` pipeline first, then the auditors, then the
standalone ones.

Models: **Opus** (`claude-opus-5-5`) for planning, lead review and audit review; **Sonnet**
(`claude-sonnet-5-5`) for implementation (one implementer, or backend + frontend) and the guardian;
**Haiku** (`claude-haiku-5-5`) for blind AC verification and the bug scan on a small change, and
`claude-haiku-5-5` for commit messages. Defaults: [.claude/default-models.json](../default-models.json) -
that file is the source of truth; the `.husky/pre-commit` hook
(`scripts/restore-agent-models-for-commit.js`) restores the `model:` lines in the agents'
frontmatter to those values on every commit.

**Per-run tiering:** `ac-verifier` and `bug-auditor` start on Haiku and are raised to
`claude-sonnet-5-5` when `node scripts/diff-digest.js --json` returns
`model_tier: "claude-sonnet-5-5"` (a change above the size threshold in `scripts/_report.js`).
The threshold is defined once and cannot drift.

Skill entry points: [.claude/skills/README.md](../skills/README.md).
Canonical repo conventions: [references/cockpit-conventions.md](references/cockpit-conventions.md).

## The `/new-idea` pipeline

| Agent | When used (skill/phase) | Model | Role (1 sentence) |
|---|---|---|---|
| [idea-planner.md](idea-planner.md) | `/new-idea` Phase 4 (plan) and Phase 4-iterate | `claude-opus-5-5` | Writes the implementation plan with acceptance criteria into `plans/`; writes no code. |
| [idea-implementer.md](idea-implementer.md) | `/new-idea` Phase 6 **fast path** (plan up to 6 files, one layer) and retries after a gap/bug report | `claude-sonnet-5-5` | Carries a small plan end to end across all layers in one agent; the gates are lint and tests. |
| [backend-implementer.md](backend-implementer.md) | `/new-idea` Phase 6a **split path** (larger or two-layer plan) and retries that hit the backend | `claude-sonnet-5-5` | Backend slice: `server.js`, `scripts/`, `tests/test_api_*`. Hands over a `Backend contract` for the frontend. |
| [frontend-implementer.md](frontend-implementer.md) | `/new-idea` Phase 6b split path and retries that hit the frontend | `claude-sonnet-5-5` | Frontend slice: `index.html`, `js/`, `styles.css`, `css/`. Builds to the backend contract; view triple, DS, cleanup. |
| [qa-automation-implementer.md](qa-automation-implementer.md) | `/new-idea` Phase 6b split path (test slice) - only when the plan adds a new test file (otherwise the phase runs inline) | `claude-sonnet-5-5` | Test slice: `tests/test_*.mjs` and `tests/test_api_*.js`; never touches production code. |
| [engineering-lead-reviewer.md](engineering-lead-reviewer.md) | `/new-idea` Phase 6c - only when 6a and 6b both ran | `claude-opus-5-5` | Checks that the layers agree (URL, JSON shape, view triple, a test per route) and makes only small glue fixes. |
| [cockpit-guardian.md](cockpit-guardian.md) | `/new-idea` Phase 6e and `/pre-ship-audit` Phase 2 - **conditional**: only when `scripts/check-conventions.js` leaves something to judge or the change touches `css/ds*.css` | `claude-sonnet-5-5` | The judgment half of the conventions; the mechanical half is in the script. Returns BLOCK/WARN/NOTE + VERDICT. |
| [ac-verifier.md](ac-verifier.md) | `/new-idea` Phase 6f (always) | `claude-haiku-5-5` / Sonnet above the threshold | Blind acceptance-criteria verifier - reads only the plan and the change it fetches itself; never the implementer's reports. |
| [playwright-specialist.md](playwright-specialist.md) | `/new-idea` Phase 6g (only when the plan has `AC_VIS` criteria) | `claude-sonnet-5-5` | Visual verification in a live browser through Playwright MCP; changes no files. |
| [bug-auditor.md](bug-auditor.md) | `/new-idea` Phase 6.7 - **conditional**: only when `diff-digest` returns `bug_scan_recommended: true` | `claude-haiku-5-5` / Sonnet above the threshold | Scans the implementation for bugs (FUNC/REQ/UX) - returns a SHIP\|ITERATE verdict. |

## Auditors

| Agent | When used (skill/phase) | Model | Role (1 sentence) |
|---|---|---|---|
| [code-quality-auditor.md](code-quality-auditor.md) | `/pre-ship-audit` Phase 2 (in parallel) | `claude-opus-5-5` | Reviews the diff for logic correctness, races and missed edge cases. |
| [security-auditor.md](security-auditor.md) | `/pre-ship-audit` Phase 2 (in parallel) | `claude-opus-5-5` | Looks for vulnerabilities (subprocess injection, path traversal, token leaks, a missing lock). |
| [qa-automation-auditor.md](qa-automation-auditor.md) | `/pre-ship-audit` Phase 2 (diff mode) + `/qa-audit` Phase 2 (whole-repo mode) | `claude-opus-5-5` | Assesses test coverage and the quality of the existing tests. |

## `/mini` - mini apps (Vite + React + TypeScript)

Projects are registered in `.claude/skills/mini/projects/<project>/context.md` - the agents read
that file as the source of truth (paths, gates, project conventions).

| Agent | When used | Model | Role (1 sentence) |
|---|---|---|---|
| [mini-planner.md](mini-planner.md) | `/mini` Phase 4 | `claude-opus-5-5` | Writes the plan for a change to a mini app from the project's context file. |
| [mini-implementer.md](mini-implementer.md) | `/mini` Phase 6 and retries | `claude-sonnet-5-5` | Carries out the plan in the project's source directory; the gates are the project's build and lint. |
| [mini-verifier.md](mini-verifier.md) | `/mini` Phase 6f | `claude-sonnet-5-5` | Blind verification of the criteria on disk plus the mobile-view protection check. |
| [mini-bug-auditor.md](mini-bug-auditor.md) | `/mini` Phase 6.7 - conditional | `claude-sonnet-5-5` | Bug scan at three breakpoints; SHIP\|ITERATE. |

## `/prototype` - mockups

| Agent | When used | Model | Role (1 sentence) |
|---|---|---|---|
| [proto-ds-guardian.md](proto-ds-guardian.md) | `/prototype` Phase 6e (always) | `claude-sonnet-5-5` | Design System gate for a prototype: `scripts/check-proto-ds.js` first, then a judgment of conformance with the Figma catalog. |

Prototypes also use shared agents: `idea-planner` (plan), `frontend-implementer`
(build in the data repo), `ac-verifier` (criteria on disk), `playwright-specialist` (screenshots).

## Documents and research

| Agent | When used | Model | Role (1 sentence) |
|---|---|---|---|
| [meeting-summarizer.md](meeting-summarizer.md) | `/summarize-meeting` | `claude-opus-5-5` | Two passes: pick a template from `templates/meeting-notes/`, then fill it with the transcript's content. |
| [researcher.md](researcher.md) | product research (manual) | `claude-opus-5-5` | Gathers evidence from documents, data and code; an evidence table plus a list of opportunities. |
| [reviewer.md](reviewer.md) | after `researcher` (manual) | `claude-opus-5-5` | Adversarial review of research material: evidence quality, citation accuracy, gaps. |

## Standalone

| Agent | When used (skill/phase) | Model | Role (1 sentence) |
|---|---|---|---|
| [commit-message-writer.md](commit-message-writer.md) | `/commit-message` step 3 | `claude-haiku-5-5` | Analyses the diff and proposes Conventional Commits message(s); returns `NO_CHANGES` when the diff is empty. |

## Handoff in the pipeline

The default path is **three agents**: planner, implementer, blind verifier. The rest join
conditionally.

```
idea-planner (plan)
  -> scripts/plan-preflight.js          (all rules, one command)
  -> scripts/plan-to-html.js
  -> human accept
  -> idea-implementer                   (gates through scripts/gates.js)
      -> scripts/diff-digest.js         (change digest - this goes into prompts, not the diff)
      -> scripts/check-conventions.js
           -> cockpit-guardian          [only when something is left to judge / css/ds*.css touched]
      -> ac-verifier (blind)            [always, in parallel with the guardian]
      -> graph review (GitNexus, inline - no agent)
      -> playwright-specialist          [only when the plan has AC_VIS criteria]
      -> bug-auditor                    [only when digest: bug_scan_recommended]
  -> scripts/plan-status.js             (status, AC checkboxes, banner, log, HTML re-render)
```

No agent commits. A human approves the diff.

## Spawn banners

Every agent on the roster has its own banner. The files live in `.claude/skills/<skill>/banners/`,
and the `banner -> agent` map is kept in `agents.json` next to them. No banner hard-codes a model -
they all carry the `{{MODEL}}` placeholder, which `scripts/agent-banner.js` fills with the model
that will really run the agent (`Agent({model})` > `model:` from the frontmatter > the session
model). That way a banner cannot lie after the model is changed in Settings > Agents. The banner
is drawn by the harness, not the model: a `PreToolUse` hook on the `Agent` tool
(`scripts/hook-agent-banner.js`, wired in `.claude/settings.json`) reads `subagent_type` from the
call, picks the banner through `agents.json` and shows it as a system message - left to the model,
the banner was skipped in roughly half the spawns.

Each agent carries a crew callsign; it is flavour only and changes nothing about the agent.

| Agent | Callsign | Banner |
|---|---|---|
| `idea-planner` | Overwatch | `new-idea/planner`, `prototype/planner`, `mini/planner` (`mini-planner`) |
| `idea-implementer` | Cipher | `new-idea/implementer`, `mini/implementer` (`mini-implementer`) |
| `backend-implementer` | Vex | `new-idea/backend` |
| `frontend-implementer` | Mira | `new-idea/frontend`, `prototype/frontend`, `prototype/gapfix` |
| `engineering-lead-reviewer` | Nyx | `new-idea/lead` |
| `qa-automation-implementer` | Watch | `new-idea/qa` |
| `cockpit-guardian` | Quiet | `new-idea/guardian`, `pre-ship-audit/guardian` |
| `proto-ds-guardian` | Quiet | `prototype/guardian` |
| `ac-verifier` | Ledger | `new-idea/verifier`, `prototype/verifier`, `mini/verifier` (`mini-verifier`) |
| `bug-auditor` | Hex | `new-idea/bugauditor`, `mini/bugauditor` (`mini-bug-auditor`) |
| `playwright-specialist` | Proxy | `new-idea/playwright`, `prototype/playwright` |
| `code-quality-auditor` | Canon | `pre-ship-audit/quality` |
| `security-auditor` | Forge | `pre-ship-audit/security` |
| `qa-automation-auditor` | Watch | `pre-ship-audit/qa`, `qa-audit/auditor` |
| `commit-message-writer` | Relay | `commit-message/writer` |
| `meeting-summarizer` | Canon | `summarize-meeting/summarizer` |
| `researcher` | Vex | `_shared/researcher` |
| `reviewer` | Nyx | `_shared/reviewer` |
| - (retry of any implementer) | Relay | `new-idea/gapfix` (no fixed entry - `--agent <agent>`) |
| - (built-in `general-purpose`) | Overwatch | `review-pr/review` (no `{{MODEL}}` - inherits the session model) |

`_shared/` is not a skill: the directory starts with `_`, so `GET /api/skills/list` skips it.
It is a shelf for the banners of agents called by hand, outside any skill.

## Scripts that replaced agent work

| Script | What it took over |
|---|---|
| `scripts/plan-preflight.js` | Phase 4.5 done by hand (about 17 grep calls per plan iteration). |
| `scripts/check-conventions.js` | The mechanical majority of `cockpit-guardian` - the agent became conditional. |
| `scripts/diff-digest.js` | The full diff in prompts; now a digest + paths. Also returns the size threshold and the model tier. |
| `scripts/gates.js` | Full lint/test output in context. |
| `scripts/plan-status.js` | The whole of Phase 7 (a dozen edits to the plan file). |
| `scripts/gen-repo-map.js` | Updating the planner's repo map by hand. |
| `scripts/new-view.js` / `scripts/new-endpoint.js` | Scaffolding a view and an endpoint (the most common tasks in this repo). |
| `scripts/agent-banner.js` | Typing the model into spawn banners by hand. The `{{MODEL}}` placeholder gets the model that will really run the agent: `Agent({model})` > `model:` from the agent's frontmatter (edited in Settings > Agents) > the session model. |

Full list with descriptions: [CLAUDE.md](../../CLAUDE.md), section **Automation**.
