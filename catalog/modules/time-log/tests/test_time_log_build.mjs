// modules/time-log/tests/test_time_log_build.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { buildTimeLog, readTrackedEmails } = require(path.join(DIR, 'server', 'build.js'));

function member(first, last, team, email) {
  return { first_name: first, last_name: last, team, email: email || '' };
}

test('buildTimeLog: only the six tracked teams get a shard (other teams excluded)', () => {
  const members = [
    member('Jordan', 'Lee', 'Borealis'),
    member('Riley', 'Stone', 'Finance'),
    member('Morgan', 'Price', 'Vendor X'),
    member('Avery', 'Quinn', 'Guests'),
  ];
  const { shards, index } = buildTimeLog([], members, ['2026-09-14']);
  assert.strictEqual(shards.length, 1);
  assert.strictEqual(shards[0].name, 'Jordan Lee');
  assert.deepStrictEqual(Object.keys(index.persons), [shards[0].slug]);
});

test('buildTimeLog: people listed in trackedEmails get a shard despite team "Other"; other Other members do not', () => {
  const members = [
    member('Casey', 'Novak', 'Other', 'casey.novak@example.com'),
    member('Taylor', 'Kim', 'Other', 'Taylor.Kim@example.com'),
    member('Drew', 'Parker', 'Other', 'drew.parker@example.com'),
  ];
  const trackedEmails = readTrackedEmails({ trackedEmails: ['casey.novak@example.com', ' TAYLOR.KIM@example.com ', 'not-an-email', 42] });
  assert.deepStrictEqual(trackedEmails, ['casey.novak@example.com', 'taylor.kim@example.com']);
  const { shards } = buildTimeLog([], members, ['2026-09-14'], { trackedEmails });
  assert.deepStrictEqual(shards.map((s) => s.name).sort(), ['Casey Novak', 'Taylor Kim']);
  assert.strictEqual(buildTimeLog([], members, ['2026-09-14']).shards.length, 0, 'nobody outside the teams by default');
  assert.deepStrictEqual(readTrackedEmails(null), []);
});

test('buildTimeLog: worklogs on the same issue merge into one entry (summed hours, latest logged_at), the day total covers a third issue too', () => {
  const members = [member('Sam', 'Rivera', 'Comet', 'sam.rivera@example.com')];
  const worklogs = [
    { author: { name: 'sam.rivera@example.com', displayName: 'Sam Rivera' }, issue: { key: 'APP-1', summary: 'Fix the checkout' }, timeSpentSeconds: 900, dateStarted: '2026-09-14', dateCreated: '2026-09-14T08:00:00.000' },
    { author: { name: 'sam.rivera@example.com', displayName: 'Sam Rivera' }, issue: { key: 'APP-1', summary: 'Fix the checkout' }, timeSpentSeconds: 900, dateStarted: '2026-09-14', dateCreated: '2026-09-14T09:15:00.000' },
    { author: { name: 'sam.rivera@example.com', displayName: 'Sam Rivera' }, issue: { key: 'APP-2', summary: 'Update the price list' }, timeSpentSeconds: 900, dateStarted: '2026-09-14', dateCreated: '2026-09-14T07:00:00.000' },
  ];
  const { shards } = buildTimeLog(worklogs, members, ['2026-09-14']);
  const day = shards[0].days[0];
  assert.strictEqual(day.hours, 0.8);
  assert.strictEqual(day.issues.length, 2);
  const first = day.issues.find((i) => i.key === 'APP-1');
  assert.strictEqual(first.hours, 0.5);
  assert.strictEqual(first.logged_at, '2026-09-14T09:15:00.000');
  assert.strictEqual(first.summary, 'Fix the checkout');
  const second = day.issues.find((i) => i.key === 'APP-2');
  assert.strictEqual(second.hours, 0.3);
  assert.strictEqual(second.summary, 'Update the price list');
});

test('buildTimeLog: weekend and holiday do not count toward miss_days_count, an un-logged workday does', () => {
  const members = [member('Alex', 'Morgan', 'Atlas')];
  const dates = ['2026-09-14', '2026-09-12', '2026-01-01']; // Mon workday, Sat weekend, holiday (Thu)
  const { shards } = buildTimeLog([], members, dates);
  const [monday, saturday, newYear] = shards[0].days;
  assert.strictEqual(monday.is_weekend, false);
  assert.strictEqual(monday.is_holiday, false);
  assert.strictEqual(saturday.is_weekend, true);
  assert.strictEqual(saturday.is_holiday, false);
  assert.strictEqual(newYear.is_weekend, false);
  assert.strictEqual(newYear.is_holiday, true);
  assert.strictEqual(shards[0].miss_days_count, 1);
  assert.strictEqual(shards[0].logged_days_count, 0);
});

test('buildTimeLog: shards sort by (-miss_days_count, name), index matches the shards, unmatched authors are counted, out-of-window worklogs are dropped', () => {
  const members = [
    member('Zoe', 'Adams', 'Borealis'),
    member('Ann', 'Baker', 'Borealis'),
    member('Carl', 'Cole', 'Borealis'),
  ];
  const worklogs = [
    { author: { name: '', displayName: 'Carl Cole' }, issue: { key: 'APP-1' }, timeSpentSeconds: 3600, dateStarted: '2026-09-14', dateCreated: '2026-09-14T08:00:00.000' },
    { author: { name: 'ghost@example.com', displayName: 'Ghost Author' }, issue: { key: 'APP-9' }, timeSpentSeconds: 3600, dateStarted: '2026-09-14', dateCreated: '2026-09-14T08:00:00.000' },
    { author: { name: '', displayName: 'Carl Cole' }, issue: { key: 'APP-2' }, timeSpentSeconds: 3600, dateStarted: '2026-01-01', dateCreated: '2026-01-01T08:00:00.000' },
  ];
  const { shards, index, unmatched } = buildTimeLog(worklogs, members, ['2026-09-14']);
  assert.deepStrictEqual(shards.map((s) => s.name), ['Ann Baker', 'Zoe Adams', 'Carl Cole']);
  assert.strictEqual(shards[2].miss_days_count, 0);
  assert.strictEqual(shards[2].days[0].issues.length, 1, 'the out-of-window worklog must not appear');
  for (const s of shards) {
    assert.deepStrictEqual(index.persons[s.slug], { name: s.name, team: s.team, logged_days_count: s.logged_days_count, miss_days_count: s.miss_days_count });
  }
  assert.strictEqual(unmatched.length, 1);
  assert.strictEqual(unmatched[0].displayName, 'Ghost Author');
  assert.strictEqual(unmatched[0].worklogs, 1);
});

test('tempoConfig: the personal token first, the technical one as the fallback, placeholders count as missing', () => {
  const { tempoConfig } = require(path.join(DIR, 'server', 'tempo.js'));
  assert.equal(tempoConfig({ JIRA_TOKEN: ' p ' }).token, 'p');
  assert.equal(tempoConfig({ JIRA_TOKEN: 'p', JIRA_TECH_TOKEN: 't' }).token, 'p');
  assert.equal(tempoConfig({ JIRA_TECH_TOKEN: 't' }).token, 't');
  assert.equal(tempoConfig({ JIRA_TOKEN: 'your_jira_token_here', JIRA_TECH_TOKEN: 't' }).token, 't');
  const none = tempoConfig({ JIRA_TOKEN: 'your_jira_token_here' });
  assert.equal(none.ok, false);
  assert.deepEqual(none.missing, ['JIRA_TOKEN']);
  assert.equal(tempoConfig({ JIRA_URL: 'https://x/' }).jiraUrl, 'https://x');
});
