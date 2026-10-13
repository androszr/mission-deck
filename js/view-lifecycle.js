// ── Mission Deck — js/view-lifecycle.js ────────────────────────────────────
// Per-view teardown registry.
// View init functions register their cleanup callbacks (clearInterval etc.) here;
// navigate() in app.js calls runActiveViewCleanup() on exit so view-scoped
// timers and listeners are torn down when the user leaves a view.
//
// Boot-global timers (sidebar-ai-provider.js, data-update-banner.js,
// update-banner.js) are intentionally NOT registered here — they run for the
// lifetime of the app and must not be stopped on navigate.

/** @type {Map<string, Array<() => void>>} */
const _registry = new Map();

/**
 * Register a cleanup function for a view.
 * Multiple calls for the same viewId accumulate; all are run on exit.
 * Calling registerViewCleanup from inside a view's init function is idempotent
 * on re-entry because each re-entry re-registers fresh closures that clear the
 * new timer handles.
 *
 * @param {string} viewId
 * @param {() => void} fn
 */
export function registerViewCleanup(viewId, fn) {
  if (!_registry.has(viewId)) _registry.set(viewId, []);
  _registry.get(viewId).push(fn);
}

/**
 * Run and remove all cleanup callbacks registered for viewId.
 * Safe to call when no cleanup is registered (no-op).
 *
 * @param {string} viewId
 */
export function runViewCleanup(viewId) {
  const fns = _registry.get(viewId);
  if (!fns) return;
  _registry.delete(viewId);
  for (const fn of fns) {
    try { fn(); } catch (e) { console.error('[view-lifecycle] cleanup error for', viewId, e); }
  }
}

/**
 * Called by navigate() with the viewId that is being LEFT.
 * Safe to call when _activeViewId is null (first navigate at boot).
 *
 * @param {string|null} viewId
 */
export function runActiveViewCleanup(viewId) {
  if (!viewId) return;
  runViewCleanup(viewId);
}
