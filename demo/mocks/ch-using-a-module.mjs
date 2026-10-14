// demo/mocks/ch-using-a-module.mjs
// Painters for chapter `using-a-module` (and the last step of `catalog`): the
// "Time logging" module page - the js/module-host.js section (header,
// actions slot, module sync bar from js/module-sync-bar.js _paint) and the
// body modules/time-log/client/index.js paints (alert badge, toolbar,
// legend, person x day heatmap) - plus the "Data sync" window
// (js/sync-center-modal.js) with the module's row and its in-row progress.
// People and teams are fictitious. Ids start with `dm-uzycie-modulu-`.

import { esc, modalShell } from './common.mjs';
import { fruitFaceFor } from '../../assets/avatars/fruit-avatars.mjs';
import { TEAMS, DATES, PEOPLE, LAST_WORKDAY, hoursOf, fmtDate } from './time-log-data.mjs';

const P = 'dm-uzycie-modulu-';

// People, teams and the 14-day window (yesterday back, newest first) are the
// ONE dataset of demo/mocks/time-log-data.mjs, shared with chapters
// katalog and czas-pracy. Before the pull the three newest workdays are the
// stale copy on this computer; after it, what the server had.

/** Hours shown in the heatmap: null on a weekend, 0 for "no log". */
function hours(p, d, fresh) {
  if (DATES[d].we) return null;
  const h = hoursOf(p, d, fresh);
  return h === null || h === undefined ? 0 : h;
}

function cellHtml(h) {
  if (h === null) return '<div class="tlc-cell tlc-cell--weekend"></div>';
  if (h === 0) return '<div class="tlc-cell tlc-cell--miss"></div>';
  const frac = Math.min(1, h / 8);
  return `<div class="tlc-cell tlc-cell--logged${frac >= 0.5 ? ' tlc-cell--hi' : ''}" style="--tlc-frac:${frac.toFixed(3)}"><span class="tlc-cell-h">${h % 1 === 0 ? h : h.toFixed(1)}</span></div>`;
}

const sumClass = (pct) => (pct === 100 ? 'tlc-sum--full' : pct >= 80 ? 'tlc-sum--ok' : 'tlc-sum--warn');

const TEAMS_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.625 7.5a2.625 2.625 0 1 0 0-5.25 2.625 2.625 0 0 0 0 5.25zm0 1.5c-.92 0-1.76-.3-2.43-.8L15 11.4V21a1.5 1.5 0 0 0 3 0v-5.25h1.5V21a1.5 1.5 0 0 0 3 0V9.3a4.12 4.12 0 0 1-1.875.7zM14.25 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm-1.5 0a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0zM9 10.5a3 3 0 0 0-3 3V18h1.5v4.5h6V18H15v-4.5a3 3 0 0 0-3-3H9z"/></svg>';

/**
 * The module's body (#<view>-root).
 * @param {{ fresh?: boolean, team?: string }} props
 */
function body({ fresh = false, team = '' } = {}) {
  const people = PEOPLE;
  const shown = team ? people.filter((p) => p.team === team) : people;
  const rows = shown.map((p) => {
    const hs = DATES.map((_, d) => hours(p, d, fresh));
    const work = hs.filter((h) => h !== null);
    const logged = work.filter((h) => h > 0).length;
    const pct = Math.round((logged / work.length) * 100);
    const missing = logged < work.length;
    return `<div class="tlc-name-cell"><span class="tlc-avatar demo-fruit">${fruitFaceFor(p.name)}</span><span class="tlc-name-text">${esc(p.name)}</span>`
      + `<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm tlc-teams-btn" aria-label="Send a Teams message" title="${missing ? 'Send a Teams message' : 'No gaps in time logging'}"${missing ? '' : ' disabled'}>${TEAMS_SVG}</button></div>`
      + hs.map(cellHtml).join('')
      + `<div class="tlc-cell tlc-cell--row-sum ${sumClass(pct)}">${logged}/${work.length}</div>`;
  }).join('');
  const sums = DATES.map((dt, d) => {
    if (dt.we) return '<div class="tlc-cell tlc-cell--summary"></div>';
    const logged = shown.filter((p) => hours(p, d, fresh) > 0).length;
    const pct = Math.round((logged / shown.length) * 100);
    return `<div class="tlc-cell tlc-cell--summary ${sumClass(pct)}">${logged}/${shown.length}</div>`;
  }).join('');
  const lastLogged = people.filter((p) => hours(p, LAST_WORKDAY, fresh) > 0).length;
  const alertPct = Math.round((lastLogged / people.length) * 100);
  const tone = alertPct >= 90 ? 'green' : (alertPct >= 60 ? 'yellow' : 'red');
  const segs = [['', 'All teams'], ...TEAMS.map((t) => [t, t])].map(([v, l], i) => `<button type="button" class="ds-segment${team === v ? ' active' : ''}" id="${P}team-${i}">${esc(l)}</button>`).join('');
  return `<div class="tlc-header-row"><span class="ds-badge ds-badge--${tone}" id="${P}alert">${alertPct}% logged time on ${fmtDate(DATES[LAST_WORKDAY].iso)}</span></div>
    <div class="tlc-toolbar">
      <div class="ds-input-wrap tlc-search-wrap"><input type="text" class="ds-input" placeholder="Search for a person..." aria-label="Search for a person" autocomplete="off"></div>
      <div class="ds-segmented tlc-team-seg">${segs}</div>
      <div class="tlc-toolbar-actions"${team ? '' : ' hidden'}>
        <span class="tlc-count">${shown.length} of ${people.length}</span>
        <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="${P}clear">Clear</button>
      </div>
    </div>
    <ul class="tlc-legend">
      ${[['logged', 'logged'], ['miss', 'no log'], ['vacation', 'time off'], ['weekend', 'weekend'], ['holiday', 'holiday']].map(([c, l]) => `<li><span class="tlc-legend-dot tlc-legend-dot--${c}" aria-hidden="true"></span><span>${l}</span></li>`).join('')}
      <li class="tlc-legend-note">no time off - the “Time off” module is not enabled, so a day off looks like a missing log here</li>
    </ul>
    <div class="tlc-grid-wrap${fresh ? ' dm-uzycie-modulu-fresh' : ''}" id="${P}grid"><div class="tlc-grid" style="grid-template-columns: minmax(150px, auto) repeat(14, minmax(28px, 1fr)) minmax(48px, auto);">
      <div class="tlc-name-cell tlc-cell--header"></div>${DATES.map((d, i) => `<div class="tlc-cell tlc-cell--header"${i === LAST_WORKDAY ? ` id="${P}col-last"` : ''}>${fmtDate(d.iso)}</div>`).join('')}<div class="tlc-cell tlc-cell--header"></div>
      ${rows}
      <div class="tlc-name-cell tlc-cell--summary">Total:</div>${sums}<div class="tlc-cell tlc-cell--summary"></div>
    </div></div>`;
}

/** js/module-sync-bar.js _paint. */
function msb({ state = 'behind' } = {}) {
  const variant = state === 'current' ? 'success' : 'info';
  const text = state === 'current'
    ? 'Data up to date - local 04.10 09:12, server 04.10 08:40.'
    : 'The server has newer data (3 files, server state of 04.10 08:40) - locally you have the state of 02.10 17:05.';
  return `<div class="ds-callout ds-callout--${variant} msb-bar" id="${P}msb" role="status" aria-live="polite"><span class="msb-text">${esc(text)}</span>`
    + `<div class="msb-actions"><button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" id="${P}msb-open">Open sync</button></div><div class="msb-details" hidden></div></div>`;
}

/** The whole module section, js/module-host.js shape. */
function page({ state = 'behind', fresh = false } = {}) {
  return `<div class="page-header"><div class="page-header-row"><div>
      <h1>Time logging</h1><div class="subtitle">Who logged time in Tempo over the last 14 days</div>
    </div>
    <div class="page-header-actions" id="${P}actions"><button type="button" class="ds-btn ds-btn--primary" id="${P}fetch">Fetch from Jira</button></div>
    </div></div>
    ${msb({ state })}
    <div class="view-data" id="${P}root">${body({ fresh })}</div>`;
}

// ── "Data sync" ─────────────────────────────────────────────

const ICO = (ico, label, tip, disabled = false, id = '') => `<button type="button" class="ds-icon-btn ds-icon-btn--sm"${id ? ` id="${id}"` : ''}${disabled ? ' disabled' : ''} data-tip="${esc(tip)}" aria-label="${esc(label)}"><span class="scm-action-ico scm-action-ico--${ico}" aria-hidden="true"></span></button>`;

function actions(label, { pushTip = 'Push', pushDisabled = false, pullId = '' } = {}) {
  return `<div class="scm-actions">${ICO('download', 'Pull ' + label, 'Pull (syncs the whole source)', false, pullId)}${ICO('upload', 'Push ' + label, pushTip, pushDisabled)}${ICO('changes', 'Files ' + label, 'No files to show', true)}${ICO('copy', 'Copy log ' + label, 'Copy log')}</div>`;
}

function syncCell(local, remote) {
  return `<td class="scm-sync-cell"><div class="scm-sync-line"><span class="scm-sync-ico scm-sync-ico--local" role="img" aria-label="Local"></span>${local}</div>`
    + `<div class="scm-sync-line"><span class="scm-sync-ico scm-sync-ico--remote" role="img" aria-label="Server"></span>${remote}</div></td>`;
}

function badge(label, tone) { return `<span class="ds-badge ds-badge--sm ds-badge--${tone}">${esc(label)}</span>`; }

/**
 * @param {{ progress?: { step: string, pct: number } | null, done?: boolean }} props
 */
function syncTable({ progress = null, done = false } = {}) {
  const repoBadge = done ? badge('up to date', 'green') : badge('to pull', 'yellow');
  const moduleCells = progress
    ? `<td colspan="3"><div class="ds-progress scm-prog"><div class="ds-progress-labels"><span class="scm-prog-step">${esc(progress.step)}</span><span></span></div>`
      + `<div class="ds-progress-track"><div class="ds-progress-fill ds-progress-fill--brand" style="width:${progress.pct}%"></div></div></div></td>`
    : `<td>${done ? badge('Up to date', 'green') : badge('To pull', 'yellow')}</td><td>${done ? '0 / 0' : '0 / 3'}</td>${syncCell(done ? '04.10 09:12' : '02.10 17:05', '04.10 08:40')}`;
  // The same sources, in the same order, as the window in chapter `sync`.
  const other = [
    ['Team reports', '04.10 07:58', '04.10 07:58'],
    ['Leads’ data', '02.10 11:20', '02.10 11:20'],
    ['Team knowledge base', '01.10 10:02', '01.10 10:02'],
    ['Rollouts', '30.09 14:47', '30.09 14:47'],
  ];
  return `<div class="scm-table-wrap"><table class="ds-table scm-table">
      <thead><tr><th>Repository</th><th>State</th><th>To push/pull</th><th>Sync</th><th>Actions</th></tr></thead>
      <tbody class="scm-repo-body"><tr class="scm-row">
        <td><button type="button" class="ds-icon-btn ds-icon-btn--sm scm-toggle scm-toggle--open" aria-expanded="true" aria-label="Collapse modules"><span class="scm-action-ico scm-action-ico--chevron" aria-hidden="true"></span></button><span class="scm-repo-label scm-repo-label--toggle" role="button" tabindex="0">Team data</span></td>
        <td>${repoBadge}</td><td>${done ? '0 / 0' : '0 / 3'}</td>${syncCell(done ? '04.10 09:12' : '02.10 17:05', '04.10 08:40')}<td>${actions('Team data')}</td>
      </tr></tbody>
      <tbody class="scm-modules-group">
        <tr class="scm-row--module" id="${P}scm-module-row"><td>Time logging</td>${moduleCells}<td>${actions('Time logging', { pushTip: 'No changes to push', pushDisabled: true, pullId: P + 'scm-pull' })}</td></tr>
        <tr class="scm-row--module scm-row--core"><td>Cockpit Core</td><td>${badge('Up to date', 'green')}</td><td>0 / 0</td>${syncCell('02.10 17:05', '02.10 17:05')}<td>${actions('Cockpit Core', { pushTip: 'No changes to push', pushDisabled: true })}</td></tr>
      </tbody>
      ${other.map(([l, a, b]) => `<tbody class="scm-repo-body"><tr class="scm-row"><td><span class="scm-toggle-slot" aria-hidden="true"></span><span class="scm-repo-label">${esc(l)}</span></td><td>${badge('up to date', 'green')}</td><td>0 / 0</td>${syncCell(a, b)}<td>${actions(l)}</td></tr></tbody>`).join('')}
    </table></div>`;
}

export const MOCKS = {
  'uzycie-modulu-page': (props) => page(props),
  'uzycie-modulu-body': (props) => body(props),
  'uzycie-modulu-msb': (props) => msb(props),
  'uzycie-modulu-sync-table': (props) => syncTable(props),
  /** The window itself (footer order as js/sync-center-modal.js draws it). */
  'uzycie-modulu-sync-modal': () => modalShell({
    id: P + 'scm',
    title: 'Data sync',
    size: 'xl',
    body: `<div id="${P}scm-body">${syncTable()}</div>`,
    footer: `<button type="button" class="ds-btn ds-btn--tertiary">Check the server</button><button type="button" class="ds-btn ds-btn--tertiary">Copy sync log</button><button type="button" class="ds-btn ds-btn--secondary" id="${P}scm-ok">Close</button>`,
  }),
};

/** Every visible label these painters paint (copy gate). */
export const LABELS = [
  'Time logging', 'Who logged time in Tempo over the last 14 days', 'Fetch from Jira', 'Open sync',
  'All teams', ...TEAMS, 'Clear', 'logged', 'no log', 'time off', 'weekend', 'holiday', 'Total:',
  'Data sync', 'Repository', 'State', 'To push/pull', 'Sync', 'Actions', 'Team data', 'Cockpit Core',
  'To pull', 'Up to date', 'to pull', 'up to date', 'Check the server', 'Copy sync log', 'Close',
  'Data up to date - local 04.10 09:12, server 04.10 08:40.', ...PEOPLE.map((p) => p.name),
];
