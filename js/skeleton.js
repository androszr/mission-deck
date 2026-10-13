// ── Mission Deck — js/skeleton.js ─────────────────────────────────────
// The one helper behind the loading skeletons that ship as STATIC markup in
// index.html - the top bar slots, the dashboard grid and the four view roots
// that are filled by a fetch. Every one of those boxes reserves its finished
// height at parse time, before js/app.js is even fetched, so nothing on the
// page jumps as the answers land one request at a time.
//
// A skeleton node carries `data-skel="1"`. A painter that rebuilds its whole
// container (`innerHTML = ...`, `replaceChildren(...)`) drops the skeleton on
// its own and needs nothing from here. This module exists for the OTHER two
// cases, and both are the same rule read from two sides:
//
//   clearSkeleton(root) - every EARLY RETURN of such a painter has to call it.
//     "Not installed", "no token", a dead fetch: each one is a final answer
//     that paints nothing, and a skeleton left standing there pulses forever.
//
//   hasSkeleton(root) - a painter that would replace the skeleton with
//     SOMETHING SHORTER (a "Loading..." sentence, a hollow frame painted
//     before its data arrived) must check this and leave the box alone. That
//     is the mistake the `sett-loading` sentence made in Settings: it wiped
//     a taller skeleton and reintroduced the jump it was meant to prevent.

/** @type {string} selector for a static skeleton node */
const SKEL_SELECTOR = '[data-skel]';

/**
 * True while `root` still holds the static skeleton it was parsed with.
 * @param {Element|null} root
 * @returns {boolean}
 */
export function hasSkeleton(root) {
  return !!root && !!root.querySelector(SKEL_SELECTOR);
}

/**
 * Drop the static skeleton from `root`, leaving anything a painter has already
 * put there. Safe to call when there is none.
 * @param {Element|null} root
 * @returns {void}
 */
export function clearSkeleton(root) {
  if (!root) return;
  root.querySelectorAll(SKEL_SELECTOR).forEach(el => el.remove());
}
