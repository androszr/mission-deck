// ── Mission Deck — js/module-host.js ──────────────────────────────────────
// Client-side module loader. Called once in boot() via dynamic import so that
// this file can import navigate and bindSidebarItem from app.js without
// creating a static circular dependency (app.js -> module-host.js -> app.js).
//
// Flow:
//   1. Fetch GET /api/modules/manifest (5 s timeout, failure is non-fatal).
//   2. For each module: inject sidebar item, register VIEW_REGISTRY entries,
//      create view sections, optionally add HUB_FLYOUT entry.
//   3. Call bindSidebarItem() so the newly added rail items are interactive.

import { HUB_FLYOUT } from './sidebar-flyout-config.js';
import { VIEW_REGISTRY } from './view-registry.js';
import { navigate, bindSidebarItem } from './app.js';
import { showToast } from './toast.js';
import { registerViewCleanup } from './view-lifecycle.js';
import { escHtml } from './utils.js';
import { clearRailPlaceholders, storeRailCount } from './rail-placeholders.js';
// The one item-vs-hub predicate. Imported rather than repeated here: the card in
// Settings > Modules describes the shape this loader builds, so a second copy of
// the rule is a card promising a flyout the sidebar does not make.
import { isHubShape } from './module-card.mjs';
import { moduleIconPath } from './module-card.mjs';
// The read-only sync status bar for a module view with team data. Painted
// from both view-lifecycle adapters below, never from a listener of its own.
import { paintModuleSyncBar, bindModuleSyncBarClicks } from './module-sync-bar.js';

// IDs that must never be used by a module — they map to existing page sections
// or are reserved by the core router. Hub ids are in HUB_FLYOUT rather than
// here: a view id equal to a hub id is caught by the same check below, because
// _isViewIdOccupied() consults HUB_FLYOUT too.
const CORE_RESERVED_IDS = new Set([
  'dashboard', 'settings', 'onboarding-wizard', 'academy',
]);

/**
 * Check whether a view id is already occupied (in VIEW_REGISTRY or as a
 * #view-* page element). Logs a warning and returns true when occupied.
 * @param {string} viewId
 * @returns {boolean}
 */
function _isViewIdOccupied(viewId) {
  if (CORE_RESERVED_IDS.has(viewId)) {
    console.warn('[module-host] view id "' + viewId + '" is reserved by core — skipping');
    return true;
  }
  if (HUB_FLYOUT[viewId]) {
    // A view under a hub's own id would win the hash route and the rail item
    // would open a page instead of its flyout.
    console.warn('[module-host] view id "' + viewId + '" is a core hub — skipping');
    return true;
  }
  if (VIEW_REGISTRY[viewId]) {
    console.warn('[module-host] view id "' + viewId + '" already in VIEW_REGISTRY — skipping');
    return true;
  }
  if (document.getElementById('view-' + viewId)) {
    console.warn('[module-host] #view-' + viewId + ' already exists in the page — skipping');
    return true;
  }
  return false;
}

/**
 * Create a view section page element for a module view.
 * @param {string} viewId
 * @param {object} view manifest view entry
 * @param {{moduleId?: string, hasDataRepos?: boolean}} [opts] `hasDataRepos`
 *   inserts the read-only sync status bar (js/module-sync-bar.js) as a
 *   SIBLING between the header and `.view-data` - never inside it, so a
 *   module's own `innerHTML =` can never wipe the bar.
 * @returns {HTMLElement}
 */
function _createViewSection(viewId, view, { moduleId, hasDataRepos } = {}) {
  const sec = document.createElement('div');
  sec.className = 'view-section';
  sec.id = 'view-' + viewId;
  // Every value below comes from the module's own module.json - untrusted input
  // as far as the host is concerned - so it is escaped before it reaches
  // innerHTML. validateModuleManifest() in server.js rejects a view id that is
  // not a slug, but the host escapes anyway: a module directory can be dropped
  // on disk by hand and the client must not depend on the loader having run.
  const title = escHtml(view.title || view.label || viewId);
  const subtitle = escHtml(view.subtitle || '');
  // Action slot: the view's own header buttons live here, never scattered
  // into the content below - a sibling of `.view-data`, same as the sync
  // status bar just below it, so the module paints it in EVERY render(), not
  // only on mount (a re-entry after `cockpit:data-changed` rebuilds this
  // whole section from scratch and hands the module a fresh, listener-free
  // slot - see js/data-events.js). The module wires its own click listener
  // on the slot element itself, since a delegated listener on
  // `#<viewId>-root` alone never sees clicks here.
  const actionsSlot = '<div class="page-header-actions" id="' + escHtml(viewId) + '-actions"></div>';
  const syncBar = hasDataRepos
    ? '<div class="ds-callout ds-callout--neutral msb-bar" id="msb-' + escHtml(viewId) + '"'
      + ' data-msb-module="' + escHtml(moduleId) + '" role="status" aria-live="polite">'
      + '<span class="ds-skeleton msb-skel" data-skel="1" aria-hidden="true"></span></div>'
    : '';
  sec.innerHTML =
    '<div class="page-header"><div class="page-header-row"><div>'
    + '<h1>' + title + '</h1>'
    + (subtitle ? '<div class="subtitle">' + subtitle + '</div>' : '')
    + '</div>'
    + actionsSlot
    + '</div></div>'
    + syncBar
    + '<div class="view-data" id="' + escHtml(viewId) + '-root"></div>';
  return sec;
}

/**
 * Registry key carrying the render adapter. `navigate()` in js/app.js resolves a
 * view by calling `mod[entry.render](subPath, opts)`, so the loaded module has
 * to expose a function under this name.
 */
const MODULE_RENDER_KEY = 'moduleRender';

/**
 * Registry key carrying the OPT-OUT hook for a data refresh. The core's default
 * for a module view is a full re-entry (see refreshActiveView in js/app.js),
 * which needs nothing from the module but resets its transient state - scroll,
 * filters, an open modal. A module that would rather keep that state exports
 * `onDataChanged()` on its view object and refreshes itself.
 *
 * The adapter returns TRUE when the module handled it and FALSE when it did
 * not, so "no hook" falls through to the reload instead of silently painting
 * nothing. A hook that throws also falls through - the stale view is the worse
 * outcome of the two.
 */
const MODULE_DATA_HOOK_KEY = 'moduleDataHook';

/**
 * Register a view in VIEW_REGISTRY, delegating render/init to the module's
 * views map (resolved lazily at first navigation).
 *
 * `importFn` resolves to a PLAIN WRAPPER OBJECT, never the raw module
 * namespace: an ES module namespace is non-extensible, so attaching the render
 * adapter to it throws a TypeError. js/view-registry.js caches whatever the
 * thunk resolves to, so the wrapper is built once per view - and once more per
 * reload, which is what makes a re-imported module reach `view` at all: the
 * wrapper closes over the OLD namespace, so reusing it would run the new file
 * and paint from the old one.
 *
 * @param {string} viewId
 * @param {string} moduleId
 * @param {boolean} [hasDataRepos] when true, paint the sync bar (fire-and-
 *   forget - a slow status must never delay the module's own paint) after
 *   every render AND every accepted data-hook call, so navigation, reload
 *   and the opt-out path all keep the bar honest with one code path.
 */
function _registerView(viewId, moduleId, hasDataRepos) {
  /** The dependency bag a module view receives, scoped to this view. */
  const makeDeps = () => ({
    navigate,
    registerViewCleanup: (cb) => registerViewCleanup(viewId, cb),
    showToast,
    apiBase: '/api/m/' + moduleId,
  });

  VIEW_REGISTRY[viewId] = {
    importFn: async (bust) => {
      const ns = await import('/modules/' + moduleId + '/client/index.js' + bust);
      const view = (ns && ns.views && ns.views[viewId]) || null;
      if (!view) {
        console.warn('[module-host] module "' + moduleId + '" exports no view "' + viewId + '"');
      }
      return {
        view,
        moduleInit: (deps) => {
          if (view && typeof view.init === 'function') view.init(deps);
        },
        [MODULE_RENDER_KEY]: async (subPath, opts) => {
          if (view && typeof view.render === 'function') await view.render(subPath, opts);
          if (hasDataRepos) paintModuleSyncBar(viewId, moduleId);
        },
        [MODULE_DATA_HOOK_KEY]: async () => {
          if (!view || typeof view.onDataChanged !== 'function') return false;
          await view.onDataChanged();
          if (hasDataRepos) paintModuleSyncBar(viewId, moduleId);
          return true;
        },
      };
    },
    render: MODULE_RENDER_KEY,
    dataHook: MODULE_DATA_HOOK_KEY,
    // js/app.js hands over its own deps bag ({ navigate }); a module view needs
    // the richer one, so the wrapper builds it here rather than using that.
    runInit: (mod) => { if (mod) mod.moduleInit(makeDeps()); },
    // Marks the entry RELOADABLE for js/view-registry.js: after a data sync the
    // core re-imports this file rather than trusting a repaint, because a
    // module's own cache lives in a scope nothing here can reach. A module
    // author writes NOTHING for this - see refreshActiveView() in js/app.js.
    moduleId,
  };
}

/**
 * Main entry point — called once from boot() in js/app.js.
 * @returns {Promise<void>}
 */
export async function initModuleHost() {
  // The rail placeholders these three exits drop were painted by js/app.js at
  // module-evaluation time, not here: this module is reached through a dynamic
  // import, so by the time it runs the wait it would be covering is over.
  const sidebarNav = document.querySelector('.sidebar-nav');
  const spacer = sidebarNav && sidebarNav.querySelector('.sidebar-spacer');

  let data;
  try {
    const res = await fetch('/api/modules/manifest', { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      console.warn('[module-host] manifest fetch failed:', res.status);
      clearRailPlaceholders();
      return;
    }
    data = await res.json();
  } catch (e) {
    console.warn('[module-host] manifest unavailable:', e && e.message);
    clearRailPlaceholders();
    return;
  }

  const modules = Array.isArray(data.modules) ? data.modules : [];
  // Dropped before the first real item is inserted, so a rail item never lands
  // below a placeholder. The count is stored from what the manifest actually
  // yields, not from modules.length - a module the loader skips has no row.
  clearRailPlaceholders();
  if (modules.length === 0) { storeRailCount(0); return; }

  // Bound once, before any view section exists, so the delegated listener is
  // ready for the first click regardless of which module's bar gets there
  // first. App-lifetime - see js/module-sync-bar.js.
  bindModuleSyncBarClicks();

  let railItemsAdded = 0;

  for (const m of modules) {
    const { id: moduleId, manifest } = m;
    if (!manifest || !manifest.sidebar || !Array.isArray(manifest.views) || manifest.views.length === 0) {
      console.warn('[module-host] module "' + moduleId + '" has invalid manifest structure — skipping');
      continue;
    }

    const { sidebar, views } = manifest;
    const isHub = isHubShape(manifest);
    const firstViewId = views[0].id;
    // Whether this module's views get the read-only sync status bar: any
    // declared, non-empty dataRepos entry means the module reads team data
    // the person may want a freshness answer for (a pure reader declares
    // entries with access: 'read'). The manifest alone decides.
    const hasDataRepos = Array.isArray(manifest.dataRepos) && manifest.dataRepos.length > 0;

    // The shape that adds PAGES to a core hub instead of a rail item of its
    // own. An unknown hub is NOT quietly turned back into a rail item: the
    // whole point of moving hubs into the core is that a module does not put
    // items in the rail, and a typo is exactly when that rule would be broken
    // invisibly. The views are still registered below, so the module stays
    // reachable by hash and its Modules card still describes it - only the menu
    // entry is missing, which is what the warning is for. server.js refuses
    // such a manifest at install time; this branch covers a directory dropped
    // on disk by hand.
    const hubTarget = sidebar.kind === 'page' ? sidebar.hub : null;
    const isPage = typeof hubTarget === 'string' && !!HUB_FLYOUT[hubTarget];
    if (sidebar.kind === 'page' && !isPage) {
      console.warn('[module-host] module "' + moduleId + '" targets hub "' + hubTarget
        + '", which is not a core hub — no menu entry');
    }

    // Check all view ids for conflicts before doing any work.
    const allOk = views.every(v => !_isViewIdOccupied(v.id));
    if (!allOk) continue;

    // Inject stylesheet if declared.
    if (manifest.client && manifest.client.style) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/modules/' + moduleId + '/client/' + manifest.client.style.replace(/^client\//, '');
      document.head.appendChild(link);
    }

    // Create view sections and register in VIEW_REGISTRY.
    const mainEl = document.querySelector('main.main');
    for (const view of views) {
      _registerView(view.id, moduleId, hasDataRepos);
      if (mainEl) {
        const sec = _createViewSection(view.id, view, { moduleId, hasDataRepos });
        mainEl.appendChild(sec);
      }
    }

    // A page module contributes to a hub that already exists and already has a
    // bound rail item, so it appends into `items` IN PLACE - assigning a new
    // array would drop the core's own pages (Design ships four) and any module
    // loaded before this one. Nothing else happens: no rail item, no key of
    // its own in HUB_FLYOUT.
    if (isPage) {
      for (const view of views) {
        HUB_FLYOUT[hubTarget].items.push({ label: view.label || view.id, view: view.id });
      }
      continue;
    }

    // Build HUB_FLYOUT entry before creating the rail item (bindSidebarItem
    // reads HUB_FLYOUT synchronously on the same tick).
    const railDataView = isHub ? moduleId : firstViewId;
    if (isHub) {
      HUB_FLYOUT[moduleId] = {
        label: sidebar.label || manifest.name,
        icon: manifest.icon || '24-ic-folder',
        items: views.map(v => ({
          label: v.label || v.id,
          view: v.id,
        })),
      };
    }

    // Inject rail item before the spacer.
    if (sidebarNav) {
      const iconSrc = moduleIconPath(manifest, moduleId);
      const a = document.createElement('a');
      a.className = 'sidebar-item';
      a.dataset.view = railDataView;
      a.href = '#' + railDataView;
      a.innerHTML =
        '<span class="icon"><img class="nav-icon" src="' + escHtml(iconSrc) + '" alt="" aria-hidden="true"></span>'
        + '<span class="nav-label"> ' + escHtml(sidebar.label || manifest.name) + '</span>';

      if (spacer) {
        sidebarNav.insertBefore(a, spacer);
      } else {
        sidebarNav.appendChild(a);
      }

      // Bind events AFTER HUB_FLYOUT is populated.
      bindSidebarItem(a);
      railItemsAdded++;
    }
  }

  storeRailCount(railItemsAdded);
}
