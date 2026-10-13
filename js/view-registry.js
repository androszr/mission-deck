// ── Mission Deck — js/view-registry.js ────────────────────────────────────
// Lazy view module loader.
//
// VIEW_REGISTRY maps each lazy viewId to:
//   importFn  — (bust) => dynamic import() promise. `bust` is a query suffix
//               ('' normally) that js/app.js uses to RE-IMPORT a module view as
//               a genuinely fresh instance after a data sync — see
//               reloadViewModule below. A core view never gets a non-empty one.
//   render    — name of the render function on the resolved module
//   runInit   — (mod, deps) => void — calls the view's init with correct args
//   refresh   — OPTIONAL. Name of a function on the module that RE-FETCHES this
//               view's data and repaints. js/app.js prefers it over the generic
//               reload when the local team data changed under an open sync
//               modal, because it keeps the view's state (scroll, open tab,
//               filters). Omit it when `render` already fetches everything it
//               paints (the wizard does).
//   moduleId  — set by js/module-host.js on the views an installed module owns.
//               It marks an entry as RELOADABLE: the core cannot audit somebody
//               else's module for a cache that would survive a repaint, so a
//               data sync re-imports the whole module file for those views
//               instead of trusting a repaint. One file backs every view of a
//               module, which is why the id is stored rather than a boolean.
//
// Boot-critical modules (state.js, topbar.js, theme.js, update-banner.js,
// claude-terminal.js, empty-state.js, data-tier-0-sync.js) are NOT
// in this registry — js/app.js imports them statically.
//
// loadViewModule(viewId) — memoized: imports each module at most once per
// session and caches the resolved namespace. Returns null for unknown ids.

import { trackEvent } from './analytics.js';

/**
 * @typedef {{ importFn: (bust: string) => Promise<any>, render: string, runInit: (mod: any, deps: ViewDeps) => void, refresh?: string, moduleId?: string }} ViewEntry
 * @typedef {{ navigate: (id: string, opts?: object) => Promise<void> }} ViewDeps
 */

/** @type {Map<string, any>} */
const _moduleCache = new Map();

/**
 * Bumped once per reloadViewModule() call and appended to the import specifier
 * of every RELOADABLE entry (one carrying `moduleId`). A dynamic import is
 * memoized per URL by the browser, so a new query string - and nothing else -
 * is what produces a genuinely fresh module instance with its module-level
 * caches empty.
 *
 * GLOBAL rather than per module on purpose: a hub module backs several views
 * off ONE file, and all of them are dropped together below. Because they then
 * re-import at the same generation they resolve to the same URL and therefore
 * to the SAME instance - two live copies of one module driving one page is the
 * bug this counter exists to avoid.
 *
 * Each generation leaves the PREVIOUS instance in the browser's module map for
 * the life of the page - a module map has no eviction. Deliberate, and not a
 * leak to chase: one retained namespace per module per sync, and a sync is a
 * deliberate, occasional action, not a loop.
 *
 * Only the ENTRY file is busted. A relative specifier inside it resolves
 * against the base URL WITHOUT inheriting the query, so a module's siblings
 * (`<id>-lib.js` and friends) stay one shared instance across every
 * generation - which is what keeps a hub module's helpers from forking, and
 * which is why team data must never be cached in a sibling: the reload would
 * not clear it. See modules-template/README.md.
 */
let _reloadGeneration = 0;

/**
 * The import suffix for one entry. Empty for a core view: those are audited in
 * this repository and js/app.js repaints them rather than re-importing them,
 * so they keep the one instance they were booted with.
 * @param {ViewEntry} entry
 * @returns {string}
 */
function _bustFor(entry) {
  if (!entry || !entry.moduleId || _reloadGeneration === 0) return '';
  return '?r=' + _reloadGeneration;
}

/** @type {Record<string, ViewEntry>} */
export const VIEW_REGISTRY = {

  'dashboard': {
    importFn: (bust) => import('./dashboard.js' + bust),
    render: 'renderDashboardView',
    runInit: (mod, { navigate }) => mod.initDashboard(navigate),
    // A data sync repaints only the module widgets, not the entry cards.
    refresh: 'refreshDashboardWidgets',
  },

  'settings': {
    importFn: (bust) => import('./settings.js' + bust),
    render: 'renderSettingsView',
    runInit: (mod) => mod.initSettings(),
  },

  'gitlab-activity': {
    importFn: (bust) => import('./gitlab-activity.js' + bust),
    render: 'renderGitlabActivityView',
    runInit: (mod) => mod.initGitlabActivity(),
  },

  'onboarding-wizard': {
    importFn: (bust) => import('./onboarding-wizard.js' + bust),
    render: 'renderOnboardingWizard',
    runInit: (mod, { navigate }) => mod.initOnboardingWizard(navigate),
  },

  // Core view, not a hub: NO entry in js/sidebar-flyout-config.js HUB_FLYOUT.
  // A key there would make 'academy' a hub with no section of its own,
  // and js/app.js would redirect #academy back to the dashboard.
  'academy': {
    importFn: (bust) => import('./academy.js' + bust),
    render: 'renderAcademyView',
    runInit: (mod) => mod.initAcademy(),
    // Progress, gallery and mural all live in the data repo, and the renderer
    // paints them from a module-level cache - a bare re-render after a pull
    // would repaint exactly what was on screen before it.
    refresh: 'refreshAcademyData',
  },
  'assets-design-system': {
    importFn: (bust) => import('./assets-design-system.js' + bust),
    render: 'renderAssetsDesignSystemView',
    runInit: (mod) => mod.initAssetsDesignSystem(),
  },
  'assets-icons': {
    importFn: (bust) => import('./assets-icons.js' + bust),
    render: 'renderAssetsIconsView',
    runInit: (mod) => mod.initAssetsIcons(),
  },
  'assets-illustrations': {
    importFn: (bust) => import('./assets-illustrations.js' + bust),
    render: 'renderAssetsIllustrationsView',
    runInit: (mod) => mod.initAssetsIllustrations(),
  },
  'assets-mascot': {
    importFn: (bust) => import('./assets-mascot.js' + bust),
    render: 'renderAssetsMascotView',
    runInit: (mod) => mod.initAssetsMascot(),
  },
  'prototypy': {
    importFn: () => import('./prototypy.js'),
    render: 'renderPrototypyView',
    runInit: (mod) => mod.initPrototypy(),
    // Team data (the prototype registry) lives in data-tier-0; refresh
    // forces a cache invalidation and a fresh fetch instead of repainting
    // from a stale _itemsCache (stage 12 of the plan).
    refresh: 'refreshPrototypyRegistry',
  },
  // Core views, not hubs: NO entry in js/sidebar-flyout-config.js HUB_FLYOUT.
  // Reached only from a card in the 'prototypy' registry (precedent:
  // academy, onboarding-wizard).
  'proto-detail': {
    importFn: () => import('./prototypy.js'),
    render: 'renderProtoDetailView',
    runInit: (mod) => mod.initProtoDetail(),
    // Same as above: the access code and the build status also live in data /
    // on the server and must not be repainted from a pre-sync cache.
    refresh: 'refreshProtoDetail',
  },
  // Content arrives in stage 5 - the section stays empty until then.
  'proto-standalone': {
    importFn: () => import('./prototypy.js'),
    render: 'renderProtoStandaloneView',
    runInit: (mod) => mod.initProtoStandalone(),
  },
};

/**
 * Registry entry for a viewId, or undefined for boot-critical / unknown ids.
 * @param {string} viewId
 * @returns {ViewEntry|undefined}
 */
export function getViewEntry(viewId) {
  return VIEW_REGISTRY[viewId];
}

/**
 * Memoized module loader. Imports the module for viewId at most once.
 * @param {string} viewId
 * @param {string} [source='prefetch'] provenance of this load
 * @returns {Promise<any>} resolved module namespace, or null for unknown ids
 */
export async function loadViewModule(viewId, source = 'prefetch') {
  const entry = VIEW_REGISTRY[viewId];
  if (!entry) return null;

  if (_moduleCache.has(viewId)) {
    trackEvent('View Module Loaded', { view: viewId, cache_hit: true, duration_ms: 0, ok: true, source });
    return _moduleCache.get(viewId);
  }

  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let ok = true;
  try {
    const mod = await entry.importFn(_bustFor(entry));
    _moduleCache.set(viewId, mod);
    return mod;
  } catch (e) {
    ok = false;
    throw e;
  } finally {
    const duration = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
    trackEvent('View Module Loaded', { view: viewId, cache_hit: false, duration_ms: duration, ok, source });
  }
}

/**
 * Re-import a view's module as a FRESH instance and cache it in place of the
 * old one - the generic answer to "the data on disk changed under this view".
 * Nothing else can clear a cache that lives in somebody else's module scope,
 * which is why this exists instead of a hook every module author would have to
 * remember to write.
 *
 * Only a reloadable entry (one carrying `moduleId`) actually gets a new
 * instance; for anything else this is loadViewModule. Every view of the same
 * module is dropped alongside, so a hub module never ends up with one view on
 * the new namespace and its siblings on the old one.
 *
 * The CALLER owns the rest of the re-entry - running the outgoing instance's
 * cleanup, clearing its markup, re-running init - because only js/app.js knows
 * which view is on screen. See refreshActiveView() there.
 *
 * @param {string} viewId
 * @param {string} [source='reload'] provenance of this load
 * @returns {Promise<any>} resolved module namespace, or null for unknown ids
 */
export async function reloadViewModule(viewId, source = 'reload') {
  const entry = VIEW_REGISTRY[viewId];
  if (!entry) return null;
  if (!entry.moduleId) return loadViewModule(viewId, source);

  _reloadGeneration += 1;
  for (const [id, e] of Object.entries(VIEW_REGISTRY)) {
    if (id === viewId || e.moduleId === entry.moduleId) _moduleCache.delete(id);
  }
  return loadViewModule(viewId, source);
}

/**
 * True once a view's module has been imported and cached.
 * @param {string} viewId
 * @returns {boolean}
 */
export function isViewModuleLoaded(viewId) {
  return _moduleCache.has(viewId);
}
