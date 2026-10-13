// tests/test_plan_status.mjs
// Rewrite logic of scripts/plan-status.js (the /new-idea Phase 7 handoff),
// exercised on in-memory fixture plans - never against the live repo files.

import test from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const status = require(path.join(ROOT, 'scripts', 'plan-status.js'));

const PLAN = [
  '<!-- plan template comment -->',
  '',
  '# Add the raporty view',
  '',
  '**Date:** 2026-09-04',
  '**Status:** draft',
  '',
  '## Steps',
  '',
  '- [ ] 1. Do the thing',
  '',
  '## Acceptance criteria',
  '',
  '- [ ] AC1: `npm run lint` exits 0',
  '- [ ] AC2: the view renders',
  '- [ ] AC_VIS1: looks right in dark mode',
  '',
  '## Iteration log',
  '',
  '- 2026-09-04 initial draft',
  '',
].join('\n');

const OPTS = (over) => Object.assign({ status: 'done', ac: new Map(), date: '2026-09-05' }, over || {});

test('parseAcSpec reads pass, fail with evidence, manual and deferred', () => {
  const m = status.parseAcSpec('AC1=pass,AC2=fail:no route added,ac_vis1=manual,AC3=deferred');
  assert.strictEqual(m.get('AC1').result, 'pass');
  assert.strictEqual(m.get('AC2').result, 'fail');
  assert.strictEqual(m.get('AC2').evidence, 'no route added');
  assert.strictEqual(m.get('AC_VIS1').result, 'manual');
  assert.strictEqual(m.get('AC3').result, 'deferred');
});

test('parseAcSpec rejects an unknown result and a malformed item', () => {
  assert.throws(() => status.parseAcSpec('AC1=maybe'), /pass\|fail\|manual\|deferred/);
  assert.throws(() => status.parseAcSpec('AC1'), /expected <id>=<result>/);
});

test('the Status field is rewritten in place', () => {
  const out = status.applyStatus(PLAN, OPTS({ status: 'partial' }));
  assert.match(out.text, /^\*\*Status:\*\* partial$/m);
  assert.ok(out.statusFound);
  assert.doesNotMatch(out.text, /\*\*Status:\*\* draft/);
});

test('checkboxes are ticked from the AC spec', () => {
  const ac = status.parseAcSpec('AC1=pass,AC2=fail:no view section,AC_VIS1=manual');
  const out = status.applyStatus(PLAN, OPTS({ ac }));
  assert.match(out.text, /- \[x\] AC1:/);
  assert.match(out.text, /- \[ \] AC2: the view renders <!-- FAIL: no view section -->/);
  assert.match(out.text, /- \[~\] AC_VIS1:/);
  assert.deepStrictEqual(out.counts, { pass: 1, fail: 1, manual: 1, deferred: 0 });
  assert.deepStrictEqual(out.missing, []);
});

test('an AC id that is not in the plan is reported as missing', () => {
  const out = status.applyStatus(PLAN, OPTS({ ac: status.parseAcSpec('AC9=pass') }));
  assert.deepStrictEqual(out.missing, ['AC9']);
});

test('only checkboxes under ## Acceptance criteria are touched', () => {
  const out = status.applyStatus(PLAN, OPTS({ ac: status.parseAcSpec('AC1=pass') }));
  assert.match(out.text, /- \[ \] 1\. Do the thing/, 'the Steps checkbox must stay untouched');
});

test('the IMPLEMENTED banner sits above the H1 and never stacks', () => {
  const once = status.applyStatus(PLAN, OPTS({}));
  const lines = once.text.split('\n');
  const bannerIdx = lines.findIndex((l) => l.startsWith('> **[IMPLEMENTED'));
  const h1Idx = lines.findIndex((l) => l.startsWith('# '));
  assert.ok(bannerIdx !== -1 && bannerIdx < h1Idx, 'banner must precede the H1');

  const twice = status.applyStatus(once.text, OPTS({ status: 'partial', date: '2026-09-06' }));
  const count = twice.text.split('\n').filter((l) => l.startsWith('> **[IMPLEMENTED')).length;
  assert.strictEqual(count, 1, 'the banner is replaced, not stacked');
  assert.match(twice.text, /IMPLEMENTED 2026-09-06/);
});

test('the iteration log gains one line and stays idempotent', () => {
  const ac = status.parseAcSpec('AC1=pass');
  const once = status.applyStatus(PLAN, OPTS({ ac, note: 'Bug scan SHIP.' }));
  assert.match(once.text, /- 2026-09-05 implemented \(done\)\. AC: 1 pass \/ 0 fail \/ 0 manual\. Bug scan SHIP\./);

  const twice = status.applyStatus(once.text, OPTS({ ac, note: 'Bug scan SHIP.' }));
  const lines = twice.text.split('\n').filter((l) => l.includes('2026-09-05 implemented'));
  assert.strictEqual(lines.length, 1, 'the same log line is not appended twice');
});

test('a plan with no ## Iteration log gets one appended', () => {
  const noLog = PLAN.replace(/## Iteration log[\s\S]*$/, '');
  const out = status.applyStatus(noLog, OPTS({}));
  assert.match(out.text, /## Iteration log/);
  assert.match(out.text, /- 2026-09-05 implemented \(done\)/);
});

test('a re-run replaces the FAIL marker rather than duplicating it', () => {
  const first = status.applyStatus(PLAN, OPTS({ ac: status.parseAcSpec('AC2=fail:first reason') }));
  const second = status.applyStatus(first.text, OPTS({ ac: status.parseAcSpec('AC2=pass') }));
  assert.match(second.text, /- \[x\] AC2: the view renders$/m);
  assert.doesNotMatch(second.text, /FAIL: first reason/);
});

test('a plan with no Status line is reported, not silently accepted', () => {
  const out = status.applyStatus(PLAN.replace('**Status:** draft\n', ''), OPTS({}));
  assert.strictEqual(out.statusFound, false);
});
