'use strict';
// vendor-settlements/server/costs.js
// Read-only. Serves per-area worklog costs (hours and cost per person, per
// issue and per epic) that are produced OUTSIDE this module - for example by a
// Jira worklog export joined with daily rates. Two layouts are accepted, in
// this order, under vendor-settlements/costs/:
//   <area>/index.json + <area>/<YYYY-MM>.json   monthly shards
//   <area>.json                                 one monolith
// The assembled object is cached per source keyed by size-mtime of the file
// every successful export rewrites last (index.json / the monolith itself).

const fs = require('fs');
const path = require('path');
const { AREAS } = require('./store.js');

const COSTS_SUBDIR = 'costs';
const GROUP_FIELDS = ['monthly', 'hours_monthly', 'subareas', 'issues', 'persons'];

function newGroupShell(fragment, groupKey) {
  const shell = {};
  for (const k of Object.keys(fragment)) {
    if (!GROUP_FIELDS.includes(k)) shell[k] = fragment[k];
  }
  shell.monthly = {};
  shell.hours_monthly = {};
  if (groupKey === 'areas') shell.subareas = [];
  else shell.issues = [];
  return shell;
}

function mergePersonsAgg(target, fragment) {
  for (const [name, p] of Object.entries(fragment || {})) {
    const existing = target[name] || (target[name] = { hours: 0, cost: 0, issues: [] });
    existing.hours = Math.round((existing.hours + (p.hours || 0)) * 100) / 100;
    existing.cost = Math.round((existing.cost + (p.cost || 0)) * 100) / 100;
    existing.issues = Array.from(new Set([...existing.issues, ...(p.issues || [])])).sort();
  }
}

function mergeIssues(targetList, fragmentList) {
  const byKey = new Map(targetList.map((i) => [i.key, i]));
  for (const fragIssue of (fragmentList || [])) {
    let existing = byKey.get(fragIssue.key);
    if (!existing) {
      existing = {
        ...fragIssue,
        monthly: { ...(fragIssue.monthly || {}) },
        hours_monthly: { ...(fragIssue.hours_monthly || {}) },
        persons: (fragIssue.persons || []).map((p) => ({ ...p })),
      };
      byKey.set(fragIssue.key, existing);
      targetList.push(existing);
      continue;
    }
    Object.assign(existing.monthly, fragIssue.monthly || {});
    Object.assign(existing.hours_monthly, fragIssue.hours_monthly || {});
    const personByName = new Map(existing.persons.map((p) => [p.name, p]));
    for (const fp of (fragIssue.persons || [])) {
      let ep = personByName.get(fp.name);
      if (!ep) {
        ep = { ...fp, monthly: { ...(fp.monthly || {}) }, hours_monthly: { ...(fp.hours_monthly || {}) } };
        personByName.set(fp.name, ep);
        existing.persons.push(ep);
      } else {
        Object.assign(ep.monthly, fp.monthly || {});
        Object.assign(ep.hours_monthly, fp.hours_monthly || {});
      }
    }
  }
}

function mergeGroup(target, fragment, groupKey) {
  Object.assign(target.monthly, fragment.monthly || {});
  Object.assign(target.hours_monthly, fragment.hours_monthly || {});
  if (groupKey === 'areas') {
    const subByName = new Map(target.subareas.map((s) => [s.name, s]));
    for (const fragSub of (fragment.subareas || [])) {
      let tgtSub = subByName.get(fragSub.name);
      if (!tgtSub) {
        tgtSub = { name: fragSub.name, monthly: {}, hours_monthly: {}, persons: {}, issues: [] };
        subByName.set(fragSub.name, tgtSub);
        target.subareas.push(tgtSub);
      }
      Object.assign(tgtSub.monthly, fragSub.monthly || {});
      Object.assign(tgtSub.hours_monthly, fragSub.hours_monthly || {});
      mergePersonsAgg(tgtSub.persons, fragSub.persons || {});
      mergeIssues(tgtSub.issues, fragSub.issues || []);
    }
  } else {
    mergeIssues(target.issues, fragment.issues || []);
  }
}

function finalizeOrder(groups, groupKey) {
  for (const g of groups) {
    if (groupKey === 'areas') {
      g.subareas.sort((a, b) => a.name.localeCompare(b.name));
      for (const sub of g.subareas) {
        sub.issues.sort((a, b) => a.key.localeCompare(b.key));
        for (const issue of sub.issues) issue.persons.sort((a, b) => a.name.localeCompare(b.name));
      }
    } else {
      g.issues.sort((a, b) => {
        const costOf = (i) => Object.entries(i.monthly || {}).filter(([k]) => k.length === 7).reduce((s, [, v]) => s + v, 0);
        return costOf(b) - costOf(a);
      });
      for (const issue of g.issues) issue.persons.sort((a, b) => a.name.localeCompare(b.name));
    }
  }
}

/**
 * Merges per-month shard files back into the monolith shape. Null when the
 * shard dir has no usable index/keys. A corrupt shard is skipped with a
 * warning (`warn`, default console.warn) - a partial degrade.
 */
async function assembleCostsFromShards(shardDir, warn) {
  const log = warn || ((...a) => console.warn(...a));
  let index;
  try {
    index = JSON.parse(await fs.promises.readFile(path.join(shardDir, 'index.json'), 'utf8'));
  } catch {
    return null;
  }
  const keys = Array.isArray(index.keys) ? index.keys : [];
  if (keys.length === 0) return null;

  const meta = { ...(index.meta || {}) };
  const groupKey = meta.group_key || 'areas';
  const groupOrder = Array.isArray(meta.group_order) ? meta.group_order : [];
  delete meta.group_key;
  delete meta.group_order;
  delete meta.schema_version;
  delete meta.shard_count;
  delete meta.last_updated;
  const identityField = groupKey === 'areas' ? 'name' : 'key';

  const monthlyTotals = {};
  const dailyTotals = {};
  const dailyTotalsRated = {};
  const persons = {};
  const groupsById = new Map();

  for (const month of keys) {
    let shard;
    try {
      shard = JSON.parse(await fs.promises.readFile(path.join(shardDir, month + '.json'), 'utf8'));
    } catch {
      log('[vendor-settlements] shard skipped', month + '.json');
      continue;
    }
    Object.assign(monthlyTotals, shard.monthly_totals || {});
    Object.assign(dailyTotals, shard.daily_totals || {});
    Object.assign(dailyTotalsRated, shard.daily_totals_rated || {});
    Object.assign(persons, shard.persons || {});
    for (const fragment of (shard[groupKey] || [])) {
      const gid = fragment[identityField];
      let target = groupsById.get(gid);
      if (!target) {
        target = newGroupShell(fragment, groupKey);
        groupsById.set(gid, target);
      }
      mergeGroup(target, fragment, groupKey);
    }
  }

  if (groupsById.size === 0 && Object.keys(monthlyTotals).length === 0) return null;

  const orderedIds = groupOrder.filter((id) => groupsById.has(id));
  for (const id of groupsById.keys()) if (!orderedIds.includes(id)) orderedIds.push(id);
  const groups = orderedIds.map((id) => groupsById.get(id));
  finalizeOrder(groups, groupKey);

  const result = { meta, monthly_totals: monthlyTotals, daily_totals: dailyTotals, daily_totals_rated: dailyTotalsRated, persons };
  result[groupKey] = groups;
  return result;
}

function statKey(p) {
  try {
    const st = fs.statSync(p);
    return st.size + '-' + Math.floor(st.mtimeMs);
  } catch {
    return null;
  }
}

function readGeneratedAt(p) {
  try {
    const d = JSON.parse(fs.readFileSync(p, 'utf8'));
    return (d && d.meta && d.meta.generated_at) || null;
  } catch {
    return null;
  }
}

/** The candidate sources of an area, highest precedence first. */
function sourcesOf(moduleDir, area) {
  if (!moduleDir) return [];
  const base = path.join(moduleDir, COSTS_SUBDIR);
  return [
    { source: 'shards', kind: 'shards', file: path.join(base, area, 'index.json'), dir: path.join(base, area) },
    { source: 'monolith', kind: 'file', file: path.join(base, area + '.json') },
  ];
}

const cache = new Map(); // source file path -> { key, data }

/**
 * { data, source } for one area or null when no source holds usable data. An
 * unusable shard dir and a corrupt monolith fall through to the next source.
 */
async function readCostsForArea(moduleDir, area, opts) {
  for (const s of sourcesOf(moduleDir, area)) {
    const key = statKey(s.file);
    if (key === null) continue;
    const hit = cache.get(s.file);
    if (hit && hit.key === key) return { data: hit.data, source: s.source };
    let data = null;
    try {
      if (s.kind === 'file') data = JSON.parse(await fs.promises.readFile(s.file, 'utf8'));
      else data = await assembleCostsFromShards(s.dir, opts && opts.warn);
    } catch {
      data = null;
    }
    if (data && typeof data === 'object') {
      cache.set(s.file, { key, data });
      return { data, source: s.source };
    }
  }
  return null;
}

function clearCache() {
  cache.clear();
}

/** Which source would serve an area, without reading any of them. */
function sourceOfArea(moduleDir, area) {
  for (const s of sourcesOf(moduleDir, area)) {
    if (statKey(s.file) !== null) return s.source;
  }
  return null;
}

/** `{ <area>: { source, generatedAt } }` for the status route. */
function costsStatus(moduleDir) {
  const out = {};
  for (const area of AREAS) {
    const source = sourceOfArea(moduleDir, area);
    let generatedAt = null;
    if (moduleDir && source) {
      generatedAt = source === 'shards'
        ? readGeneratedAt(path.join(moduleDir, COSTS_SUBDIR, area, 'index.json'))
        : readGeneratedAt(path.join(moduleDir, COSTS_SUBDIR, area + '.json'));
    }
    out[area] = { source, generatedAt };
  }
  return out;
}

module.exports = {
  AREAS, COSTS_SUBDIR, assembleCostsFromShards, readCostsForArea, costsStatus, sourceOfArea, clearCache,
};
