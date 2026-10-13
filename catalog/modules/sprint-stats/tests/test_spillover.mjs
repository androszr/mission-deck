// modules/sprint-stats/tests/test_spillover.mjs
// Pure aggregation of closed MAIN sprints (server/spillover.js) on a synthetic index.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const spillover = require('../server/spillover.js');

const FIXTURE = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'fixtures', 'spillover-index.json');
const load = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

test('spillover: a sprint with one active team is skipped, a fully closed one enters, other boards are ignored', () => {
  const agg = spillover.buildSpilloverAggregate(load());
  assert.deepStrictEqual(agg.sprints.map((s) => s.sprint_n), [6, 7]);
});

test('spillover: END phase counts dropped + wip + todo as spillover, done stays untouched', () => {
  const agg = spillover.buildSpilloverAggregate(load());
  const s6 = agg.sprints[0];
  assert.strictEqual(s6.committed_sp, 100);
  assert.strictEqual(s6.done_sp, 80);
  assert.strictEqual(s6.spillover_full, 4 + 3 + 3 + 10);
  assert.strictEqual(agg.teams.Atlas.sprints[0].spillover_full, 10);
});

test('spillover: teams come from the data, in board order, and only with a closed sprint', () => {
  const index = load();
  const agg = spillover.buildSpilloverAggregate(index);
  assert.deepStrictEqual(agg.team_names, ['Atlas', 'Borealis', 'Comet']);
  assert.deepStrictEqual(Object.keys(agg.teams), agg.team_names);
  index.sprints[1].teams[2].state = 'active';
  const without = spillover.buildSpilloverAggregate(index);
  assert.deepStrictEqual(without.team_names, ['Atlas', 'Borealis']);
  assert.strictEqual(without.teams.Comet, undefined);
});

test('spillover: percentages round to one place and avg_spillover_pct is the mean of rounded sprint percentages', () => {
  const agg = spillover.buildSpilloverAggregate(load());
  const g = agg.teams.Atlas;
  assert.deepStrictEqual(g.sprints.map((r) => r.spillover_pct), [25, 10]);
  assert.strictEqual(g.avg_spillover_pct, 17.5);
  assert.strictEqual(g.avg_committed_sp, 45);
  assert.strictEqual(g.avg_spillover_full, 7.5);
  assert.strictEqual(g.worst_sprint_n, 6);
  assert.strictEqual(g.worst_sprint_label, 'S06');
  assert.strictEqual(g.worst_spillover_pct, 25);
  assert.strictEqual(agg.sprints[0].completion_pct, 80);
  const r = agg.teams.Borealis;
  assert.strictEqual(r.sprints[0].spillover_pct, 16.7);
  assert.strictEqual(r.sprints[1].spillover_pct, 20);
  assert.strictEqual(r.avg_spillover_pct, 18.4);
});

test('spillover: committed 0 gives 0 percent, never NaN', () => {
  const agg = spillover.buildSpilloverAggregate(load());
  const k = agg.teams.Comet.sprints[0];
  assert.strictEqual(k.spillover_pct, 0);
  assert.strictEqual(k.completion_pct, 0);
  assert.ok(!JSON.stringify(agg).includes('NaN'));
});

test('spillover: label is S07 style and period comes from the first team of the entry', () => {
  assert.strictEqual(spillover.formatSprintLabel(7), 'S07');
  assert.strictEqual(spillover.formatSprintLabel(12), 'S12');
  assert.strictEqual(spillover.formatPeriod('2026-04-07T09:00:00.000+02:00', '2026-04-21T09:00:00.000+02:00'), '07.04 -- 21.04');
  const agg = spillover.buildSpilloverAggregate(load());
  assert.strictEqual(agg.sprints[0].period, '07.04 -- 21.04');
  assert.strictEqual(agg.teams.Borealis.sprints[0].period, '08.04 -- 22.04');
});

test('spillover: spilloverText is deterministic, generated_at comes from the index, key order is fixed', () => {
  const a = spillover.spilloverText(spillover.buildSpilloverAggregate(load()));
  const b = spillover.spilloverText(spillover.buildSpilloverAggregate(load()));
  assert.strictEqual(a, b);
  assert.ok(a.endsWith('}\n'));
  const agg = JSON.parse(a);
  assert.strictEqual(agg.generated_at, '2026-10-09T08:00:00');
  assert.deepStrictEqual(Object.keys(agg), ['schema_version', 'generated_at', 'source', 'team_names', 'sprints', 'teams']);
  assert.deepStrictEqual(agg.source, { board: 'main', active_sprint_n: 9 });
});
