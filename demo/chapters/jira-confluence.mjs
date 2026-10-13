// demo/chapters/jira-confluence.mjs
// Chapter `jira-confluence` ("Jira and Confluence day to day"): ad hoc work in
// VS Code with Claude Code, asked in plain English. (1) "show my tasks in progress" (run by /jira) - a SCRIPT
// pulls the list through the local Mission Deck server into user-data/jira/, and
// Claude flags tasks with logged time but no description. (2) One of them is
// completed from Confluence: the page is fetched by a script into
// user-data/confluence/, people are pseudonymized, Claude drafts the missing
// description on the task template, shows the change, and updates the issue
// plus a comment only after "yes". (3) A NEW task from templates/task, filled
// with the page's coverage table, required fields checked, confirmed,
// created and linked to the epic. (4) The list again: one task without a
// description fewer. Keys, people, pages and numbers are fictitious.

import { narrate } from './_helpers.mjs';
import {
  EPIC, PAGE_ID, PAGE_TITLE, PAGE_URL, TASKS_JSON, TASKS_MD, PAGE_MD, PAGE_ANON, DESC_MD, NEW_TASK_MD, SEARCH_CMD,
  TABLE_CMD, FETCH_CMD, ANON_CMD, UPDATE_CMD, COMMENT_CMD, COPY_CMD, CREATE_CMD, TASKS_TEXT, FLAGS_TEXT, PAGE_TEXT,
  DESC_TEXT, NEW_TASK_TEXT, TASKS_AFTER,
} from '../mocks/ch-jira-confluence.mjs';

const ASK_TASKS = 'Show my tasks in progress in Jira';
const term = (lines) => ({ type: 'terminal', lines });
const onTerm = { type: 'camera', target: '#demo-vsc-terminal', zoom: 1.3 };
const onEditor = { type: 'camera', target: '#demo-vsc-editor', zoom: 1.3 };
const full = { type: 'camera', full: true };
const pause = (ms = 600) => ({ type: 'wait', ms });

export default {
  setup: [
    { type: 'surface', show: 'vscode' },
  ],
  steps: [
    {
      id: 'jira-confluence-moje-zadania',
      caption: 'I ask Claude: **show my tasks in progress** — a script fetches the list, the file lands in user-data.',
      mascot: 'working',
      actions: [
        narrate('My tasks in progress', 'The /jira skill never touches the token: it asks the local Mission Deck server, which keeps the Jira token in memory. A script saves the answer to user-data/jira/ and turns it into a Markdown table. The model reads the file, not Jira. I only ask in a plain sentence.', ASK_TASKS),
        onTerm,
        term([
          { role: 'claude', text: '~/Projects/mission-deck' },
          { role: 'user', text: ASK_TASKS },
          { role: 'assistant', text: 'I will use the /jira skill.' },
          { role: 'assistant', text: 'I fetch with a script through the local Mission Deck server — the Jira token stays in the server.' },
          { role: 'tool', text: SEARCH_CMD, summary: '9 tasks', body: [TASKS_JSON, '9 issues · fields: summary, status, epic, timespent, description'] },
          { role: 'tool', text: TABLE_CMD, summary: 'table', body: [TASKS_MD] },
        ]),
        full,
        { type: 'explorer', add: [TASKS_JSON, TASKS_MD] },
        { type: 'editor', file: TASKS_MD, text: TASKS_TEXT },
        onEditor,
        pause(700),
      ],
    },
    {
      id: 'jira-confluence-bez-opisu',
      caption: 'I spot three tasks with logged time but **no description** — the largest has 14.5 hours.',
      mascot: 'thinking',
      actions: [
        narrate('Tasks without a description', 'Logged time without a description is work that leaves no trace. Claude goes through the table and lists the tasks whose description is shorter than 50 characters, largest number of hours first.'),
        full,
        { type: 'editor', file: TASKS_MD, text: FLAGS_TEXT },
        { type: 'scroll', target: '#demo-vsc-editor .vsc-caret' },
        onEditor,
        pause(500),
        full,
        onTerm,
        term([{ role: 'assistant', text: '3 tasks without a description: DEMO-231 (14.5 h), DEMO-226 (6 h), DEMO-219 (3 h). Which one do we start with?' }]),
      ],
    },
    {
      id: 'jira-confluence-strona',
      caption: 'The description is in **Confluence** — a script fetches the page, people get pseudonyms.',
      mascot: 'working',
      actions: [
        narrate('A page from Confluence', 'The /confluence skill asks the Mission Deck server for the page and saves it as Markdown in user-data/confluence/. The page names the test participants, so before the model reads it a local script replaces them with “Person A”, and the sites with LOC-001.', `Fetch Confluence page ${PAGE_ID} about the prototype test and fill in the DEMO-231 description from it`),
        term([
          { role: 'user', text: `Fetch Confluence page ${PAGE_ID} about the prototype test and fill in the DEMO-231 description from it` },
          { role: 'tool', text: FETCH_CMD, summary: '1 page · version 6', body: [`{"pages":[{"id":"${PAGE_ID}","title":"${PAGE_TITLE}","remoteVersion":6,...}]}`, PAGE_MD] },
          { role: 'tool', text: ANON_CMD, summary: '4 fields replaced', body: ['people: 2 -> Person A, Person B', 'site numbers: 2 -> LOC-001, LOC-002', 'the pseudonym map stays in user-data/ — the model does not read it'] },
          { role: 'tool', verb: 'Read', text: PAGE_ANON, summary: 'the anonymized version' },
        ]),
        full,
        { type: 'explorer', add: [PAGE_MD, PAGE_ANON] },
        { type: 'editor', file: PAGE_ANON, text: PAGE_TEXT },
        onEditor,
        pause(700),
      ],
    },
    {
      id: 'jira-confluence-szkic',
      caption: 'I write the missing **description** on the task template: header, goal, scope, criteria.',
      mascot: 'thinking',
      actions: [
        narrate('A draft description in user-data', 'The description is first written as a file in user-data/jira/, on the structure of templates/task.template.md: the “Header” table (project, epic, work type, label), goal, scope of work and acceptance criteria — from the page content, no guessing.'),
        full,
        term([{ role: 'tool', verb: 'Write', text: DESC_MD, summary: 'draft description' }]),
        { type: 'editor', file: DESC_MD, text: DESC_TEXT },
        onEditor,
        pause(700),
      ],
    },
    {
      id: 'jira-confluence-tak',
      caption: 'I show the **change** and wait. Only after “yes” do the description and the comment go to Jira.',
      mascot: 'idle',
      actions: [
        narrate('Nothing without confirmation', 'Writing to Jira goes outside — so first the difference: the field was empty, it will hold a six-section description. Only after my “yes” does the script update DEMO-231 and add a comment with a link to the Confluence page. The description goes to Jira as plain ASCII; the file in user-data keeps the original.', 'Yes, save the description and add the comment'),
        full,
        { type: 'preview', title: 'DEMO-231 · description change', kind: 'log', lines: [
          '- (description empty)',
          '+ h2. Header',
          '+ || Project || DEMO ||',
          `+ || Epic / Order || ${EPIC} ||`,
          '+ h2. Task goal',
          '+ Write down the Stage 1 requirements of the order list (ORD-01..ORD-06)',
          '+ h2. Scope of work  (3 points)',
          '+ h2. Acceptance criteria  (3 points)',
          '',
          `+ comment: Description filled in from the page ${PAGE_URL}`,
        ] },
        pause(1200),
        { type: 'preview', close: true },
        onTerm,
        term([
          { role: 'assistant', text: 'Update the DEMO-231 description and add a comment with a link to the page? (yes/no)' },
          { role: 'user', text: 'Yes, save the description and add the comment' },
          { role: 'tool', text: UPDATE_CMD, summary: 'ok', body: ['{"status":"ok","key":"DEMO-231","fields":["description"]}'] },
          { role: 'tool', text: COMMENT_CMD, summary: 'comment added', body: ['{"status":"ok","id":"88213"}'] },
        ]),
        { type: 'toast', variant: 'success', title: 'DEMO-231 updated', desc: 'Description and a comment with a link to the Confluence page' },
      ],
    },
    {
      id: 'jira-confluence-nowe',
      caption: 'A new **task** from the template — filled in with the coverage table from the same page.',
      mascot: 'working',
      actions: [
        narrate('A new task from the template', 'The page shows a gap: the prototype does not cover one requirement. I create a new task for it. Claude copies templates/task.template.md to user-data/initiatives/tasks/, fills in the frontmatter and the header and adds the coverage table from the page. I only say what task should be created.', 'Create a Jira task: documenting the prototype state vs the requirements, in the same epic'),
        term([
          { role: 'user', text: 'Create a Jira task: documenting the prototype state vs the requirements, in the same epic' },
          { role: 'tool', text: COPY_CMD, summary: 'template copied' },
          { role: 'tool', verb: 'Edit', text: NEW_TASK_MD, summary: 'frontmatter, header, goal, context, scope' },
        ]),
        full,
        { type: 'explorer', add: [NEW_TASK_MD] },
        { type: 'editor', file: NEW_TASK_MD, text: NEW_TASK_TEXT },
        { type: 'scroll', target: '#demo-vsc-editor .vsc-caret' },
        onEditor,
        pause(700),
      ],
    },
    {
      id: 'jira-confluence-pola',
      caption: 'I check the **required fields**, ask for consent — and there is DEMO-245, linked to the epic.',
      mascot: 'working',
      actions: [
        narrate('Fields, consent, issue', 'Before creating it Claude checks the fields Jira requires: project, type, title, epic, work type, label. It shows a summary and the file path. After “yes” the script creates the issue and links it to the epic at once.', 'Yes, create the issue'),
        full,
        onTerm,
        term([
          { role: 'assistant', text: `Required fields: project DEMO ✓ · type Task ✓ · title ✓ · epic ${EPIC} ✓ · work type CAPEX ✓ · label ✓ · ASCII description ✓` },
          { role: 'assistant', text: `Create “Order list — documenting the prototype state vs the requirements” in DEMO, epic ${EPIC}? File: ${NEW_TASK_MD} (yes/no)` },
          { role: 'user', text: 'Yes, create the issue' },
          { role: 'tool', text: CREATE_CMD, summary: 'DEMO-245', body: [`{"key":"DEMO-245","issueType":"Task","project":"DEMO","epicLink":"${EPIC}"}`] },
        ]),
        { type: 'toast', variant: 'success', title: 'Created DEMO-245', desc: `A task in epic ${EPIC}` },
      ],
    },
    {
      id: 'jira-confluence-kontrola',
      caption: 'I ask for the list again: **one task without a description fewer**, and the new one is there.',
      mascot: 'success',
      actions: [
        narrate('A check', 'The same script, the same table: DEMO-231 has a description, DEMO-245 is on the list. Everything fetched and written stayed in user-data/ — outside the repository. Only two changes went to Jira, and only after “yes”.', 'Show my tasks in progress again'),
        term([
          { role: 'user', text: 'Show my tasks in progress again' },
          { role: 'tool', text: SEARCH_CMD, summary: '10 tasks' },
          { role: 'tool', text: TABLE_CMD, summary: 'table' },
        ]),
        full,
        { type: 'editor', file: TASKS_MD, text: TASKS_AFTER, mode: 'replace' },
        onEditor,
        pause(700),
      ],
    },
  ],
};
