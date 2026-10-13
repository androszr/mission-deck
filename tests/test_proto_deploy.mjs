// tests/test_proto_deploy.mjs
// The pure half of the prototype publish window (js/proto-deploy-helpers.mjs). No
// document access - the module is browser-free precisely so it can be read
// from here directly.

import test from 'node:test';
import assert from 'node:assert';
import {
  deployConfirmHtml,
  progressLabel,
  deployResultHtml,
  deployErrorMessage,
  deployErrorInfo,
  isStaleSourceError,
  staleSourceHtml,
  isUnsentSourceError,
  unsentSourceHtml,
  deployStreamUrl,
  unsyncedAfterDeployHtml,
  pipelineDelayHtml,
  PREVIEW_PHASES,
  formatElapsed,
  installWhy,
  previewSteps,
  previewStepsHtml,
} from '../js/proto-deploy-helpers.mjs';

test('deployConfirmHtml says what will happen and escapes the name', () => {
  const html = deployConfirmHtml({ id: 'proto-till', name: 'Till <b>new</b>', invitationCode: '421337' });
  assert.ok(html.includes('Till &lt;b&gt;new&lt;/b&gt;'), 'the registry name is data, not markup');
  assert.ok(html.includes('421337'));
  assert.ok(html.includes('hosting'), 'the person clicking must know the publish ends at the hosting');
});

test('deployConfirmHtml without a code promises to assign one automatically', () => {
  const html = deployConfirmHtml({ id: 'proto-new' });
  assert.ok(html.includes('will be assigned automatically'));
  assert.ok(!html.includes('undefined'));
  assert.ok(deployConfirmHtml(null).length > 0, 'a missing entry must not break the window');
});

test('progressLabel stays within 0-100 and never loses its caption', () => {
  assert.strictEqual(progressLabel(0, 'Start...'), '0% · Start...');
  assert.strictEqual(progressLabel(42.6, 'Building'), '43% · Building');
  assert.strictEqual(progressLabel(-5, 'x'), '0% · x');
  assert.strictEqual(progressLabel(180, 'x'), '100% · x');
  // A bare percentage without a message keeps the previous caption: a bar
  // without a caption looks frozen, and long steps (npm install, build) send
  // bare percentages.
  assert.strictEqual(progressLabel(70, '', 'Installing dependencies'), '70% · Installing dependencies');
  assert.strictEqual(progressLabel(70, ''), '70% · Working...');
  assert.strictEqual(progressLabel('not-a-number', 'x'), '0% · x');
});

test('deployResultHtml tells success from failure and adds a link only on success', () => {
  const ok = deployResultHtml({ ok: true, message: 'Done', url: 'https://example.test/till' });
  assert.ok(ok.includes('ds-callout--success'));
  assert.ok(ok.includes('https://example.test/till'));

  // A dry run ends without a push, so without an address.
  const dry = deployResultHtml({ ok: true, message: 'Dry run' });
  assert.ok(dry.includes('ds-callout--success'));
  assert.ok(!dry.includes('<a href'));
  assert.ok(!dry.includes('proto-deploy-pipeline'), 'without a push there is nothing to wait for');

  const bad = deployResultHtml({ ok: false, message: 'ESLint reported errors' });
  assert.ok(bad.includes('ds-callout--danger'));
  assert.ok(!bad.includes('<a href'), 'a failed publish has nothing to open');
});

test('deployErrorMessage never lets a dropped connection pose as a server message', () => {
  assert.strictEqual(deployErrorMessage(JSON.stringify({ message: 'ADO token missing' })), 'ADO token missing');
  const fallback = deployErrorMessage(undefined);
  assert.ok(fallback.includes('interrupted'));
  assert.strictEqual(deployErrorMessage('{not-json'), fallback);
  assert.strictEqual(deployErrorMessage(''), fallback);
  assert.strictEqual(deployErrorMessage(JSON.stringify({})), fallback);
});

test('deployErrorInfo carries the error code and the file lists of the stale-source gate', () => {
  const info = deployErrorInfo(JSON.stringify({
    error: 'stale-source',
    message: 'The published version contains files from outside the repository',
    stale: ['prototypes/proto-x/index.tsx'],
    unknown: [],
  }));
  assert.strictEqual(info.error, 'stale-source');
  assert.deepStrictEqual(info.stale, ['prototypes/proto-x/index.tsx']);
  assert.ok(isStaleSourceError(info));
  // Every other refusal - ESLint, build, git - gets no override button.
  assert.ok(!isStaleSourceError(deployErrorInfo(JSON.stringify({ error: 'lint-failed', message: 'ESLint' }))));
  // A dropped connection: code null, empty lists, the same message as deployErrorMessage.
  const broken = deployErrorInfo(undefined);
  assert.strictEqual(broken.error, null);
  assert.deepStrictEqual(broken.stale, []);
  assert.strictEqual(broken.message, deployErrorMessage(undefined));
  assert.ok(!isStaleSourceError(broken));
});

test('staleSourceHtml shows the message and the file list, escapes and trims', () => {
  const html = staleSourceHtml({ message: 'Warning <b>', stale: ['a/<x>.tsx'], unknown: ['b.css'] });
  assert.ok(html.includes('ds-callout--warning'));
  assert.ok(html.includes('Warning &lt;b&gt;'));
  assert.ok(html.includes('<code>a/&lt;x&gt;.tsx</code>') && html.includes('<code>b.css</code>'));
  assert.ok(html.includes('Publishing paused'));
  const long = staleSourceHtml({ message: 'm', stale: Array.from({ length: 45 }, (_, i) => `f${i}`), unknown: [] });
  assert.ok(long.includes('and 5 more'));
  assert.ok(!staleSourceHtml({ message: 'm', stale: [], unknown: [] }).includes('<ul'), 'no files means no empty list');
});

test('deployStreamUrl appends force=1 only when explicitly asked', () => {
  assert.strictEqual(deployStreamUrl('proto-x'), '/api/prototypes/deploy-stream?id=proto-x');
  assert.strictEqual(deployStreamUrl('proto-x', false), '/api/prototypes/deploy-stream?id=proto-x');
  assert.strictEqual(deployStreamUrl('proto-x', true), '/api/prototypes/deploy-stream?id=proto-x&force=1');
});

test('after a successful publish unsent product data gets a warning, zero files - nothing', () => {
  assert.strictEqual(unsyncedAfterDeployHtml(0), '');
  assert.strictEqual(unsyncedAfterDeployHtml(undefined), '');
  assert.strictEqual(unsyncedAfterDeployHtml('x'), '');
  const warn = unsyncedAfterDeployHtml(3);
  assert.ok(warn.includes('ds-callout--warning') && warn.includes('3 file') && warn.includes('Sync'));
  // Success with unsent files carries both blocks; a failure never the warning.
  const ok = deployResultHtml({ ok: true, message: 'Done', url: 'https://example.test/x', unsynced: 2 });
  assert.ok(ok.includes('ds-callout--success') && ok.includes('proto-deploy-unsynced'));
  assert.ok(!deployResultHtml({ ok: true, message: 'Done', url: 'https://example.test/x' }).includes('proto-deploy-unsynced'));
  assert.ok(!deployResultHtml({ ok: false, message: 'x', unsynced: 5 }).includes('proto-deploy-unsynced'));
});

test('pipelineDelayHtml warns that the new version appears only after the pipeline (about 5 minutes)', () => {
  const html = pipelineDelayHtml(true);
  assert.ok(html.includes('proto-deploy-pipeline') && html.includes('few minutes'));
  assert.ok(html.includes('previous version'), 'says what the address serves meanwhile');
  assert.strictEqual(pipelineDelayHtml(false), '');
  assert.strictEqual(pipelineDelayHtml(undefined), '');

  // A real push -> the notice is there, and ABOVE the sync warning.
  const pushed = deployResultHtml({ ok: true, message: 'Done', url: 'https://example.test/x', pushed: true, unsynced: 2 });
  assert.ok(pushed.includes('proto-deploy-pipeline'));
  assert.ok(pushed.indexOf('proto-deploy-pipeline') < pushed.indexOf('proto-deploy-unsynced'));
  assert.ok(!deployResultHtml({ ok: false, message: 'x', pushed: true }).includes('proto-deploy-pipeline'), 'a failure promises no version');
});

// The client wiring, not only the pure helper: the `done` handler in
// js/proto-deploy.js MUST pass the server's `pushed` (and `unsynced`) to
// deployResultHtml - without it pipelineDelayHtml got undefined and the
// "new version in about 5 minutes" callout never reached the screen, although
// the helper test with a hand-built `pushed: true` was green.
test('js/proto-deploy.js: the done handler passes pushed and unsynced to deployResultHtml', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../js/proto-deploy.js', import.meta.url), 'utf8');
  const call = /deployResultHtml\(\{[^}]*\bok:\s*true[^}]*\}/.exec(src);
  assert.ok(call, 'a deployResultHtml({ ok: true, ... }) call in the done handler');
  assert.ok(/\bpushed:\s*d\.pushed\b/.test(call[0]), 'pushed: d.pushed');
  assert.ok(/\bunsynced:\s*d\.unsynced\b/.test(call[0]), 'unsynced: d.unsynced');
});

// ── Local preview: the progress modal ──────────────────────────────────────────

test('formatElapsed: seconds, minutes with a leading zero, junk -> 0 s', () => {
  assert.strictEqual(formatElapsed(12400), '12 s');
  assert.strictEqual(formatElapsed(125000), '2 min 05 s');
  assert.strictEqual(formatElapsed(-5), '0 s');
  assert.strictEqual(formatElapsed(undefined), '0 s');
});

test('previewSteps: before the first answer the first step is active', () => {
  const steps = previewSteps(null);
  assert.deepStrictEqual(steps.map((s) => s.id), PREVIEW_PHASES.map((p) => p.id));
  assert.deepStrictEqual(steps.map((s) => s.state), ['active', 'pending', 'pending', 'pending']);
});

test('previewSteps: steps before the phase are done, the active one carries the phase time', () => {
  const steps = previewSteps({ phase: 'libs', phaseStartedAt: 1000, now: 8000 });
  assert.deepStrictEqual(steps.map((s) => s.state), ['done', 'done', 'active', 'pending']);
  assert.strictEqual(steps[2].elapsed, '7 s');
  assert.strictEqual(steps[0].elapsed, '');
});

test('previewSteps: an unknown phase does not break the list', () => {
  assert.strictEqual(previewSteps({ phase: 'something-new' })[0].state, 'active');
});

test('installWhy says WHY the install takes time', () => {
  const cold = installWhy({ cold: true, attempt: 1, packages: 0 });
  assert.ok(cold.includes('First preview'), 'a cold start must be named');
  assert.ok(cold.includes('2-5 minutes'), 'the person must know how long to wait');
  assert.ok(!cold.includes('Packages downloaded'), 'zero packages is not progress');
  assert.ok(installWhy({ cold: true, packages: 214 }).includes('Packages downloaded: 214.'));
  assert.ok(installWhy({ cold: false }).includes('missing packages'));
  assert.strictEqual(installWhy(null), PREVIEW_PHASES[1].why);
});

test('previewStepsHtml: the explanation only on the active step, text escaped', () => {
  const html = previewStepsHtml([
    { id: 'a', label: 'Done', why: 'x', state: 'done', elapsed: '' },
    { id: 'b', label: 'Now <b>', why: 'Because <i>so</i>', state: 'active', elapsed: '3 s' },
    { id: 'c', label: 'Later', why: 'not visible', state: 'pending', elapsed: '' },
  ]);
  assert.ok(html.includes('Now &lt;b&gt;'));
  assert.ok(html.includes('Because &lt;i&gt;so&lt;/i&gt;'));
  assert.ok(!html.includes('not visible'), 'waiting steps show no explanation');
  assert.ok(html.includes('aria-current="step"'));
  assert.ok(html.includes('3 s'));
});

// -- The unsent-source refusal (2026-10-07) ---------------------------------------
// A prototype published from a computer that had not pushed its product data
// was later overwritten by an older copy from another computer. The publish
// refuses until the prototype files are sent; the window has no "anyway", only "Send data".

test('deployErrorInfo carries the file list of the unsent-source refusal', () => {
  const info = deployErrorInfo(JSON.stringify({
    error: 'unsent-source',
    message: 'The files of this prototype have not been sent',
    files: ['prototypes/proto-x/index.tsx', 'prototypes/proto-x/styles.css'],
  }));
  assert.strictEqual(info.error, 'unsent-source');
  assert.deepStrictEqual(info.files, ['prototypes/proto-x/index.tsx', 'prototypes/proto-x/styles.css']);
  assert.ok(isUnsentSourceError(info));
  assert.ok(!isStaleSourceError(info), 'unsent-source gets no "Publish anyway" button');
  assert.deepStrictEqual(deployErrorInfo('').files, []);
});

test('unsentSourceHtml shows the message and the file list, escapes the names', () => {
  const html = unsentSourceHtml({ message: 'Send <data>', files: ['prototypes/<x>/index.tsx'] });
  assert.ok(html.includes('ds-callout--warning'));
  assert.ok(html.includes('Send &lt;data&gt;'));
  assert.ok(html.includes('<code>prototypes/&lt;x&gt;/index.tsx</code>'));
  const many = unsentSourceHtml({ message: 'm', files: Array.from({ length: 45 }, (_, i) => `f${i}`) });
  assert.ok(many.includes('… and 5 more'));
});
