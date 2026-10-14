// demo/mocks/ch-time-tracking.mjs
// Painters for chapter `time-tracking`: the "Time logging" module page
// (modules/time-log/client/index.js) - header action "Fetch from Jira",
// toolbar with the team segments, the legend and the 14-day heatmap grid -
// plus its progress modal "Fetching time logs from Jira". Pure
// (props) => htmlString, DS classes only; module classes renamed czas-pracy-*.
// Every person here is invented.
//
// Also exports `modulePage` and `syncBar`, the js/module-host.js section shape
// the other module chapters of this demo (meetings, roadmap,
// team, sprints) reuse.

import { esc, modalShell } from './common.mjs';
import { fruitFaceFor } from '../../assets/avatars/fruit-avatars.mjs';
import { TEAMS, DATES, PEOPLE, LAST_WORKDAY, hoursOf, fmtDate, initialsOf } from './time-log-data.mjs';

/**
 * The section body js/module-host.js builds for a module view: page header
 * with h1 + subtitle and the `<view>-actions` slot, the module sync bar,
 * then the `<view>-root` content slot.
 * @param {{ view: string, title: string, subtitle?: string, actions?: string, bar?: string, body?: string }} p
 */
export function modulePage({ view, title, subtitle = '', actions = '', bar = '', body = '' }) {
  return '<div class="page-header"><div class="page-header-row"><div>'
    + '<h1>' + esc(title) + '</h1>'
    + (subtitle ? '<div class="subtitle">' + esc(subtitle) + '</div>' : '')
    + '</div>'
    + '<div class="page-header-actions" id="' + esc(view) + '-actions">' + actions + '</div>'
    + '</div></div>'
    + bar
    + '<div class="view-data" id="' + esc(view) + '-root">' + body + '</div>';
}

/** The module sync strip (js/module-sync-bar.js _paint), one variant + sentence. */
export function syncBar({ view, variant = 'success', text }) {
  return '<div class="ds-callout ds-callout--' + esc(variant) + ' msb-bar" id="msb-' + esc(view) + '" role="status">'
    + '<span class="msb-text">' + esc(text) + '</span>'
    + '<div class="msb-actions"><button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-msb-act="open-sync">Open sync</button></div>'
    + '</div>';
}

const VIEW = 'czas-pracy-logowanie';

const TEAMS_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

// People, teams and the 14-day window are the ONE dataset of
// demo/mocks/time-log-data.mjs, shared with chapters katalog and uzycie-modulu.

const ISSUES = [
  ['DEMO-412', 'Review of the schedule screen mockups'],
  ['DEMO-397', 'Refinement: pay calculator'],
  ['DEMO-405', 'Acceptance tests for orders'],
];

const fmtH = (h) => String(h % 1 === 0 ? h : h.toFixed(1));
const _hours = hoursOf;
const _initials = initialsOf;

function _visible(team) {
  return team ? PEOPLE.filter((p) => p.team === team) : PEOPLE;
}

function _sumClass(pct) {
  if (pct === 100) return 'czas-pracy-sum--full';
  return pct >= 80 ? 'czas-pracy-sum--ok' : 'czas-pracy-sum--warn';
}

function _rowHtml(p, fresh, spot) {
  let logged = 0;
  let workdays = 0;
  const cells = DATES.map((d, i) => {
    if (d.we) return '<div class="czas-pracy-cell czas-pracy-cell--weekend" aria-label="weekend"></div>';
    workdays += 1;
    const h = _hours(p, i, fresh);
    if (h === null || h === undefined) {
      return '<div class="czas-pracy-cell czas-pracy-cell--miss' + (spot && spot === p.slug ? ' czas-pracy-cell--spot' : '') + '" data-czas-pracy-miss="' + esc(p.slug + '-' + i) + '"'
        + ' title="' + esc(p.name + ' ' + fmtDate(d.iso) + ': no log') + '"></div>';
    }
    logged += 1;
    const frac = Math.min(h / 8, 1);
    const issue = ISSUES[(i + p.slug.length) % ISSUES.length];
    const title = fmtH(h) + ' h logged · ' + issue[0] + ' ' + issue[1] + ' · logged ' + fmtDate(d.iso) + ' 16:' + String(10 + i * 3).padStart(2, '0');
    return '<div class="czas-pracy-cell czas-pracy-cell--logged' + (frac >= 0.5 ? ' czas-pracy-cell--hi' : '') + '"'
      + ' style="--czas-pracy-frac:' + frac.toFixed(3) + '" data-czas-pracy-cell="' + esc(p.slug + '-' + i) + '"'
      + ' aria-label="' + esc(title) + '"><span class="czas-pracy-cell-h">' + esc(fmtH(h)) + '</span></div>';
  }).join('');
  const pct = workdays ? Math.round((logged / workdays) * 100) : 0;
  return '<div class="czas-pracy-name-cell' + (spot === p.slug ? ' czas-pracy-name-cell--spot' : '') + '" data-czas-pracy-person="' + esc(p.slug) + '"><span class="czas-pracy-avatar demo-fruit">' + fruitFaceFor(p.name) + '</span>'
    + '<span class="czas-pracy-name-text">' + esc(p.name) + '</span>'
    + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm czas-pracy-teams-btn" data-czas-pracy-teams="' + esc(p.slug) + '" aria-label="Send a Teams message" title="Send a Teams message">' + TEAMS_SVG + '</button></div>'
    + cells
    + '<div class="czas-pracy-cell czas-pracy-cell--row-sum ' + _sumClass(pct) + '">' + logged + '/' + workdays + '</div>';
}

function _gridHtml(people, fresh, spot) {
  const head = DATES.map((d) => '<div class="czas-pracy-cell czas-pracy-cell--header">' + esc(fmtDate(d.iso)) + '</div>').join('');
  const sums = DATES.map((d, i) => {
    if (d.we) return '<div class="czas-pracy-cell czas-pracy-cell--summary"></div>';
    const logged = people.filter((p) => _hours(p, i, fresh) !== null && _hours(p, i, fresh) !== undefined).length;
    const pct = Math.round((logged / people.length) * 100);
    return '<div class="czas-pracy-cell czas-pracy-cell--summary ' + _sumClass(pct) + '">' + logged + '/' + people.length + '</div>';
  }).join('');
  return '<div class="czas-pracy-grid-wrap"><div class="czas-pracy-grid" style="grid-template-columns: minmax(190px, auto) repeat(' + DATES.length + ', minmax(30px, 1fr)) minmax(48px, auto);">'
    + '<div class="czas-pracy-name-cell czas-pracy-cell--header"></div>' + head + '<div class="czas-pracy-cell czas-pracy-cell--header"></div>'
    + people.map((p) => _rowHtml(p, fresh, spot)).join('')
    + '<div class="czas-pracy-name-cell czas-pracy-cell--summary">Total:</div>' + sums + '<div class="czas-pracy-cell czas-pracy-cell--summary"></div>'
    + '</div></div>';
}

function _alert(fresh) {
  const logged = PEOPLE.filter((p) => _hours(p, LAST_WORKDAY, fresh) !== null && _hours(p, LAST_WORKDAY, fresh) !== undefined).length;
  const pct = Math.round((logged / PEOPLE.length) * 100);
  const tone = pct >= 90 ? 'green' : (pct >= 60 ? 'yellow' : 'red');
  return '<span class="ds-badge ds-badge--' + tone + '" id="czas-pracy-alert">' + pct + '% logged time on ' + fmtDate(DATES[LAST_WORKDAY].iso) + '</span>';
}

const LEGEND = [['logged', 'logged'], ['miss', 'no log'], ['vacation', 'time off'], ['weekend', 'weekend'], ['holiday', 'holiday']];

/** The whole `#czas-pracy-logowanie-root` body: alert, toolbar, legend, grid. */
function body({ fresh = false, team = '', spot = '' } = {}) {
  const people = _visible(team);
  const segs = ['', ...TEAMS].map((t) => '<button type="button" class="ds-segment' + (team === t ? ' active' : '') + '" data-czas-pracy-team="' + esc(t || 'all') + '">' + esc(t || 'All teams') + '</button>').join('');
  return '<div class="czas-pracy-header-row">' + _alert(fresh) + '</div>'
    + '<div class="czas-pracy-toolbar">'
    + '<div class="ds-input-wrap czas-pracy-search-wrap"><input type="text" class="ds-input" placeholder="Search for a person..." aria-label="Search for a person"></div>'
    + '<div class="ds-segmented czas-pracy-team-seg">' + segs + '</div>'
    + '<div class="czas-pracy-toolbar-actions"' + (team ? '' : ' hidden') + '>'
    + '<span class="czas-pracy-count">' + people.length + ' of ' + PEOPLE.length + '</span>'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="czas-pracy-clear">Clear</button></div>'
    + '</div>'
    + '<ul class="czas-pracy-legend">' + LEGEND.map(([c, l]) => '<li><span class="czas-pracy-legend-dot czas-pracy-legend-dot--' + c + '" aria-hidden="true"></span><span>' + esc(l) + '</span></li>').join('')
    + '<li class="czas-pracy-legend-note">no time off - the “Time off” module is not enabled, so a day off looks like a missing log here</li></ul>'
    + _gridHtml(people, fresh, spot);
}

const SYNC_OK = 'Data up to date - local 04.10 09:16, server 04.10 09:16.';
const SYNC_LOCAL = 'You have local changes (14 files, the latest from 04.10 09:42) - the server has the state of 04.10 09:16.';

export const MOCKS = {
  /** The module section, as js/module-host.js builds it, before the refresh. */
  'czas-pracy-page': () => modulePage({
    view: VIEW,
    title: 'Time logging',
    subtitle: 'Who logged time in Tempo over the last 14 days',
    actions: '<button type="button" class="ds-btn ds-btn--primary" id="czas-pracy-fetch">Fetch from Jira</button>',
    bar: syncBar({ view: VIEW, variant: 'success', text: SYNC_OK }),
    body: body({}),
  }),

  'czas-pracy-body': (p) => body(p),

  /** The sync strip after the fetch: new data sits on this computer only. */
  'czas-pracy-sync-local': () => syncBar({ view: VIEW, variant: 'info', text: SYNC_LOCAL }),

  /** The issues tooltip the module opens on a logged cell. */
  'czas-pracy-tooltip': () => '<div class="czas-pracy-tooltip" id="czas-pracy-tooltip">'
    + '<div class="czas-pracy-tt-hours">7 h logged</div>'
    + ISSUES.slice(0, 2).map(([k, s], i) => '<div class="czas-pracy-tt-row"><div class="czas-pracy-tt-main"><span class="czas-pracy-tt-key">' + esc(k) + '</span>'
      + '<span class="czas-pracy-tt-sum">' + esc(s) + '</span><span class="czas-pracy-tt-h">' + (i ? '3h' : '4h') + '</span></div>'
      + '<span class="czas-pracy-tt-logged">logged 02.10 ' + (i ? '17:20' : '12:05') + '</span></div>').join('')
    + '</div>',

  /** "Fetching time logs from Jira" - the module's progress modal. */
  'czas-pracy-modal': () => modalShell({
    id: 'czas-pracy-modal',
    title: 'Fetching time logs from Jira',
    size: 'lg',
    body: '<div class="ds-progress"><div class="ds-progress-track">'
      + '<div class="ds-progress-fill ds-progress-fill--green czas-pracy-fill" id="czas-pracy-fill"></div></div></div>'
      + '<div class="czas-pracy-log-list" id="czas-pracy-log"></div>'
      + '<div id="czas-pracy-result"></div>',
    footer: '<button type="button" class="ds-btn ds-btn--secondary" id="czas-pracy-close" disabled>Close</button>',
  }),

  /** "Message to ..." - the module's Teams draft modal (nothing is sent in the demo). */
  'czas-pracy-teams-modal': () => modalShell({
    id: 'czas-pracy-teams-modal',
    title: 'Message to Casey Novak',
    body: '<label class="ds-label" for="czas-pracy-teams-message">Draft message</label>'
      + '<textarea id="czas-pracy-teams-message" class="ds-textarea" rows="4">Hi Casey, time logging in Tempo is missing for these days: 02.10. Please fill it in.</textarea>',
    footer: '<button type="button" class="ds-btn ds-btn--primary">Open in Teams</button>'
      + '<button type="button" class="ds-btn ds-btn--secondary" id="czas-pracy-teams-copy">Copy draft</button>'
      + '<button type="button" class="ds-btn ds-btn--tertiary" id="czas-pracy-teams-cancel">Cancel</button>',
  }),

  'czas-pracy-close-on': () => '<button type="button" class="ds-btn ds-btn--secondary" id="czas-pracy-close">Close</button>',

  'czas-pracy-result': () => '<div class="ds-callout ds-callout--success"><div>Fetched 386 entries for 11 people; 0 authors outside the team directory. '
    + 'The data is saved on this computer - send it to the team from the Sync window in the top bar.</div></div>',
};

export const LABELS = [
  'Time logging', 'Who logged time in Tempo over the last 14 days', 'Fetch from Jira', 'All teams',
  'Clear', 'Search for a person...', 'logged', 'no log', 'time off', 'weekend', 'holiday', 'Total:',
  'Fetching time logs from Jira', 'Close', 'Message to Casey Novak', 'Draft message', 'Open in Teams', 'Copy draft', 'Cancel', 'Open sync', 'h logged', SYNC_OK, SYNC_LOCAL,
];
