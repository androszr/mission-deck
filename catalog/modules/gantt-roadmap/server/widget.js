'use strict';
// modules/gantt-roadmap/server/widget.js
// READ-ONLY aggregate for the dashboard widget (GET /widget). Unlike
// store.readQuarter it NEVER repairs duplicate display numbers: it reads
// index.json, quarter.json, areas/ and the task shards and writes nothing, so a
// dashboard visit cannot change team data. No lock is taken.

const store = require('./store.js');
const { storageState } = require('./paths.js');

const DAY = 86400000;
const TASK_CAP = 8;
const OWNER_CAP = 12;
const AREA_CAP = 6;
const MS_WINDOW = 2;

function _utc(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
}

function _iso(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** ISO 8601 week number of a UTC day. */
function _isoWeek(ms) {
  const d = new Date(ms);
  const day = d.getUTCDay() || 7;
  const thu = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 4 - day);
  const y0 = Date.UTC(new Date(thu).getUTCFullYear(), 0, 1);
  return Math.ceil(((thu - y0) / DAY + 1) / 7);
}

/** [{s,l}] segments a task occupies (phases when present). */
function _segments(t) {
  const src = Array.isArray(t.ph) && t.ph.length ? t.ph : [{ s: t.s, l: t.l }];
  return src
    .filter((p) => p && p.s !== null && p.s !== undefined && p.s !== '')
    .map((p) => ({ s: Number(p.s), l: Math.max(1, Number(p.l) || 1) }))
    .filter((p) => Number.isFinite(p.s) && p.s >= 1);
}

function _covers(segs, w) {
  return segs.some((p) => w >= p.s && w <= p.s + p.l - 1);
}

/**
 * @param {string} rootDir ctx.rootDir
 * @param {Date} [now]
 * @returns {object} the /widget answer body
 */
function buildWidgetPayload(rootDir, now = new Date()) {
  const generatedAt = now.toISOString();
  const state = storageState(rootDir);
  // 'empty' (cloned, nothing decrypted yet) is passed through as-is: it is not
  // 'ok', so the widget paints the Synchronizacja sentence, never a zero.
  if (state !== 'ok') return { available: false, storage: state, generated_at: generatedAt };
  const index = store.readIndex(rootDir);
  const qId = index && typeof index.activeQuarter === 'string' ? index.activeQuarter : null;
  let meta = null;
  try {
    meta = qId ? store.readQuarterMeta(rootDir, qId) : null;
  } catch {
    meta = null;
  }
  const mondayMs = meta ? _utc(meta.mondayFirst) : null;
  const weeksN = meta ? Number(meta.weeksN) : 0;
  if (!qId || !meta || mondayMs === null || !(weeksN > 0)) {
    return { available: false, storage: 'ok', generated_at: generatedAt };
  }

  const quarter = { id: qId, label: typeof meta.label === 'string' && meta.label ? meta.label : qId, weeksN };
  const todayMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const w = Math.floor((todayMs - mondayMs) / (7 * DAY)) + 1;
  if (w < 1 || w > weeksN) {
    return { available: true, storage: 'ok', generated_at: generatedAt, quarter, week: null };
  }
  const weekStart = mondayMs + (w - 1) * 7 * DAY;
  // Week numbers exactly as the module's own Gantt header labels them
  // (weekFirstNo + i, client/index.js _ganttHeaderHtml); ISO only as a fallback.
  const firstNo = Number(meta.weekFirstNo);
  const weekNo = (i) => (Number.isFinite(firstNo) && firstNo > 0 ? firstNo + i - 1 : _isoWeek(mondayMs + (i - 1) * 7 * DAY));
  const weekInfo = { index: w, no: weekNo(w), from: _iso(weekStart), to: _iso(weekStart + 6 * DAY) };

  // The sprint of TODAY, by date when the sprint has one (the view draws its
  // sprint band day-precise: client/gantt.js sprintSegs), else by w1/w2. A week
  // shared by two sprints must not answer the one that ended on its Monday.
  let sprint = null;
  for (const sp of Array.isArray(meta.sprints) ? meta.sprints : []) {
    if (!sp || typeof sp !== 'object') continue;
    const st = _utc(sp.start);
    const days = Number(sp.days);
    const hit = st !== null && days > 0
      ? todayMs >= st && todayMs <= st + (days - 1) * DAY
      : Number.isFinite(Number(sp.w1)) && Number.isFinite(Number(sp.w2)) && w >= Number(sp.w1) && w <= Number(sp.w2);
    if (hit) {
      sprint = { no: sp.no === undefined ? null : sp.no, label: typeof sp.label === 'string' ? sp.label : '' };
      break;
    }
  }

  const roster = Array.isArray(meta.roster) ? meta.roster : [];
  const nameOf = {};
  for (const p of roster) if (p && typeof p.id === 'string') nameOf[p.id] = typeof p.n === 'string' && p.n ? p.n : p.id;
  const areas = store.listAreas(rootDir, qId);
  const areaName = {};
  for (const a of areas) areaName[a.id] = a.name || a.id;

  // A shard without a usable start week has no place on the timeline (and would
  // turn its end date into NaN); it is left out rather than failing the route.
  const shards = store.listTaskShards(rootDir, qId).filter((t) => t && typeof t.t === 'string' && _segments(t).length > 0);
  const counts = { active: 0, done: 0, upcoming: 0, endingThisWeek: 0, milestones: 0 };
  const active = [];
  const milestones = [];
  for (const t of shards) {
    const segs = _segments(t);
    const first = Math.min(...segs.map((p) => p.s));
    const last = Math.max(...segs.map((p) => p.s + p.l - 1));
    const status = _covers(segs, w) ? 'active' : last < w ? 'done' : first > w ? 'upcoming' : 'active';
    counts[status] += 1;
    const owners = (Array.isArray(t.who) ? t.who : []).map((id) => nameOf[id]).filter(Boolean);
    const row = {
      title: t.t,
      owners,
      status,
      ms: Boolean(t.ms),
      until: _iso(mondayMs + (last - 1) * 7 * DAY + 4 * DAY),
      _end: last,
    };
    if (status === 'active') {
      if (last === w) counts.endingThisWeek += 1;
      active.push(row);
    }
    if (t.ms && last >= w - MS_WINDOW && first <= w + MS_WINDOW) {
      counts.milestones += 1;
      milestones.push(row);
    }
  }
  const byEnd = (a, b) => a._end - b._end || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
  active.sort(byEnd);
  milestones.sort(byEnd);
  // Owners after the sort, so each person's `title` is their task ending soonest
  // (deterministic, not the directory order of the shards).
  const ownerMap = new Map();
  for (const row of active) {
    for (const name of row.owners) {
      const o = ownerMap.get(name) || { name, count: 0, title: row.title };
      o.count += 1;
      ownerMap.set(name, o);
    }
  }
  const picked = [];
  for (const r of [...active, ...milestones]) if (!picked.includes(r)) picked.push(r);
  picked.sort(byEnd);
  const clean = (r) => ({ title: r.title, owners: r.owners, status: r.status, ms: r.ms, until: r.until });

  // Areas x weeks (w-2 .. w+2, clipped to the quarter): how many tasks cover each cell.
  const wFrom = Math.max(1, w - MS_WINDOW);
  const wTo = Math.min(weeksN, w + MS_WINDOW);
  const weekIdx = [];
  for (let i = wFrom; i <= wTo; i++) weekIdx.push(i);
  const heat = areas.map((a) => ({
    name: areaName[a.id],
    values: weekIdx.map((i) => shards.filter((t) => t.a === a.id && _covers(_segments(t), i)).length),
  })).filter((r) => r.values.some((v) => v > 0)).slice(0, AREA_CAP);

  return {
    available: true,
    storage: 'ok',
    generated_at: generatedAt,
    quarter,
    week: weekInfo,
    sprint,
    counts,
    tasks: picked.slice(0, TASK_CAP).map(clean),
    milestones: milestones.map(clean),
    owners: [...ownerMap.values()].sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1)).slice(0, OWNER_CAP),
    heat: {
      rows: heat.map((r) => r.name),
      cols: weekIdx.map((i) => 'T' + weekNo(i)),
      values: heat.map((r) => r.values),
    },
  };
}

module.exports = { buildWidgetPayload };
