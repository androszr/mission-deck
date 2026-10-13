// modules/prod-bugs/client/prod-bugs-model.mjs
// Pure logic, DOM-free: the data helpers of the prod-bugs view.
// No module-level state: the cache lives in client/index.js only (a data pull
// reloads just the entry file).

export const AREA_CONFIG = [
  { key: 'orders', label: 'Orders', color: 'var(--legend-1st-primary)' },
  { key: 'otherModules', label: 'Other modules', color: 'var(--legend-3rd-primary)' },
  { key: 'platform', label: 'Platform (Comet)', color: 'var(--legend-5th-primary)' },
];

/** Ascending copy by sprint number. */
export function sortSprints(sprints) {
  return [...(Array.isArray(sprints) ? sprints : [])].sort((a, b) => a.sprint - b.sprint);
}

/**
 * @param {object[]} sprints any order
 * @param {string|number} filter 'latest' or a sprint number
 * @returns {object|null} the shard; unknown number falls back to the latest
 */
export function selectSprint(sprints, filter) {
  const sorted = sortSprints(sprints);
  if (!sorted.length) return null;
  const latest = sorted[sorted.length - 1];
  if (filter === 'latest' || filter === undefined || filter === null) return latest;
  const num = parseInt(filter, 10);
  return sorted.find((s) => s.sprint === num) || latest;
}

/** Bugs of one shard and bucket ('open' | 'resolved'), tagged with area and sprint. */
export function collectBugs(sprintData, bucket) {
  const listKey = bucket === 'open' ? 'openBugs' : 'resolvedBugs';
  if (!sprintData || !sprintData.areas) return [];
  const bugs = [];
  for (const cfg of AREA_CONFIG) {
    const area = sprintData.areas[cfg.key];
    if (!area) continue;
    for (const b of (area[listKey] || [])) {
      const entry = typeof b === 'string' ? { key: b } : b;
      bugs.push({ ...entry, area: cfg.key, areaLabel: cfg.label, bucket, sprint: sprintData.sprint });
    }
  }
  return bugs;
}

/** Resolved bugs of every sprint, de-duplicated by key + sprint. */
export function collectResolvedAllSprints(sprints) {
  const seen = new Set();
  const out = [];
  for (const sp of sortSprints(sprints)) {
    for (const b of collectBugs(sp, 'resolved')) {
      const k = b.key + '_' + b.sprint;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(b);
    }
  }
  return out;
}

/** Area filter ('all' or a key) plus case-insensitive search over key/summary/status/priority. */
export function applyFilters(bugs, area, search) {
  let list = bugs;
  if (area && area !== 'all') list = list.filter((b) => b.area === area);
  const q = String(search || '').trim().toLowerCase();
  if (q) {
    list = list.filter((b) =>
      (b.key && b.key.toLowerCase().includes(q))
      || (b.summary && b.summary.toLowerCase().includes(q))
      || (b.status && b.status.toLowerCase().includes(q))
      || (b.priority && b.priority.toLowerCase().includes(q)));
  }
  return list;
}

/** @returns {'resolved'|'blocked'|'testing'|'new'|'open'} */
export function statusCategory(bug) {
  const s = String((bug && bug.status) || '').toLowerCase();
  if (s.includes('closed') || s.includes('done') || s.includes('resolved')) return 'resolved';
  if (s.includes('block')) return 'blocked';
  if (s.includes('test') || s.includes('ready for')) return 'testing';
  if (s.includes('new')) return 'new';
  return 'open';
}

export function statusBadgeClass(cat) {
  switch (cat) {
    case 'resolved': return 'ds-badge--green';
    case 'blocked': return 'ds-badge--red';
    case 'testing': return 'ds-badge--violet';
    case 'new': return 'ds-badge--blue';
    default: return 'ds-badge--mandarine';
  }
}

/** Tone of the big number: 0 success, 1-3 warning, more danger. */
export function bugTone(count) {
  const n = Number(count) || 0;
  if (n <= 0) return 'success';
  if (n <= 3) return 'warning';
  return 'danger';
}

export function fmtDays(days) {
  if (typeof days !== 'number' || !Number.isFinite(days)) return '—';
  return days.toFixed(1) + ' days';
}

/** 'YYYY-MM-DD[...]' -> 'dd.mm.yyyy'; anything else -> dash. */
export function fmtDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return m ? m[3] + '.' + m[2] + '.' + m[1] : '—';
}
