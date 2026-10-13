// Unit test for js/data-tier-0-sync.js's `dataTierPending` - the one predicate
// behind the top bar's "Synchronizacja" dot. The module imports cleanly under
// plain node (its document work all sits inside function bodies), so no jsdom.
// Run: node --test tests/test_data_tier_pending.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import {
  dataTierPending, fetchSyncOverview, getSyncOverview, refreshRemoteState,
} from '../js/data-tier-0-sync.js';

// ── Overview cache: what a FAILED request leaves behind ─────────────────────
// `getSyncOverview()` is what the sync window paints from and what its row
// handlers look rows up in. A failed request used to REPLACE the cache with
// the empty fallback, so a server that could not reach GitLab for one refresh
// blanked eight rows of real state into "no connection". These tests pin the
// replacement rule (keep the last good overview) and the one thing it must not
// hide: whether THIS refresh happened.
describe('overview cache on failure', () => {
  const realFetch = globalThis.fetch;
  after(() => { globalThis.fetch = realFetch; });

  const good = { ok: true, repos: [{ repo: 'data-tier-0', status: 'ok' }], autoSyncEnabled: true, intervalMs: 5000 };
  const answer = (body, ok = true) => async () => ({ ok, json: async () => body });
  const dead = async () => { throw new TypeError('fetch failed'); };

  it('with no cache yet, a failed GET is the empty fallback - the caller can tell "failed" from "not asked"', async () => {
    // Runs first on purpose: module state is shared across the file.
    globalThis.fetch = dead;
    const ov = await fetchSyncOverview();
    assert.equal(ov.ok, false);
    assert.deepEqual(ov.repos, []);
    assert.equal(getSyncOverview().ok, false);
  });

  it('a successful GET fills the cache with the normalised shape', async () => {
    globalThis.fetch = answer(good);
    const ov = await fetchSyncOverview();
    assert.equal(ov.ok, true);
    assert.equal(ov.repos.length, 1);
    assert.equal(ov.autoSyncEnabled, true);
    assert.equal(ov.intervalMs, 5000);
    assert.equal(getSyncOverview(), ov);
  });

  it('a failed GET after a good one keeps the last good overview instead of blanking the rows', async () => {
    globalThis.fetch = dead;
    const ov = await fetchSyncOverview();
    assert.equal(ov.ok, true);
    assert.equal(ov.repos.length, 1, 'real rows survive one failed poll');
    globalThis.fetch = answer({}, false);
    assert.equal((await fetchSyncOverview()).repos.length, 1, 'a non-2xx answer is a failure like any other');
  });

  it('refreshRemoteState answers ok:false for a failed POST even though the cache still holds a good overview', async () => {
    // The bug this pins: the failure path spread the cached overview, whose
    // `ok` is true, so the modal skipped "Could not check the server" and
    // repainted stale rows as if the check had happened.
    globalThis.fetch = dead;
    const r = await refreshRemoteState({ force: true });
    assert.equal(r.ok, false);
    assert.deepEqual(r.refreshed, []);
    assert.equal(r.repos.length, 1, 'the rows are still there to paint from');
    assert.equal(getSyncOverview().ok, true, 'the cache itself is untouched');
  });

  it('a successful refresh updates the cache and hands back the per-source results', async () => {
    const fresh = { ...good, repos: [...good.repos, { repo: 'data-leads', status: 'ok' }], refreshed: [{ repo: 'data-tier-0', ok: true }] };
    globalThis.fetch = answer(fresh);
    const r = await refreshRemoteState();
    assert.equal(r.ok, true);
    assert.equal(r.repos.length, 2);
    assert.deepEqual(r.refreshed, [{ repo: 'data-tier-0', ok: true }]);
    assert.equal(getSyncOverview().repos.length, 2);
    assert.equal('refreshed' in getSyncOverview(), false, 'the cache keeps the overview shape, not the refresh envelope');
  });
});

describe('dataTierPending', () => {
  const clean = { ahead: 0, behind: 0, dirty: false, bitwardenLocked: false };

  it('is quiet when there is nothing to do in either direction', () => {
    assert.equal(dataTierPending(clean), false);
    assert.equal(dataTierPending(null), false);
  });

  it('lights up for commits waiting on the SERVER, not only for local work', () => {
    // The gap this closes: the dot read `ahead`/`dirty` only, so the team's
    // pushed work sat unpulled with a calm pill. `behind` is already in the
    // status payload - it just was not read.
    assert.equal(dataTierPending({ ...clean, behind: 6 }), true);
  });

  it('keeps every signal it already had', () => {
    assert.equal(dataTierPending({ ...clean, ahead: 1 }), true);
    assert.equal(dataTierPending({ ...clean, dirty: true }), true);
    assert.equal(dataTierPending({ ...clean, bitwardenLocked: true }), true);
  });
});
