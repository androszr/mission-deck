// Metric definitions shown as tooltips: every metric on the page has one,
// the text is English copy and the markup is the accessible DS tooltip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { METRIC_DEFS, tipHtml } from '../client/metric-defs.mjs';

const KEYS = ['wipNow', 'throughput', 'leadTime', 'cycleTime', 'blockedNow',
  'wipChart', 'throughputChart', 'leadChart', 'cycleChart', 'epics', 'aging', 'blocked',
  'closedWithoutWork', 'closedWithoutWorkList', 'cancelledAfterWorkList', 'personWip', 'personDelivered', 'personLead', 'personCycle', 'personLogged', 'personCompare'];

test('every metric on the page has a non-empty definition', () => {
  assert.deepEqual(Object.keys(METRIC_DEFS).sort(), [...KEYS].sort());
  for (const k of KEYS) assert.ok(METRIC_DEFS[k].length > 40, k);
  assert.match(METRIC_DEFS.leadChart, /85th percentile/);
  assert.match(METRIC_DEFS.leadTime, /from creating/);
  assert.match(METRIC_DEFS.cycleTime, /"in progress"/);
  assert.match(METRIC_DEFS.leadTime, /closed without work are left out/);
  assert.match(METRIC_DEFS.closedWithoutWork, /never entered an "in progress" status/);
});

test('tipHtml: DS tooltip, keyboard reachable, linked by aria-describedby', () => {
  const h = tipHtml('leadTime', { label: 'Lead time' });
  assert.match(h, /^<button type="button" class="ds-tooltip-wrap devops-stats-tip"/);
  assert.match(h, /aria-describedby="devops-stats-tip-leadTime"/);
  assert.match(h, /role="tooltip" id="devops-stats-tip-leadTime"/);
  assert.match(h, /aria-label="Definition: Lead time"/);
  assert.match(h, /class="ds-tooltip-content devops-stats-tip-content"/);
});

test('tipHtml: {per} substitution, extra sentence, escaping, unknown key', () => {
  assert.match(tipHtml('throughput', { per: 'month' }), /delivered per month/);
  assert.doesNotMatch(tipHtml('throughput'), /\{per\}/);
  assert.match(tipHtml('cycleTime', { extra: 'Skipped 3 <b>' }), /Skipped 3 &lt;b&gt;/);
  assert.equal(tipHtml('nope'), '');
});
