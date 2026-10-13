// vendor-settlements/tests/test_vs_chart.mjs
// The chart's pure computation and its SVG.
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeBarsForMonth, collectVendors, renderChartSvg, defaultMonth } from '../client/vs-chart.js';

const DATA = {
  costs: { atlas: { persons: { '2026-09': [
    { name: 'ACM Morgan Alex', company: 'Acme Ltd', total_cost: 1000 },
    { name: 'GLX Rivera Sam', total_cost: 300 },
  ] } } },
  protocolsAll: { protocols: [
    { area: 'atlas', settlement_month: '2026-09', vendor: 'ACME LTD', amount: 800 },
    { area: 'borealis', settlement_month: '2026-09', vendor: 'Acme Ltd', amount: 999 },
  ] },
  summary: { assignments: [{ area: 'comet', period_from: '2026-09-01', vendor: 'Initech', amount: 50 }] },
  purchaseOrders: [{ po_number: 'PO-1', vendor: 'Umbrella' }],
};

test('vendors: the example vendors, costs companies and order vendors', () => {
  assert.deepEqual(collectVendors('atlas', DATA), ['Acme Ltd', 'Globex', 'Initech', 'Umbrella']);
});

test('bars: costs by company or vendor code, accepted by protocols of the area and month', () => {
  const bars = Object.fromEntries(computeBarsForMonth('atlas', '2026-09', DATA).map((b) => [b.vendor, [b.costs, b.accepted]]));
  assert.deepEqual(bars['Acme Ltd'], [1000, 800]);
  assert.deepEqual(bars.Globex, [300, 0]);
});

test('bars: an area without protocols (comet) counts its settlements as accepted', () => {
  const bars = Object.fromEntries(computeBarsForMonth('comet', '2026-09', DATA).map((b) => [b.vendor, b.accepted]));
  assert.equal(bars.Initech, 50);
});

test('svg: one group per vendor, English legend, empty input gives nothing', () => {
  const svg = renderChartSvg([{ vendor: 'Acme Ltd', costs: 1000, accepted: 800 }], 600);
  assert.match(svg, /<svg /);
  assert.match(svg, />Costs</);
  assert.match(svg, />Accepted</);
  assert.equal(renderChartSvg([], 600), '');
  assert.match(defaultMonth(), /^\d{4}-\d{2}$/);
});
