// ── Mission Deck — js/assets-svg-catalog.js ───────────────────────────
// Shared engine behind the two SVG catalogs of the Design hub, Icons and
// Illustrations. Each reads one committed manifest (assets/icons/ds/manifest.json,
// assets/mascot/manifest.json), turns it into a list of {name, slug, file}
// through its own `toEntries`, paints a search box over a card grid and copies
// the raw SVG source to the clipboard, so what separates them is data, not
// behaviour.
//
// The manifests and the SVG files are COMMITTED in this repository - there is
// no generation step at runtime - so a missing manifest means a broken
// checkout, never "not generated yet". The empty states say exactly that.
//
// createSvgCatalog() returns the render/init pair a view module re-exports
// under the names js/view-registry.js calls. State (the fetched manifest, the
// query, the SVG text cache) lives in that closure, one instance per view.

import { escHtml, normalizeSearch } from './utils.js';
import { emptyHeroHtml } from './empty-state.js';
import { registerViewCleanup } from './view-lifecycle.js';

/**
 * @typedef {{slug: string, file: string}} SvgEntry
 * @typedef {{
 *   viewId: string,
 *   rootId: string,
 *   baseUrl: string,
 *   manifest: string,
 *   toEntries: (json: any) => Record<string, SvgEntry>,
 *   variantClass: string,
 *   displayName?: (raw: string) => string,
 *   searchPlaceholder: string,
 *   searchLabel: string,
 *   countNoun: string,
 *   missingTitle: string,
 *   missingMessage: string,
 * }} SvgCatalogConfig
 */

/**
 * Build one catalog instance.
 *
 * @param {SvgCatalogConfig} cfg
 * @returns {{render: () => Promise<void>, init: () => void}}
 */
export function createSvgCatalog(cfg) {
  const displayName = cfg.displayName || (raw => raw);
  // The section's root is "<view id>-root"; its two painted children get the
  // same base, so the ids read as assets-icons-grid / assets-icons-count.
  const idBase = cfg.rootId.replace(/-root$/, '');
  const GRID_ID = `${idBase}-grid`;
  const COUNT_ID = `${idBase}-count`;

  /** @type {Record<string, SvgEntry>|null} null until the first fetch settles */
  let entries = null;
  let query = '';
  /** @type {Map<string, string>} slug -> raw SVG text */
  const svgCache = new Map();

  // ── Data ───────────────────────────────────────────────────────────────────

  async function _fetchManifest() {
    try {
      const res = await fetch(`${cfg.baseUrl}${cfg.manifest}?t=${Date.now()}`);
      entries = res.ok ? cfg.toEntries(await res.json()) : {};
    } catch {
      entries = {};
    }
    if (!entries || typeof entries !== 'object') entries = {};
  }

  /** @returns {Array<[string, SvgEntry]>} name/entry pairs matching the query */
  function _visible() {
    const all = Object.entries(entries || {});
    const q = normalizeSearch(query.trim());
    if (!q) return all;
    return all.filter(([name, item]) =>
      normalizeSearch(displayName(name)).includes(q)
      || normalizeSearch(item.slug || '').includes(q));
  }

  // ── Painting ───────────────────────────────────────────────────────────────

  function _cardHtml(name, item) {
    const label = displayName(name);
    return `<div class="asv-card ${escHtml(cfg.variantClass)}">
      <div class="asv-preview">
        <img src="${escHtml(cfg.baseUrl + item.file)}" alt="${escHtml(label)}" loading="lazy" onerror="this.style.display='none'">
      </div>
      <div class="asv-name" title="${escHtml(label)}">${escHtml(label)}</div>
      <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm asv-copy-btn"
        data-asv-slug="${escHtml(item.slug)}"
        data-asv-file="${escHtml(item.file)}"
        aria-label="Copy SVG source: ${escHtml(label)}">Copy SVG</button>
    </div>`;
  }

  /** Repaints the grid and the counter only, so the focused search input lives. */
  function _paintGrid() {
    const grid = document.getElementById(GRID_ID);
    const count = document.getElementById(COUNT_ID);
    if (!grid) return;

    const total = Object.keys(entries || {}).length;
    const visible = _visible();
    if (count) {
      count.innerHTML = `Showing <strong>${visible.length}</strong> of <strong>${total}</strong> ${escHtml(cfg.countNoun)}`;
    }

    if (!visible.length) {
      grid.classList.add('asv-grid--empty');
      grid.innerHTML = emptyHeroHtml({
        title: 'No results',
        message: 'Nothing matches that search. Change or clear the search.',
        mascot: 'thinking',
      });
      return;
    }
    grid.classList.remove('asv-grid--empty');
    grid.innerHTML = visible.map(([name, item]) => _cardHtml(name, item)).join('');
  }

  function _paint() {
    const root = document.getElementById(cfg.rootId);
    if (!root) return;

    if (!entries || !Object.keys(entries).length) {
      root.innerHTML = emptyHeroHtml({
        title: cfg.missingTitle,
        message: cfg.missingMessage,
        mascot: 'error',
      });
      return;
    }

    root.innerHTML = `<div class="asv-toolbar">
      <div class="ds-input-wrap asv-search-wrap">
        <input type="search" class="ds-input" id="${escHtml(idBase)}-search"
          placeholder="${escHtml(cfg.searchPlaceholder)}" value="${escHtml(query)}"
          aria-label="${escHtml(cfg.searchLabel)}" autocomplete="off">
      </div>
      <span class="asv-count" id="${escHtml(COUNT_ID)}" aria-live="polite"></span>
    </div>
    <div class="asv-grid" id="${escHtml(GRID_ID)}"></div>`;

    const input = document.getElementById(`${idBase}-search`);
    if (input) {
      input.addEventListener('input', function () {
        query = this.value || '';
        _paintGrid();
      });
    }
    _paintGrid();
  }

  // ── Copy to clipboard ──────────────────────────────────────────────────────

  async function _copySvg(btn) {
    const slug = btn.dataset.asvSlug;
    const file = btn.dataset.asvFile;
    if (!file) return;
    const original = btn.textContent;
    btn.disabled = true;
    try {
      let svgText = svgCache.get(slug);
      if (!svgText) {
        const res = await fetch(cfg.baseUrl + file);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        svgText = await res.text();
        svgCache.set(slug, svgText);
      }
      await navigator.clipboard.writeText(svgText);
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = original; }, 1500);
    } catch {
      btn.textContent = 'Copy failed';
      setTimeout(() => { btn.textContent = original; }, 2000);
    } finally {
      btn.disabled = false;
    }
  }

  // One delegated listener on the root instead of one per card: the grid is
  // repainted on every keystroke.
  function _wireCopyDelegation() {
    const root = document.getElementById(cfg.rootId);
    if (!root || root.dataset.asvWired === '1') return;
    root.dataset.asvWired = '1';
    const onClick = e => {
      const btn = e.target.closest('.asv-copy-btn');
      if (btn) _copySvg(btn);
    };
    root.addEventListener('click', onClick);
    registerViewCleanup(cfg.viewId, () => {
      root.removeEventListener('click', onClick);
      delete root.dataset.asvWired;
    });
  }

  // ── Public pair ────────────────────────────────────────────────────────────

  async function render() {
    if (entries === null) await _fetchManifest();
    _paint();
    _wireCopyDelegation();
  }

  function init() {
    // Nothing to start here: the delegated click listener is registered for
    // teardown in _wireCopyDelegation(), which render() calls on every entry
    // (init runs once, cleanup is consumed on every exit).
  }

  return { render, init };
}
