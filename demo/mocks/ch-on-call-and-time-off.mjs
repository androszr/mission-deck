// demo/mocks/ch-on-call-and-time-off.mjs
// Painters for chapter `on-call-and-time-off`: "On-call"
// (modules/on-call - month calendar of duty avatars, legend, the day modal,
// the hours / coordination / on-call tables) and "Time off"
// (modules/time-off - search + team filter, month toolbar, the leave calendar,
// the person popover, the fetch progress callout) plus the neutral
// "Company sign-in (SSO)" window the time-off fetch needs. Pure
// (props) => htmlString, DS classes only; module classes renamed
// dyzury-i-urlopy-*. Every person, phone and address is invented.

import { esc, modalShell } from './common.mjs';
import { fruitFaceFor } from '../../assets/avatars/fruit-avatars.mjs';
import { modulePage, syncBar } from './ch-time-tracking.mjs';

const DY = 'dyzury-i-urlopy-dyzury';
const UR = 'dyzury-i-urlopy-urlopy';
const P = 'dyzury-i-urlopy';

const COLUMNS = [
  { key: 'gm', label: 'Inventory', short: 'INV', badge: 'ds-badge--sky' },
  { key: 'zamowienia', label: 'Orders', short: 'ORD', badge: 'ds-badge--mandarine' },
  { key: 'product', label: 'Product', short: 'PR', badge: 'ds-badge--violet' },
  { key: 'devops', label: 'DevOps', short: 'DevOps', badge: 'ds-badge--green' },
];
const DAY_HEADERS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/** Invented on-call people. */
const ONCALL = [
  { name: 'Riley Chen', role: 'Analyst', company: 'Example IT', phone: '+48 600 000 001' },
  { name: 'Taylor Kim', role: 'Product Owner', company: 'Example IT', phone: '+48 600 000 002' },
  { name: 'Morgan Blake', role: 'Analyst', company: 'Example IT', phone: '+48 600 000 003' },
  { name: 'Casey Novak', role: 'Developer', company: 'Demo Software', phone: '+48 600 000 004' },
  { name: 'Drew Patel', role: 'DevOps', company: 'Demo Software', phone: '+48 600 000 005' },
  { name: 'Cameron Shaw', role: 'Developer', company: 'Demo Software', phone: '+48 600 000 006' },
];
const KOORD = [
  { name: 'Avery Quinn', note: 'coordinates the team on-call', phone: '+48 600 000 011' },
  { name: 'Dakota Hale', note: 'deputy', phone: '+48 600 000 012' },
];
const GODZINY = [
  ['Product', 'Mon-Fri', '7:00-9:00 and 16:00-22:00', 'P1 and P2 incidents'],
  ['Product', 'Sat-Sun, holidays', '8:00-20:00', 'P1 outages only'],
  ['Inventory', 'Mon-Sun', '6:00-22:00', 'Deliveries and stocktakes'],
];

const _ini = (n) => n.split(' ').map((w) => w.charAt(0)).join('').slice(0, 2).toUpperCase();
const _slug = (n) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '.');
const _mail = (n) => _slug(n) + '@example.com';

/** October 2026 starts on a Thursday: three empty cells, 31 days, one empty tail. */
function _octCells() {
  const cells = [null, null, null];
  for (let d = 1; d <= 31; d += 1) cells.push({ d, we: ((d + 2) % 7) >= 5 });
  while (cells.length % 7) cells.push(null);
  return cells;
}

/** Who is on duty on day `d` for each column (weekends: two people cover all four). */
function _dutyOf(d, we) {
  if (we) {
    const a = ONCALL[d % 6];
    const b = ONCALL[(d + 3) % 6];
    return [{ p: a, cols: ['gm', 'zamowienia'] }, { p: b, cols: ['product', 'devops'] }];
  }
  return COLUMNS.map((c, i) => ({ p: ONCALL[(d + i) % 6], cols: [c.key] }));
}

function _dyGrid(synced) {
  const cells = _octCells();
  let html = '<div class="' + P + '-dy-grid"><div class="' + P + '-dy-week-header">' + DAY_HEADERS.map((h) => '<div class="' + P + '-dy-day-header">' + h + '</div>').join('') + '</div>';
  for (let w = 0; w < cells.length; w += 7) {
    html += '<div class="' + P + '-dy-week" data-dyzury-i-urlopy-week="' + (w / 7) + '">';
    for (const c of cells.slice(w, w + 7)) {
      if (!c) { html += '<div class="' + P + '-dy-day ' + P + '-dy-day--empty"></div>'; continue; }
      const rows = synced ? _dutyOf(c.d, c.we) : [];
      const av = rows.map((r) => '<span class="' + P + '-avatar demo-fruit ' + P + '-ring--' + r.cols[0] + '" title="' + esc(r.p.name) + '">' + fruitFaceFor(r.p.name) + '</span>').join('');
      html += '<div class="' + P + '-dy-day' + (c.we ? ' ' + P + '-dy-day--weekend' : '') + (c.d === 4 ? ' ' + P + '-dy-day--today' : '') + '" data-dyzury-i-urlopy-day="' + c.d + '">'
        + '<span class="' + P + '-dy-day-num">' + c.d + '</span>' + (av ? '<span class="' + P + '-dy-day-avatars">' + av + '</span>' : '') + '</div>';
    }
    html += '</div>';
  }
  return html + '</div>';
}

function _card(title, body, extra = '') {
  return '<div class="ds-card' + extra + '"><div class="ds-card-header"><span class="ds-card-title">' + esc(title) + '</span></div><div class="ds-card-body">' + body + '</div></div>';
}

function _table(head, rows) {
  return '<div class="ds-table-wrap"><table class="ds-table"><thead><tr>' + head.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

function _person(n) {
  return '<span class="' + P + '-person-cell"><span class="' + P + '-avatar demo-fruit">' + fruitFaceFor(n) + '</span><span>' + esc(n) + '</span></span>';
}

function dyBody({ synced = false } = {}) {
  const label = synced ? 'Last sync: 04.10.2026 09:31, page version 52' : 'Last sync: 01.09.2026 08:10, page version 47';
  const legend = '<div class="' + P + '-legend">' + COLUMNS.map((c) => '<span class="ds-badge ' + c.badge + '">' + esc(c.label) + '</span>').join('') + '</div>';
  const prefix = synced ? '' : '<div class="ds-callout ds-callout--info">No rota for this month - click Sync with Confluence.</div>';
  const godziny = _table(['System', 'Days', 'Hours', 'Scope'], GODZINY.map((g) => '<tr>' + g.map((x) => '<td>' + esc(x) + '</td>').join('') + '</tr>').join(''));
  const koord = _table(['Person', 'Phone', 'Email'], KOORD.map((k) => '<tr><td><span class="' + P + '-person-cell"><span class="' + P + '-avatar demo-fruit">' + fruitFaceFor(k.name) + '</span>'
    + '<span class="' + P + '-koord-info"><span class="' + P + '-koord-name">' + esc(k.name) + '</span><span class="' + P + '-koord-note">' + esc(k.note) + '</span></span></span></td>'
    + '<td><span class="ds-btn ds-btn--tertiary ds-btn--sm">' + esc(k.phone) + '</span></td><td><span class="ds-btn ds-btn--tertiary ds-btn--sm">' + esc(_mail(k.name)) + '</span></td></tr>').join(''));
  const dyzurni = _table(['Person', 'Scopes', 'Role', 'Company', 'Phone', 'Email'], ONCALL.map((o, i) => '<tr><td>' + _person(o.name) + '</td>'
    + '<td><span class="' + P + '-badges"><span class="ds-badge ' + COLUMNS[i % 4].badge + '">' + COLUMNS[i % 4].short + '</span>' + (i % 2 ? '<span class="ds-badge ' + COLUMNS[(i + 1) % 4].badge + '">' + COLUMNS[(i + 1) % 4].short + '</span>' : '') + '</span></td>'
    + '<td>' + esc(o.role) + '</td><td>' + esc(o.company) + '</td><td><span class="ds-btn ds-btn--tertiary ds-btn--sm">' + esc(o.phone) + '</span></td><td><span class="ds-btn ds-btn--tertiary ds-btn--sm">' + esc(_mail(o.name)) + '</span></td></tr>').join(''));
  return '<div id="' + P + '-dy-sticky"></div>'
    + '<div class="' + P + '-dy-card"><div class="' + P + '-dy-toolbar"><div class="ds-actions"><div class="ds-segmented" role="group" aria-label="Change month">'
    + '<button type="button" class="ds-segment ds-segment--icon" aria-label="Previous month"><img class="nav-icon" src="/assets/icons/ds/16-ic-chevron-left.svg" alt=""></button>'
    + '<button type="button" class="ds-segment active">Today</button>'
    + '<button type="button" class="ds-segment ds-segment--icon" aria-label="Next month"><img class="nav-icon" src="/assets/icons/ds/16-ic-chevron-right.svg" alt=""></button></div>'
    + '<span class="' + P + '-month-label">October 2026</span></div><span class="' + P + '-sync-label" id="' + P + '-sync-label">' + esc(label) + '</span></div>'
    + legend + prefix + _dyGrid(synced) + '</div>'
    + '<div class="' + P + '-panels">' + _card('On-call hours', godziny) + _card('Coordination', koord) + '</div>'
    + _card('The team on call', dyzurni, ' ' + P + '-block" id="' + P + '-dyzurni');
}

/** Header actions, modules/on-call/client/index.js _paintActions: sync + the page link (inert in the demo). */
function _dyActions({ busy = false } = {}) {
  return '<button type="button" class="ds-btn ds-btn--primary" id="' + P + '-dy-sync"' + (busy ? ' aria-busy="true" disabled' : '') + '>Sync with Confluence</button>'
    + '<a class="ds-btn ds-btn--tertiary" role="link" aria-disabled="true">Open the page in Confluence'
    + '<img class="nav-icon" src="/assets/icons/ds/16-ic-external-link.svg" alt=""></a>';
}

function dayModal() {
  const rows = _dutyOf(4, true);
  const body = rows.map((r) => '<div class="' + P + '-modal-person"><span class="' + P + '-modal-avatar demo-fruit">' + fruitFaceFor(r.p.name) + '</span>'
    + '<div><div class="' + P + '-modal-person-name">' + esc(r.p.name) + '</div><div class="' + P + '-badges">'
    + r.cols.map((k) => { const c = COLUMNS.find((x) => x.key === k); return '<span class="ds-badge ' + c.badge + '">' + esc(c.label) + '</span>'; }).join('') + '</div></div></div>'
    + '<div class="' + P + '-modal-contact"><span class="ds-btn ds-btn--tertiary ds-btn--sm">' + esc(r.p.phone) + '</span><span class="ds-btn ds-btn--tertiary ds-btn--sm">' + esc(_mail(r.p.name)) + '</span>'
    + '<div class="' + P + '-modal-meta">' + esc(r.p.company + ' - ' + r.p.role) + '</div></div>').join('<hr class="' + P + '-modal-divider">');
  return modalShell({
    id: P + '-day-modal',
    title: '04.10.2026',
    size: 'md',
    body,
    footer: '<button type="button" class="ds-btn ds-btn--secondary" id="' + P + '-day-close">Close</button>',
  });
}

// ── Time off ─────────────────────────────────────────────────────────────────

const LEAVES = [
  { name: 'Hayden Cole', team: 'Atlas', role: 'Developer', from: 1, to: 2, c: 3, old: true },
  { name: 'Jordan Lee', team: 'Atlas', role: 'UX designer', from: 5, to: 9, c: 1, old: true },
  { name: 'Sam Rivera', team: 'Atlas', role: 'Business analyst', from: 12, to: 16, c: 2, old: true },
  { name: 'Casey Novak', team: 'Borealis', role: 'Developer', from: 19, to: 30, c: 5, old: false },
  { name: 'Rowan Ellis', team: 'Borealis', role: 'Tester', from: 26, to: 28, c: 6, old: false },
];

function _workdays(a, b) {
  let n = 0;
  for (let d = a; d <= b; d += 1) if (((d + 2) % 7) < 5) n += 1;
  return n;
}

const _pl = (n) => (n === 1 ? '1 person' : n + ' people');

function _urCalendar(list) {
  const cells = _octCells();
  let html = '<div class="' + P + '-ur-week-header">' + DAY_HEADERS.map((h) => '<div class="' + P + '-ur-day-header">' + h + '</div>').join('') + '</div><div class="' + P + '-ur-weeks">';
  for (let w = 0; w < cells.length; w += 7) {
    html += '<div class="' + P + '-ur-week">';
    for (const c of cells.slice(w, w + 7)) {
      if (!c) { html += '<div class="' + P + '-ur-day ' + P + '-ur-day--empty"></div>'; continue; }
      const on = c.we ? [] : list.filter((e) => e.from <= c.d && c.d <= e.to);
      html += '<div class="' + P + '-ur-day' + (c.we ? ' ' + P + '-ur-day--off' : '') + (c.d === 4 ? ' ' + P + '-ur-day--today' : '') + '" data-dyzury-i-urlopy-uday="' + c.d + '">'
        + '<div class="' + P + '-ur-day-num">' + c.d + '</div>'
        + (on.length ? '<div class="' + P + '-ur-day-avatars">' + on.map((e) => '<span class="' + P + '-ur-avatar demo-fruit ' + P + '-c--' + e.c + '" data-dyzury-i-urlopy-leave="' + esc(_slug(e.name) + c.d) + '" title="' + esc(e.name) + '">' + fruitFaceFor(e.name) + '</span>').join('') + '</div>' : '')
        + '</div>';
    }
    html += '</div>';
  }
  return html + '</div>';
}

function urBody({ fetched = false, search = '', team = '', progress = false } = {}) {
  let list = LEAVES.filter((e) => fetched || e.old);
  if (team) list = list.filter((e) => e.team === team);
  if (search) list = list.filter((e) => e.name.toLowerCase().includes(search.toLowerCase()));
  const teams = ['Atlas', 'Borealis', 'Delta', 'Comet'];
  return '<div class="ds-card ' + P + '-ur-card"><div class="' + P + '-ur-filters">'
    + '<div class="' + P + '-ur-filter-search"><input type="search" class="ds-input" id="' + P + '-ur-search" value="' + esc(search) + '" placeholder="Search for a person - first or last name..." aria-label="Search for a person in the time-off calendar"></div>'
    + '<div class="' + P + '-ur-filter-team"><select class="ds-input" id="' + P + '-ur-team" aria-label="Filter by team"><option value="">All</option>'
    + teams.map((t) => '<option' + (t === team ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></div></div>'
    + '<div class="' + P + '-ur-toolbar"><div class="ds-actions"><button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm">Previous</button>'
    + '<span class="' + P + '-ur-month-label">October 2026</span><button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm">Next</button></div>'
    + '<span class="' + P + '-ur-updated">' + (fetched ? 'Data from: 04.10.2026' : 'Data from: 01.09.2026') + '</span></div>'
    + '<div class="ds-callout ds-callout--info ' + P + '-ur-progress" id="' + P + '-ur-progress"' + (progress ? '' : ' hidden') + '><div id="' + P + '-ur-progress-log"></div></div>'
    + '<div id="' + P + '-ur-calendar"><div class="' + P + '-ur-count">October 2026: ' + _pl(new Set(list.map((e) => e.name)).size) + ' on leave</div>'
    + _urCalendar(list) + '</div></div>';
}

function popover() {
  const e = LEAVES[1];
  const days = _workdays(e.from, e.to);
  return '<div class="' + P + '-popover" id="' + P + '-popover"><div class="' + P + '-popover-head"><span class="' + P + '-popover-avatar demo-fruit ' + P + '-c--' + e.c + '">' + fruitFaceFor(e.name) + '</span>'
    + '<div><div class="' + P + '-popover-name">' + esc(e.name) + '</div><div class="' + P + '-popover-role">' + esc(e.role) + '</div><div class="' + P + '-popover-team">' + esc(e.team) + '</div></div></div>'
    + '<div class="' + P + '-popover-dates"><span class="' + P + '-popover-dates-label">On leave</span><span class="' + P + '-popover-dates-value">05.10.2026 - 09.10.2026</span>'
    + '<span class="' + P + '-popover-dates-days">' + days + ' workdays</span></div></div>';
}

function ssoScreen() {
  return '<div class="' + P + '-sso"><div class="' + P + '-sso-window"><div class="' + P + '-sso-bar"><span class="' + P + '-sso-dots" aria-hidden="true"><i></i><i></i><i></i></span>'
    + '<span>A browser window opened by Mission Deck - one-time sign-in</span></div><div class="' + P + '-sso-body">'
    + '<div class="ds-card ' + P + '-sso-card"><div class="ds-card-header"><span class="ds-card-title">Company sign-in (SSO)</span></div><div class="ds-card-body">'
    + '<p class="' + P + '-sso-lead">Sign in with your work account to open the time-off sheet.</p>'
    + '<div class="ds-input-wrap"><label class="ds-label" for="' + P + '-sso-email">Email address</label><input type="text" class="ds-input" id="' + P + '-sso-email" placeholder="first.last@example.com" autocomplete="off"></div>'
    + '<div class="ds-input-wrap"><label class="ds-label" for="' + P + '-sso-password">Password</label><input type="password" class="ds-input" id="' + P + '-sso-password" autocomplete="off"></div>'
    + '<div class="' + P + '-sso-actions"><button type="button" class="ds-btn ds-btn--primary" id="' + P + '-sso-submit">Sign in</button>'
    + '<span class="ds-badge ds-badge--blue" id="' + P + '-sso-mfa" hidden>Confirm the sign-in on your phone</span>'
    + '<span class="ds-badge ds-badge--green" id="' + P + '-sso-ok" hidden>Signed in</span></div>'
    + '<p class="' + P + '-sso-note" id="' + P + '-sso-note" hidden>Session saved on this computer — later fetches need no window.</p>'
    + '</div></div></div></div></div>';
}

export const MOCKS = {
  'dyzury-i-urlopy-dy-page': () => modulePage({
    view: DY,
    title: 'On-call',
    subtitle: 'Who is on call today - the rota from Confluence',
    actions: _dyActions({}),
    bar: syncBar({ view: DY, variant: 'success', text: 'Data up to date - local 01.09 08:10, server 01.09 08:10.' }),
    body: dyBody({}),
  }),
  'dyzury-i-urlopy-dy-body': (p) => dyBody(p),
  'dyzury-i-urlopy-dy-actions': (p = {}) => _dyActions(p),
  'dyzury-i-urlopy-dy-log': () => '<div class="ds-callout ds-callout--info ' + P + '-log-callout"><div id="' + P + '-dy-log"></div></div>',
  'dyzury-i-urlopy-day-modal': () => dayModal(),
  'dyzury-i-urlopy-ur-page': () => modulePage({
    view: UR,
    title: 'Time off',
    subtitle: 'The team’s time-off calendar - who, when and for how long',
    actions: '<button type="button" class="ds-btn ds-btn--primary" id="' + P + '-ur-fetch">Fetch</button>',
    bar: syncBar({ view: UR, variant: 'success', text: 'Data up to date - local 01.09 08:20, server 01.09 08:20.' }),
    body: '<div id="' + P + '-ur-root">' + urBody({}) + '</div>',
  }),
  'dyzury-i-urlopy-ur-body': (p) => urBody(p),
  'dyzury-i-urlopy-ur-done': () => '<div class="ds-callout ds-callout--success ' + P + '-ur-progress"><div>The data is saved on this computer. The changes reach the team on the next sync (top bar).</div></div>',
  'dyzury-i-urlopy-popover': () => popover(),
  'dyzury-i-urlopy-sso-screen': () => ssoScreen(),
  'dyzury-i-urlopy-sync-local': ({ view = UR } = {}) => syncBar({
    view,
    variant: 'info',
    text: view === DY
      ? 'You have local changes (6 files, the latest from 04.10 09:31) - the server has the state of 01.09 08:10.'
      : 'You have local changes (16 files, the latest from 04.10 09:44) - the server has the state of 01.09 08:20.',
  }),
};

export const LABELS = [
  'On-call', 'Who is on call today - the rota from Confluence', 'Sync with Confluence', 'Open the page in Confluence', 'Today', 'On-call hours',
  'Coordination', 'The team on call', 'Scopes', 'Phone', 'No rota for this month - click Sync with Confluence.',
  'Time off', 'The team’s time-off calendar - who, when and for how long', 'Fetch', 'All', 'Previous', 'Next',
  'Search for a person - first or last name...', 'On leave', 'workdays', 'Company sign-in (SSO)', 'Email address', 'Password', 'Sign in',
  'Signed in', 'Confirm the sign-in on your phone', 'Close', ...COLUMNS.map((c) => c.label),
];
