// modules/roadmap/client/widget.js
// Dashboard widget "Top initiatives" (contract: modules-template/README.md,
// "Widget na pulpicie"). Reads GET <apiBase>/widget - the top 5 initiatives with
// done/total of their Jira tasks. No fallback to /initiatives: that answer carries
// whole documents, so on a server that has not been restarted (404) the tile asks
// for a restart. No static import from the core's /js/: the kit arrives as ctx.kit.

const RESTART_HINT = 'The tile needs a server restart: Settings > Restart server.';

function _day(iso) {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? m[2] + '.' + m[1] : '';
}

function _tone(i) {
  if (!i.total) return 'neutral';
  if (i.done >= i.total) return 'ok';
  return i.done === 0 ? 'warn' : 'info';
}

function _label(i) {
  return i.rank !== null && i.rank !== undefined ? i.rank + '. ' + i.title : i.title;
}

function _isoToday(now) {
  const d = now instanceof Date ? now : new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/** Go-Live tone: a date already past with work still open is late ('warn'). */
export function goLiveTone(i, todayIso) {
  if (i.total && i.done >= i.total) return 'ok';
  return i.goLiveDate < todayIso ? 'warn' : 'info';
}

/** @returns {{blocks: Object<string, object>, empty: string|null}} */
export function buildBlocks(data, now) {
  if (!data || data.storage !== 'ok' || !Array.isArray(data.initiatives)) {
    if (data && data.error === 'storage-unavailable') return { blocks: {}, empty: 'No team data. Pull the "Team data" source in the Sync window.' };
    return { blocks: {}, empty: 'No initiatives. Open the Roadmap view.' };
  }
  const list = data.initiatives;
  if (list.length === 0) return { blocks: {}, empty: 'No initiatives. Open the Roadmap view.' };
  const blocks = {};
  blocks.progress = {
    type: 'progress',
    rows: list.map((i) => ({
      label: _label(i), value: i.done, max: i.total || 1, tone: _tone(i), person: i.po || undefined,
      display: i.total ? i.done + '/' + i.total : 'no tasks',
    })),
  };
  const first = list[0];
  blocks.donut = {
    type: 'donut', value: first.done, max: first.total || 1, center: first.total ? first.done + '/' + first.total : '-',
    label: _label(first) + (first.total ? ' · Jira tasks' : ' · no Jira tasks'), tone: _tone(first) === 'neutral' ? 'info' : _tone(first),
  };
  const today = _isoToday(now);
  const events = list.filter((i) => i.goLiveDate).sort((a, b) => (a.goLiveDate < b.goLiveDate ? -1 : 1))
    .map((i) => {
      const late = goLiveTone(i, today) === 'warn';
      return { date: _day(i.goLiveDate), label: (late ? 'Overdue: ' : 'Go-Live: ') + i.title, tone: goLiveTone(i, today), person: i.po || undefined };
    });
  if (events.length) blocks.timeline = { type: 'timeline', events };
  const owners = [...new Set(list.map((i) => i.po).filter(Boolean))];
  if (owners.length) blocks.avatars = { type: 'avatars', label: 'Initiative owners (PO)', people: owners.map((name) => ({ name, tone: 'info' })), max: 5 };
  const sum = (k) => list.reduce((a, i) => a + (i[k] || 0), 0);
  const total = sum('total');
  if (total > 0) {
    blocks.segments = {
      type: 'segments', label: 'Jira tasks in the top ' + list.length,
      segments: [
        { label: 'Done', value: sum('done'), tone: 'ok' },
        { label: 'In progress', value: sum('inProgress'), tone: 'info' },
        { label: 'Open', value: Math.max(0, total - sum('done') - sum('inProgress')), tone: 'neutral' },
      ],
    };
  }
  return { blocks, empty: null };
}

export const VARIANT_BLOCKS = {
  m: ['donut', 'timeline'],
  m2: ['progress', 'avatars'],
  l: ['progress', 'timeline'],
  xl: ['progress', 'timeline', 'segments'],
};

/** @returns {string} HTML for a variant */
export function paint(data, variantId, size, kit, now) {
  const { blocks, empty } = buildBlocks(data, now);
  if (empty) return kit.empty(empty);
  const keys = VARIANT_BLOCKS[variantId] || VARIANT_BLOCKS.l;
  const picked = keys.map((k) => blocks[k]).filter(Boolean);
  return kit.blocks(picked.length ? picked : [blocks.progress], size);
}

export async function renderWidget(el, ctx) {
  let disposed = false;
  const res = await fetch(ctx.apiBase + '/widget', { signal: ctx.signal });
  if (res.status === 404) {
    if (!(ctx.signal && ctx.signal.aborted)) el.innerHTML = ctx.kit.empty(RESTART_HINT);
    return () => { disposed = true; };
  }
  let data;
  if (res.status === 409) data = { error: 'storage-unavailable' };
  else if (!res.ok) throw new Error('HTTP ' + res.status);
  else data = await res.json();
  if (!disposed && !(ctx.signal && ctx.signal.aborted)) {
    el.innerHTML = paint(data, ctx.variant.id, { cols: ctx.variant.cols, rows: ctx.variant.rows }, ctx.kit);
  }
  return () => { disposed = true; };
}
