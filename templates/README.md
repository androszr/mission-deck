# Document templates

Document templates that ship with Mission Deck. Areas are generic placeholders
(`area-a | area-b | other`).
Every template has a YAML header (frontmatter) — fill it in, because it carries the metadata.

Save finished documents in `user-data/` (a gitignored directory), never in `templates/`.

## Product work

| Template | When to use |
|---|---|
| `business-requirements.template.md` | describing an initiative: problem, owner, scope, benefit |
| `user-story.template.md` | a user story with acceptance criteria, ready to file in Jira |
| `task.template.md` | a smaller task, discovery or delivery |
| `ux-brief.template.md` | a brief for the designer: problem, user, constraints |
| `estimate.template.md` | an estimate in person-days with assumptions and risks |
| `feedback-report.template.md` | a bug report, idea or question sent from the app — the same shape `POST /api/feedback/submit` builds; it is filled in automatically, this file shows its contract to a person |

`/jira` uses `user-story.template.md` and `task.template.md`: it first saves the `.md` version
to `user-data/` and only then creates the issue.

## Research and knowledge

| Template | When to use |
|---|---|
| `research.template.md` | plan and results of a piece of research |
| `interview.template.md` | an interview with a user |
| `data-analysis.template.md` | a data analysis with findings |
| `knowledge-base.template.md` | a lasting knowledge-base entry |
| `notes.template.md` | a short note from an ad-hoc meeting |
| `workshop.template.md` | a workshop summary |

## Meetings

`meeting-notes/` — eight variants depending on the kind of meeting:

| File | Meeting type |
|---|---|
| `meeting-notes-kickoff.template.md` | initiative kickoff |
| `meeting-notes-status-update.template.md` | status |
| `meeting-notes-decision.template.md` | decision meeting |
| `meeting-notes-retrospective.template.md` | retrospective |
| `meeting-notes-discovery-interview.template.md` | discovery interview |
| `meeting-notes-contextual-inquiry.template.md` | observation in the work context |
| `meeting-notes-product-feedback-interview.template.md` | product feedback |
| `meeting-notes-as-is-to-be.template.md` | process mapping AS IS -> TO BE |

`meeting-report.template.html` — an HTML meeting report, for when you need a document
to send outside the team.

The report carries the Mission Deck mark (`assets/logo.svg`) inlined as a data URI, so the
document is one self-contained file. The mascot artwork lives in `assets/mascot/`
(Pip, eight poses) and the icon set in `assets/icons/ds/`.

## Delivery process templates

They live separately, next to the skill, not here:

- `.claude/skills/new-idea/templates/plan.md` — the structure of an implementation plan
- `.claude/skills/new-idea/templates/questions.md` — the interview question bank
- `.claude/skills/new-idea/templates/repo-map/overview.md` — the repo map for the planner
