'use strict';
// modules/roadmap/server/widget.js
// READ-ONLY slim answer for the dashboard tile "Top initiatives": the first TOP_N
// initiatives by `rank` with done/total of their Jira tasks. A closed shape -
// no comments, no links, no task lists, no worklogs (timeByPerson). Nothing is
// written or rehydrated: files are parsed in memory and dropped. The result is
// memoised on the directory's file names + mtimes + sizes.

const fs = require('fs');
const path = require('path');

const FILE_RE = /^dt-[A-Za-z0-9_-]+\.json$/;
const TOP_N = 5;
const _memo = new Map();

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * The Jira tasks that count: a placeholder row (no `key`, statusCategory null -
 * a discovery step never created in Jira) is not a task, and a step outside
 * `taskScope` is not part of this initiative. An empty scope means "all steps",
 * as in client/helpers.js.
 */
function countedTasks(init) {
  const scope = Array.isArray(init.taskScope) && init.taskScope.length > 0 ? init.taskScope : null;
  return (Array.isArray(init.jiraTasks) ? init.jiraTasks : [])
    .filter((t) => t && typeof t === 'object' && typeof t.key === 'string' && t.key.trim() !== '')
    .filter((t) => !scope || !t.defId || scope.includes(t.defId));
}

function slim(init) {
  const tasks = countedTasks(init);
  const cat = (t) => t.statusCategory;
  return {
    id: String(init.id),
    title: str(init.title),
    ticket: str(init.ticket),
    po: str(init.po),
    rank: Number.isFinite(Number(init.rank)) ? Number(init.rank) : null,
    done: tasks.filter((t) => cat(t) === 'done').length,
    inProgress: tasks.filter((t) => cat(t) === 'indeterminate').length,
    total: tasks.length,
    goLiveDate: /^\d{4}-\d{2}-\d{2}$/.test(str(init.goLiveDate)) ? str(init.goLiveDate) : null,
    ragStatus: ['green', 'amber', 'red'].includes(init.ragStatus) ? init.ragStatus : null,
  };
}

/** @returns {{storage:'ok', initiatives:object[], count:number}} */
function buildWidget(dir) {
  let files;
  try { files = fs.readdirSync(dir).filter((f) => FILE_RE.test(f)).sort(); } catch { files = []; }
  const sig = [];
  for (const f of files) {
    try {
      const st = fs.statSync(path.join(dir, f));
      sig.push(f + ':' + st.mtimeMs + ':' + st.size);
    } catch { /* vanished between readdir and stat */ }
  }
  const key = sig.join('|');
  const hit = _memo.get(dir);
  if (hit && hit.key === key) return hit.value;
  const all = [];
  for (const f of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.id) all.push(slim(parsed));
    } catch { /* a broken file is skipped, as in /initiatives */ }
  }
  all.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
  const value = { storage: 'ok', initiatives: all.slice(0, TOP_N), count: all.length };
  _memo.set(dir, { key, value });
  return value;
}

module.exports = { buildWidget, countedTasks, TOP_N };
