// modules/sprint-review/tests/test_client_lib.mjs
// Unit tests for the pure helpers in client/sprint-review-lib.mjs, plus the
// AC5 grep for a hardcoded hex color literal anywhere under client/ (the
// hex-color gate scans .js too - a template with a `<style` block carrying
// a literal color would slip past check-conventions.js's diff-scoped view,
// since modules/ is gitignored and never shows up in a diff).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  esc, fmtDateShort, formatCountdown, isHistorical, sessionLabel, sortSessions,
  buildAgendaText, renderAgendaMd, visualAgendaFilename, discoverBadge,
  poCandidates, presenterCandidates, fullNameOf, REALIZ_LABELS, FORMAT_LABELS,
  DUAL_SECTION_TEAMS, isDualSectionTeam, sectionsFor, teamOrder, topicsOf,
  hasAnyTopics, TOPIC_SECTIONS, teamLogoSlug, normTeamKey,
} from '../client/sprint-review-lib.mjs';

const CLIENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'client');
// CJS server module, read only to assert the client's DUAL_SECTION_TEAMS
// mirror (sprint-review-lib.mjs) has not drifted from the server's own
// constant (server/session.js) - the one thing both sides duplicate on
// purpose because client and server cannot cross-require.
const require = createRequire(import.meta.url);
const serverSession = require('../server/session.js');

test('sprint-review-lib: esc escapes the five HTML-sensitive characters', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('sprint-review-lib: fmtDateShort - "YYYY-MM-DD" to "D mmm YYYY"', () => {
  assert.equal(fmtDateShort('2026-09-17'), '17 Sep 2026');
  assert.equal(fmtDateShort('2026-01-05'), '5 Jan 2026');
  assert.equal(fmtDateShort(''), '');
  assert.equal(fmtDateShort('bad'), '');
});

test('sprint-review-lib: formatCountdown - days/hours/minutes and the past', () => {
  const now = new Date('2026-09-10T10:00:00.000Z');
  assert.equal(formatCountdown(new Date('2026-09-13T14:12:00.000Z'), now), '3d 4h 12min');
  assert.equal(formatCountdown(new Date('2026-09-10T14:12:00.000Z'), now), '4h 12min');
  assert.equal(formatCountdown(new Date('2026-09-10T10:12:00.000Z'), now), '12min');
  assert.equal(formatCountdown(new Date('2026-09-09T10:00:00.000Z'), now), 'Deadline passed');
});

test('sprint-review-lib: isHistorical - past reviewDate, today, future, missing', () => {
  const now = new Date('2026-09-13T09:00:00.000Z');
  assert.equal(isHistorical({ reviewDate: '2026-09-12' }, now), true);
  assert.equal(isHistorical({ reviewDate: '2026-09-13' }, now), false, 'still today until 23:59:59Z');
  assert.equal(isHistorical({ reviewDate: '2026-09-14' }, now), false);
  assert.equal(isHistorical({}, now), false);
});

test('sprint-review-lib: sessionLabel - name, date, Confluence tag and archive suffix', () => {
  const now = new Date('2026-09-13T09:00:00.000Z');
  assert.equal(sessionLabel({ sprintName: 'Sprint 18', reviewDate: '2026-09-17' }, now), 'Sprint 18 - 17 Sep 2026');
  assert.equal(
    sessionLabel({ sprintName: 'Sprint 17', reviewDate: '2026-09-24', confluencePageId: '123' }, now),
    'Sprint 17 - 24 Sep 2026 [Confluence]',
  );
  assert.equal(
    sessionLabel({ sprintName: 'Sprint 16', reviewDate: '2026-08-01' }, now),
    'Sprint 16 - 1 Aug 2026 - archive',
  );
  assert.equal(sessionLabel({ id: 'sr-0000000000abcdef' }, now), 'Session abcdef');
});

test('sprint-review-lib: sortSessions - newest reviewDate first', () => {
  const sessions = [
    { id: 'a', reviewDate: '2026-09-01' },
    { id: 'b', reviewDate: '2026-09-17' },
    { id: 'c', reviewDate: '2026-09-10' },
  ];
  assert.deepEqual(sortSessions(sessions).map((s) => s.id), ['b', 'c', 'a']);
});

// ── teamOrder / isDualSectionTeam / sectionsFor / topicsOf / hasAnyTopics ──

test('sprint-review-lib: DUAL_SECTION_TEAMS mirrors server/session.js exactly', () => {
  assert.deepEqual(DUAL_SECTION_TEAMS, serverSession.DUAL_SECTION_TEAMS);
});

test('sprint-review-lib: teamOrder - teamGoals order plus an orphan submissions key', () => {
  const session = {
    teamGoals: [{ team: 'Atlas' }, { team: 'Borealis' }, { team: 'Echo' }, { team: 'Delta' }],
    submissions: { 'Echo': {}, Zaskakujacy: {} },
  };
  assert.deepEqual(teamOrder(session), ['Atlas', 'Borealis', 'Echo', 'Delta', 'Zaskakujacy']);
  assert.deepEqual(teamOrder({}), []);
});

test('sprint-review-lib: teamOrder matches server sessionTeams() on the same fixture', () => {
  const session = {
    teamGoals: [{ team: 'Atlas' }, { team: 'Borealis' }, { team: 'Echo' }],
    submissions: { Delta: {} },
  };
  assert.deepEqual(teamOrder(session), serverSession.sessionTeams(session));
});

test('sprint-review-lib: isDualSectionTeam / sectionsFor - explicit list wins over the mirror', () => {
  assert.equal(isDualSectionTeam('Echo'), true, 'falls back to the local mirror with no list given');
  assert.equal(isDualSectionTeam('Echo', []), false, 'an explicit empty list is authoritative');
  assert.equal(isDualSectionTeam('Delta', ['Delta']), true);
  assert.deepEqual(sectionsFor('Echo', ['Echo']), ['topicsProblemSpace', 'topicsSolutionSpace']);
  assert.deepEqual(sectionsFor('Atlas', ['Echo']), ['topics']);
});

test('sprint-review-lib: topicsOf - present, absent, non-array', () => {
  assert.deepEqual(topicsOf({ topics: [{ id: 't-1' }] }, 'topics'), [{ id: 't-1' }]);
  assert.deepEqual(topicsOf({}, 'topics'), []);
  assert.deepEqual(topicsOf({ topics: 'not-an-array' }, 'topics'), []);
  assert.deepEqual(topicsOf(null, 'topics'), []);
});

test('sprint-review-lib: hasAnyTopics - across a dual-section team\'s two lists', () => {
  const empty = { teamGoals: [{ team: 'Atlas' }, { team: 'Echo' }], submissions: {} };
  assert.equal(hasAnyTopics(empty, ['Echo']), false);
  const onlySolution = {
    teamGoals: [{ team: 'Atlas' }, { team: 'Echo' }],
    submissions: { 'Echo': { topicsProblemSpace: [], topicsSolutionSpace: [{ id: 't-1' }] } },
  };
  assert.equal(hasAnyTopics(onlySolution, ['Echo']), true);
});

test('sprint-review-lib: TOPIC_SECTIONS labels', () => {
  assert.deepEqual(TOPIC_SECTIONS, {
    topics: 'Topics',
    topicsProblemSpace: 'Problem Space',
    topicsSolutionSpace: 'Solution Space',
  });
});

// ── buildAgendaText / renderAgendaMd ────────────────────────────────────────

test('sprint-review-lib: buildAgendaText - header, goal, realization, topics, N teams in page order', () => {
  const session = {
    sprintName: 'Sprint 18',
    reviewDate: '2026-09-17',
    facilitatorPo: 'Jordan Kim',
    teamGoals: [
      { team: 'Atlas', goal: 'Ship instalments' },
      { team: 'Borealis', goal: 'Finish the migration' },
    ],
    submissions: {
      Atlas: {
        realizationStatus: 'partial',
        topics: [{ id: 't-1', title: 'New checkout', format: 'presentation', presenters: ['Jordan Kim'] }],
      },
      Borealis: { realizationStatus: 'achieved', topics: [] },
    },
  };
  const text = buildAgendaText(session);
  assert.match(text, /^# Sprint 18/);
  assert.match(text, /## Atlas/);
  assert.match(text, /## Borealis/);
  assert.ok(text.indexOf('## Atlas') < text.indexOf('## Borealis'), 'teams in teamGoals order');
  assert.match(text, /Sprint Goal: "Ship instalments"/);
  assert.match(text, /Goal status: Partially/);
  assert.match(text, /Sprint Goal: "Finish the migration" ✅/, 'a realized goal carries the checkmark, not a text suffix');
  assert.match(text, /1\. New checkout - _Jordan Kim_ \(Presentation\)/);
});

test('sprint-review-lib: buildAgendaText - dual-section team gets Problem/Solution Space h3s, empty sections omitted', () => {
  const session = {
    sprintName: 'Sprint 17',
    reviewDate: '2026-09-07',
    teamGoals: [{ team: 'Echo', goal: '' }],
    submissions: {
      'Echo': {
        realizationStatus: '',
        topicsProblemSpace: [],
        topicsSolutionSpace: [{ id: 't-1', title: 'Stock service refactor', format: 'discussion', presenters: [] }],
      },
    },
  };
  const text = buildAgendaText(session, ['Echo']);
  assert.match(text, /## Echo/);
  assert.equal(text.includes('### Problem Space'), false, 'an empty section is not printed at all');
  assert.match(text, /### Solution Space/);
  assert.match(text, /1\. Stock service refactor - _-_ \(Discussion\)/);
});

test('sprint-review-lib: buildAgendaText - both dual sections empty reads "No topics"', () => {
  const session = {
    sprintName: 'Sprint 15',
    reviewDate: '2026-08-24',
    teamGoals: [{ team: 'Echo', goal: '' }],
    submissions: { 'Echo': { topicsProblemSpace: [], topicsSolutionSpace: [] } },
  };
  const text = buildAgendaText(session, ['Echo']);
  assert.match(text, /## Echo\nNo topics/);
});

test('sprint-review-lib: buildAgendaText - no teams at all reads just the header', () => {
  const session = { sprintName: 'Sprint 19', reviewDate: '2026-09-24', teamGoals: [], submissions: {} };
  const text = buildAgendaText(session);
  assert.match(text, /^# Sprint 19/);
  assert.equal(text.trim().endsWith('unknown') === false, true);
});

test('sprint-review-lib: renderAgendaMd - h1/h2/h3, list and no inline style=', () => {
  const html = renderAgendaMd('# Sprint 18\n## Atlas\n### Problem Space\n1. Topic A\n2. Topic B\n\nLast line');
  assert.match(html, /<h1 class="sr-md-h1">Sprint 18<\/h1>/);
  assert.match(html, /<h2 class="sr-md-h2">Atlas<\/h2>/);
  assert.match(html, /<h3 class="sr-md-h3">Problem Space<\/h3>/);
  assert.match(html, /<ol class="sr-md-ol"><li>Topic A<\/li><li>Topic B<\/li><\/ol>/);
  assert.match(html, /<p class="sr-md-p">Last line<\/p>/);
  assert.equal(html.includes('style='), false, 'no inline style attribute - client/style.css owns .sr-md-*');
});

test('sprint-review-lib: visualAgendaFilename - ascii, one argument, sprintName present/absent', () => {
  assert.equal(visualAgendaFilename('Sprint 18'), 'sprint-review-Sprint-18.html');
  assert.equal(visualAgendaFilename(''), 'sprint-review.html');
  assert.equal(visualAgendaFilename(), 'sprint-review.html');
});

test('sprint-review-lib: discoverBadge - the three Confluence-discover states', () => {
  assert.deepEqual(discoverBadge('new'), { cls: 'ds-badge--blue', label: 'New' });
  assert.deepEqual(discoverBadge('outdated'), { cls: 'ds-badge--yellow', label: 'Changed in Confluence' });
  assert.deepEqual(discoverBadge('synced'), { cls: 'ds-badge--gray', label: 'Up to date' });
});

test('sprint-review-lib: poCandidates - filtered by role, sorted pl', () => {
  const members = [
    { first_name: 'Zack', last_name: 'Zabel', role: 'Product Owner', team: 'Atlas' },
    { first_name: 'Alex', last_name: 'Adams', role: 'Senior Product Owner', team: 'Borealis' },
    { first_name: 'Parker', last_name: 'Pike', role: 'Developer', team: 'Atlas' },
  ];
  const result = poCandidates(members);
  assert.deepEqual(result.map((m) => fullNameOf(m)), ['Alex Adams', 'Zack Zabel']);
});

test('sprint-review-lib: normTeamKey - lowercase, spaces stripped', () => {
  assert.equal(normTeamKey('Falcon'), 'falcon');
  assert.equal(normTeamKey('Falcon'), 'falcon');
  assert.equal(normTeamKey(''), '');
});

test('sprint-review-lib: presenterCandidates - own team first (normTeamKey match), both halves sorted pl', () => {
  const members = [
    { first_name: 'Zoe', last_name: 'Ziegler', team: 'Borealis' },
    { first_name: 'Mark', last_name: 'Mason', team: 'Atlas' },
    { first_name: 'Ada', last_name: 'Adams', team: 'Atlas' },
    { first_name: 'Bella', last_name: 'Brook', team: 'Borealis' },
  ];
  const result = presenterCandidates(members, 'Atlas');
  assert.deepEqual(result.map((m) => fullNameOf(m)), ['Ada Adams', 'Mark Mason', 'Bella Brook', 'Zoe Ziegler']);
});

test('sprint-review-lib: presenterCandidates - "Falcon" (session) matches "Falcon" (roster)', () => {
  const members = [
    { first_name: 'Olivia', last_name: 'Orr', team: 'Falcon' },
    { first_name: 'Bart', last_name: 'Byrne', team: 'Borealis' },
  ];
  const result = presenterCandidates(members, 'Falcon');
  assert.deepEqual(result.map((m) => fullNameOf(m)), ['Olivia Orr', 'Bart Byrne']);
});

test('sprint-review-lib: teamLogoSlug - lowercase, non-alphanumeric stripped', () => {
  assert.equal(teamLogoSlug('Echo'), 'echo');
  assert.equal(teamLogoSlug('Falcon'), 'falcon');
  assert.equal(teamLogoSlug('Delta'), 'delta');
});

test('sprint-review-lib: REALIZ_LABELS / FORMAT_LABELS shape', () => {
  assert.equal(REALIZ_LABELS.achieved.label, 'Achieved');
  assert.equal(REALIZ_LABELS.partial.label, 'Partially');
  assert.equal(REALIZ_LABELS['not-achieved'].label, 'Not achieved');
  assert.deepEqual(FORMAT_LABELS, { presentation: 'Presentation', discussion: 'Discussion' });
});

// ── AC5: no hardcoded hex color anywhere under client/ ──────────────────────

test('sprint-review AC5: no hex color literal under client/ (js, mjs, css only)', () => {
  const hexRe = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/;
  const offenders = [];
  (function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const stat = fs.statSync(p);
      if (stat.isDirectory()) { walk(p); continue; }
      if (!/\.(js|mjs|css)$/.test(name)) continue;
      const text = fs.readFileSync(p, 'utf8');
      for (const [i, line] of text.split('\n').entries()) {
        if (hexRe.test(line)) offenders.push(path.relative(CLIENT_DIR, p) + ':' + (i + 1) + ': ' + line.trim());
      }
    }
  })(CLIENT_DIR);
  assert.deepEqual(offenders, [], 'hex color literal(s) found:\n' + offenders.join('\n'));
});

// Regression guard for the 415 found in visual verification on 2026-09-13: the
// core's checkOrigin refuses EVERY mutating request without a JSON content type
// (its CSRF gate), so a bodiless DELETE with no header never reached the route.
// Every non-GET fetch() in the entry file must therefore carry the header.
test('client/index.js: every mutating fetch() carries Content-Type application/json', () => {
  const text = fs.readFileSync(path.join(CLIENT_DIR, 'index.js'), 'utf8');
  const offenders = [];
  const re = /fetch\(([\s\S]*?)\{[\s\S]*?method:\s*'(POST|PUT|DELETE|PATCH)'([\s\S]*?)\}\s*\)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const call = m[0];
    if (!/'Content-Type':\s*'application\/json'/.test(call)) {
      const line = text.slice(0, m.index).split('\n').length;
      offenders.push('index.js:' + line + ' ' + m[2]);
    }
  }
  assert.deepEqual(offenders, [], 'mutating fetch() without a JSON Content-Type:\n' + offenders.join('\n'));
});
