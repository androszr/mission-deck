// modules/devops-stats/tests/test_extract.mjs
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveFieldIds, statusTable, issueToFact, markEpics, buildJql, validateFact, toIso, mergeStatuses,
} from '../scripts/_extract.mjs';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const load = (n) => JSON.parse(fs.readFileSync(path.join(FIX, n), 'utf8'));

const fieldIds = resolveFieldIds(load('fields.json'));
const statuses = statusTable(load('project-statuses.json'));
const categoryById = new Map(statuses.map((s) => [s.id, s.category]));
const page1 = load('search-page-1.json');
const page2 = load('search-page-2.json');
const ctx = { fieldIds, categoryById };

test('resolveFieldIds picks fields by schema and returns null when absent', () => {
  assert.deepStrictEqual(fieldIds, { epic_link: 'customfield_10100', epic_name: 'customfield_10101', flagged: 'customfield_10200' });
  assert.deepStrictEqual(resolveFieldIds([]), { epic_link: null, epic_name: null, flagged: null });
  assert.strictEqual(resolveFieldIds([{ id: 'bad', schema: { custom: 'com.pyxis.greenhopper.jira:gh-epic-link' } }]).epic_link, null);
});

test('statusTable deduplicates by id and keeps the category key', () => {
  assert.strictEqual(statuses.length, 4);
  assert.deepStrictEqual(statuses.map((s) => s.category), ['new', 'indeterminate', 'indeterminate', 'done']);
});

test('issueToFact builds contiguous intervals, started_at and done_at', () => {
  const f = issueToFact(page1.issues[0], ctx);
  assert.deepStrictEqual(f.intervals.map((i) => i.s), ['1', '2', '4']);
  assert.strictEqual(f.intervals[0].from, f.created);
  assert.strictEqual(f.intervals[0].to, f.intervals[1].from);
  assert.strictEqual(f.intervals[1].to, f.intervals[2].from);
  assert.strictEqual(f.intervals[2].to, null);
  assert.strictEqual(f.started_at, '2026-09-02T08:00:00.000Z');
  assert.strictEqual(f.done_at, '2026-09-03T08:00:00.000Z');
  assert.strictEqual(f.epic_key, 'DEVOPS-3');
  assert.deepStrictEqual(validateFact(f), []);
});

test('issueToFact: skipped in-progress leaves started_at null; reopened issue is not done', () => {
  const skipped = issueToFact(page1.issues[1], ctx);
  assert.strictEqual(skipped.started_at, null);
  assert.strictEqual(skipped.done_at, '2026-09-06T08:00:00.000Z');
  const reopened = issueToFact(page2.issues[0], ctx);
  assert.strictEqual(reopened.done_at, null);
  assert.strictEqual(reopened.started_at, '2026-09-11T08:00:00.000Z');
});

test('issueToFact reads flagged intervals (open one stays open)', () => {
  const f = issueToFact(page1.issues[0], ctx);
  assert.deepStrictEqual(f.flagged, [{ from: '2026-09-02T12:00:00.000Z', to: null }]);
});

test('markEpics flags epic-name carriers and referenced keys, not sub-task parents', () => {
  const facts = page1.issues.map((i) => issueToFact(i, ctx));
  const marked = markEpics(facts);
  assert.deepStrictEqual(marked.map((f) => f.is_epic), [false, false, true]);
  const sub = { ...facts[0], key: 'DEVOPS-9', subtask: true, epic_key: 'DEVOPS-2' };
  assert.strictEqual(markEpics([facts[1], sub]).find((f) => f.key === 'DEVOPS-2').is_epic, false);
});

test('buildJql and toIso', () => {
  // An issue created before the lookback but closed inside it must be fetched (lead-time tail).
  assert.match(buildJql('full'), /\(updated >= -365d OR statusCategory != Done\)/);
  assert.doesNotMatch(buildJql('full'), /created >=/);
  assert.match(buildJql('incremental', '2026-09-01T08:30:00Z'), /updated >= "2026\/09\/01 08:30"/);
  assert.throws(() => buildJql('incremental', 'nope'));
  assert.strictEqual(toIso('2026-01-05T10:00:00.000+0100'), '2026-01-05T09:00:00.000Z');
});

test('validateFact rejects overlapping intervals and a foreign key', () => {
  const f = issueToFact(page1.issues[0], ctx);
  assert.ok(validateFact({ ...f, key: 'OTHER-1' }).length > 0);
  const bad = { ...f, intervals: [{ s: '1', from: '2026-09-01T00:00:00Z', to: '2026-09-05T00:00:00Z' }, { s: '2', from: '2026-09-03T00:00:00Z', to: null }] };
  assert.ok(validateFact(bad).some((e) => /overlaps/.test(e)));
});

test('mergeStatuses keeps project statuses authoritative and adds global ones as historic', () => {
  const merged = mergeStatuses(statuses, load('global-statuses.json'));
  const by = new Map(merged.map((s) => [s.id, s]));
  assert.strictEqual(by.get('2').category, 'indeterminate');
  assert.strictEqual(by.get('2').current, true);
  assert.strictEqual(by.get('4').name, 'Finished');
  assert.deepStrictEqual(by.get('10600'), { id: '10600', name: 'Old review', category: 'indeterminate', current: false });
  assert.strictEqual(by.get('13807').category, 'done');
  const used = mergeStatuses(statuses, load('global-statuses.json'), ['10600']);
  assert.deepStrictEqual(used.map((s) => s.id), ['1', '2', '3', '4', '10600']);
  assert.strictEqual(mergeStatuses(statuses, undefined).length, 4);
  assert.strictEqual(mergeStatuses(statuses, null).every((s) => s.current), true);
});

test('issueToFact: logged time prefers the sub-task aggregate, null when nothing is logged', () => {
  const raw = page1.issues[0];
  const withBoth = { ...raw, fields: { ...raw.fields, timespent: 3600, aggregatetimespent: 7200 } };
  assert.strictEqual(issueToFact(withBoth, ctx).time_spent_s, 7200);
  const plainOnly = { ...raw, fields: { ...raw.fields, timespent: 1800, aggregatetimespent: null } };
  assert.strictEqual(issueToFact(plainOnly, ctx).time_spent_s, 1800);
  const none = issueToFact(raw, ctx);
  assert.strictEqual(none.time_spent_s, null);
  assert.deepStrictEqual(validateFact(none), []);
  assert.ok(validateFact({ ...none, time_spent_s: -5 }).some((e) => /time_spent_s/.test(e)));
});

test('issueToFact: worklogs keep author, start and seconds; absent field stays absent', () => {
  const raw = page1.issues[0];
  const withWl = { ...raw, fields: { ...raw.fields, worklog: { total: 3, worklogs: [
    { author: { displayName: 'Kim Taylor' }, started: '2026-09-03T10:00:00.000+0200', timeSpentSeconds: 2700 },
    { author: { name: 'jkowal' }, started: '2026-09-02T09:00:00.000+0200', timeSpentSeconds: 3600 },
    { author: { displayName: 'Bad' }, started: 'nope', timeSpentSeconds: 60 },
  ] } } };
  const f = issueToFact(withWl, ctx);
  assert.deepStrictEqual(f.worklogs, [
    { author: 'jkowal', started: '2026-09-02T07:00:00.000Z', seconds: 3600 },
    { author: 'Kim Taylor', started: '2026-09-03T08:00:00.000Z', seconds: 2700 },
  ]);
  assert.deepStrictEqual(validateFact(f), []);
  assert.ok(!('worklogs' in issueToFact(raw, ctx)));
  assert.ok(validateFact({ ...f, worklogs: [{ author: 'x', started: 'bad', seconds: 1 }] }).some((e) => /worklog/.test(e)));
});
