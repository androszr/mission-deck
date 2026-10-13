// modules/sprint-planning/tests/test_sprint_planning_lib.mjs
import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import {
  polishHolidays, workingDays, absenceDaysByPerson, capacity, velocityProposal,
  progress, slotDatesInSprint, formatSlot, SLOT_PLACEHOLDER, jiraSprintUrl, esc, mergeRanges,
  endExclusive, regularSprintDays, holidaysInRange, holidaysForRange, entryDaysInSprint, jiraIssueUrl,
  mostFrequentPerson, slugify,
} from '../client/sprint-planning-lib.mjs';

test('workingDays 2026-11-02..2026-11-13 skips 11-11 and weekends', () => {
  const days = workingDays('2026-11-02', '2026-11-13', polishHolidays(2026));
  assert.strictEqual(days.length, 9);
  assert.ok(!days.includes('2026-11-11'));
  assert.ok(!days.includes('2026-11-07'));
  assert.ok(days.includes('2026-11-13'));
});

test('Christmas Eve is a holiday from 2025 and Easter-based days are computed', () => {
  assert.ok(polishHolidays(2025).has('2025-12-24'));
  assert.ok(!polishHolidays(2024).has('2024-12-24'));
  const h = polishHolidays(2026); // Easter 2026-04-05
  for (const d of ['2026-04-05', '2026-04-06', '2026-05-24', '2026-06-04']) assert.ok(h.has(d), d);
});

test('absence union counts a day once and never a weekend', () => {
  const wd = workingDays('2026-11-02', '2026-11-13', polishHolidays(2026));
  const auto = [{ slug: 'sam-rivera', name: 'Sam Rivera', entries: [{ dateFrom: '2026-11-02', dateTo: '2026-11-04' }] }];
  const manual = [{ person: 'Sam Rivera', dateFrom: '2026-11-04', dateTo: '2026-11-09', reason: '' }];
  const map = absenceDaysByPerson(auto, manual, wd);
  // 11-02, 11-03, 11-04 (twice -> once), 11-05, 11-06, 11-09 (weekend 11-07/08 excluded)
  assert.strictEqual(map.get('sam-rivera').size, 6);
});

test('capacity ratio honours extraDaysOff', () => {
  const c = capacity({ people: 5, workingDaysCount: 10, extraDaysOff: 1, absentDays: 9 });
  assert.strictEqual(c.nominal, 45);
  assert.strictEqual(c.available, 36);
  assert.strictEqual(c.ratio, 0.8);
});

test('velocityProposal uses the last 3 closed sprints below N and skips active', () => {
  const sprints = [
    { sprintN: 16, state: 'closed', done: 100 },
    { sprintN: 17, state: 'closed', done: 30 },
    { sprintN: 18, state: 'closed', done: 20 },
    { sprintN: 19, state: 'closed', done: 40 },
    { sprintN: 20, state: 'active', done: 5 },
  ];
  const v = velocityProposal(sprints, 21, 0.5);
  assert.deepStrictEqual(v.basis.map((s) => s.sprintN), [19, 18, 17]);
  assert.strictEqual(v.average, 30);
  assert.strictEqual(v.proposal, 15);
});

test('velocityProposal with 1-2 basis sprints and with none', () => {
  const one = velocityProposal([{ sprintN: 5, state: 'closed', done: 10 }, { sprintN: 6, state: 'closed', done: 20 }], 7, 1);
  assert.strictEqual(one.proposal, 15);
  const none = velocityProposal([{ sprintN: 9, state: 'active', done: 3 }], 10, 1);
  assert.strictEqual(none.proposal, null);
  assert.deepStrictEqual(none.basis, []);
});

test('progress counts 7 sections; slots: null -> [], filled -> matching weekdays', () => {
  const plan = { sections: { oncall: { done: true }, goal: { done: true }, jira: { done: false } } };
  assert.deepStrictEqual(progress(plan), { done: 2, total: 7 });
  assert.deepStrictEqual(slotDatesInSprint(null, '2026-10-20', '2026-11-03'), []);
  assert.strictEqual(formatSlot(null), SLOT_PLACEHOLDER);
  const slot = { weekday: 2, from: '10:00', to: '11:00' };
  assert.deepStrictEqual(slotDatesInSprint(slot, '2026-10-20', '2026-11-03'), ['2026-10-20', '2026-10-27', '2026-11-03']);
  assert.strictEqual(formatSlot(slot), 'Tuesday, 10:00-11:00');
});

test('jiraSprintUrl and esc', () => {
  assert.strictEqual(
    jiraSprintUrl({ sprintId: 9, boardId: 101, projectKey: 'ATL', jiraBase: 'https://j.example/' }),
    'https://j.example/secure/RapidBoard.jspa?rapidView=101&projectKey=ATL&sprint=9',
  );
  assert.strictEqual(jiraSprintUrl({ jiraBase: 'x' }), null);
  assert.strictEqual(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('zero nominal capacity gives no ratio and no velocity proposal', () => {
  const c = capacity({ people: 0, workingDaysCount: 10, extraDaysOff: 0, absentDays: 0 });
  assert.strictEqual(c.ratio, null);
  const v = velocityProposal([{ sprintN: 20, state: 'closed', done: 30 }], 21, c.ratio);
  assert.strictEqual(v.average, 30);
  assert.strictEqual(v.proposal, null);
});

test('mergeRanges joins overlapping and adjacent leave entries', () => {
  const m = mergeRanges([
    { dateFrom: '2026-10-05', dateTo: '2026-10-12' },
    { dateFrom: '2026-10-05', dateTo: '2026-10-11' },
    { dateFrom: '2026-10-13', dateTo: '2026-10-14' },
    { dateFrom: '2026-10-20', dateTo: '2026-10-20' },
  ]);
  assert.deepStrictEqual(m, [
    { dateFrom: '2026-10-05', dateTo: '2026-10-14' },
    { dateFrom: '2026-10-20', dateTo: '2026-10-20' },
  ]);
});

test('velocity proposal is scaled against a regular sprint: holidays, days off and length move it', () => {
  const sprints = [{ sprintN: 20, state: 'closed', done: 40 }];
  const proposalFor = (c) => velocityProposal(sprints, 21, c.baselineRatio).proposal;
  const regular = capacity({ people: 5, workingDaysCount: 10, extraDaysOff: 0, absentDays: 0, regularDays: regularSprintDays(2) });
  assert.strictEqual(regular.baselineRatio, 1);
  assert.strictEqual(proposalFor(regular), 40);
  // Two holidays: the old available/nominal ratio stayed 1 and hid them.
  const holidays = capacity({ people: 5, workingDaysCount: 8, extraDaysOff: 0, absentDays: 0, regularDays: 10 });
  assert.strictEqual(holidays.ratio, 1);
  assert.strictEqual(proposalFor(holidays), 32);
  // Team day off counts against the baseline too.
  const dayOff = capacity({ people: 5, workingDaysCount: 10, extraDaysOff: 1, absentDays: 0, regularDays: 10 });
  assert.strictEqual(proposalFor(dayOff), 36);
  // A 3-week exception against a 2-week regular sprint gives more capacity.
  const longer = capacity({ people: 5, workingDaysCount: 15, extraDaysOff: 0, absentDays: 0, regularDays: 10 });
  assert.strictEqual(proposalFor(longer), 60);
  // No people -> no baseline -> no proposal.
  const none = capacity({ people: 0, workingDaysCount: 10, extraDaysOff: 0, absentDays: 0, regularDays: 10 });
  assert.strictEqual(none.baselineRatio, null);
  assert.strictEqual(proposalFor(none), null);
});

test('regularSprintDays: weekdays of the team length, 2 weeks by default', () => {
  assert.strictEqual(regularSprintDays(2), 10);
  assert.strictEqual(regularSprintDays(3), 15);
  assert.strictEqual(regularSprintDays(undefined), 10);
  assert.strictEqual(regularSprintDays('x'), 10);
});

test('endExclusive: a whole-week range drops its last day, others keep it', () => {
  const plan = { dateFrom: '2026-10-06', dateTo: '2026-10-20' };
  assert.strictEqual(endExclusive(plan), true);
  const hol = polishHolidays(2026);
  assert.strictEqual(workingDays(plan.dateFrom, plan.dateTo, hol, { endExclusive: endExclusive(plan) }).length, 10);
  assert.strictEqual(workingDays(plan.dateFrom, plan.dateTo, hol, { endExclusive: false }).length, 11);
  assert.strictEqual(endExclusive({ dateFrom: '2026-10-06', dateTo: '2026-10-19' }), false);
  assert.strictEqual(endExclusive({ dateFrom: '2026-10-06', dateTo: '2026-10-09' }), false);
  assert.strictEqual(endExclusive({ dateFrom: null, dateTo: null }), false);
});

test('holidays across a year boundary, holidaysInRange and entryDaysInSprint', () => {
  const hol = holidaysForRange('2026-12-22', '2027-01-05');
  for (const d of ['2026-12-24', '2026-12-25', '2026-12-26', '2027-01-01', '2027-01-06']) assert.ok(hol.has(d), d);
  assert.deepStrictEqual(holidaysInRange('2026-12-22', '2027-01-05', hol), ['2026-12-24', '2026-12-25', '2027-01-01']);
  assert.deepStrictEqual(holidaysInRange('2026-12-22', '2027-01-05', hol, { endExclusive: true }), ['2026-12-24', '2026-12-25', '2027-01-01']);
  assert.deepStrictEqual(holidaysInRange('2026-12-22', '2026-12-25', hol, { endExclusive: true }), ['2026-12-24']);
  const wd = workingDays('2026-11-02', '2026-11-13', polishHolidays(2026));
  assert.strictEqual(entryDaysInSprint('2026-11-09', '2026-11-20', wd), 4);
  assert.strictEqual(entryDaysInSprint('bad', '2026-11-20', wd), 0);
});

test('jiraIssueUrl accepts only issue keys; mostFrequentPerson picks by column', () => {
  assert.strictEqual(jiraIssueUrl('https://j.example/', 'ATL-12'), 'https://j.example/browse/ATL-12');
  assert.strictEqual(jiraIssueUrl('https://j.example', 'atl-12'), null);
  assert.strictEqual(jiraIssueUrl('', '../x'), null);
  const entries = [
    { column: 'platform', person: 'Alex' }, { column: 'platform', person: 'Sam' }, { column: 'platform', person: 'Alex' },
    { column: 'devops', person: 'Casey' }, { column: 'other', person: 'Jordan' }, { column: 'platform', person: '' },
  ];
  assert.strictEqual(mostFrequentPerson(entries, ['platform']), 'Alex');
  assert.strictEqual(mostFrequentPerson(entries, ['platform', 'devops', 'other']), 'Alex');
  assert.strictEqual(mostFrequentPerson(entries, ['nope']), '');
});

test('client and server slugify agree', () => {
  const require = createRequire(import.meta.url);
  const server = require('../server/sources.js');
  for (const name of ['Robin Złotek', 'Sam Rivera', 'Đorđe Øster', '  Alex   Other App Read ', 'Anna-Maria Novak', null]) {
    assert.strictEqual(slugify(name), server.slugify(name), String(name));
  }
  assert.strictEqual(slugify('Robin Złotek'), 'robin-zlotek');
});
