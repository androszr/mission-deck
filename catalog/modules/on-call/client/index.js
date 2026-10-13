// on-call/client/index.js
// On-call - monthly on-call calendar read from a Confluence page. One view
// on-call-main: a calendar card (avatars per day, four-colour legend), a day
// detail modal, an hours panel, a coordination card, a contacts table, and
// one header-slot action "Sync from Confluence".
//
// js/team-directory.js and js/ds-modal.js are CORE ESM modules - dynamic
// import inside init() only: a static import here would break the contract
// test, which loads this file in plain Node with no browser document and no /js/... URL
// resolver.

import {
  COLUMNS, parseYM, formatYM, shiftYM, buildMonthGrid, monthRange,
  groupEntriesByDay, getInitials, fmtSyncLabel, weekdayHeaders,
} from './oncall-lib.js';

export {
  COLUMNS, parseYM, formatYM, shiftYM, buildMonthGrid, monthRange,
  groupEntriesByDay, getInitials, fmtSyncLabel, weekdayHeaders,
};

const ROOT_ID = 'on-call-main-root';
const ACTIONS_ID = 'on-call-main-actions';
const MODAL_ID = 'on-call-main-day-modal';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Module-scope state - one view instance for the whole app session.
let _deps = null;
let _teamDir = null; // '/js/team-directory.js' namespace once loaded, else null
let _dsModal = null; // '/js/ds-modal.js' namespace once loaded, else null
let _data = null; // last GET /data answer
let _ym = null; // currently displayed "YYYY-MM"
let _stickyCallout = null; // { variant, html } | null - survives a repaint
let _mounted = false;
let _wiredRoot = null; // the root element the delegated click listener is bound to

function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function _api(path) {
  return (_deps && _deps.apiBase ? _deps.apiBase : '/api/m/on-call') + path;
}

function _toast(variant, title, desc) {
  if (_deps && typeof _deps.showToast === 'function') _deps.showToast(variant, title, desc || '');
}

function _todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
}

function _todayYM() {
  return _todayStr().slice(0, 7);
}

// -- team-directory bridge (all safe when the dynamic import never lands) --

function _memberByName(name) {
  return _teamDir && typeof _teamDir.memberByName === 'function' ? _teamDir.memberByName(name) : null;
}

function _memberAvatarUrl(member) {
  return _teamDir && typeof _teamDir.memberAvatarUrl === 'function' ? _teamDir.memberAvatarUrl(member) : '';
}

function _memberInitials(name) {
  if (_teamDir && typeof _teamDir.memberInitials === 'function') return _teamDir.memberInitials(name);
  return getInitials(name);
}

function _refreshTeamDir() {
  if (!_teamDir || typeof _teamDir.loadTeamDirectory !== 'function') return;
  _teamDir.loadTeamDirectory().then(() => _repaintIfMounted()).catch(() => { /* empty directory is fine */ });
}

// -- modal bridge -------------------------------------------------------------

function _openModal(el, opts) {
  if (!el) return;
  if (_dsModal && typeof _dsModal.openDsModal === 'function') { _dsModal.openDsModal(el, opts); return; }
  el.hidden = false;
  el.classList.add('open');
}

function _closeModal(el) {
  if (!el) return;
  if (_dsModal && typeof _dsModal.closeDsModal === 'function') { _dsModal.closeDsModal(el); return; }
  el.classList.remove('open');
  el.hidden = true;
}

// -- avatars -----------------------------------------------------------------

function _avatarHtml(row) {
  const member = _memberByName(row.person);
  const name = (member && _teamDir && typeof _teamDir.fullName === 'function' && _teamDir.fullName(member)) || row.person;
  const avatarSrc = _memberAvatarUrl(member);
  const ringCls = row.columns && row.columns[0] ? 'oncall-ring--' + row.columns[0] : '';
  if (avatarSrc) {
    return '<img class="oncall-avatar oncall-avatar--img ' + ringCls + '" src="' + esc(avatarSrc) + '" alt="'
      + esc(name) + '" loading="lazy">';
  }
  const initials = _memberInitials(row.person) || getInitials(name);
  return '<span class="oncall-avatar oncall-avatar--initials ' + ringCls + '">' + esc(initials) + '</span>';
}

// -- skeleton (first paint, before GET /data answers) ------------------------

function _skeletonHtml() {
  const headers = weekdayHeaders().map(() => '<div class="oncall-day-header"><span class="ds-skeleton oncall-skel-header"></span></div>').join('');
  const cell = '<div class="oncall-day"><span class="ds-skeleton oncall-skel-cell"></span></div>';
  const weeks = ('<div class="oncall-week">' + cell.repeat(7) + '</div>').repeat(5);
  return '<div class="ds-card oncall-card" data-skel="1">'
    + '<div class="oncall-toolbar"><span class="ds-skeleton oncall-skel-bar"></span></div>'
    + '<div class="oncall-legend"><span class="ds-skeleton oncall-skel-legend"></span></div>'
    + '<div class="oncall-grid"><div class="oncall-week-header">' + headers + '</div>' + weeks + '</div>'
    + '</div>'
    + '<div class="oncall-panels">'
    + '<div class="ds-card"><span class="ds-skeleton oncall-skel-bar"></span></div>'
    + '<div class="ds-card"><span class="ds-skeleton oncall-skel-bar"></span></div>'
    + '</div>';
}

function _paintActionsSkeleton() {
  const actions = document.getElementById(ACTIONS_ID);
  if (!actions) return;
  actions.innerHTML =
    '<button type="button" class="ds-btn ds-btn--primary" data-skel="1" disabled>Sync from Confluence</button>';
}

// -- calendar ------------------------------------------------------------------

function _monthLabel(ym) {
  const { year, month } = parseYM(ym);
  return MONTH_NAMES[month - 1] + ' ' + year;
}

function _legendHtml() {
  return '<div class="oncall-legend">' + COLUMNS.map((c) => (
    '<span class="ds-badge ' + c.badge + '">' + esc(c.label) + '</span>'
  )).join('') + '</div>';
}

function _gridHtml(byDay) {
  const { year, month } = parseYM(_ym);
  const cells = buildMonthGrid(year, month);
  const today = _todayStr();

  let html = '<div class="oncall-grid"><div class="oncall-week-header">';
  for (const d of weekdayHeaders()) html += '<div class="oncall-day-header">' + esc(d) + '</div>';
  html += '</div>';

  for (let i = 0; i < cells.length; i += 7) {
    const week = cells.slice(i, i + 7);
    html += '<div class="oncall-week">';
    for (const cell of week) {
      if (!cell) { html += '<div class="oncall-day oncall-day--empty"></div>'; continue; }
      const rows = byDay[cell.dateStr] || [];
      let extraCls = '';
      if (cell.dateStr === today) extraCls += ' oncall-day--today';
      if (cell.isWeekend) extraCls += ' oncall-day--weekend';
      const shown = rows.slice(0, 4);
      const more = rows.length - shown.length;
      const avatars = shown.map((r) => _avatarHtml(r)).join('')
        + (more > 0 ? '<span class="oncall-more">+' + more + '</span>' : '');
      const label = cell.dateStr + ', ' + rows.length + ' people on call';
      html += '<button type="button" class="ds-btn ds-btn--tertiary oncall-day-btn' + extraCls + '" data-oncall-day="'
        + esc(cell.dateStr) + '" aria-label="' + esc(label) + '">'
        + '<span class="oncall-day-num">' + cell.dayNum + '</span>'
        + (avatars ? '<span class="oncall-day-avatars">' + avatars + '</span>' : '')
        + '</button>';
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function _calendarHtml() {
  const data = _data || {};
  if (data.storage === 'unavailable') {
    return '<div class="ds-callout ds-callout--warning">The team data repository is not cloned on this '
      + 'computer. Clone it from the panel in the top bar and come back here.</div>';
  }
  const index = data.index || null;
  const month = data.month || null;
  const entries = (month && Array.isArray(month.entries)) ? month.entries : [];
  const byDay = groupEntriesByDay(entries);

  let prefix = '';
  if (!index) {
    prefix = '<div class="ds-callout ds-callout--info">The schedule has not been fetched yet - click Sync from Confluence.</div>';
  } else if (!month || entries.length === 0) {
    prefix = '<div class="ds-callout ds-callout--info">No schedule for this month - click Sync from Confluence.</div>';
  }

  // Navigation is clamped to the months the data covers (plus today), so a
  // button at the edge is disabled rather than silently doing nothing.
  const range = monthRange((_data && _data.months) || [], _todayYM());
  const prevAttr = _ym > range.minYM ? '' : ' disabled title="No earlier schedule"';
  const nextAttr = _ym < range.maxYM ? '' : ' disabled title="No later schedule"';

  return '<div class="ds-card oncall-card">'
    + '<div class="oncall-toolbar">'
    + '<div class="ds-actions">'
    + '<div class="ds-segmented" role="group" aria-label="Change month">'
    + '<button type="button" class="ds-segment ds-segment--icon" data-oncall-prev aria-label="Previous month"' + prevAttr + '>'
    + '<img class="nav-icon" src="/assets/icons/ds/16-ic-chevron-left.svg" alt=""></button>'
    + '<button type="button" class="ds-segment' + (_ym === _todayYM() ? ' active' : '') + '" data-oncall-today>Today</button>'
    + '<button type="button" class="ds-segment ds-segment--icon" data-oncall-next aria-label="Next month"' + nextAttr + '>'
    + '<img class="nav-icon" src="/assets/icons/ds/16-ic-chevron-right.svg" alt=""></button>'
    + '</div>'
    + '<span class="oncall-month-label">' + esc(_monthLabel(_ym)) + '</span>'
    + '</div>'
    + '<span class="oncall-sync-label">' + esc(fmtSyncLabel(index)) + '</span>'
    + '</div>'
    + _legendHtml()
    + prefix
    + _gridHtml(byDay)
    + '</div>'
    + _panelsHtml(index);
}

// -- hours + coordination + contacts panels -----------------------------------

function _hoursRowsHtml(hours) {
  if (!hours || hours.length === 0) {
    return '<tr><td colspan="4">No on-call hours data.</td></tr>';
  }
  return hours.map((g) => (
    '<tr><td>' + esc(g.system) + '</td><td>' + esc(g.days) + '</td><td>'
    + esc((g.hours || []).join(' and ')) + '</td><td>' + esc(g.scope) + '</td></tr>'
  )).join('');
}

function _coordinationRowsHtml(coordination) {
  if (!coordination || coordination.length === 0) {
    return '<tr><td colspan="3">No coordination data.</td></tr>';
  }
  return coordination.map((k) => {
    const member = _memberByName(k.name);
    const avatarSrc = _memberAvatarUrl(member);
    const avatarHtml = avatarSrc
      ? '<img class="oncall-avatar oncall-avatar--img" src="' + esc(avatarSrc) + '" alt="' + esc(k.name) + '" loading="lazy">'
      : '<span class="oncall-avatar oncall-avatar--initials">' + esc(_memberInitials(k.name)) + '</span>';
    const phoneHtml = k.phone
      ? '<a class="ds-btn ds-btn--tertiary ds-btn--sm" href="tel:' + esc(k.phone) + '">' + esc(k.phone_display || k.phone) + '</a>'
      : '-';
    const mailHtml = k.email
      ? '<a class="ds-btn ds-btn--tertiary ds-btn--sm" href="mailto:' + esc(k.email) + '">' + esc(k.email) + '</a>'
      : '-';
    return '<tr>'
      + '<td><span class="oncall-person-cell">' + avatarHtml
      + '<span class="oncall-coord-info"><span class="oncall-coord-name">' + esc(k.name) + '</span>'
      + (k.note ? '<span class="oncall-coord-note">' + esc(k.note) + '</span>' : '') + '</span></span></td>'
      + '<td>' + phoneHtml + '</td>'
      + '<td>' + mailHtml + '</td>'
      + '</tr>';
  }).join('');
}

function _rosterRowsHtml(roster) {
  if (!roster || roster.length === 0) {
    return '<tr><td colspan="6">No on-call roster data.</td></tr>';
  }
  return roster.map((d) => {
    const member = _memberByName(d.name);
    const avatarSrc = _memberAvatarUrl(member);
    const avatarHtml = avatarSrc
      ? '<img class="oncall-avatar oncall-avatar--img" src="' + esc(avatarSrc) + '" alt="' + esc(d.name) + '" loading="lazy">'
      : '<span class="oncall-avatar oncall-avatar--initials">' + esc(_memberInitials(d.name)) + '</span>';
    const scopeBadges = COLUMNS.filter((c) => d.scopes && d.scopes[c.key]).map((c) => (
      '<span class="ds-badge ' + c.badge + '">' + esc(c.short) + '</span>'
    )).join('');
    const emailsHtml = (d.emails || []).map((e) => (
      '<a class="ds-btn ds-btn--tertiary ds-btn--sm" href="mailto:' + esc(e) + '">' + esc(e) + '</a>'
    )).join('');
    const phoneHtml = d.phone
      ? '<a class="ds-btn ds-btn--tertiary ds-btn--sm" href="tel:' + esc(d.phone) + '">' + esc(d.phone) + '</a>'
      : '';
    return '<tr>'
      + '<td><span class="oncall-person-cell">' + avatarHtml + '<span>' + esc(d.name) + '</span></span></td>'
      + '<td>' + (scopeBadges ? '<span class="oncall-badges">' + scopeBadges + '</span>' : '-') + '</td>'
      + '<td>' + esc(d.role || '-') + '</td>'
      + '<td>' + esc(d.company || '-') + '</td>'
      + '<td>' + (phoneHtml || '-') + '</td>'
      + '<td>' + (emailsHtml || '-') + '</td>'
      + '</tr>';
  }).join('');
}

function _panelsHtml(index) {
  const hours = index && index.hours;
  const coordination = index && index.coordination;
  const roster = index && index.roster;
  // DS card anatomy: header + body, so the content gets the card's padding
  // and the table border does not sit on the card border.
  const card = (title, body, extraCls) => (
    '<div class="ds-card' + (extraCls ? ' ' + extraCls : '') + '">'
    + '<div class="ds-card-header"><span class="ds-card-title">' + title + '</span></div>'
    + '<div class="ds-card-body">' + body + '</div>'
    + '</div>'
  );
  const hoursTable = '<div class="ds-table-wrap"><table class="ds-table"><thead><tr><th>System</th><th>Days</th><th>Hours</th><th>Scope</th></tr></thead>'
    + '<tbody>' + _hoursRowsHtml(hours) + '</tbody></table></div>';
  const rosterTable = '<div class="ds-table-wrap"><table class="ds-table"><thead><tr><th>Person</th><th>Scopes</th><th>Role</th><th>Company</th><th>Phone</th><th>Email</th></tr></thead>'
    + '<tbody>' + _rosterRowsHtml(roster) + '</tbody></table></div>';
  return '<div class="oncall-panels">'
    + card('On-call hours', hoursTable)
    + card('Coordination', '<div class="ds-table-wrap"><table class="ds-table"><thead><tr><th>Person</th><th>Phone</th><th>Email</th></tr></thead>'
      + '<tbody>' + _coordinationRowsHtml(coordination) + '</tbody></table></div>')
    + '</div>'
    + card('On-call roster', rosterTable, 'oncall-block');
}

// -- day modal -----------------------------------------------------------------

function _dayModalOverlayHtml() {
  return '<div id="' + MODAL_ID + '" class="ds-modal-overlay" hidden>'
    + '<div class="ds-modal ds-modal--md" role="dialog" aria-modal="true" aria-labelledby="' + MODAL_ID + '-title">'
    + '<div class="ds-modal-header"><span class="ds-modal-title" id="' + MODAL_ID + '-title">On call</span>'
    + '<button type="button" class="ds-modal-close" data-oncall-modal-close aria-label="Close">&times;</button></div>'
    + '<div class="ds-modal-body" id="' + MODAL_ID + '-body"></div>'
    + '<div class="ds-modal-footer"><button type="button" class="ds-btn ds-btn--secondary" data-oncall-modal-close>Close</button></div>'
    + '</div></div>';
}

function _dayModalPersonHtml(row) {
  const member = _memberByName(row.person);
  const avatarSrc = _memberAvatarUrl(member);
  const name = (member && _teamDir && typeof _teamDir.fullName === 'function' && _teamDir.fullName(member)) || row.person;
  const avatarHtml = avatarSrc
    ? '<img class="oncall-modal-avatar" src="' + esc(avatarSrc) + '" alt="' + esc(name) + '">'
    : '<span class="oncall-modal-avatar oncall-modal-avatar--initials">' + esc(_memberInitials(row.person)) + '</span>';
  const badges = row.columns.map((key) => {
    const col = COLUMNS.find((c) => c.key === key);
    return col ? '<span class="ds-badge ' + col.badge + '">' + esc(col.label) + '</span>' : '';
  }).join('');

  const roster = (_data && _data.index && _data.index.roster) || [];
  const contact = roster.find((d) => d.person_slug === row.person_slug);
  const contactHtml = contact
    ? '<div class="oncall-modal-contact">'
      + (contact.phone ? '<a class="ds-btn ds-btn--tertiary ds-btn--sm" href="tel:' + esc(contact.phone) + '">' + esc(contact.phone) + '</a>' : '')
      + (contact.emails || []).map((e) => '<a class="ds-btn ds-btn--tertiary ds-btn--sm" href="mailto:' + esc(e) + '">' + esc(e) + '</a>').join('')
      + '<div class="oncall-modal-meta">' + esc(contact.company || '') + (contact.role ? ' - ' + esc(contact.role) : '') + '</div>'
      + '</div>'
    : '<div class="ds-callout ds-callout--info">not in the on-call roster</div>';

  return '<div class="oncall-modal-person">' + avatarHtml
    + '<div class="oncall-modal-person-info"><div class="oncall-modal-person-name">' + esc(row.person) + '</div>'
    + '<div class="oncall-modal-badges">' + badges + '</div></div></div>'
    + contactHtml
    + (row.notes && row.notes.length ? '<div class="oncall-modal-note">' + esc(row.notes.join(', ')) + '</div>' : '');
}

function _openDayModal(root, dateStr, trigger) {
  const overlay = root.querySelector('#' + MODAL_ID);
  const body = root.querySelector('#' + MODAL_ID + '-body');
  const title = root.querySelector('#' + MODAL_ID + '-title');
  if (!overlay || !body) return;

  const month = _data && _data.month;
  const entries = (month && Array.isArray(month.entries)) ? month.entries.filter((e) => e.date === dateStr) : [];
  const byDay = groupEntriesByDay(entries);
  const rows = byDay[dateStr] || [];

  if (title) title.textContent = dateStr.split('-').reverse().join('.');
  body.innerHTML = rows.length
    ? rows.map((r) => _dayModalPersonHtml(r)).join('<hr class="oncall-modal-divider">')
    : '<div class="ds-callout ds-callout--info">Nobody is on call on this day.</div>';

  _openModal(overlay, { trigger });
}

// -- sync flow -------------------------------------------------------------

function _setSticky(root, variant, html) {
  _stickyCallout = html ? { variant, html } : null;
  const holder = root.querySelector('[data-oncall-sticky]');
  if (!holder) return;
  if (!_stickyCallout) { holder.innerHTML = ''; return; }
  const warningsHtml = html;
  holder.innerHTML = '<div class="ds-callout ds-callout--' + variant + '"><div>' + warningsHtml + '</div></div>';
}

async function _runSync(root, btn) {
  _setSticky(root, 'info', '');
  btn.setAttribute('aria-busy', 'true');
  try {
    const res = await fetch(_api('/sync'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    let payload = {};
    try { payload = await res.json(); } catch { /* keep default */ }

    if (res.ok) {
      _toast('success', 'Schedule fetched', (payload.months || []).length + ' months, ' + (payload.entries || 0) + ' entries');
      if (Array.isArray(payload.warnings) && payload.warnings.length > 0) {
        const list = payload.warnings.slice(0, 5).map((w) => '<li>' + esc(w) + '</li>').join('');
        _setSticky(root, 'warning', 'A few entries need attention:<ul>' + list + '</ul>');
      } else {
        _setSticky(root, 'success', '');
      }
      _data = null;
      let bus = null;
      try { bus = await import('/js/data-events.js'); } catch { bus = null; }
      if (bus && typeof bus.emitDataChanged === 'function') bus.emitDataChanged();
      else await _refreshData(root);
      return;
    }

    _setSticky(root, 'warning', esc(payload.message || 'The sync failed.'));
    if (res.status >= 500 || res.status === 502) {
      _toast('danger', 'Could not sync the schedule', payload.message || '');
    }
  } catch {
    _setSticky(root, 'warning', 'Could not reach Mission Deck.');
  } finally {
    btn.removeAttribute('aria-busy');
  }
}

// -- header actions slot -----------------------------------------------------

function _paintActions() {
  const actions = document.getElementById(ACTIONS_ID);
  if (!actions) return;
  const disabled = (_data && _data.storage === 'unavailable') ? ' disabled' : '';
  const url = (_data && _data.index && _data.index.source_url) || (_data && _data.pageUrl) || '';
  actions.innerHTML =
    '<button type="button" class="ds-btn ds-btn--primary" data-oncall-sync' + disabled + '>Sync from Confluence</button>'
    + (url
      ? '<a class="ds-btn ds-btn--tertiary" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">'
        + 'Open the page in Confluence'
        + '<img class="nav-icon" src="/assets/icons/ds/16-ic-external-link.svg" alt="">'
        + '</a>'
      : '');
  const syncBtn = actions.querySelector('[data-oncall-sync]');
  if (syncBtn) syncBtn.addEventListener('click', () => { const r = document.getElementById(ROOT_ID); if (r) _runSync(r, syncBtn); });
}

// -- paint --------------------------------------------------------------------

function _paint(root) {
  root.innerHTML = '<div data-oncall-sticky></div>' + _calendarHtml() + _dayModalOverlayHtml();
  _paintActions();
  if (_stickyCallout) _setSticky(root, _stickyCallout.variant, _stickyCallout.html);
  _wireClicks(root);
}

// The delegated click listener sits on the persistent root, which
// `root.innerHTML =` repaints never replace - so it is bound ONCE per visit,
// not once per paint (a repaint after the team directory landed used to add a
// second copy, and "Next" then shifted two months per click). The view
// cleanup removes it and clears `_wiredRoot`, so the next visit wires again.
function _wireClicks(root) {
  if (_wiredRoot === root) return;
  _wiredRoot = root;

  const onClick = (e) => {
    const dayBtn = e.target.closest && e.target.closest('[data-oncall-day]');
    if (dayBtn) { _openDayModal(root, dayBtn.dataset.oncallDay, dayBtn); return; }
    if (e.target.closest && e.target.closest('[data-oncall-modal-close]')) {
      _closeModal(root.querySelector('#' + MODAL_ID));
      return;
    }
    if (e.target && e.target.id === MODAL_ID) { _closeModal(e.target); return; }
    if (e.target.closest && e.target.closest('[data-oncall-prev]')) {
      const r = monthRange((_data && _data.months) || [], _todayYM());
      if (_ym > r.minYM) { _ym = shiftYM(_ym, -1); _ensureMonth(root); }
      return;
    }
    if (e.target.closest && e.target.closest('[data-oncall-next]')) {
      const r = monthRange((_data && _data.months) || [], _todayYM());
      if (_ym < r.maxYM) { _ym = shiftYM(_ym, 1); _ensureMonth(root); }
      return;
    }
    if (e.target.closest && e.target.closest('[data-oncall-today]')) {
      _ym = _todayYM();
      _ensureMonth(root);
    }
  };
  root.addEventListener('click', onClick);
  if (_deps && typeof _deps.registerViewCleanup === 'function') {
    _deps.registerViewCleanup(() => {
      root.removeEventListener('click', onClick);
      if (_wiredRoot === root) _wiredRoot = null;
      _closeModal(root.querySelector('#' + MODAL_ID));
    });
  }
}

async function _refreshData(root) {
  let loadError = null;
  try {
    const res = await fetch(_api('/data?month=' + encodeURIComponent(_ym)));
    if (!res.ok) throw new Error('Server answered ' + res.status);
    _data = await res.json();
  } catch (e) {
    loadError = e;
    _data = { available: false, storage: 'unavailable', index: null, month: null, months: [] };
  }
  _paint(root);
  if (loadError) _toast('danger', 'Could not load the on-call schedule', loadError.message || '');
}

async function _ensureMonth(root) {
  root.innerHTML = _skeletonHtml() + '<div data-oncall-sticky></div>';
  await _refreshData(root);
}

async function _ensureData(root) {
  if (!_ym) _ym = _todayYM();
  if (_data) { _paint(root); return; }
  root.innerHTML = _skeletonHtml();
  _paintActionsSkeleton();
  await _refreshData(root);
}

function _repaintIfMounted() {
  if (!_mounted) return;
  const root = document.getElementById(ROOT_ID);
  if (root && _data) _paint(root);
}

// -- view ------------------------------------------------------------------

export const views = {

  'on-call-main': {
    /** @param {{ navigate, registerViewCleanup, showToast, apiBase }} deps */
    init(deps) {
      _deps = deps;
      _mounted = true;

      // Dynamic on purpose (see header comment): a static import would break
      // the contract test (no browser document, no /js/... resolver in plain Node).
      (async () => {
        try {
          _teamDir = await import('/js/team-directory.js');
          await _teamDir.loadTeamDirectory();
        } catch (e) {
          console.warn('[on-call] team directory unavailable', e);
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
      await _ensureData(root);
      _refreshTeamDir();
    },
  },
};
