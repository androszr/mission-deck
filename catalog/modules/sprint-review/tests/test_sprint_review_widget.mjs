// Dashboard widget contract: manifest widgets[] passes the host validator, the
// deadline rule matches server/session.js, session picking and painting per variant.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// The module runs from modules/<id>/ when installed and from
// catalog/modules/<id>/ in the source tree: find the core server.js upwards.
function _coreServerPath() {
  const _fs = require('node:fs');
  const _path = require('node:path');
  let dir = _path.dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 6; i++) {
    dir = _path.dirname(dir);
    const candidate = _path.join(dir, 'server.js');
    if (_fs.existsSync(candidate) && _fs.existsSync(_path.join(dir, 'package.json'))) return candidate;
  }
  return '../../../server.js';
}

const { validateModuleManifest } = require(_coreServerPath());
const session = require('../server/session.js');

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'module.json'), 'utf8'));
const widget = await import(pathToFileURL(path.join(DIR, 'client/widget.js')).href);
const { kit } = await import(pathToFileURL(path.join(path.dirname(path.resolve(DIR, _coreServerPath())), 'js/dashboard-widget-kit.js')).href);

const NOW = new Date(2026, 9, 12, 9, 0, 0); // Mon 2026-10-12
const SESSIONS = [
  { id: 'sr-aaaaaaaaaaaaaaaa', reviewDate: '2026-10-23', sprintN: 87, sprintName: 'Sprint 87' },
  { id: 'sr-bbbbbbbbbbbbbbbb', reviewDate: '2026-11-06', sprintN: 88, sprintName: 'Sprint 88' },
  { id: 'sr-cccccccccccccccc', reviewDate: '2026-10-09', sprintN: 86, sprintName: 'Sprint 86' },
];
const FULL = {
  id: 'sr-aaaaaaaaaaaaaaaa', reviewDate: '2026-10-23', facilitatorPo: 'Alex Morgan',
  teamGoals: [{ team: 'Atlas' }, { team: 'Borealis' }, { team: 'Delta' }],
  submissions: {
    Atlas: { topics: [{ id: 't-1', title: 'A', presenters: ['Jordan Novak', 'Emma Lane'] }, { id: 't-2', title: 'B', presenters: ['Jordan Novak'] }] },
    Borealis: { topics: [] },
    Delta: { topics: [{ id: 't-3', title: 'C', presenters: ['Parker Zane'] }] },
  },
};

test('widget: module.json declares a widget the host validator accepts', () => {
  const r = validateModuleManifest(manifest, 'sprint-review');
  assert.strictEqual(r.valid, true, (r.errors || []).join('; '));
  const w = manifest.widgets[0];
  assert.strictEqual(w.id, 'next-sprint-review');
  assert.ok(w.variants.some((v) => v.id === w.defaultVariant));
  assert.ok(w.variants.some((v) => v.rows === 2), 'at least one two-row variant');
  assert.strictEqual(typeof widget.renderWidget, 'function');
});

test('widget: deadlineFor equals the server rule', () => {
  for (const d of ['2026-06-30', '2026-01-16', '2026-01-17', '2026-01-13', '2026-10-23', '2026-11-06']) {
    assert.strictEqual(widget.deadlineFor(d), session.deadlineFromReviewDate(d), d);
  }
  assert.strictEqual(widget.deadlineFor('2026-06-30'), '2026-06-26T10:00:00.000Z');
});

test('widget: pickSession takes the nearest upcoming, else the newest past', () => {
  assert.strictEqual(widget.pickSession(SESSIONS, '2026-10-12').id, 'sr-aaaaaaaaaaaaaaaa');
  assert.strictEqual(widget.pickSession(SESSIONS, '2026-10-23').past, false, 'today counts as upcoming');
  const past = widget.pickSession(SESSIONS, '2026-12-01');
  assert.strictEqual(past.id, 'sr-bbbbbbbbbbbbbbbb');
  assert.strictEqual(past.past, true);
  assert.strictEqual(widget.pickSession([], '2026-10-12'), null);
});

test('widget: days to the review, deadline and tone', () => {
  const { blocks } = widget.buildBlocks({ storage: 'ok', sessions: SESSIONS }, NOW);
  assert.strictEqual(blocks.big.value, '11');
  assert.strictEqual(blocks.big.tone, 'info');
  assert.strictEqual(blocks.timeline.events[0].date, '16.10');
  assert.match(blocks.timeline.events[0].label, /^Team goals due \d\d:\d\d$/);
  const close = widget.buildBlocks({ storage: 'ok', sessions: SESSIONS }, new Date(2026, 9, 15, 9, 0, 0));
  assert.strictEqual(close.blocks.big.tone, 'warn', 'deadline in less than 2 days');
});

test('widget: a past-only list says when the last one was', () => {
  const { blocks } = widget.buildBlocks({ storage: 'ok', sessions: SESSIONS }, new Date(2026, 11, 1));
  assert.match(blocks.big.label, /^the last one took place on 06\.11\.2026$/);
  assert.strictEqual(blocks.big.tone, 'neutral');
  assert.strictEqual(blocks.timeline.events.length, 1, 'no open deadline');
});

test('widget: m2 extras come from the full session', () => {
  const { blocks } = widget.buildBlocks({ storage: 'ok', sessions: SESSIONS, session: FULL }, NOW);
  assert.deepStrictEqual(blocks.avatars.people.map((p) => p.name), ['Alex Morgan', 'Jordan Novak', 'Emma Lane', 'Parker Zane']);
  assert.strictEqual(blocks.avatars.people[0].tone, 'info');
  assert.strictEqual(blocks.bullet.rows[0].display, '2 of 3');
  assert.strictEqual(blocks.timeline.events.at(-1).person, 'Alex Morgan');
  const none = widget.buildBlocks({ storage: 'ok', sessions: SESSIONS }, NOW);
  assert.ok(!none.blocks.avatars && !none.blocks.bullet);
});

test('widget: every variant paints; empty state', () => {
  const sizes = Object.fromEntries(manifest.widgets[0].variants.map((v) => [v.id, { cols: v.cols, rows: v.rows }]));
  const data = { storage: 'ok', sessions: SESSIONS, session: FULL };
  for (const id of Object.keys(sizes)) assert.ok(widget.paint(data, id, sizes[id], kit, NOW).length > 0, id);
  assert.ok(widget.paint(data, 'm2', sizes.m2, kit, NOW).includes('dash-kit-bullet'));
  assert.ok(!widget.paint(data, 'm', sizes.m, kit, NOW).includes('dash-kit-bullet'));
  assert.match(widget.buildBlocks({ storage: 'ok', sessions: [] }, NOW).empty, /No Sprint Review planned/);
});

test('widget: a wiped data repo is the Sync window sentence, never "create a session"', () => {
  const r = widget.buildBlocks({ storage: 'unavailable', sessions: [] }, NOW);
  assert.strictEqual(r.empty, widget.NO_STORAGE);
  assert.match(r.empty, /Sync window/);
  assert.strictEqual(widget.buildBlocks({ storage: 'ok', sessions: [] }, NOW).empty, widget.NO_SESSION);
});

test('widget: on the review day the tile says "Today", not "0 days"', () => {
  const day = widget.pickSession(SESSIONS, '2026-10-01');
  const [y, m, d] = day.reviewDate.split('-').map(Number);
  const { blocks } = widget.buildBlocks({ storage: 'ok', sessions: SESSIONS }, new Date(y, m - 1, d, 9, 0, 0));
  assert.strictEqual(blocks.big.value, 'Today');
  assert.strictEqual(blocks.big.unit, '');
});
