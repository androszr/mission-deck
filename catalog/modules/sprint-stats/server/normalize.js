'use strict';
// modules/sprint-stats/server/normalize.js
// Pure, zero fs. The ETL (scripts/sprint_stats_main.py /
// sprint_stats_platform.py) writes the team-sprint shape directly;
// store.js merges it through the mergeIndex/indexEntryOf pair below.
//
// Team-sprint shape (one for SP and MD units):
//   {
//     src: 'main'|'platform', team, unit: 'SP'|'MD', sprint_n, sprint_id,
//     sprint_name, state, phase: 'START'|'MID'|'END', start, end, goal,
//     summary: { committed, done, wip, todo, dropped, added, total_issues,
//       completion_pct },
//     persons: [...], issues: [{ key, summary, type, assignee, status_bucket,
//       status_label, estimate, spent_h }],
//     burndown: [{ day_n, date, remaining }], extra: {},
//   }
// A merged sprint entry (what mergeSprints stores per (src, sprint_n)) is
// { src, sprint_n, phase, teams: [teamSprint, ...] } - one team for the
// platform board, one per team for the main board.

const SRC_IDS = ['main', 'platform'];
const UNIT_IDS = ['SP', 'MD'];
const PHASE_IDS = ['START', 'MID', 'END'];
const STATUS_BUCKET_IDS = ['done', 'wip', 'todo', 'dropped'];

/** First 10 chars of an ISO-ish date string parsed as a UTC day, or null.
 * @param {unknown} v
 * @returns {number|null} milliseconds since epoch, at 00:00:00 UTC of that day
 */
function _dateOnlyMs(v) {
  const s = String(v === null || v === undefined ? '' : v);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/**
 * Sprint phase from its state and start date (same rule as
 * scripts/_common.py detect_phase): closed -> END, not active -> START,
 * active and at most two days in -> START, later -> MID.
 * @param {string} state 'active'|'closed'|'future'|''
 * @param {unknown} start ISO date string (sprint start)
 * @param {Date} [today] injectable for tests; defaults to now
 * @returns {'START'|'MID'|'END'}
 */
function detectPhase(state, start, today) {
  if (state === 'closed') return 'END';
  if (state !== 'active') return 'START';
  const startMs = _dateOnlyMs(start);
  if (startMs === null) return 'MID';
  const now = today instanceof Date ? today : new Date();
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const daysIn = Math.round((todayMs - startMs) / 86400000);
  return daysIn <= 2 ? 'START' : 'MID';
}

/**
 * A merged sprint entry, trimmed for index.json: every team keeps its
 * summary/dates/goal but loses persons/issues/burndown/extra, replaced by
 * their counts - enough for tabs, the date/goal card, the tile row and the
 * trend chart to paint from the index alone.
 * @param {object} sprint { src, sprint_n, phase, teams: [teamSprint, ...] }
 * @returns {object}
 */
function indexEntryOf(sprint) {
  return {
    src: sprint.src,
    sprint_n: sprint.sprint_n,
    phase: sprint.phase,
    teams: (sprint.teams || []).map((t) => {
      const { persons, issues, burndown, extra: _extra, ...rest } = t;
      return {
        ...rest,
        issues_count: Array.isArray(issues) ? issues.length : 0,
        persons_count: Array.isArray(persons) ? persons.length : 0,
        has_burndown: Array.isArray(burndown) && burndown.length > 0,
      };
    }),
  };
}

/**
 * Validates one team-sprint. Returns the list of problems found (empty =
 * valid) rather than throwing, so a caller can report every issue at once
 * and refuse to write a whole ETL stage on the first bad team rather than
 * fail one field at a time.
 * @param {object} ts
 * @returns {string[]}
 */
function validateTeamSprint(ts) {
  const errors = [];
  if (!ts || typeof ts !== 'object') return ['team-sprint is not an object'];
  if (!SRC_IDS.includes(ts.src)) errors.push('src must be one of ' + SRC_IDS.join(','));
  if (!UNIT_IDS.includes(ts.unit)) errors.push('unit must be one of ' + UNIT_IDS.join(','));
  if (typeof ts.team !== 'string' || !ts.team) errors.push('team must be a non-empty string');
  if (!Number.isInteger(ts.sprint_n) || ts.sprint_n < 0) errors.push('sprint_n must be a non-negative integer');
  if (!PHASE_IDS.includes(ts.phase)) errors.push('phase must be one of ' + PHASE_IDS.join(','));

  const summary = ts.summary;
  if (!summary || typeof summary !== 'object') {
    errors.push('summary is missing');
  } else {
    for (const key of ['committed', 'done', 'wip', 'todo', 'dropped', 'added', 'total_issues', 'completion_pct']) {
      if (!Number.isFinite(summary[key])) errors.push('summary.' + key + ' must be a finite number');
    }
  }

  if (!Array.isArray(ts.persons)) errors.push('persons must be an array');
  if (!Array.isArray(ts.issues)) {
    errors.push('issues must be an array');
  } else {
    ts.issues.forEach((issue, i) => {
      if (!STATUS_BUCKET_IDS.includes(issue && issue.status_bucket)) {
        errors.push('issues[' + i + '].status_bucket must be one of ' + STATUS_BUCKET_IDS.join(','));
      }
      if (issue && issue.estimate !== null && !Number.isFinite(issue.estimate)) {
        errors.push('issues[' + i + '].estimate must be a finite number or null');
      }
      if (issue && issue.spent_h !== null && !Number.isFinite(issue.spent_h)) {
        errors.push('issues[' + i + '].spent_h must be a finite number or null');
      }
    });
  }

  if (!Array.isArray(ts.burndown)) {
    errors.push('burndown must be an array');
  } else {
    ts.burndown.forEach((b, i) => {
      if (!Number.isInteger(b && b.day_n)) errors.push('burndown[' + i + '].day_n must be an integer');
      if (!Number.isFinite(b && b.remaining)) errors.push('burndown[' + i + '].remaining must be a finite number');
    });
  }

  return errors;
}

/**
 * Merges incoming merged-sprint index entries into an existing `sprints[]`
 * array, keyed on (src, sprint_n). Pure: the caller decides what happens to
 * the matching SHARD files (mergeSprints in store.js) based on `written`
 * versus `skipped`.
 * @param {object[]} existingSprints index.json's current `sprints[]`
 * @param {object[]} incomingEntries trimmed index entries (indexEntryOf output)
 * @param {{onlyMissing?: boolean}} [opts] onlyMissing: never overwrite a
 *   (src, sprint_n) already present.
 * @returns {{sprints: object[], written: {src: string, sprint_n: number}[],
 *   skipped: {src: string, sprint_n: number}[]}}
 */
function mergeIndex(existingSprints, incomingEntries, opts) {
  const onlyMissing = !!(opts && opts.onlyMissing);
  const map = new Map();
  for (const s of existingSprints || []) map.set(s.src + ':' + s.sprint_n, s);

  const written = [];
  const skipped = [];
  for (const entry of incomingEntries || []) {
    const key = entry.src + ':' + entry.sprint_n;
    if (onlyMissing && map.has(key)) {
      skipped.push({ src: entry.src, sprint_n: entry.sprint_n });
      continue;
    }
    map.set(key, entry);
    written.push({ src: entry.src, sprint_n: entry.sprint_n });
  }

  const sprints = [...map.values()].sort((a, b) => {
    if (a.src !== b.src) return a.src < b.src ? -1 : 1;
    return a.sprint_n - b.sprint_n;
  });

  return { sprints, written, skipped };
}

module.exports = {
  SRC_IDS,
  UNIT_IDS,
  PHASE_IDS,
  STATUS_BUCKET_IDS,
  detectPhase,
  indexEntryOf,
  validateTeamSprint,
  mergeIndex,
};
