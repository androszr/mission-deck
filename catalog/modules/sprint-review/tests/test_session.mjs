// modules/sprint-review/tests/test_session.mjs
// Pure logic in server/session.js: deadline math, new session seeding from sprint-stats/ (sprint-stats module,
// read-only), the session-teams rule and the two patch allowlists.
//
// There is no fixed team roster: buildNewSession seeds MEETINGS['team-review'].defaultTeams
// (today's lineup), readSprintGoals resolves a goal per requested team from
// the sprint-stats fixture, and sessionTeams(session)/applyTeamPatch work
// off whatever teams are actually on the session.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const session = require(path.join(DIR, 'server', 'session.js'));

const SPRINTY_FIXTURE_DIR = path.join(DIR, 'tests', 'fixtures', 'sprint-stats');
const DEFAULT_TEAMS = session.MEETINGS[session.MEETING_KEY].defaultTeams;

function fakeRandomBytes(hex) {
  return () => ({ toString: () => hex });
}

test('deadline: 2026-06-30 review matches the measured legacy value', () => {
  assert.equal(session.deadlineFromReviewDate('2026-06-30'), '2026-06-26T10:00:00.000Z');
});

test('deadline: review date on a Friday steps back a full week', () => {
  // 2026-01-16 is itself a Friday.
  assert.equal(new Date('2026-01-16T12:00:00.000Z').getUTCDay(), 5);
  assert.equal(session.deadlineFromReviewDate('2026-01-16'), '2026-01-09T10:00:00.000Z');
});

test('deadline: review date on a Saturday steps back one day', () => {
  assert.equal(new Date('2026-01-17T12:00:00.000Z').getUTCDay(), 6);
  assert.equal(session.deadlineFromReviewDate('2026-01-17'), '2026-01-16T10:00:00.000Z');
});

test('deadline: winter date resolves the same way as a summer one', () => {
  assert.equal(session.deadlineFromReviewDate('2026-01-13'), '2026-01-09T10:00:00.000Z');
});

test('readSprintGoals resolves a per-team goal from the active main/platform sprints and never throws', () => {
  const goals = session.readSprintGoals(SPRINTY_FIXTURE_DIR, DEFAULT_TEAMS);
  assert.equal(goals.sprintN, 18, 'sprintN comes from boards.main.active_sprint_n');
  assert.equal(goals.sprintName, 'Sprint 18');
  const byTeam = Object.fromEntries(goals.teamGoals.map((g) => [g.team, g]));
  assert.equal(byTeam.Atlas.goal, 'Checkout ready for release');
  assert.equal(byTeam.Borealis.goal, 'Item list export to XLSX');
  assert.equal(byTeam['Echo'].goal, '', 'Echo has no board -> empty goal, not an error');
  assert.equal(byTeam.Delta.goal, 'ERP integration stabilisation', 'resolved via the Delta -> Delta alias');

  assert.equal(session.readSprintGoals(path.join(DIR, 'tests', 'fixtures', 'does-not-exist'), DEFAULT_TEAMS), null);
});

test('buildNewSession seeds the current team lineup as empty cards without sprint goals', () => {
  const now = () => new Date('2026-09-13T09:00:00.000Z');
  const randomBytes = fakeRandomBytes('aaaaaaaaaaaaaaaa');

  const withoutGoals = session.buildNewSession({ reviewDate: '2026-09-17', facilitatorPo: '', sprintGoals: null, now, randomBytes });
  assert.equal(withoutGoals.id, 'sr-aaaaaaaaaaaaaaaa');
  assert.equal(withoutGoals.meeting, 'team-review');
  assert.equal(withoutGoals.sprintN, null);
  assert.equal(withoutGoals.sprintName, null);
  assert.deepEqual(withoutGoals.teamGoals, DEFAULT_TEAMS.map((team) => ({ team, goal: '', sprint_name: '' })));
  assert.deepEqual(withoutGoals.submissions, {});
  assert.equal(withoutGoals.confluencePageId, null);

  const goals = session.readSprintGoals(SPRINTY_FIXTURE_DIR, DEFAULT_TEAMS);
  const withGoals = session.buildNewSession({ reviewDate: '2026-09-17', facilitatorPo: 'Jordan Kim', sprintGoals: goals, now, randomBytes: fakeRandomBytes('bbbbbbbbbbbbbbbb') });
  assert.equal(withGoals.sprintN, 18);
  assert.deepEqual(withGoals.teamGoals.map((g) => g.team), DEFAULT_TEAMS, 'seeded in the defaultTeams order');
});

test('sessionTeams reads teamGoals order and appends any orphan submissions key', () => {
  const session1 = { teamGoals: [{ team: 'Atlas' }, { team: 'Borealis' }], submissions: { Borealis: {}, 'Falcon': {} } };
  assert.deepEqual(session.sessionTeams(session1), ['Atlas', 'Borealis', 'Falcon']);

  const session2 = { teamGoals: [], submissions: {} };
  assert.deepEqual(session.sessionTeams(session2), []);
});

test('applySessionPatch keeps the allowlist and applyTeamPatch enforces team membership and the topic-list shape', () => {
  const now = () => new Date('2026-09-13T09:00:00.000Z');
  const randomBytes = fakeRandomBytes('cccccccc');
  const base = session.buildNewSession({ reviewDate: '2026-09-17', facilitatorPo: '', sprintGoals: null, now, randomBytes: fakeRandomBytes('dddddddddddddddd') });

  const patched = session.applySessionPatch(base, {
    id: 'sr-0000000000000000',
    createdAt: '2020-01-01T00:00:00.000Z',
    __proto__: { polluted: true },
    facilitatorPo: 'Alex Novak',
    reviewDate: '2026-09-18',
  }, now);
  assert.ok(patched.session);
  assert.equal(patched.session.id, base.id, 'id is not mutable');
  assert.equal(patched.session.createdAt, base.createdAt, 'createdAt is not mutable');
  assert.equal(patched.session.polluted, undefined, '__proto__ never lands as an own property');
  assert.equal(patched.session.facilitatorPo, 'Alex Novak');
  assert.equal(patched.session.deadline, session.deadlineFromReviewDate('2026-09-18'));

  const unknownTeam = session.applyTeamPatch(base, 'Comet', { realizationStatus: 'achieved' }, randomBytes);
  assert.equal(unknownTeam.error, 'bad-team');

  const wrongKeyOnDual = session.applyTeamPatch(base, 'Echo', { topics: [{ title: 'X', presenters: [] }] }, randomBytes);
  assert.equal(wrongKeyOnDual.error, 'bad-topics-key');

  const wrongKeyOnSingle = session.applyTeamPatch(base, 'Atlas', { topicsProblemSpace: [{ title: 'X', presenters: [] }] }, randomBytes);
  assert.equal(wrongKeyOnSingle.error, 'bad-topics-key');

  const badFormat = session.applyTeamPatch(base, 'Atlas', { topics: [{ title: 'X', format: 'nieznany', presenters: [] }] }, randomBytes);
  assert.equal(badFormat.error, 'bad-format');

  const badStatus = session.applyTeamPatch(base, 'Atlas', { realizationStatus: 'cos-innego' }, randomBytes);
  assert.equal(badStatus.error, 'bad-realization-status');

  const okSingle = session.applyTeamPatch(base, 'Atlas', { realizationStatus: 'achieved', topics: [{ title: 'New topic', format: 'discussion', presenters: ['Jordan Kim'] }] }, randomBytes);
  assert.ok(okSingle.session);
  assert.equal(okSingle.session.submissions.Atlas.realizationStatus, 'achieved');
  assert.equal(okSingle.session.submissions.Atlas.topics.length, 1);
  assert.match(okSingle.session.submissions.Atlas.topics[0].id, /^t-[0-9a-f]{8}$/);

  // A dual-section patch with a manual submittedAt already on the submission
  // (as a legacy import would leave it) must survive an unrelated section
  // write - `current` is read-modify-write, never a fresh object.
  const withLegacyField = {
    ...base,
    submissions: { ...base.submissions, 'Echo': { submitted: true, realizationStatus: '', submittedAt: '2026-08-01T00:00:00.000Z', topicsProblemSpace: [], topicsSolutionSpace: [] } },
  };
  const okDual = session.applyTeamPatch(withLegacyField, 'Echo', { topicsSolutionSpace: [{ title: 'Nowe rozwiazanie', presenters: [] }] }, randomBytes);
  assert.ok(okDual.session);
  assert.equal(okDual.session.submissions['Echo'].submittedAt, '2026-08-01T00:00:00.000Z');
  assert.equal(okDual.session.submissions['Echo'].topicsSolutionSpace.length, 1);
  assert.deepEqual(okDual.session.submissions['Echo'].topicsProblemSpace, []);
});
