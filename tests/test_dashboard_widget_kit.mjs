// tests/test_dashboard_widget_kit.mjs
// Pure HTML builders of js/dashboard-widget-kit.js: escaping, tone whitelist,
// clamping, layout by frame size, avatar hydration against the team directory.

import { test } from 'node:test';
import assert from 'node:assert';
import * as K from '../js/dashboard-widget-kit.js';
import { __testSetMembers } from '../js/team-directory.js';

test('every builder escapes data strings, titles included', () => {
  const evil = '<img src=x onerror="alert(1)">';
  const out = [
    K.tiles({ tiles: [{ label: evil, value: evil, delta: evil, person: evil }] }),
    K.big({ value: evil, unit: evil, label: evil }),
    K.donut({ value: 5, max: 10, center: evil, label: evil }),
    K.segments({ label: evil, segments: [{ label: evil, value: evil }] }),
    K.progress({ rows: [{ label: evil, value: 1, max: 2, display: evil, person: evil }] }),
    K.bars({ labels: [evil], values: [1], label: evil }),
    K.spark({ values: [1, 2], label: evil }),
    K.heatmap({ rows: [evil], cols: [evil], values: [[1]] }),
    K.people({ people: [{ name: evil, sub: evil }] }),
    K.avatars({ label: evil, people: [{ name: evil }] }),
    K.timeline({ events: [{ date: evil, label: evil, person: evil }] }),
    K.pill({ text: evil, sub: evil }),
    K.empty(evil),
  ].join('');
  assert.ok(!out.includes('<img'), 'no raw tag survives');
  assert.ok(!out.includes('onerror="'), 'no raw attribute quote survives');
});

test('tone is a closed set: an unknown tone becomes neutral, never a class', () => {
  assert.strictEqual(K.tone('ok'), 'ok');
  assert.strictEqual(K.tone('"><script>'), 'neutral');
  assert.strictEqual(K.tone(undefined), 'neutral');
  const html = K.tiles({ tiles: [{ label: 'a', value: '1', tone: 'x" onclick="y' }] });
  assert.ok(html.includes('dash-kit-t-neutral'));
  assert.ok(!html.includes('onclick'));
});

test('numbers are clamped before they reach style attributes', () => {
  const p = K.progress({ rows: [{ label: 'a', value: 500, max: 100 }, { label: 'b', value: -5, max: 100 }, { label: 'c', value: 'abc', max: 100 }] }, { rows: 2 });
  assert.ok(p.includes('width:100.0%'));
  assert.ok(p.includes('width:0.0%'));
  const seg = K.segments({ segments: [{ label: 'x', value: '5" onload="' }, { label: 'y', value: -3 }] });
  assert.ok(!/style="[^"]*[a-z]{3,}[^"]*"/.test(seg.replace(/flex-grow|width|height|opacity/g, '')), 'style carries numbers only');
  const bars = K.bars({ values: [0, 1000], labels: ['a', 'b'] });
  assert.ok(bars.includes('height:4.0%') && bars.includes('height:100.0%'));
  assert.ok(K.donut({ value: 999, max: 10 }).includes('stroke-dasharray="188.5 188.5"'));
});

test('num parses Polish decimals and falls back to 0', () => {
  assert.strictEqual(K.num('102,9 d'), 102.9);
  assert.strictEqual(K.num(NaN), 0);
  assert.strictEqual(K.num(null), 0);
});

test('spark needs two points; people limits with a "+N more" line', () => {
  assert.strictEqual(K.spark({ values: [3] }), '');
  const html = K.people({ people: [1, 2, 3, 4, 5].map((n) => ({ name: 'Osoba ' + n, sub: '' })) }, { limit: 3 });
  assert.ok(html.includes('+2 more'));
  const stack = K.avatars({ people: [1, 2, 3, 4].map((n) => ({ name: 'Os ' + n })), max: 2 });
  assert.ok(stack.includes('+2'));
});

test('a person is an initials placeholder carrying data-person', () => {
  const html = K.avatars({ people: [{ name: 'Taylor Kim' }] });
  assert.ok(html.includes('data-person="Taylor Kim"'));
  assert.ok(html.includes('>TK<'));
  assert.strictEqual(K.kitInitials('Madonna'), 'MA');
  assert.strictEqual(K.kitInitials(''), '?');
});

test('blocks lays out stacked in narrow frames, side by side in wide ones, and skips unknown types', () => {
  const list = [{ type: 'big', value: '1', label: 'a' }, { type: 'nope' }, { type: 'pill', text: 'ok' }];
  assert.ok(K.blocks(list, { cols: 3, rows: 2 }).includes('dash-kit-blocks--col'));
  assert.ok(K.blocks(list, { cols: 6, rows: 1 }).includes('dash-kit-blocks--row'));
  assert.ok(K.blocks(list, { cols: 6, rows: 1 }).includes('dash-kit-n2'));
  assert.strictEqual(K.blocks([], { cols: 3, rows: 1 }), '');
  assert.strictEqual(K.blocks(null), '');
  assert.strictEqual(K.blocks([{ type: 'constructor' }, { type: '__proto__' }, { type: 'toString' }], { cols: 3, rows: 1 }), '', 'prototype keys are not block types');
});

test('a tall frame shows more list rows than a one-row frame', () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ label: 'r' + i, value: 1, max: 2 }));
  const count = (html) => (html.match(/dash-kit-prow"/g) || []).length;
  const one = K.blocks([{ type: 'progress', rows }], { cols: 3, rows: 1 });
  const two = K.blocks([{ type: 'progress', rows }], { cols: 3, rows: 2 });
  assert.ok(count(two) > count(one));
});

test('hydrateAvatars swaps in a photo for a known person and keeps initials otherwise', async () => {
  __testSetMembers([{ id: 'ak', first_name: 'Taylor', last_name: 'Kim', avatar: 'ak.jpg' }]);
  const make = (name) => ({
    dataset: { person: name }, textContent: 'XX', isConnected: true, children: [],
    appendChild(c) { this.children.push(c); },
  });
  const known = make('Taylor Kim');
  const unknown = make('Some Stranger');
  const root = { isConnected: true, querySelectorAll: () => [known, unknown] };
  globalThis.document = { createElement: () => ({ addEventListener() {}, set src(v) { this._src = v; }, get src() { return this._src; } }) };
  await K.hydrateAvatars(root);
  assert.strictEqual(known.children.length, 1, 'photo appended');
  assert.ok(known.children[0].src.includes('ak.jpg'));
  assert.strictEqual(unknown.textContent, 'XX', 'initials kept for an unknown person');
  delete globalThis.document;
});

test('hydrateAvatars leaves a detached root alone', async () => {
  let touched = false;
  await K.hydrateAvatars({ isConnected: false, querySelectorAll: () => { touched = true; return []; } });
  assert.strictEqual(touched, false);
});

// -- chart builders, round 2 ----------------------------------------------------

test('the new chart builders escape data strings and tolerate empty input', () => {
  const evil = '<b onmouseover="x">';
  const out = [
    K.line({ label: evil, series: [{ label: evil, last: evil, values: [1, 2, 3] }, { label: 'b', values: [2, 2, 2], dashed: true }], target: 2, labels: [evil] }, { rows: 2 }),
    K.area({ label: evil, series: [{ label: evil, values: [1, 2] }, { label: 'b', values: [2, 1] }] }),
    K.gauge({ value: 5, min: -10, max: 10, center: evil, label: evil, zones: [{ from: -10, to: 0, tone: 'error' }] }),
    K.bullet({ rows: [{ label: evil, value: 3, target: 5, display: evil }] }),
    K.funnel({ label: evil, steps: [{ label: evil, value: 10 }, { label: 'b', value: 4 }] }),
    K.waffle({ parts: [{ value: 37, label: evil }], center: evil, caption: evil }),
    K.pie({ center: evil, segments: [{ label: evil, value: 3 }, { label: 'b', value: 1 }] }),
    K.calendar({ label: evil, firstWeekday: 3, days: [1, 0, null, 2] }),
    K.compare({ before: { label: evil, value: '1' }, after: { label: evil, value: '2' }, delta: evil }),
    K.rank({ label: evil, items: [{ label: evil, person: evil, value: 2, display: evil }] }),
    K.trend({ value: evil, unit: evil, label: evil, delta: evil, period: evil, values: [1, 2, 3] }),
  ].join('');
  assert.ok(!out.includes('<b onmouseover'), 'no raw tag survives');
  assert.strictEqual(K.line({ series: [] }), '');
  assert.strictEqual(K.area({ series: [] }), '');
});

test('line: AR/Zam geometry - zero-based nice axis, slot-centred round dots, zero:false follows the data', () => {
  const html = K.line({ labels: ['S1', 'S2', 'S3', 'S4'], series: [{ label: 'Otwarte', values: [10, 12, 9, 14] }] }, { rows: 1, cols: 3 });
  // Points sit at slot centres: 12.5%, 37.5%, 62.5%, 87.5% of the plot width.
  assert.ok(html.includes('left:12.50%') && html.includes('left:87.50%'), html);
  // Dots are HTML (always round), never an SVG circle inside the stretched box.
  assert.ok(!/<circle/.test(html) && (html.match(/dash-kit-lc-dot/g) || []).length === 4);
  // Zero-based axis with a nice ceiling: 0 / 10 / 20 for a max of 14.
  assert.ok(html.includes('>0<') && html.includes('>20<'), 'nice ticks 0..20');
  // The last value is written at the line end, labels share the slot grid.
  assert.ok(html.includes('dash-kit-lc-end') && html.includes('repeat(4,minmax(0,1fr))'));
  const near = K.line({ series: [{ values: [96, 98, 97, 99] }], zero: false }, { rows: 2, cols: 3 });
  const ys = [...near.matchAll(/top:([\d.]+)%" title/g)].map((m) => Number(m[1]));
  assert.ok(Math.max(...ys) - Math.min(...ys) > 20, 'zero:false spreads values that sit near the ceiling');
  assert.ok(K.line({ series: [{ values: [1, 2] }], target: 50 }).includes('dash-kit-lc-tgt'));
  assert.ok(K.line({ series: [{ values: [1, 2], dashed: true }] }).includes('dash-kit-dash'));
});

test('niceScale: round steps and a ceiling at or above the data', () => {
  assert.deepStrictEqual(K.niceScale(14, 2), { max: 20, ticks: [0, 10, 20] });
  assert.deepStrictEqual(K.niceScale(46, 4).max >= 46, true);
  assert.deepStrictEqual(K.niceScale(0, 2).ticks[0], 0);
});

test('gauge, bullet and waffle clamp their numbers', () => {
  assert.ok(K.gauge({ value: 999, min: 0, max: 10 }).includes('x2="84.0"'), 'needle stops at the max end');
  assert.ok(K.bullet({ rows: [{ label: 'a', value: 500, target: 900, max: 100 }] }).includes('width:100.0%'));
  assert.strictEqual((K.waffle({ value: 250 }).match(/<i /g) || []).length, 100);
});

test('compare: higherIsBetter decides the tone, direction decides the arrow', () => {
  const up = K.compare({ before: { label: 'a', value: '54' }, after: { label: 'b', value: '62' }, delta: '+8' });
  assert.ok(up.includes('dash-kit-t-ok') && up.includes('▲'));
  const upBad = K.compare({ before: { label: 'a', value: '5' }, after: { label: 'b', value: '9' }, higherIsBetter: false });
  assert.ok(upBad.includes('dash-kit-t-error') && upBad.includes('▲'));
  const down = K.compare({ before: { label: 'a', value: '9' }, after: { label: 'b', value: '5' }, higherIsBetter: false });
  assert.ok(down.includes('dash-kit-t-ok') && down.includes('▼'));
});

test('trend, rank, funnel: arrow tone, avatar placeholder, conversion %', () => {
  assert.ok(K.trend({ value: '1', delta: '-4', label: 'x' }).includes('↘'));
  assert.ok(K.trend({ value: '1', delta: '-4', higherIsBetter: false, label: 'x' }).includes('dash-kit-t-ok'));
  assert.ok(K.rank({ items: [{ label: 'Taylor Kim', person: 'Taylor Kim', value: 3 }] }).includes('data-person="Taylor Kim"'));
  assert.ok(K.funnel({ steps: [{ label: 'a', value: 200 }, { label: 'b', value: 50 }] }).includes('25%'));
  assert.ok(K.blocks([{ type: 'gauge', value: 1, max: 2 }, { type: 'calendar', days: [1] }], { cols: 3, rows: 2 }).includes('dash-kit-gauge'));
});

test('trend: no change is a flat neutral arrow, never a red one', () => {
  for (const delta of ['0', '+0', '0 pp', '']) {
    const html = K.trend({ value: '46', label: 'Otwarte', delta, higherIsBetter: false });
    assert.ok(html.includes('dash-kit-t-neutral">→'), 'delta ' + JSON.stringify(delta) + ' -> ' + html);
    assert.ok(!html.includes('dash-kit-t-error'), 'no error tone for ' + JSON.stringify(delta));
  }
  assert.ok(K.trend({ value: '46', delta: '+3', higherIsBetter: false }).includes('dash-kit-t-error">↗'));
  assert.ok(K.trend({ value: '46', delta: '-4', higherIsBetter: false }).includes('dash-kit-t-ok">↘'));
});
