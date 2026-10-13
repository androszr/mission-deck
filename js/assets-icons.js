// ── Mission Deck — js/assets-icons.js ─────────────────────────────────
// Design > Icons: the icon set the app ships, assets/icons/ds/manifest.json
// (Lucide glyphs under the slugs the app and module.json files use) - preview,
// search and copy the SVG source.
//
// All behaviour lives in js/assets-svg-catalog.js, shared with Illustrations;
// this module is the data half plus the two names js/view-registry.js calls.

import { createSvgCatalog } from './assets-svg-catalog.js';

/**
 * assets/icons/ds/manifest.json -> {display name: {slug, file}}.
 * @param {{icons?: Array<{slug: string, name?: string, file?: string}>}} json
 */
export function iconManifestEntries(json) {
  const out = {};
  for (const icon of (json && Array.isArray(json.icons)) ? json.icons : []) {
    if (!icon || typeof icon.slug !== 'string') continue;
    out[icon.name || icon.slug] = { slug: icon.slug, file: icon.file || `${icon.slug}.svg` };
  }
  return out;
}

const _catalog = createSvgCatalog({
  viewId: 'assets-icons',
  rootId: 'assets-icons-root',
  baseUrl: '/assets/icons/ds/',
  manifest: 'manifest.json',
  toEntries: iconManifestEntries,
  variantClass: 'asv-card--icon',
  searchPlaceholder: 'Search icons...',
  searchLabel: 'Search icons',
  countNoun: 'icons',
  missingTitle: 'No icon catalog',
  missingMessage: 'Could not load assets/icons/ds/manifest.json. The file ships with the repository - check that the checkout is complete.',
});

/** Paints the icon catalog. Called on every navigation into the view. */
export function renderAssetsIconsView() {
  return _catalog.render();
}

/** One-time init. The teardown is registered by the shared catalog engine. */
export function initAssetsIcons() {
  _catalog.init();
}
