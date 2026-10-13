// modules/sprint-stats/tests/test_normalize.mjs
// detectPhase, indexEntryOf, validateTeamSprint and mergeIndex, driven off
// the synthetic sprint-16 fixture (tests/fixtures/sprint-main-16.json).

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const normalize = require('../server/normalize.js');

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(DIR, 'tests', 'fixtures');
const readFixture = (name) => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));

test('detectPhase: closed always END, active within 2 days START, active later MID, other states START', () => {
  assert.strictEqual(normalize.detectPhase('closed', '2026-08-01', new Date('2026-09-01')), 'END');
  assert.strictEqual(normalize.detectPhase('active', '2026-08-10', new Date('2026-08-11')), 'START');
  assert.strictEqual(normalize.detectPhase('active', '2026-08-10', new Date('2026-08-12')), 'START');
  assert.strictEqual(normalize.detectPhase('active', '2026-08-10', new Date('2026-08-15')), 'MID');
  assert.strictEqual(normalize.detectPhase('future', '2026-09-01', new Date('2026-08-15')), 'START');
  assert.strictEqual(normalize.detectPhase('active', null, new Date('2026-08-15')), 'MID');
});

test('indexEntryOf: strips persons/issues/burndown/extra, keeps counts', () => {
  const sprint = readFixture('sprint-main-16.json');
  const entry = normalize.indexEntryOf(sprint);
  assert.strictEqual(entry.src, 'main');
  assert.strictEqual(entry.sprint_n, 16);
  for (const t of entry.teams) {
    assert.strictEqual('persons' in t, false);
    assert.strictEqual('issues' in t, false);
    assert.strictEqual('burndown' in t, false);
    assert.strictEqual('extra' in t, false);
    assert.strictEqual(typeof t.issues_count, 'number');
    assert.strictEqual(typeof t.persons_count, 'number');
    assert.strictEqual(t.has_burndown, true);
  }
  const atlas = entry.teams.find((t) => t.team === 'Atlas');
  assert.strictEqual(atlas.issues_count, 4);
  assert.strictEqual(atlas.persons_count, 3);
});

test('validateTeamSprint: a fixture team-sprint is valid, a corrupted one lists errors', () => {
  const sprint = readFixture('sprint-main-16.json');
  const atlas = sprint.teams.find((t) => t.team === 'Atlas');
  assert.deepStrictEqual(normalize.validateTeamSprint(atlas), []);

  const broken = { ...atlas, src: 'unknown', summary: { ...atlas.summary, committed: 'x' }, issues: [{ status_bucket: 'nope' }] };
  const errors = normalize.validateTeamSprint(broken);
  assert.ok(errors.length > 0);
  assert.ok(errors.some((e) => e.includes('src')));
  assert.ok(errors.some((e) => e.includes('summary.committed')));
  assert.ok(errors.some((e) => e.includes('status_bucket')));
});

test('mergeIndex: onlyMissing never overwrites an existing (src, sprint_n), sorted by src then sprint_n', () => {
  const existing = [
    { src: 'main', sprint_n: 16, phase: 'END', teams: [] },
    { src: 'platform', sprint_n: 1, phase: 'END', teams: [] },
  ];
  const incoming = [
    { src: 'main', sprint_n: 16, phase: 'MID', teams: [{ marker: 'fresh' }] }, // would regress a fresher record
    { src: 'main', sprint_n: 17, phase: 'MID', teams: [] },
  ];
  const result = normalize.mergeIndex(existing, incoming, { onlyMissing: true });
  assert.deepStrictEqual(result.written, [{ src: 'main', sprint_n: 17 }]);
  assert.deepStrictEqual(result.skipped, [{ src: 'main', sprint_n: 16 }]);
  assert.strictEqual(result.sprints.find((s) => s.src === 'main' && s.sprint_n === 16).phase, 'END');
  assert.deepStrictEqual(result.sprints.map((s) => s.src + ':' + s.sprint_n), ['main:16', 'main:17', 'platform:1']);
});

test('mergeIndex: without onlyMissing, an incoming entry overwrites the existing one (ETL refresh)', () => {
  const existing = [{ src: 'main', sprint_n: 16, phase: 'MID', teams: [] }];
  const incoming = [{ src: 'main', sprint_n: 16, phase: 'END', teams: [{ marker: 'refreshed' }] }];
  const result = normalize.mergeIndex(existing, incoming, { onlyMissing: false });
  assert.deepStrictEqual(result.written, [{ src: 'main', sprint_n: 16 }]);
  assert.deepStrictEqual(result.skipped, []);
  assert.strictEqual(result.sprints[0].phase, 'END');
});
