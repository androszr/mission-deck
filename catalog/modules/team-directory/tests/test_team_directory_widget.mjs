// Widget contract for team-directory: manifest passes the host validator, the
// painter groups members by team, every variant paints, empty states.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// The app root (server.js + js/) is found by walking up, so this test runs both
// from an installed copy (modules/<id>/tests) and from the catalog.
function findAppRoot(start) {
  let dir = start;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'server.js')) && fs.existsSync(path.join(dir, 'js'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('app root not found above ' + start);
}
const { validateModuleManifest } = require(path.join(findAppRoot(path.dirname(fileURLToPath(import.meta.url))), 'server.js'));

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'module.json'), 'utf8'));
const widget = await import(pathToFileURL(path.join(DIR, 'client/widget.js')).href);
const { kit } = await import(pathToFileURL(path.join(findAppRoot(DIR), 'js', 'dashboard-widget-kit.js')).href);

const m = (first, last, team) => ({ id: first + last, first_name: first, last_name: last, role: 'Dev', team, email: '' });
const MEMBERS = [
  m('Alex', 'Morgan', 'Alfa'), m('Sam', 'Rivera', 'Alfa'), m('Jordan', 'Lee', 'Alfa'),
  m('Taylor', 'Kim', 'Beta'), m('Casey', 'Novak', 'Beta'),
  m('Robin', 'Hale', ''),
  m('', '', 'Beta'),
];

test('widget: module.json declares a widget the host validator accepts', () => {
  const r = validateModuleManifest(manifest, 'team-directory');
  assert.strictEqual(r.valid, true, (r.errors || []).join('; '));
  const w = manifest.widgets[0];
  assert.strictEqual(w.id, 'teams');
  assert.strictEqual(new Set(w.variants.map((v) => v.id)).size, w.variants.length);
  assert.ok(w.variants.some((v) => v.id === w.defaultVariant));
  assert.ok(w.variants.some((v) => v.rows === 2));
});

test('widget: exports renderWidget', () => {
  assert.strictEqual(typeof widget.renderWidget, 'function');
});

test('widget: teams follow the view order, empty team is "No team", nameless members skipped', () => {
  const g = widget.teamGroups(MEMBERS);
  assert.deepStrictEqual(g.map((t) => [t.team, t.people.length]), [['Alfa', 3], ['Beta', 2], ['No team', 1]]);
  const { blocks } = widget.buildBlocks(MEMBERS);
  assert.strictEqual(blocks.avatars_all.people.length, 6);
  assert.strictEqual(blocks.avatars_1.label, 'Alfa · 3 people');
  assert.strictEqual(blocks.avatars_2.label, 'Beta · 2 people');
  assert.deepStrictEqual(blocks.segments.segments.map((s) => s.value), [3, 2, 1]);
  assert.strictEqual(blocks.tiles.tiles[0].value, '3');
});

test('widget: every variant paints with avatars', () => {
  for (const v of manifest.widgets[0].variants) {
    const html = widget.paint(MEMBERS, v.id, { cols: v.cols, rows: v.rows }, kit);
    assert.ok(html.includes('data-person='), v.id);
  }
  const xl = widget.paint(MEMBERS, 'xl', { cols: 6, rows: 2 }, kit);
  assert.ok(xl.includes('dash-kit-seg'));
  assert.ok(!widget.paint(MEMBERS, 's', { cols: 2, rows: 1 }, kit).includes('dash-kit-seg'));
});

test('widget: no members is the single honest sentence', () => {
  assert.ok(widget.paint([], 'm2', { cols: 3, rows: 2 }, kit).includes('No team directory'));
});

test('widget: renderWidget turns a non-200 into the empty sentence', async () => {
  const el = { innerHTML: '' };
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await widget.renderWidget(el, { signal: new AbortController().signal, kit, variant: { id: 'm2', cols: 3, rows: 2 } });
  assert.match(el.innerHTML, /No team directory/);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ members: MEMBERS, teams: ['Alfa', 'Beta'] }) });
  await widget.renderWidget(el, { signal: new AbortController().signal, kit, variant: { id: 'm2', cols: 3, rows: 2 } });
  assert.match(el.innerHTML, /Alfa/);
  delete globalThis.fetch;
});

test('widget: real team names follow the view order (guests last), not the head count', () => {
  const roster = [
    ...['A', 'B', 'C', 'D', 'E'].map((x) => m('Guest', x, 'Guests')),
    m('Bo', 'Real', 'Borealis'),
    m('At', 'Las', 'Atlas'), m('Ari', 'Las', 'Atlas'),
    m('Lea', 'Der', 'Leadership'),
    m('New', 'Team', 'New Team'),
    m('Co', 'Met', 'Comet'),
  ];
  assert.deepStrictEqual(widget.teamGroups(roster).map((t) => t.team), ['Atlas', 'Borealis', 'Comet', 'Leadership', 'New Team', 'Guests']);
  const { blocks } = widget.buildBlocks(roster);
  assert.deepStrictEqual([blocks.avatars_1.label, blocks.avatars_2.label, blocks.avatars_3.label], ['Atlas · 2 people', 'Borealis · 1 person', 'Comet · 1 person']);
  // Four named slices plus "Other", each slice its own tone.
  assert.deepStrictEqual(blocks.segments.segments.map((s) => [s.label, s.value]), [['Atlas', 2], ['Borealis', 1], ['Comet', 1], ['Leadership', 1], ['Other', 6]]);
  assert.strictEqual(new Set(blocks.segments.segments.map((s) => s.tone)).size, 5);
});
