// demo/chapters/skills-and-agents.mjs
// Chapter `skills-and-agents`: Settings > Agents (an agent's model changed
// through the ds-select), Settings > Skills (a skill card, its phase counter
// and the instructions window), then three skills in the Claude Code CLI in
// VS Code: /jira (a user story drafted from templates/user-story into
// user-data/, a FICTITIOUS issue DEMO-123), Azure DevOps work (the prototype
// shell publish and an app pipeline, both through Mission Deck's own streams -
// the token comes from the vault and is never typed) and /confluence (a
// FICTITIOUS page read into user-data/ and updated).

import { narrate } from './_helpers.mjs';

const JIRA_FILE = 'user-data/initiatives/tasks/2026-10-04-sprint-report-pdf-export.md';

const JIRA_DRAFT = `---
title: "Export the sprint report to PDF"
type: user-story
date: 2026-10-04
author: Alex Morgan
summary: "As a team lead I want to download the sprint report as a PDF so that I can pass it on"
---

## User Story

> As a **team lead** I want **to download the sprint report as a PDF**
> so that **I can send it to the team without them signing in to Mission Deck**.

## Context and goal

Today the report lives only in Mission Deck; people outside the team get screenshots.

## Acceptance criteria

1. An “Export PDF” button next to “Download report”.
2. The PDF has the charts and the KPI table for the current filter.
`;

const CONF_FILE = 'user-data/confluence/900001-q4-rollout-plan.md';

const CONF_PAGE = `# Q4 rollout plan

## Reports
- Report export to PDF - October (DEMO-123)

## Experiments
- Demand forecast - decision after stage 2
`;

const CONF_UPDATE = `
## Apps
- New version 2026.10.04-1 deployed by the pipeline
- Access: a new person in the Sprints and Roadmap modules
`;

export default {
  setup: [
    { type: 'show', mock: 'skille-i-agenci-agents', target: '#settings-agenci-section' },
    { type: 'show', mock: 'skille-i-agenci-skills', target: '#settings-skille-section' },
  ],
  steps: [
    {
      id: 'skille-i-agenci-agenci',
      caption: 'I open Settings > **Agents** — the Claude Code crew that works inside the skills.',
      mascot: 'working',
      camera: 'full',
      actions: [
        narrate('Agents', 'Every agent has one role in the way of working: the planner, the implementers, the reviewers, the conventions guardian. The card says in which phase of which skill it works and which model powers it.'),
        { type: 'navigate', view: 'settings', tab: 'agents' },
        { type: 'camera', target: '#skille-i-agenci-group-0', zoom: 1.15 },
      ],
    },
    {
      id: 'skille-i-agenci-model',
      caption: 'I change the planner’s **model** to a stronger one — on this computer only.',
      mascot: 'working',
      actions: [
        narrate('Choosing a model', 'The “Change model” list overrides the model from the agent file. The override stays on this computer — before a commit a hook restores the team’s default model, so the choice changes nothing for anyone else.'),
        { type: 'click', target: '#skille-i-agenci-trigger-idea-planner' },
        { type: 'hide', target: '#skille-i-agenci-drop-idea-planner', hidden: false },
        { type: 'camera', target: '#skille-i-agenci-card-idea-planner', zoom: 1.5 },
        { type: 'click', target: '#skille-i-agenci-opt-idea-planner-claude-opus-5-5' },
        { type: 'hide', target: '#skille-i-agenci-drop-idea-planner' },
        { type: 'show', mock: 'text', target: '#skille-i-agenci-trigger-text-idea-planner', props: { text: 'Opus 5.5' } },
        { type: 'badge', target: '#skille-i-agenci-badge-idea-planner', tone: 'gray', text: 'claude-opus-5-5' },
        { type: 'hide', target: '#skille-i-agenci-over-idea-planner', hidden: false },
        { type: 'wait', ms: 500 },
        { type: 'camera', full: true },
        { type: 'toast', variant: 'success', title: 'Model saved', desc: 'idea-planner -> Opus 5.5' },
      ],
    },
    {
      id: 'skille-i-agenci-skille',
      caption: 'I move to **Skills** — the card says how to call a skill and what it leaves behind.',
      mascot: 'celebrating',
      actions: [
        narrate('Skills', 'A skill is a ready-made procedure for Claude: /new-idea from an idea to code, /jira for issues, /kudos for thank-yous. The description, phases, agents and commands on the card are read straight from the skill files, so the card cannot drift.'),
        { type: 'camera', full: true },
        { type: 'navigate', view: 'settings', tab: 'skills' },
        { type: 'camera', target: '#skille-i-agenci-skill-new-idea', zoom: 1.6 },
        { type: 'click', target: '#skille-i-agenci-counter-new-idea-phases' },
        { type: 'hide', target: '#skille-i-agenci-phases-new-idea', hidden: false },
      ],
    },
    {
      id: 'skille-i-agenci-fazy',
      caption: 'I look at the /new-idea **instructions** — the phases in order, each with an owner.',
      mascot: 'thinking',
      actions: [
        narrate('The skill instructions', '“See instructions” opens the skill documents in one window: SKILL.md, the phase description, the checklist and the templates. The phases are interview, plan, preflight, implementation, gates, verification and handoff.'),
        { type: 'camera', full: true },
        { type: 'scroll', target: '#skille-i-agenci-open-new-idea' },
        { type: 'click', target: '#skille-i-agenci-open-new-idea' },
        { type: 'modal', open: 'skille-i-agenci-doc-modal' },
        { type: 'camera', target: '#skille-i-agenci-doc-modal .ds-modal', zoom: 1.15 },
        { type: 'wait', ms: 600 },
        { type: 'click', target: '#skille-i-agenci-doc-tab-1' },
        { type: 'show', mock: 'skille-i-agenci-doc-tabs', target: '#skille-i-agenci-doc-tabs', mode: 'outer', props: { tab: 'PHASES.md' } },
        { type: 'show', mock: 'text', target: '#skille-i-agenci-doc-path', props: { text: '.claude/skills/new-idea/PHASES.md' } },
        { type: 'show', mock: 'skille-i-agenci-doc-body', target: '#skille-i-agenci-doc-body', props: { tab: 'PHASES.md' } },
      ],
    },
    {
      id: 'skille-i-agenci-jira',
      caption: 'I ask Claude for a **user story in Jira** — it picks the /jira skill itself and starts from the template.',
      mascot: 'working',
      actions: [
        narrate('/jira: a draft', 'I do not have to remember the skill name: I write a plain sentence and Claude picks /jira from the card description (typing /jira first is just a shortcut). The skill first copies the user story template from templates/ to user-data/ and fills it in. The issue is created only from the finished file — the text stays on disk even when Jira does not answer.', 'Create a Jira user story: export the sprint report to PDF'),
        { type: 'modal', close: '#skille-i-agenci-doc-modal' },
        { type: 'camera', full: true },
        { type: 'surface', show: 'vscode' },
        { type: 'terminal', lines: [{ role: 'claude', text: '~/Projects/mission-deck' }] },
        {
          type: 'ask',
          on: 'vscode',
          text: 'Create a Jira user story: export the sprint report to PDF',
          then: [
            {
              type: 'terminal',
              lines: [
                { role: 'tool', verb: 'Read', text: '.claude/skills/jira/SKILL.md', summary: 'skill /jira' },
                { role: 'tool', text: 'cp templates/user-story.template.md ' + JIRA_FILE, summary: 'template copied' },
                { role: 'assistant', text: 'I am filling in the draft: the user story, the context and two acceptance criteria.' },
              ],
            },
          ],
        },
        { type: 'explorer', add: [JIRA_FILE] },
        { type: 'editor', file: JIRA_FILE, text: JIRA_DRAFT },
      ],
    },
    {
      id: 'skille-i-agenci-zgloszenie',
      caption: 'Claude creates the **issue** — DEMO-123 is now in Jira.',
      mascot: 'working',
      actions: [
        narrate('/jira: the issue', 'From the finished file Claude creates the issue through the local Mission Deck server — the Jira token never reaches the terminal. The key DEMO-123 in this demo is fictitious.'),
        { type: 'camera', target: '#demo-vsc-terminal', zoom: 1.3 },
        {
          type: 'terminal',
          lines: [
            { role: 'tool', text: 'curl -s -X POST …/jira/create-issue-poc --data @user-data/tmp/jira-create.json', summary: 'HTTP 201', body: ['{"key":"DEMO-123","self":"…/issue/DEMO-123"}'] },
            { role: 'assistant', text: 'Created DEMO-123 “Export the sprint report to PDF” (User Story). I saved the draft in ' + JIRA_FILE + '.' },
          ],
        },
      ],
    },
    {
      id: 'skille-i-agenci-ado-proto',
      caption: 'I ask: **publish the prototype** — Mission Deck pushes to Azure DevOps, taking the token from the vault.',
      mascot: 'working',
      actions: [
        narrate('Azure DevOps: the prototype shell', 'The prototype shell repository lives in Azure DevOps. The pull and the push are done by a Mission Deck server stream: the token from the vault goes into a single git command only and is never typed or shown in the terminal.'),
        { type: 'camera', full: true },
        {
          type: 'ask',
          on: 'vscode',
          text: 'Publish the “Orders demo” prototype',
          then: [
            {
              type: 'terminal',
              lines: [
                { role: 'tool', text: 'curl -sN "…/prototypes/deploy-stream?id=proto-orders-demo"', summary: 'Mission Deck server stream', body: ['Syncing the build shell...', 'Synced with origin/main', 'Comparing with the published version...', 'Synced ds/, components/ and prototypes/_shared/ from the product data', 'Building...', 'Build finished', 'Pushing the changes...', 'Commit created'] },
                { role: 'ok', text: 'Pushed - the Azure DevOps pipeline starts automatically and takes about 5 minutes; until then the address serves the previous version' },
                { role: 'assistant', text: 'Publishing started. The Mission Deck server did the pull and push with the token from the vault — I did not type it and do not have it in this session.' },
              ],
            },
          ],
        },
        { type: 'camera', target: '#demo-vsc-terminal', zoom: 1.25 },
      ],
    },
    {
      id: 'skille-i-agenci-ado-mini',
      caption: 'I ask: **deploy the orders app** — the pipeline starts, and I see only the server log.',
      mascot: 'working',
      actions: [
        narrate('Azure DevOps: an app pipeline', 'Deploying an app from the Apps hub is the same chain as its “Deploy” button: a deterministic server stream clones the Azure DevOps repository, builds, verifies and pushes, and the pipeline publishes. Claude only starts it and reads the log.'),
        { type: 'camera', full: true },
        {
          type: 'ask',
          on: 'vscode',
          text: 'Deploy the orders app',
          then: [
            {
              type: 'terminal',
              lines: [
                { role: 'tool', text: 'curl -sN "…/apps/deploy-stream?app=orders-demo"', summary: 'app deploy stream', body: ['Cloning the ADO repository...', 'Cloned the ADO repository', 'Synced with origin/main', 'Build 20261004-0912 (content version 2026.10.04-1) passed policy profile A.', 'Staged 6 changes and 0 deletions in the allowed paths', 'Commit created', 'Push done'] },
                { role: 'ok', text: 'Publishing started - the ADO pipeline starts automatically' },
                { role: 'assistant', text: 'The app pipeline has started. The log holds no personal data — only build numbers and file counts.' },
              ],
            },
          ],
        },
        { type: 'camera', target: '#demo-vsc-terminal', zoom: 1.25 },
      ],
    },
    {
      id: 'skille-i-agenci-confluence-odczyt',
      caption: 'I ask for a **Confluence page** — the /confluence skill saves it in user-data as Markdown.',
      mascot: 'thinking',
      actions: [
        narrate('/confluence: reading', 'The page title in a plain sentence is enough. Claude reaches for the /confluence skill, which reads the page through the local Mission Deck server and saves it as Markdown in user-data/confluence/. The page in this demo is fictitious, and the Confluence token stays on the server side.', 'Fetch the “Q4 rollout plan” page from Confluence'),
        { type: 'camera', full: true },
        {
          type: 'ask',
          on: 'vscode',
          text: 'Fetch the “Q4 rollout plan” page from Confluence',
          then: [
            {
              type: 'terminal',
              lines: [
                { role: 'tool', text: 'curl -s -X POST …/knowledge-base/confluence-fetch --data \'{"pageId":"900001"}\'', summary: 'HTTP 200, version 7' },
                { role: 'assistant', text: 'I saved the page in ' + CONF_FILE + '.' },
              ],
            },
          ],
        },
        { type: 'explorer', add: [CONF_FILE] },
        { type: 'editor', file: CONF_FILE, text: CONF_PAGE },
      ],
    },
    {
      id: 'skille-i-agenci-confluence-zapis',
      caption: 'I add a section and **update** the page in Confluence — version 8 is ready.',
      mascot: 'success',
      actions: [
        narrate('/confluence: writing', 'The change first shows up in the file on disk, and only then — when I ask — does the skill send the new page content. That way every update has a local copy to review.', 'Update the “Q4 rollout plan” page in Confluence with the content of this file'),
        { type: 'editor', file: CONF_FILE, text: CONF_UPDATE },
        {
          type: 'ask',
          on: 'vscode',
          text: 'Update the “Q4 rollout plan” page in Confluence with the content of this file',
          then: [
            {
              type: 'terminal',
              lines: [
                { role: 'tool', text: 'curl -s -X PUT …/confluence/page/900001 --data @user-data/tmp/confluence-page.json', summary: 'HTTP 200' },
                { role: 'assistant', text: 'Updated page 900001 “Q4 rollout plan” — version 8, with an “Apps” section added.' },
              ],
            },
          ],
        },
        { type: 'camera', target: '#demo-vsc-terminal', zoom: 1.25 },
      ],
    },
  ],
};
