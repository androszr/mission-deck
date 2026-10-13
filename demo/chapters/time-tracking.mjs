// demo/chapters/time-tracking.mjs
// Chapter `time-tracking`: "refresh time logging" typed into the Claude
// panel, then the full road Team > Time logging. First the REFRESH:
// "Fetch from Jira" runs the module's own server stream (Tempo REST, a plain
// script - never the AI) in its progress modal. Then how a person USES the
// page: team filter, a cell tooltip, spotting who did not log time (with the
// Teams draft), an anonymized question to Claude and "Clear".
// Mirrors modules/time-log; every number is painted.

import { narrate, VAULT_OPEN, anonymize } from './_helpers.mjs';

const VIEW = 'czas-pracy-logowanie';
const ROOT = '#' + VIEW + '-root';

/** A Claude line in the cockpit's bottom terminal panel. */
const say = (text) => ({ type: 'terminal', on: 'cockpit', lines: [{ role: 'assistant', text }] });
const closePanel = { type: 'terminal', on: 'cockpit', close: true };

export default {
  pages: [
    { hub: 'team', view: VIEW, label: 'Time logging', mock: 'czas-pracy-page', initial: false },
  ],
  setup: [
    VAULT_OPEN,
    { type: 'flyout', view: 'zespol-sklad' },
    { type: 'flyout', view: VIEW },
  ],
  steps: [
    {
      id: 'czas-pracy-polecenie',
      caption: 'I ask Claude: **refresh time logging** — and go to the module.',
      mascot: 'working',
      actions: [
        narrate('A request in the terminal', 'I write in the Claude Code terminal what I need. Claude does not fetch the data itself: it points to the “Time logging” module in the Team hub, whose server reads Tempo with a plain script.'),
        {
          type: 'ask',
          text: 'refresh time logging',
          then: [
            { type: 'camera', target: '#claude-terminal-panel', zoom: 1.3 },
            say('The Tempo worklogs are fetched by the server of the “Time logging” module (Team hub) — a deterministic script; I do not read that data. I am opening the module; click “Fetch from Jira”.'),
            { type: 'wait', ms: 600 },
            { type: 'camera', full: true },
          ],
        },
        { type: 'navigate', view: VIEW },
      ],
    },
    {
      id: 'czas-pracy-pobierz',
      caption: 'I click **Fetch from Jira** — a server script fetches the worklogs, not AI.',
      mascot: 'idle',
      actions: [
        narrate('Fetching from Tempo', 'The module server walks the Jira projects and fetches the worklogs of the last two weeks, then matches the authors to the team directory. It is a plain script — no AI model touches this data. The progress window stays until the work is done.'),
        closePanel,
        { type: 'camera', target: '#czas-pracy-alert', zoom: 1.6 },
        { type: 'wait', ms: 700 },
        { type: 'camera', target: '#czas-pracy-logowanie-actions', zoom: 1.8 },
        { type: 'click', target: '#czas-pracy-fetch' },
        { type: 'camera', full: true },
        { type: 'modal', open: 'czas-pracy-modal' },
        { type: 'camera', target: '#czas-pracy-modal .ds-modal', zoom: 1.35 },
        { type: 'progress', pct: 8, bar: '#czas-pracy-fill' },
        { type: 'progress', target: '#czas-pracy-log', format: 'log', lines: [{ step: 'Fetching worklogs from project DEMO (1/3)' }] },
        { type: 'progress', pct: 35, bar: '#czas-pracy-fill' },
        { type: 'progress', target: '#czas-pracy-log', format: 'log', lines: [{ step: 'Fetching worklogs from project CORE (2/3)' }] },
        { type: 'progress', pct: 62, bar: '#czas-pracy-fill' },
        { type: 'progress', target: '#czas-pracy-log', format: 'log', lines: [{ step: 'Fetching worklogs from project OPS (3/3)' }] },
        { type: 'progress', pct: 85, bar: '#czas-pracy-fill' },
        { type: 'progress', target: '#czas-pracy-log', format: 'log', lines: [{ step: 'Matching authors to the team directory' }] },
        { type: 'progress', pct: 95, bar: '#czas-pracy-fill' },
        { type: 'progress', target: '#czas-pracy-log', format: 'log', lines: [{ step: 'Saving the data on this computer' }] },
      ],
    },
    {
      id: 'czas-pracy-wynik',
      caption: 'Done: **386 entries** for eleven people.',
      mascot: 'wave',
      actions: [
        narrate('The fetch result', 'The bar reaches the end, and the window says how many entries and people were fetched. The data is on this computer — it reaches the team only after you push it in the Sync window.'),
        { type: 'progress', pct: 100, bar: '#czas-pracy-fill' },
        { type: 'show', mock: 'czas-pracy-result', target: '#czas-pracy-result' },
        { type: 'show', mock: 'czas-pracy-close-on', target: '#czas-pracy-close', mode: 'outer' },
        { type: 'toast', variant: 'success', title: 'Time logs fetched', desc: '11 people, 386 entries' },
        { type: 'wait', ms: 900 },
      ],
    },
    {
      id: 'czas-pracy-gotowe',
      caption: 'I close the window — the grid has **turned green**, almost everyone has logged time.',
      mascot: 'success',
      actions: [
        narrate('A fresh grid', 'Once the window closes the grid repaints from the new data: Friday 02.10, the last workday, is now at 91% logged. The sync bar reminds you that changes are waiting to be pushed.'),
        { type: 'click', target: '#czas-pracy-close' },
        { type: 'modal', close: '#czas-pracy-modal' },
        { type: 'camera', full: true },
        { type: 'show', mock: 'czas-pracy-body', target: ROOT, props: { fresh: true } },
        { type: 'show', mock: 'czas-pracy-sync-local', target: '#msb-czas-pracy-logowanie', mode: 'outer' },
        { type: 'camera', target: '#czas-pracy-alert', zoom: 1.6 },
        { type: 'wait', ms: 900 },
        { type: 'camera', target: '#msb-czas-pracy-logowanie', zoom: 1.6 },
        { type: 'wait', ms: 700 },
        { type: 'camera', full: true },
      ],
    },
    {
      id: 'czas-pracy-filtr',
      caption: 'Now I **use** it: I narrow the grid to the Borealis team.',
      mascot: 'working',
      actions: [
        narrate('The team filter', 'Day to day a manager looks at their own team. The segments above the grid narrow the list to one team, and the counter shows “3 of 11”.'),
        { type: 'camera', target: '.czas-pracy-toolbar', zoom: 1.25 },
        { type: 'click', target: '[data-czas-pracy-team="Borealis"]' },
        { type: 'show', mock: 'czas-pracy-body', target: ROOT, props: { fresh: true, team: 'Borealis' } },
        { type: 'wait', ms: 600 },
        { type: 'camera', target: '.czas-pracy-grid-wrap', zoom: 1.25 },
        { type: 'wait', ms: 700 },
      ],
    },
    {
      id: 'czas-pracy-komorka',
      caption: 'I hover over a **cell**: how many hours, and on which Jira tasks.',
      mascot: 'thinking',
      actions: [
        narrate('The cell tooltip', 'The shade of green is the number of hours. Hovering over a cell shows the day’s total, the Jira tasks and the time of the entry — without opening Tempo.'),
        { type: 'hover', target: '[data-czas-pracy-cell="morgan-1"]', ms: 200 },
        { type: 'show', mock: 'czas-pracy-tooltip', target: '[data-czas-pracy-cell="morgan-1"]', mode: 'append' },
        { type: 'wait', ms: 1400 },
      ],
    },
    {
      id: 'czas-pracy-brak',
      caption: 'I spot **who has not logged** time on Friday and prepare a Teams reminder.',
      mascot: 'thinking',
      actions: [
        narrate('Who has not logged time', 'A red cell is a day with no log, and the counter on the row shows the gaps. The button next to the name prepares a draft Teams message with the list of days — the demo sends nothing.'),
        { type: 'hide', target: '#czas-pracy-tooltip' },
        { type: 'show', mock: 'czas-pracy-body', target: ROOT, props: { fresh: true, team: 'Borealis', spot: 'casey' } },
        { type: 'hover', target: '[data-czas-pracy-miss="casey-1"]', ms: 900 },
        { type: 'click', target: '[data-czas-pracy-teams="casey"]' },
        { type: 'camera', full: true },
        { type: 'modal', open: 'czas-pracy-teams-modal' },
        { type: 'camera', target: '#czas-pracy-teams-modal .ds-modal', zoom: 1.4 },
        { type: 'wait', ms: 900 },
      ],
    },
    {
      id: 'czas-pracy-pytanie',
      caption: 'I copy the draft and ask Claude about the gaps — it sees only **pseudonyms**, not names.',
      mascot: 'thinking',
      actions: [
        narrate('A question on anonymized data', 'The draft for Casey is waiting on the clipboard — I close the window. I can also ask Claude for a summary, but it gets only the anonymized version: the anonymization step, a plain script on this computer, replaces people with “Person A…K” and removes emails and task keys. Only I know who is who — from the grid in Mission Deck.'),
        { type: 'click', target: '#czas-pracy-teams-copy' },
        { type: 'modal', close: '#czas-pracy-teams-modal' },
        { type: 'camera', full: true },
        {
          type: 'ask',
          text: 'who has not logged time on Friday?',
          then: [
            { type: 'camera', target: '#claude-terminal-panel', zoom: 1.3 },
            { type: 'terminal', on: 'cockpit', lines: [
              ...anonymize('the module data goes through anonymization before Claude reads it.', '47 fields replaced - people → Person A…Person K, emails and task keys removed.'),
              { role: 'assistant', text: 'On the anonymized version: on 02.10 one person has no log (Person F) — 10 of 11 logged time. Over the last 14 days 3 people have gaps — 4 days in total.' },
            ] },
            { type: 'wait', ms: 700 },
            { type: 'camera', full: true },
          ],
        },
      ],
    },
    {
      id: 'czas-pracy-wyczysc',
      caption: '**Clear** goes back to the whole team — the view is ready for tomorrow.',
      mascot: 'success',
      actions: [
        narrate('Back to the whole picture', '“Clear” removes the team filter. The indicator above the grid says at once what share of the team logged time on the last workday.'),
        closePanel,
        { type: 'camera', target: '.czas-pracy-toolbar', zoom: 1.25 },
        { type: 'click', target: '#czas-pracy-clear' },
        { type: 'show', mock: 'czas-pracy-body', target: ROOT, props: { fresh: true } },
        { type: 'camera', target: '#czas-pracy-alert', zoom: 1.6 },
        { type: 'wait', ms: 800 },
        { type: 'camera', full: true },
      ],
    },
  ],
};
