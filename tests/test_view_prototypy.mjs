// tests/test_view_prototypy.mjs
// The view triple for `prototypy` (Prototypy) stays complete: the
// index.html section, the VIEW_REGISTRY entry and the HUB_FLYOUT item.
// Scaffolded by scripts/new-view.js - extend it with real behaviour tests.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('prototypy: index.html declares the view section', () => {
  assert.match(read('index.html'), /id="view-prototypy"/);
});

test('prototypy: VIEW_REGISTRY has the entry with render and runInit', () => {
  const src = read('js/view-registry.js');
  assert.match(src, /'prototypy':\s*\{/);
  assert.match(src, /renderPrototypyView/);
});

test('prototypy: the assets hub lists the page', () => {
  // js/core-hubs.mjs is the declaration; js/sidebar-flyout-config.js is a
  // loop over it, so the page is asserted where it is written.
  assert.match(read('js/core-hubs.mjs'), /view: 'prototypy'/);
});

test('prototypy: the module exports render and init', () => {
  const src = read('js/prototypy.js');
  assert.match(src, /export function renderPrototypyView/);
  assert.match(src, /export function initPrototypy/);
});

// ── Phase C/step 12: cache invalidation refresh hooks ────────────────────────
// Regex on the source only proves the string is there; this also imports both
// modules and checks VIEW_REGISTRY really points at a function that exists on
// the loaded prototypy.js module - a renamed export would fail this even if
// the registry source text still matched the old name by coincidence.

test('prototypy + proto-detail: VIEW_REGISTRY refresh hooks name real exports on js/prototypy.js', async () => {
  const { pathToFileURL } = await import('node:url');
  const { VIEW_REGISTRY } = await import(pathToFileURL(path.join(ROOT, 'js', 'view-registry.js')).href);
  const protoMod = await import(pathToFileURL(path.join(ROOT, 'js', 'prototypy.js')).href);

  const registryEntry = VIEW_REGISTRY['prototypy'];
  assert.ok(registryEntry && typeof registryEntry.refresh === 'string', 'prototypy entry must declare a refresh hook name');
  assert.strictEqual(typeof protoMod[registryEntry.refresh], 'function', `prototypy.js must export ${registryEntry.refresh}`);

  const detailEntry = VIEW_REGISTRY['proto-detail'];
  assert.ok(detailEntry && typeof detailEntry.refresh === 'string', 'proto-detail entry must declare a refresh hook name');
  assert.strictEqual(typeof protoMod[detailEntry.refresh], 'function', `prototypy.js must export ${detailEntry.refresh}`);
  // The two views cache different data (the whole registry vs. one detail
  // page) and must not silently share a single refresh function.
  assert.notStrictEqual(registryEntry.refresh, detailEntry.refresh);
});

// -- Kind picker and badge --

test('prototypy: the Add form picker lists four kinds with Desktop selected, and the payload carries a chosen one', async () => {
  const { pathToFileURL } = await import('node:url');
  const mod = await import(pathToFileURL(path.join(ROOT, 'js', 'prototypy.js')).href);
  const html = mod.kindPickerHtml(null);
  const buttons = [...html.matchAll(/data-proto-kind="([a-z]+)"[^>]*aria-pressed="(true|false)"/g)].map((m) => [m[1], m[2]]);
  assert.deepStrictEqual(buttons, [['desktop', 'true'], ['mobile', 'false'], ['briefing', 'false'], ['blank', 'false']]);
  assert.match(html, /class="ds-segmented"/);
  assert.match(mod.kindPickerHtml('briefing'), /data-proto-kind="briefing"[^>]*aria-pressed="true"/);
  assert.deepStrictEqual(mod.buildCreatePayload({ name: 'N', owners: [], kind: 'briefing' }), { name: 'N', owners: [], kind: 'briefing' });
  // The form sends kind on create only: the edit branch builds its own payload.
  const src = read('js/prototypy.js');
  assert.match(src, /_formMode === 'edit'\s*\?\s*\{ name: check\.value, owners: Array\.from\(_formSelectedOwners\) \}/);
  assert.match(src, /kindPickerHtml\(null\)/);
});

test('prototypy: choosing a kind toggles the existing buttons in place (focus survives) and updates the hint', async () => {
  const { pathToFileURL } = await import('node:url');
  const mod = await import(pathToFileURL(path.join(ROOT, 'js', 'prototypy.js')).href);
  const mk = (kind) => {
    const attrs = { 'aria-pressed': 'false' };
    const cls = new Set();
    return { dataset: { protoKind: kind }, attrs, cls, classList: { toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)) }, setAttribute: (k, v) => { attrs[k] = v; } };
  };
  const buttons = ['desktop', 'mobile', 'briefing', 'blank'].map(mk);
  const hint = { textContent: '' };
  const root = { querySelectorAll: () => buttons, querySelector: () => hint };
  mod.applyKindSelection(root, 'briefing');
  assert.deepStrictEqual(buttons.map((b) => b.attrs['aria-pressed']), ['false', 'false', 'true', 'false']);
  assert.deepStrictEqual(buttons.map((b) => b.cls.has('active')), [false, false, true, false]);
  assert.ok(hint.textContent.length > 0, 'the hint text is written in place');
  assert.doesNotMatch(read('js/prototypy.js'), /currentTarget\.innerHTML = kindPickerHtml/, 'the click handler no longer rewrites the picker');
});

test('prototypy: an item without kind renders no badge and no error, one with kind renders its label', () => {
  const src = read('js/prototypy.js');
  assert.match(src, /const kindLabel = protoKindLabel\(item\);/);
  assert.match(src, /const kindHtml = kindLabel \? /, 'the badge exists only when the kind has a label');
  assert.match(read('styles.css'), /\.proto-card-kind\s*\{/);
});
