// SVG builders of client/flow-charts.mjs: accessibility, tokens, empty state.
import test from 'node:test';
import assert from 'node:assert';
import * as FC from '../client/flow-charts.mjs';

const POINTS = [
  { label: 'W40', wip: 3, done: 2 },
  { label: 'W41', wip: 5, done: 4 },
  { label: 'W42', wip: 4, done: 1, current: true },
];

test('line and bar charts are role=img with an aria-label', () => {
  const line = FC.buildLineChart(POINTS, { lines: [{ key: 'wip', label: 'In progress', color: FC.LINE_COLORS.primary }], ariaLabel: 'Chart of issues in progress' });
  const bar = FC.buildBarChart(POINTS, { key: 'done', label: 'Delivered', color: FC.LINE_COLORS.secondary, ariaLabel: 'Chart of delivered issues' });
  for (const svg of [line, bar]) {
    assert.match(svg, /role="img"/);
    assert.match(svg, /aria-label="Chart of [^"]*issues/);
  }
});

test('no hex colour in the output', () => {
  const line = FC.buildLineChart(POINTS, { lines: [{ key: 'wip', label: 'In progress', color: FC.LINE_COLORS.primary }], ariaLabel: 'x' });
  const bar = FC.buildBarChart(POINTS, { key: 'done', label: 'Delivered', color: FC.LINE_COLORS.secondary, ariaLabel: 'x' });
  assert.doesNotMatch(line + bar, /#[0-9a-fA-F]{3,8}\b/);
});

test('an all-null series renders the empty line, not an SVG', () => {
  const pts = [{ label: 'W40', m: null }, { label: 'W41', m: null }];
  const html = FC.buildLineChart(pts, { lines: [{ key: 'm', label: 'm', color: 'x' }], ariaLabel: 'x' });
  assert.match(html, /No data in the selected period/);
  assert.doesNotMatch(html, /<svg/);
});
