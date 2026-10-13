// ── Mission Deck — js/assets-illustrations.js ────────────────────────────
// Design > Illustrations: the illustration set used by empty states, modals
// and onboarding - today the poses of Pip, the Mission Deck mascot, from
// assets/mascot/manifest.json - preview, search and copy the SVG source.
//
// All behaviour lives in js/assets-svg-catalog.js, shared with Icons; this
// module is the data half plus the two names js/view-registry.js calls.

import { createSvgCatalog } from './assets-svg-catalog.js';

/**
 * assets/mascot/manifest.json -> {display name: {slug, file}}.
 * @param {{poses?: Array<{pose: string, file: string, label?: string}>}} json
 */
export function illustrationManifestEntries(json) {
  const out = {};
  for (const p of (json && Array.isArray(json.poses)) ? json.poses : []) {
    if (!p || typeof p.file !== 'string') continue;
    out[p.label || p.pose || p.file] = { slug: p.file.replace(/\.svg$/i, ''), file: p.file };
  }
  return out;
}

const _catalog = createSvgCatalog({
  viewId: 'assets-illustrations',
  rootId: 'assets-illustrations-root',
  baseUrl: '/assets/mascot/',
  manifest: 'manifest.json',
  toEntries: illustrationManifestEntries,
  variantClass: 'asv-card--ill',
  searchPlaceholder: 'Search illustrations...',
  searchLabel: 'Search illustrations',
  countNoun: 'illustrations',
  missingTitle: 'No illustration catalog',
  missingMessage: 'Could not load assets/mascot/manifest.json. The file ships with the repository - check that the checkout is complete.',
});

/** Paints the illustration catalog. Called on every navigation into the view. */
export function renderAssetsIllustrationsView() {
  return _catalog.render();
}

/** One-time init. The teardown is registered by the shared catalog engine. */
export function initAssetsIllustrations() {
  _catalog.init();
}
