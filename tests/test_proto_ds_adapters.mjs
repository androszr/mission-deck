// tests/test_proto_ds_adapters.mjs
// The shared layer the build shell seed ships to every prototype: the DS
// adapters (src/ds/), the neutral app frame (src/components/) and the alias
// layer that maps the kit's token names onto the shell's own tokens.
// Source-level checks, no browser and no npm: what must hold for the layer to
// look like Mission Deck and to be re-tuned in ONE place.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED_SRC = path.join(ROOT, 'templates', 'prototype-build-shell', 'src');
const read = (p) => fs.readFileSync(p, 'utf8');
const seed = (rel) => read(path.join(SEED_SRC, rel));

const defs = (css) => new Map([...css.matchAll(/(?:^|[;{\s])(--[a-z0-9-]+)\s*:\s*([^;]+);/gim)].map((m) => [m[1], m[2].trim()]));
const shellTokens = defs(seed('tokens.css'));
const aliasTokens = defs(seed('ds/tokens.css'));

test('every ICONS value is a slug of the icon manifest and its SVG file exists', () => {
  const manifest = JSON.parse(read(path.join(ROOT, 'assets/icons/ds/manifest.json')));
  const bySlug = new Map(manifest.icons.map((i) => [i.slug, i]));
  const ts = seed('ds/icons.ts');
  const entries = [...ts.slice(ts.indexOf('export const ICONS')).matchAll(/^\s*'?([a-z0-9-]+)'?:\s*'([^']+)',/gm)];
  assert.ok(entries.length >= 30, 'the adapter catalog is not empty');
  for (const [, name, slug] of entries) {
    assert.ok(bySlug.has(slug), `${name} -> ${slug} is not in the manifest`);
    assert.ok(fs.existsSync(path.join(ROOT, 'assets/icons/ds', bySlug.get(slug).file)), `${slug}.svg is missing`);
  }
  assert.strictEqual(new Set(entries.map((e) => e[1])).size, entries.length, 'no adapter name twice');
});

test('icons added for the kit name their true source, and the kit-drawn ones are not claimed as Lucide', () => {
  const manifest = JSON.parse(read(path.join(ROOT, 'assets/icons/ds/manifest.json')));
  const added = manifest.icons.filter((i) => String(i.source).startsWith('prototype-lab-kit:'));
  assert.ok(added.length >= 15);
  for (const name of ['turbine', 'message']) assert.ok(added.some((i) => i.source === 'prototype-lab-kit:' + name), name);
  for (const i of added) {
    const svg = read(path.join(ROOT, 'assets/icons/ds', i.file));
    assert.match(svg, new RegExp('data-source="' + i.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"'), i.file);
  }
});

test('the alias layer defines no name the shell already defines, and no alias points at itself', () => {
  for (const [name, value] of aliasTokens) {
    assert.ok(!shellTokens.has(name), `${name} is already defined by the shell tokens.css`);
    const ref = /^var\((--[a-z0-9-]+)\)$/.exec(value);
    if (ref) {
      assert.notStrictEqual(ref[1], name, `${name} would be a cycle`);
      assert.ok(shellTokens.has(ref[1]), `${name} points at ${ref[1]}, which the shell does not define`);
    }
  }
});

test('the nine names whose values differ live under --proto-<name> with the kit values; no alias refers to itself', () => {
  const kit = {
    'radius-l': '12px', 'text-base': '14px', 'text-2xl': '28px', 'text-3xl': '40px',
    'lh-xs': '16px', 'lh-base': '20px', 'lh-xl': '30px', 'lh-2xl': '36px', 'lh-3xl': '48px',
  };
  for (const [name, value] of Object.entries(kit)) {
    assert.strictEqual(aliasTokens.get('--proto-' + name), value, '--proto-' + name);
    assert.ok(shellTokens.has('--' + name), `--${name} still belongs to the shell`);
    assert.notStrictEqual(shellTokens.get('--' + name), value, `--${name} differs in the shell, which is why it is renamed`);
  }
  assert.ok(/proto-text-base/.test(seed('ds/tokens.css')));
});

test('every var(--x) of the adapters and the frame resolves to a shell or alias token', () => {
  const known = new Set([...shellTokens.keys(), ...aliasTokens.keys()]);
  for (const rel of ['ds/ds.css', 'components/AppFrame.css']) {
    const css = seed(rel);
    for (const m of css.matchAll(/var\((--[a-z0-9-]+)/g)) {
      if (m[1] === '--ds-icon-src') continue; // set inline by DSIcon
      assert.ok(known.has(m[1]), `${rel}: ${m[1]} is not defined`);
    }
    for (const bad of ['--text-base)', '--radius-l)', '--text-2xl)', '--text-3xl)', '--lh-xs)', '--lh-base)', '--lh-xl)', '--lh-2xl)', '--lh-3xl)']) {
      assert.ok(!css.includes('var(' + bad), `${rel} uses the shell value of ${bad.slice(0, -1)} where the kit layout needs --proto-...`);
    }
  }
});

test('no colour literal in the adapters, the frame or the alias layer', () => {
  for (const rel of ['ds/tokens.css', 'ds/ds.css', 'components/AppFrame.css', 'ds/components.tsx', 'ds/icons.ts', 'ds/index.ts', 'components/AppFrame.tsx', 'components/index.ts']) {
    const text = seed(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(text, /#[0-9a-fA-F]{3,8}\b/, rel + ' has a hex colour');
    assert.doesNotMatch(text, /\b(?:rgb|rgba|hsl|hsla)\s*\(/, rel + ' has a colour function');
  }
});

test('the seed frame is neutral: no brand, persona or icon of the example product', () => {
  const frame = seed('components/AppFrame.tsx') + seed('components/index.ts');
  for (const literal of ['Ops Console', 'Morgan Ellis', 'turbine', 'wind', 'North Coast']) {
    assert.ok(!frame.includes(literal), 'the frame carries "' + literal + '"');
  }
  assert.match(frame, /brand\?: string/);
  assert.match(frame, /brandIcon\?: IconName/);
  assert.match(frame, /persona\?: Persona/);
  assert.match(frame, /nav\?: NavItem\[\]/);
});

test('the layers keep trackScreen, DSTable exists and the icon is a currentColor mask', () => {
  const comps = seed('ds/components.tsx');
  assert.match(comps, /export function DSTable</);
  assert.strictEqual((comps.match(/trackScreen\?: string/g) || []).length, 2, 'DSModal and DSBottomSheet');
  assert.match(comps, /--ds-icon-src/);
  assert.match(seed('ds/ds.css'), /mask: var\(--ds-icon-src\)/);
  assert.doesNotMatch(comps, /eslint-disable/, 'no lint suppression in the seed');
});

test('the shared analytics and demo-state files keep their contract and carry no lint suppression', () => {
  const analytics = seed('prototypes/_shared/analytics.ts');
  assert.match(analytics, /export function track\(/);
  assert.match(analytics, /export const SCREEN_ATTR = 'data-track-screen'/);
  const ds = seed('prototypes/_shared/demo-state.ts');
  for (const exp of ['DEMO_STATE_PARAM', 'hasDemoStateParam', 'useDemoState', 'DemoStateDef']) assert.ok(ds.includes('export ' + (exp === 'DemoStateDef' ? 'interface ' : exp.startsWith('use') || exp.startsWith('has') ? 'function ' : 'const ') + exp), exp);
  assert.doesNotMatch(ds, /eslint-disable/);
  assert.match(ds, /readonly DemoStateDef\[\]/);
});

test('every text file of the shared layer is ASCII', () => {
  for (const rel of ['ds/tokens.css', 'ds/ds.css', 'ds/components.tsx', 'ds/icons.ts', 'ds/index.ts', 'components/AppFrame.tsx', 'components/AppFrame.css', 'components/index.ts', 'prototypes/_shared/analytics.ts', 'prototypes/_shared/demo-state.ts', 'recorder.ts']) {
    assert.doesNotMatch(seed(rel), /[^\x00-\x7F]/, rel);
  }
});
