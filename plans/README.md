# plans/

Plans created by the [`/new-idea`](../.claude/skills/new-idea/SKILL.md) skill. Every plan is
a pair of files: the source markdown and the rendered HTML next to it.

## Naming

```
plans/YYYY-MM-DD-<slug>.md      the plan (source of truth)
plans/YYYY-MM-DD-<slug>.html    a render for reading in the browser
```

- `YYYY-MM-DD` — the date the plan was created.
- `<slug>` — kebab-case, ASCII-only, max 40 characters, derived from the idea.
- Name collision: suffix `-2`, `-3`.

The HTML is produced by `node scripts/plan-to-html.js <plan.md>` — the skill does it automatically
in phase 4.6 and again after implementation (phase 7). Do not edit the `.html` by hand; change the
`.md` and render again.

Plans are **local** — `plans/*` is in `.gitignore` (the only committed file is this README,
so the folder exists after a clone). Everyone keeps their plans on their own machine; they do not
go into the repo. Working notes and screenshots go to `user-data/` (also gitignored).

## File structure

The H2 sections are a fixed contract — the preflight, the implementer and the verifier parse them.
Do not remove any of them:

`## Business description`, `## Idea`, `## Context`, `## Files to change`, `## New files`, `## Steps`,
`## Risks & footguns`, `## Test plan`, `## Acceptance criteria`, `## Out of scope`,
`## Iteration log`.

Phase 6.6 also appends `## Graph review` (the GitNexus blast-radius table) — adding new H2
sections is fine, removing existing ones is not.

Template: [.claude/skills/new-idea/templates/plan.md](../.claude/skills/new-idea/templates/plan.md).

## The Status field

In the plan header:

```
**Status:** draft
```

Values:

| Status | Meaning |
|---|---|
| `draft` | the plan is written and waits for a human to accept it |
| `done` | implemented, every acceptance criterion passed |
| `partial` | partly implemented — some ACs failed or bugs remained after 3 iterations |
| `blocked` | implementation stopped; the reason is in `## Iteration log` |

## The IMPLEMENTED banner

After implementation the skill adds one line **above the H1**:

```
> **[IMPLEMENTED 2026-09-04]** — status: done. See ## Iteration log.
```

The banner is inserted only once. The details (how many ACs passed, the bug-scan result, how many
iterations) go to `## Iteration log`:

```
- 2026-09-04 implemented (done). AC: 5 pass / 0 fail / 1 manual. Graph review: 0 HIGH/CRITICAL. Bug scan: SHIP after 1 iteration(s).
```

## Rules

- The `idea-planner` agent writes the plan, and **only it** writes to `plans/`.
- The implementer does not edit the plan — the skill sets the checkboxes and the status in phase 7.
- ASCII-only in paths and identifiers; prose is written in English.
- Acceptance criteria must be checkable with one command or visible in the diff. Visual
  criteria carry the `AC_VIS` prefix and Playwright checks them in phase 6g.
