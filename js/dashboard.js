// ── Mission Deck — js/dashboard.js ────────────────────────────────────────
// Landing page: three DS entry cards, plus a fourth that appears only on Windows.
// The cards show only while no module is installed; with modules the page is
// the widget grid (js/dashboard-widgets.js).
// Still deliberately data-free on FIRST PAINT — the dashboard is the one view
// that must render before any endpoint answers. The Windows card is appended
// afterwards, from GET /api/app/version, so a slow or dead endpoint costs the
// page nothing: no await before the first three cards reach the DOM.

import { fetchAppVersion } from './app-version.js';
import { registerViewCleanup } from './view-lifecycle.js';
import { paintWidgetGrid, paintFramesFromMemo, clearFrameMemo, teardownWidgets } from './dashboard-widgets.js';

const CARDS = [
  {
    id: 'start',
    title: 'Start here',
    desc: 'First run: tokens, the data repository, Bitwarden.',
    hash: '#onboarding-wizard',
    icon: '<circle cx="12" cy="12" r="9"/><polyline points="10 8 15 12 10 16"/>',
  },
  {
    id: 'academy',
    title: 'Academy',
    desc: 'Training - how to grow your own Mission Deck with Claude Code.',
    hash: '#academy',
    icon: '<path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c0 1.5 2.7 3 6 3s6-1.5 6-3v-5"/>',
  },
  {
    id: 'settings',
    title: 'Settings',
    desc: 'Tokens, modules, data sync and agent models.',
    hash: '#settings',
    icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6 1.65 1.65 0 0 0 10 3.09V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  },
];

// The Windows-only card. Not in CARDS, because CARDS is what paints
// synchronously and this one has to wait for an answer about the OS.
const WINDOWS_CARD = {
  id: 'windows',
  title: 'Windows guide',
  desc: 'Step-by-step installation, Git Bash, line endings and the pitfalls of this system.',
  doc: '/docs/guides/WINDOWS.md',
  icon: '<rect x="3" y="4" width="18" height="14" rx="1"/><path d="M3 9h18"/><path d="M8 21h8"/><path d="M12 18v3"/>',
};

let _navigate = null;
let _windowsCardPainted = false;
// Widgets layer (js/dashboard-widgets.js): the last layout answer, a paint
// sequence so a slow answer cannot overwrite a newer one, and the click wiring.
let _widgetState = { layout: { items: [] }, available: [] };
// True while #dashboard-widgets holds mounted module widgets (not skeletons).
let _liveGrid = false;
let _paintSeq = 0;
let _configWired = false;
// The running edit mode (js/dashboard-edit-mode.js), or null.
let _edit = null;
// Last known "has modules" answer, so a returning person with modules does not
// see the entry cards flash before /api/dashboard/layout answers.
const HAS_MODULES_KEY = 'cockpit.dashboard.hasModules';
const SUBTITLE_START = 'Starting point - pick where to begin.';
const SUBTITLE_WIDGETS = 'Data from your modules as soon as you arrive.';

/**
 * @param {(id: string) => void} navigate router callback from js/app.js
 */
export function initDashboard(navigate) {
  _navigate = navigate;
}

/** Paint the three entry cards into #dashboard-cards. */
export function renderDashboardView() {
  const root = document.getElementById('dashboard-cards');
  if (!root) return;

  root.replaceChildren();
  _windowsCardPainted = false;
  const grid = document.createElement('div');
  grid.className = 'placeholder-hub-grid';

  CARDS.forEach(card => {
    grid.appendChild(_buildCard(card));
  });

  root.appendChild(grid);
  _setEntryCardsVisible(!_readHasModulesMemo());

  // Fire and forget: the three cards above are already on screen.
  _maybeAddWindowsCard(grid).catch(() => { /* no card is the correct fallback */ });

  _wireConfigClicks();
  // Same rule for the widgets layer: no modules means no request result on screen.
  // A fresh entry never counts as a refresh: the view exit already tore the
  // widgets down, so what is left in the grid is dead markup.
  _liveGrid = false;
  _paintWidgetsSection().catch(() => { /* the dashboard without widgets is the fallback */ });
}

/** Repaint only the widgets (registry `refresh` hook after a data sync). */
export function refreshDashboardWidgets() {
  // A data sync must not repaint the grid under a person who is rearranging it.
  if (_edit) return Promise.resolve();
  return _paintWidgetsSection().catch(() => { /* keep what is on screen */ });
}

/** One delegated listener for every [data-dash-config] button; removed on view exit. */
function _wireConfigClicks() {
  const view = document.getElementById('view-dashboard');
  if (!view || _configWired) return;
  const onClick = (e) => {
    const btn = e.target.closest && e.target.closest('[data-dash-config]');
    if (!btn) return;
    if (_edit) return;
    const grid = document.getElementById('dashboard-widgets');
    const actions = document.getElementById('dashboard-actions');
    if (!grid || !actions) return;
    const wasEmpty = _widgetState.layout.items.length === 0;
    // Claim the slot before the lazy import resolves so a double click starts one session.
    const placeholder = { dispose() { /* replaced below */ } };
    _edit = placeholder;
    import('./dashboard-edit-mode.js').then(({ startDashboardEdit }) => {
      if (_edit !== placeholder) return; // the view was left (or re-entered) while the module loaded
      _edit = startDashboardEdit({
        view,
        host: grid,
        actions,
        items: _widgetState.layout.items,
        available: _widgetState.available,
        navigate: _navigate,
        openPicker: wasEmpty,
        onDone: ({ saved, items }) => {
          _edit = null;
          if (saved) _widgetState = { layout: { items }, available: _widgetState.available };
          _applyState(grid, actions);
          const cfg = view.querySelector('[data-dash-config]');
          if (cfg) cfg.focus();
        },
      });
    }).catch((err) => {
      if (_edit === placeholder) _edit = null;
      console.warn('[dashboard] edit mode failed', err);
    });
  };
  view.addEventListener('click', onClick);
  _configWired = true;
  registerViewCleanup('dashboard', () => {
    view.removeEventListener('click', onClick);
    _configWired = false;
    // Leaving the view discards the draft (the edit session disposes itself too).
    if (_edit && typeof _edit.dispose === 'function') _edit.dispose();
    _edit = null;
  });
}

/** The view's single primary action; which slot it lands in depends on the state. */
function _configButton(label) {
  return '<button type="button" class="ds-btn ds-btn--primary" data-dash-config>' + label + '</button>';
}

/**
 * Header action + widget grid. Needs the two slots from index.html; without
 * them (a stub document) it does nothing. A payload without an `available` array,
 * a non-OK answer or a failed fetch all mean "no modules": the document is then the
 * dashboard of a cockpit with no modules installed.
 */
async function _paintWidgetsSection() {
  const grid = document.getElementById('dashboard-widgets');
  const actions = document.getElementById('dashboard-actions');
  if (!grid || !actions) return;
  const seq = ++_paintSeq;
  // A refresh over live widgets keeps them on screen until a new answer is in:
  // a failed fetch must not wipe a working dashboard. Only a first paint (or a
  // grid that holds no live widgets) gets the memo skeleton up front.
  const refreshingLive = _liveGrid && !grid.hidden;
  if (!refreshingLive) {
    teardownWidgets();
    paintFramesFromMemo(grid);
  }

  let payload = null;
  try {
    const res = await fetch('/api/dashboard/layout', { signal: AbortSignal.timeout(5000) });
    if (res.ok) payload = await res.json();
  } catch { payload = null; }
  if (seq !== _paintSeq || _edit) return;
  if (payload === null && refreshingLive) return;
  if (payload === null && _readHasModulesMemo()) {
    // The answer failed but this person has modules: keep the entry cards away and
    // the memos intact (they are cleared only by an OK answer); offer a retry.
    teardownWidgets();
    _liveGrid = false;
    _setEntryCardsVisible(false);
    actions.replaceChildren();
    grid.hidden = false;
    grid.innerHTML = '<div class="ds-card dash-widgets-empty"><div class="ds-card-body"><div class="ds-empty">'
      + '<div class="ds-empty-title">Could not load the dashboard</div>'
      + '<div class="ds-empty-desc">The server did not answer in time. Try again in a moment.</div>'
      + '<button type="button" class="ds-btn ds-btn--secondary" data-dash-retry>Try again</button>'
      + '</div></div></div>';
    const retry = grid.querySelector('[data-dash-retry]');
    if (retry) retry.addEventListener('click', () => { _paintWidgetsSection().catch(() => { /* retry state stays */ }); });
    return;
  }
  // Live widgets are about to be overwritten (new grid, empty state or a
  // hidden grid): run their cleanups now, not at view exit.
  teardownWidgets();
  _liveGrid = false;

  const ok = payload && payload.hasModules === true && Array.isArray(payload.available) && payload.available.length > 0;
  if (!ok) {
    _widgetState = { layout: { items: [] }, available: [] };
  } else {
    const items = payload.layout && Array.isArray(payload.layout.items) ? payload.layout.items : [];
    _widgetState = { layout: { items }, available: payload.available };
  }
  _applyState(grid, actions);
}

/** Paint header action + grid from `_widgetState` (no request). */
function _applyState(grid, actions) {
  teardownWidgets();
  _liveGrid = false;
  const { items } = _widgetState.layout;
  const available = _widgetState.available;
  // The entry cards are the dashboard of a cockpit with no modules; with at
  // least one installed module the rail already carries the same three links.
  _setEntryCardsVisible(available.length === 0);
  _storeHasModulesMemo(available.length > 0);
  if (available.length === 0) {
    actions.replaceChildren();
    grid.hidden = true;
    grid.replaceChildren();
    clearFrameMemo();
    return;
  }
  if (items.length === 0) {
    // The one primary of the view lives in the empty state.
    actions.replaceChildren();
    grid.hidden = false;
    grid.innerHTML = '<div class="ds-card dash-widgets-empty"><div class="ds-card-body"><div class="ds-empty">'
      + '<div class="ds-empty-title">The dashboard is waiting for tiles</div>'
      + '<div class="ds-empty-desc">Choose which tools should show their data as soon as you open Mission Deck.</div>'
      + _configButton('Set up dashboard')
      + '</div></div></div>';
    clearFrameMemo();
    return;
  }
  actions.innerHTML = _configButton('Customize dashboard');
  paintWidgetGrid(grid, items, available, _navigate);
  _liveGrid = true;
}

/** Show or hide #dashboard-cards and swap the subtitle to match. */
function _setEntryCardsVisible(visible) {
  const root = document.getElementById('dashboard-cards');
  if (root) root.hidden = !visible;
  const view = document.getElementById('view-dashboard');
  const sub = view && view.querySelector ? view.querySelector('.page-header .subtitle') : null;
  if (sub) sub.textContent = visible ? SUBTITLE_START : SUBTITLE_WIDGETS;
}

function _readHasModulesMemo() {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(HAS_MODULES_KEY) === '1';
  } catch {
    return false;
  }
}

function _storeHasModulesMemo(has) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (has) localStorage.setItem(HAS_MODULES_KEY, '1');
    else localStorage.removeItem(HAS_MODULES_KEY);
  } catch { /* the memo is optional */ }
}

/**
 * One entry card. Shared by the static three and the Windows one so a change to
 * the markup cannot make the fourth card look like a different component.
 * @param {object} card @returns {HTMLElement}
 */
function _buildCard(card) {
  {
    const el = document.createElement(card.href ? 'a' : 'div');
    el.className = 'placeholder-hub-card';
    if (card.href) {
      el.setAttribute('href', card.href);
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener');
    } else {
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
    }
    el.innerHTML =
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="32" height="32" style="opacity:.55" aria-hidden="true">${card.icon}</svg>`
      + `<div class="placeholder-hub-card__title">${card.title}</div>`
      + `<div class="placeholder-hub-card__desc">${card.desc}</div>`;

    const go = card.hash
      ? () => {
        const viewId = card.hash.replace('#', '');
        if (_navigate) _navigate(viewId);
        else location.hash = card.hash;
      }
      : (card.doc ? () => { _openDoc(card); } : null);

    if (go) {
      el.addEventListener('click', go);
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
      });
    }
    return el;
  }
}

/**
 * True when this cockpit runs on Windows. Pure - unit tested.
 * The value is Node's `process.platform` as reported by the local server, so
 * anything other than the exact string 'win32' is NOT Windows; a missing or
 * unreadable payload answers false, because showing a Windows guide to a Mac
 * user is worse than showing nothing.
 * @param {object|null} versionPayload GET /api/app/version
 * @returns {boolean}
 */
export function isWindows(versionPayload) {
  return !!versionPayload && versionPayload.platform === 'win32';
}

/** Append the Windows card once, if this machine is a Windows machine. */
async function _maybeAddWindowsCard(grid) {
  if (_windowsCardPainted) return;
  // Shared reader: the analytics context asks the same question on boot.
  const payload = await fetchAppVersion();
  if (!isWindows(payload)) return;
  // The grid can have been replaced by a re-render while the fetch was in
  // flight; appending to a detached node would silently paint nothing.
  if (!grid.isConnected) return;
  _windowsCardPainted = true;
  grid.appendChild(_buildCard(WINDOWS_CARD));
}

/** Open a markdown document from the static docs tree in the shared modal. */
async function _openDoc(card) {
  const { openDocModal } = await import('./doc-modal.js');
  openDocModal({
    title: card.title,
    load: async () => {
      const res = await fetch(card.doc, { cache: 'no-store' });
      if (!res.ok) throw new Error('Could not load the document (HTTP ' + res.status + ').');
      return { path: card.doc.replace(/^\//, ''), content: await res.text() };
    },
  });
}
