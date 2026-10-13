// demo/mocks/ch-jira-confluence.mjs
// Data for chapter `jira-confluence`: ad hoc work with /jira and /confluence
// in VS Code. Every fetch is a SCRIPT through the local Mission Deck server (the
// Jira and Confluence tokens never leave it); files land in user-data/
// (gitignored); people in fetched text are pseudonymized before Claude reads
// it; nothing is written back without an explicit "yes". The shapes follow
// real use cases (a "tickets with logged time but no description" check, a
// task draft on templates/task.template.md, a page of requirements and test
// findings), but every key, epic, person, page and number is FICTITIOUS.

export const EPIC = 'DEMO-EPIC-18';
export const EPIC_NAME = '[ORDERS] Preparatory work';
export const PAGE_ID = '7340021';
export const PAGE_TITLE = 'Site order list — requirements and test results (Stage 1)';
export const PAGE_URL = 'https://wiki.example.test/pages/viewpage.action?pageId=' + PAGE_ID;

export const TASKS_JSON = 'user-data/jira/my-tasks.json';
export const TASKS_MD = 'user-data/jira/my-tasks.md';
export const PAGE_MD = `user-data/confluence/${PAGE_ID}-order-list-requirements.md`;
export const PAGE_ANON = `user-data/confluence/anon/${PAGE_ID}-order-list-requirements.md`;
export const DESC_MD = 'user-data/jira/DEMO-231-description.md';
export const NEW_TASK_MD = 'user-data/initiatives/tasks/2026-10-07-prototype-state-vs-requirements.md';

export const SEARCH_CMD = 'curl -s "localhost:3001/…/jira/search?jql=assignee=currentUser()+AND+statusCategory!=Done" > ' + TASKS_JSON;
export const TABLE_CMD = `node user-data/scripts/jira-to-md.js ${TASKS_JSON} > ${TASKS_MD}`;
export const FETCH_CMD = `curl -s -X POST localhost:3001/…/knowledge-base/confluence-fetch -H "Origin: http://localhost:3001" --data '{"pages":["${PAGE_ID}"]}'`;
export const ANON_CMD = `anonymization (local script) ${PAGE_MD} --out user-data/confluence/anon/`;
export const UPDATE_CMD = 'curl -s -X POST localhost:3001/…/jira/update-fields -H "Origin: http://localhost:3001" --data @user-data/tmp/jira-update-DEMO-231.json';
export const COMMENT_CMD = 'curl -s -X POST localhost:3001/…/jira/comment -H "Origin: http://localhost:3001" --data @user-data/tmp/jira-comment-DEMO-231.json';
export const COPY_CMD = `cp templates/task.template.md ${NEW_TASK_MD}`;
export const CREATE_CMD = 'curl -s -X POST localhost:3001/…/jira/create-issue-poc -H "Origin: http://localhost:3001" --data @user-data/tmp/jira-create.json';

/** The task table the script writes (the "tickets without a description" view). */
export const TASKS_TEXT = `# My tasks in progress — 2026-10-07
> Fetched by a script (Jira through the local Mission Deck server), 9 tasks.
> "Desc" = length of the description field; < 50 characters means no description.

| #  | Key      | Title                                  | Status      | Epic          | Hrs  | Desc |
|----|----------|----------------------------------------|-------------|---------------|-----:|-----:|
| 1  | DEMO-231 | [ANA] Order list — requirements analysis | In progress | ${EPIC}  | 14.5 |    0 |
| 2  | DEMO-229 | [UX] Order list usability test         | Done        | ${EPIC}  | 11.0 |  812 |
| 3  | DEMO-226 | [ANA] Delivery statuses — glossary     | In progress | ${EPIC}  |  6.0 |   12 |
| 4  | DEMO-224 | [PROTO] Order list — v1                | Done        | ${EPIC}  |  9.5 |  640 |
| 5  | DEMO-219 | [ANA] Delivery delays — data           | In progress | DEMO-EPIC-12  |  3.0 |    0 |
| 6  | DEMO-214 | [MEETINGS] Sprint review               | In progress | DEMO-EPIC-02  |  4.0 |   96 |
| …  |          |                                        |             |               |      |      |
`;

/** What Claude adds after reading the table. */
export const FLAGS_TEXT = `
## No description, with logged time (3)
- DEMO-231 — 14.5 h, In progress: the largest item with no record of decisions
- DEMO-226 — 6.0 h, In progress: description "to be filled in" (12 characters)
- DEMO-219 — 3.0 h, In progress: empty description
`;

/** The fetched page after pseudonymization (people and sites replaced). */
export const PAGE_TEXT = `# ${PAGE_TITLE}
> Fetched by a script 2026-10-07 · page version 6 · anonymized

## Requirements (Stage 1)
| Id     | Requirement                                | Priority  |
|--------|--------------------------------------------|-----------|
| ORD-01 | List of orders from the last 14 days       | Must      |
| ORD-02 | Delivery status filter                     | Must      |
| ORD-03 | Highlighting delayed orders                | Must      |
| ORD-04 | Number of line items in an order           | Should    |
| ORD-05 | Contacting the supplier from the list      | Should    |
| ORD-06 | Reporting a shortage on receipt            | Could     |

## Test results (06.10, 3 managers)
- Person A (LOC-001): "Delayed should shout."
- Person B (LOC-002): searched for a delayed delivery for 40 s.
- Prototype v3 covers ORD-01…ORD-05, ORD-06 missing.
`;

/** The missing description, on the structure of templates/task.template.md. */
export const DESC_TEXT = `# DEMO-231 — description to fill in

## Header
| Field           | Value                                     |
|-----------------|-------------------------------------------|
| Project         | DEMO                                      |
| Epic / Order    | ${EPIC} — ${EPIC_NAME} |
| Task type       | Task                                      |
| Work type       | TO BE analysis (CAPEX)                    |
| Kind of change  | Project work                              |
| Applies to      | Site orders                               |
| Label           | orders_discovery                          |

## Task goal
Write down the Stage 1 requirements of the order list (ORD-01…ORD-06)
and confirm them with the results of the test with site managers.

## Scope of work
1. Requirements ORD-01…ORD-06 with priorities (Confluence).
2. Findings from the 06.10 usability test (3 people).
3. Requirement coverage by prototype v3.

## Acceptance criteria
- [ ] Confluence page ${PAGE_ID} has a requirements table.
- [ ] Every requirement has a priority and a source.
- [ ] Gaps between the prototype and the requirements are described.
`;

/** The new task, completed with the page's coverage table. */
export const NEW_TASK_TEXT = `---
title: "Order list — documenting the prototype state vs the requirements"
type: task
date: 2026-10-07
author: Alex Morgan
summary: "A summary of how prototype v3 covers requirements ORD-01…ORD-06."
---

# Task: Documenting the prototype state vs the requirements

## Header
| Field           | Value                           |
|-----------------|---------------------------------|
| Project         | DEMO                            |
| Epic / Order    | ${EPIC} — ${EPIC_NAME} |
| Task type       | Task                            |
| Work type       | TO BE analysis (CAPEX)          |
| Kind of change  | Project work                    |
| Applies to      | Site orders                     |
| Label           | orders_discovery                |

## Task goal
A Confluence page: which requirements prototype v3 meets,
which partly, which are missing — the basis for the Stage 1 decision.

## Context — coverage (page ${PAGE_ID}, version 6)
| Status     | Requirements     | Count  |
|------------|------------------|-------:|
| Met        | ORD-01…ORD-04    |      4 |
| Partly     | ORD-05           |      1 |
| Missing    | ORD-06           |      1 |

## Scope of work
1. Prototype screenshots for ORD-01…ORD-05 (the prototype's assets/).
2. A description of the ORD-06 gap and a proposal for Stage 2.
3. Update page ${PAGE_ID}.
`;

/** The task list after the fixes: one task without a description fewer. */
export const TASKS_AFTER = `# My tasks in progress — 2026-10-07, 11:40
> Fetched by the script again, 10 tasks.

| #  | Key      | Title                                  | Status      | Hrs  | Desc |
|----|----------|----------------------------------------|-------------|-----:|-----:|
| 1  | DEMO-245 | Prototype state vs requirements docs   | New         |  0.0 | 1240 |
| 2  | DEMO-231 | [ANA] Order list — requirements analysis | In progress | 14.5 |  986 |
| 3  | DEMO-226 | [ANA] Delivery statuses — glossary     | In progress |  6.0 |   12 |
| 4  | DEMO-219 | [ANA] Delivery delays — data           | In progress |  3.0 |    0 |
| …  |          |                                        |             |      |      |

## No description, with logged time: 2 (this morning: 3)
`;

export const MOCKS = {};

/** Every visible label these painters paint (copy gate). */
export const LABELS = [];
