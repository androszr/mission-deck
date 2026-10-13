// modules/responsibilities/client/widget.js
// Dashboard widget "R / A / G rating" (contract: modules-template/README.md,
// "Dashboard widget"). Reads GET <apiBase>/data?project=main and counts through
// the module's own lib, so the tile equals the view (same default month rule).
// No avatars: the tile shows counts, not people.
// No static import from the core's /js/: the kit arrives as ctx.kit.

import { countsForMonth, defaultMonth, groupCounts, monthLabel, STATUS_LABELS } from './responsibilities-lib.js';

const PROJECT = 'main';
const NO_STORAGE = 'No responsibility matrix - pull the team data in the Sync window.';
const NO_MATRIX = 'The matrix is not prepared yet - open the Responsibilities view.';

/** "area" / "areas" for n. */
export function areasWord(n) {
  return n === 1 ? 'area' : 'areas';
}

/** @returns {{blocks: Object<string, object>, empty: string|null}} */
export function buildBlocks(data, now = new Date()) {
  if (!data || data.storage !== 'ok') return { blocks: {}, empty: NO_STORAGE };
  if (!data.available || !data.data) return { blocks: {}, empty: NO_MATRIX };
  const matrix = data.data;
  const month = defaultMonth(matrix.months, now);
  if (!month) return { blocks: {}, empty: NO_MATRIX };
  const c = countsForMonth(matrix, month);
  const rated = c.green + c.amber + c.red;
  const label = monthLabel(month);
  const blocks = {
    pie: { type: 'pie', center: String(rated), segments: [
      { label: STATUS_LABELS.green, value: c.green, tone: 'ok' },
      { label: STATUS_LABELS.amber, value: c.amber, tone: 'warn' },
      { label: STATUS_LABELS.red, value: c.red, tone: 'error' },
    ] },
    pill: c.unset > 0
      ? { type: 'pill', tone: 'warn', text: c.unset + ' ' + areasWord(c.unset) + ' not rated', sub: 'for ' + label }
      : { type: 'pill', tone: 'ok', text: 'All areas rated', sub: 'for ' + label },
  };
  const rows = (matrix.groups || []).map((g) => {
    const gc = groupCounts(g, month);
    return { label: String(g.name || g.label || ''), value: gc.red + gc.amber, tone: gc.red > 0 ? 'error' : 'warn' };
  }).filter((r) => r.value > 0);
  if (rows.length) blocks.segments = { type: 'segments', label: 'Red and amber by group', segments: rows };
  return { blocks, empty: null };
}

export const VARIANT_BLOCKS = {
  s: ['pie'],
  s2: ['pie', 'pill'],
  m: ['pie', 'pill'],
  m2: ['pie', 'pill', 'segments'],
};

/** @returns {string} HTML for a variant */
export function paint(data, variantId, size, kit, now = new Date()) {
  const { blocks, empty } = buildBlocks(data, now);
  if (empty) return kit.empty(empty);
  const keys = VARIANT_BLOCKS[variantId] || VARIANT_BLOCKS.m2;
  return kit.blocks(keys.map((k) => blocks[k]).filter(Boolean), size);
}

export async function renderWidget(el, ctx) {
  let disposed = false;
  const res = await fetch(ctx.apiBase + '/data?project=' + PROJECT, { signal: ctx.signal });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (!disposed && !(ctx.signal && ctx.signal.aborted)) {
    el.innerHTML = paint(data, ctx.variant.id, { cols: ctx.variant.cols, rows: ctx.variant.rows }, ctx.kit);
  }
  return () => { disposed = true; };
}
