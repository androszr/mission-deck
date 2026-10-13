// modules/sprint-stats/tests/test_sprint_model.mjs
// Pure client/sprint-model.mjs - offsets, maxOffset, missing-team -> null,
// PLATFORM ascending sort, effectiveDropped, fmtMd, per-unit columns,
// staleBannerState. Node's own `--test` runner picks this up.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../client/sprint-model.mjs';

function _ts(overrides) {
  return {
    src: 'main', team: 'Atlas', unit: 'SP', sprint_n: 1, sprint_id: null, sprint_name: null,
    state: 'closed', phase: 'MID', start: '2026-01-01', end: '2026-01-14', goal: '',
    summary: { committed: 10, done: 5, wip: 2, todo: 1, dropped: 2, added: 0, total_issues: 8, completion_pct: 50 },
    ...overrides,
  };
}

function _indexEntry(src, n, phase, teams) {
  return { src, sprint_n: n, phase, teams };
}

test('buildTeamsModel + getSprintAtOffset: offset 0 is active, offset 1 is previous', () => {
  const index = {
    boards: { main: { teams: ['Atlas'], active_sprint_n: 3 } },
    sprints: [
      _indexEntry('main', 1, 'END', [_ts({ sprint_n: 1 })]),
      _indexEntry('main', 2, 'END', [_ts({ sprint_n: 2 })]),
      _indexEntry('main', 3, 'MID', [_ts({ sprint_n: 3 })]),
    ],
  };
  const teams = model.buildTeamsModel(index);
  assert.equal(teams.length, 1);
  const giewont = teams[0];
  assert.equal(model.getSprintAtOffset(giewont, 0).sprint_n, 3);
  assert.equal(model.getSprintAtOffset(giewont, 1).sprint_n, 2);
  assert.equal(model.getSprintAtOffset(giewont, 2).sprint_n, 1);
});

test('computeMaxOffset: bounded by the active index, 0 for an empty team list', () => {
  const index = {
    boards: { main: { teams: ['Atlas'], active_sprint_n: 3 } },
    sprints: [
      _indexEntry('main', 1, 'END', [_ts({ sprint_n: 1 })]),
      _indexEntry('main', 2, 'END', [_ts({ sprint_n: 2 })]),
      _indexEntry('main', 3, 'MID', [_ts({ sprint_n: 3 })]),
    ],
  };
  const teams = model.buildTeamsModel(index);
  assert.equal(model.computeMaxOffset(teams), 2);
  assert.equal(model.computeMaxOffset([]), 0);
});

test('getSprintAtOffset: missing team data at an offset resolves to null, not a thrown error', () => {
  const team = {
    unit: 'SP', activeN: 3,
    sprints: [
      { sprint_n: 1, teamData: _ts({ sprint_n: 1 }) },
      { sprint_n: 3, teamData: _ts({ sprint_n: 3 }) },
    ],
  };
  // active index is 1 (sprint_n 3); offset 1 -> sprint_n 1 (index 0); offset 2 -> before the array, null
  assert.equal(model.getSprintAtOffset(team, 1).sprint_n, 1);
  assert.equal(model.getSprintAtOffset(team, 2), null);
  assert.equal(model.getSprintAtOffset({ unit: 'SP', sprints: [] }, 0), null);
});

test('buildTeamsModel: PLATFORM entries are sorted ascending even when the index lists them out of order (gap at 11)', () => {
  const index = {
    boards: { platform: { active_sprint_id: 'PL-18' } },
    sprints: [
      _indexEntry('platform', 12, 'MID', [{ ...platformTs(), sprint_n: 12, sprint_id: 'PL-12' }]),
      _indexEntry('platform', 0, 'END', [{ ...platformTs(), sprint_n: 0, sprint_id: 'PL-0' }]),
      _indexEntry('platform', 18, 'MID', [{ ...platformTs(), sprint_n: 18, sprint_id: 'PL-18' }]),
    ],
  };
  const teams = model.buildTeamsModel(index);
  assert.equal(teams.length, 1);
  const ns = teams[0].sprints.map((s) => s.sprint_n);
  assert.deepEqual(ns, [0, 12, 18]);
  // No sprint_n === 11 ever assumed to exist between main and platform - each
  // source keeps its own list, this team's offsets index into ITS list only.
  assert.equal(model.getSprintAtOffset(teams[0], 0).sprint_n, 18);
  assert.equal(model.getSprintAtOffset(teams[0], 1).sprint_n, 12);
});

function platformTs() {
  return {
    src: 'platform', team: 'Delta', unit: 'MD', sprint_id: null, sprint_name: 'PL_0',
    state: 'closed', phase: 'END', start: '2026-01-01', end: '2026-01-14', goal: '',
    summary: { committed: 80, done: 40, wip: 20, todo: 15, dropped: 5, added: 3, total_issues: 90, completion_pct: 44 },
  };
}

test('effectiveDropped: SP folds wip+todo into dropped only after the sprint ENDs; MD never does', () => {
  const summary = { dropped: 2, wip: 3, todo: 4 };
  assert.equal(model.effectiveDropped(summary, 'MID', 'SP'), 2);
  assert.equal(model.effectiveDropped(summary, 'END', 'SP'), 2 + 3 + 4);
  assert.equal(model.effectiveDropped(summary, 'END', 'MD'), 2);
  assert.equal(model.effectiveDropped({}, 'END', 'SP'), 0);
});

test('fmtMd: integer prints bare, fraction uses one decimal, non-finite is a dash', () => {
  assert.equal(model.fmtMd(38), '38');
  assert.equal(model.fmtMd(38.3), '38.3');
  assert.equal(model.fmtMd(undefined), '-');
  assert.equal(model.fmtMd('nope'), '-');
});

test('fmtEstimate: SP is a plain integer string, MD goes through fmtMd, null is a dash in both', () => {
  assert.equal(model.fmtEstimate('SP', 5), '5');
  assert.equal(model.fmtEstimate('MD', 5), '5');
  assert.equal(model.fmtEstimate('MD', 5.5), '5.5');
  assert.equal(model.fmtEstimate('SP', null), '-');
  assert.equal(model.fmtEstimate('MD', undefined), '-');
});

test('per-unit columns: TABLE_CELLS/SUMMARY_CARDS/PERSON_COLUMNS/ISSUE_COLUMNS each carry the right shape for SP vs MD', () => {
  assert.equal(model.TABLE_CELLS.SP.length, 6);
  assert.equal(model.TABLE_CELLS.MD.length, 6);
  const spTs = _ts({ summary: { committed: 10, done: 5, wip: 2, todo: 1, dropped: 2, added: 3, total_issues: 8, completion_pct: 50 } });
  assert.equal(model.TABLE_CELLS.SP[3](spTs, 'MID'), '2');
  assert.equal(model.TABLE_CELLS.SP[3](spTs, 'END'), String(2 + 2 + 1));
  const mdTs = platformTs();
  assert.equal(model.TABLE_CELLS.MD[0](mdTs), '80');

  assert.deepEqual(model.PERSON_COLUMNS.SP, ['Person', 'Committed', 'Done', 'WIP', 'Spillover', 'Completion']);
  assert.deepEqual(model.PERSON_COLUMNS.MD, ['Person', 'Issues', 'Done', 'WIP', 'Todo', 'MD', 'MD Done', 'Spent [h]']);
  assert.deepEqual(model.ISSUE_COLUMNS.SP, ['Issue', 'Type', 'Person', 'SP', 'Status']);
  assert.deepEqual(model.ISSUE_COLUMNS.MD, ['Issue', 'Type', 'Person', 'MD', 'Spent [h]', 'Status']);

  assert.equal(model.SUMMARY_CARDS.SP.length, 5);
  assert.equal(model.SUMMARY_CARDS.MD.length, 5);
  assert.equal(model.SUMMARY_CARDS.MD[3].value(mdTs), '-');
});

test('personRows: drops "(unassigned)", sorts by name, appends a totals row per unit', () => {
  const spTeam = {
    unit: 'SP',
    summary: { completion_pct: 60 },
    persons: [
      { name: 'Zoe', committed: 3, done: 2, wip: 0, todo: 0, dropped: 1, completion_pct: 66 },
      { name: '(unassigned)', committed: 99, done: 99, wip: 0, todo: 0, dropped: 0, completion_pct: 0 },
      { name: 'Alex', committed: 5, done: 3, wip: 1, todo: 1, dropped: 0, completion_pct: 60 },
    ],
  };
  const { headers, rows } = model.personRows(spTeam);
  assert.deepEqual(headers, model.PERSON_COLUMNS.SP);
  assert.equal(rows.length, 3); // Alex, Zoe, Total - "(unassigned)" dropped
  assert.equal(rows[0][0], 'Alex');
  assert.equal(rows[1][0], 'Zoe');
  assert.equal(rows[2][0], model.TOTAL_LABEL);
  assert.equal(rows[2][1], String(3 + 5));

  const mdTeam = {
    unit: 'MD',
    summary: {},
    persons: [
      { name: 'Ana', count: 2, done: 1, wip: 1, todo: 0, estimate: 4.5, estimate_done: 2, spent_h: 3.25, orig_h: 4 },
    ],
  };
  const md = model.personRows(mdTeam);
  assert.equal(md.rows.length, 2);
  assert.equal(md.rows[1][0], 'Total');
  assert.equal(md.rows[0][5], '4.5');
});

test('staleBannerState: null when the board on disk matches discover, a src+label when it does not', () => {
  const index = { boards: { main: { active_sprint_n: 17 }, platform: { active_sprint_id: 'PL-17' } } };
  assert.equal(model.staleBannerState(index, { available: false }), null);
  assert.equal(model.staleBannerState(index, { available: true, main: { active_sprint_n: 17 }, platform: { active_sprint_id: 'PL-17' } }), null);
  assert.deepEqual(
    model.staleBannerState(index, { available: true, main: { active_sprint_n: 18 }, platform: { active_sprint_id: 'PL-17' } }),
    { src: 'main', label: 'MAIN' },
  );
  assert.deepEqual(
    model.staleBannerState(index, { available: true, main: { active_sprint_n: 17 }, platform: { active_sprint_id: 'PL-18' } }),
    { src: 'platform', label: 'Delta' },
  );
});
