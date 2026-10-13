// modules/gantt-roadmap/client/gantt.js
// Pure engine helpers, free of document access - zero imports from the core.
// Re-used on the server side (store.js, server/index.js) via dynamic
// import(pathToFileURL(...)) the same way server.js loads
// js/tworca-cockpit-stages.mjs. This is an ES module (.js with type:module
// semantics when loaded via import()) so server CJS code reaches it with:
//
//   const { pathToFileURL } = require('url');
//   const ganttPath = path.join(__dirname, '..', 'client', 'gantt.js');
//   const { normRow, resolveDisplayDuplicates, ... } = await import(pathToFileURL(ganttPath).href);
//
// The file has no side effects at module evaluation time, which is required
// for that pattern to work safely.

// ---- Colour palette (closed) -----------------------------------------------
export const AREA_COLORS = [
  'blue', 'green', 'teal', 'yellow', 'orange', 'red', 'gray',
  'violet', 'magenta', 'cyan', 'brand', 'navy',
];

// ---- Validation regexes (re-exported for server/store.js) ------------------
export const TASK_UID_RE = /^t-[0-9a-f]{16}$/;
export const BACKLOG_UID_RE = /^bl-[0-9a-f]{12,16}$/;
export const QUARTER_ID_RE = /^q[1-4]-\d{4}$/;
export const AREA_ID_RE = /^[a-z][a-z0-9-]{1,30}$/;
export const TOMBSTONE_RE = /^_n\d+$/;

// ---- Calendar helpers -------------------------------------------------------

/**
 * Returns month segments covering weeksN weeks starting from mondayFirst.
 * Each segment: { month (0-based), label, start (week index 0-based), len }
 * @param {string} mondayFirst ISO date of the first Monday (e.g. "2026-09-21")
 * @param {number} weeksN total number of weeks in the quarter
 * @returns {Array<{month: number, label: string, start: number, len: number}>}
 */
export function monthSegs(mondayFirst, weeksN) {
  const MONTHS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const base = new Date(mondayFirst + 'T00:00:00Z');
  const segs = [];
  let cur = null;
  for (let w = 0; w < weeksN; w++) {
    const d = new Date(base.getTime() + w * 7 * 24 * 3600 * 1000);
    const m = d.getUTCMonth();
    if (cur && cur.month === m) {
      cur.len++;
    } else {
      cur = { month: m, label: MONTHS[m], start: w, len: 1 };
      segs.push(cur);
    }
  }
  return segs;
}

/**
 * Day offset of isoDate from mondayFirst (in days; can be negative or >= daysN).
 * @param {string} mondayFirst ISO date "YYYY-MM-DD" (UTC)
 * @param {string} isoDate ISO date "YYYY-MM-DD" (UTC)
 * @returns {number}
 */
export function dateToDayOffset(mondayFirst, isoDate) {
  const base = new Date(mondayFirst + 'T00:00:00Z').getTime();
  const d = new Date(isoDate + 'T00:00:00Z').getTime();
  return Math.round((d - base) / (24 * 3600 * 1000));
}

/**
 * Percentage position of a day offset within totalDays (0..100).
 * @param {number} dayOffset
 * @param {number} totalDays
 * @returns {number}
 */
export function dayPct(dayOffset, totalDays) {
  return (dayOffset / totalDays) * 100;
}

/**
 * Month segments by exact day boundaries.
 * Each segment: { month (0-based), label, startDay, days }
 * @param {string} mondayFirst ISO date of first day of quarter
 * @param {number} daysN total number of days in the quarter (weeksN * 7)
 * @returns {Array<{month: number, label: string, startDay: number, days: number}>}
 */
export function monthSegsByDay(mondayFirst, daysN) {
  const MONTHS = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const base = new Date(mondayFirst + 'T00:00:00Z');
  const segs = [];
  let cur = null;
  for (let d = 0; d < daysN; d++) {
    const date = new Date(base.getTime() + d * 24 * 3600 * 1000);
    const m = date.getUTCMonth();
    if (cur && cur.month === m) {
      cur.days++;
    } else {
      cur = { month: m, label: MONTHS[m], startDay: d, days: 1 };
      segs.push(cur);
    }
  }
  return segs;
}

/**
 * Sprint segments with day precision, clipped to quarter range.
 * Sprints carry start (ISO date, a Tuesday) and days:14 when available;
 * falls back to w1/w2 (1-based week indices within quarter) when not.
 * @param {string} mondayFirst ISO date of first day of quarter
 * @param {number} daysN total days in the quarter
 * @param {Array<{no: number, start?: string, days?: number, w1?: number, w2?: number, label?: string}>} sprints
 * @returns {Array<{no: number, label: string, startDay: number, days: number}>}
 */
export function sprintSegs(mondayFirst, daysN, sprints) {
  if (!sprints || !sprints.length) return [];
  const result = [];
  for (const sp of sprints) {
    let startDay;
    let spDays;
    if (sp.start) {
      startDay = dateToDayOffset(mondayFirst, sp.start);
      spDays = sp.days || 14;
    } else if (sp.w1 !== undefined) {
      startDay = (sp.w1 - 1) * 7;
      spDays = (sp.w2 - sp.w1 + 1) * 7;
    } else {
      continue;
    }
    const clippedStart = Math.max(0, startDay);
    const clippedEnd = Math.min(daysN, startDay + spDays);
    if (clippedEnd <= clippedStart) continue;
    result.push({
      no: sp.no,
      label: sp.label || ('S' + sp.no),
      startDay: clippedStart,
      days: clippedEnd - clippedStart,
    });
  }
  return result;
}

/**
 * Label for a week number (e.g. 39 -> "W39").
 * @param {number} no
 * @returns {string}
 */
export function weekLabel(no) {
  return 'W' + no;
}

// ---- Phase helpers ----------------------------------------------------------

/**
 * Assigns vertical lanes to phases to avoid horizontal overlaps.
 * Two phases overlap when their ranges [s, s+l) intersect.
 * Returns an array of lane indices (same order as phases input).
 * @param {Array<{s: number, l: number}>} phases
 * @returns {number[]}
 */
export function phaseLanes(phases) {
  const lanes = [];
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    const used = new Set();
    for (let j = 0; j < i; j++) {
      const q = phases[j];
      // overlap when ranges [p.s, p.s+p.l) and [q.s, q.s+q.l) intersect
      if (p.s < q.s + q.l && p.s + p.l > q.s) {
        used.add(lanes[j]);
      }
    }
    let lane = 0;
    while (used.has(lane)) lane++;
    lanes.push(lane);
  }
  return lanes;
}

/**
 * Calculates the bounding envelope of a task.
 * Without phases: returns {s: task.s, l: task.l}.
 * With phases: returns {s: min(ph.s), l: max(ph.s+ph.l) - min(ph.s)}.
 * @param {{s: number, l: number, ph?: Array<{s: number, l: number}>}} task
 * @returns {{s: number, l: number}}
 */
export function envelope(task) {
  if (!task.ph || task.ph.length === 0) return { s: task.s, l: task.l };
  const start = Math.min(...task.ph.map((p) => p.s));
  const end = Math.max(...task.ph.map((p) => p.s + p.l));
  return { s: start, l: end - start };
}

/**
 * Returns the set of week numbers (1-based) a task occupies.
 * Uses phases if present, otherwise uses task s/l directly.
 * @param {{s: number, l: number, ph?: Array<{s: number, l: number}>}} task
 * @returns {Set<number>}
 */
export function busyWeeks(task) {
  const weeks = new Set();
  const sources = (task.ph && task.ph.length) ? task.ph : [{ s: task.s, l: task.l }];
  for (const seg of sources) {
    for (let w = seg.s; w < seg.s + seg.l; w++) weeks.add(w);
  }
  return weeks;
}

// ---- Normalization & validation --------------------------------------------

/**
 * Validates and normalises a patch object against a task.
 * Clamps s/l to [1, weeksN], filters who to rosterIds, validates phases.
 * When ms (milestone) is true: forces l = 0, ph = null.
 * Returns a clean patch object (only the keys that were in the input patch).
 * Throws {code, message} on invalid input.
 * @param {object} task existing task (or {})
 * @param {object} patch incoming patch
 * @param {{weeksN: number, rosterIds: string[]}} opts
 * @returns {object}
 */
export function normRow(task, patch, { weeksN, rosterIds }) {
  const out = {};

  // title
  if ('t' in patch) {
    const t = String(patch.t || '').trim();
    if (!t) throw { code: 'invalid-title', message: 'The task title cannot be empty.' };
    if (t.length > 200) throw { code: 'invalid-title', message: 'The task title cannot exceed 200 characters.' };
    out.t = t;
  }

  // milestone: forces l=0, ph=null
  if ('ms' in patch) {
    out.ms = Boolean(patch.ms);
    if (out.ms) {
      out.l = 0;
      out.ph = null;
    }
  }

  const isMilestone = 'ms' in out ? out.ms : Boolean(task.ms);

  // start week
  if ('s' in patch) {
    let s = Math.round(Number(patch.s));
    if (!Number.isFinite(s)) throw { code: 'invalid-s', message: 'Invalid start week.' };
    s = Math.max(1, Math.min(weeksN, s));
    out.s = s;
  }

  // length
  if ('l' in patch && !isMilestone) {
    let l = Math.round(Number(patch.l));
    if (!Number.isFinite(l)) throw { code: 'invalid-l', message: 'Invalid task length.' };
    l = Math.max(1, Math.min(weeksN, l));
    out.l = l;
  }

  // people
  if ('who' in patch) {
    if (!Array.isArray(patch.who)) throw { code: 'invalid-who', message: 'The list of people must be an array.' };
    const rosterSet = new Set(rosterIds);
    out.who = patch.who.filter((id) => typeof id === 'string' && rosterSet.has(id));
  }

  // phases (only when not milestone)
  if ('ph' in patch && !isMilestone) {
    if (patch.ph === null) {
      out.ph = null;
    } else if (!Array.isArray(patch.ph)) {
      throw { code: 'invalid-ph', message: 'Phases must be an array or null.' };
    } else {
      const validated = [];
      for (const ph of patch.ph) {
        if (!ph || typeof ph !== 'object') throw { code: 'invalid-ph', message: 'Invalid phase.' };
        let ps = Math.round(Number(ph.s));
        let pl = Math.round(Number(ph.l));
        if (!Number.isFinite(ps) || !Number.isFinite(pl)) throw { code: 'invalid-ph', message: 'Invalid phase week or length.' };
        ps = Math.max(1, Math.min(weeksN, ps));
        pl = Math.max(1, Math.min(weeksN - ps + 1, pl));
        const n = typeof ph.n === 'string' ? ph.n.trim().slice(0, 60) : '';
        validated.push({ n, s: ps, l: pl });
      }
      out.ph = validated.length ? validated : null;
    }
  }

  // area id
  if ('a' in patch) {
    const a = String(patch.a || '').trim();
    if (!AREA_ID_RE.test(a)) throw { code: 'invalid-area', message: 'Invalid area id.' };
    out.a = a;
  }

  // giewont flag
  if ('gw' in patch) out.gw = Boolean(patch.gw);

  // order
  if ('o' in patch) {
    const o = Math.round(Number(patch.o));
    if (!Number.isFinite(o) || o < 1) throw { code: 'invalid-o', message: 'Invalid order.' };
    out.o = o;
  }

  // keep the whole bar inside the quarter: s and l are clamped one by one
  // above, so s + l - 1 could still run past weeksN (phases already are)
  if (!isMilestone && ('s' in out || 'l' in out)) {
    const effS = 's' in out ? out.s : Math.round(Number(task.s)) || 1;
    const effL = 'l' in out ? out.l : Math.round(Number(task.l)) || 1;
    const maxL = Math.max(1, weeksN - effS + 1);
    if (effL > maxL) out.l = maxL;
  }

  return out;
}

// ---- Display number helpers -------------------------------------------------

/**
 * Returns the next available display number (max of all shard n values and
 * tombstone numbers + 1). Pure: no side effects.
 * @param {Array<{n?: number}>} shards
 * @param {string[]} tombstoneNames list of tombstone filenames like "_n25"
 * @returns {number}
 */
export function assignDisplayNumber(shards, tombstoneNames) {
  let max = 0;
  for (const s of shards) {
    if (typeof s.n === 'number' && s.n > max) max = s.n;
  }
  for (const name of tombstoneNames) {
    const m = name.match(/^_n(\d+)$/);
    if (m) {
      const v = parseInt(m[1], 10);
      if (v > max) max = v;
    }
  }
  return max + 1;
}

/**
 * Resolves duplicate display numbers in a set of task shards.
 * Stable sort by createdAt then uid; the earlier task keeps its n, later
 * ones get the next free numbers. Pure, deterministic, unit-testable.
 * New numbers start past the highest tombstone too, so a deleted task's
 * number never comes back.
 * @param {Array<{uid: string, n: number, createdAt: string}>} shards
 * @param {string[]} [tombstoneNames] tombstone filenames like "_n25"
 * @returns {{ fixed: Array<{uid: string, oldN: number, newN: number}>, ok: Array<{uid: string, n: number}> }}
 */
export function resolveDisplayDuplicates(shards, tombstoneNames = []) {
  // find all duplicates
  const byN = new Map();
  for (const s of shards) {
    if (!byN.has(s.n)) byN.set(s.n, []);
    byN.get(s.n).push(s);
  }

  const fixed = [];
  const ok = [];

  // sort all shards by createdAt then uid (stable)
  const sorted = [...shards].sort((a, b) => {
    if (a.createdAt < b.createdAt) return -1;
    if (a.createdAt > b.createdAt) return 1;
    return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
  });

  // assign numbers: keep first occurrence of each n, renumber duplicates
  const usedN = new Set();
  let nextFree = 1;

  // first pass: mark which n values are used by "first" in sort order
  const keep = new Set(); // uids that keep their n
  const seenN = new Set();
  for (const s of sorted) {
    if (!seenN.has(s.n)) {
      seenN.add(s.n);
      keep.add(s.uid);
    }
  }

  // determine global max for renumbering
  nextFree = assignDisplayNumber(shards, tombstoneNames);

  // build result
  for (const s of sorted) {
    if (keep.has(s.uid)) {
      ok.push({ uid: s.uid, n: s.n });
      usedN.add(s.n);
    } else {
      while (usedN.has(nextFree)) nextFree++;
      fixed.push({ uid: s.uid, oldN: s.n, newN: nextFree });
      usedN.add(nextFree);
      nextFree++;
    }
  }

  return { fixed, ok };
}

// ---- Area helpers -----------------------------------------------------------

/**
 * Validates an area object.
 * Returns { valid: true } or { valid: false, error: string }.
 * @param {{id: string, name: string, color: string}} area
 * @param {string[]} palette allowed color keys
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateArea(area, palette) {
  if (!area || typeof area !== 'object') return { valid: false, error: 'Invalid area object.' };
  if (!area.name || !String(area.name).trim()) return { valid: false, error: 'The area name cannot be empty.' };
  if (!palette.includes(area.color)) return { valid: false, error: 'Invalid area colour: ' + area.color };
  if (area.id !== undefined && !AREA_ID_RE.test(area.id)) return { valid: false, error: 'Invalid area id: ' + area.id };
  return { valid: true };
}

/**
 * Generates an ASCII slug from an area name.
 * Strips diacritics, lowercases, replaces spaces with dashes,
 * strips non-ASCII-alphanumeric chars. Throws if input is empty.
 * @param {string} name
 * @returns {string}
 */
export function areaSlugFromName(name) {
  if (!name || !String(name).trim()) throw new Error('The area name cannot be empty.');
  const slug = String(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0142/g, 'l')
    .replace(/\u0141/g, 'L')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  if (!slug) throw new Error('Cannot generate a slug for the name: ' + name);
  return slug;
}

// ---- Conversion helpers ----------------------------------------------------

/**
 * Converts a backlog item to a task shard.
 * @param {{uid: string, t: string, createdAt: string}} item
 * @param {string} areaId
 * @param {number} n display number
 * @param {number} weeksN total weeks in quarter
 * @returns {object} task shard (without uid — caller assigns)
 */
export function backlogItemToTask(item, areaId, n, weeksN) {
  const s = 1;
  const l = Math.min(2, weeksN);
  return {
    a: areaId,
    t: item.t,
    n,
    o: 9999,
    who: [],
    s,
    l,
    ph: null,
    gw: false,
    ms: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: null,
  };
}

/**
 * Converts a task shard to a backlog item.
 * @param {{uid: string, t: string, a: string, createdAt: string}} task
 * @returns {object} backlog item shape (without uid — caller assigns)
 */
export function taskToBacklogItem(task) {
  return {
    t: task.t,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ---- Grouping --------------------------------------------------------------

/**
 * Groups tasks into display groups by mode.
 * @param {object[]} tasks task shards
 * @param {object[]} areas area shards (for ordering)
 * @param {object[]} roster roster entries
 * @param {'area'|'owner'|'none'} mode grouping mode
 * @returns {Array<{key: string, label: string, tasks: object[]}>}
 */
export function groupsOf(tasks, areas, roster, mode) {
  if (mode === 'none') {
    const sorted = [...tasks].sort((a, b) => (a.o || 0) - (b.o || 0) || (a.n || 0) - (b.n || 0));
    return [{ key: 'all', label: 'All', tasks: sorted }];
  }
  if (mode === 'owner') {
    const byOwner = new Map();
    for (const t of tasks) {
      const owner = (t.who && t.who[0]) || '__brak';
      if (!byOwner.has(owner)) byOwner.set(owner, []);
      byOwner.get(owner).push(t);
    }
    const rosterById = Object.fromEntries(roster.map((p) => [p.id, p]));
    return [...byOwner.entries()].map(([ownerId, ts]) => {
      const person = rosterById[ownerId];
      const label = person ? (person.n || person.id) : 'No owner';
      const sorted = ts.sort((a, b) => (a.o || 0) - (b.o || 0));
      return { key: 'owner:' + ownerId, label, tasks: sorted };
    });
  }
  // default: by area
  const areaOrder = Object.fromEntries(areas.map((a, i) => [a.id, a.o !== undefined ? a.o : i]));
  const byArea = new Map();
  for (const a of areas) byArea.set(a.id, []);
  for (const t of tasks) {
    const areaId = t.a;
    if (!byArea.has(areaId)) byArea.set(areaId, []);
    byArea.get(areaId).push(t);
  }
  const areaById = Object.fromEntries(areas.map((a) => [a.id, a]));
  return [...byArea.entries()]
    .sort((a, b) => (areaOrder[a[0]] || 0) - (areaOrder[b[0]] || 0))
    .map(([areaId, ts]) => {
      const area = areaById[areaId];
      const sorted = ts.sort((a, b) => (a.o || 0) - (b.o || 0));
      return { key: 'area:' + areaId, label: area ? area.name : areaId, tasks: sorted };
    });
}

// ---- Week-of-year display helpers ------------------------------------------

/**
 * Convert internal quarter-relative s (1-based) to ISO week-of-year.
 * weekFirstNo is the ISO week number of the quarter's first week.
 * @param {number} s 1-based quarter week index
 * @param {number} weekFirstNo ISO week number of the first quarter week
 * @returns {number} ISO week number
 */
export function weekNoToIdx(s, weekFirstNo) {
  return weekFirstNo + s - 1;
}

/**
 * Convert ISO week range [from, to] (inclusive) to internal s/l.
 * s = from - weekFirstNo + 1, l = to - from + 1.
 * Clamps to [1, weeksN].
 * @param {number} from ISO week number (start, inclusive)
 * @param {number} to ISO week number (end, inclusive)
 * @param {number} weekFirstNo ISO week number of the first quarter week
 * @param {number} weeksN total weeks in the quarter
 * @returns {{ s: number, l: number }}
 */
export function rangeToSL(from, to, weekFirstNo, weeksN) {
  const sRaw = from - weekFirstNo + 1;
  const lRaw = to - from + 1;
  const s = Math.max(1, Math.min(weeksN, sRaw));
  const l = Math.max(1, Math.min(weeksN - s + 1, lRaw));
  return { s, l };
}

/**
 * Convert internal s/l to ISO week range [from, to].
 * @param {number} s 1-based quarter week index
 * @param {number} l duration in weeks
 * @param {number} weekFirstNo ISO week number of the first quarter week
 * @returns {{ from: number, to: number }}
 */
export function slToRange(s, l, weekFirstNo) {
  const from = weekFirstNo + s - 1;
  const to = from + Math.max(1, l) - 1;
  return { from, to };
}
