// ── Mission Deck — js/app.js ──────────────────────────────────────────────
// Boot + router. Owns:
//   - navigate(viewId): hash routing over the static `.view-section` elements,
//     with lazy view modules resolved through js/view-registry.js
//   - the sidebar hub-flyout system (config-driven from js/sidebar-flyout-config.js)
//   - boot wiring: theme, terminal, modules, then (after the first navigate)
//     the top bar and the update banner - see the note at the end of boot()
//
// Deliberately NOT here: any data fetching. Boot wires the shell and hands
// over; a view loads its own data when the router first opens it, which is what
// keeps first paint independent of any endpoint being up.

import { initThemeListener } from './theme.js';
import { closeDsModal } from './ds-modal.js';
import { runActiveViewCleanup } from './view-lifecycle.js';
import { installEmptyStateDelegator } from './empty-state.js';
import { HUB_FLYOUT } from './sidebar-flyout-config.js';
import { getViewEntry, loadViewModule, reloadViewModule, isViewModuleLoaded } from './view-registry.js';
import { trackEvent, setAnalyticsContext, initAnalytics } from './analytics.js';
import { startLoadingAnimation } from './loading-animations.js';
import { initTopbar } from './topbar.js';
import { initUpdateBanner } from './update-banner.js';
import { initUnifiedTerminal, toggleUnifiedTerminal } from './claude-terminal.js';
import { escHtml } from './utils.js';
import { paintRailPlaceholders, clearRailPlaceholders } from './rail-placeholders.js';
import { onDataChanged } from './data-events.js';
import { loadTeamDirectory } from './team-directory.js';

const DEFAULT_VIEW = 'dashboard';

let _activeViewId = null;
// Navigation token. Every navigate() takes a new one before its await, and
// checks it after: a click in the rail while a slow import is in flight used
// to let the OLD navigation finish - init and render into a hidden section,
// timers registered under a view the cleanup registry had already run for,
// so they lived until the person entered and left that view once more.
let _navSeq = 0;
let _lastNavigatedId = null;
let _navSource = null;
let _viewEnteredAt = null;
const _initedViews = new Set();

/** Dependency bag handed to each lazy view's runInit. */
const _viewDeps = { navigate };

/**
 * The markup each view section shipped with, snapshotted on the FIRST
 * navigation into it - before its renderer has ever run. Keyed by base view id.
 * Read by _resetViewDom and written by navigate(); declared HERE, above its
 * first reader, rather than next to the refresh code that owns it - a
 * module-scope `const` is in the temporal dead zone until evaluation reaches
 * it, and "navigate() is never called during module evaluation" is an
 * invariant nobody states and a ReferenceError when it breaks.
 * @type {Map<string, Element>}
 */
const _pristineSections = new Map();

/** True while a refresh is running - a burst of events costs one repaint. */
let _dataRefreshRunning = false;
let _dataRefreshQueued = false;

// ── Navigation helpers ───────────────────────────────────────────────────────

/**
 * Which hub (a HUB_FLYOUT key) lists `viewId` among its flyout items. Flyout
 * sub-views have no rail item of their own, so navigation highlights the parent
 * hub instead.
 * @param {string} viewId
 * @returns {string|null}
 */
function _hubForView(viewId) {
  for (const [hubKey, cfg] of Object.entries(HUB_FLYOUT)) {
    if ((cfg.items || []).some(it => it.view === viewId)) return hubKey;
  }
  return null;
}

/**
 * Human-readable label for a back-link target: the destination's own <h1>,
 * then its sidebar item text, then a generic fallback.
 * @param {string} viewId
 * @returns {string}
 */
function _backViewLabel(viewId) {
  const sec = document.getElementById('view-' + viewId);
  const h1 = sec && sec.querySelector('.page-header h1');
  const h1Txt = h1 && h1.textContent.trim();
  if (h1Txt) return h1Txt;
  const cfg = HUB_FLYOUT[viewId];
  if (cfg && cfg.label) return cfg.label;
  const navEl = document.querySelector(`.sidebar-item[data-view="${viewId}"]`);
  const navTxt = navEl && navEl.textContent.trim();
  if (navTxt) return navTxt;
  return 'Back';
}

/**
 * Transient loading overlay shown while a lazy view module imports.
 * Non-destructive: it animates its own child, so the section's static
 * scaffolding survives for the renderer.
 *
 * Skipped for a section that already ships a loading SKELETON. .lazy-loader-host
 * is a 200px block in normal flow appended to the end of the section, so on
 * those views it would add its own height on top of the reserved boxes and
 * cause exactly the jump the skeleton exists to remove - and two loading
 * indicators for one wait is one too many either way.
 *
 * @param {Element} section
 * @returns {() => void} stop function
 */
function _showLazyLoader(section) {
  // :not(.msb-skel) - the module sync bar (js/module-sync-bar.js) ships its
  // own 48px skeleton on every module view with team data, and without this
  // exclusion its mere presence would silence the loader for the WHOLE view
  // while the module's own file is still importing.
  if (section.querySelector('.ds-skeleton:not(.msb-skel)')) return function () {};
  const host = document.createElement('div');
  host.className = 'lazy-loader-host';
  section.appendChild(host);
  // Minimal mode: the view's own background shows through, so the scene has to
  // fade out at its edges rather than sit on an opaque sky the way the modal does.
  const stopAnim = startLoadingAnimation(host, { minimal: true, label: 'Loading view...' });
  return function () {
    try { stopAnim(); } catch (_e) { /* ignore */ }
    host.remove();
  };
}

// ── navigate ─────────────────────────────────────────────────────────────────

/**
 * Show the section for `viewId`, run its lazy module, and sync the hash.
 * Sub-routes are supported: "settings/keys" shows #view-settings and passes
 * "keys" to the renderer through opts.
 *
 * @param {string} viewId
 * @param {object} [opts]
 * @returns {Promise<void>}
 */
async function navigate(viewId, opts = {}) {
  let baseViewId = viewId;
  let subPath = '';
  const slashIdx = viewId.indexOf('/');
  if (slashIdx > 0) {
    baseViewId = viewId.slice(0, slashIdx);
    subPath = decodeURIComponent(viewId.slice(slashIdx + 1));
  }

  // Hub guard: a HUB_FLYOUT key is a flyout opener, not a page. When the hash
  // targets one and no section exists for it, fall back to the dashboard.
  // Checked FIRST, before any teardown, so the redirect has no side effects.
  if (HUB_FLYOUT[baseViewId] && !document.getElementById('view-' + baseViewId)) {
    return navigate(DEFAULT_VIEW);
  }

  // Tear down timers/listeners registered by the view we are leaving. Must run
  // before showing the new section so cleanup still sees the OLD activeViewId.
  if (_activeViewId !== null) {
    trackEvent('View Exited', {
      view: _activeViewId,
      duration_ms: _viewEnteredAt !== null ? Date.now() - _viewEnteredAt : null,
    });
  }
  runActiveViewCleanup(_activeViewId);

  clearTimeout(flyoutTimer);
  document.querySelectorAll('.modal-overlay.open').forEach(el => el.classList.remove('open'));
  document.querySelectorAll('.ds-modal-overlay.open').forEach(el => closeDsModal(el));
  document.querySelectorAll('body > .ds-modal-overlay:not([id])').forEach(el => el.remove());
  document.body.style.overflow = '';
  document.querySelectorAll('.sidebar-group.flyout-open').forEach(g => g.classList.remove('flyout-open'));
  document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.sidebar-item[data-view]').forEach(el => el.classList.remove('active'));

  const viewTitle = _backViewLabel(baseViewId);
  const hubGroup = _hubForView(baseViewId);
  setAnalyticsContext({ view: viewId, base_view: baseViewId, view_title: viewTitle, hub_group: hubGroup });
  trackEvent('View Viewed', {
    view: viewId,
    base_view: baseViewId,
    sub_path: subPath || null,
    view_title: viewTitle,
    hub_group: hubGroup,
    previous_view: _activeViewId,
    trigger: _navSource || 'programmatic',
  });
  _navSource = null;
  _viewEnteredAt = Date.now();
  _activeViewId = baseViewId;

  const section = document.getElementById('view-' + baseViewId);
  if (section) {
    section.hidden = false;
    section.classList.add('active');
    // First navigation into this view: nothing has painted into the section
    // yet, so this is the one moment its shipped markup can be captured. See
    // _resetViewDom, the only reader.
    if (!_pristineSections.has(baseViewId)) _pristineSections.set(baseViewId, section.cloneNode(true));
  }

  // Back-link policy: only genuinely nested views (those declaring a
  // non-dashboard data-back-view) get a back button. Re-injected idempotently.
  if (section) {
    const ph = section.querySelector('.page-header');
    const backView = section.dataset.backView;
    const existing = ph && ph.querySelector('.back-to-dash');
    if (ph && backView && backView !== DEFAULT_VIEW) {
      if (!existing || existing.dataset.backView !== backView) {
        if (existing) existing.remove();
        const btn = document.createElement('button');
        btn.className = 'back-to-dash';
        btn.dataset.backView = backView;
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>';
        btn.appendChild(document.createTextNode(_backViewLabel(backView)));
        btn.addEventListener('click', () => navigate(backView));
        const titleDiv = ph.querySelector('.page-header-row > div:first-child') || ph;
        titleDiv.prepend(btn);
      }
    } else if (existing) {
      existing.remove();
    }
  }

  // Rail highlight: the view's own item, else its parent hub's item.
  const navItem = document.querySelector(`.sidebar-item[data-view="${baseViewId}"]`)
    || (hubGroup ? document.querySelector(`.sidebar-item[data-view="${hubGroup}"]`) : null);
  if (navItem) navItem.classList.add('active');

  // Set synchronously (before any await) so the hashchange guard is unaffected
  // by however long the lazy import takes.
  _lastNavigatedId = viewId;
  if (location.hash.replace(/^#/, '') !== viewId) {
    location.hash = viewId;
  }

  const entry = getViewEntry(baseViewId);
  if (!entry) return;

  const stopLoader = section ? _showLazyLoader(section) : function () {};
  const myNav = ++_navSeq;
  let mod = null;
  let importError = null;
  try {
    mod = await loadViewModule(baseViewId, 'navigation');
  } catch (e) {
    importError = e;
    console.error('[' + baseViewId + '] lazy load error:', e);
    trackEvent('View Render Failed', { view: baseViewId, phase: 'import', message: String((e && e.message) || e) });
  }
  // Remove the loader BEFORE rendering so static child containers are intact.
  stopLoader();
  // Somebody navigated on while the import was in flight: that navigation
  // owns the screen now, and this one must not init or paint anything.
  if (myNav !== _navSeq) return;
  if (!mod) {
    _paintImportFailure(section, viewId, baseViewId, importError);
    return;
  }

  if (!_initedViews.has(baseViewId)) {
    _initedViews.add(baseViewId);
    try { entry.runInit(mod, _viewDeps); } catch (ie) {
      console.error('[' + baseViewId + '] init error:', ie);
      trackEvent('View Render Failed', { view: baseViewId, phase: 'init', message: String((ie && ie.message) || ie) });
    }
  }
  if (entry.render && typeof mod[entry.render] === 'function') {
    try { await mod[entry.render](subPath, opts); } catch (re) {
      console.error('[' + baseViewId + '] render error:', re);
      trackEvent('View Render Failed', { view: baseViewId, phase: 'render', message: String((re && re.message) || re) });
    }
  }
}

/**
 * What a person sees when a view's module cannot be imported - which, for a
 * module somebody is writing right now, is a syntax error in their own file.
 * It used to be a bare header over an empty section and a line in the console
 * nobody had open, with no way to try again: the hashchange guard ignores the
 * hash the page already has. One callout, the error text, one button.
 * @param {Element|null} section
 * @param {string} viewId full id with sub-path
 * @param {string} baseViewId
 * @param {unknown} err
 */
function _paintImportFailure(section, viewId, baseViewId, err) {
  if (!section) return;
  section.querySelectorAll('.view-import-failed').forEach(el => el.remove());
  const host = section.querySelector('.view-data') || section;
  const entry = getViewEntry(baseViewId);
  const msg = String((err && err.message) || err || '').slice(0, 300);
  const box = document.createElement('div');
  box.className = 'ds-callout ds-callout--danger view-import-failed';
  box.setAttribute('role', 'alert');
  box.style.margin = '12px 0';
  box.innerHTML =
    '<div style="flex:1 1 auto">'
    + '<strong>Could not load this view.</strong>'
    + (msg ? ' <span class="view-import-failed-msg">' + escHtml(msg) + '</span>' : '')
    + (entry && entry.moduleId
      ? ' Details are in the browser console (F12). If it is a syntax error in a module, fix the file and reload the page.'
      : ' Check that the server is running and try again.')
    + '</div>'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-act="retry">Try again</button>';
  box.querySelector('[data-act="retry"]').addEventListener('click', async () => {
    box.remove();
    // A module's entry can be re-imported under a fresh URL, which is the
    // only way past the browser's memory of a module that failed to parse; a
    // core view keeps its instance and a plain retry covers the network case.
    if (entry && entry.moduleId) {
      try { await reloadViewModule(baseViewId, 'retry'); } catch { /* navigate() reports it */ }
    }
    navigate(viewId);
  });
  host.appendChild(box);
}

// ── Live refresh after a sync ────────────────────────────────────────────────
// A pull, a decrypt or a discarded local change rewrites the team data under a
// page that is already painted, and the sync modal sits ON TOP of that page -
// so before this the only way to see the new data was F5 with the modal still
// open. js/data-events.js announces the change; the router is the one place
// that knows which view is on screen, so the refresh belongs here and NOT in
// each view. Nothing opts in: a view or a module written tomorrow gets this
// without a line of its own.
//
// Two paths, and the CHEAP one is the exception:
//
//   - A core view is audited in this repository, so the core knows whether its
//     renderer fetches what it paints. Most do (the wizard re-runs its five
//     probes on every render), so a repaint is enough and keeps the view's
//     scroll and open tab. The one that paints from a module-level cache says
//     so with `refresh` in js/view-registry.js.
//
//   - An installed module is somebody else's code, gitignored and never read
//     here, so the core cannot know what it cached - and asking module authors
//     to remember a hook means the views that forget it stay stale, which is
//     exactly the bug this fixes. Those views are RE-ENTERED instead: the
//     outgoing instance's cleanup runs, its document is stripped of every listener
//     it bound, the module file is re-imported as a fresh instance
//     (reloadViewModule) and init plus render run again. That is what an F5
//     did for the view, minus the page. It costs the view's transient state
//     (scroll, filters, an open modal), so a module that would rather keep it
//     may export onDataChanged() and refresh itself - an OPT-OUT of the
//     reload, never a prerequisite for being refreshed at all.
//
// Never a re-init WITHOUT a reload: init runs once per session by contract
// (_initedViews below, and js/module-host.js hands a module its deps exactly
// once), so re-running it against the SAME instance would re-register
// listeners the cleanup registry has already consumed. The reload path is
// allowed to re-init precisely because the instance behind it is new.

/**
 * Put a view's section back to the state the shell shipped: the static markup
 * from index.html (or, for a module view, the section js/module-host.js built),
 * with no listener and no runtime state on it.
 *
 * A deep clone of the CURRENT section is not good enough, and the reason is
 * worth keeping: cloneNode copies attributes, and the common way to make a
 * delegated listener idempotent is a marker attribute on the container
 * (`root.dataset.sklWired === '1'` in one installed module). The clone carries
 * the marker but not the listener, so the incoming instance sees "already
 * wired" and binds nothing - the view repaints and then answers no clicks.
 * Restoring the pristine copy has neither.
 *
 * @param {string} baseViewId
 */
function _resetViewDom(baseViewId) {
  const section = document.getElementById('view-' + baseViewId);
  if (!section || !section.parentNode) return;
  const pristine = _pristineSections.get(baseViewId);
  // The snapshot is cloned rather than inserted, so it survives every reload.
  section.replaceWith(pristine ? pristine.cloneNode(true) : section.cloneNode(true));
}

/**
 * Re-fetch and repaint the view the person is looking at.
 * @returns {Promise<void>}
 */
async function refreshActiveView() {
  if (_dataRefreshRunning) { _dataRefreshQueued = true; return; }
  _dataRefreshRunning = true;
  try {
    do {
      _dataRefreshQueued = false;
      // Same token navigate() uses: a navigation during any await below owns
      // the screen, and this pass must not init or paint into its section.
      const navAtStart = _navSeq;

      // One shared cache rather than a per-view fetch: the roster and the
      // photos live in the data repo too, and every view that shows a face
      // reads them through this module. Refreshed BEFORE the repaint so the
      // view paints against the new roster, not the one from before the pull.
      try { await loadTeamDirectory(true); } catch { /* empty directory is a valid state */ }
      if (navAtStart !== _navSeq) continue;

      const baseViewId = _activeViewId;
      const entry = baseViewId ? getViewEntry(baseViewId) : null;
      // Not inited yet means nothing has been painted from the old data.
      if (!entry || !_initedViews.has(baseViewId) || !isViewModuleLoaded(baseViewId)) continue;

      // The same two arguments navigate() hands a renderer: the sub-route it is
      // showing, and its options bag - `{}` here because navigate() defaults
      // `opts` to `{}` too, so a refreshed view sees exactly what a navigated
      // one does and never a shape it was not written for.
      const full = _lastNavigatedId || baseViewId;
      const slashIdx = full.indexOf('/');
      const subPath = slashIdx > 0 ? decodeURIComponent(full.slice(slashIdx + 1)) : '';

      // A CORE view: repaint it. `refresh` when it declared one, its renderer
      // otherwise - both are audited in this repository.
      if (!entry.moduleId) {
        const mod = await loadViewModule(baseViewId, 'data-refresh').catch(() => null);
        if (navAtStart !== _navSeq) continue;
        const hook = mod && entry.refresh && typeof mod[entry.refresh] === 'function'
          ? entry.refresh : entry.render;
        if (!mod || typeof mod[hook] !== 'function') continue;
        try { await mod[hook](subPath, {}); } catch (e) {
          console.error('[' + baseViewId + '] data refresh error:', e);
        }
        continue;
      }

      // A MODULE view. The reload below is the default and needs nothing from
      // the module, but it resets the view's transient state, so a module that
      // exports onDataChanged() gets to keep it and refresh itself. The
      // adapter says whether it actually handled it; anything else - no hook,
      // a throw - falls through to the reload, because a stale view is the
      // worse of the two outcomes.
      const loaded = await loadViewModule(baseViewId, 'data-refresh').catch(() => null);
      if (navAtStart !== _navSeq) continue;
      if (loaded && entry.dataHook && typeof loaded[entry.dataHook] === 'function') {
        let handled = false;
        try { handled = await loaded[entry.dataHook](); } catch (e) {
          console.error('[' + baseViewId + '] onDataChanged error, reloading instead:', e);
        }
        if (handled) continue;
      }

      // The generic path. Order matters: cleanup first (it must still see the
      // document the old instance built), then the document, then the fresh import.
      runActiveViewCleanup(baseViewId);
      _resetViewDom(baseViewId);
      _initedViews.delete(baseViewId);
      let mod = null;
      try { mod = await reloadViewModule(baseViewId, 'data-refresh'); } catch (e) {
        console.error('[' + baseViewId + '] data reload error:', e);
      }
      // A navigation back into this very view during the reload has already
      // inited the fresh instance; a navigation elsewhere owns the screen.
      if (!mod || navAtStart !== _navSeq || _initedViews.has(baseViewId)) continue;
      _initedViews.add(baseViewId);
      try { entry.runInit(mod, _viewDeps); } catch (e) {
        console.error('[' + baseViewId + '] data reload init error:', e);
      }
      if (typeof mod[entry.render] === 'function') {
        try { await mod[entry.render](subPath, {}); } catch (e) {
          console.error('[' + baseViewId + '] data reload render error:', e);
        }
      }
    } while (_dataRefreshQueued);
  } finally {
    _dataRefreshRunning = false;
  }
}

onDataChanged(() => { refreshActiveView(); });

// ── Static nav wiring ────────────────────────────────────────────────────────

// This loop handles non-sidebar [data-view] elements (e.g. dashboard cards).
// Sidebar items are bound by bindSidebarItem() below — this loop runs at
// module-evaluation time (before boot) when dynamically added module items do
// not yet exist in the DOM.
document.querySelectorAll('[data-view]:not(.sidebar-item)').forEach(el => {
  el.addEventListener('click', function (e) {
    e.preventDefault();
    _navSource = 'sidebar';
    navigate(this.dataset.view);
  });
});

// Dynamically rendered links use href="#viewId" — pick those up via hashchange.
// Guarded so navigate()'s own hash assignment does not re-enter.
window.addEventListener('hashchange', function () {
  const id = location.hash.replace('#', '');
  if (!id || id === _lastNavigatedId) return;
  _navSource = 'hash';
  const baseId = id.split('/')[0];
  // Hub keys still go through navigate() so its hub guard can redirect them to
  // the dashboard instead of leaving a blank content area.
  if (document.getElementById('view-' + baseId) || HUB_FLYOUT[baseId]) navigate(id);
});

// ── Sidebar hub flyout ───────────────────────────────────────────────────────
// Top-level `.sidebar-item` elements whose data-view matches a HUB_FLYOUT key
// open a dynamically-built panel on hover and suppress navigation on click.

let flyoutTimer = null;
let _hubFlyoutEl = null;
let _hubFlyoutActiveItem = null;
let _lastMousePos = { x: 0, y: 0 };
let _aimCheckTimer = null;

const _sidebarEl = document.getElementById('sidebar');
if (_sidebarEl) {
  _sidebarEl.addEventListener('mousemove', e => {
    _lastMousePos = { x: e.clientX, y: e.clientY };
  });
}

/**
 * Safe triangle: true when the cursor is heading INTO the open flyout, so
 * hovering a neighbouring rail item does not yank the panel away mid-travel.
 * @param {{x: number, y: number}} pos
 * @returns {boolean}
 */
function _isAimingAtFlyout(pos) {
  if (!_hubFlyoutEl || _hubFlyoutEl.style.display === 'none') return false;
  const rect = _hubFlyoutEl.getBoundingClientRect();
  if (pos.x >= rect.left) return false;
  const dx = rect.left - pos.x;
  if (dx <= 0) return false;
  const slopeTop = (rect.top - pos.y) / dx;
  const slopeBot = (rect.bottom - pos.y) / dx;
  return slopeTop < slopeBot;
}

function _ensureHubFlyoutEl() {
  if (_hubFlyoutEl) return _hubFlyoutEl;
  const el = document.createElement('div');
  el.className = 'sidebar-group-body sidebar-hub-flyout';
  el.style.display = 'none';
  el.style.position = 'fixed';
  el.style.zIndex = '200';
  document.body.appendChild(el);
  el.addEventListener('mouseenter', () => { clearTimeout(flyoutTimer); clearTimeout(_aimCheckTimer); });
  el.addEventListener('mouseleave', () => _scheduleHubFlyoutClose());
  _hubFlyoutEl = el;
  return el;
}

function _closeHubFlyout() {
  if (!_hubFlyoutEl) return;
  _hubFlyoutEl.style.display = 'none';
  _hubFlyoutEl.style.left = '-9999px';
  _hubFlyoutActiveItem = null;
}

function _scheduleHubFlyoutClose() {
  clearTimeout(_aimCheckTimer);
  flyoutTimer = setTimeout(_closeHubFlyout, 120);
}

/**
 * Build and position the flyout panel for one hub.
 * @param {Element} item the rail item the panel is anchored to
 * @param {string} hubView HUB_FLYOUT key
 * @param {object} config HUB_FLYOUT entry
 */
function _openHubFlyout(item, hubView, config) {
  clearTimeout(flyoutTimer);
  clearTimeout(_aimCheckTimer);
  document.querySelectorAll('.sidebar-group.flyout-open').forEach(g => g.classList.remove('flyout-open'));

  const panel = _ensureHubFlyoutEl();
  const rows = config.items || [];

  // The hub itself comes from js/core-hubs.mjs, but every ITEM under it can
  // have been written at boot by js/module-host.js out of an installed
  // module's module.json - so `rows` carries untrusted text and is escaped
  // before reaching innerHTML.
  // An EMPTY hub still opens. Seven of the eight core hubs (js/core-hubs.mjs)
  // ship with no pages and wait for a module to add them, and the early return
  // that used to close the panel here meant clicking those did literally
  // nothing - no panel, no reason, indistinguishable from a broken rail item.
  panel.innerHTML = `<div class="sidebar-flyout-label">${escHtml(config.label)}</div>`
    + (rows.length === 0
      ? '<div class="sidebar-flyout-empty">Nothing here yet. Pages in this hub '
        + 'are added by modules - see Settings &gt; Modules.</div>'
      : '')
    + rows.map(sub =>
      sub.separator
        ? '<hr class="flyout-separator">'
        : `<a class="sidebar-hub-flyout-item" data-flyout-view="${escHtml(sub.view)}" data-flyout-hub="${escHtml(hubView)}" href="#${escHtml(sub.view)}">`
          + `${escHtml(sub.label)}${sub.badge ? `<span class="ds-badge ds-badge--sm ds-badge--yellow flyout-badge">${escHtml(sub.badge)}</span>` : ''}</a>`
    ).join('');

  const sidebar = document.getElementById('sidebar');
  const topbarHeight = 44;
  const sidebarWidth = sidebar ? sidebar.getBoundingClientRect().right : 72;
  panel.style.left = sidebarWidth + 'px';
  panel.style.top = topbarHeight + 'px';
  panel.style.height = 'calc(100vh - 44px)';
  panel.style.width = '280px';
  panel.style.display = 'block';

  _hubFlyoutActiveItem = item;
  trackEvent('Hub Flyout Opened', { hub: hubView, items_visible: rows.length });
}

// Delegate clicks on the dynamically-built flyout sub-items.
document.addEventListener('click', e => {
  const flyoutItem = e.target.closest('.sidebar-hub-flyout-item');
  if (!flyoutItem) return;
  e.preventDefault();
  e.stopPropagation();
  const view = flyoutItem.dataset.flyoutView;
  if (!view) return;
  trackEvent('Hub Flyout Item Clicked', { hub: flyoutItem.dataset.flyoutHub, view });
  _closeHubFlyout();
  _navSource = 'flyout';
  navigate(view);
});

/**
 * Bind click, flyout, and tooltip events on a single sidebar rail item.
 * Called once for each static item at module-evaluation time, and again for
 * each dynamically injected module item at boot.
 *
 * IMPORTANT: HUB_FLYOUT[view] must be populated BEFORE this is called for hub
 * items, because the function reads it synchronously.
 *
 * @param {Element} item
 */
function bindSidebarItem(item) {
  const view = item.dataset.view;
  const config = HUB_FLYOUT[view];
  if (config) {
    // Hub item: open flyout on hover/click, suppress plain navigation.
    item.addEventListener('mouseenter', () => {
      clearTimeout(flyoutTimer);
      clearTimeout(_aimCheckTimer);
      if (_hubFlyoutActiveItem && _hubFlyoutActiveItem !== item && _isAimingAtFlyout(_lastMousePos)) {
        _aimCheckTimer = setTimeout(() => _openHubFlyout(item, view, config), 300);
        return;
      }
      _openHubFlyout(item, view, config);
    });
    item.addEventListener('mouseleave', _scheduleHubFlyoutClose);
    item.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      clearTimeout(flyoutTimer);
      clearTimeout(_aimCheckTimer);
      _openHubFlyout(item, view, config);
    });
  } else {
    // Plain item: click navigates directly.
    item.addEventListener('click', e => {
      e.preventDefault();
      _navSource = 'sidebar';
      navigate(view);
    });
  }
  // Tooltip for a PLAIN item in the collapsed rail only. A hub gets none: the
  // same hover opens its flyout, whose first line is the hub's name, so the
  // tooltip only ever covered the panel it duplicated - and on the seven core
  // hubs that ship empty it landed on top of the one sentence in there.
  const label = item.querySelector('.nav-label');
  const text = label && label.textContent.trim();
  if (text && !config) {
    item.addEventListener('mouseenter', () => _showSidebarTooltip(item, text));
    item.addEventListener('mouseleave', _hideSidebarTooltip);
  }
}

// Close the flyout when clicking outside the sidebar.
document.addEventListener('click', e => {
  if (!e.target.closest('.sidebar-item') && !e.target.closest('.sidebar-hub-flyout')) {
    clearTimeout(flyoutTimer);
    clearTimeout(_aimCheckTimer);
    _closeHubFlyout();
  }
});

// ── Sidebar icon tooltips ────────────────────────────────────────────────────

const _sidebarTooltipEl = document.createElement('div');
_sidebarTooltipEl.id = 'sidebar-tooltip';
document.body.appendChild(_sidebarTooltipEl);

let _tooltipTimer = null;

function _showSidebarTooltip(el, text) {
  // Only useful in the collapsed icon rail; when expanded the labels are
  // visible and the tooltip would overlap the hub flyout.
  const sb = document.getElementById('sidebar');
  if (sb && !sb.classList.contains('collapsed')) return;
  // A hub item that just opened its flyout already names itself in the panel
  // header, and the tooltip would render on top of the panel's first row.
  if (_hubFlyoutActiveItem === el) return;
  clearTimeout(_tooltipTimer);
  const rect = el.getBoundingClientRect();
  _sidebarTooltipEl.textContent = text;
  _sidebarTooltipEl.style.left = (rect.right + 10) + 'px';
  _sidebarTooltipEl.style.top = (rect.top + rect.height / 2) + 'px';
  _tooltipTimer = setTimeout(() => { _sidebarTooltipEl.style.opacity = '1'; }, 450);
}

function _hideSidebarTooltip() {
  clearTimeout(_tooltipTimer);
  _sidebarTooltipEl.style.opacity = '0';
}

// Bind tooltip and navigation/flyout for all static sidebar items. Module
// items added at boot call bindSidebarItem() individually via module-host.js.
document.querySelectorAll('.sidebar-item[data-view]').forEach(bindSidebarItem);

// Reserve a row per module rail item this browser saw last time, so the pinned
// bottom group does not drop 44px per module when the manifest lands. Here and
// not in js/module-host.js: that module is dynamically imported inside boot(),
// and on a cold load its own import is most of the wait. Dropped again by
// clearRailPlaceholders() on every exit of initModuleHost().
paintRailPlaceholders();

// ── Boot ─────────────────────────────────────────────────────────────────────

// Wires the terminal panel's own header controls (the panel itself stays
// hidden until opened) and the Ctrl+` shortcut. The visible entry point is the
// top bar's "Terminal" pill — see _renderTerminalButton in js/topbar.js.
function _initTerminalToggle() {
  initUnifiedTerminal();
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === '`') {
      e.preventDefault();
      toggleUnifiedTerminal();
    }
  });
}

async function boot() {
  // First: the pre-init buffer in js/theme-boot.js is already collecting, and
  // the boot navigate() below fires "View Viewed" in this same synchronous
  // tick. initAnalytics() returns immediately -- the SDK handshake happens
  // behind the buffer, which is drained once the transport is live.
  initAnalytics();
  initThemeListener();
  installEmptyStateDelegator();
  _initTerminalToggle();

  // Dynamic import avoids a static circular dependency: module-host.js imports
  // navigate and bindSidebarItem from this file, so this file must NOT import
  // module-host.js statically. A failing fetch inside initModuleHost() is
  // caught there and must never block boot.
  try {
    const { initModuleHost } = await import('./module-host.js');
    await initModuleHost();
  } catch (e) {
    console.warn('[module-host] boot error:', e && e.message);
  } finally {
    // The IMPORT itself is an exit initModuleHost() cannot cover - a stale
    // cached bundle after a deploy, an offline tab - and the placeholders were
    // painted before it, at module-evaluation time. Without this they would
    // pulse in the rail for the whole session. Idempotent, so the normal path
    // (where the loader already cleared them) costs nothing.
    clearRailPlaceholders();
  }

  const initial = location.hash.replace('#', '') || DEFAULT_VIEW;
  const baseId = initial.split('/')[0];
  if (document.getElementById('view-' + baseId) || HUB_FLYOUT[baseId]) navigate(initial);
  else navigate(DEFAULT_VIEW);

  // The top bar and the update banner come AFTER the module host and the
  // first navigate() on purpose. Between them they start about a dozen
  // requests (whoami, sync-overview, the MR and activity chips, the vault
  // status, the stash list, check-update, modules/updates - the last two ask
  // GitLab and take seconds), and a browser has six HTTP/1.1 sockets per
  // host: started first, they made js/module-host.js, the manifest and the
  // first view's own module wait in the queue behind them (measured: 1.5 s of
  // queueing on a warm cache). Every slot up there ships a skeleton in
  // index.html, so nothing jumps for starting them a tick later; and the
  // update banner's row is reserved from localStorage before any of this
  // runs (js/theme-boot.js), so its check can wait for an idle moment - an
  // update that sits un-applied is announced a second later, not never.
  initTopbar();
  const _deferBanner = () => initUpdateBanner();
  if (typeof requestIdleCallback === 'function') requestIdleCallback(_deferBanner, { timeout: 3000 });
  else setTimeout(_deferBanner, 1500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

export { navigate, bindSidebarItem };
