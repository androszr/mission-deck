// modules/sprint-stats/tests/test_sprint_stats_widget.mjs
// Dashboard widget contract: manifest widgets[] passes the host validator, the
// widget file exports renderWidget and imports in plain Node, and the pure
// painter shows the right blocks for each variant against a fixed index.

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

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'module.json'), 'utf8'));
const widget = await import(pathToFileURL(path.join(DIR, 'client/widget.js')).href);
const { kit } = await import(pathToFileURL(path.join(path.dirname(path.resolve(DIR, _coreServerPath())), 'js/dashboard-widget-kit.js')).href);

const team = (name, committed, done, pct, extra = {}) => ({ team: name, unit: 'SP', summary: { committed, done, wip: 4, todo: committed - done - 4, dropped: 1, completion_pct: pct, ...extra } });
const INDEX = {
  boards: { main: { active_sprint_n: 20 } },
  sprints: [
    { src: 'main', sprint_n: 19, phase: 'END', teams: [team('Atlas', 100, 80, 80), team('Borealis', 100, 60, 60)] },
    { src: 'main', sprint_n: 20, phase: 'MID', teams: [team('Atlas', 100, 50, 50), team('Borealis', 80, 20, 25)] },
    { src: 'platform', sprint_n: 9, phase: 'MID', teams: [{ team: 'Delta', unit: 'MD', summary: { committed: 50, done: 5, wip: 10, todo: 35, dropped: 0, completion_pct: 10 } }] },
  ],
};

test('widget: module.json declares a widget the host validator accepts', () => {
  const r = validateModuleManifest(manifest, 'sprint-stats');
  assert.strictEqual(r.valid, true, (r.errors || []).join('; '));
  const w = manifest.widgets[0];
  assert.strictEqual(w.id, 'latest-sprint');
  assert.strictEqual(new Set(w.variants.map((v) => v.id)).size, w.variants.length);
  assert.ok(w.variants.some((v) => v.id === w.defaultVariant));
  assert.ok(w.variants.some((v) => v.rows === 2), 'at least one two-row variant');
  assert.ok(w.variants.length <= 6);
});

test('widget: client/widget.js exports renderWidget', () => {
  assert.strictEqual(typeof widget.renderWidget, 'function');
});

test('widget: the active sprint is chosen, SP are summed over MAIN teams only', () => {
  const { blocks } = widget.buildBlocks({ storage: 'ok', index: INDEX });
  assert.strictEqual(blocks.donut.value, 39, '(50+20)/(100+80)');
  assert.ok(blocks.donut.label.includes('Sprint 20'));
  assert.ok(blocks.tiles.tiles[0].value.startsWith('180'), 'committed is MAIN SP only, Delta MD excluded');
  assert.ok(blocks.bullet.rows.some((r) => r.label.includes('Delta')), 'Delta is its own percentage row');
});

test('widget: compare against the previous sprint, burndown from the shard, bullet marker = previous result', () => {
  const bd = (rem) => rem.map((r, i) => ({ day_n: i, date: '2026-10-0' + (6 + i), remaining: r }));
  const shard = { main: { teams: [
    { team: 'Atlas', summary: { committed: 100 }, burndown: bd([100, 80, 60]) },
    { team: 'Borealis', summary: { committed: 80 }, burndown: bd([50, 40, 30]) },
  ] } };
  assert.strictEqual(widget.buildBlocks({ storage: 'ok', index: INDEX }).blocks.compare, undefined, 'no compare while the sprint runs');
  const ended = { ...INDEX, sprints: INDEX.sprints.map((s) => (s.sprint_n === 20 && s.src === 'main' ? { ...s, phase: 'END' } : s)) };
  const { blocks } = widget.buildBlocks({ storage: 'ok', index: ended }, shard);
  assert.strictEqual(blocks.compare.before.label, 'Sprint 19');
  assert.strictEqual(blocks.compare.after.value, '39%');
  assert.strictEqual(blocks.compare.higherIsBetter, true);
  assert.deepStrictEqual(blocks.line.series[0].values.slice(0, 4), [150, 120, 90, null], 'known days, then empty slots');
  assert.strictEqual(blocks.line.series[0].values.length, 10, 'a 10-day sprint axis like the module chart');
  assert.strictEqual(blocks.line.series[1].values[0], 180, 'ideal starts at committed SP, not at day-0 remaining');
  assert.strictEqual(blocks.line.series[1].values[9], 0, 'ideal reaches 0 at day 9, not at the last observed day');
  assert.strictEqual(blocks.line.series[1].dashed, true);
  assert.strictEqual(blocks.line.labels[0], '06.10');
  assert.strictEqual(blocks.bullet.rows[0].target, 80, 'Atlas previous sprint result');
  assert.strictEqual(widget.buildBlocks({ storage: 'ok', index: INDEX }).blocks.bullet.rows[0].target, undefined, 'no marker mid-sprint');
  assert.strictEqual(widget.buildBlocks({ storage: 'ok', index: ended }).blocks.line, undefined, 'no shard, no line');
});

test('widget: every variant paints, the tall ones show more', () => {
  const sizes = Object.fromEntries(manifest.widgets[0].variants.map((v) => [v.id, { cols: v.cols, rows: v.rows }]));
  for (const id of Object.keys(sizes)) {
    const html = widget.paint({ storage: 'ok', index: INDEX }, id, sizes[id], kit);
    assert.ok(html.includes('dash-kit-donut'), id + ' has the ring');
  }
  const shard = { main: { teams: [{ burndown: [{ day_n: 0, date: '2026-10-06', remaining: 9 }, { day_n: 1, date: '2026-10-07', remaining: 5 }] }] } };
  const small = widget.paint({ storage: 'ok', index: INDEX }, 's', sizes.s, kit);
  const tall = widget.paint({ storage: 'ok', index: INDEX }, 'm2', sizes.m2, kit, shard);
  assert.ok(tall.length > small.length);
  assert.ok(tall.includes('dash-kit-linebox') && tall.includes('dash-kit-tiles'));
  assert.ok(widget.paint({ storage: 'ok', index: INDEX }, 'xl', sizes.xl, kit, shard).includes('dash-kit-bullet'));
});

test('widget: burndown sums by calendar date and skips dates not every team reports', () => {
  const entry = { sprint_n: 20, teams: [] };
  // Live shape of 2026-10: one team still on its 09-22 sprint, two on 10-06 - no shared date, no line.
  const offset = { main: { teams: [
    { team: 'Borealis', burndown: [{ day_n: 0, date: '2026-09-22', remaining: 87 }, { day_n: 1, date: '2026-09-23', remaining: 94 }] },
    { team: 'Atlas', burndown: [{ day_n: 0, date: '2026-10-06', remaining: 81 }, { day_n: 1, date: '2026-10-07', remaining: 78 }] },
  ] } };
  assert.strictEqual(widget.burndownBlock(offset, entry), null);
  const partial = { main: { teams: [
    { team: 'A', burndown: [{ date: '2026-10-06', remaining: 10 }, { date: '2026-10-07', remaining: 8 }, { date: '2026-10-08', remaining: 6 }] },
    { team: 'B', burndown: [{ date: '2026-10-06', remaining: 5 }, { date: '2026-10-07', remaining: 4 }] },
  ] } };
  assert.deepStrictEqual(widget.burndownBlock(partial, entry).series[0].values.slice(0, 3), [15, 12, null], '10-08 only A reports: no fake drop');
});

test('widget: the ring label carries the date of the data', () => {
  const idx = { ...INDEX, boards: { main: { active_sprint_n: 20, generated_at: '2026-10-11T17:07:47' } } };
  assert.match(widget.buildBlocks({ storage: 'ok', index: idx }).blocks.donut.label, /Sprint 20 · as of 11\.10 · /);
});

test('widget: narrow tall frame never stacks three blocks', () => {
  const ended = { ...INDEX, sprints: INDEX.sprints.map((s) => (s.sprint_n === 20 && s.src === 'main' ? { ...s, phase: 'END' } : s)) };
  const html = widget.paint({ storage: 'ok', index: ended }, 's2', { cols: 2, rows: 2 }, kit);
  assert.ok(html.includes('dash-kit-n2'), 'two blocks');
});

test('widget: empty states say what is missing', () => {
  assert.match(widget.buildBlocks({ storage: 'unavailable' }).empty, /Sync window/);
  assert.match(widget.buildBlocks({ storage: 'ok', index: { sprints: [], boards: {} } }).empty, /No sprint data/);
  assert.ok(widget.paint({ storage: 'unavailable' }, 'm', { cols: 3, rows: 1 }, kit).includes('dash-kit-empty'));
});
