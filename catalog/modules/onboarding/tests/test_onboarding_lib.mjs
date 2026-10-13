// modules/onboarding/tests/test_onboarding_lib.mjs
// Pure functions from client/onboarding-lib.js and client/onboarding-export.js.
// No document access - these two files must stay importable in plain Node.

import test from 'node:test';
import assert from 'node:assert';
import {
  isInternalUrl, viewIdFromUrl, parseWhoEntries, buildWhoString, recipientEmails,
  buildTeamsDraftUrl, sessionDraftText, formatWhen, MONTHS_SHORT, MONTHS_FULL,
  pad2, monthGrid, filterMembers, moveRow, chipColorIndex, CHIP_COLORS,
  sortPlans, activePlanOrDefault,
} from '../client/onboarding-lib.js';
import { buildPlanExportHtml, exportAvatarColor, LOGO_SVG } from '../client/onboarding-export.js';

// -- isInternalUrl / viewIdFromUrl -------------------------------------------

test('onboarding-lib: isInternalUrl/viewIdFromUrl', () => {
  assert.strictEqual(isInternalUrl('view://team-directory-main'), true);
  assert.strictEqual(isInternalUrl('https://example.com'), false);
  assert.strictEqual(isInternalUrl(''), false);
  assert.strictEqual(viewIdFromUrl('view://team-directory-main'), 'team-directory-main');
  assert.strictEqual(viewIdFromUrl('https://example.com'), '');
});

// -- parseWhoEntries / buildWhoString -----------------------------------------

test('onboarding-lib: parseWhoEntries handles empty, plain and email-suffixed names', () => {
  assert.deepStrictEqual(parseWhoEntries(''), [{ name: '', email: '' }]);
  assert.deepStrictEqual(parseWhoEntries('Sam Rivera'), [{ name: 'Sam Rivera', email: '' }]);
  assert.deepStrictEqual(
    parseWhoEntries('Sam Rivera (sam@example.com), Alex Morgan'),
    [{ name: 'Sam Rivera', email: 'sam@example.com' }, { name: 'Alex Morgan', email: '' }],
  );
});

test('onboarding-lib: buildWhoString round-trips with parseWhoEntries', () => {
  const isMember = (name) => name === 'Alex Morgan';
  const entries = [
    { name: 'Sam Rivera', email: 'sam@example.com' },
    { name: 'Alex Morgan', email: 'alex@example.com' },
    { name: '', email: '' },
  ];
  const built = buildWhoString(entries, isMember);
  assert.strictEqual(built, 'Sam Rivera (sam@example.com), Alex Morgan');
  const reparsed = parseWhoEntries(built);
  assert.deepStrictEqual(reparsed, [
    { name: 'Sam Rivera', email: 'sam@example.com' },
    { name: 'Alex Morgan', email: '' },
  ]);
});

// -- recipientEmails -----------------------------------------------------------

test('onboarding-lib: recipientEmails prefers the parenthesised e-mail, dedupes', () => {
  const emailForName = (name) => (name === 'Alex Morgan' ? 'alex@example.com' : '');
  const emails = recipientEmails('Sam Rivera (sam@example.com), Alex Morgan, Alex Morgan', emailForName);
  assert.deepStrictEqual(emails, ['sam@example.com', 'alex@example.com']);
  assert.deepStrictEqual(recipientEmails('', emailForName), []);
  assert.deepStrictEqual(recipientEmails('Unknown Person', emailForName), []);
});

// -- buildTeamsDraftUrl --------------------------------------------------------

test('onboarding-lib: buildTeamsDraftUrl encodes and is empty with no recipients', () => {
  assert.strictEqual(buildTeamsDraftUrl([], 'Topic', 'Message'), '');
  const url = buildTeamsDraftUrl(['a@example.com', 'b@example.com'], 'Session: X', 'Hello');
  assert.ok(url.startsWith('https://teams.microsoft.com/l/chat/0/0?users=a%40example.com%2Cb%40example.com'));
  assert.ok(url.includes('topicName=Session%3A%20X'));
  assert.ok(url.includes('message=Hello'));
});

test('onboarding-lib: sessionDraftText embeds the row topic', () => {
  const text = sessionDraftText({ topic: 'Rollout' }, { name: 'Plan' });
  assert.ok(text.includes('Rollout'));
  assert.ok(text.includes('checklist'));
  assert.ok(text.startsWith('Hi,'));
});

// -- formatWhen -----------------------------------------------------------------

test('onboarding-lib: formatWhen - same month, cross-month, single date, verbatim text, empty', () => {
  assert.strictEqual(formatWhen(''), '');
  assert.strictEqual(formatWhen('2026-09-14|2026-09-15'), '14 - 15 Sep');
  assert.strictEqual(formatWhen('2026-09-28|2026-10-02'), '28 Sep - 2 Oct');
  assert.strictEqual(formatWhen('2026-09-14|'), '14 Sep');
  assert.strictEqual(formatWhen('Mon 1 Jun - Tue 2 Jun'), 'Mon 1 Jun - Tue 2 Jun');
});

test('onboarding-lib: MONTHS_SHORT/MONTHS_FULL are English month names', () => {
  assert.strictEqual(MONTHS_SHORT[9], 'Oct');
  assert.strictEqual(MONTHS_FULL[0], 'January');
  assert.strictEqual(MONTHS_FULL[9], 'October');
  assert.strictEqual(MONTHS_FULL[11], 'December');
});

// -- pad2 / monthGrid --------------------------------------------------------------

test('onboarding-lib: pad2', () => {
  assert.strictEqual(pad2(1), '01');
  assert.strictEqual(pad2(10), '10');
});

test('onboarding-lib: monthGrid - September 2026 starts on a Tuesday, 30 days', () => {
  const { firstDow, days } = monthGrid(2026, 8); // month is zero-based: 8 = September
  assert.strictEqual(firstDow, 1);
  assert.strictEqual(days, 30);
});

// -- filterMembers -----------------------------------------------------------------

test('onboarding-lib: filterMembers - limit and diacritic-insensitive match', () => {
  const members = Array.from({ length: 10 }, (_, i) => ({ first_name: 'Taylor', last_name: 'Test' + i }));
  members.push({ first_name: 'Zo\u00e9', last_name: '\u0141\u00f3pez' });
  assert.strictEqual(filterMembers(members, 'taylor').length, 8);
  assert.strictEqual(filterMembers(members, 'zoe lopez').length, 1);
  assert.deepStrictEqual(filterMembers([], 'x'), []);
});

// -- moveRow ---------------------------------------------------------------------

test('onboarding-lib: moveRow returns a new array, handles boundaries', () => {
  const rows = ['a', 'b', 'c'];
  const moved = moveRow(rows, 2, 0);
  assert.deepStrictEqual(moved, ['c', 'a', 'b']);
  assert.deepStrictEqual(rows, ['a', 'b', 'c'], 'original untouched');
  assert.deepStrictEqual(moveRow(rows, -1, 1), rows);
  assert.deepStrictEqual(moveRow(rows, 0, 5), rows);
  assert.deepStrictEqual(moveRow(rows, 1, 1), rows);
});

// -- chipColorIndex / CHIP_COLORS ------------------------------------------------

test('onboarding-lib: chipColorIndex is deterministic and in range', () => {
  const i1 = chipColorIndex('Sam Rivera');
  const i2 = chipColorIndex('Sam Rivera');
  assert.strictEqual(i1, i2);
  assert.ok(i1 >= 0 && i1 < CHIP_COLORS.length);
});

// -- sortPlans / activePlanOrDefault ---------------------------------------------

test('onboarding-lib: sortPlans - template first, then created_at, then locale name', () => {
  const plans = [
    { id: 'plan-b', name: 'Blake', created_at: '2026-01-02T00:00:00.000Z' },
    { id: 'default', name: 'Template' },
    { id: 'plan-a', name: 'Avery', created_at: '2026-01-01T00:00:00.000Z' },
  ];
  const sorted = sortPlans(plans);
  assert.deepStrictEqual(sorted.map((p) => p.id), ['default', 'plan-a', 'plan-b']);
});

test('onboarding-lib: activePlanOrDefault falls back to the first plan', () => {
  const plans = [{ id: 'default' }, { id: 'plan-a' }];
  assert.strictEqual(activePlanOrDefault(plans, 'plan-a').id, 'plan-a');
  assert.strictEqual(activePlanOrDefault(plans, 'missing').id, 'default');
  assert.strictEqual(activePlanOrDefault([], 'x'), null);
});

// -- buildPlanExportHtml (onboarding-export.js) -------------------------------

test('onboarding-export: buildPlanExportHtml embeds the logo, progress text and stays script-free', () => {
  const plan = { id: 'plan-1', name: 'Casey Novak' };
  const resolvedRows = [
    {
      row: { topic: 'Kickoff', description: '', who: 'Sam Rivera', when: '2026-09-14|2026-09-15', done: true },
      people: [{ displayName: 'Sam Rivera', initials: 'SR', email: 'sam@example.com', avatarDataUrl: null }],
      whenText: '14 - 15 Sep',
    },
    {
      row: { topic: 'Rollout', description: '', who: '', when: '', done: false },
      people: [],
      whenText: '',
    },
  ];
  const html = buildPlanExportHtml(plan, resolvedRows, '13 September 2026, 10:00');
  assert.ok(html.includes(LOGO_SVG));
  assert.ok(html.includes('Progress: 1 / 2 tasks'));
  assert.ok(html.includes('text-decoration:line-through'));
  assert.ok(!html.includes('<script'));
  assert.ok(!html.includes('var(--'));
  assert.ok(!/#[0-9a-fA-F]{3,6}/.test(html), 'no hex colour literals');
  const httpMatches = html.match(/https?:\/\/[^\s"']+/g) || [];
  assert.ok(httpMatches.every((u) => u.includes('teams.microsoft.com')), 'the only http(s) links are to Teams');
});

test('onboarding-export: buildPlanExportHtml reports the empty state with no rows', () => {
  const html = buildPlanExportHtml({ name: 'Empty' }, [], '13 September 2026, 10:00');
  assert.ok(html.includes('No tasks in this plan.'));
  assert.ok(html.includes('Progress: 0 / 0 tasks'));
});

test('onboarding-export: exportAvatarColor is deterministic', () => {
  assert.strictEqual(exportAvatarColor('Sam Rivera'), exportAvatarColor('Sam Rivera'));
});
