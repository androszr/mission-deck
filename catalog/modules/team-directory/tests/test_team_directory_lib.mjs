// modules/team-directory/tests/test_team_directory_lib.mjs
// Unit tests for the pure helpers in client/team-directory-lib.js - grouped
// per the plan's test budget: orderTeams, groupByTeam + filterMembers, then
// logoSlug + teamInitials + personCaption.

import test from 'node:test';
import assert from 'node:assert';
import {
  TEAM_ORDER, orderTeams, groupByTeam, filterMembers, teamInitials, logoSlug, personCaption,
  hasLogoColumn, NO_LOGO_COLUMN_TEAMS,
} from '../client/team-directory-lib.js';

// Every team of an example roster, in no particular order - orderTeams is
// what puts them in order.
const TODAY_TEAMS = [
  'Comet', 'Platform', 'Falcon', 'Leadership', 'Borealis', 'Echo',
  'Delta', 'Guests', 'Atlas', 'Other',
];

test('team-directory-lib: orderTeams - the example teams come back as three TEAM_ORDER blocks', () => {
  const blocks = orderTeams(TODAY_TEAMS);
  assert.strictEqual(blocks.length, 3);
  assert.deepStrictEqual(blocks[0], ['Atlas', 'Borealis', 'Comet', 'Delta', 'Echo', 'Falcon']);
  assert.deepStrictEqual(blocks[1], ['Leadership', 'Other', 'Platform']);
  assert.deepStrictEqual(blocks[2], ['Guests']);
});

test('team-directory-lib: orderTeams - an unknown team lands alphabetically in the second block, Guests stays last', () => {
  const blocks = orderTeams(['Atlas', 'Guests', 'Zenith', 'Leadership', 'Absolute']);
  assert.strictEqual(blocks.length, 3);
  assert.deepStrictEqual(blocks[0], ['Atlas']);
  // TEAM_ORDER's own second-block members keep their declared order first
  // (only Leadership is present here); the unlisted names are appended
  // after them, sorted alphabetically among themselves.
  assert.deepStrictEqual(blocks[1], ['Leadership', 'Absolute', 'Zenith']);
  assert.deepStrictEqual(blocks[2], ['Guests']);
});

test('team-directory-lib: orderTeams - a block with none of its teams present drops out, no double divider', () => {
  // Nothing from the middle block (Leadership, Other, Platform) present.
  const blocks = orderTeams(['Atlas', 'Borealis', 'Guests']);
  assert.strictEqual(blocks.length, 2);
  assert.deepStrictEqual(blocks[0], ['Atlas', 'Borealis']);
  assert.deepStrictEqual(blocks[1], ['Guests']);
});

test('team-directory-lib: TEAM_ORDER carries exactly two separators (three blocks)', () => {
  const separators = TEAM_ORDER.filter((v) => v === null).length;
  assert.strictEqual(separators, 2);
});

// ── groupByTeam + filterMembers ────────────────────────────────────────────

// Diacritics via \u escapes rather than raw bytes - the byte-level source
// stays ASCII, while the runtime string a test asserts on genuinely carries
// them, which is the whole point of testing normalizeSearch's diacritic
// folding.
function buildRoster() {
  const roster = [];
  let n = 0;
  const push = (first, last, role, team, email) => {
    n += 1;
    roster.push({ id: 'tm-' + n, first_name: first, last_name: last, role, team, email });
  };
  push('Alex', 'Morgan', 'Data Engineer', 'Atlas', 'alex.morgan@example.com');
  push('Sam', 'Rivera', 'Product Owner', 'Atlas', 'sam.rivera@example.com');
  push('Jordan', 'L\u00f8vg\u00e5rd', 'ML Engineer', 'Borealis', 'jordan.lovgard@example.com');
  push('Taylor', 'Kr\u00f3lak', 'Data Scientist', 'Comet', 'taylor.krolak@example.com');
  push('Casey', 'Novak', 'Business Owner', 'Guests', 'casey.novak@example.org');
  return roster;
}

test('team-directory-lib: groupByTeam - counts each team\'s members correctly', () => {
  const groups = groupByTeam(buildRoster());
  assert.strictEqual(groups.Atlas.length, 2);
  assert.strictEqual(groups.Borealis.length, 1);
  assert.strictEqual(groups.Comet.length, 1);
  assert.strictEqual(groups.Guests.length, 1);
  assert.strictEqual(Object.keys(groups).length, 4);
});

test('team-directory-lib: filterMembers - matches by first name, last name, role and e-mail fragment', () => {
  const roster = buildRoster();
  assert.strictEqual(filterMembers(roster, 'Alex').length, 1);
  assert.strictEqual(filterMembers(roster, 'Morgan').length, 1);
  assert.strictEqual(filterMembers(roster, 'Data Engineer').length, 1);
  assert.strictEqual(filterMembers(roster, 'example.com').length, 4);
  assert.strictEqual(filterMembers(roster, 'example.org').length, 1);
});

test('team-directory-lib: filterMembers - ignores case and diacritics', () => {
  const roster = buildRoster();
  assert.strictEqual(filterMembers(roster, 'lovgard').length, 1);
  assert.strictEqual(filterMembers(roster, 'LOVGARD').length, 1);
  assert.strictEqual(filterMembers(roster, 'krolak').length, 1);
});

test('team-directory-lib: filterMembers - empty query returns everything', () => {
  const roster = buildRoster();
  assert.strictEqual(filterMembers(roster, '').length, roster.length);
  assert.strictEqual(filterMembers(roster, '   ').length, roster.length);
});

// ── logoSlug + teamInitials + personCaption ────────────────────────────────

test('team-directory-lib: logoSlug - maps a known team and returns empty for Guests', () => {
  assert.strictEqual(logoSlug('Falcon'), 'falcon');
  assert.strictEqual(logoSlug('Platform'), 'platform');
  assert.strictEqual(logoSlug('Guests'), '');
  assert.strictEqual(logoSlug('Unknown Team'), '');
});

test('team-directory-lib: teamInitials - one-word and two-word team names', () => {
  assert.strictEqual(teamInitials('Guests'), 'G');
  assert.strictEqual(teamInitials('Night Owls'), 'NO');
});

test('team-directory-lib: personCaption - "First L." with a last name, first name alone without one', () => {
  assert.strictEqual(personCaption({ first_name: 'Alex', last_name: 'Morgan' }), 'Alex M.');
  assert.strictEqual(personCaption({ first_name: 'Casey' }), 'Casey');
});

// hasLogoColumn is the rule the card render branches on. It is deliberately
// NOT "logoSlug is empty": an unknown team has no slug but still gets a
// column with its initials, because that column is what keeps the cards in
// a row aligned. Only the teams in NO_LOGO_COLUMN_TEAMS lose it entirely.
test('team-directory-lib: hasLogoColumn - only Guests loses the column, an unknown team keeps it', () => {
  assert.strictEqual(hasLogoColumn('Guests'), false);
  assert.strictEqual(hasLogoColumn('Atlas'), true);
  assert.strictEqual(hasLogoColumn('Unknown Team'), true, 'no slug is not the same as no column');
  assert.strictEqual(logoSlug('Unknown Team'), '', 'and that team indeed has no logo file');
  assert.deepStrictEqual(NO_LOGO_COLUMN_TEAMS, ['Guests']);
});
