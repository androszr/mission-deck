---
name: mini
description: >-
  Plans and implements a change in a mini app (Vite + React 18 + TypeScript)
  registered in `.claude/skills/mini/projects/<project>/context.md`. Use when
  the user says "add X to <mini app>", "new screen in <project>", names a
  registered project or calls /mini. A short interview, the planner (Opus) writes a plan
  to `plans/`, a deterministic preflight from the checklist, the plan for acceptance, after
  `accept` one implementer (Sonnet) on the current branch, blind verification of the criteria
  on disk and a bug scan. No registered project -> the skill says how to add one.
  Changes to Mission Deck itself go through /new-idea.

---

# Mini

> **Quick start:** `/mini <co chcesz zbudowac>`. The skill resolves the project from the registry,
> asks 1-3 questions, writes a plan to `plans/`, shows the abstract, implements on your current
> branch after `accept`. Requires a non-main branch in this repo and a registered project.

## Project registry

Each mini app is a directory `.claude/skills/mini/projects/<project>/` with a `context.md` whose
identity table declares `src_dir`, `src_repo`, `build_gate`, `lint_gate`, `slug_prefix` and
`entry`. The registry ships **empty**: read
[projects/README.md](projects/README.md) and copy
[projects/_template/context.md](projects/_template/context.md) to register the first app. The
source of a mini app is its own repo (typically cloned under `data-sub-repositories/<name>/`);
the cockpit repo holds only the plan and the context file.

Two-phase flow: **interview -> `mini-planner` (Opus) -> plan file -> after `accept`
`mini-implementer` (Sonnet) -> `mini-verifier` -> `mini-bug-auditor` -> handoff**.

## Args

`/mini <idea>` - optional. Empty -> ask once: "What is the idea?"

## Agent spawn visual convention

Same as `/new-idea`: the `PreToolUse` hook on `Agent` (`scripts/hook-agent-banner.js`) shows the
banner from `mini/banners/` before every `Agent({...})` call. Do not run `scripts/agent-banner.js`
and do not paste a banner yourself - the table below documents the map the hook reads.

| Agent | Phase | Banner |
|---|---|---|
| Overwatch (planner) | 4 | `planner` -> `mini-planner` |
| Cipher (implementer) | 6 | `implementer` -> `mini-implementer` |
| Ledger (verifier) | 6f | `verifier` -> `mini-verifier` |
| Hex (bug scan) | 6.7 | `bugauditor` -> `mini-bug-auditor` |

## Phases

### Phase 0: bootstrap

`ls -d .claude/skills/mini/projects/*/context.md` excluding `_template`. None -> print the
registration instructions from `projects/README.md` and stop. For each registered project read the
identity table; verify `<src_dir>` exists (`ls <src_dir>`). Missing -> tell the user to clone or
sync that project first and stop.

### Phase 0.5: project detection

Match the idea text against each registered project's `keywords` row. One match -> select it. None
or several -> `AskUserQuestion` with the registered project keys (max 4 per call). Set `project`,
`src_dir`, `src_repo`, `build_gate`, `lint_gate`, `slug_prefix`, `context_file` from the table.
Echo `**Project:** <project>` in the Phase 5 abstract.

### Phase 1: intake

Capture the idea. One project per invocation, one template, no backend branch - go to the interview.

### Phase 2: interview

Load `templates/questions.md`. At most **3** questions, one `AskUserQuestion` at a time. Answer
from `<src_dir>` first (Read/Grep/Glob); "go with your recommendations" -> defaults and exit.

### Phase 3: plan path

Slug `<slug_prefix><idea-slug>` (<=40 chars, ASCII). Path `plans/<YYYY-MM-DD>-<slug>.md`,
collision -> `-2`. Template `templates/plan.md`.

### Phase 4: planner

The spawn hook shows banner `planner`; then:

```
Agent({
  subagent_type: "mini-planner",
  description: "Plan: <slug>",
  prompt: "Mode: new
Idea: <idea>
Project: <project>
Answers:
- <key>: <value>
plan_path: <absolute>
template_path: <absolute path to .claude/skills/mini/templates/plan.md>
project_context_path: <absolute path to .claude/skills/mini/projects/<project>/context.md>

Read the project context FIRST, then verify every path against <src_dir> before quoting it."
})
```

Returns `PLAN: <path>` plus the abstract. `iterate` -> `Mode: iterate` plus `Feedback:`.

### Phase 4.5: preflight

Walk [PREFLIGHT-CHECKLIST.md](PREFLIGHT-CHECKLIST.md) with Bash/grep over the plan (no agent).
Rules tagged `[project]` apply only when the project's context declares them under
`## Preflight extras`. Any BLOCK -> show the abstract plus the BLOCKs, prompt `iterate` / `stop`.
WARN only -> one line and continue. Re-run after every `iterate`.

### Phase 5: review loop

Show the abstract (with `**Project:**`) and prompt `accept` / `iterate` / `stop` exactly as
`/new-idea` Phase 5.

### Phase 6: branch gate + implementer

1. `git rev-parse --abbrev-ref HEAD` in the cockpit repo. `main` -> STOP, tell the user to create a
   branch (`git checkout -b <name>`) and re-accept. Otherwise confirm the branch with
   `AskUserQuestion`.
2. The spawn hook shows banner `implementer`; then:

```
Agent({
  subagent_type: "mini-implementer",
  description: "Implement: <slug>",
  prompt: "plan_path: <absolute>
project: <project>
project_context_path: <absolute>

Read your brief, the project context, then the plan; execute Steps in order under <src_dir> (never a
build clone). Gates: <build_gate> and <lint_gate>. Do not commit anywhere. Report per your brief."
})
```

`blocked` or `partial` -> Phase 7 with the failure noted.

### Phase 6f: blind verification

**Grep-AC fast path:** when every AC is a runnable command, run them with Bash, record PASS/FAIL,
skip the agent. Otherwise (the spawn hook shows banner `verifier`):

```
Agent({
  subagent_type: "mini-verifier",
  description: "Verify AC: <slug>",
  prompt: "plan_path: <absolute>
branch_name: <branch>
project: <project>
project_context_path: <absolute>"
})
```

The prompt carries no implementer report. `FAIL` -> gap report, retry cap **2**, re-dispatch
`mini-implementer`, re-spawn only the verifier.

### Phase 6.7: bug scan

Skip when `blocked` or nothing changed under `<src_dir>`. Scoring FUNC 20/8, REQ 15/6, UX 4/2,
`SHIP_THRESHOLD = 5`, FUNC blocker forces ITERATE, `MAX_ITER = 3`. Spawn (the spawn hook shows banner `bugauditor`)
`mini-bug-auditor` with `plan_path`, `iteration`, `project`, `project_context_path` (plus
`previous_bug_report` and `fix_report` on later cycles). `ITERATE` -> `mini-implementer` with
`bug_report`.

### Phase 7: handoff

`node scripts/plan-status.js <plan> --status done|partial|blocked --ac "AC1=pass,..." --iteration-note "Bug scan: <SHIP|PARTIAL> after <n>."`
Then: "Implementation ready on branch `<branch>`; the changes in `<src_dir>` are waiting for your
review and a commit in the project repo. The plan is marked as implemented."

## Hard rules

- **DS components from the project's `src/ds/` barrel** for every interactive or structural element.
- **All three breakpoints in one pass; mobile is protected.** Additive `min-width` blocks only;
  tablet is `(min-width: 768px) and (min-height: 500px)`; `DSBottomSheet` mobile-only via JS.
- **Charts show both axes.** **CSS modules** for new components. **Hash routing** for navigable state.
- **ASCII-only** identifiers and comments; English in JSX strings.
- **The planner writes only to `plans/`.** The implementer writes only under `<src_dir>`.
- **Never commit** - not here, not in the project's repo. **Never edit a build clone.**
- **Never bypass hooks.**

## Notes

- Models: `.claude/default-models.json` (`mini-planner` Opus, the rest Sonnet).
- Plans share `plans/` with `/new-idea` - the `slug_prefix` keeps them apart.
- Retry caps: AC verification 2, bug scan 3.
