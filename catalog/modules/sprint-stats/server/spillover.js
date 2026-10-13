'use strict';
// modules/sprint-stats/server/spillover.js
// Pure aggregation (no fs, no ctx) of closed MAIN sprints into the spillover
// file sprint-stats/spillover.json (sprint_n, label, period, committed_sp,
// done_sp, spillover_full, spillover_pct, completion_pct, teams{avg_*, worst_*}
// plus schema_version, source and team_names). The file is byte-stable for an
// unchanged index because generated_at is taken from the index, never from
// the clock, so other tools can read it without churn.

const SRC = 'main';

/** @param {number} v @returns {number} */
function _round1(v) {
  return Math.round(v * 10) / 10;
}

/** @param {unknown} v @returns {number} */
function _num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * A sprint is closed when it has at least one team and no team is active.
 * @param {{teams?: {state?: string}[]}} entry
 * @returns {boolean}
 */
function isSprintClosed(entry) {
  const teams = entry && Array.isArray(entry.teams) ? entry.teams : [];
  return teams.length > 0 && teams.every((t) => t.state !== 'active');
}

/** @param {number} n @returns {string} */
function formatSprintLabel(n) {
  return 'S' + String(n).padStart(2, '0');
}

/**
 * 'DD.MM -- DD.MM' from the first 10 characters of two ISO strings.
 * @param {string} start
 * @param {string} end
 * @returns {string}
 */
function formatPeriod(start, end) {
  const short = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(typeof iso === 'string' ? iso : '');
    return m ? m[3] + '.' + m[2] : '??.??';
  };
  return short(start) + ' -- ' + short(end);
}

/** @param {object} index @returns {object[]} closed main entries, ascending */
function _closedEntries(index) {
  const sprints = index && Array.isArray(index.sprints) ? index.sprints : [];
  return sprints
    .filter((s) => s && s.src === SRC && isSprintClosed(s))
    .sort((a, b) => a.sprint_n - b.sprint_n);
}

/**
 * Team names: order of boards.main.teams, then first appearance in main
 * entries; only teams with at least one closed sprint.
 * @param {object} index
 * @returns {string[]}
 */
function discoverTeams(index) {
  const closed = _closedEntries(index);
  const have = new Set();
  for (const e of closed) for (const t of e.teams) have.add(t.team);
  const names = [];
  const board = index && index.boards && index.boards.main;
  if (board && Array.isArray(board.teams)) {
    for (const n of board.teams) if (!names.includes(n)) names.push(n);
  }
  const all = index && Array.isArray(index.sprints) ? index.sprints : [];
  for (const e of all) {
    if (!e || e.src !== SRC || !Array.isArray(e.teams)) continue;
    for (const t of e.teams) if (!names.includes(t.team)) names.push(t.team);
  }
  return names.filter((n) => have.has(n));
}

function _row(sprintN, period, committed, done, spilloverFull) {
  const spilloverPct = committed > 0 ? (spilloverFull / committed) * 100 : 0;
  const completionPct = committed > 0 ? (done / committed) * 100 : 0;
  return {
    sprint_n: sprintN,
    label: formatSprintLabel(sprintN),
    period,
    committed_sp: committed,
    done_sp: done,
    spillover_full: spilloverFull,
    spillover_pct: _round1(spilloverPct),
    completion_pct: _round1(completionPct),
  };
}

function _spilloverOf(summary) {
  return _num(summary.dropped) + _num(summary.wip) + _num(summary.todo);
}

/**
 * @param {object} index sprint-stats/index.json content (store.readIndex shape)
 * @returns {object} aggregate
 */
function buildSpilloverAggregate(index) {
  const closed = _closedEntries(index);
  const teamNames = discoverTeams(index);

  const sprints = closed.map((e) => {
    let committed = 0;
    let done = 0;
    let spillover = 0;
    for (const t of e.teams) {
      const s = t.summary || {};
      committed += _num(s.committed);
      done += _num(s.done);
      spillover += _spilloverOf(s);
    }
    const first = e.teams[0];
    return _row(e.sprint_n, formatPeriod(first.start, first.end), committed, done, spillover);
  });

  const teams = {};
  for (const name of teamNames) {
    const rows = [];
    for (const e of closed) {
      const t = e.teams.find((x) => x.team === name);
      if (!t) continue;
      const s = t.summary || {};
      rows.push(_row(e.sprint_n, formatPeriod(t.start, t.end), _num(s.committed), _num(s.done), _spilloverOf(s)));
    }
    const n = rows.length;
    const worst = rows.reduce((a, b) => (b.spillover_pct > a.spillover_pct ? b : a));
    teams[name] = {
      sprints: rows,
      avg_committed_sp: _round1(rows.reduce((s, r) => s + r.committed_sp, 0) / n),
      avg_spillover_full: _round1(rows.reduce((s, r) => s + r.spillover_full, 0) / n),
      avg_spillover_pct: _round1(rows.reduce((s, r) => s + r.spillover_pct, 0) / n),
      worst_sprint_n: worst.sprint_n,
      worst_sprint_label: worst.label,
      worst_spillover_pct: worst.spillover_pct,
    };
  }

  const board = (index && index.boards && index.boards.main) || {};
  return {
    schema_version: 1,
    generated_at: board.generated_at || null,
    source: { board: SRC, active_sprint_n: board.active_sprint_n === undefined ? null : board.active_sprint_n },
    team_names: teamNames,
    sprints,
    teams,
  };
}

/** @param {object} aggregate @returns {string} */
function spilloverText(aggregate) {
  return JSON.stringify(aggregate, null, 2) + '\n';
}

module.exports = {
  isSprintClosed,
  discoverTeams,
  formatSprintLabel,
  formatPeriod,
  buildSpilloverAggregate,
  spilloverText,
};
