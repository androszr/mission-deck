// modules/sprint-stats/tests/test_sprint_charts.mjs
// Pure client/sprint-charts.mjs: the 8-sprint trend window and its arrow
// state, and the hard rule that every colour in the SVG is a DS token or
// currentColor - never a hex literal.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as charts from '../client/sprint-charts.mjs';
import * as model from '../client/sprint-model.mjs';

function _team(sprintNs, activeN) {
  return {
    name: 'Atlas',
    unit: 'SP',
    activeN,
    sprints: sprintNs.map((n) => ({
      sprint_n: n,
      phase: n === activeN ? 'MID' : 'END',
      teamData: {
        summary: { committed: 10 + n, done: 5, wip: 1, todo: 1, dropped: 1, added: 0, total_issues: 8, completion_pct: 50 },
      },
    })),
  };
}

test('getVisibleWindow: last 8 sprints at offset 0, arrows reflect whether an older/newer window exists', () => {
  const allNs = Array.from({ length: 18 }, (_, i) => i + 1); // 1..18
  const w0 = charts.getVisibleWindow(allNs, 0);
  assert.deepEqual(w0.items, allNs.slice(-8));
  assert.equal(w0.items.length, 8);
  assert.equal(w0.canNext, false); // already at the newest window
  assert.equal(w0.canPrev, true); // 10 older sprints remain

  const w1 = charts.getVisibleWindow(allNs, 1);
  assert.deepEqual(w1.items, allNs.slice(2, 10));
  assert.equal(w1.canNext, true);
  assert.equal(w1.canPrev, true);

  const short = charts.getVisibleWindow([1, 2, 3], 0);
  assert.deepEqual(short.items, [1, 2, 3]);
  assert.equal(short.canPrev, false);
  assert.equal(short.canNext, false);
});

test('buildTrendSection: SVG output never carries a hex colour, only var(--legend-*) and currentColor', () => {
  const teams = [_team([16, 17, 18], 18)];
  const section = charts.buildTrendSection(teams, 0);
  assert.ok(section.html.includes('<svg'));
  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(section.html), 'no hex literal anywhere in the chart html');
  assert.ok(section.html.includes('var(--legend-4th-primary)'));
  assert.ok(section.html.includes('var(--legend-1st-primary)'));
  assert.ok(section.html.includes('var(--legend-5th-primary)'));
  assert.ok(section.html.includes('currentColor'));

  const empty = charts.buildTrendSection([], 0);
  assert.equal(empty.html, '');

  // effectiveDropped is reused, not reimplemented: an END-phase point folds
  // wip+todo into dropped exactly like the table/tile do.
  const endTeams = [{
    name: 'Atlas', unit: 'SP', activeN: 2,
    sprints: [
      { sprint_n: 1, phase: 'END', teamData: { summary: { committed: 10, done: 5, wip: 2, todo: 1, dropped: 1, added: 0, total_issues: 8, completion_pct: 50 } } },
      { sprint_n: 2, phase: 'MID', teamData: { summary: { committed: 10, done: 5, wip: 2, todo: 1, dropped: 1, added: 0, total_issues: 8, completion_pct: 50 } } },
    ],
  }];
  assert.equal(model.effectiveDropped(endTeams[0].sprints[0].teamData.summary, 'END', 'SP'), 1 + 2 + 1);
});

test('buildBurndownSection: maxSprints 1 draws the active sprint alone, the default draws up to four', () => {
  const shard = (src, n, phase) => ({ src, sprint_n: n, phase, teams: [{ team: 'Atlas', unit: 'SP', summary: { committed: 100 }, burndown: [{ day_n: 0, remaining: 100 }, { day_n: 1, remaining: 90 }] }] });
  const sprints = [15, 16, 17, 18].map((n) => ({ sprint_n: n, phase: n === 18 ? 'MID' : 'END', _src: 'main', teamData: {} }));
  const teams = [{ name: 'Atlas', key: 'Atlas', unit: 'SP', sprints, activeN: 18 }];
  const shards = new Map(sprints.map((s) => ['main:' + s.sprint_n, shard('main', s.sprint_n, s.phase)]));
  const one = charts.buildBurndownSection(teams, shards, { maxSprints: 1 }).html;
  assert.match(one, /active sprint/);
  assert.doesNotMatch(one, /S17/);
  const four = charts.buildBurndownSection(teams, shards).html;
  assert.match(four, /last 4 sprints/);
  assert.match(four, /S15/);
});

test('teamColor: known team keeps its token, an unknown team gets the first fallback token', () => {
  assert.equal(charts.teamColor('Atlas'), 'var(--legend-2nd-primary)');
  assert.equal(charts.teamColor('New team'), 'var(--legend-6th-primary)');
  assert.equal(charts.teamColor('New team'), 'var(--legend-6th-primary)');
});

test('buildSpilloverChart: labelled axes, threshold line, a bar per team, tokens only', () => {
  const agg = {
    team_names: ['Atlas', 'Borealis'],
    sprints: [{ sprint_n: 1, label: 'S01' }],
    teams: {
      Atlas: { sprints: [{ sprint_n: 1, label: 'S01', spillover_pct: 32.1 }] },
      Borealis: { sprints: [{ sprint_n: 1, label: 'S01', spillover_pct: 10 }] },
    },
  };
  const html = charts.buildSpilloverChart(agg, 'all');
  assert.match(html, /aria-label="Spillover percentage by sprint"/);
  assert.match(html, /Spillover %<\/text>/);
  assert.match(html, /stroke-dasharray="4,3"/);
  assert.match(html, /Atlas S01: 32\.1%/);
  assert.doesNotMatch(html, /#[0-9a-fA-F]{3,6}\b/);
  const only = charts.buildSpilloverChart(agg, 'Borealis');
  assert.doesNotMatch(only, /Atlas S01/);
});

test('spilloverYMax: 60 by default, raised to the next 10 above it, only for the teams drawn', () => {
  const agg = { teams: {
    A: { sprints: [{ spillover_pct: 12 }, { spillover_pct: 58.9 }] },
    B: { sprints: [{ spillover_pct: 73.9 }] },
  } };
  assert.strictEqual(charts.spilloverYMax(agg, ['A']), 60);
  assert.strictEqual(charts.spilloverYMax(agg, ['A', 'B']), 80);
  assert.strictEqual(charts.spilloverYMax({ teams: {} }, ['A']), 60);
  const html = charts.buildSpilloverChart({ team_names: ['A', 'B'], sprints: [{ sprint_n: 1, label: 'S01' }], teams: {
    A: { sprints: [{ sprint_n: 1, label: 'S01', spillover_pct: 20 }] },
    B: { sprints: [{ sprint_n: 1, label: 'S01', spillover_pct: 73.9 }] },
  } }, 'all');
  assert.ok(html.includes('>80%</text>'), 'the axis reaches 80%');
  assert.ok(!html.includes('>90%</text>'), 'and stops there');
});
