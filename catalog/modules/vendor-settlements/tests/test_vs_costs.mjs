// vendor-settlements/tests/test_vs_costs.mjs
// The read-only costs reader: shard assembly, source precedence, cache.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const costs = require('../server/costs.js');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-costs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const put = (p, obj) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj)); };

// Two months of an "epics" group: one epic with one issue and one person.
const SHARD_A = {
  monthly_totals: { '2026-08': 100 }, daily_totals: { '2026-08-01': 100 }, daily_totals_rated: { '2026-08-01': 100 },
  persons: { '2026-08': { 'Alex Morgan': { hours: 5 } } },
  epics: [{ key: 'E-1', name: 'Epic', monthly: { '2026-08': 100 }, hours_monthly: { '2026-08': 5 },
    issues: [{ key: 'I-1', monthly: { '2026-08': 100 }, hours_monthly: { '2026-08': 5 },
      persons: [{ name: 'Alex Morgan', monthly: { '2026-08': 100 }, hours_monthly: { '2026-08': 5 } }] }] }],
};
const SHARD_B = {
  monthly_totals: { '2026-09': 200 }, daily_totals: { '2026-09-01': 200 }, daily_totals_rated: { '2026-09-01': 200 },
  persons: { '2026-09': { 'Alex Morgan': { hours: 9 } } },
  epics: [{ key: 'E-1', name: 'Epic', monthly: { '2026-09': 200 }, hours_monthly: { '2026-09': 9 },
    issues: [{ key: 'I-1', monthly: { '2026-09': 200 }, hours_monthly: { '2026-09': 9 },
      persons: [{ name: 'Alex Morgan', monthly: { '2026-09': 200 }, hours_monthly: { '2026-09': 9 } }] }] }],
};
const INDEX = {
  meta: { group_key: 'epics', group_order: ['E-1'], schema_version: 1, shard_count: 2, last_updated: 'x', generated_at: '2026-09-07', currency: 'EUR' },
  keys: ['2026-08', '2026-09'],
};
const MONOLITH = {
  meta: { generated_at: '2026-09-07', currency: 'EUR' },
  monthly_totals: { '2026-08': 100, '2026-09': 200 },
  daily_totals: { '2026-08-01': 100, '2026-09-01': 200 },
  daily_totals_rated: { '2026-08-01': 100, '2026-09-01': 200 },
  persons: { '2026-08': { 'Alex Morgan': { hours: 5 } }, '2026-09': { 'Alex Morgan': { hours: 9 } } },
  epics: [{ key: 'E-1', name: 'Epic', monthly: { '2026-08': 100, '2026-09': 200 }, hours_monthly: { '2026-08': 5, '2026-09': 9 },
    issues: [{ key: 'I-1', monthly: { '2026-08': 100, '2026-09': 200 }, hours_monthly: { '2026-08': 5, '2026-09': 9 },
      persons: [{ name: 'Alex Morgan', monthly: { '2026-08': 100, '2026-09': 200 }, hours_monthly: { '2026-08': 5, '2026-09': 9 } }] }] }],
};

function seedShards(dir) {
  put(path.join(dir, 'index.json'), INDEX);
  put(path.join(dir, '2026-08.json'), SHARD_A);
  put(path.join(dir, '2026-09.json'), SHARD_B);
}

test('assembling two month shards equals the hand-written monolith', async (t) => {
  const dir = path.join(tmp(t), 'atlas');
  seedShards(dir);
  const got = await costs.assembleCostsFromShards(dir);
  assert.deepEqual(got, MONOLITH);
  assert.equal('group_key' in got.meta, false);
});

test('a corrupt shard is skipped with a warning, the rest is served', async (t) => {
  const dir = path.join(tmp(t), 'atlas');
  seedShards(dir);
  fs.writeFileSync(path.join(dir, '2026-09.json'), '{broken');
  const warns = [];
  const got = await costs.assembleCostsFromShards(dir, (...a) => warns.push(a.join(' ')));
  assert.deepEqual(Object.keys(got.monthly_totals), ['2026-08']);
  assert.equal(warns.length, 1);
});

test('no index, or an index without keys, assembles to null', async (t) => {
  const dir = tmp(t);
  assert.equal(await costs.assembleCostsFromShards(dir), null);
  put(path.join(dir, 'index.json'), { meta: {}, keys: [] });
  assert.equal(await costs.assembleCostsFromShards(dir), null);
});

test('precedence: shards before the monolith; an unusable shard dir falls through', async (t) => {
  const mod = tmp(t);
  assert.equal(await costs.readCostsForArea(mod, 'borealis'), null);
  put(path.join(mod, 'costs', 'borealis.json'), { ...MONOLITH, meta: { src: 'monolith' } });
  let r = await costs.readCostsForArea(mod, 'borealis');
  assert.equal(r.source, 'monolith');
  put(path.join(mod, 'costs', 'borealis', 'index.json'), { meta: {}, keys: [] });
  r = await costs.readCostsForArea(mod, 'borealis');
  assert.equal(r.source, 'monolith', 'an empty shard index falls through');
  seedShards(path.join(mod, 'costs', 'borealis'));
  r = await costs.readCostsForArea(mod, 'borealis');
  assert.equal(r.source, 'shards');
  assert.deepEqual(r.data, MONOLITH);
});

test('the cache follows index.json: a rewritten shard set is re-assembled', async (t) => {
  const mod = tmp(t);
  const shards = path.join(mod, 'costs', 'comet');
  seedShards(shards);
  const a = await costs.readCostsForArea(mod, 'comet');
  const again = await costs.readCostsForArea(mod, 'comet');
  assert.equal(again.data, a.data, 'same object from the cache');
  put(path.join(shards, 'index.json'), { ...INDEX, keys: ['2026-08'], meta: { ...INDEX.meta, pad: 'x'.repeat(10) } });
  const b = await costs.readCostsForArea(mod, 'comet');
  assert.deepEqual(Object.keys(b.data.monthly_totals), ['2026-08']);
});

test('costsStatus: one entry per area with its source and generated date', (t) => {
  const mod = tmp(t);
  const s = costs.costsStatus(mod);
  assert.deepEqual(Object.keys(s), ['atlas', 'borealis', 'comet', 'delta']);
  assert.deepEqual(s.atlas, { source: null, generatedAt: null });
  seedShards(path.join(mod, 'costs', 'delta'));
  assert.deepEqual(costs.costsStatus(mod).delta, { source: 'shards', generatedAt: '2026-09-07' });
  assert.deepEqual(costs.costsStatus(null).atlas, { source: null, generatedAt: null });
});
