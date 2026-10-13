// modules/sprint-stats/client/sprint-model.mjs
// Pure, DOM-free. Reads the trimmed sprint-stats/index.json shape this
// module writes: index.sprints[] entries already carry each team's summary,
// dates, goal, sprint_id/sprint_name and issues_count/persons_count/
// has_burndown - only persons[]/issues[]/burndown[] are missing (server/
// normalize.js indexEntryOf). So buildTeamsModel below reads the INDEX, not
// a shard, and tabs, the date/goal card, the tile bar, the phase badge and
// the team table all paint from the one overview fetch with zero shard
// requests - the shard is needed only for the expanded issue subtable, the
// "Per person" modal and the burndown chart, all wired in client/index.js.
//
// client/index.js and client/sprint-charts.mjs are the only importers; this
// file must stay importable in plain Node with no document (see
// tests/test_sprint_model.mjs).

// Data team name -> display label, for boards whose Jira team name differs
// from what people call the team. Empty by default.
export const TEAM_DISPLAY = {};

/** Label of the totals row in the "Per person" modal. */
export const TOTAL_LABEL = 'Total';

/** @param {string} name @returns {string} */
export function teamLabel(name) {
  return TEAM_DISPLAY[name] || name;
}

export const PHASE_LABELS = {
  START: 'Sprint start',
  MID: 'Mid-sprint',
  END: 'After the sprint',
};

export const STATE_LABELS = {
  active: 'Active',
  closed: 'Closed',
  future: 'Future',
};

const STATUS_BUCKET_ORDER = { done: 0, wip: 1, todo: 2, dropped: 3 };
const STATUS_BUCKET_TONE = { done: 'success', wip: 'warning', todo: '', dropped: 'danger' };

/**
 * One index.sprints[] entry -> the team-sprint row for one team, or null
 * when that team has no row in this entry (a team no longer on the
 * board, or a PLATFORM entry read for an SP team).
 * @param {object} entry index.sprints[] item
 * @param {string} teamName
 * @returns {object|null}
 */
function _teamRowIn(entry, teamName) {
  return (entry.teams || []).find((t) => t.team === teamName) || null;
}

/**
 * Builds the unified per-team model from sprint-stats/index.json alone -
 * array of `{ name, key, unit, sprints: [{ sprint_n, sprint_id, sprint_label,
 * phase, teamData, _src }], activeN|activeId }` (`name` is the display label,
 * `key` the shard's teams[].team value), oldest -> newest, one entry
 * per MAIN team plus one "Delta" entry for PLATFORM.
 * @param {{boards?: object, sprints?: object[]}} index
 * @returns {object[]}
 */
export function buildTeamsModel(index) {
  const teams = [];
  const boards = (index && index.boards) || {};
  const allEntries = (index && index.sprints) || [];

  const mainEntries = allEntries.filter((e) => e.src === 'main').sort((a, b) => a.sprint_n - b.sprint_n);
  if (mainEntries.length) {
    const board = boards.main || {};
    const teamNames = Array.isArray(board.teams) && board.teams.length
      ? board.teams
      : [...new Set(mainEntries.flatMap((e) => (e.teams || []).map((t) => t.team)))];
    teamNames.forEach((teamName) => {
      const sprints = mainEntries.map((entry) => ({
        sprint_n: entry.sprint_n,
        sprint_label: 'Sprint ' + entry.sprint_n,
        phase: entry.phase,
        teamData: _teamRowIn(entry, teamName),
        _src: 'main',
      }));
      teams.push({ name: teamName, key: teamName, unit: 'SP', sprints, activeN: board.active_sprint_n });
    });
  }

  const platformEntries = allEntries.filter((e) => e.src === 'platform').sort((a, b) => a.sprint_n - b.sprint_n);
  if (platformEntries.length) {
    const board = boards.platform || {};
    const sprints = platformEntries.map((entry) => {
      const t = (entry.teams || [])[0] || null;
      return {
        sprint_n: entry.sprint_n,
        sprint_id: t ? t.sprint_id : null,
        // Always "PL_N", never the real sprint_name ("Delta Sprint N"),
        // so tab tooltips and the person-modal title stay short.
        sprint_label: 'PL_' + entry.sprint_n,
        phase: entry.phase,
        teamData: t,
        _src: 'platform',
      };
    });
    // `name` is what a person reads ("Delta"); `key` is the data key every
    // shard lookup compares against - a shard's teams[].team is 'Delta'.
    teams.push({ name: teamLabel('Delta'), key: 'Delta', unit: 'MD', sprints, activeId: board.active_sprint_id });
  }

  return teams;
}

/**
 * The sprint entry at `offset` sprints back from the active one (0 = active
 * or the last known sprint, 1 = previous, ...), or `null` when the team has
 * no data that far back.
 * @param {{unit: string, activeN?: number, activeId?: string|number, sprints: object[]}} team
 * @param {number} offset
 * @returns {object|null}
 */
export function getSprintAtOffset(team, offset) {
  if (!team || !team.sprints || team.sprints.length === 0) return null;
  let activeIdx;
  if (team.unit === 'MD') {
    activeIdx = team.activeId ? team.sprints.findIndex((s) => s.sprint_id === team.activeId) : -1;
  } else {
    activeIdx = team.activeN ? team.sprints.findIndex((s) => s.sprint_n === team.activeN) : -1;
  }
  if (activeIdx < 0) activeIdx = team.sprints.length - 1;
  const targetIdx = activeIdx - offset;
  if (targetIdx < 0) return null;
  return team.sprints[targetIdx] || null;
}

/**
 * The largest offset for which AT LEAST ONE team still has data.
 * @param {object[]} teams
 * @returns {number}
 */
export function computeMaxOffset(teams) {
  if (!teams || teams.length === 0) return 0;
  let maxOffset = 0;
  teams.forEach((team) => {
    if (!team.sprints || team.sprints.length === 0) return;
    let activeIdx;
    if (team.unit === 'MD') {
      activeIdx = team.activeId ? team.sprints.findIndex((s) => s.sprint_id === team.activeId) : -1;
    } else {
      activeIdx = team.activeN ? team.sprints.findIndex((s) => s.sprint_n === team.activeN) : -1;
    }
    if (activeIdx < 0) activeIdx = team.sprints.length - 1;
    maxOffset = Math.max(maxOffset, activeIdx);
  });
  return maxOffset;
}

/** @param {number} o @returns {string} */
export function offsetLabel(o) {
  if (o === 0) return 'Active';
  if (o === 1) return 'Active - 1';
  return 'A-' + o;
}

/**
 * Tab tooltip: "A-N (Sprint X / Sprint Y / PL_Z)", "-" per team missing at
 * that offset.
 * @param {number} o
 * @param {object[]} teams
 * @returns {string}
 */
export function offsetTooltip(o, teams) {
  const parts = (teams || []).map((team) => {
    const sp = getSprintAtOffset(team, o);
    return sp ? sp.sprint_label : '-';
  });
  return offsetLabel(o) + ' (' + parts.join(' / ') + ')';
}

/**
 * "Spillover" as shown to a person: after the sprint ENDS, leftover WIP and TODO
 * are folded into it (nothing was delivered, so it reads as not-delivered),
 * but only for SP - MD keeps the raw cancelled count and the tile shows "-"
 * instead (see SUMMARY_CARDS.MD below). Computed at render time everywhere
 * it is used (tiles, table, trend) - never stored - because `phase` changes
 * between refreshes.
 * @param {{dropped?: number, wip?: number, todo?: number}} summary
 * @param {'START'|'MID'|'END'} phase
 * @param {'SP'|'MD'} unit
 * @returns {number}
 */
export function effectiveDropped(summary, phase, unit) {
  const s = summary || {};
  const dropped = Number(s.dropped) || 0;
  if (unit === 'SP' && phase === 'END') {
    return dropped + (Number(s.wip) || 0) + (Number(s.todo) || 0);
  }
  return dropped;
}

/**
 * "38.3" for a non-integer, "38" for an integer, "-" for anything else.
 * @param {unknown} v
 * @returns {string}
 */
export function fmtMd(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '-';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * An issue/person estimate cell: SP is a plain integer story-point count,
 * MD goes through fmtMd (fractional man-days, one decimal). `null`/
 * `undefined` (no estimate) is "-" in both units.
 * @param {'SP'|'MD'} unit
 * @param {number|null|undefined} v
 * @returns {string}
 */
export function fmtEstimate(unit, v) {
  if (v === null || v === undefined) return '-';
  return unit === 'MD' ? fmtMd(v) : String(v);
}

/**
 * "yyyy-mm-dd..." -> "dd.mm.yyyy"; empty string for a falsy input, the raw
 * string when it does not start with an ISO date.
 * @param {unknown} iso
 * @returns {string}
 */
export function fmtDayDate(iso) {
  if (!iso) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
  if (!m) return String(iso);
  return m[3] + '.' + m[2] + '.' + m[1];
}

/**
 * A Jira Rapid Board sprint URL when sprint_id + board_id + projectKey are
 * all known, else a JQL search URL keyed on the sprint name, else `null`.
 * @param {{sprintId?: unknown, boardId?: unknown, projectKey?: unknown,
 *   sprintName?: unknown, jiraBase?: string}} args
 * @returns {string|null}
 */
export function jiraSprintUrl({ sprintId, boardId, projectKey, sprintName, jiraBase } = {}) {
  const base = jiraBase || 'https://jira.example.com';
  if (sprintId && boardId && projectKey) {
    const params = 'rapidView=' + encodeURIComponent(boardId)
      + '&projectKey=' + encodeURIComponent(projectKey)
      + '&sprint=' + encodeURIComponent(sprintId);
    return base + '/secure/RapidBoard.jspa?' + params;
  }
  if (sprintName) {
    const jql = 'sprint = "' + String(sprintName).replace(/"/g, '\\"') + '"';
    return base + '/issues/?jql=' + encodeURIComponent(jql);
  }
  return null;
}

/**
 * Five tile definitions per unit for the summary bar. `value` and `tone`
 * both take `(teamSprintOrNull, phase)`; `tone` returns '' | 'success' |
 * 'danger', painted through --state-success-text / --state-danger-text
 * (never a hex - see client/style.css).
 */
export const SUMMARY_CARDS = {
  SP: [
    { label: 'SP Committed', value: (t) => String(t.summary.committed), tone: () => '' },
    { label: 'SP Done', value: (t) => String(t.summary.done), tone: () => 'success' },
    { label: 'SP WIP', value: (t) => String(t.summary.wip), tone: () => '' },
    {
      label: 'Spillover',
      value: (t, phase) => String(effectiveDropped(t.summary, phase, 'SP')),
      tone: (t, phase) => (effectiveDropped(t.summary, phase, 'SP') > 0 ? 'danger' : ''),
    },
    { label: 'Completion', value: (t) => t.summary.completion_pct + '%', tone: () => 'success' },
  ],
  MD: [
    { label: 'MD Committed', value: (t) => fmtMd(t.summary.committed), tone: () => '' },
    { label: 'MD Done', value: (t) => fmtMd(t.summary.done), tone: () => 'success' },
    { label: 'MD WIP', value: (t) => fmtMd(t.summary.wip), tone: () => '' },
    { label: 'Spillover', value: () => '-', tone: () => '' },
    { label: 'Completion', value: (t) => t.summary.completion_pct + '%', tone: () => 'success' },
  ],
};

/**
 * Six data-cell getters per unit for the "Summary per team" table
 * (Committed/Done/WIP/Spillover/Added/Completion - Team and Unit are painted
 * directly by client/index.js). Each getter takes `(teamSprint, phase)`.
 */
export const TABLE_CELLS = {
  SP: [
    (t) => String(t.summary.committed),
    (t) => String(t.summary.done),
    (t) => String(t.summary.wip),
    (t, phase) => String(effectiveDropped(t.summary, phase, 'SP')),
    (t) => String(t.summary.added),
    (t) => t.summary.completion_pct + '%',
  ],
  MD: [
    (t) => fmtMd(t.summary.committed),
    (t) => fmtMd(t.summary.done),
    (t) => fmtMd(t.summary.wip),
    (t) => fmtMd(t.summary.dropped),
    (t) => fmtMd(t.summary.added),
    (t) => t.summary.completion_pct + '%',
  ],
};

export const ISSUE_COLUMNS = {
  SP: ['Issue', 'Type', 'Person', 'SP', 'Status'],
  MD: ['Issue', 'Type', 'Person', 'MD', 'Spent [h]', 'Status'],
};

export const PERSON_COLUMNS = {
  SP: ['Person', 'Committed', 'Done', 'WIP', 'Spillover', 'Completion'],
  MD: ['Person', 'Issues', 'Done', 'WIP', 'Todo', 'MD', 'MD Done', 'Spent [h]'],
};

/**
 * Sorts a team-sprint's persons[] (dropping the synthetic "(unassigned)" row) by
 * name (`localeCompare(..., 'en')`) and formats one row of strings per
 * PERSON_COLUMNS[unit], with a final TOTAL_LABEL totals row.
 * @param {{unit: 'SP'|'MD', persons: object[], summary: object}} teamSprint
 * @returns {{headers: string[], rows: string[][]}}
 */
export function personRows(teamSprint) {
  const unit = teamSprint.unit;
  const headers = PERSON_COLUMNS[unit];
  const persons = (teamSprint.persons || [])
    .filter((p) => p && p.name && p.name !== '(unassigned)')
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'en'));

  const rows = [];
  if (unit === 'SP') {
    persons.forEach((p) => {
      rows.push([
        String(p.name), String(p.committed || 0), String(p.done || 0),
        String(p.wip || 0), String(p.dropped || 0), (p.completion_pct || 0) + '%',
      ]);
    });
    const sum = (key) => persons.reduce((acc, p) => acc + (Number(p[key]) || 0), 0);
    rows.push([
      TOTAL_LABEL, String(sum('committed')), String(sum('done')),
      String(sum('wip')), String(sum('dropped')), (teamSprint.summary.completion_pct || 0) + '%',
    ]);
  } else {
    persons.forEach((p) => {
      rows.push([
        String(p.name), p.count !== undefined && p.count !== null ? String(p.count) : '-',
        p.done !== undefined && p.done !== null ? String(p.done) : '-',
        p.wip !== undefined && p.wip !== null ? String(p.wip) : '-',
        p.todo !== undefined && p.todo !== null ? String(p.todo) : '-',
        fmtMd(p.estimate), fmtMd(p.estimate_done), fmtMd(p.spent_h),
      ]);
    });
    const sum = (key) => persons.reduce((acc, p) => acc + (Number(p[key]) || 0), 0);
    rows.push([
      TOTAL_LABEL, String(sum('count')), String(sum('done')),
      String(sum('wip')), String(sum('todo')), fmtMd(sum('estimate')), fmtMd(sum('estimate_done')), fmtMd(sum('spent_h')),
    ]);
  }
  return { headers, rows };
}

/**
 * Sorts issues[] by status bucket (done, wip, todo, dropped) then by
 * estimate descending - a missing estimate sorts as if it were -1, after
 * every real number in the same bucket.
 * @param {object[]} issues
 * @returns {object[]}
 */
export function sortIssues(issues) {
  return (issues || []).slice().sort((a, b) => {
    const oa = STATUS_BUCKET_ORDER[a.status_bucket] ?? 9;
    const ob = STATUS_BUCKET_ORDER[b.status_bucket] ?? 9;
    if (oa !== ob) return oa - ob;
    const ea = a.estimate === null || a.estimate === undefined ? -1 : a.estimate;
    const eb = b.estimate === null || b.estimate === undefined ? -1 : b.estimate;
    return eb - ea;
  });
}

/** Tone class for one issue's status_bucket ('' | success | warning | danger). */
export function issueTone(bucket) {
  return STATUS_BUCKET_TONE[bucket] || '';
}

/**
 * `null` when both boards' active sprint on disk match what the live board
 * reports, else `{ src, label }` naming the stale source - drives the
 * "New active sprint" banner, over both sources.
 * @param {{boards?: object}} index
 * @param {object|null} discover GET /discover answer
 * @returns {{src: 'main'|'platform', label: string}|null}
 */
export function staleBannerState(index, discover) {
  if (!discover || !discover.available) return null;
  const boards = (index && index.boards) || {};
  if (discover.main && boards.main && discover.main.active_sprint_n
    && discover.main.active_sprint_n !== boards.main.active_sprint_n) {
    return { src: 'main', label: 'MAIN' };
  }
  if (discover.platform && boards.platform && discover.platform.active_sprint_id
    && discover.platform.active_sprint_id !== boards.platform.active_sprint_id) {
    return { src: 'platform', label: teamLabel('Delta') };
  }
  return null;
}

/**
 * "Sprints: 1 - 18 · Teams: Atlas, Borealis, Comet, Delta" meta line
 * under the tab bar.
 * @param {{boards?: object, sprints?: object[]}} index
 * @returns {string}
 */
export function summaryLine(index) {
  const entries = (index && index.sprints) || [];
  const mainNs = entries.filter((e) => e.src === 'main').map((e) => e.sprint_n);
  const teamNames = ((index && index.boards && index.boards.main && index.boards.main.teams) || []).slice();
  if (entries.some((e) => e.src === 'platform')) teamNames.push(teamLabel('Delta'));
  const rangeText = mainNs.length ? ('Sprints: ' + Math.min(...mainNs) + ' - ' + Math.max(...mainNs)) : '';
  const teamsText = teamNames.length ? ('Teams: ' + teamNames.join(', ')) : '';
  return [rangeText, teamsText].filter(Boolean).join(' · ');
}
