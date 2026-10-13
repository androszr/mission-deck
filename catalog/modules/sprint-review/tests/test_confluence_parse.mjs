// modules/sprint-review/tests/test_confluence_parse.mjs
// Pure parsers in server/confluence.js against hand-built Confluence
// storage-format fixtures (never fetched from the network). Quotes are
// written as &ldquo;/&rdquo; entities (real Confluence storage format uses
// both forms) and format markers as JS \u{...} escapes, so this whole file
// stays ASCII on disk while still exercising the quoted-goal and emoji
// branches.
//
// Teams are not a fixed roster: every <h2> on
// the page is a team, in page order, and the alias map (session.TEAM_ALIASES)
// only normalises spelling - an unmapped heading keeps its own cleaned text.
// The Echo dual-section branch (Problem Space / Solution Space) is
// exercised directly here rather than through the bigger page fixture,
// which is reserved for tests/test_routes.mjs (the end-to-end import path).

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cf = require(path.join(DIR, 'server', 'confluence.js'));
const session = require(path.join(DIR, 'server', 'session.js'));

function fakeRandomBytes(hex) {
  let n = 0;
  return () => ({ toString: () => hex + String(n++).padStart(2, '0') });
}

const OPTS = { aliases: session.TEAM_ALIASES, dualSectionTeams: session.DUAL_SECTION_TEAMS };

function topicLi(title, opts) {
  const o = opts || {};
  const marker = o.presentation ? '\u{1F5BC}' : (o.discussion ? '\u{1F5E3}' : '');
  const userkeys = (o.presenterKeys || []).map((k) => '<ac:link><ri:user ri:userkey="' + k + '"/></ac:link>').join(' ');
  return '<li><p>Topic: ' + title + ' ' + marker + ' ' + userkeys + '</p></li>';
}

function sectionHtml(team, goal, statusColour, topicsHtml) {
  const statusMacro = statusColour
    ? '<ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">' + statusColour + '</ac:parameter></ac:structured-macro>'
    : '';
  return '<h2>' + team + '</h2>'
    + '<p>Sprint Goal: &ldquo;' + goal + '&rdquo;</p>'
    + '<p>' + statusMacro + '</p>'
    + '<ul>' + topicsHtml + '</ul>';
}

test('parseTitle reads the date and sprint number from a review page title', () => {
  const withDate = cf.parseTitle('17.09.2026 Sprint 18 Review');
  assert.deepEqual(withDate, { reviewDate: '2026-09-17', sprintN: 18 });

  const withoutDate = cf.parseTitle('Sprint Review working notes');
  assert.equal(withoutDate.reviewDate, null);
  assert.equal(withoutDate.sprintN, null);
});

test('canonicalTeamName corrects only the spelling it knows and keeps an unmapped heading as-is', () => {
  assert.equal(cf.canonicalTeamName('Falcon (EXT)', session.TEAM_ALIASES), 'Falcon');
  assert.equal(cf.canonicalTeamName('New Team', session.TEAM_ALIASES), 'New Team');
  assert.equal(cf.canonicalTeamName('   ', session.TEAM_ALIASES), null, 'an empty heading is not a team');
});

test('parseBody reads every <h2> section as a team, in page order, with goal/status/topics per team', () => {
  const userMap = { u1: 'Jordan Kim', u2: 'Alex Novak' };
  const atlasTopics = topicLi('New checkout', { presentation: true, presenterKeys: ['u1'] })
    + topicLi('Process retrospective', { discussion: true, presenterKeys: ['u2'] })
    + '<li><p>Topic: ...</p></li>';
  const body = sectionHtml('Atlas', 'Changes ready for release', 'green', atlasTopics)
    + sectionHtml('Borealis', 'Item list export', 'yellow', topicLi('Eksport XLSX'))
    + sectionHtml('Delta', 'Stabilizacja SAP', 'red', topicLi('Kolejka zdarzen'));

  const parsed = cf.parseBody(body, userMap, OPTS, fakeRandomBytes('aaaaaaaa'));
  assert.deepEqual(Object.keys(parsed), ['Atlas', 'Borealis', 'Delta'], 'page order is preserved');

  assert.equal(parsed.Atlas.goal, 'Changes ready for release');
  assert.equal(parsed.Atlas.realizationStatus, 'achieved');
  assert.equal(parsed.Atlas.topics.length, 2, 'the placeholder "Topic: ..." row is skipped');
  assert.equal(parsed.Atlas.topics[0].title, 'New checkout');
  assert.equal(parsed.Atlas.topics[0].format, 'presentation');
  assert.deepEqual(parsed.Atlas.topics[0].presenters, ['Jordan Kim']);
  assert.equal(parsed.Atlas.topics[1].format, 'discussion');

  assert.equal(parsed.Borealis.realizationStatus, 'partial');
  assert.equal(parsed.Delta.realizationStatus, 'not-achieved');
});

test('parseBody splits a dual-section team into topicsProblemSpace/topicsSolutionSpace with no flat topics key', () => {
  const body = '<h2>Echo</h2>'
    + '<h3>Problem Space</h3><ul>' + topicLi('Wolne zapytania') + '</ul>'
    + '<h3>Solution Space</h3><ul>' + topicLi('Indeks A') + topicLi('Cache B') + '</ul>';
  const parsed = cf.parseBody(body, {}, OPTS, fakeRandomBytes('bbbbbbbb'));
  assert.ok(parsed['Echo']);
  assert.equal(parsed['Echo'].topicsProblemSpace.length, 1);
  assert.equal(parsed['Echo'].topicsSolutionSpace.length, 2);
  assert.equal('topics' in parsed['Echo'], false);
});

test('parseBody falls back to a plain-text split for a dual-section team with no <h3> headings', () => {
  const body = '<h2>Echo</h2><p>Problem Space</p><ul>' + topicLi('Wolny problem') + '</ul>'
    + '<p>Solution Space</p><ul>' + topicLi('Dobre rozwiazanie') + '</ul>';
  const parsed = cf.parseBody(body, {}, OPTS, fakeRandomBytes('cccccccc'));
  assert.equal(parsed['Echo'].topicsProblemSpace.length, 1);
  assert.equal(parsed['Echo'].topicsSolutionSpace.length, 1);
});

test('parseBody appends a repeated heading\'s topics to the first section instead of overwriting it', () => {
  const body = sectionHtml('Atlas', 'Goal', 'green', topicLi('First topic'))
    + sectionHtml('Atlas', 'Goal', 'green', topicLi('Second topic'));
  const parsed = cf.parseBody(body, {}, OPTS, fakeRandomBytes('dddddddd'));
  assert.equal(Object.keys(parsed).length, 1, 'the second Atlas section merges into the first, not a new entry');
  assert.equal(parsed.Atlas.topics.length, 2);
  assert.deepEqual(parsed.Atlas.topics.map((t) => t.title), ['First topic', 'Second topic']);
});

test('parseBody leaves realizationStatus empty when no status macro is present', () => {
  const body = sectionHtml('Atlas', 'Goal', null, topicLi('A topic'));
  const parsed = cf.parseBody(body, {}, OPTS, fakeRandomBytes('eeeeeeee'));
  assert.equal(parsed.Atlas.realizationStatus, '');
});

test('parseBody leaves realizationStatus empty when two status macros are present', () => {
  const twoMacros = '<ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">green</ac:parameter></ac:structured-macro>'
    + '<ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">red</ac:parameter></ac:structured-macro>';
  const body = '<h2>Atlas</h2><p>Sprint Goal: &ldquo;Goal&rdquo;</p><p>' + twoMacros + '</p><ul>' + topicLi('A topic') + '</ul>';
  const parsed = cf.parseBody(body, {}, OPTS, fakeRandomBytes('ffffffff'));
  assert.equal(parsed.Atlas.realizationStatus, '');
});

test('mergeTopicsList refreshes format/presenters only for confluence-sourced topics, by count per title', () => {
  const old = [
    { id: 't-11111111', title: 'Manual topic', format: 'discussion', presenters: ['Someone'] },
    { id: 'cf-22222222', title: 'Powtorka', format: 'discussion', presenters: ['Stary'] },
    { id: 'cf-33333333', title: 'Powtorka', format: 'discussion', presenters: ['Stary2'] },
  ];
  const fresh = [
    { id: 'cf-44444444', title: 'Manual topic', format: 'presentation', presenters: ['Newcomer'] },
    { id: 'cf-55555555', title: 'Powtorka', format: 'presentation', presenters: ['Nowy2'] },
    { id: 'cf-66666666', title: 'Powtorka', format: 'presentation', presenters: ['Nowy3'] },
    { id: 'cf-77777777', title: 'Powtorka', format: 'presentation', presenters: ['Nowy4'] },
    { id: 'cf-88888888', title: 'Powtorka', format: 'presentation', presenters: ['Nowy5'] },
  ];
  const merged = cf.mergeTopicsList(old, fresh);
  const manual = merged.find((t) => t.id === 't-11111111');
  assert.equal(manual.format, 'discussion');
  assert.deepEqual(manual.presenters, ['Someone']);
  assert.equal(merged.find((t) => t.id === 'cf-22222222').format, 'presentation');
  assert.equal(merged.find((t) => t.id === 'cf-33333333').format, 'presentation');
  const powtorkaTotal = merged.filter((t) => t.title === 'Powtorka').length;
  assert.equal(powtorkaTotal, 4, '4 fresh "Powtorka" vs 2 old -> exactly 2 new rows added');
});

test('mergeReimportedSubmissions keeps manual fields and merges topicsProblemSpace/topicsSolutionSpace separately', () => {
  const old = {
    'Echo': {
      submitted: true,
      realizationStatus: 'partial',
      submittedAt: '2026-08-01T00:00:00.000Z',
      topicsProblemSpace: [{ id: 't-11111111', title: 'Reczny problem', format: '', presenters: [] }],
      topicsSolutionSpace: [],
    },
  };
  const fresh = {
    'Echo': {
      submitted: true,
      realizationStatus: 'achieved',
      topicsProblemSpace: [],
      topicsSolutionSpace: [{ id: 'cf-22222222', title: 'Nowe rozwiazanie', format: 'discussion', presenters: [] }],
    },
  };
  const merged = cf.mergeReimportedSubmissions(old, fresh, session.DUAL_SECTION_TEAMS);
  assert.equal(merged['Echo'].realizationStatus, 'partial', 'manual field survives re-import');
  assert.equal(merged['Echo'].submittedAt, '2026-08-01T00:00:00.000Z', 'unknown legacy field survives');
  assert.equal(merged['Echo'].topicsProblemSpace.length, 1, 'the manual problem-space topic is kept');
  assert.equal(merged['Echo'].topicsSolutionSpace.length, 1, 'the fresh solution-space topic is appended');
});

test('discoverStatus reports new, synced and outdated against an existing session', () => {
  const page = { id: '111', version: { number: 3 } };
  assert.equal(cf.discoverStatus(page, null), 'new');
  assert.equal(cf.discoverStatus(page, { confluencePageId: '111', confluenceVersion: 3 }), 'synced');
  assert.equal(cf.discoverStatus(page, { confluencePageId: '111', confluenceVersion: 2 }), 'outdated');
});
