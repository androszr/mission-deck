// vendor-settlements/tests/test_vs_routes.mjs
// The routes against a fake ctx and a temporary team data tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setup, ADD_BOREALIS } from './fixtures/harness.mjs';

test('GET /data on a fresh tree: empty summary, no protocols, no orders', async (t) => {
  const { call } = setup(t);
  const r = await call('GET', '/data');
  assert.equal(r.status, 200);
  assert.equal(r.body.storage, 'ok');
  assert.deepEqual(r.body.summary.assignments, []);
  assert.deepEqual(r.body.protocols.protocols, []);
  assert.deepEqual(r.body.purchaseOrders, []);
  assert.equal(r.body.jiraBrowseUrl, '');
});

test('every GET answers storage unavailable when the data root is absent or empty', async (t) => {
  for (const opts of [{ withData: false }, { empty: true }]) {
    const { call } = setup(t, opts);
    for (const [p, q] of [['/status'], ['/data'], ['/protocols-all'], ['/costs', '?area=atlas']]) {
      const r = await call('GET', p, null, q);
      assert.equal(r.status, 200, p);
      assert.equal(r.body.storage, 'unavailable', p);
    }
  }
});

test('writes answer 409 data-missing on an empty root and create nothing', async (t) => {
  const { call, root } = setup(t, { empty: true });
  for (const [p, b] of [['/summary/add', ADD_BOREALIS], ['/summary/update', { ...ADD_BOREALIS, id: 'st-1' }],
    ['/summary/delete', { id: 'st-1' }], ['/summary/mark-accepted', { id: 'st-1', accepted_at: '2026-10-09T10:00:00.000Z' }],
    ['/vendor-info/add', { name: 'Acme Ltd' }]]) {
    const r = await call('POST', p, b);
    assert.equal(r.status, 409, p);
    assert.equal(r.body.error, 'data-missing', p);
  }
  assert.deepEqual(fs.readdirSync(root), []);
});

test('a half-decrypted module dir (files but no summary.json) refuses to invent summary.json', async (t) => {
  const { call, put, exists } = setup(t);
  put('vendor-info.json', { meta: {}, vendors: [] });
  const r = await call('POST', '/summary/add', ADD_BOREALIS);
  assert.equal(r.status, 409);
  assert.equal(exists('summary.json'), false);
});

test('add: writes the settlement and creates its protocol in the area protocols file', async (t) => {
  const { call, readJson, exists } = setup(t);
  const r = await call('POST', '/summary/add', ADD_BOREALIS);
  assert.equal(r.status, 200);
  assert.equal(r.body.protocolSynced, true);
  assert.equal(r.body.assignment.id, 'st-00000001');
  const summary = readJson('summary.json');
  assert.equal(summary.meta.total_assignments, 1);
  assert.equal(summary.assignments[0].protocol_id, 'pr-00000002');
  const prot = readJson('protocols-borealis.json');
  assert.deepEqual(prot.protocols.map((p) => [p.po_number, p.amount, p.status, p.settlement_month, p.vendor]), [['PO-1', 1000, 'new', '2026-09', 'Acme Ltd']]);
  assert.equal(exists('protocols-atlas.json'), false);
});

test('add: validation errors are 400 with a message', async (t) => {
  const { call } = setup(t);
  for (const bad of [{ ...ADD_BOREALIS, area: 'nowhere' }, { ...ADD_BOREALIS, period_from: '2026-10-01' },
    { ...ADD_BOREALIS, items: [] }, { ...ADD_BOREALIS, amount: 'x' }, { ...ADD_BOREALIS, protocol_link: 'ftp://x' }]) {
    const r = await call('POST', '/summary/add', bad);
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'invalid');
    assert.ok(r.body.message.length > 0);
  }
});

test('add: an area without a protocols file (delta) writes only the summary', async (t) => {
  const { call, exists } = setup(t);
  const r = await call('POST', '/summary/add', { ...ADD_BOREALIS, area: 'delta', mode: 'custom', items: [] });
  assert.equal(r.status, 200);
  assert.equal(r.body.assignment.protocol_id, undefined);
  assert.equal(exists('protocols-atlas.json') || exists('protocols-borealis.json'), false);
});

test('update: moving borealis -> atlas moves the protocol between files', async (t) => {
  const { call, readJson } = setup(t);
  const added = (await call('POST', '/summary/add', ADD_BOREALIS)).body.assignment;
  const r = await call('POST', '/summary/update', { ...ADD_BOREALIS, id: added.id, area: 'atlas', amount: 0 });
  assert.equal(r.status, 200);
  assert.equal(r.body.protocolSynced, true);
  assert.deepEqual(readJson('protocols-borealis.json').protocols, []);
  const atlas = readJson('protocols-atlas.json').protocols;
  assert.equal(atlas.length, 1);
  assert.equal(atlas[0].amount, 0, 'a zero amount reaches the protocol');
  assert.equal(readJson('summary.json').assignments[0].protocol_id, atlas[0].id);
});

test('update: atlas <-> comet share one protocols file and keep the protocol id', async (t) => {
  const { call, readJson } = setup(t);
  const added = (await call('POST', '/summary/add', { ...ADD_BOREALIS, area: 'atlas' })).body.assignment;
  await call('POST', '/summary/update', { ...ADD_BOREALIS, id: added.id, area: 'comet', po_number: 'PO-9' });
  const prot = readJson('protocols-atlas.json').protocols;
  assert.equal(prot.length, 1);
  assert.equal(prot[0].id, added.protocol_id);
  assert.equal(prot[0].po_number, 'PO-9');
});

test('mark-accepted: once only; the protocol follows', async (t) => {
  const { call, readJson } = setup(t);
  const added = (await call('POST', '/summary/add', ADD_BOREALIS)).body.assignment;
  const ok = await call('POST', '/summary/mark-accepted', { id: added.id, accepted_at: '2026-10-09T10:00:00.000Z' });
  assert.equal(ok.status, 200);
  assert.equal(readJson('protocols-borealis.json').protocols[0].status, 'accepted');
  const again = await call('POST', '/summary/mark-accepted', { id: added.id, accepted_at: '2026-10-09T10:00:00.000Z' });
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'already-accepted');
  const bad = await call('POST', '/summary/mark-accepted', { id: added.id, accepted_at: 'yesterday' });
  assert.equal(bad.status, 400);
});

test('delete: removes the settlement and its protocol; an unknown id is 404', async (t) => {
  const { call, readJson } = setup(t);
  const added = (await call('POST', '/summary/add', ADD_BOREALIS)).body.assignment;
  assert.equal((await call('POST', '/summary/delete', { id: added.id })).status, 200);
  assert.deepEqual(readJson('summary.json').assignments, []);
  assert.deepEqual(readJson('protocols-borealis.json').protocols, []);
  assert.equal((await call('POST', '/summary/delete', { id: added.id })).status, 404);
});

test('vendor-info/add: upsert by case-insensitive name', async (t) => {
  const { call, readJson } = setup(t);
  await call('POST', '/vendor-info/add', { name: 'Acme Ltd', full_name: 'Acme Ltd', address: '1 Example Street', tax_id: '0000000000' });
  await call('POST', '/vendor-info/add', { name: 'acme ltd', full_name: 'Acme Limited', registry_no: '0000000001' });
  const v = readJson('vendor-info.json').vendors;
  assert.equal(v.length, 1);
  assert.deepEqual([v[0].full_name, v[0].registry_no], ['Acme Limited', '0000000001']);
  const bad = await call('POST', '/vendor-info/add', { name: '' });
  assert.equal(bad.status, 400);
});

test('protocols-all and /data carry the vendor of each protocol and the order pool', async (t) => {
  const { call, put } = setup(t);
  put('purchase-orders.json', { orders: [{ po_number: 'PO-2', vendor: 'Globex', title: 'Support', amount: 5000, area: 'atlas' }] });
  await call('POST', '/summary/add', { ...ADD_BOREALIS, area: 'atlas', po_number: 'PO-2', vendor: 'Globex' });
  const all = await call('GET', '/protocols-all');
  assert.deepEqual(all.body.protocols.map((p) => [p.area, p.po_number, p.vendor]), [['atlas', 'PO-2', 'Globex']]);
  const data = await call('GET', '/data');
  assert.equal(data.body.purchaseOrders.length, 1);
});

test('/data exposes the tracker browse URL only when JIRA_BASE_URL is a http(s) URL', async (t) => {
  const withUrl = setup(t, { deps: { env: { JIRA_BASE_URL: 'https://jira.example.com/' } } });
  assert.equal((await withUrl.call('GET', '/data')).body.jiraBrowseUrl, 'https://jira.example.com/browse/');
  const bad = setup(t, { deps: { env: { JIRA_BASE_URL: 'javascript:alert(1)' } } });
  assert.equal((await bad.call('GET', '/data')).body.jiraBrowseUrl, '');
});

test('GET /costs: an unknown area is 400; a monolith is served', async (t) => {
  const { call, put } = setup(t);
  assert.equal((await call('GET', '/costs', null, '?area=nope')).status, 400);
  assert.equal((await call('GET', '/costs', null, '?area=atlas')).body._missing, true);
  put('costs/atlas.json', { meta: { generated_at: '2026-10-01' }, persons: { '2026-09': [] } });
  const r = await call('GET', '/costs', null, '?area=atlas');
  assert.equal(r.body.meta.generated_at, '2026-10-01');
  const st = await call('GET', '/status');
  assert.deepEqual(st.body.costs.atlas, { source: 'monolith', generatedAt: '2026-10-01' });
});

test('a reader of the team directory gives "First Last" names', async (t) => {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { readMemberNames } = require('../server/index.js');
  const { root, ctx } = setup(t);
  fs.mkdirSync(path.join(root, 'team'));
  fs.writeFileSync(path.join(root, 'team', 'team-members.json'), JSON.stringify({ team_members: [
    { first_name: 'Alex', last_name: 'Morgan' }, { first_name: 'Alex', last_name: 'Morgan' }, { first_name: 'Sam', last_name: 'Rivera' },
  ] }));
  assert.deepEqual(readMemberNames(ctx), ['Alex Morgan', 'Sam Rivera']);
});
