// rollout-waves/client/widget.js
// Dashboard widgets rollout-progress and rollout-next-waves (contract: modules-template/README.md, dashboard widgets).
// Both read GET <apiBase>/dashboard?lean=1 (lean drops the store list) through
// ONE shared in-flight request per apiBase, so two frames cost one fetch. No
// static import from the core's /js/: the kit arrives as ctx.kit.

const SYNC_TEXT = 'No rollout data. Pull the data in the Sync window.';
const NO_CATALOG_TEXT = 'No locations directory - rollout numbers are not available.';
const NO_WAVES_TEXT = 'No waves planned.';
const MAX_WAVES = 5;

function _num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function _dec(n) {
  return String(Math.round(_num(n) * 10) / 10);
}

/** "1 location", "783 locations". */
export function locations(n) {
  const v = Math.round(_num(n));
  return v === 1 ? '1 location' : v + ' locations';
}

/** "as of 10.10" from generated_at (UTC), in local time; '' when absent. */
export function asOfLabel(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return 'as of ' + String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0');
}

function _dateLabel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? m[3] + '.' + m[2] : String(iso || '');
}

/**
 * Normalise a /dashboard?lean=1 payload. `waves` keeps only the rounds that are
 * not realised yet (status 'planned' | 'current', or a start still ahead).
 * @param {object} payload
 * @param {string} todayIso YYYY-MM-DD
 */
export function fromDashboard(payload, todayIso) {
  const p = payload || {};
  const today = String(todayIso || '');
  const waves = (Array.isArray(p.waves) ? p.waves : [])
    .filter((t) => t && t.status !== 'done' && (!today || !t.start || t.start >= today || t.status === 'current'))
    .map((t) => ({
      wave: t.wave,
      start: t.start || '',
      webinarDate: t.webinar_date || '',
      count: _num(t.locations_count),
      pctTraining: _num(t.pct_training),
      pctWebinar: _num(t.pct_webinar),
      status: t.status || 'planned',
    }));
  return {
    today,
    storage: p.storage || 'ok',
    available: p.available !== false,
    directory: p.directory || null,
    generatedAt: p.generated_at || null,
    kpi: p.kpi || null,
    nextStart: p.next_start || null,
    waves,
  };
}

function _waveLabel(t) {
  return 'Wave ' + t.wave + ' · ' + locations(t.count);
}

/**
 * @param {ReturnType<typeof fromDashboard>} d
 * @returns {{blocks: Object<string, object>, empty: string|null}}
 */
export function buildProgressBlocks(d) {
  if (d.storage !== 'ok' || !d.available) return { blocks: {}, empty: SYNC_TEXT };
  if ((d.directory && d.directory.present === false) || !d.kpi) return { blocks: {}, empty: NO_CATALOG_TEXT };
  const k = d.kpi;
  const total = _num(k.locations_count);
  if (total <= 0) return { blocks: {}, empty: NO_CATALOG_TEXT };
  const liveCount = _num(k.live);
  const noWave = _num(k.no_wave);
  // kpi.to_go_live = total - live (no_wave INCLUDED), the number the module view shows under
  // its "To go live" tile. The waffle splits it: locations already in a wave vs locations without one.
  const toGoLive = _num(k.to_go_live);
  const inWaves = Math.max(0, toGoLive - noWave);
  const asOf = asOfLabel(d.generatedAt);
  // Shares in percent; keep the sum within 100 so the 10x10 grid never overflows.
  const wShare = Math.round((liveCount / total) * 100);
  const bShare = Math.min(100 - wShare, Math.round((noWave / total) * 100));
  const dShare = Math.max(0, Math.min(100 - wShare - bShare, Math.round((inWaves / total) * 100)));
  const next = d.nextStart;
  return {
    empty: null,
    blocks: {
      waffle: {
        type: 'waffle',
        parts: [
          { value: wShare, tone: 'ok', label: 'live' },
          { value: dShare, tone: 'neutral', label: 'in waves' },
          { value: bShare, tone: 'warn', label: 'no wave' },
        ],
        center: _dec(k.progress_pct) + '%',
        caption: 'locations live' + (asOf ? ' · ' + asOf : ''),
      },
      tiles: {
        type: 'tiles',
        tiles: [
          { label: 'Live', value: String(liveCount), tone: 'ok' },
          { label: 'To go live', value: String(toGoLive), tone: 'info' },
          { label: 'of which no wave', value: String(noWave), tone: noWave > 0 ? 'warn' : 'neutral' },
        ],
      },
      progress: {
        type: 'progress',
        rows: [
          { label: 'Trainings completed', value: _num(k.trainings_done), max: _num(k.trainings_total) || total, tone: 'info' },
          { label: 'Webinars completed', value: _num(k.webinar_done), max: _num(k.webinar_total) || total, tone: 'info' },
        ],
      },
      timeline: next
        ? { type: 'timeline', events: [{ date: _dateLabel(next.start), label: _waveLabel({ wave: next.wave, count: _num(next.locations_count) }), tone: 'info' }] }
        : { type: 'pill', tone: 'ok', text: 'Every wave has started', sub: 'in the schedule' },
    },
  };
}

export const VARIANT_BLOCKS_PROGRESS = {
  s: ['waffle'],
  s2: ['waffle', 'tiles'],
  m: ['waffle', 'timeline'],
  m2: ['waffle', 'tiles', 'progress'],
  l: ['waffle', 'tiles', 'progress', 'timeline'],
};

/**
 * @param {ReturnType<typeof fromDashboard>} d
 * @returns {{blocks: Object<string, object>, empty: string|null}}
 */
export function buildWavesBlocks(d) {
  if (d.storage !== 'ok' || !d.available) return { blocks: {}, empty: SYNC_TEXT };
  if (!d.waves.length) return { blocks: {}, empty: NO_WAVES_TEXT };
  const list = d.waves.slice(0, MAX_WAVES);
  // Chronological, and only what is still ahead: a wave's webinar comes BEFORE its start and
  // is often already past (wave 1: webinar 29.09, start 13.10).
  const events = [];
  for (const t of list) {
    events.push({ iso: t.start, date: _dateLabel(t.start), label: _waveLabel(t), tone: t.status === 'current' ? 'warn' : 'info' });
    if (t.webinarDate && (!d.today || t.webinarDate >= d.today)) events.push({ iso: t.webinarDate, date: _dateLabel(t.webinarDate), label: 'Webinar · wave ' + t.wave, tone: 'neutral' });
  }
  events.sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : 0));
  events.forEach((e) => { delete e.iso; });
  const rows = [];
  for (const t of list) {
    rows.push({ label: 'Wave ' + t.wave + ' · training', value: t.pctTraining, max: 100, display: _dec(t.pctTraining) + '%', tone: t.status === 'current' ? 'warn' : 'info' });
    rows.push({ label: 'Wave ' + t.wave + ' · webinar', value: t.pctWebinar, max: 100, display: _dec(t.pctWebinar) + '%', tone: 'neutral' });
  }
  return { empty: null, blocks: { timeline: { type: 'timeline', events }, progress: { type: 'progress', rows } } };
}

export const VARIANT_BLOCKS_WAVES = {
  m: ['timeline'],
  m2: ['progress'],
  l: ['timeline'],
  xl: ['timeline', 'progress'],
};

export const VARIANT_BLOCKS = { 'rollout-progress': VARIANT_BLOCKS_PROGRESS, 'rollout-next-waves': VARIANT_BLOCKS_WAVES };

/** @returns {string} HTML */
export function paint(d, widgetId, variantId, size, kit) {
  const isWaves = widgetId === 'rollout-next-waves';
  const { blocks, empty } = isWaves ? buildWavesBlocks(d) : buildProgressBlocks(d);
  if (empty) return kit.empty(empty);
  const table = isWaves ? VARIANT_BLOCKS_WAVES : VARIANT_BLOCKS_PROGRESS;
  const keys = table[variantId] || (isWaves ? table.m2 : table.m);
  return kit.blocks(keys.map((k) => blocks[k]).filter(Boolean), size);
}

// One in-flight request per apiBase, dropped on settle. A caller's own abort
// signal only stops ITS wait: the shared request is not aborted, so the other
// frame still gets its answer.
const _inflight = new Map();

function _abortError() {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

function _abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(_abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(_abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then((v) => { signal.removeEventListener('abort', onAbort); resolve(v); },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e); });
  });
}

export function sharedLoad(apiBase, signal) {
  let p = _inflight.get(apiBase);
  if (!p) {
    p = (async () => {
      const res = await fetch(apiBase + '/dashboard?lean=1');
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      if (!res.ok) {
        const err = new Error((body && body.message) || ('HTTP ' + res.status));
        err.userMessage = body && body.message ? body.message : null;
        throw err;
      }
      return body;
    })();
    _inflight.set(apiBase, p);
    const clear = () => { if (_inflight.get(apiBase) === p) _inflight.delete(apiBase); };
    p.then(clear, clear);
  }
  return _abortable(p, signal);
}

function _today() {
  const n = new Date();
  return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0');
}

export async function renderWidget(el, ctx) {
  let disposed = false;
  let html;
  try {
    const payload = await sharedLoad(ctx.apiBase, ctx.signal);
    html = paint(fromDashboard(payload, _today()), ctx.widgetId, ctx.variant.id, { cols: ctx.variant.cols, rows: ctx.variant.rows }, ctx.kit);
  } catch (e) {
    if (ctx.signal && ctx.signal.aborted) throw e;
    if (e && e.userMessage) html = ctx.kit.empty(e.userMessage);
    else throw e;
  }
  if (!disposed && !(ctx.signal && ctx.signal.aborted)) el.innerHTML = html;
  return () => { disposed = true; };
}
