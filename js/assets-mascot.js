// ── Mission Deck — js/assets-mascot.js ────────────────────────────────────
// Design > Mascot: the gallery of Pip, the Mission Deck mascot - one animated
// SVG preview per pose (assets/mascot/pip-<pose>.svg) with a download link
// and the empty-state name a view passes to use it (`mascot: '<pose>'` on
// emptyHeroHtml / emptyCompactHtml / emptyCellHtml in js/empty-state.js).
//
// The listing comes from GET /api/assets/mascot (a directory read; the files
// themselves are served statically). The SVGs animate and must render as
// <img>, never inline, or every tile in the grid would run its own animation
// in the document.

import { escHtml, normalizeSearch } from './utils.js';
import { emptyHeroHtml } from './empty-state.js';

const VIEW_ID_ROOT = 'assets-mascot-root';

/** @typedef {{name: string, pose: string|null, label: string, svg: string}} MascotItem */

/** @type {MascotItem[]|null} null until the first fetch settles */
let _items = null;
let _query = '';

// ── Data ───────────────────────────────────────────────────────────────────

async function _fetchItems() {
  try {
    const res = await fetch(`/api/assets/mascot?t=${Date.now()}`);
    const data = res.ok ? await res.json() : {};
    _items = Array.isArray(data.items) ? data.items : [];
  } catch {
    _items = [];
  }
}

// ── Painting ───────────────────────────────────────────────────────────────

function _cardHtml(item) {
  const name = item.name || '';
  const label = item.label || name;
  const usage = item.pose
    ? `<code class="amas-usage" title="Pass this to an empty state">mascot: '${escHtml(item.pose)}'</code>`
    : '';
  return `<div class="ds-card amas-card">
    <div class="ds-card-body amas-card-body">
      <div class="amas-thumb">
        <img src="${escHtml(item.svg)}" alt="${escHtml(label)}" loading="lazy" class="amas-img">
      </div>
      <div class="amas-name" title="${escHtml(name)}">${escHtml(item.pose || name)}</div>
      ${usage}
      <div class="amas-actions">
        <a class="ds-btn ds-btn--secondary ds-btn--sm" href="${escHtml(item.svg)}" download="${escHtml(name)}.svg">SVG</a>
      </div>
    </div>
  </div>`;
}

/** Repaints the grid and the counter only, so the focused search input lives. */
function _paintGrid() {
  const grid = document.getElementById('assets-mascot-grid');
  const count = document.getElementById('assets-mascot-count');
  if (!grid) return;

  const all = _items || [];
  const q = normalizeSearch(_query.trim());
  const visible = q
    ? all.filter(item => normalizeSearch(`${item.name || ''} ${item.label || ''}`).includes(q))
    : all;

  if (count) {
    count.innerHTML = `Showing <strong>${visible.length}</strong> of <strong>${all.length}</strong> poses`;
  }

  if (!visible.length) {
    grid.classList.add('amas-grid--empty');
    grid.innerHTML = emptyHeroHtml({
      title: 'No results',
      message: 'No pose matches that search. Change or clear the search.',
      mascot: 'thinking',
    });
    return;
  }
  grid.classList.remove('amas-grid--empty');
  grid.innerHTML = visible.map(_cardHtml).join('');
}

function _paint() {
  const root = document.getElementById(VIEW_ID_ROOT);
  if (!root) return;

  if (!_items || !_items.length) {
    root.innerHTML = emptyHeroHtml({
      title: 'No mascot artwork',
      message: 'The assets/mascot/ folder is empty or missing. The files ship with the repository - check that the checkout is complete.',
    });
    return;
  }

  root.innerHTML = `<div class="asv-toolbar">
    <div class="ds-input-wrap asv-search-wrap">
      <input type="search" class="ds-input" id="assets-mascot-search"
        placeholder="Search poses..." value="${escHtml(_query)}"
        aria-label="Search poses" autocomplete="off">
    </div>
    <span class="asv-count" id="assets-mascot-count" aria-live="polite"></span>
  </div>
  <div class="amas-grid" id="assets-mascot-grid"></div>`;

  const input = document.getElementById('assets-mascot-search');
  if (input) {
    input.addEventListener('input', function () {
      _query = this.value || '';
      _paintGrid();
    });
  }
  _paintGrid();
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Paints the mascot gallery. Called on every navigation into the view. */
export async function renderAssetsMascotView() {
  if (_items === null) await _fetchItems();
  _paint();
}

/**
 * One-time init. Nothing to wire globally: the only listener lives on an input
 * inside the view root and dies with the markup on the next repaint, so there
 * is no teardown to register with js/view-lifecycle.js.
 */
export function initAssetsMascot() {
}
