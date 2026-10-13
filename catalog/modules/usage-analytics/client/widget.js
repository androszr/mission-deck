// modules/usage-analytics/client/widget.js
// Dashboard widget "Mission Deck traffic" (contract: modules-template/README.md,
// "Dashboard widget"). Reads GET <apiBase>/widget - module-level numbers of the
// 7-day window, never per-person rows. No fallback to /data: that answer carries
// people, so on a server that has not been restarted (404) the tile asks for a restart.
// No static import from the core's /js/: the kit arrives as ctx.kit.

const RESTART_HINT = 'This tile needs a server restart: Settings > Restart server.';

function _fmt(n) {
  return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function _delta(pct) {
  if (typeof pct !== 'number' || !Number.isFinite(pct)) return '';
  return (pct > 0 ? '+' : pct < 0 ? '-' : '') + Math.abs(pct) + '%';
}

function _tone(pct) {
  if (typeof pct !== 'number' || !Number.isFinite(pct) || pct === 0) return 'neutral';
  return pct > 0 ? 'ok' : 'warn';
}

function _day(iso) {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? m[2] + '.' + m[1] : String(iso || '');
}

function _stamp(data) {
  return data.last_full_day ? ' · as of ' + _day(data.last_full_day) : '';
}

/** @returns {{blocks: Object<string, object>, empty: string|null}} */
export function buildBlocks(data) {
  if (!data || data.ok !== true || !data.kpi) {
    const code = data && data.error;
    if (code === 'storage-unavailable') return { blocks: {}, empty: 'No team data. Pull the "Team data" source in the Sync window.' };
    return { blocks: {}, empty: 'No traffic summary yet. Refresh the data in the Usage Analytics view.' };
  }
  const k = data.kpi;
  const d = k.delta || {};
  const daily = Array.isArray(data.daily) ? data.daily : [];
  const top = Array.isArray(data.topModules) ? data.topModules : [];
  const blocks = {
    tiles: { type: 'tiles', tiles: [
      { label: 'Active people, 7 days' + _stamp(data), value: _fmt(k.active_users), tone: _tone(d.active_users_pct), delta: _delta(d.active_users_pct) },
      { label: 'Sessions', value: _fmt(k.sessions), tone: _tone(d.sessions_pct), delta: _delta(d.sessions_pct) },
      { label: 'Page views', value: _fmt(k.page_views), tone: _tone(d.page_views_pct), delta: _delta(d.page_views_pct) },
    ] },
    big: { type: 'big', value: _fmt(k.active_users), unit: 'people', label: 'Active in 7 days' + (_delta(d.active_users_pct) ? ' · ' + _delta(d.active_users_pct) : '') + _stamp(data), tone: _tone(d.active_users_pct) === 'neutral' ? 'info' : _tone(d.active_users_pct) },
  };
  if (daily.length >= 2) {
    blocks.line = {
      type: 'line', label: 'Page views and active people per day, ' + daily.length + ' days' + _stamp(data), labels: daily.map((x) => _day(x.date)),
      series: [
        { label: 'Page views', values: daily.map((x) => x.page_views), tone: 'info', last: _fmt(daily[daily.length - 1].page_views) },
        { label: 'Active people', values: daily.map((x) => x.active_users), tone: 'ok' },
      ],
    };
  }
  if (top.length) {
    blocks.rank = { type: 'rank', label: 'Most used modules', items: top.map((m) => ({ label: m.label, value: m.page_views, tone: 'info', display: _fmt(m.page_views) })) };
  }
  // modulesInUse and modulesTotal share one universe (the module dictionary, no 'core');
  // kpi.modules_in_use counts 'core' too, so it is never the numerator here. No zones:
  // there is no target for how many modules a week should touch.
  const total = Number(data.modulesTotal) || 0;
  const inUse = Number(data.modulesInUse);
  if (total > 0 && Number.isFinite(inUse) && inUse >= 0) {
    const max = Math.max(total, inUse);
    blocks.gauge = {
      type: 'gauge', value: inUse, min: 0, max, center: String(inUse), label: 'Modules used in 7 days, of ' + max, tone: 'info',
    };
  }
  return { blocks, empty: null };
}

export const VARIANT_BLOCKS = {
  s: ['big'],
  m: ['tiles'],
  s2: ['big', 'line'],
  m2: ['tiles', 'line'],
  l: ['tiles', 'line', 'gauge'],
  xl: ['tiles', 'line', 'rank', 'gauge'],
};

/** @returns {string} HTML for a variant */
export function paint(data, variantId, size, kit) {
  const { blocks, empty } = buildBlocks(data);
  if (empty) return kit.empty(empty);
  const keys = VARIANT_BLOCKS[variantId] || VARIANT_BLOCKS.m2;
  return kit.blocks(keys.map((k) => blocks[k]).filter(Boolean), size);
}

export async function renderWidget(el, ctx) {
  const aborted = () => !!(ctx.signal && ctx.signal.aborted);
  const res = await fetch(ctx.apiBase + '/widget', { signal: ctx.signal });
  if (aborted()) return undefined;
  if (res.status === 404) {
    el.innerHTML = ctx.kit.empty(RESTART_HINT);
    return undefined;
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (aborted()) return undefined;
  el.innerHTML = paint(data, ctx.variant.id, { cols: ctx.variant.cols, rows: ctx.variant.rows }, ctx.kit);
  return undefined;
}
