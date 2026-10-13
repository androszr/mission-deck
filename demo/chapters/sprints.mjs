// demo/chapters/sprints.mjs
// Chapter `sprints`: "how did the last sprint go?" in the Claude panel, then
// Activity > Sprint Stats (previous-sprint tab, per-team tiles, trend,
// an expanded team row) and Activity > Sprint Review (team cards, goal
// status, generated agenda). Mirrors modules/sprint-stats and
// modules/sprint-review; every number, goal and topic is invented.

import { narrate } from './_helpers.mjs';

const STATS = 'sprinty-stats';
const REVIEW = 'sprinty-review';

const say = (text) => ({ type: 'terminal', on: 'cockpit', lines: [{ role: 'assistant', text }] });
const closePanel = { type: 'terminal', on: 'cockpit', close: true };
const LOG = (step) => ({ type: 'progress', target: '#sprinty-refresh-log', format: 'log', lines: [{ step }] });
const PCT = (n, step) => [
  { type: 'progress', pct: n, bar: '#sprinty-refresh-fill' },
  { type: 'progress', label: n + '%', labelTarget: '#sprinty-refresh-pct' },
  { type: 'progress', label: step, labelTarget: '#sprinty-refresh-step' },
];

export default {
  pages: [
    { hub: 'activity', view: STATS, label: 'Sprint Stats', mock: 'sprinty-stats-page', initial: false },
    { hub: 'activity', view: REVIEW, label: 'Sprint Review', mock: 'sprinty-review-page', initial: false },
  ],
  setup: [
    { type: 'flyout', view: STATS },
    { type: 'flyout', view: REVIEW },
  ],
  steps: [
    {
      id: 'sprinty-polecenie',
      caption: 'I ask Claude: **how did the last sprint go?**',
      mascot: 'working',
      actions: [
        narrate('A question about the sprint', 'Instead of clicking through Jira boards I ask in the Claude terminal. Claude does not reach into Jira itself: a script of the “Sprint Stats” module fetches the sprint data, so we refresh it first.'),
        {
          type: 'ask',
          text: 'how did the last sprint go?',
          then: [
            { type: 'camera', target: '#claude-terminal-panel', zoom: 1.3 },
            say('A script of the “Sprint Stats” module fetches the sprint data from Jira — I do not fetch it. I am opening the module; click “Refresh”, and then I will read the anonymized version.'),
            { type: 'wait', ms: 600 },
            { type: 'camera', full: true },
            closePanel,
          ],
        },
        { type: 'navigate', view: STATS },
      ],
    },
    {
      id: 'sprinty-odswiez',
      caption: 'I click **Refresh** — a Python script fetches the sprints from Jira, not AI.',
      mascot: 'idle',
      actions: [
        narrate('Refreshing Sprint Stats', 'The window shows how old the data of both boards is. “Refresh active sprints” runs a Python script that fetches the active and closed sprints from Jira — stage by stage, with a log.'),
        { type: 'camera', target: '#' + STATS + '-actions', zoom: 1.8 },
        { type: 'click', target: '#sprinty-refresh-btn' },
        { type: 'camera', full: true },
        { type: 'modal', open: 'sprinty-refresh-modal' },
        { type: 'camera', target: '#sprinty-refresh-modal .ds-modal', zoom: 1.4 },
        { type: 'click', target: '#sprinty-refresh-active' },
        { type: 'hide', target: '#sprinty-refresh-confirm' },
        { type: 'hide', target: '#sprinty-footer-confirm' },
        { type: 'hide', target: '#sprinty-refresh-progress', hidden: false },
        { type: 'hide', target: '#sprinty-footer-progress', hidden: false },
        LOG('Starting the Sprint Stats refresh.'),
        { type: 'badge', target: '#sprinty-stage-demo', tone: 'blue', text: 'in progress' },
        ...PCT(10, 'DEMO: fetching sprints...'),
        LOG('DEMO: start.'),
        ...PCT(45, 'DEMO: saving the results...'),
        LOG('DEMO: done (6 sprints).'),
        { type: 'badge', target: '#sprinty-stage-demo', tone: 'green', text: 'done' },
        { type: 'badge', target: '#sprinty-stage-comet', tone: 'blue', text: 'in progress' },
        ...PCT(60, 'Comet: fetching sprints...'),
        LOG('Comet: start.'),
        ...PCT(90, 'Comet: saving the results...'),
      ],
    },
    {
      id: 'sprinty-odswiezone',
      caption: 'Refreshed — **eleven sprints** saved on this computer.',
      mascot: 'wave',
      actions: [
        narrate('Data in place', 'The script saved the sprints in the data repository on this computer. They reach the team once pushed in the Sync window.'),
        LOG('Comet: done (5 sprints).'),
        { type: 'badge', target: '#sprinty-stage-comet', tone: 'green', text: 'done' },
        ...PCT(100, 'Done'),
        LOG('Refresh finished: 11 sprints saved.'),
        { type: 'show', mock: 'sprinty-refresh-close-on', target: '#sprinty-refresh-close', mode: 'outer' },
        { type: 'wait', ms: 600 },
        { type: 'click', target: '#sprinty-refresh-close' },
        { type: 'modal', close: '#sprinty-refresh-modal' },
        { type: 'camera', full: true },
      ],
    },
    {
      id: 'sprinty-pytanie',
      caption: 'Claude reads the **anonymized** results and sums up the sprint.',
      mascot: 'thinking',
      actions: [
        narrate('An answer on anonymized data', 'Now Claude can answer — but it sees only team aggregates. The people from the task lists are replaced with “Person A…”, task keys and emails are removed. The counter shows how many fields were replaced.'),
        {
          type: 'ask',
          text: 'how did the last sprint go?',
          then: [
            { type: 'camera', target: '#claude-terminal-panel', zoom: 1.3 },
            { type: 'terminal', on: 'cockpit', lines: [
              { role: 'dim', text: 'The Sprint Stats module script fetched the data - it goes through anonymization before being read.' },
              { role: 'ok', text: 'Anonymization: 62 fields replaced - people → Person A…Person P, task keys and emails removed' },
              { role: 'assistant', text: 'Sprint 41 is closed: the teams delivered 89% to 97% of their commitments, and Borealis had the fewest drops. The details are on the “Active - 1” tab.' },
            ] },
            { type: 'wait', ms: 600 },
            { type: 'camera', full: true },
            closePanel,
          ],
        },
      ],
    },
    {
      id: 'sprinty-poprzedni',
      caption: 'I switch to the **previous sprint** and read the team tiles.',
      mascot: 'thinking',
      actions: [
        narrate('Commitment versus delivery', 'The tabs are sprints counted from the active one. In “Active - 1” every team has its row of tiles: how many points it committed, how many it delivered, what dropped and what percentage that is.'),
        { type: 'camera', target: '.sprinty-tabs', zoom: 1.8 },
        { type: 'click', target: '[data-sprinty-tab="1"]' },
        { type: 'show', mock: 'sprinty-stats-body', target: '#' + STATS + '-root', props: { offset: 1 } },
        { type: 'camera', target: '#sprinty-tiles', zoom: 1.3 },
        { type: 'wait', ms: 1200 },
      ],
    },
    {
      id: 'sprinty-trend',
      caption: 'I look at the **trend** and expand the Atlas tasks.',
      mascot: 'working',
      actions: [
        narrate('Trend and tasks', 'The charts show the last seven sprints: commitments, delivery and drops. In the table below them a team’s row expands into a list of Jira tasks — with the person, the estimate and the status.'),
        { type: 'camera', full: true },
        { type: 'scroll', target: '#sprinty-trend' },
        { type: 'camera', target: '#sprinty-trend', zoom: 1.25 },
        { type: 'wait', ms: 1000 },
        { type: 'camera', full: true },
        { type: 'scroll', target: '#sprinty-table' },
        { type: 'click', target: '[data-sprinty-expand="Atlas"]' },
        { type: 'show', mock: 'sprinty-stats-body', target: '#' + STATS + '-root', props: { offset: 1, expanded: 'Atlas' } },
        { type: 'scroll', target: '#sprinty-table' },
        { type: 'camera', target: '#sprinty-table .ds-table-wrap', zoom: 1.3 },
        { type: 'wait', ms: 900 },
      ],
    },
    {
      id: 'sprinty-review',
      caption: 'I move to **Sprint Review** — the session is in three days.',
      mascot: 'working',
      actions: [
        narrate('Preparing the review', 'The “Sprint Review” module holds the meeting session: the date, the host, and for every team the sprint goal and the submitted topics. Some cards are already approved.'),
        { type: 'camera', full: true },
        { type: 'navigate', view: REVIEW },
        { type: 'camera', target: '.sprinty-session-header', zoom: 1.6 },
        { type: 'wait', ms: 700 },
        { type: 'camera', target: '#sprinty-team-grid', zoom: 1.2 },
        { type: 'wait', ms: 600 },
      ],
    },
    {
      id: 'sprinty-status',
      caption: 'I mark the Atlas goal as **achieved**.',
      mascot: 'success',
      actions: [
        narrate('The goal status', 'The segments under the sprint goal record whether the team achieved it — fully, partly or not at all. That goes into the agenda and the review history.'),
        { type: 'camera', target: '[data-sprinty-team="Atlas"]', zoom: 1.6 },
        { type: 'click', target: '[data-sprinty-status="Atlas-achieved"]' },
        { type: 'show', mock: 'sprinty-team-card', target: '[data-sprinty-team="Atlas"]', mode: 'outer', props: { team: 'Atlas', status: 'achieved' } },
        { type: 'wait', ms: 800 },
      ],
    },
    {
      id: 'sprinty-agenda',
      caption: 'I generate the meeting **agenda** with one click.',
      mascot: 'celebrating',
      actions: [
        narrate('An agenda from the topics', 'The topics of all teams become an agenda with an order and timings. You can copy it into the invitation or download it as a visual board.'),
        { type: 'camera', full: true },
        { type: 'scroll', target: '#sprinty-agenda' },
        { type: 'click', target: '#sprinty-agenda-generate' },
        { type: 'show', mock: 'sprinty-agenda', target: '#sprinty-agenda-slot', props: { open: true } },
        { type: 'scroll', target: '#sprinty-agenda' },
        { type: 'camera', target: '#sprinty-agenda', zoom: 1.3 },
        { type: 'click', target: '#sprinty-agenda-copy' },
        { type: 'toast', variant: 'success', title: 'Agenda copied' },
        { type: 'wait', ms: 900 },
        { type: 'camera', target: '#sprinty-agenda', zoom: 1.05 },
      ],
    },
  ],
};
