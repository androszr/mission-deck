// tests/test_module_sync_bar.mjs
// Source-level pins for the module sync status bar's wiring, same technique
// as tests/test_module_host_escaping.mjs: js/module-host.js and
// js/module-sync-bar.js are browser ES modules that touch `document` at
// import time, so they are read as text and asserted on rather than loaded.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const host = read('js/module-host.js');
const bar = read('js/module-sync-bar.js');

test('the bar markup escapes viewId and moduleId', () => {
  assert.match(host, /id="msb-' \+ escHtml\(viewId\) \+ '"/);
  assert.match(host, /data-msb-module="' \+ escHtml\(moduleId\) \+ '"/);
});

test('the bar is inserted before .view-data, not inside it', () => {
  const block = /_createViewSection[\s\S]*?\n\}/.exec(host);
  assert.ok(block, '_createViewSection not found');
  const syncBarIdx = block[0].indexOf('msb-bar');
  const viewDataIdx = block[0].indexOf('class="view-data"');
  assert.ok(syncBarIdx > -1, 'msb-bar markup not found in _createViewSection');
  assert.ok(viewDataIdx > -1, '.view-data markup not found in _createViewSection');
  assert.ok(syncBarIdx < viewDataIdx, 'the sync bar must be built before .view-data, so it lands as a sibling ahead of it');
});

test('the view action slot is built before msb-bar and its id is escHtml(viewId)', () => {
  const block = /_createViewSection[\s\S]*?\n\}/.exec(host);
  assert.ok(block, '_createViewSection not found');
  assert.match(block[0], /class="page-header-actions" id="' \+ escHtml\(viewId\) \+ '-actions"/);
  const actionsIdx = block[0].indexOf('page-header-actions');
  const syncBarIdx = block[0].indexOf('msb-bar');
  assert.ok(actionsIdx > -1, 'page-header-actions slot not found in _createViewSection');
  assert.ok(syncBarIdx > -1, 'msb-bar markup not found in _createViewSection');
  assert.ok(actionsIdx < syncBarIdx, 'the action slot must be built before msb-bar');
});

test('the sync bar skeleton carries data-skel so js/skeleton.js recognises it', () => {
  assert.match(host, /class="ds-skeleton msb-skel" data-skel="1"/);
});

test('module-host imports the painter and the click binder from module-sync-bar.js', () => {
  assert.match(host, /import\s*\{\s*paintModuleSyncBar,\s*bindModuleSyncBarClicks\s*}\s*from\s*'\.\/module-sync-bar\.js'/);
});

test('bindModuleSyncBarClicks is called once, before the module loop', () => {
  const calls = host.match(/bindModuleSyncBarClicks\(\)/g) || [];
  assert.equal(calls.length, 1, 'bindModuleSyncBarClicks must be bound exactly once, app-lifetime');
});

test('both the render adapter and the data-hook adapter paint the bar', () => {
  const calls = host.match(/paintModuleSyncBar\(viewId, moduleId\)/g) || [];
  assert.equal(calls.length, 2, 'the render adapter and the data-hook adapter must both call the painter');
});

test('the render adapter awaits the module render before painting', () => {
  const renderBlock = /\[MODULE_RENDER_KEY\]: async \(subPath, opts\) => \{[\s\S]*?\},/.exec(host);
  assert.ok(renderBlock, 'MODULE_RENDER_KEY adapter not found');
  const idx = renderBlock[0].indexOf('paintModuleSyncBar');
  assert.ok(idx > -1, 'render adapter does not paint the bar');
  assert.ok(renderBlock[0].indexOf('await view.render') < idx, 'the bar must paint after the module has rendered');
});

test('hasDataRepos is computed from a non-empty manifest.dataRepos array alone', () => {
  assert.match(host, /const hasDataRepos = Array\.isArray\(manifest\.dataRepos\)\s*&&\s*manifest\.dataRepos\.length > 0;/);
  assert.doesNotMatch(host, /moduleSyncScopeId/);
});

test('module-sync-bar.js is strictly read-only: no push, pull, decrypt or wipe call', () => {
  assert.doesNotMatch(bar, /push-stream|pull-stream|\/decrypt|clear-plaintext/);
});

test('module-sync-bar.js opens the sync center only through a dynamic import', () => {
  assert.match(bar, /await import\('\.\/sync-center-modal\.js'\)/);
  assert.doesNotMatch(bar, /^import[^;]*sync-center-modal\.js/m);
});

test('module-sync-bar.js never imports a module that itself performs sync writes', () => {
  // js/data-tier-0-sync.js and js/sync-modules.js are read-only clients used
  // here (status/refresh only); guard against a future import of a mutating
  // helper module by name.
  assert.doesNotMatch(bar, /from '\.\/sub-repo-sync-stream\.js'/);
  assert.doesNotMatch(bar, /from '\.\/store-conflict-resolver\.js'/);
});

test('module-sync-bar.js imports the unchecked-repo and not-cloned helpers from sync-center-helpers.js rather than reimplementing them', () => {
  assert.match(bar, /import\s*\{\s*moduleSyncBarState,\s*uncheckedRepos,\s*notClonedRepoIds,\s*noTokenRepoIds\s*\}\s*from\s*'\.\/sync-center-helpers\.js'/);
  assert.doesNotMatch(bar, /function _uncheckedRepos/, '_uncheckedRepos must be the pure, unit-tested export in sync-center-helpers.js, not a local reimplementation');
});

test('a repo with no write token or a failed refresh is folded into the answer through uncheckedRepos, never hand-rolled', () => {
  assert.match(bar, /uncheckedRepos\(\(getSyncOverview\(\) \|\| \{\}\)\.repos \|\| \[\], r, list\)/);
});

test('the not-cloned repo ids reach moduleSyncBarState as opts.notClonedRepos, derived from the same overview read as the labels', () => {
  assert.match(bar, /const overviewRepos = \(getSyncOverview\(\) \|\| \{\}\)\.repos \|\| \[\];/);
  assert.match(bar, /notClonedRepos:\s*notClonedRepoIds\(overviewRepos\)/);
  assert.match(bar, /noTokenRepos:\s*noTokenRepoIds\(overviewRepos\)/);
});

test('a connection recovery or a vault change forces the next paint to check the server again', () => {
  assert.match(bar, /const _forceRecheck = \(\) => \{ _lastRemoteRefreshAt = 0; \};/);
  assert.match(bar, /onInfraChanged\(_forceRecheck\);/);
  assert.match(bar, /onSecretsChanged\(_forceRecheck\);/);
});

test('a remembered refresh outcome never forces refreshSyncModules - only a fresh TTL-triggered answer can', () => {
  // `fetched` is derived from the FRESH `list` the remote check just
  // answered - never from _lastRefreshed, which is what the previous
  // navigation (possibly a failure) left behind - and the forced per-module
  // read follows that check. The first, fast paint reads with the consumed
  // dirty bit alone: it has no fresh answer to force from.
  const checkIdx = bar.indexOf('const r = await refreshRemoteState();');
  const fetchedIdx = bar.indexOf('const fetched = list.some(');
  const forceCallIdx = bar.indexOf('refreshSyncModules({ force: fetched || _dirty })');
  assert.ok(checkIdx > -1 && fetchedIdx > -1 && forceCallIdx > -1, 'remote check, fetched derivation or force call not found');
  assert.ok(checkIdx < fetchedIdx && fetchedIdx < forceCallIdx, 'check -> fetched -> forced read, in that order');
  assert.doesNotMatch(bar, /fetched = .*_lastRefreshed/, 'fetched must never be derived from the remembered outcome');
  assert.match(bar, /const firstRows = await refreshSyncModules\(\{ force: dirty \}\);/, 'the first paint forces only for a consumed dirty bit');
  assert.ok(bar.indexOf('const firstRows = await refreshSyncModules') < checkIdx, 'the first paint lands BEFORE the remote check starts');
});

test('the first paint is labelled as still checking exactly when a remote check is about to run, and the second never is', () => {
  assert.match(bar, /const checkDue = Date\.now\(\) - _lastRemoteRefreshAt >= MSB_REMOTE_TTL_MS;/);
  assert.match(bar, /_paintFromRows\(viewId, moduleId, firstRows, _lastRefreshed, \{ checking: checkDue \}\);/);
  assert.match(bar, /_paintFromRows\(viewId, moduleId, rows, refreshed, \{ checking: false \}\);/);
  // Both paints go through the one renderer, and it hands `checking` to the
  // pure helper rather than composing the sentence itself.
  assert.match(bar, /checking: !!\(opts && opts\.checking\)/);
  assert.doesNotMatch(bar, /Sprawdzam serwer/, 'the sentence lives in sync-center-helpers.js, not in the painter');
});

test('the scope id override map and moduleSyncScopeId are gone: the row id is the module id', () => {
  assert.doesNotMatch(bar, /MODULE_SYNC_SCOPE_OVERRIDE/);
  assert.doesNotMatch(bar, /moduleSyncScopeId/);
  assert.match(bar, /const scopeId = moduleId;/);
  assert.match(bar, /const moduleRows = \(rows \|\| \[\]\)\.filter\(\(m\) => m\.id === scopeId\);/);
});

test('the "Szczegoly" toggle only appears for repos with files actually pending to send', () => {
  assert.match(bar, /pendingRepos = moduleRows\s*\.filter\(\(r\) => r && !r\.unknown && Number\(r\.pendingFiles\) > 0\)/);
  assert.match(bar, /data-msb-act="toggle-details"/);
});

test('the per-file detail list reuses syncFileRowHtml from js/sync-file-list.js rather than reimplementing row markup', () => {
  assert.match(bar, /import\s*\{\s*syncFileRowHtml\s*\}\s*from\s*'\.\/sync-file-list\.js'/);
  assert.match(bar, /res\.files\.map\(syncFileRowHtml\)/);
});
