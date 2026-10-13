# Skills Index

All skills in `.claude/skills/`, sorted by how often they are used. The same list, read straight
from the files, is visible in the app: **Settings > Skills**.

Per-agent detail: [.claude/agents/README.md](../agents/README.md).
Repo rules: [CLAUDE.md](../../CLAUDE.md).

**The deterministic half of the method is a set of commands in `scripts/`** - plan preflight,
conventions check, change digest, gates, handoff, repo map and two scaffolds (view, endpoint).
The skills call them instead of having the model do those steps. The list with descriptions:
[CLAUDE.md](../../CLAUDE.md), section **Automation**; every command has `--help` and `--json`.

## Most used

| Skill | Trigger (slash command + example phrase) | What it does (1 sentence) | Output |
|---|---|---|---|
| [new-idea](new-idea/SKILL.md) | `/new-idea "add a new view X"` | Plans and implements a change: interview -> plan (Opus) -> scripted preflight -> HTML render -> implementation (Sonnet; a small plan with one implementer, a large or two-layer one on the split path backend -> frontend -> lead review on Opus) -> blind AC verification. Conventions guardian, visual verification and bug scan are conditional. Phase detail: [PHASES.md](new-idea/PHASES.md). | `plans/<date>-<slug>.md` + `.html` + code in the repo |
| [commit-message](commit-message/SKILL.md) | `/commit-message` or "suggest a commit message" | Analyses the diff and proposes a Conventional Commits message; commits only after confirmation. | Message text + optional `git commit` |
| [pre-ship-audit](pre-ship-audit/SKILL.md) | `/pre-ship-audit` or "check my changes before commit" | Runs `gates.js` and `check-conventions.js`, then 3-4 auditors over the change digest from `diff-digest.js` (not the raw diff); returns a prioritised report. | `user-data/audits/pre-ship-audit-<date>.md` |
| [review-pr](review-pr/SKILL.md) | `/review-pr` or "review my branch" | Graph-aware branch review through the GitNexus MCP (blast radius, callers, test coverage). | Inline report with VERDICT |
| [jira](jira/SKILL.md) | `/jira` or "create a jira issue" | Creates and updates Jira issues through the local server (`/api/jira/*`), saving a .md version first. | `user-data/initiatives/tasks/*.md` + the Jira issue |
| [confluence](confluence/SKILL.md) | `/confluence` or "save this to confluence" | Reads and publishes Confluence pages through the local server; the draft always lands locally first. | `user-data/confluence/*.md` + the Confluence page |
| [sync-after-merge](sync-after-merge/SKILL.md) | `/sync-after-merge` or "clean up after merge" | Switches to main, pulls from `origin`, offers to delete merged branches, prunes stale refs. | A clean local `main` |

## Others

| Skill | Trigger (slash command + example phrase) | What it does (1 sentence) | Output |
|---|---|---|---|
| [qa-audit](qa-audit/SKILL.md) | `/qa-audit` or "review the tests" | Analyses test coverage and test quality across the whole repo (structural, no coverage tool). | `user-data/audits/qa-audit-<date>.md` |
| [prototype](prototype/SKILL.md) | `/prototype` or "make a screen mockup" | Creates the starter through the API and grows a React prototype (`index.tsx`, `styles.css`, `spec.json`); build-shell tokens, demo states and Playwright screenshots. Vanilla only for existing mockups. | `plans/<date>-proto-*.md` + `data-sub-repositories/ds-data/prototypes/<id>/` |
| [mini](mini/SKILL.md) | `/mini` or "add a screen to <project>" | Plans and implements a change in a mini app (Vite + React + TypeScript) registered in `projects/`. | `plans/<date>-<prefix>*.md` + code in the project repo |
| [summarize-meeting](summarize-meeting/SKILL.md) | `/summarize-meeting` or "summarize the meeting" | Picks a template from `templates/meeting-notes/` and fills it with the transcript's content; works without the server. | `user-data/meetings/<date>-<topic>.md` |
| [refresh-repo-map](refresh-repo-map/SKILL.md) | `/refresh-repo-map` or "refresh the repo map" | Runs `node scripts/gen-repo-map.js` and summarises what appeared or disappeared in the map the planner reads instead of exploring the tree. | refreshed `templates/repo-map/overview.md` |
| [kudos](kudos/SKILL.md) | `/kudos` or "make a kudos page" | Builds a static HTML page summarising the contribution on a branch or in an MR. | `user-data/kudos/<date>-<slug>.html` |

## GitNexus (sub-skills)

Code-graph knowledge. Loaded on demand by `/review-pr`, `/new-idea` (Phase 6.6)
and `/pre-ship-audit` (Phase 1.5). Index bootstrap: `node scripts/bootstrap-gitnexus.js`.

| Sub-skill | When |
|---|---|
| [gitnexus-exploring](gitnexus/gitnexus-exploring/SKILL.md) | "How does X work?", architecture, execution flows |
| [gitnexus-impact-analysis](gitnexus/gitnexus-impact-analysis/SKILL.md) | "What breaks if I change X?" |
| [gitnexus-debugging](gitnexus/gitnexus-debugging/SKILL.md) | "Why is X failing?", tracing an error |
| [gitnexus-refactoring](gitnexus/gitnexus-refactoring/SKILL.md) | Rename / extract / split / move |
| [gitnexus-guide](gitnexus/gitnexus-guide/SKILL.md) | Tool list, graph schema, reference |
| [gitnexus-cli](gitnexus/gitnexus-cli/SKILL.md) | analyze / status / clean / wiki from the CLI |
