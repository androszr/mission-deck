// tests/test_prototypy_cache.mjs
// Runtime behaviour of the cache-invalidation wiring added to js/prototypy.js
// for Phase C/step 12 of docs/architecture/prototypes.md
// (AC6 - "data without F5"). Deliberately NOT a source regex: this actually
// imports the module with a stubbed `document`/`fetch`, drives the real
// module-level onDataChanged/onSecretsChanged subscription (js/data-events.js,
// js/secrets-events.js both read `globalThis.document` lazily, so the stub
// must exist BEFORE the module is imported - the subscription itself runs at
// import time, see js/module-sync-bar.js for the same pattern) and asserts
// that /api/prototypes is refetched exactly once per invalidation, never
// eagerly and never never.
//
// Run: node --test tests/test_prototypy_cache.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The bus modules read `globalThis.document` at CALL time - the stub must be
// in place before js/prototypy.js runs its top-level onDataChanged(...) /
// onSecretsChanged(...) calls, i.e. before the dynamic import below.
globalThis.document = new EventTarget();
// initPrototypy()/renderPrototypyView() also call document.getElementById -
// EventTarget alone does not have it, so this stub adds exactly what the
// registry paint path touches, no more.
let markup = '';
const _fakeRoot = {
  set innerHTML(value) { markup = value; },
  get innerHTML() { return markup; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
};
globalThis.document.getElementById = (id) => (id === 'prototypy-root' || id === 'proto-detail-root' ? _fakeRoot : null);

const { emitDataChanged } = await import(pathToFileURL(path.join(ROOT, 'js', 'data-events.js')).href);
const { emitSecretsChanged } = await import(pathToFileURL(path.join(ROOT, 'js', 'secrets-events.js')).href);
const { __testSetMembers } = await import(pathToFileURL(path.join(ROOT, 'js', 'team-directory.js')).href);
__testSetMembers([], true);

const proto = await import(pathToFileURL(path.join(ROOT, 'js', 'prototypy.js')).href);

function installFetchStub() {
  const calls = { items: 0, deployStatus: 0 };
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u === '/api/prototypes') {
      calls.items += 1;
      return { ok: true, json: async () => ({ items: [{ id: 'proto-a', name: 'A', format: 'react' }] }) };
    }
    if (u === '/api/prototypes/initiatives') {
      return { ok: true, json: async () => ({ map: {} }) };
    }
    if (u === '/api/prototypes/deploy-status') {
      calls.deployStatus += 1;
      return { ok: true, json: async () => ({ enabled: false, baseUrl: '' }) };
    }
    if (u === '/api/prototypes/spec/proto-a') {
      return { ok: true, status: 200, json: async () => ({ scope: [] }) };
    }
    throw new Error('unexpected fetch: ' + u);
  };
  return calls;
}

test('onDataChanged invalidates the items cache so the next registry load refetches /api/prototypes', async () => {
  const calls = installFetchStub();

  proto.initPrototypy(); // first load, warms the cache
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.items, 1, 'first entry into the view must fetch once');

  proto.renderPrototypyView(); // cache is warm - must NOT refetch
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.items, 1, 'a warm cache must not cause a second network call');

  emitDataChanged({ repo: 'ds-data-reports', op: 'pull' });

  proto.renderPrototypyView(); // cache was invalidated by the bus - must refetch
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.items, 2, 'after onDataChanged the next paint must hit the network again');
});

test('the prototypy VIEW_REGISTRY refresh hook force-invalidates and refetches even while the view is not the active paint target', async () => {
  const calls = installFetchStub();

  // The module-level cache may already be warm from an earlier test in this
  // same process - refreshPrototypyRegistry() must invalidate unconditionally
  // regardless of prior state, so use it (not initPrototypy) for the very
  // first call too.
  proto.refreshPrototypyRegistry();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.items, 1);

  proto.renderPrototypyView(); // cache is warm right after - must not refetch
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.items, 1, 'a warm cache right after refresh must not cause a second network call');

  // Simulates js/app.js:refreshActiveView() calling VIEW_REGISTRY['prototypy'].refresh
  // directly, independent of listener registration order on the shared bus.
  proto.refreshPrototypyRegistry();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.items, 2, 'refreshPrototypyRegistry must always force a refetch');
});

test('onSecretsChanged invalidates the deploy-status cache independently of the items cache', async () => {
  const calls = installFetchStub();

  proto.refreshProtoDetail('proto-a');
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const afterFirst = calls.deployStatus;
  assert.ok(afterFirst >= 1, 'proto-detail must fetch deploy-status at least once');

  emitSecretsChanged({ reason: 'unlock' });

  proto.refreshProtoDetail('proto-a');
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(calls.deployStatus > afterFirst, 'after onSecretsChanged, deploy-status must be refetched, not served stale');
});

test('refresh during a registry request awaits fresh data and ignores late items and initiatives', async () => {
  installFetchStub();
  const fallback = globalThis.fetch;
  let finishItems;
  let finishInitiatives;
  globalThis.fetch = (url) => {
    if (url === '/api/prototypes') return new Promise((resolve) => { finishItems = resolve; });
    if (url === '/api/prototypes/initiatives') return new Promise((resolve) => { finishInitiatives = resolve; });
    return fallback(url);
  };
  const old = proto.refreshPrototypyRegistry();
  installFetchStub();
  await proto.refreshPrototypyRegistry();
  const freshMarkup = markup;
  assert.match(freshMarkup, /data-proto-id="proto-a"/);
  finishItems({ ok: true, json: async () => ({ items: [{ id: 'proto-old', name: 'OLD' }] }) });
  finishInitiatives({ ok: true, json: async () => ({ map: { 'dt-old': 'OLD' } }) });
  await old;
  assert.equal(markup, freshMarkup, 'old request must not repaint newer cards');
});

test('late detail response cannot overwrite a refreshed spec or another detail', async () => {
  installFetchStub();
  const fallback = globalThis.fetch;
  let finishSpec;
  globalThis.fetch = (url) => url === '/api/prototypes/spec/proto-a'
    ? new Promise((resolve) => { finishSpec = resolve; }) : fallback(url);
  const old = proto.refreshProtoDetail('proto-a');
  await new Promise((resolve) => setTimeout(resolve, 0));
  installFetchStub();
  const freshFetch = globalThis.fetch;
  globalThis.fetch = (url) => url === '/api/prototypes/spec/proto-a'
    ? Promise.resolve({ ok: true, json: async () => ({ scope: [{ group: 'FRESH GROUP', items: ['fresh'] }] }) })
    : freshFetch(url);
  await proto.refreshProtoDetail('proto-a');
  assert.match(markup, /FRESH GROUP/);
  const freshMarkup = markup;
  finishSpec({ ok: true, json: async () => ({ summary: 'STALE SPEC' }) });
  await old;
  assert.equal(markup, freshMarkup);
  await proto.renderProtoDetailView('proto-deleted');
  assert.match(markup, /proto-deleted/);
  assert.doesNotMatch(markup, /FRESH GROUP/);
});

test('failed or null deploy status and null spec are retryable, never cached as success', async () => {
  for (const statusResponse of [
    { ok: false, status: 503 },
    { ok: true, json: async () => null },
  ]) {
    installFetchStub();
    const fallback = globalThis.fetch;
    globalThis.fetch = (url) => {
      if (url === '/api/prototypes/deploy-status') return Promise.resolve(statusResponse);
      if (url === '/api/prototypes/spec/proto-a') return Promise.resolve({ ok: true, json: async () => null });
      return fallback(url);
    };
    await proto.refreshProtoDetail('proto-a');
    assert.match(markup, /data-proto-status-retry/);
    assert.match(markup, /data-proto-spec-retry/);
    const calls = installFetchStub();
    await proto.renderProtoDetailView('proto-a');
    assert.equal(calls.deployStatus, 1, 'next render retries without a bus event');
    assert.doesNotMatch(markup, /data-proto-status-retry|data-proto-spec-retry/);
  }
});

test('secret unlock repaints active detail without a manual refresh hook call', async () => {
  installFetchStub();
  await proto.refreshProtoDetail('proto-a');
  globalThis.location = { hash: '#proto-detail/proto-a' };
  const calls = installFetchStub();
  const fallback = globalThis.fetch;
  globalThis.fetch = (url) => url === '/api/prototypes/deploy-status'
    ? Promise.resolve({ ok: true, json: async () => ({ enabled: true, canBuild: true, baseUrl: 'https://example.test' }) })
    : fallback(url);
  try {
    emitSecretsChanged({ reason: 'unlock' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(markup, /data-proto-preview/);
    assert.match(markup, /data-proto-deploy/);
    assert.equal(calls.items, 0, 'unlock does not discard the registry cache');
  } finally {
    delete globalThis.location;
  }
});

test('empty registry still exposes creation and command rejects unsafe imported ids', async () => {
  installFetchStub();
  const fallback = globalThis.fetch;
  globalThis.fetch = (url) => url === '/api/prototypes'
    ? Promise.resolve({ ok: true, json: async () => ({ items: [] }) }) : fallback(url);
  await proto.refreshPrototypyRegistry();
  assert.match(markup, /data-proto-add/);
  for (const id of ['../outside', 'proto-x\n/other', 'proto-%2f', '']) {
    const command = proto.protoStartCommand({ id, name: 'Test' });
    assert.doesNotMatch(command, /\/prototype|data-sub-repositories/);
  }
});

test('navigation to another detail wins over an older in-flight spec', async () => {
  installFetchStub();
  const fallback = globalThis.fetch;
  let finishSpec;
  globalThis.fetch = (url) => url === '/api/prototypes/spec/proto-a'
    ? new Promise((resolve) => { finishSpec = resolve; }) : fallback(url);
  const old = proto.refreshProtoDetail('proto-a');
  await new Promise((resolve) => setTimeout(resolve, 0));
  await proto.renderProtoDetailView('proto-deleted');
  const notFound = markup;
  finishSpec({ ok: true, json: async () => ({ summary: 'OLD DETAIL' }) });
  await old;
  assert.equal(markup, notFound);
  assert.doesNotMatch(markup, /OLD DETAIL/);
});

test('successful writes invalidate old reads without manufacturing a partial registry cache', async () => {
  const source = fs.readFileSync(path.join(ROOT, 'js/prototypy.js'), 'utf8')
    .replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
  const result = await vm.runInNewContext(source + `
    (async () => {
      let finish;
      globalThis.fetch = () => new Promise(resolve => { finish = resolve; });
      const pending = _ensureItems();
      _cacheUpsertItem({ id: 'proto-new' });
      const emptyUntilRefetch = _itemsCache === null;
      finish({ ok: true, json: async () => ({ items: [{ id: 'proto-old' }] }) });
      await pending;
      const staleIgnored = _itemsCache === null;
      _itemsCache = { items: [{ id: 'proto-old' }, { id: 'proto-keep' }] };
      _cacheUpsertItem({ id: 'proto-new' });
      _cacheRemoveItem('proto-old');
      return { emptyUntilRefetch, staleIgnored, ids: _itemsCache.items.map(x => x.id) };
    })()
  `, { onDataChanged() {}, onSecretsChanged() {} });
  assert.equal(result.emptyUntilRefetch, true);
  assert.equal(result.staleIgnored, true);
  assert.deepEqual(Array.from(result.ids).sort(), ['proto-keep', 'proto-new']);
});

test('returning to an invalidated hidden registry replaces its abandoned skeleton', async () => {
  const calls = installFetchStub();
  emitDataChanged({ repo: 'ds-data-reports', op: 'pull' });
  const originalQuery = _fakeRoot.querySelector;
  _fakeRoot.querySelector = (selector) => selector === '[data-skel]' ? {} : null;
  try {
    await proto.renderPrototypyView();
    assert.equal(calls.items, 1);
    assert.match(markup, /data-proto-id="proto-a"/);
  } finally {
    _fakeRoot.querySelector = originalQuery;
  }
});
