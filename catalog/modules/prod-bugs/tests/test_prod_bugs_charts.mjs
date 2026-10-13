import test from 'node:test';
import assert from 'node:assert';
import { buildBarSvg, scrollLeftForLast, BAR_GROUP_W, CHART_PAD } from '../client/prod-bugs-charts.mjs';
import { AREA_CONFIG } from '../client/prod-bugs-model.mjs';

const sprints = [1, 2, 3].map((n) => ({
  sprint: n,
  areas: {
    orders: { bugs: n, bugFixTime: null },
    otherModules: { bugs: 0, bugFixTime: 1.5 },
    platform: { bugs: 5, bugFixTime: 0 },
  },
}));
const svg = buildBarSvg(sprints, 'bugs', (v) => String(Math.round(v)), AREA_CONFIG);

test('svg width = left + n*group + right', () => {
  const w = CHART_PAD.left + 3 * BAR_GROUP_W + CHART_PAD.right;
  assert.match(svg, new RegExp('<svg width="' + w + '"'));
});

test('one bar per (sprint, area) with a value > 0', () => {
  // orders 3 + platform 3 = 6 bars; hover zones are transparent rects
  const bars = (svg.match(/<rect [^>]*opacity="0.85"/g) || []).length;
  assert.strictEqual(bars, 6);
  const fix = buildBarSvg(sprints, 'bugFixTime', String, AREA_CONFIG);
  assert.strictEqual((fix.match(/<rect [^>]*opacity="0.85"/g) || []).length, 3);
  assert.strictEqual((svg.match(/data-hover-idx=/g) || []).length, 3);
});

test('no hex colour in fill/stroke', () => {
  assert.doesNotMatch(svg, /(fill|stroke)="#/);
});

test('scrollLeftForLast', () => {
  assert.strictEqual(scrollLeftForLast(15), CHART_PAD.left + 10 * BAR_GROUP_W);
  assert.strictEqual(scrollLeftForLast(5), 0);
});
