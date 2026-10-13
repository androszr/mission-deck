<!--
Plan template for mission-deck. NEVER REMOVE H2 SECTIONS. Adding new H2 sections is fine
(Phase 6.6 appends `## Graph review`); old plans must keep parsing.
The implementer uses ## Steps as the source of truth and ## Test plan as the gate.
The verifier reads ## Acceptance criteria and nothing else.
## Business description is for the non-technical reader and is printed first in Phase 5.
-->

# {{title}}

**Date:** {{date}}
**Slug:** {{slug}}
**Status:** draft
**Surface:** {{view | server-endpoint | data | cross-cutting | bugfix | refactor}}
**Branch:** {{non-main branch the work lands on}}

## Business description

<!-- A section for the non-technical reader (product owner, manager, a user of the app).
     Reader test: every sentence must make sense to someone who will never open the repo and
     does not know what a sidebar, an endpoint or JSON is. Zero paths, zero function names,
     zero code concepts. This list does NOT mirror `## Steps` 1:1 - it describes the effect
     for the user, not the developer's work. 3-5 points. Preflight blocks jargon (rule 19). -->

**Why we are doing this:** {{1-2 sentences: whose problem this solves and what its absence costs today (manual work, searching outside the app, missing information)}}

**What changes for the user:**

1. {{what the user will be able to do / will no longer have to do}}
2. {{...}}
3. {{...}}

**What the user will see after release:** {{specifics: where they click, what appears, what changes in daily work - names as they appear on screen}}

**What this does NOT change:** {{one reassuring line - details stay in the Out of scope section}}

## Idea

<!-- The technical description for the implementer and the code reviewer. File, module and
     endpoint names are allowed here. The non-technical reader already has their section above. -->

{{one-paragraph technical restatement of the user's idea, in the planner's words}}

## Context

- {{relevant repo facts: modules touched, similar prior feature, known constraints}}
- {{decisions the user made during the interview}}
<!-- For a new module, record one explicit business area from Q1c, separate from the
     menu hub from Q1b. Carry it as --area in the scaffold step and in an acceptance
     criterion for module.json. For an existing module, preserve its area. -->
<!-- For a PORT of a view from another app add a "Layout parity" list here: the
     source (repo path, hash, port), tiles per row + label cell, panels per row, section
     order, header-slot contents, table columns - and one AC_VIS comparing both pages
     side by side at 1440px. See conventions section 2c. -->

## Files to change

- `{{path}}` — {{what changes and why, in one line}}

## New files

- `{{path}}` — {{purpose, in one line}}

## Steps

- [ ] 1. {{actionable step}}
- [ ] 2. {{actionable step}}

## Risks & footguns

- {{specific footgun this plan must avoid, e.g. missing HUB_FLYOUT entry, unlocked write path, missing cleanup registration}}

## Test plan

Test budget (test less, test smarter): {{N}} new test case(s).

- [ ] `npm run lint` exits 0
- [ ] `npm test` exits 0
- [ ] `npm run test:api` exits 0 {{only when server.js or tests/ change}}
- [ ] Manual: {{golden-path scenario — what to click and what should render}}

## Acceptance criteria

Testable, observable criteria (3-8). Each must be observable from the diff/file state or
verifiable by a single command. Prefix visual criteria with `AC_VIS` — they trigger Phase 6g.

- [ ] AC1: {{e.g. "`test -f modules/reports/module.json` exits 0"}}
- [ ] AC2: {{e.g. "`npm run lint` exits 0"}}
- [ ] AC3: {{e.g. "`node -e \"const m=require('./modules/reports/module.json');process.exit(m.views.length>0?0:1)\"` exits 0"}}
- [ ] AC_VIS1: {{e.g. "after a server restart the module appears in the rail and its view renders at #reports-list with no console errors, using ds-card/ds-btn classes"}}

## Out of scope

- {{things a reasonable reader might assume are included but aren't}}

## Iteration log

- {{date}} initial draft
