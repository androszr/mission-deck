// time-off/client/index.js
// Time off - monthly calendar of the whole team's time off, avatars per day,
// filtered by team, with one action ("Download") that streams progress from
// the server's SharePoint download job over SSE.
//
// export const views = { 'time-off-main': { init(deps), render(subPath, opts) } }
// - the shape js/module-host.js expects (see js/module-host.js _registerView
//   and modules/demo-hub/client/index.js for the working pattern).
//
// deps (passed to init):
//   navigate(viewId)            - go to another view
//   registerViewCleanup(cb)     - MANDATORY for timers, listeners, EventSource
//   showToast(variant, title, desc) - variant: success | danger | info | warning | neutral
//   apiBase                     - '/api/m/time-off' (this module's routes)
//
// Team-directory and ds-select are CORE ESM modules, so the import MUST be
// dynamic and only ever run inside init() - a static `import` at the top of this file
// would break the contract test, which imports this module in plain Node
// with no browser document and no `/js/...` URL resolver.
//
// DS classes only (ds-btn, ds-card, ds-badge, ds-callout, ds-input) and
// tokens from css/ds-tokens.css - never a hex.

import {
  slugify, buildMonthGrid, buildRange, mergeShards, daysBetween, fmtDate,
  getInitials, parseYM, formatYM, paletteClassMap,
  normalizeSearch, filterEntriesByPerson, countPersons,
} from './time-off-lib.js';
import { publicHolidays } from './holidays.js';

// Re-exported so a future caller (or a test) can reach the pure helpers
// straight off this module without a second import path.
export {
  slugify, buildMonthGrid, buildRange, mergeShards, daysBetween, fmtDate,
  getInitials, parseYM, formatYM, paletteClassMap, publicHolidays,
  normalizeSearch, filterEntriesByPerson, countPersons,
};

const ROOT_ID = 'time-off-main-root';
const ACTIONS_ID = 'time-off-main-actions';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Module-scope state - one view instance for the whole app session, same
// pattern as modules/demo-hub/client/index.js.
let _deps = null;
let _teamDir = null; // '/js/team-directory.js' namespace once loaded, else null
let _dsSelect = null; // '/js/ds-select.js' namespace once loaded, else null
let _data = null; // last GET /data answer
// The outcome callout of the last "Download" run. _paint() rebuilds the whole
// toolbar, progress box included, so a result written into the box alone
// vanished one frame later when the fresh data repainted the view.
let _stickyCallout = null; // { variant, html } | null
let _range = null; // { minYM, maxYM, startYM }
let _ym = null; // currently displayed "YYYY-MM"
let _teamFilter = ''; // '' = all teams
let _search = ''; // free-text person filter, lives next to the team select
let _entriesById = {};
let _popoverEl = null;
let _popoverShowTimer = null;
let _popoverHideTimer = null;
let _source = null; // open EventSource, if a download is streaming

function _api(path) {
  return (_deps && _deps.apiBase ? _deps.apiBase : '/api/m/time-off') + path;
}

function _toast(variant, title, desc) {
  if (_deps && typeof _deps.showToast === 'function') _deps.showToast(variant, title, desc || '');
}

function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function _todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
}

// ── team-directory bridge (all safe when the dynamic import never lands) ───

function _teamMembers() {
  return _teamDir && typeof _teamDir.getTeamMembers === 'function' ? _teamDir.getTeamMembers() : [];
}

function _memberByName(name) {
  return _teamDir && typeof _teamDir.memberByName === 'function' ? _teamDir.memberByName(name) : null;
}

function _memberAvatarUrl(member) {
  return _teamDir && typeof _teamDir.memberAvatarUrl === 'function' ? _teamDir.memberAvatarUrl(member) : '';
}

// Ask the directory again on every entry: it is a no-op once it has answered,
// and on a fresh install it may have been asked before the data repo was
// decrypted - the calendar then painted initials for a roster that was on
// disk all along. Repaint only when the answer actually changed.
function _refreshTeamDir() {
  if (!_teamDir || typeof _teamDir.loadTeamDirectory !== 'function') return;
  const before = _teamMembers().length;
  _teamDir.loadTeamDirectory()
    .then(() => { if (_teamMembers().length !== before) _repaintIfMounted(); })
    .catch(() => { /* empty directory is fine */ });
}

function _memberInitials(name) {
  if (_teamDir && typeof _teamDir.memberInitials === 'function') return _teamDir.memberInitials(name);
  return getInitials(name);
}

function _displayName(entry, member) {
  if (member && _teamDir && typeof _teamDir.fullName === 'function') {
    const full = _teamDir.fullName(member);
    if (full) return full;
  }
  return entry.person || '';
}

// ── toolbar pieces ──────────────────────────────────────────────────────────

function _teamOptionsHtml() {
  const members = _teamMembers();
  const teams = [...new Set(members.map((m) => m.team).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'en'));
  let html = '<option value="">All teams</option>';
  for (const t of teams) {
    html += '<option value="' + esc(t) + '"' + (t === _teamFilter ? ' selected' : '') + '>' + esc(t) + '</option>';
  }
  return html;
}

function _monthLabel(ym) {
  const { year, month } = parseYM(ym);
  return MONTH_NAMES[month - 1] + ' ' + year;
}

function _fetchedAtLabel(data) {
  if (!data || !data.fetched_at) return 'No data - click Download';
  return 'Data from: ' + fmtDate(String(data.fetched_at).slice(0, 10));
}

// ── calendar ──────────────────────────────────────────────────────────────

function _avatarHtml(entry, paletteMap) {
  const member = _memberByName(entry.person);
  const name = _displayName(entry, member);
  const avatarSrc = _memberAvatarUrl(member);
  const colorCls = paletteMap[entry.person_slug || entry.person] || 'timeoff-c--1';
  if (avatarSrc) {
    return '<img class="timeoff-avatar timeoff-avatar--img" src="' + esc(avatarSrc) + '" alt="' + esc(name)
      + '" data-id="' + esc(entry.id) + '" loading="lazy">';
  }
  const initials = _memberInitials(entry.person) || getInitials(name);
  return '<span class="timeoff-avatar timeoff-avatar--initials ' + colorCls + '" data-id="' + esc(entry.id) + '">'
    + esc(initials) + '</span>';
}

function _gridHtml(entries) {
  const { year, month } = parseYM(_ym);
  const holidays = publicHolidays(year);
  const cells = buildMonthGrid(year, month, holidays);
  const today = _todayStr();
  const paletteMap = paletteClassMap(entries);

  _entriesById = {};
  for (const e of entries) _entriesById[e.id] = e;

  let html = '<div class="timeoff-grid"><div class="timeoff-week-header">';
  for (const d of DAY_HEADERS) html += '<div class="timeoff-day-header">' + esc(d) + '</div>';
  html += '</div><div class="timeoff-weeks">';

  for (let i = 0; i < cells.length; i += 7) {
    const week = cells.slice(i, i + 7);
    html += '<div class="timeoff-week">';
    for (const cell of week) {
      if (!cell) { html += '<div class="timeoff-day timeoff-day--empty"></div>'; continue; }
      let cls = '';
      if (cell.dateStr === today) cls += ' timeoff-day--today';
      const isOff = cell.isWeekend || cell.isHoliday;
      if (isOff) cls += ' timeoff-day--off';

      let avatarsHtml = '';
      if (!isOff) {
        const dayEntries = entries.filter((e) => e.dateFrom <= cell.dateStr && cell.dateStr <= e.dateTo);
        if (dayEntries.length > 0) {
          avatarsHtml = '<div class="timeoff-day-avatars">'
            + dayEntries.map((e) => _avatarHtml(e, paletteMap)).join('') + '</div>';
        }
      }
      html += '<div class="timeoff-day' + cls + '"><div class="timeoff-day-num">' + cell.dayNum + '</div>'
        + avatarsHtml + '</div>';
    }
    html += '</div>';
  }
  html += '</div></div>';
  return html;
}

/**
 * Count line wording: "1 person", "N people".
 * @param {number} n
 * @returns {string}
 */
function _personsLabel(n) {
  return n === 1 ? '1 person' : n + ' people';
}

/**
 * The entries both filters let through. The team select narrows by the team
 * directory record, the search box by the person's name - the sheet's spelling
 * and the name shown on screen, so a surname alone matches either way.
 * @param {Array<object>} allEntries
 * @returns {Array<object>}
 */
function _visibleEntries(allEntries) {
  const byTeam = _teamFilter
    ? allEntries.filter((e) => {
      const m = _memberByName(e.person);
      return m && m.team === _teamFilter;
    })
    : allEntries;
  return filterEntriesByPerson(byTeam, _search, (e) => _displayName(e, _memberByName(e.person)));
}

/**
 * How many people the DISPLAYED month holds after both filters - the number
 * the count line reports. An entry counts when it overlaps the month at all.
 * @param {Array<object>} entries
 * @returns {number}
 */
function _monthPersonCount(entries) {
  // "-31" is a LEXICAL upper bound, not a real date: ISO dates sort as strings,
  // and no date in a month sorts above it, so the comparison holds in February
  // too. Building a real last-day-of-month would buy nothing here.
  const from = _ym + '-01';
  const to = _ym + '-31';
  return countPersons(entries.filter((e) => e.dateFrom <= to && from <= e.dateTo));
}

function _calendarHtml() {
  const data = _data || {};
  if (data.storage === 'unavailable') {
    return '<div class="ds-callout ds-callout--warning">The team data repository is not cloned on this '
      + 'computer. Clone it from the sync panel on the top bar and come back here.</div>';
  }

  const allEntries = Array.isArray(data.entries) ? data.entries : [];
  const entries = _visibleEntries(allEntries);

  let prefix = '';
  if (allEntries.length === 0) {
    prefix = '<div class="ds-callout ds-callout--info">No time off has been downloaded yet. Click Download.</div>';
  } else if (entries.length === 0) {
    // A grid with no avatars in it reads as broken data rather than as an
    // empty filter, so the reason is spelled out above it.
    prefix = '<div class="ds-callout ds-callout--info">Nobody matches the filters. '
      + 'Clear the search or pick another team.</div>';
  }

  // aria-live so a screen reader hears the result of typing; the count is
  // inside this container on purpose - the search box repaints the calendar
  // alone, and reaching outside it would cost the input its focus.
  const count = '<div class="timeoff-count" aria-live="polite">' + esc(_monthLabel(_ym)) + ': '
    + esc(_personsLabel(_monthPersonCount(entries))) + ' off</div>';

  return prefix + count + _gridHtml(entries);
}

// ── skeleton (first paint, before GET /data answers) ────────────────────────

function _skeletonHtml() {
  const cell = '<div class="timeoff-day"><span class="ds-skeleton ds-skeleton--text"></span></div>';
  const week = '<div class="timeoff-week">' + cell.repeat(7) + '</div>';
  const weeks = week.repeat(5); // 5 weeks covers every month in a Monday-first grid

  let headerCells = '';
  for (const d of DAY_HEADERS) headerCells += '<div class="timeoff-day-header">' + esc(d) + '</div>';

  // Two rows, because the finished toolbar has two: the filter row (two 48px
  // controls) and the month row (a small nav group plus the "updated" label).
  // The primary "Download" button lives in the header actions slot now
  // (see `_paintActionsSkeleton`), not in this card. Every bar below is the
  // height of the control it stands in for, so the card keeps its finished
  // height from the first frame.
  return '<div class="ds-card timeoff-card">'
    + '<div class="timeoff-filters">'
    + '<div class="timeoff-filter-search"><span class="ds-skeleton timeoff-skel-input"></span></div>'
    + '<div class="timeoff-filter-team"><span class="ds-skeleton timeoff-skel-input"></span></div>'
    + '</div>'
    + '<div class="timeoff-toolbar">'
    + '<span class="ds-skeleton timeoff-skel-bar"></span>'
    + '<span class="ds-skeleton timeoff-skel-bar--label" style="margin-left:auto"></span>'
    + '</div>'
    + '<div>'
    + '<span class="ds-skeleton timeoff-skel-count"></span>'
    + '<div class="timeoff-grid">'
    + '<div class="timeoff-week-header">' + headerCells + '</div>'
    + '<div class="timeoff-weeks">' + weeks + '</div>'
    + '</div></div></div>';
}

// ── "Download" (status probe then SSE) ───────────────────────────────────────

function _installCommand(status) {
  const isWindows = status && status.platform === 'win32';
  const py = isWindows ? 'py -3' : 'python3';
  return py + ' -m pip install -r modules/time-off/scripts/requirements.txt && ' + py + ' -m playwright install chromium';
}

function _setCallout(progressEl, variant, html) {
  if (!progressEl) return;
  progressEl.hidden = false;
  progressEl.className = 'ds-callout ds-callout--' + variant + ' timeoff-progress';
  progressEl.innerHTML = html;
}

function _appendProgressLine(progressEl, message) {
  if (!progressEl) return;
  progressEl.hidden = false;
  if (progressEl.className.indexOf('ds-callout--info') === -1) {
    progressEl.className = 'ds-callout ds-callout--info timeoff-progress';
  }
  const prevLast = progressEl.querySelector('.timeoff-progress-line--last');
  if (prevLast) prevLast.classList.remove('timeoff-progress-line--last');
  const line = document.createElement('div');
  line.className = 'timeoff-progress-line timeoff-progress-line--last';
  line.textContent = message;
  progressEl.appendChild(line);
}

async function _refreshData(root) {
  let loadError = null;
  try {
    const res = await fetch(_api('/data'));
    if (!res.ok) throw new Error('The server answered ' + res.status);
    _data = await res.json();
  } catch (e) {
    loadError = e;
    _data = { available: false, storage: 'unavailable', fetched_at: null, source_mtime: null, persons: [], entries: [] };
  }
  const range = buildRange(_data.entries || [], new Date());
  _range = range;
  if (!_ym) _ym = range.startYM;
  else if (_ym < range.minYM) _ym = range.minYM;
  else if (_ym > range.maxYM) _ym = range.maxYM;
  _paint(root);
  if (loadError) {
    _toast('danger', 'Could not load the time-off data', loadError.message || '');
  }
}

function _startFetch(root, fetchBtn) {
  const progressEl = root.querySelector('[data-timeoff-progress]');
  _stickyCallout = null;

  fetchBtn.disabled = true;
  fetchBtn.setAttribute('aria-busy', 'true');

  (async () => {
    let status;
    try {
      const statusRes = await fetch(_api('/status'));
      status = await statusRes.json();
    } catch (_e) {
      _setCallout(progressEl, 'danger', 'Could not check the status before downloading.');
      fetchBtn.disabled = false;
      fetchBtn.removeAttribute('aria-busy');
      return;
    }

    const missingPython = !status.python || !status.python.found;
    const missingDeps = !status.deps || !status.deps.playwright || !status.deps.openpyxl;
    if (missingPython || missingDeps) {
      _setCallout(progressEl, 'warning',
        'Python or its packages are missing on this computer. Install them with: <code>'
        + esc(_installCommand(status)) + '</code>');
      fetchBtn.disabled = false;
      fetchBtn.removeAttribute('aria-busy');
      return;
    }

    if (status.job && status.job.running) {
      _toast('info', 'A download is already running', '');
      fetchBtn.disabled = false;
      fetchBtn.removeAttribute('aria-busy');
      return;
    }

    // /fetch-stream answers repo-missing and not-configured with a plain 409
    // JSON body before it ever opens the SSE stream, and EventSource cannot
    // read that body - so these checks happen here, from a plain fetch, or
    // the person only ever sees the generic error from onerror.
    if (status.storage === 'unavailable') {
      _setCallout(progressEl, 'warning',
        'The team data repository is not cloned on this computer. '
        + 'Clone it from the sync panel on the top bar and come back here.');
      fetchBtn.disabled = false;
      fetchBtn.removeAttribute('aria-busy');
      return;
    }
    if (status.configured === false) {
      _setCallout(progressEl, 'warning',
        'The time-off sheet is not configured. Set <code>TIMEOFF_SHAREPOINT_URL</code> and '
        + '<code>TIMEOFF_SHAREPOINT_DOWNLOAD_URL</code> in <code>.env</code> and restart the server.');
      fetchBtn.disabled = false;
      fetchBtn.removeAttribute('aria-busy');
      return;
    }

    _setCallout(progressEl, 'info', 'Starting the download...');

    if (_source) { _source.close(); _source = null; }
    const source = new EventSource(_api('/fetch-stream'));
    _source = source;
    // Registered at creation, not in init(): a fresh EventSource opens on
    // every click of "Download", so its teardown has to be re-registered every
    // time too - see the comment in _wireHover for why init() alone is wrong.
    if (_deps && typeof _deps.registerViewCleanup === 'function') {
      _deps.registerViewCleanup(() => { if (_source === source) _source = null; source.close(); });
    }

    const finish = () => {
      fetchBtn.disabled = false;
      fetchBtn.removeAttribute('aria-busy');
      if (_source === source) _source = null;
      source.close();
    };

    source.addEventListener('progress', (ev) => {
      try {
        const obj = JSON.parse(ev.data);
        if (obj && obj.message) _appendProgressLine(progressEl, obj.message);
      } catch (_e) { /* malformed progress line - ignored, next one may parse */ }
    });

    source.addEventListener('done', (ev) => {
      let result = {};
      try { result = JSON.parse(ev.data); } catch (_e) { /* fall through with empty result */ }
      finish();
      if (result.status === 'skipped') {
        _setCallout(progressEl, 'info', 'Download skipped (test mode).');
        return;
      }
      _toast('success', 'Time off downloaded', (result.count || 0) + ' entries, ' + (result.persons || 0) + ' people');
      _stickyCallout = {
        variant: 'success',
        html: 'Data saved on this computer. The changes reach the team with the next sync (top bar).',
      };
      _setCallout(progressEl, _stickyCallout.variant, _stickyCallout.html);
      // The run rewrote data-tier-0's time-off/: announce it on the core's data
      // bus, so the core repaints the module sync bar (local date, pending
      // files) and calls onDataChanged() below - the same reload as before,
      // with the sticky callout and the month kept. Dynamic import: Node-safe.
      import('/js/data-events.js')
        .then((ev) => ev.emitDataChanged({ source: 'time-off' }))
        .catch(() => {
          _data = null;
          _ensureData(root);
        });
    });

    source.addEventListener('error', (ev) => {
      let message = 'The download failed.';
      if (ev && ev.data) {
        try { message = JSON.parse(ev.data).message || message; } catch (_e) { /* keep default */ }
      }
      // Sticky like the success outcome: a month arrow or a filter change must
      // not erase the reason the run failed.
      _stickyCallout = { variant: 'danger', html: esc(message) };
      _setCallout(progressEl, _stickyCallout.variant, _stickyCallout.html);
      finish();
    });
  })();
}

// ── popover ───────────────────────────────────────────────────────────────

function _getPopover() {
  if (!_popoverEl) {
    _popoverEl = document.createElement('div');
    _popoverEl.className = 'timeoff-popover';
    _popoverEl.style.display = 'none';
    _popoverEl.addEventListener('mouseenter', _cancelHide);
    _popoverEl.addEventListener('mouseleave', _scheduleHide);
    document.body.appendChild(_popoverEl);
  }
  return _popoverEl;
}

function _cancelShow() {
  if (_popoverShowTimer) { clearTimeout(_popoverShowTimer); _popoverShowTimer = null; }
}

function _cancelHide() {
  if (_popoverHideTimer) { clearTimeout(_popoverHideTimer); _popoverHideTimer = null; }
}

function _scheduleHide() {
  _cancelHide();
  _popoverHideTimer = setTimeout(() => {
    if (_popoverEl) _popoverEl.style.display = 'none';
  }, 160);
}

function _positionPopover(anchorEl) {
  const t = _popoverEl;
  const rect = anchorEl.getBoundingClientRect();
  const ttW = t.offsetWidth || 300;
  const ttH = t.offsetHeight || 130;
  const margin = 8;
  let left = rect.left + rect.width / 2 - ttW / 2;
  left = Math.max(margin, Math.min(left, window.innerWidth - ttW - margin));
  const spaceBelow = window.innerHeight - rect.bottom - margin;
  const spaceAbove = rect.top - margin;
  let top = (spaceBelow >= ttH || spaceBelow >= spaceAbove) ? rect.bottom + 8 : rect.top - ttH - 8;
  top = Math.max(margin, Math.min(top, window.innerHeight - ttH - margin));
  t.style.left = left + 'px';
  t.style.top = top + 'px';
}

function _popoverHtml(entry) {
  const member = _memberByName(entry.person);
  const name = _displayName(entry, member);
  const role = (member && member.role) || '';
  const team = (member && member.team) || '';
  const avatarSrc = _memberAvatarUrl(member);
  const initials = _memberInitials(entry.person) || getInitials(name);
  const avatarHtml = avatarSrc
    ? '<img class="timeoff-popover-avatar" src="' + esc(avatarSrc) + '" alt="' + esc(name) + '" loading="lazy">'
    : '<span class="timeoff-popover-avatar">' + esc(initials) + '</span>';

  const days = daysBetween(entry.dateFrom, entry.dateTo);
  const dayLabel = days === 1 ? 'day' : 'days';

  return '<div class="timeoff-popover-head">' + avatarHtml
    + '<div class="timeoff-popover-info">'
    + '<div class="timeoff-popover-name">' + esc(name) + '</div>'
    + (role ? '<div class="timeoff-popover-role">' + esc(role) + '</div>' : '')
    + (team ? '<div class="timeoff-popover-team">' + esc(team) + '</div>' : '')
    + '</div></div>'
    + '<div class="timeoff-popover-dates">'
    + '<span class="timeoff-popover-dates-label">Off</span>'
    + '<span class="timeoff-popover-dates-value">' + esc(fmtDate(entry.dateFrom)) + ' - ' + esc(fmtDate(entry.dateTo)) + '</span>'
    + '<span class="timeoff-popover-dates-days">' + days + ' ' + dayLabel + '</span>'
    + '</div>';
}

function _showPopover(entry, anchorEl) {
  _cancelHide();
  _cancelShow();
  _popoverShowTimer = setTimeout(() => {
    const t = _getPopover();
    t.innerHTML = _popoverHtml(entry);
    t.style.display = 'block';
    _positionPopover(anchorEl);
  }, 120);
}

function _hidePopover() {
  _cancelShow();
  _scheduleHide();
}

function _wireHover(root) {
  const calRoot = root.querySelector('[data-timeoff-calendar]');
  if (!calRoot) return;

  // Registered here (the creation site) rather than in init(): init runs once
  // per session, but runViewCleanup() deletes the registry entry for this
  // view on every EXIT, so a callback wired only in init() covers just the
  // first visit. Re-registering fresh, idempotent closures on every paint is
  // sanctioned by js/view-lifecycle.js itself ("multiple calls accumulate").
  if (_deps && typeof _deps.registerViewCleanup === 'function') {
    _deps.registerViewCleanup(() => {
      _cancelShow();
      _cancelHide();
      if (_popoverEl && _popoverEl.parentNode) _popoverEl.parentNode.removeChild(_popoverEl);
      _popoverEl = null;
    });
  }

  calRoot.addEventListener('mouseover', (e) => {
    const av = e.target.closest('.timeoff-avatar');
    if (!av) return;
    const id = av.dataset.id;
    const entry = id ? _entriesById[id] : null;
    if (entry) _showPopover(entry, av);
  });
  calRoot.addEventListener('mouseout', (e) => {
    if (e.target.closest('.timeoff-avatar')) _hidePopover();
  });
}

// ── month navigation ─────────────────────────────────────────────────────

function _shiftYM(ym, delta) {
  const { year, month } = parseYM(ym);
  let y = year;
  let m = month + delta;
  if (m < 1) { m = 12; y -= 1; } else if (m > 12) { m = 1; y += 1; }
  return formatYM(y, m);
}

// ── paint ────────────────────────────────────────────────────────────────

function _toolbarHtml() {
  const data = _data || {};
  const prevDisabled = (!_range || _ym <= _range.minYM) ? ' disabled' : '';
  const nextDisabled = (!_range || _ym >= _range.maxYM) ? ' disabled' : '';

  return '<div class="ds-card timeoff-card">'
    // Own row, and the search box is the wide one: js/ds-select.js replaces the
    // native select with a .ds-sel-wrap that css/ds.css gives width:100%, so in
    // the flex toolbar the team filter used to eat a whole line by itself.
    // .timeoff-filter-team caps it at a quarter instead - the wrapper is the
    // element that has to be constrained, never the (0x0, hidden) select.
    + '<div class="timeoff-filters">'
    + '<div class="timeoff-filter-search">'
    + '<input type="search" class="ds-input" data-timeoff-search value="' + esc(_search) + '"'
    + ' placeholder="Search a person - first or last name..."'
    + ' aria-label="Search a person in the time-off calendar" autocomplete="off">'
    + '</div>'
    + '<div class="timeoff-filter-team">'
    + '<select class="ds-input" data-timeoff-team aria-label="Filter by team">' + _teamOptionsHtml() + '</select>'
    + '</div>'
    + '</div>'
    + '<div class="timeoff-toolbar">'
    + '<div class="ds-actions">'
    + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-timeoff-prev' + prevDisabled + '>Previous</button>'
    + '<span class="timeoff-month-label">' + esc(_monthLabel(_ym)) + '</span>'
    + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-timeoff-next' + nextDisabled + '>Next</button>'
    + '</div>'
    + '<span class="timeoff-updated" data-timeoff-updated>' + esc(_fetchedAtLabel(data)) + '</span>'
    + '</div>'
    + '<div class="ds-callout ds-callout--info timeoff-progress" hidden data-timeoff-progress></div>'
    + '<div data-timeoff-calendar>' + _calendarHtml() + '</div>'
    + '</div>';
}

/**
 * Repaints the CALENDAR CONTAINER only. The search box lives outside it, so
 * typing keeps its focus and caret - a full _paint() on every keystroke would
 * rebuild the input and blur it after the first letter. The delegated hover
 * listeners sit on this container itself and survive, which is why _wireHover
 * must NOT be called again here.
 * @param {HTMLElement} root
 */
function _paintCalendar(root) {
  const calRoot = root.querySelector('[data-timeoff-calendar]');
  if (calRoot) calRoot.innerHTML = _calendarHtml();
}

/**
 * Paints the view-header action slot `js/module-host.js` builds as a sibling
 * of `.view-data` (`#time-off-main-actions`). Repainted on EVERY `_paint()`,
 * never only from `_mount`/`init` - a data refresh
 * (`js/data-events.js`, `cockpit:data-changed`) restores the section from a
 * pristine snapshot and hands the module back a fresh, listener-free slot.
 * The slot is replaced wholesale each time, so the freshly created button
 * never carries a stale listener from a previous paint - the same property
 * `_paint()` itself relies on for `prevBtn`/`nextBtn` below.
 * @param {HTMLElement} root
 */
function _paintActions(root) {
  const actions = document.getElementById(ACTIONS_ID);
  if (!actions) return;
  const disabledFetch = (_data && _data.storage === 'unavailable') ? ' disabled' : '';
  actions.innerHTML =
    '<button type="button" class="ds-btn ds-btn--primary" data-timeoff-fetch' + disabledFetch + '>Download</button>';
  const fetchBtn = actions.querySelector('[data-timeoff-fetch]');
  if (fetchBtn) fetchBtn.addEventListener('click', () => _startFetch(root, fetchBtn));
}

/** Skeleton twin of `_paintActions`, painted before the first `GET /data` answers. */
function _paintActionsSkeleton() {
  const actions = document.getElementById(ACTIONS_ID);
  if (!actions) return;
  actions.innerHTML =
    '<button type="button" class="ds-btn ds-btn--primary" data-skel="1" disabled>Download</button>';
}

function _paint(root) {
  root.innerHTML = _toolbarHtml();
  _paintActions(root);
  if (_stickyCallout) {
    _setCallout(root.querySelector('[data-timeoff-progress]'), _stickyCallout.variant, _stickyCallout.html);
  }

  const searchInput = root.querySelector('[data-timeoff-search]');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      _search = searchInput.value || '';
      _paintCalendar(root);
    });
  }

  const teamSel = root.querySelector('[data-timeoff-team]');
  if (teamSel) {
    teamSel.addEventListener('change', () => {
      _teamFilter = teamSel.value || '';
      _paintCalendar(root);
    });
    if (_dsSelect && typeof _dsSelect.initSelect === 'function') {
      try { _dsSelect.initSelect(teamSel); } catch (_e) { /* bare select still works */ }
    }
  }

  const prevBtn = root.querySelector('[data-timeoff-prev]');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (!_range || _ym <= _range.minYM) return;
      _ym = _shiftYM(_ym, -1);
      _paint(root);
    });
  }

  const nextBtn = root.querySelector('[data-timeoff-next]');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (!_range || _ym >= _range.maxYM) return;
      _ym = _shiftYM(_ym, 1);
      _paint(root);
    });
  }

  _wireHover(root);
}

async function _ensureData(root) {
  if (_data) { _paint(root); return; }
  root.innerHTML = _skeletonHtml();
  _paintActionsSkeleton();
  await _refreshData(root);
}

// ── view ─────────────────────────────────────────────────────────────────

function _repaintIfMounted() {
  const root = document.getElementById(ROOT_ID);
  if (root && _data) _paint(root);
}

export const views = {

  'time-off-main': {
    /** @param {{ navigate, registerViewCleanup, showToast, apiBase }} deps */
    init(deps) {
      _deps = deps;

      // No registerViewCleanup() call here on purpose: init() runs ONCE per
      // session (js/app.js's _initedViews gate), but runViewCleanup() DELETES
      // the registry entry for this view on every exit - a callback wired
      // only here would cover the first visit and nothing after. The real
      // teardown is registered at each resource's creation site instead:
      // the popover in _wireHover() (runs on every _paint), the EventSource
      // in _startFetch() (runs on every "Download" click).

      // Dynamic on purpose - see the header comment: a static import would
      // break the contract test (no browser, no /js/... resolver in plain Node).
      (async () => {
        try {
          _teamDir = await import('/js/team-directory.js');
          await _teamDir.loadTeamDirectory();
        } catch (e) {
          console.warn('[time-off] team directory unavailable', e);
          _teamDir = null;
        }
        _repaintIfMounted();
      })();

      (async () => {
        try {
          _dsSelect = await import('/js/ds-select.js');
        } catch (_e) {
          _dsSelect = null;
        }
        _repaintIfMounted();
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

    // Opt-out of the core's re-entry on cockpit:data-changed (a pull, or a
    // finished "Download"): reload in place, keeping the month, the filters
    // and the sticky outcome callout of the last run.
    async onDataChanged() {
      const root = document.getElementById(ROOT_ID);
      if (!root) return;
      _data = null;
      await _refreshData(root);
    },
  },
};
