// ── Mission Deck — js/rail-placeholders.js ────────────────────────────
// Skeleton rows for the sidebar rail items that installed modules add.
//
// The rail is the one skeleton that cannot ship as static markup in
// index.html: how many module items there will be is only known once
// GET /api/modules/manifest answers. So the count of the LAST load is
// remembered per browser (same trick as the rail's collapsed/expanded state in
// js/theme-boot.js) and that many placeholder rows are painted straight away.
//
// It lives in its own module, and not next to the loader that consumes it,
// because of WHEN it has to run. js/module-host.js is reached through a
// dynamic import inside boot() - it exists only to avoid the static cycle
// app.js -> module-host.js -> app.js - so painting from there reserves nothing
// against the wait that matters: on a cold load the import of module-host.js
// is itself most of the delay (measured at 1.4 s), and the rail items land in
// the same frame as the manifest. Painted from js/app.js at module-evaluation
// time instead, the rows are up as early as any script here can put them.
//
// Dependency-free on purpose: js/app.js imports this statically, so anything
// this file pulled in would join the boot path it is trying to get ahead of.

const RAIL_COUNT_KEY = 'cockpit.moduleRailCount';
const RAIL_COUNT_MAX = 8;

/** @returns {number} module rail items this browser saw last time, 0..RAIL_COUNT_MAX */
function _storedRailCount() {
  try {
    const n = parseInt(localStorage.getItem(RAIL_COUNT_KEY) || '0', 10);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(n, RAIL_COUNT_MAX);
  } catch (_e) {
    return 0;
  }
}

/**
 * Remember how many rail items the manifest actually yielded. A module the
 * loader skips has no row, so this is not the same as modules.length.
 * @param {number} n
 */
export function storeRailCount(n) {
  try { localStorage.setItem(RAIL_COUNT_KEY, String(n)); } catch (_e) { /* private mode */ }
}

/**
 * Paint one skeleton row per remembered module item, before the spacer - which
 * is where js/module-host.js inserts the real ones. Reuses .sidebar-item so the
 * row height and the 24px icon slot are the real ones.
 * @returns {number} rows painted
 */
export function paintRailPlaceholders() {
  const nav = document.querySelector('.sidebar-nav');
  if (!nav) return 0;
  const spacer = nav.querySelector('.sidebar-spacer');
  const count = _storedRailCount();
  for (let i = 0; i < count; i++) {
    const row = document.createElement('span');
    row.className = 'sidebar-item nav-skel';
    row.dataset.skel = '1';
    row.setAttribute('aria-hidden', 'true');
    row.innerHTML = '<span class="icon"><span class="ds-skeleton nav-skel-icon"></span></span>'
      + '<span class="nav-label"><span class="ds-skeleton nav-skel-label"></span></span>';
    if (spacer) nav.insertBefore(row, spacer);
    else nav.appendChild(row);
  }
  return count;
}

/**
 * Remove every placeholder row. Must run on EVERY exit of initModuleHost(),
 * including the ones that install nothing - a stale count would otherwise
 * leave a row pulsing in the rail for the whole session.
 */
export function clearRailPlaceholders() {
  const nav = document.querySelector('.sidebar-nav');
  if (!nav) return;
  nav.querySelectorAll('.nav-skel').forEach(el => el.remove());
}
