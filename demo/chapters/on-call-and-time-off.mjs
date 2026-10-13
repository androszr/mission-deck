// demo/chapters/on-call-and-time-off.mjs
// Chapter `on-call-and-time-off`: two everyday team modules in hub Support.
//  - "On-call" (modules/on-call): "Sync with Confluence" makes
//    the module SERVER read the Confluence page over REST and parse the duty
//    table deterministically; then who is on duty today, the day modal and the
//    hours / coordination / on-call tables.
//  - "Time off" (modules/time-off): "Fetch" runs the module's Python
//    script (scripts/sharepoint_time_off.py) which needs a one-time company
//    sign-in - shown on the neutral "Company sign-in (SSO)" mock with a
//    fictitious account; then who is on leave, the person popover, filters.
// No AI ever reads this data. Every person, phone and address is invented.

import { narrate } from './_helpers.mjs';

const DY = 'dyzury-i-urlopy-dyzury';
const UR = 'dyzury-i-urlopy-urlopy';
const P = 'dyzury-i-urlopy';

const say = (text) => ({ type: 'terminal', on: 'cockpit', lines: [{ role: 'assistant', text }] });
const closePanel = { type: 'terminal', on: 'cockpit', close: true };
const dyLog = (step) => ({ type: 'progress', target: '#' + P + '-dy-log', format: 'log', lines: [{ step }] });
const urLog = (step) => ({ type: 'progress', target: '#' + P + '-ur-progress-log', format: 'log', lines: [{ step }] });

export default {
  pages: [
    { hub: 'support', view: DY, label: 'On-call', mock: 'dyzury-i-urlopy-dy-page', initial: false },
    { hub: 'support', view: UR, label: 'Time off', mock: 'dyzury-i-urlopy-ur-page', initial: false },
  ],
  setup: [
    { type: 'flyout', view: DY },
    { type: 'flyout', view: UR },
  ],
  steps: [
    {
      id: 'dyzury-i-urlopy-polecenie',
      caption: 'I ask Claude: **who is on call today?** — the answer is in a module, not in AI.',
      mascot: 'working',
      actions: [
        narrate('On-call and time off', 'The on-call rota and the time-off calendar are team data. Claude neither fetches nor reads them — it points to two modules in the Support hub that fetch them with scripts.'),
        {
          type: 'ask',
          text: 'who is on call today?',
          then: [
            { type: 'camera', target: '#claude-terminal-panel', zoom: 1.3 },
            say('The on-call rota is shown by the “On-call” module (Support hub): the server fetches the page from Confluence and parses the table — I do not read that data. I am opening the module.'),
            { type: 'wait', ms: 600 },
            { type: 'camera', full: true },
            closePanel,
          ],
        },
        { type: 'navigate', view: DY },
        { type: 'camera', target: '.dyzury-i-urlopy-dy-card', zoom: 1.2 },
        { type: 'wait', ms: 700 },
      ],
    },
    {
      id: 'dyzury-i-urlopy-dy-sync',
      caption: 'I click **Sync with Confluence** — a server script reads the rota, not AI.',
      mascot: 'working',
      actions: [
        narrate('Syncing the rota', 'There is no rota for October yet. The module server fetches the “On-call rota” page from Confluence over REST, takes the table apart with a deterministic parser and saves the months as files in the data repository.'),
        { type: 'camera', target: '#' + DY + '-actions', zoom: 1.8 },
        { type: 'click', target: '#' + P + '-dy-sync' },
        { type: 'show', mock: 'dyzury-i-urlopy-dy-actions', target: '#' + DY + '-actions', props: { busy: true } },
        { type: 'camera', full: true },
        { type: 'show', mock: 'dyzury-i-urlopy-dy-log', target: '#' + P + '-dy-sticky' },
        { type: 'camera', target: '#' + P + '-dy-sticky', zoom: 1.5 },
        dyLog('Fetching the “On-call rota” page from Confluence (version 52)'),
        dyLog('Parsing the rota table: 4 columns, 153 days'),
        dyLog('Saving index.json and 5 month files'),
        { type: 'show', mock: 'dyzury-i-urlopy-dy-actions', target: '#' + DY + '-actions', props: {} },
        { type: 'show', mock: 'dyzury-i-urlopy-dy-body', target: '#' + DY + '-root', props: { synced: true } },
        { type: 'show', mock: 'dyzury-i-urlopy-sync-local', target: '#msb-' + DY, mode: 'outer', props: { view: DY } },
        { type: 'toast', variant: 'success', title: 'Rota fetched', desc: '5 months, 412 entries' },
        { type: 'camera', target: '.dyzury-i-urlopy-dy-card', zoom: 1.2 },
        { type: 'wait', ms: 900 },
      ],
    },
    {
      id: 'dyzury-i-urlopy-dy-dzis',
      caption: 'I click **today** — I see who is on call and how to reach them.',
      mascot: 'working',
      actions: [
        narrate('Who is on call today', 'Today has a frame in the accent colour, and the ring around an avatar says which scope someone covers. Clicking a day opens the list of people on call with their scopes, phone and email.'),
        { type: 'click', target: '[data-dyzury-i-urlopy-day="4"]' },
        { type: 'camera', full: true },
        { type: 'modal', open: 'dyzury-i-urlopy-day-modal' },
        { type: 'camera', full: true },
        { type: 'wait', ms: 1300 },
      ],
    },
    {
      id: 'dyzury-i-urlopy-dy-tydzien',
      caption: 'I look through **this week** and the on-call table with contacts.',
      mascot: 'working',
      actions: [
        narrate('The week and the contacts', 'The first row of the calendar is the current week — you see at once who takes over on Monday. Below the calendar are the on-call hours, coordination and the full list of people on call with their phones.'),
        { type: 'click', target: '#' + P + '-day-close' },
        { type: 'modal', close: '#dyzury-i-urlopy-day-modal' },
        { type: 'camera', full: true },
        { type: 'camera', target: '[data-dyzury-i-urlopy-week="0"]', zoom: 1.4 },
        { type: 'wait', ms: 900 },
        { type: 'camera', full: true },
        { type: 'scroll', target: '#' + P + '-dyzurni' },
        { type: 'camera', target: '#' + P + '-dyzurni', zoom: 1.2 },
        { type: 'wait', ms: 900 },
        { type: 'camera', full: true },
      ],
    },
    {
      id: 'dyzury-i-urlopy-ur-pobierz',
      caption: 'I move to **time off** and click Fetch — the spreadsheet needs a company sign-in.',
      mascot: 'idle',
      actions: [
        narrate('Fetching time off', 'Time off lives in a spreadsheet in the company SharePoint. “Fetch” runs the module’s Python script: it first checks the saved sign-in session, and if there is none it opens a browser window for a one-time sign-in.'),
        { type: 'navigate', view: UR },
        { type: 'camera', target: '#' + UR + '-actions', zoom: 1.8 },
        { type: 'click', target: '#' + P + '-ur-fetch' },
        { type: 'camera', full: true },
        { type: 'hide', target: '#' + P + '-ur-progress', hidden: false },
        { type: 'camera', target: '#' + P + '-ur-progress', zoom: 1.2 },
        urLog('Starting the fetch...'),
        urLog('Checking the saved sign-in session...'),
        urLog('Sign in in the open browser window (company sign-in + MFA, tick “Stay signed in”)...'),
        { type: 'wait', ms: 600 },
      ],
    },
    {
      id: 'dyzury-i-urlopy-ur-sso',
      caption: 'I sign in once in the company **sign-in window** — the account is fictitious.',
      mascot: 'idle',
      actions: [
        narrate('Company sign-in (SSO)', 'The script opens an ordinary browser window. A person signs in there themselves and confirms on their phone; the session stays on this computer. Neither Mission Deck nor AI sees the password. The demo shows this on a neutral mock.'),
        { type: 'camera', full: true },
        { type: 'surface', show: 'screen', mock: 'dyzury-i-urlopy-sso-screen' },
        { type: 'camera', target: '.dyzury-i-urlopy-sso-card', zoom: 1.35 },
        { type: 'type', target: '#' + P + '-sso-email', text: 'alex.morgan@example.com' },
        { type: 'type', target: '#' + P + '-sso-password', text: 'demo-only-password', mask: true },
        { type: 'click', target: '#' + P + '-sso-submit' },
        { type: 'hide', target: '#' + P + '-sso-mfa', hidden: false },
        { type: 'wait', ms: 1200 },
        { type: 'hide', target: '#' + P + '-sso-mfa' },
        { type: 'hide', target: '#' + P + '-sso-ok', hidden: false },
        { type: 'hide', target: '#' + P + '-sso-note', hidden: false },
        { type: 'wait', ms: 800 },
      ],
    },
    {
      id: 'dyzury-i-urlopy-ur-pobrane',
      caption: 'The script fetched the **time-off sheet** — the data stays on this computer.',
      mascot: 'working',
      actions: [
        narrate('Sheet fetched', 'The window closes by itself. The script downloads the sheet, turns it into per-person files and saves them in the data repository. They reach the team on the next sync.'),
        { type: 'camera', full: true },
        { type: 'surface', show: 'cockpit' },
        { type: 'camera', target: '#' + P + '-ur-progress', zoom: 1.2 },
        urLog('The sign-in session is current.'),
        urLog('Downloading the sheet from SharePoint...'),
        urLog('Processed 214 rows of the sheet.'),
        { type: 'toast', variant: 'success', title: 'Time off fetched', desc: '214 entries, 16 people' },
        { type: 'wait', ms: 500 },
        { type: 'camera', full: true },
        { type: 'show', mock: 'dyzury-i-urlopy-ur-body', target: '#' + P + '-ur-root', props: { fetched: true } },
        { type: 'show', mock: 'dyzury-i-urlopy-ur-done', target: '#' + P + '-ur-progress', mode: 'outer' },
        { type: 'show', mock: 'dyzury-i-urlopy-sync-local', target: '#msb-' + UR, mode: 'outer', props: { view: UR } },
        { type: 'wait', ms: 600 },
      ],
    },
    {
      id: 'dyzury-i-urlopy-ur-kto',
      caption: 'I check **who is on leave** next week.',
      mascot: 'thinking',
      actions: [
        narrate('Who is on leave', 'The counter above the calendar says how many people are on leave this month. Hovering over an avatar shows the person, their team and the date range with the number of workdays.'),
        { type: 'camera', target: '.dyzury-i-urlopy-ur-card', zoom: 1.05 },
        { type: 'click', target: '[data-dyzury-i-urlopy-leave="jordan.lee5"]' },
        { type: 'show', mock: 'dyzury-i-urlopy-popover', target: '[data-dyzury-i-urlopy-uday="5"]', mode: 'append' },
        { type: 'wait', ms: 1500 },
        { type: 'hide', target: '#' + P + '-popover' },
      ],
    },
    {
      id: 'dyzury-i-urlopy-ur-filtr',
      caption: 'I filter by **team** and look for a specific person.',
      mascot: 'working',
      actions: [
        narrate('Filters', 'The team list narrows the calendar to one team, and the search field to one person. The counter changes with the filters.'),
        { type: 'camera', target: '.dyzury-i-urlopy-ur-filters', zoom: 1.3 },
        { type: 'click', target: '#' + P + '-ur-team' },
        { type: 'show', mock: 'dyzury-i-urlopy-ur-body', target: '#' + P + '-ur-root', props: { fetched: true, team: 'Borealis' } },
        { type: 'camera', target: '.dyzury-i-urlopy-ur-card', zoom: 1.15 },
        { type: 'wait', ms: 1000 },
        { type: 'camera', target: '.dyzury-i-urlopy-ur-filters', zoom: 1.3 },
        { type: 'type', target: '#' + P + '-ur-search', text: 'Rowan' },
        { type: 'show', mock: 'dyzury-i-urlopy-ur-body', target: '#' + P + '-ur-root', props: { fetched: true, team: 'Borealis', search: 'Rowan' } },
        { type: 'camera', target: '.dyzury-i-urlopy-ur-card', zoom: 1.15 },
        { type: 'wait', ms: 900 },
      ],
    },
    {
      id: 'dyzury-i-urlopy-koniec',
      caption: 'On-call and time off **at hand** — scripts fetched the data, AI never touched it.',
      mascot: 'success',
      actions: [
        narrate('Done', 'The rota and the time off are up to date, and the sync bars remind you to push the changes to the team. Module scripts fetched everything — the AI model never saw a single name.'),
        { type: 'show', mock: 'dyzury-i-urlopy-ur-body', target: '#' + P + '-ur-root', props: { fetched: true } },
        { type: 'camera', target: '#msb-' + UR, zoom: 1.6 },
        { type: 'wait', ms: 1000 },
        { type: 'camera', full: true },
      ],
    },
  ],
};
