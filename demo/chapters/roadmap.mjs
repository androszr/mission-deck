// demo/chapters/roadmap.mjs
// Chapter `roadmap`: "show me the Q4 roadmap" in the Claude panel, then
// Initiatives > Product roadmap through its three tabs (Table with the
// "Role filter" strip and RAG dots, Roadmap with the year timeline zoomed
// onto Q4, Kanban), then Initiatives > Gantt roadmap (the weekly Gantt of the
// quarter) and its HTML export as a preview. Mirrors
// modules/roadmap and modules/gantt-roadmap; data invented.

import { narrate } from './_helpers.mjs';

const CS = 'roadmapa-produkt';
const GANTT = 'roadmapa-gantt';
const ROOT = '#' + CS + '-root';

const say = (text) => ({ type: 'terminal', on: 'cockpit', lines: [{ role: 'assistant', text }] });
const closePanel = { type: 'terminal', on: 'cockpit', close: true };

const EXPORT_PREVIEW = [
  '<!doctype html>',
  '<html lang="en">',
  '<title>Gantt roadmap — Q4 2026</title>',
  '<h1>Gantt roadmap — Q4 2026</h1>',
  '<div class="meta">Generated: 04.10.2026 · 9 tasks · 4 areas</div>',
  '<div class="gantt-month-row">Task | Sep | Oct | Nov | Dec</div>',
  '<div class="gantt-row">Week | W40 | W41 | W42 | … | W53</div>',
  '<div class="gantt-lane">Orders — Quantity suggestions — pilot (W40–W43)</div>',
  '<div class="gantt-lane">Availability — A new stock-availability metric (W41–W45)</div>',
  '…  (a standalone file: styles and data in one HTML)',
];

export default {
  pages: [
    { hub: 'initiatives', view: CS, label: 'Product roadmap', mock: 'roadmapa-produkt-page', initial: false },
    { hub: 'initiatives', view: GANTT, label: 'Gantt roadmap', mock: 'roadmapa-gantt-page', initial: false },
  ],
  setup: [
    { type: 'flyout', view: CS },
    { type: 'flyout', view: GANTT },
  ],
  steps: [
    {
      id: 'roadmapa-polecenie',
      caption: 'I ask Claude: **show me the Q4 roadmap**.',
      mascot: 'working',
      actions: [
        narrate('A roadmap for the quarter', 'I write in the Claude terminal what I want to see. The module server fetches the Jira data, and Claude sees only its anonymized version. The initiative roadmaps are in the Initiatives hub: “Product roadmap” for Discovery and “Gantt roadmap” with a weekly Gantt chart.'),
        {
          type: 'ask',
          text: 'show me the Q4 roadmap',
          then: [
            { type: 'camera', target: '#claude-terminal-panel', zoom: 1.3 },
            { type: 'terminal', on: 'cockpit', lines: [
              { role: 'dim', text: 'The module server synced the initiatives with Jira - they go through anonymization before being read.' },
              { role: 'ok', text: 'Anonymization: 38 fields replaced - people → Person A…Person N, emails removed' },
            ] },
            say('On the anonymized version: four product initiatives and nine Gantt tasks are planned for Q4. I am opening “Product roadmap” — I will start with the table, then the timeline.'),
            { type: 'wait', ms: 500 },
            { type: 'camera', full: true },
            closePanel,
          ],
        },
        { type: 'navigate', view: CS },
      ],
    },
    {
      id: 'roadmapa-tabela',
      caption: 'In the **Table** I read the RAG status and filter the people strip by role.',
      mascot: 'thinking',
      actions: [
        narrate('The initiatives table', 'Every row is an initiative with a Jira epic, a RAG status, people and the Discovery, Delivery and go-live dates. The strip above the table shows who works on what day by day — the “Role filter” narrows it to one role.'),
        { type: 'camera', target: '#roadmapa-table', zoom: 1.2 },
        { type: 'hover', target: '[data-roadmapa-rag="2"]', ms: 700 },
        { type: 'hover', target: '[data-roadmapa-rag="4"]', ms: 700 },
        { type: 'camera', target: '#roadmapa-strip-slot', zoom: 1.3 },
        { type: 'click', target: '[data-roadmapa-role="po"]' },
        { type: 'show', mock: 'roadmapa-strip', target: '#roadmapa-strip-slot', props: { role: 'po' } },
        { type: 'wait', ms: 800 },
      ],
    },
    {
      id: 'roadmapa-os-czasu',
      caption: 'I switch to the **Roadmap** and zoom into the fourth quarter.',
      mascot: 'working',
      actions: [
        narrate('The timeline', 'The “Roadmap” tab draws the whole year: the blue bar is Discovery, the green one Delivery, the diamond is go-live and the red line is today. The “Months” scale splits the quarters into months.'),
        { type: 'camera', target: '.roadmapa-tabs', zoom: 1.8 },
        { type: 'click', target: '[data-roadmapa-tab="roadmap"]' },
        { type: 'show', mock: 'roadmapa-produkt-body', target: ROOT, props: { tab: 'roadmap' } },
        { type: 'camera', full: true },
        { type: 'click', target: '[data-roadmapa-gran="months"]' },
        { type: 'show', mock: 'roadmapa-produkt-body', target: ROOT, props: { tab: 'roadmap', gran: 'months' } },
        { type: 'camera', target: '#roadmapa-rm-q4', zoom: 1.6 },
        { type: 'wait', ms: 1400 },
      ],
    },
    {
      id: 'roadmapa-kanban',
      caption: 'I look into the **Kanban**: Discovery tasks in status columns.',
      mascot: 'working',
      actions: [
        narrate('The Discovery kanban', 'The kanban shows the Jira tasks grouped by initiative and status. You see at once what sits in the “Blocked” column.'),
        { type: 'camera', full: true },
        { type: 'click', target: '[data-roadmapa-tab="kanban"]' },
        { type: 'show', mock: 'roadmapa-produkt-body', target: ROOT, props: { tab: 'kanban' } },
        { type: 'camera', target: '#roadmapa-board', zoom: 1.2 },
        { type: 'hover', target: '[data-roadmapa-card="DEMO-219"]', ms: 900 },
      ],
    },
    {
      id: 'roadmapa-gantt',
      caption: 'I open the **Gantt roadmap** — week by week across the whole quarter.',
      mascot: 'working',
      actions: [
        narrate('The Gantt chart', 'The “Gantt roadmap” is a weekly Gantt chart of one quarter: months, sprints and weeks at the top, areas with their owners on the left, and task bars in the area colours. A diamond is a milestone.'),
        { type: 'camera', full: true },
        { type: 'navigate', view: GANTT },
        { type: 'camera', target: '#roadmapa-gantt', zoom: 1 },
        { type: 'wait', ms: 1200 },
      ],
    },
    {
      id: 'roadmapa-eksport',
      caption: 'I export the Gantt to **HTML** to send it on.',
      mascot: 'success',
      actions: [
        narrate('HTML export', 'The “Export HTML” button saves a standalone file with the whole quarter — to send by email or paste onto a page. The demo downloads nothing, it only shows the beginning of the file.'),
        { type: 'camera', target: '#' + GANTT + '-actions', zoom: 1.7 },
        { type: 'click', target: '#roadmapa-gantt-export' },
        { type: 'camera', full: true },
        { type: 'toast', variant: 'success', title: 'Roadmap exported', desc: 'gantt-roadmap-q4-2026.html' },
        { type: 'preview', title: 'gantt-roadmap-q4-2026.html', kind: 'html', lines: EXPORT_PREVIEW },
      ],
    },
  ],
};
