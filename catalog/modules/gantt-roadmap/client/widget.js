// modules/gantt-roadmap/client/widget.js
// Dashboard widget "Roadmap: this week" (contract: modules-template/README.md,
// "Widget na pulpicie"). Reads GET <apiBase>/widget - the READ-ONLY aggregate of
// the current week (never /quarter: that route repairs and writes duplicates).
// On a server not restarted since the route was added (404) it paints a restart
// hint and nothing else. No static import from the core's /js/: the kit arrives
// as ctx.kit.

const MESSAGES = {
  unavailable: 'No roadmap data. Pull the data in the Sync window.',
  none: 'No roadmap for the current quarter.',
  restart: 'The tile needs a server restart: Settings > Restart server.',
};

function _dm(iso) {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? String(+m[2]) + '.' + m[1] : '';
}

/** @returns {{blocks: Object<string, object>, empty: string|null}} */
export function buildBlocks(data) {
  if (!data || data.storage !== 'ok') return { blocks: {}, empty: MESSAGES.unavailable };
  if (data.available === false) return { blocks: {}, empty: MESSAGES.none };
  if (!data.week) return { blocks: {}, empty: 'Outside the range of quarter ' + ((data.quarter && data.quarter.label) || '') };
  const { week, quarter, counts } = data;
  const sprint = data.sprint && data.sprint.label ? ' · ' + data.sprint.label : '';
  const owners = data.owners || [];
  const tasks = data.tasks || [];
  const tone = (t) => (t.ms ? 'warn' : t.status === 'done' ? 'ok' : 'info');
  const blocks = {
    donut: { type: 'donut', value: week.index, max: quarter.weeksN, center: 'W' + week.no, label: 'Week ' + week.index + ' of ' + quarter.weeksN + sprint, tone: 'info' },
    avatars: { type: 'avatars', label: 'Working on this week\'s tasks', people: owners.map((o) => ({ name: o.name, tone: 'ok' })), max: 5 },
    timeline: { type: 'timeline', events: tasks.map((t) => ({ date: _dm(t.until), label: t.title + (t.ms ? ' (milestone)' : ''), tone: tone(t), person: t.owners[0] || '' })) },
    people: { type: 'people', people: owners.map((o) => ({
      name: o.name,
      sub: o.title + (o.count > 1 ? ' +' + (o.count - 1) : ''),
      tone: o.count > 2 ? 'warn' : 'ok',
    })) },
    tiles: { type: 'tiles', tiles: [
      { label: 'Tasks in progress', value: String(counts.active), tone: 'info' },
      { label: 'Milestones ±2 weeks', value: String(counts.milestones), tone: counts.milestones > 0 ? 'warn' : 'neutral' },
      { label: 'Ending this week', value: String(counts.endingThisWeek), tone: 'ok' },
    ] },
  };
  if (data.heat && data.heat.rows && data.heat.rows.length) {
    blocks.heatmap = { type: 'heatmap', rows: data.heat.rows, cols: data.heat.cols, values: data.heat.values };
  }
  if (!owners.length) {
    const txt = counts.active > 0 ? counts.active + ' ' + (counts.active === 1 ? 'task' : 'tasks') + ' without an assignee' : 'No tasks this week';
    blocks.avatars = { type: 'pill', tone: counts.active > 0 ? 'warn' : 'ok', text: txt };
    blocks.people = blocks.avatars;
  }
  if (!tasks.length) blocks.timeline = { type: 'pill', tone: 'ok', text: 'No tasks this week', sub: 'W' + week.no };
  return { blocks, empty: null };
}

export const VARIANT_BLOCKS = {
  m: ['donut', 'avatars'],
  s2: ['donut', 'avatars'],
  m2: ['timeline', 'people'],
  l: ['donut', 'timeline', 'avatars'],
  xl: ['timeline', 'heatmap', 'tiles'],
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
  if (res.status === 404) {
    if (!(ctx.signal && ctx.signal.aborted)) el.innerHTML = ctx.kit.empty(MESSAGES.restart);
    return () => { disposed = true; };
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (!disposed && !(ctx.signal && ctx.signal.aborted)) {
    el.innerHTML = paint(data, ctx.variant.id, { cols: ctx.variant.cols, rows: ctx.variant.rows }, ctx.kit);
  }
  return () => { disposed = true; };
}
