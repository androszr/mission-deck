'use strict';
// tests/test_api_assets_mascot.js
// GET /api/assets/mascot - the mascot gallery listing behind Design > Mascot.
//
// The route reads assets/mascot/ from the repository, so the assertions
// are about the CONTRACT (shape, pairing, sort, static reachability), never
// about a particular graphic: a file added to the directory must not fail this
// suite.

const test = require('node:test');
const assert = require('node:assert');
const { startServer, waitForServer, stopServer, getJson } = require('./_api_helper');

const PORT = 3491;
let child;

test.before(async () => {
  child = startServer(PORT);
  await waitForServer(PORT);
});

test.after(async () => { await stopServer(child); });

test('GET /api/assets/mascot answers 200 with an items array and its count', async () => {
  const { status, body } = await getJson(PORT, '/api/assets/mascot');
  assert.strictEqual(status, 200);
  assert.ok(Array.isArray(body.items), 'items must be an array');
  assert.strictEqual(body.count, body.items.length);
});

test('every item names a static SVG path and, from the manifest, its pose', async () => {
  const { body } = await getJson(PORT, '/api/assets/mascot');
  for (const item of body.items) {
    assert.strictEqual(typeof item.name, 'string');
    assert.ok(item.name.length > 0, 'name must not be empty');
    assert.strictEqual(item.svg, `/assets/mascot/${item.name}.svg`);
    assert.ok(item.pose === null || typeof item.pose === 'string');
    assert.strictEqual(typeof item.label, 'string');
  }
});

test('the eight committed poses of the mascot are all listed', async () => {
  const { body } = await getJson(PORT, '/api/assets/mascot');
  const poses = body.items.map(i => i.pose).filter(Boolean).sort();
  for (const pose of ['celebrating', 'error', 'idle', 'sleeping', 'success', 'thinking', 'wave', 'working']) {
    assert.ok(poses.includes(pose), `pose ${pose} is missing`);
  }
});

test('items come back sorted by name, so the grid order is stable', async () => {
  const { body } = await getJson(PORT, '/api/assets/mascot');
  const names = body.items.map(i => i.name);
  assert.deepStrictEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});

test('the SVG a listed item points at is really served', async () => {
  const { body } = await getJson(PORT, '/api/assets/mascot');
  if (!body.items.length) return; // a checkout without the assets is a valid state
  const res = await fetch(`http://127.0.0.1:${PORT}${body.items[0].svg}`);
  assert.strictEqual(res.status, 200);
  assert.match(await res.text(), /<svg/i);
});
