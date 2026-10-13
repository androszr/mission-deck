// modules/prod-bugs/client/widget.js
// Dashboard widget "open-bugs" (contract: modules-template/README.md,
// "Dashboard widget"). Reads GET <apiBase>/widget - the counters of the newest
// sprint shard plus the open-bug totals of the last sprints, no bug lists. On a
// server that has not been restarted since the route was added (404) it paints
// the restart sentence; it never falls back to the heavier GET /overview.
// No static import from the core's /js/: the kit arrives as ctx.kit.

const AREA_KEYS = ['orders', 'otherModules', 'platform'];
const AREA_LABELS = { orders: 'Orders', otherModules: 'Other modules', platform: 'Platform (Comet)' };
const AREA_TONES = { orders: 'info', otherModules: 'warn', platform: 'error' };
export const RESTART_TEXT = 'This tile needs a server restart: Settings > Restart server.';

/** "as of 11.10" from the shard's fetchedAt (local time, no zone); '' when absent. */
export function asOfLabel(fetchedAt) {
  const m = /^\d{4}-(\d{2})-(\d{2})/.exec(String(fetchedAt || ''));
  return m ? 'as of ' + m[2] + '.' + m[1] : '';
}

/** Mean fix time over the areas that have one, weighted by what they resolved; null when none. */
function _fixDays(areas) {
  let weight = 0;
  let sum = 0;
  let plain = 0;
  let count = 0;
  for (const k of AREA_KEYS) {
    const a = areas[k];
    if (a.bugFixTime === null) continue;
    plain += a.bugFixTime;
    count += 1;
    sum += a.bugFixTime * a.resolvedCount;
    weight += a.resolvedCount;
  }
  if (count === 0) return null;
  return weight > 0 ? sum / weight : plain / count;
}

function _tone(open) {
  return open <= 0 ? 'ok' : open <= 3 ? 'warn' : 'error';
}

const PRIORITY_ORDER = [['Critical', 'error'], ['High', 'warn'], ['Medium', 'info'], ['Low', 'ok']];

/** @returns {{blocks: Object<string, object>, empty: string|null}} */
export function buildBlocks(data) {
  if (!data || data.storage === 'unavailable') {
    return { blocks: {}, empty: 'No bug data. Fetch the team data in the Sync window.' };
  }
  if (!data.latest) return { blocks: {}, empty: 'No bug data - refresh it in the module view.' };
  const { latest, series } = data;
  const areas = latest.areas;
  const open = AREA_KEYS.reduce((s, k) => s + areas[k].bugs, 0);
  const resolved = AREA_KEYS.reduce((s, k) => s + areas[k].resolvedCount, 0);
  const created = AREA_KEYS.reduce((s, k) => s + areas[k].createdCount, 0);
  const fix = _fixDays(areas);
  const prev = series.length > 1 ? series[series.length - 2].bugs : null;
  const delta = prev === null ? '' : (open - prev > 0 ? '+' : open - prev < 0 ? '-' : '') + Math.abs(open - prev);
  const asOf = asOfLabel(data.fetchedAt);
  const label = latest.sprintName + (latest.dateRangeDisplay ? ' (' + latest.dateRangeDisplay + ')' : '') + (asOf ? ' · ' + asOf : '');
  const blocks = {
    // Fewer open bugs is better, so a rising count paints red.
    trend: { type: 'trend', value: String(open), unit: 'open', label, delta: delta || '0', period: prev === null ? '' : 'vs Sprint ' + series[series.length - 2].sprint, values: series.map((s) => s.bugs), higherIsBetter: false },
    big: { type: 'big', value: String(open), unit: 'open', label, tone: _tone(open) },
    tiles: { type: 'tiles', tiles: [
      { label: 'Resolved', value: String(resolved), tone: 'ok' },
      { label: 'Created', value: String(created), tone: created > 0 ? 'warn' : 'neutral' },
      { label: 'Avg fix time', value: fix === null ? '—' : fix.toFixed(1) + ' d', tone: 'neutral' },
    ] },
  };
  if (series.length >= 2 && series.every((s) => s.areas)) {
    blocks.line = {
      type: 'line', label: 'Open bugs by area', labels: series.map((s) => 'S' + s.sprint),
      series: AREA_KEYS.map((k) => ({ label: AREA_LABELS[k], values: series.map((s) => s.areas[k]), tone: AREA_TONES[k], last: String(areas[k].bugs) })),
    };
  }
  if (series.length >= 2 && series.every((s) => s.priorities)) {
    const names = PRIORITY_ORDER.filter(([n]) => series.some((s) => s.priorities[n] > 0));
    if (names.length) {
      blocks.area = { type: 'area', label: 'Open by priority', series: names.map(([n, tone]) => ({ label: n, tone, values: series.map((s) => s.priorities[n] || 0) })) };
    }
  }
  return { blocks, empty: null };
}

export const VARIANT_BLOCKS = {
  s: ['trend'],
  s2: ['trend', 'line'],
  m: ['trend', 'tiles'],
  m2: ['trend', 'tiles', 'line'],
  l: ['trend', 'tiles', 'line', 'area'],
};

/** @returns {string} HTML for a variant */
export function paint(data, variantId, size, kit) {
  const { blocks, empty } = buildBlocks(data);
  if (empty) return kit.empty(empty);
  const keys = VARIANT_BLOCKS[variantId] || VARIANT_BLOCKS.m2;
  return kit.blocks(keys.map((k) => blocks[k]).filter(Boolean), size);
}

export async function renderWidget(el, ctx) {
  let disposed = false;
  const res = await fetch(ctx.apiBase + '/widget', { signal: ctx.signal });
  let html;
  if (res.status === 404) {
    // Route added after the server started: restart, never the heavy /overview.
    html = ctx.kit.empty(RESTART_TEXT);
  } else if (!res.ok) {
    throw new Error('HTTP ' + res.status);
  } else {
    html = paint(await res.json(), ctx.variant.id, { cols: ctx.variant.cols, rows: ctx.variant.rows }, ctx.kit);
  }
  if (!disposed && !(ctx.signal && ctx.signal.aborted)) el.innerHTML = html;
  return () => { disposed = true; };
}
