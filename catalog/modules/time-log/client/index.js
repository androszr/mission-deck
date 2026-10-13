// modules/time-log/client/index.js
// Time Log - a 14-day person x day heatmap of Tempo worklogs. One view:
//
// export const views = { 'time-log-main': { init(deps), render(subPath, opts) } }
// - the shape js/module-host.js expects.
//
// deps (passed to init):
//   navigate(viewId)                 - go to another view
//   registerViewCleanup(cb)          - MANDATORY for timers, listeners, EventSource
//   showToast(variant, title, desc)  - variant: success | danger | info | warning | neutral
//   apiBase                          - '/api/m/time-log' (this module's routes)
//
// js/team-directory.js and js/ds-modal.js are CORE ESM modules - the import
// MUST be dynamic and only ever run inside init(), in try/catch: a static
// import would break a plain-Node import of this file (no document, no /js/...
// resolver). ./time-log-lib.js is a sibling, dependency-free ESM file, so it
// is imported statically.
//
// DS classes only (ds-btn, ds-card, ds-badge, ds-callout, ds-input,
// ds-segmented, the ds-modal-* family, ds-progress) and tokens from
// css/ds-tokens.css - never a hex.

import {
  TEAMS, JIRA_URL_DEFAULT, fmtDate, nameKey, vacationSet, isVacation, cellState,
  filterPersons, personTotals, columnTotals, alertStats, teamsDraftUrl, teamsMessage,
  fmtLoggedAt,
} from './time-log-lib.js';

// Re-exported so a future caller (or a test) can reach the pure helpers
// straight off this module without a second import path.
export {
  TEAMS, JIRA_URL_DEFAULT, fmtDate, nameKey, vacationSet, isVacation, cellState,
  filterPersons, personTotals, columnTotals, alertStats, teamsDraftUrl, teamsMessage,
  fmtLoggedAt,
};

const ROOT_ID = 'time-log-main-root';
const ACTIONS_ID = 'time-log-main-actions';
// The optional time-off layer: another installed module's route.
const TIME_OFF_DATA_URL = '/api/m/time-off/data';

// A generic "people" glyph for the Teams chat button.
const TEAMS_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">'
  + '<path d="M20.625 7.5a2.625 2.625 0 1 0 0-5.25 2.625 2.625 0 0 0 0 5.25zm0 1.5c-.92 0-1.76-.3-2.43-.8L15 11.4V21a1.5 1.5 0 0 0 3 0v-5.25h1.5V21a1.5 1.5 0 0 0 3 0V9.3a4.12 4.12 0 0 1-1.875.7zM14.25 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm-1.5 0a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0zM9 10.5a3 3 0 0 0-3 3V18h1.5v4.5h6V18H15v-4.5a3 3 0 0 0-3-3H9z"/></svg>';

// Module-scope state - one view instance for the whole app session.
let _deps = null;
let _teamDir = null; // '/js/team-directory.js' namespace once loaded, else null
let _dsModal = null; // '/js/ds-modal.js' namespace once loaded, else null
let _mounted = false;
let _data = null; // last GET /data answer
let _status = null; // last GET /status answer
let _vac = new Set(); // vacationSet() of the time-off entries
// Whether the OPTIONAL time-off layer answered: it comes from another
// installed module (time-off, GET /api/m/time-off/data), so a 404 means that
// module is off, not that nobody is on leave - the legend says which.
let _vacAvailable = true;
let _query = '';
let _team = ''; // '' = every team
// A warning that must stay on screen until the next successful fetch attempt
// clears it - "Fetch from Jira" answered storage-unavailable or no-token
// (an EventSource cannot read a 409 sent before the stream opens).
let _preWarning = null; // { variant, message } | null
let _tooltipEl = null;
let _activeCell = null;
let _source = null; // open EventSource, if a download is streaming
let _wired = false;
// Guards the gap between a click on "Fetch from Jira" and the progress modal
// actually opening: that gap crosses an await (GET /status), so a second
// click before the overlay exists used to build a second overlay AND close
// the FIRST click's EventSource out from under it, stranding the first modal
// forever (Close stays disabled - it only wakes on done/error, which the now-
// closed stream will never deliver). Cleared on every exit from _startFetch
// BEFORE the progress modal opens; once it is open and `.open` (css/ds.css:
// pointer-events: all, full-viewport fixed overlay), the trigger physically
// cannot be clicked again, so the flag has done its job.
let _starting = false;
// Unsubscribe for js/secrets-events.js, held only while the view is mounted -
// see _wireSecretsBus().
let _secretsUnsub = null;
// Bumped on every mount: a dynamic import started by an earlier mount that
// settles only after leave-and-return must not subscribe a second time
// (the boolean `_wired` alone cannot tell the two mounts apart).
let _mountEpoch = 0;

function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function _api(path) {
  return (_deps && _deps.apiBase ? _deps.apiBase : '/api/m/time-log') + path;
}

function _toast(variant, title, desc) {
  if (_deps && typeof _deps.showToast === 'function') _deps.showToast(variant, title, desc || '');
}

function _jiraUrl() {
  return (_status && _status.jiraUrl) || JIRA_URL_DEFAULT;
}

// ── team-directory bridge (all safe when the dynamic import never lands) ───

function _memberByEmail(email) {
  return _teamDir && typeof _teamDir.memberByEmail === 'function' ? _teamDir.memberByEmail(email) : null;
}

function _memberAvatarUrl(member) {
  return _teamDir && typeof _teamDir.memberAvatarUrl === 'function' ? _teamDir.memberAvatarUrl(member) : '';
}

function _memberInitials(name) {
  return _teamDir && typeof _teamDir.memberInitials === 'function' ? _teamDir.memberInitials(name) : '';
}

// Ask the directory again on every entry: it is a no-op once it has answered,
// and on a fresh install it may have been asked before the data repo was
// decrypted - the heatmap then painted initials for a roster that was on
// disk all along. Repaint only when the answer actually changed.
function _refreshTeamDir() {
  if (!_teamDir || typeof _teamDir.loadTeamDirectory !== 'function') return;
  const before = (_teamDir.getTeamMembers && _teamDir.getTeamMembers().length) || 0;
  _teamDir.loadTeamDirectory()
    .then(() => {
      const after = (_teamDir.getTeamMembers && _teamDir.getTeamMembers().length) || 0;
      if (after !== before) _repaintIfMounted();
    })
    .catch(() => { /* empty directory is fine */ });
}

function _repaintIfMounted() {
  if (!_mounted) return;
  const root = document.getElementById(ROOT_ID);
  if (root && _data) _paint(root);
}

// ── tooltip ─────────────────────────────────────────────────────────────

function _getTooltip() {
  if (!_tooltipEl) {
    _tooltipEl = document.createElement('div');
    _tooltipEl.className = 'tlc-tooltip';
    _tooltipEl.setAttribute('role', 'tooltip');
    _tooltipEl.style.display = 'none';
    document.body.appendChild(_tooltipEl);
  }
  return _tooltipEl;
}

function _hideTooltip() {
  if (!_tooltipEl) return;
  _tooltipEl.style.display = 'none';
  _activeCell = null;
}

function _positionTooltip(t, anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  const ttW = t.offsetWidth || 480;
  const ttH = t.offsetHeight || 160;
  const margin = 8;

  const spaceRight = window.innerWidth - rect.right - margin;
  const spaceLeft = rect.left - margin;
  let left = (spaceRight >= ttW || spaceRight >= spaceLeft)
    ? rect.left + rect.width / 2 - ttW / 2
    : rect.right - ttW;
  left = Math.max(margin, Math.min(left, window.innerWidth - ttW - margin));

  const spaceBelow = window.innerHeight - rect.bottom - margin;
  const spaceAbove = rect.top - margin;
  let top = (spaceBelow >= ttH || spaceBelow >= spaceAbove) ? rect.bottom + 6 : rect.top - ttH - 6;
  top = Math.max(margin, Math.min(top, window.innerHeight - ttH - margin));

  t.style.left = left + 'px';
  t.style.top = top + 'px';
}

function _showTooltip(issues, anchorEl, hours) {
  const t = _getTooltip();
  if (!issues || !issues.length) { t.style.display = 'none'; return; }
  const hoursHtml = typeof hours === 'number' && hours > 0
    ? '<div class="tlc-tt-hours">' + (hours % 1 === 0 ? hours : hours.toFixed(1)) + ' h logged</div>'
    : '';
  t.innerHTML = hoursHtml + issues.map((i) => {
    const keyHtml = i.key
      ? '<a class="tlc-tt-key" href="' + esc(_jiraUrl()) + '/browse/' + esc(i.key) + '" target="_blank" rel="noopener noreferrer">' + esc(i.key) + '</a>'
      : '';
    const sumHtml = i.summary ? '<span class="tlc-tt-sum">' + esc(i.summary) + '</span>' : '';
    const hHtml = typeof i.hours === 'number' && i.hours > 0
      ? '<span class="tlc-tt-h">' + (i.hours % 1 === 0 ? i.hours : i.hours.toFixed(1)) + 'h</span>'
      : '';
    const loggedText = i.logged_at ? fmtLoggedAt(i.logged_at) : '';
    const loggedHtml = loggedText ? '<span class="tlc-tt-logged">logged ' + esc(loggedText) + '</span>' : '';
    return '<div class="tlc-tt-row"><div class="tlc-tt-main">' + keyHtml + sumHtml + hHtml + '</div>' + loggedHtml + '</div>';
  }).join('');
  t.style.display = 'block';
  _positionTooltip(t, anchorEl);
}

// ── skeleton (first paint, before GET /data answers) ────────────────────

function _skeletonHtml() {
  let rows = '';
  for (let i = 0; i < 12; i += 1) rows += '<div class="ds-skeleton tlc-skel-row" data-skel="1"></div>';
  return '<div class="ds-skeleton tlc-skel-toolbar" data-skel="1"></div>' + rows;
}

function _paintActions() {
  const actions = document.getElementById(ACTIONS_ID);
  if (!actions) return;
  actions.innerHTML = '<button type="button" class="ds-btn ds-btn--primary" data-tlc-fetch>Fetch from Jira</button>';
}

function _paintActionsSkeleton() {
  const actions = document.getElementById(ACTIONS_ID);
  if (!actions) return;
  actions.innerHTML = '<button type="button" class="ds-btn ds-btn--primary" data-skel="1" disabled>Fetch from Jira</button>';
}

// ── toolbar, legend ───────────────────────────────────────────────────────

function _preWarningHtml() {
  if (!_preWarning) return '';
  return '<div class="ds-callout ds-callout--' + esc(_preWarning.variant) + '">' + esc(_preWarning.message) + '</div>';
}

function _alertBadgeHtml() {
  const alert = alertStats(_data, _vac);
  if (!alert) return '';
  return '<span class="ds-badge ds-badge--' + esc(alert.tone) + '">' + alert.pct
    + '% logged time on ' + esc(fmtDate(alert.date)) + '</span>';
}

function _toolbarHtml(total, visible) {
  const hasFilter = !!(_query || _team);
  let segs = '<button type="button" class="ds-segment' + (_team === '' ? ' active' : '') + '" data-tlc-team="">All teams</button>';
  for (const t of TEAMS) {
    segs += '<button type="button" class="ds-segment' + (_team === t ? ' active' : '') + '" data-tlc-team="' + esc(t) + '">' + esc(t) + '</button>';
  }
  return '<div class="tlc-toolbar">'
    + '<div class="ds-input-wrap tlc-search-wrap">'
    + '<input type="text" class="ds-input" data-tlc-search value="' + esc(_query) + '" placeholder="Search for a person..." '
    + 'aria-label="Search for a person" autocomplete="off">'
    + '</div>'
    + '<div class="ds-segmented tlc-team-seg">' + segs + '</div>'
    + '<div class="tlc-toolbar-actions"' + (hasFilter ? '' : ' hidden') + '>'
    + '<span class="tlc-count">' + visible + ' of ' + total + '</span>'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-tlc-clear>Clear</button>'
    + '</div>'
    + '</div>';
}

function _legendHtml() {
  const items = [
    ['logged', 'logged'],
    ['miss', 'no log'],
    ['vacation', 'time off'],
    ['weekend', 'weekend'],
    ['holiday', 'public holiday'],
  ];
  const note = _vacAvailable
    ? ''
    : '<li class="tlc-legend-note">no time off - the "Time Off" module is not enabled, so a day off looks like a missing log here</li>';
  return '<ul class="tlc-legend">' + items.map(([cls, label]) => (
    '<li><span class="tlc-legend-dot tlc-legend-dot--' + cls + '" aria-hidden="true"></span><span>' + esc(label) + '</span></li>'
  )).join('') + note + '</ul>';
}

// ── heatmap grid ──────────────────────────────────────────────────────────

function _sumClass(pct) {
  if (pct === null || pct === undefined) return '';
  if (pct === 100) return 'tlc-sum--full';
  return pct >= 80 ? 'tlc-sum--ok' : 'tlc-sum--warn';
}

function _personRowHtml(p, dates) {
  const member = _memberByEmail(p.email);
  const avatarSrc = _memberAvatarUrl(member);
  const avatarHtml = avatarSrc
    ? '<img class="tlc-avatar" src="' + esc(avatarSrc) + '" alt="" loading="lazy">'
    : '<span class="tlc-avatar tlc-avatar--initials">' + esc(_memberInitials(p.name)) + '</span>';

  const totalsP = personTotals(p, dates, _vac);
  const hasMissing = totalsP.missingDates.length > 0;
  const disabledAttr = (!p.email || !hasMissing) ? ' disabled' : '';
  const teamsTitle = !p.email
    ? 'No e-mail address in the team directory'
    : (!hasMissing ? 'No missing time entries' : 'Send a Teams message');

  const nameCell = '<div class="tlc-name-cell">' + avatarHtml
    + '<span class="tlc-name-text">' + esc(p.display_short || p.name) + '</span>'
    + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm tlc-teams-btn" '
    + 'aria-label="Send a Teams message" title="' + esc(teamsTitle) + '" '
    + 'data-tlc-teams="' + esc(p.slug) + '"' + disabledAttr + '>' + TEAMS_SVG + '</button>'
    + '</div>';

  const days = Array.isArray(p.days) ? p.days : [];
  const dayCells = dates.map((iso, i) => {
    const day = days[i] || { date: iso, is_weekend: false, is_holiday: false, has_log: false, hours: 0, issues: [] };
    const isVac = isVacation(_vac, p.name, iso);
    const state = cellState(day, isVac);
    const cls = 'tlc-cell tlc-cell--' + state.kind + (state.hi ? ' tlc-cell--hi' : '');
    const style = state.kind === 'logged' ? ' style="--tlc-frac:' + state.frac.toFixed(3) + '"' : '';
    const hasIssues = state.kind === 'logged' && Array.isArray(day.issues) && day.issues.length > 0;
    // A cell that opens the issues tooltip is a CONTROL: role, tab stop and
    // a keyboard path (Enter/Space in _onRootKeydown), not a div with a
    // pointer cursor nobody can reach from the keyboard.
    const issuesAttr = hasIssues ? ' data-tlc-issues="' + esc(JSON.stringify(day.issues)) + '" role="button" tabindex="0" aria-haspopup="true"' : '';
    const hoursAttr = (state.kind === 'logged' && day.hours) ? ' data-tlc-hours="' + day.hours + '"' : '';
    const hoursText = (state.kind === 'logged' && day.hours)
      ? String(day.hours % 1 === 0 ? day.hours : day.hours.toFixed(1))
      : '';
    const label = esc((p.display_short || p.name) + ' ' + fmtDate(iso) + ': ' + state.label + (hoursText ? ' ' + hoursText + 'h' : ''));
    return '<div class="' + cls + '"' + style + issuesAttr + hoursAttr + ' aria-label="' + label + '">'
      + (hoursText ? '<span class="tlc-cell-h">' + esc(hoursText) + '</span>' : '') + '</div>';
  }).join('');

  const rowSumTxt = totalsP.effective ? totalsP.logged + '/' + totalsP.effective : '';
  const rowSumCell = '<div class="tlc-cell tlc-cell--row-sum ' + _sumClass(totalsP.pct) + '">' + rowSumTxt + '</div>';

  return nameCell + dayCells + rowSumCell;
}

function _gridHtml(persons, dates) {
  const totals = columnTotals(persons, dates, _vac);
  const headerCells = dates.map((d) => '<div class="tlc-cell tlc-cell--header">' + esc(fmtDate(d)) + '</div>').join('');
  const rows = persons.map((p) => _personRowHtml(p, dates)).join('');
  const summaryCells = totals.map((t) => {
    if (t.total === 0) return '<div class="tlc-cell tlc-cell--summary"></div>';
    const pct = Math.round((t.logged / t.total) * 100);
    return '<div class="tlc-cell tlc-cell--summary ' + _sumClass(pct) + '">' + t.logged + '/' + t.total + '</div>';
  }).join('');

  return '<div class="tlc-grid-wrap"><div class="tlc-grid" '
    + 'style="grid-template-columns: minmax(150px, auto) repeat(' + dates.length + ', minmax(28px, 1fr)) minmax(48px, auto);">'
    + '<div class="tlc-name-cell tlc-cell--header"></div>'
    + headerCells
    + '<div class="tlc-cell tlc-cell--header"></div>'
    + rows
    + '<div class="tlc-name-cell tlc-cell--summary">Total:</div>'
    + summaryCells
    + '<div class="tlc-cell tlc-cell--summary"></div>'
    + '</div></div>';
}

// ── main paint ──────────────────────────────────────────────────────────

function _bodyHtml() {
  if (!_data || _data.available !== true) {
    if (_data && _data.storage === 'unavailable') {
      return '<div class="ds-callout ds-callout--warning">The team data repository is not cloned on this '
        + 'computer - clone it in the Sync window on the top bar.</div>';
    }
    return '<div class="ds-card"><div class="ds-card-body">'
      + '<div class="ds-callout ds-callout--info">Nobody has fetched time logs on this computer yet - click '
      + '"Fetch from Jira".</div></div></div>';
  }

  const dates = Array.isArray(_data.dates) ? _data.dates : [];
  const allPersons = Array.isArray(_data.persons) ? _data.persons : [];
  const filtered = filterPersons(allPersons, { query: _query, team: _team });

  return '<div class="tlc-header-row">' + _alertBadgeHtml() + '</div>'
    + _toolbarHtml(allPersons.length, filtered.length)
    + _legendHtml()
    + (filtered.length === 0
      ? '<div class="ds-callout ds-callout--info">Nobody matches the filters. Clear the search or pick another team.</div>'
      : _gridHtml(filtered, dates));
}

function _paint(root) {
  _hideTooltip();
  root.innerHTML = _preWarningHtml() + _bodyHtml();
  const scrollEl = root.querySelector('.tlc-grid-wrap');
  if (scrollEl) scrollEl.addEventListener('scroll', _hideTooltip);
  // Repainted on EVERY _paint(), never only once: a data reload restores the
  // section from a pristine snapshot and hands the module a fresh, listener-
  // free slot.
  _paintActions();
}

// ── data loading ────────────────────────────────────────────────────────

async function _safeJson(res) {
  if (!res || !res.ok) return null;
  try { return await res.json(); } catch (_e) { return null; }
}

async function _refreshData(root) {
  let loadError = null;
  try {
    const [dataRes, statusRes, vacRes] = await Promise.allSettled([
      fetch(_api('/data')),
      fetch(_api('/status')),
      fetch(TIME_OFF_DATA_URL),
    ]);
    _data = (dataRes.status === 'fulfilled' && await _safeJson(dataRes.value))
      || { available: false, storage: 'unavailable', persons: [] };
    _status = (statusRes.status === 'fulfilled' && await _safeJson(statusRes.value)) || null;
    const vacJson = (vacRes.status === 'fulfilled' && await _safeJson(vacRes.value)) || null;
    _vacAvailable = !!vacJson;
    _vac = vacationSet((vacJson && vacJson.entries) || []);
  } catch (e) {
    loadError = e;
    _data = { available: false, storage: 'unavailable', persons: [] };
    _status = null;
    _vac = new Set();
    _vacAvailable = false;
  }
  _paint(root);
  if (loadError) _toast('danger', 'Could not load the time-log data', loadError.message || '');
}

async function _ensureData(root) {
  if (_data) { _paint(root); return; }
  root.innerHTML = _skeletonHtml();
  _paintActionsSkeleton();
  await _refreshData(root);
}

// ── Teams modal ─────────────────────────────────────────────────────────

function _openModal(el, opts) {
  if (_dsModal && typeof _dsModal.openDsModal === 'function') { _dsModal.openDsModal(el, opts); return; }
  el.hidden = false;
  el.classList.add('open');
}

function _closeModal(el) {
  if (_dsModal && typeof _dsModal.closeDsModal === 'function') { _dsModal.closeDsModal(el); return; }
  el.classList.remove('open');
  el.hidden = true;
}

function _openTeamsModal(slug, trigger) {
  const persons = (_data && Array.isArray(_data.persons)) ? _data.persons : [];
  const person = persons.find((p) => p.slug === slug);
  if (!person) return;
  const dates = Array.isArray(_data.dates) ? _data.dates : [];
  const totalsP = personTotals(person, dates, _vac);
  const message = teamsMessage(person.display_short || person.name, totalsP.missingDates);
  const hasEmail = !!person.email;

  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.innerHTML = '<div class="ds-modal" role="dialog" aria-modal="true">'
    + '<div class="ds-modal-header"><span class="ds-modal-title">Message to ' + esc(person.display_short || person.name) + '</span>'
    + '<button type="button" class="ds-modal-close" data-tlc-modal-close aria-label="Close">&times;</button></div>'
    + '<div class="ds-modal-body">'
    + '<label class="ds-label" for="tlc-teams-message">Message draft</label>'
    + '<textarea id="tlc-teams-message" class="ds-textarea" rows="6">' + esc(message) + '</textarea>'
    + (hasEmail ? '' : '<div class="ds-callout ds-callout--warning">This person has no e-mail address in the team directory.</div>')
    + '</div>'
    + '<div class="ds-modal-footer">'
    + '<button type="button" class="ds-btn ds-btn--primary" data-tlc-teams-open' + (hasEmail ? '' : ' disabled') + '>Open in Teams</button>'
    + '<button type="button" class="ds-btn ds-btn--secondary" data-tlc-teams-copy>Copy draft</button>'
    + '<button type="button" class="ds-btn ds-btn--tertiary" data-tlc-modal-close>Cancel</button>'
    + '</div>'
    + '</div>';
  document.body.appendChild(overlay);

  const close = () => { _closeModal(overlay); overlay.remove(); };
  overlay.querySelectorAll('[data-tlc-modal-close]').forEach((b) => b.addEventListener('click', close));

  const textarea = overlay.querySelector('#tlc-teams-message');
  const copyBtn = overlay.querySelector('[data-tlc-teams-copy]');
  const openBtn = overlay.querySelector('[data-tlc-teams-open]');

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(textarea.value.trim());
      _toast('success', 'Copied', '');
    } catch (e) {
      _toast('danger', 'Could not copy', (e && e.message) || '');
    }
  });

  if (hasEmail) {
    openBtn.addEventListener('click', () => {
      const url = teamsDraftUrl(person.email, textarea.value.trim());
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    });
  }

  _openModal(overlay, { trigger: trigger || document.activeElement });
}

// ── progress modal (SSE) ────────────────────────────────────────────────

function _buildProgressOverlay() {
  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.innerHTML = '<div class="ds-modal ds-modal--lg" role="dialog" aria-modal="true">'
    + '<div class="ds-modal-header"><span class="ds-modal-title">Fetching time logs from Jira</span></div>'
    + '<div class="ds-modal-body">'
    + '<div class="ds-progress"><div class="ds-progress-track">'
    + '<div class="ds-progress-fill ds-progress-fill--green" data-tlc-progress-fill style="width:0%"></div>'
    + '</div></div>'
    + '<div class="tlc-log-list" data-tlc-progress-log></div>'
    + '<div class="ds-callout ds-callout--info" hidden data-tlc-progress-callout></div>'
    + '</div>'
    + '<div class="ds-modal-footer">'
    + '<button type="button" class="ds-btn ds-btn--secondary" data-tlc-progress-close disabled>Close</button>'
    + '</div>'
    + '</div>';
  return overlay;
}

function _startFetch(trigger) {
  if (_starting) {
    _toast('info', 'A fetch is already running.', '');
    return;
  }
  _starting = true;
  if (trigger) trigger.setAttribute('aria-busy', 'true');
  (async () => {
    let status;
    try {
      const res = await fetch(_api('/status'));
      status = await res.json();
    } catch (e) {
      _toast('danger', 'Could not check the state before fetching', (e && e.message) || '');
      _starting = false;
      return;
    } finally {
      if (trigger) trigger.removeAttribute('aria-busy');
    }

    if (status.storage === 'unavailable') {
      _preWarning = {
        variant: 'warning',
        message: 'The team data repository is not cloned on this computer - clone it in the '
          + 'Sync window on the top bar.',
      };
      const root = document.getElementById(ROOT_ID);
      if (root) _paint(root);
      _starting = false;
      return;
    }
    // The stream's second pre-SSE 409 (data-missing for the roster) - a
    // cloned ds-data with no team/ folder is a normal fresh-clone state, and
    // EventSource cannot read that 409 body, so the check has to happen here.
    if (status.roster === false) {
      _preWarning = {
        variant: 'warning',
        message: 'The team directory (team/team-members.json) is not available on this computer yet - '
          + 'clone the data repository in the Sync window on the top bar.',
      };
      const root = document.getElementById(ROOT_ID);
      if (root) _paint(root);
      _starting = false;
      return;
    }
    if (!status.token) {
      _preWarning = { variant: 'warning', message: 'No Jira token - unlock the Bitwarden vault on the top bar and try again.' };
      const root = document.getElementById(ROOT_ID);
      if (root) _paint(root);
      _starting = false;
      return;
    }
    if (status.job && status.job.running) {
      _toast('info', 'A fetch is already running', '');
      _starting = false;
      return;
    }

    _preWarning = null;

    const overlay = _buildProgressOverlay();
    document.body.appendChild(overlay);
    _openModal(overlay, { dismissible: false });
    // The overlay is now `.open` and full-viewport (css/ds.css: pointer-events:
    // all) - a second click on the trigger button behind it cannot reach it,
    // so the guard has done its job and a genuinely new run may start later.
    _starting = false;

    const fill = overlay.querySelector('[data-tlc-progress-fill]');
    const logEl = overlay.querySelector('[data-tlc-progress-log]');
    const closeBtn = overlay.querySelector('[data-tlc-progress-close]');
    const calloutEl = overlay.querySelector('[data-tlc-progress-callout]');

    const source = new EventSource(_api('/refresh-stream'));
    _source = source;
    // Registered at creation, not in init(): a fresh EventSource opens on
    // every click of "Fetch from Jira", so its teardown has to be
    // re-registered every time too.
    // The overlay goes with it: it sits on document.body, is not dismissible
    // and its Close button only wakes on done/error - which never arrive once
    // the stream is closed, so leaving it behind would cover the whole app.
    if (_deps && typeof _deps.registerViewCleanup === 'function') {
      _deps.registerViewCleanup(() => {
        if (_source === source) _source = null;
        source.close();
        if (overlay.parentNode) { _closeModal(overlay); overlay.remove(); }
      });
    }

    const finish = () => { if (_source === source) _source = null; source.close(); };

    source.addEventListener('progress', (ev) => {
      try {
        const obj = JSON.parse(ev.data);
        if (fill && typeof obj.percent === 'number') fill.style.width = obj.percent + '%';
        if (obj.message && logEl) {
          const line = document.createElement('div');
          line.className = 'tlc-log';
          line.textContent = obj.message;
          logEl.appendChild(line);
          logEl.scrollTop = logEl.scrollHeight;
        }
      } catch (_e) { /* malformed progress line - ignored, next one may parse */ }
    });

    source.addEventListener('done', (ev) => {
      let result = {};
      try { result = JSON.parse(ev.data); } catch (_e) { /* fall through with empty result */ }
      finish();
      if (fill) fill.style.width = '100%';
      if (calloutEl) {
        calloutEl.hidden = false;
        calloutEl.className = 'ds-callout ds-callout--success';
        calloutEl.innerHTML = '<div>Fetched ' + (result.worklogs || 0) + ' entries for ' + (result.persons || 0)
          + ' people; ' + (result.unmatched || 0) + ' authors outside the team directory. The data is saved on this computer '
          + '- send it to the team from the Sync window on the top bar.</div>';
      }
      if (closeBtn) closeBtn.disabled = false;
      _toast('success', 'Time logs fetched', (result.persons || 0) + ' people, ' + (result.worklogs || 0) + ' entries');
      // The run rewrote data-tier-0's time-log/: announce it on the core's
      // data bus, so the core repaints the module sync bar (local date,
      // pending files) and calls onDataChanged() below - the same reload as
      // before, with this summary modal left open (a re-entry would close it
      // through the cleanup registered above). Dynamic import: Node-safe.
      import('/js/data-events.js')
        .then((ev) => ev.emitDataChanged({ source: 'time-log' }))
        .catch(() => {
          _data = null;
          const root = document.getElementById(ROOT_ID);
          if (root) _refreshData(root);
        });
    });

    source.addEventListener('error', (ev) => {
      let message = 'An error occurred while fetching.';
      if (ev && ev.data) {
        try { message = JSON.parse(ev.data).message || message; } catch (_e) { /* keep default */ }
      }
      finish();
      if (calloutEl) {
        calloutEl.hidden = false;
        calloutEl.className = 'ds-callout ds-callout--danger';
        calloutEl.innerHTML = '<div>' + esc(message) + '</div>';
      }
      if (closeBtn) closeBtn.disabled = false;
    });

    const close = () => { _closeModal(overlay); overlay.remove(); };
    if (closeBtn) closeBtn.addEventListener('click', close);
  })();
}

// ── delegated listeners (wired once per mounted root, re-wired every entry) ─
// `deps.registerViewCleanup` callbacks run on EVERY exit from the view (see
// js/view-lifecycle.js), not only on a full module reload, so `_wired` makes
// re-wiring idempotent.

function _onRootClick(e, root) {
  const cell = e.target.closest && e.target.closest('[data-tlc-issues]');
  if (cell) {
    e.stopPropagation();
    if (_activeCell === cell && _tooltipEl && _tooltipEl.style.display !== 'none') {
      _hideTooltip();
    } else {
      _activeCell = cell;
      let issues = [];
      try { issues = JSON.parse(cell.dataset.tlcIssues || '[]'); } catch (_e) { issues = []; }
      const hours = parseFloat(cell.dataset.tlcHours || '0') || 0;
      _showTooltip(issues, cell, hours);
    }
    return;
  }

  const teamsBtn = e.target.closest && e.target.closest('[data-tlc-teams]');
  if (teamsBtn && !teamsBtn.disabled) {
    _openTeamsModal(teamsBtn.dataset.tlcTeams, teamsBtn);
    return;
  }

  const teamSeg = e.target.closest && e.target.closest('[data-tlc-team]');
  if (teamSeg) {
    _team = teamSeg.dataset.tlcTeam || '';
    _paint(root);
    return;
  }

  const clearBtn = e.target.closest && e.target.closest('[data-tlc-clear]');
  if (clearBtn) {
    _query = '';
    _team = '';
    _paint(root);
  }
}

function _onRootKeydown(e, root) {
  if (e.key === 'Escape') { _hideTooltip(); return; }
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const cell = e.target.closest && e.target.closest('[data-tlc-issues]');
  if (!cell) return;
  e.preventDefault();
  _onRootClick({ target: cell, stopPropagation() {} }, root);
}

function _onRootInput(e, root) {
  const input = e.target.closest && e.target.closest('[data-tlc-search]');
  if (!input) return;
  _query = input.value || '';
  _paint(root);
  const si = root.querySelector('[data-tlc-search]');
  if (si) { si.focus(); si.setSelectionRange(si.value.length, si.value.length); }
}

function _onDocClickCapture(e) {
  if (!_tooltipEl || _tooltipEl.style.display === 'none') return;
  if (_tooltipEl.contains(e.target)) return;
  if (e.target.closest && e.target.closest('[data-tlc-issues]')) return;
  _hideTooltip();
}

// Subscribes to js/secrets-events.js so a vault unlock while the view stays
// mounted drops a stale pre-fetch warning immediately, instead of leaving it
// on screen until the next "Fetch from Jira" click clears it. Called from
// _ensureWired, guarded the same way (`_wired`), so the subscription is
// re-created every mount and torn down in the SAME cleanup callback - dynamic
// on purpose, same rule as the team-directory/ds-modal imports in init():
// a static import would break a plain-Node import of this file.
function _wireSecretsBus(epoch) {
  import('/js/secrets-events.js').then((mod) => {
    // The view may already have been left (cleanup already ran) - or left
    // and re-entered - by the time this import settles: subscribe only for
    // the mount that started this import, never onto a torn-down or a newer
    // instance (which has its own call in flight).
    if (!_wired || epoch !== _mountEpoch) return;
    if (typeof mod.onSecretsChanged !== 'function') return;
    _secretsUnsub = mod.onSecretsChanged(() => {
      if (!_preWarning) return;
      _preWarning = null;
      _repaintIfMounted();
    });
  }).catch(() => { /* bus unavailable - the warning still clears on next view entry */ });
}

function _ensureWired(root) {
  if (_wired) return;
  _wired = true;
  _mountEpoch += 1;

  const onClick = (e) => _onRootClick(e, root);
  root.addEventListener('click', onClick);

  const onInput = (e) => _onRootInput(e, root);
  root.addEventListener('input', onInput);

  const onKeydown = (e) => _onRootKeydown(e, root);
  root.addEventListener('keydown', onKeydown);

  const actions = document.getElementById(ACTIONS_ID);
  const onActionsClick = (e) => {
    const btn = e.target.closest && e.target.closest('[data-tlc-fetch]');
    if (btn) _startFetch(btn);
  };
  if (actions) actions.addEventListener('click', onActionsClick);

  document.addEventListener('click', _onDocClickCapture, true);
  _wireSecretsBus(_mountEpoch);

  if (_deps && typeof _deps.registerViewCleanup === 'function') {
    _deps.registerViewCleanup(() => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('input', onInput);
      root.removeEventListener('keydown', onKeydown);
      if (actions) actions.removeEventListener('click', onActionsClick);
      document.removeEventListener('click', _onDocClickCapture, true);
      _hideTooltip();
      if (_tooltipEl && _tooltipEl.parentNode) _tooltipEl.parentNode.removeChild(_tooltipEl);
      _tooltipEl = null;
      if (_source) { _source.close(); _source = null; }
      if (_secretsUnsub) { _secretsUnsub(); _secretsUnsub = null; }
      _wired = false;
    });
  }
}

// ── view ────────────────────────────────────────────────────────────────

export const views = {

  'time-log-main': {
    /** @param {{ navigate, registerViewCleanup, showToast, apiBase }} deps */
    init(deps) {
      _deps = deps;

      // No registerViewCleanup() call here on purpose: init() runs ONCE per
      // session, but the cleanup registry is consumed on EVERY exit - the
      // real teardown is registered at each resource's creation site instead
      // (_ensureWired for listeners, _startFetch for the EventSource).

      // Dynamic on purpose - see the header comment: a static import would
      // break a plain-Node import of this file (no document, no /js/... resolver).
      (async () => {
        try {
          _teamDir = await import('/js/team-directory.js');
          await _teamDir.loadTeamDirectory();
        } catch (e) {
          console.warn('[time-log] team directory unavailable', e);
          _teamDir = null;
        }
        _repaintIfMounted();
      })();

      (async () => {
        try { _dsModal = await import('/js/ds-modal.js'); } catch { _dsModal = null; }
      })();
    },

    /**
     * @param {string} _subPath path segment after the view id
     * @param {object} _opts navigation options
     */
    async render(_subPath, _opts) {
      const root = document.getElementById(ROOT_ID);
      if (!root) return;
      // A pre-fetch warning ("No Jira token - unlock the vault...") must not
      // outlive its cause: render() runs on every fresh entry into this view
      // (leaving and coming back), so a vault unlocked elsewhere in the
      // meantime is reflected without waiting for a new "Fetch from Jira"
      // click. The cockpit:secrets-changed subscription in _wireSecretsBus
      // covers the case where the person never leaves the view at all.
      _preWarning = null;
      // _ensureData paints the working action button once data is loaded
      // (via _paint -> _paintActions) and a disabled skeleton twin while a
      // fetch is in flight (_paintActionsSkeleton) - never both at once.
      await _ensureData(root);
      _ensureWired(root);
      _mounted = true;
      _refreshTeamDir();
    },

    // Opt-out of the core's re-entry on cockpit:data-changed (a pull, or a
    // finished "Fetch from Jira"): reload in place, keeping the team filter,
    // the search and an open progress modal.
    async onDataChanged() {
      const root = document.getElementById(ROOT_ID);
      if (!root) return;
      _data = null;
      await _refreshData(root);
    },
  },
};
