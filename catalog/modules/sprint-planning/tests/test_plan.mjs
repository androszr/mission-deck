// modules/sprint-planning/tests/test_plan.mjs
// Pure plan logic (server/plan.js): patch whitelist, dates, settings. No fs.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const plan = require(path.join(DIR, 'server', 'plan.js'));

const NOW = new Date('2026-10-09T09:00:00.000Z');
const LATER = new Date('2026-10-09T10:00:00.000Z');
const counter = () => { let n = 0; return (len) => Buffer.alloc(len, ++n); };
const fresh = () => plan.buildNewPlan({ team: 'atlas', sprintN: 21, dateFrom: '2026-10-20', dateTo: '2026-11-03', now: NOW });
const patchOf = (body) => plan.applyPlanPatch(fresh(), body, LATER, counter());
const sec = (name, fields) => ({ sections: { [name]: fields } });

test('applyPlanPatch: body and sections must be objects, unknown keys are refused', () => {
  for (const bad of [null, 'x', 5, [], undefined]) assert.match(patchOf(bad).error, /object/, String(bad));
  assert.match(patchOf({ nope: 1 }).error, /Unknown field: nope/);
  assert.match(patchOf({ sections: null }).error, /sections/);
  assert.match(patchOf({ sections: [] }).error, /sections/);
  assert.match(patchOf(sec('bogus', {})).error, /Unknown section/);
  assert.match(patchOf({ sections: { goal: [] } }).error, /object/);
  assert.match(patchOf({ sections: { goal: null } }).error, /object/);
  assert.match(patchOf(sec('goal', { nope: 1 })).error, /Unknown field of section goal/);
});

test('applyPlanPatch: inherited Object.prototype keys never resolve to a field', () => {
  for (const key of ['constructor', 'valueOf', 'toString', 'hasOwnProperty']) {
    assert.match(patchOf(sec('goal', { [key]: { evil: true } })).error, /Unknown field of section goal/, key);
  }
  const proto = JSON.parse('{"sections":{"goal":{"__proto__":{"goal":"x"}}}}');
  assert.match(patchOf(proto).error, /Unknown field of section goal: __proto__/);
  const protoSec = JSON.parse('{"sections":{"__proto__":{"goal":"x"}}}');
  assert.match(patchOf(protoSec).error, /Unknown section/);
  assert.match(patchOf(sec('constructor', {})).error, /Unknown section/);
});

test('applyPlanPatch: text is trimmed and truncated, done must be boolean, types are checked', () => {
  assert.equal(patchOf(sec('goal', { goal: '  Goal  ' })).plan.sections.goal.goal, 'Goal');
  assert.equal(patchOf(sec('goal', { goal: 'a'.repeat(2500) })).plan.sections.goal.goal.length, 2000);
  assert.equal(patchOf(sec('oncall', { dev: 'b'.repeat(900) })).plan.sections.oncall.dev.length, 500);
  assert.match(patchOf(sec('goal', { goal: 5 })).error, /string/);
  assert.match(patchOf(sec('goal', { done: 'true' })).error, /boolean/);
  assert.equal(patchOf(sec('goal', { done: true })).plan.sections.goal.done, true);
});

test('applyPlanPatch: intRange coerces numeric strings, nullable clears, bounds refuse', () => {
  assert.equal(patchOf(sec('capacity', { peopleOverride: '7' })).plan.sections.capacity.peopleOverride, 7);
  assert.equal(patchOf(sec('capacity', { peopleOverride: '' })).plan.sections.capacity.peopleOverride, null);
  assert.equal(patchOf(sec('capacity', { peopleOverride: null })).plan.sections.capacity.peopleOverride, null);
  assert.match(patchOf(sec('capacity', { peopleOverride: 51 })).error, /range/);
  assert.match(patchOf(sec('capacity', { peopleOverride: -1 })).error, /range/);
  assert.match(patchOf(sec('capacity', { peopleOverride: 'abc' })).error, /range/);
  assert.match(patchOf(sec('capacity', { peopleOverride: NaN })).error, /range/);
  assert.match(patchOf(sec('capacity', { extraDaysOff: null })).error, /range/);
  assert.match(patchOf(sec('capacity', { extraDaysOff: 11 })).error, /range/);
  assert.equal(patchOf(sec('capacity', { extraDaysOff: 10 })).plan.sections.capacity.extraDaysOff, 10);
  assert.equal(patchOf(sec('velocity', { override: 100000 })).plan.sections.velocity.override, 100000);
  assert.match(patchOf(sec('velocity', { override: 100001 })).error, /range/);
});

test('applyPlanPatch: lists - type, limit, item shape, id kept or generated', () => {
  assert.match(patchOf(sec('capacity', { events: 'x' })).error, /list/);
  const tooMany = Array.from({ length: 51 }, () => ({ text: 'a' }));
  assert.match(patchOf(sec('capacity', { events: tooMany })).error, /too long/);
  assert.equal(patchOf(sec('capacity', { events: tooMany.slice(0, 50) })).plan.sections.capacity.events.length, 50);
  assert.match(patchOf(sec('capacity', { events: [null] })).error, /wrong shape/);
  assert.match(patchOf(sec('capacity', { events: ['x'] })).error, /wrong shape/);
  const out = patchOf(sec('capacity', { events: [{ text: ' a ' }, { text: 'b', id: 'it-0a0b0c0d' }, { id: 'bad-id' }, {}] })).plan.sections.capacity.events;
  assert.deepEqual(out.map((e) => e.text), ['a', 'b', '', '']);
  assert.equal(out[1].id, 'it-0a0b0c0d');
  const ids = out.map((e) => e.id);
  assert.ok(ids.every((id) => /^it-[0-9a-f]{8}$/.test(id)));
  assert.equal(new Set(ids).size, ids.length, 'ids are distinct');
});

test('applyPlanPatch: manual absences need real dates in order', () => {
  const ok = patchOf(sec('absences', { manual: [{ person: 'Sam', dateFrom: '2026-10-21', dateTo: '2026-10-22', reason: 'Teams' }] }));
  assert.equal(ok.plan.sections.absences.manual[0].person, 'Sam');
  for (const [dateFrom, dateTo] of [['2026-10-22', '2026-10-21'], ['2026-02-30', '2026-03-02'], ['x', '2026-10-21'], [undefined, undefined]]) {
    assert.match(patchOf(sec('absences', { manual: [{ person: 'J', dateFrom, dateTo }] })).error, /date range/, String(dateFrom));
  }
});

test('applyPlanPatch: refinement items and cross-refinements (unknown team, dedup)', () => {
  const r = patchOf(sec('refinements', { items: [{ key: 'ATL-1', topic: 't', note: 'n' }], cross: [{ key: 'K', teams: ['borealis', 'borealis', 'delta'], note: '' }, { key: 'L' }] }));
  assert.deepEqual(r.plan.sections.refinements.cross.map((c) => c.teams), [['borealis', 'delta'], []]);
  assert.equal(r.plan.sections.refinements.items[0].key, 'ATL-1');
  assert.match(patchOf(sec('refinements', { cross: [{ key: 'K', teams: ['echo'] }] })).error, /Unknown team/);
});

test('applyPlanPatch: manual dates are validated, mark the source and keep the other end', () => {
  const r = patchOf({ dateTo: '2026-11-10' });
  assert.deepEqual([r.plan.dateFrom, r.plan.dateTo, r.plan.datesSource], ['2026-10-20', '2026-11-10', 'manual']);
  assert.match(patchOf({ dateFrom: '2026-11-04' }).error, /sprint dates are invalid/);
  assert.match(patchOf({ dateTo: '2026-02-30' }).error, /sprint dates are invalid/);
  assert.match(patchOf({ dateFrom: '2026-10-01', dateTo: '2026-11-13' }).error, /sprint dates are invalid/);
  assert.equal(patchOf({ dateFrom: '2026-10-01', dateTo: '2026-11-12' }).error, undefined);
});

test('applyPlanPatch: never mutates the input, keeps id and bumps updatedAt, ignores baseUpdatedAt', () => {
  const before = fresh();
  const snapshot = JSON.stringify(before);
  const r = plan.applyPlanPatch(before, { baseUpdatedAt: 'x', sections: { goal: { goal: 'G' } } }, LATER, counter());
  assert.equal(JSON.stringify(before), snapshot);
  assert.equal(r.plan.id, 'atlas-21');
  assert.equal(r.plan.updatedAt, LATER.toISOString());
  assert.equal(r.plan.createdAt, NOW.toISOString());
  const bad = plan.applyPlanPatch(before, { sections: { goal: { goal: 'G', nope: 1 } } }, LATER, counter());
  assert.ok(bad.error);
  assert.equal(JSON.stringify(before), snapshot);
});

test('nextStartAfter: whole weeks end where the next sprint starts; others roll to the start weekday', () => {
  const cfg = { sprintWeeks: 2, firstSprintN: 21, firstSprintStart: '2026-10-06' }; // Tuesday
  assert.equal(plan.nextStartAfter({ dateFrom: '2026-10-06', dateTo: '2026-10-20' }, cfg), '2026-10-20');
  assert.equal(plan.nextStartAfter({ dateFrom: '2026-10-06', dateTo: '2026-10-27' }, cfg), '2026-10-27');
  // Monday-to-Friday inclusive exception: day after is a Saturday -> Tuesday.
  assert.equal(plan.nextStartAfter({ dateFrom: '2026-10-06', dateTo: '2026-10-19' }, cfg), '2026-10-20');
  assert.equal(plan.nextStartAfter({ dateFrom: '2026-10-05', dateTo: '2026-10-16' }, cfg), '2026-10-20');
  // Shorter than a week, ending on a Friday.
  assert.equal(plan.nextStartAfter({ dateFrom: '2026-10-06', dateTo: '2026-10-09' }, cfg), '2026-10-13');
  // 17-day range ending on a Friday.
  assert.equal(plan.nextStartAfter({ dateFrom: '2026-10-06', dateTo: '2026-10-23' }, cfg), '2026-10-27');
  // Without settings: next Mon-Fri day.
  assert.equal(plan.nextStartAfter({ dateFrom: '2026-10-06', dateTo: '2026-10-09' }), '2026-10-12');
  assert.equal(plan.nextStartAfter({ dateFrom: '2026-10-06', dateTo: '2026-10-08' }), '2026-10-09');
});

test('datesFromSettings chains a manual exception onto the following sprints', () => {
  const cfg = { sprintWeeks: 2, firstSprintN: 21, firstSprintStart: '2026-10-06' };
  assert.equal(plan.datesFromSettings(cfg, 20, []), null);
  assert.equal(plan.datesFromSettings(null, 21, []), null);
  const prev = [{ sprintN: 21, dateFrom: '2026-10-06', dateTo: '2026-10-16' }]; // Tue-Fri of week two
  const next = plan.datesFromSettings(cfg, 22, prev);
  assert.deepEqual([next.dateFrom, next.dateTo, next.source], ['2026-10-20', '2026-11-03', 'settings']);
});

test('sprintDatesFor: exact Jira sprint, extrapolation, and no history', () => {
  const history = [
    { sprintN: 19, start: '2026-09-22', end: '2026-10-06' },
    { sprintN: 20, start: '2026-10-06', end: '2026-10-20' },
  ];
  assert.deepEqual(plan.sprintDatesFor(history, 20), { dateFrom: '2026-10-06', dateTo: '2026-10-20', source: 'jira' });
  assert.deepEqual(plan.sprintDatesFor(history, 22), { dateFrom: '2026-11-03', dateTo: '2026-11-17', source: 'computed' });
  assert.deepEqual(plan.sprintDatesFor([], 5), { dateFrom: null, dateTo: null, source: null });
  assert.deepEqual(plan.sprintDatesFor([{ sprintN: 1, start: '', end: '' }], 5), { dateFrom: null, dateTo: null, source: null });
});

test('validRange: 42-day boundary, order and real dates', () => {
  assert.equal(plan.validRange('2026-10-01', '2026-11-12'), true);
  assert.equal(plan.validRange('2026-10-01', '2026-11-13'), false);
  assert.equal(plan.validRange('2026-10-02', '2026-10-01'), false);
  assert.equal(plan.validRange('2026-02-30', '2026-03-02'), false);
  assert.equal(plan.validRange('2026-10-01', '2026-10-01'), true);
});

test('validateSettingsTeams: shape, bounds, null clears, only known teams', () => {
  const good = { sprintWeeks: '2', firstSprintN: 21, firstSprintStart: '2026-10-06' };
  assert.deepEqual(plan.validateSettingsTeams({ borealis: good }).teams.borealis, { sprintWeeks: 2, firstSprintN: 21, firstSprintStart: '2026-10-06' });
  assert.equal(plan.validateSettingsTeams({ borealis: null }).teams.borealis, null);
  assert.ok(plan.validateSettingsTeams([]).error);
  assert.ok(plan.validateSettingsTeams({ echo: good }).error);
  assert.ok(plan.validateSettingsTeams({ borealis: { ...good, sprintWeeks: 7 } }).error);
  assert.ok(plan.validateSettingsTeams({ borealis: { ...good, sprintWeeks: 'x' } }).error);
  assert.ok(plan.validateSettingsTeams({ borealis: { ...good, firstSprintN: 1000 } }).error);
  assert.ok(plan.validateSettingsTeams({ borealis: { ...good, firstSprintStart: '2026-02-30' } }).error);
  assert.ok(plan.validateSettingsTeams({ borealis: 'x' }).error);
});
