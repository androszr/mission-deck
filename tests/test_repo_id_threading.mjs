// Regression tests for the repoId threading bug found in the Phase B review.
// Run: node --test tests/test_repo_id_threading.mjs
//
// The bug: js/store-conflict-resolver.js and js/local-changes-modal.js carried a
// repoId through their signatures but called fetchConflictDiff(), writeResolved(),
// fetchLocalChanges() and discardLocalChanges() with NO argument, so every request
// hit data-tier-0 regardless of which source row the user clicked. Harmless while
// the registry had one row; after Phase D added seven, "Discard local changes" on
// one source would have discarded another source's work - silent data loss with no
// error anywhere.
//
// Two layers are covered because the bug needed both to be wrong-proof:
//   1. the client builds the right URL when given a repoId (and stays backward
//      compatible when not),
//   2. no call site passes nothing - a signature-only fix looks correct and is not.
// Layer 2 is a source check on purpose: exercising renderConflictDiff /
// openLocalChangesModal would need a document, and the defect lives at the call site,
// not inside the function.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  fetchLocalChanges, discardLocalChanges, fetchConflictDiff, writeResolved,
  clearDataTierDir, repairDetachedHeadUrl,
} from '../js/data-tier-0-sync.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Captures the URL of the next fetch and answers with a minimal ok payload. */
function _captureFetch() {
  const seen = [];
  globalThis.fetch = async (url, opts) => {
    seen.push({ url: String(url), method: (opts && opts.method) || 'GET' });
    return { ok: true, json: async () => ({ ok: true }) };
  };
  return seen;
}

describe('the client builds the address from repoId', () => {
  it('every operation with a repoId goes to /api/data/<repoId>/<op>', async () => {
    const seen = _captureFetch();
    await fetchLocalChanges('data-mobile');
    await discardLocalChanges('data-leads');
    await fetchConflictDiff('data-reports');
    await writeResolved([{ path: 'a.txt', content: 'x' }], 'data-docs');
    await clearDataTierDir('data-rollouts');

    // A GET may carry a cache-busting `?t=...`; only the path is under test.
    assert.deepEqual(seen.map(s => s.url.split('?')[0]), [
      '/api/data/data-mobile/local-changes',
      '/api/data/data-leads/discard-local-changes',
      '/api/data/data-reports/conflict-diff',
      '/api/data/data-docs/write-resolved',
      '/api/data/data-rollouts/clear-dir',
    ]);
  });

  it('without repoId the old data-tier-0 path stays (backwards compatibility)', async () => {
    const seen = _captureFetch();
    await fetchLocalChanges();
    await discardLocalChanges();
    await fetchConflictDiff();
    for (const s of seen) {
      assert.match(s.url, /^\/api\/data-tier-0\//, `${s.url} powinno zostac na starej sciezce`);
    }
  });

  it('repairDetachedHeadUrl rozroznia oba warianty', () => {
    assert.equal(repairDetachedHeadUrl('data-support'), '/api/data/data-support/repair-detached-head');
    assert.equal(repairDetachedHeadUrl(), '/api/data-tier-0/repair-detached-head');
  });
});

describe('no call loses repoId', () => {
  // The exact defect: a call with an empty argument list. A signature that
  // accepts repoId proves nothing if the call site never passes it.
  const CALLERS = ['js/store-conflict-resolver.js', 'js/local-changes-modal.js'];
  const GUARDED = ['fetchConflictDiff', 'writeResolved', 'fetchLocalChanges', 'discardLocalChanges'];

  for (const rel of CALLERS) {
    it(`${rel} calls every data function with an argument`, () => {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      for (const fn of GUARDED) {
        // `fn()` with nothing between the parens is the bug; `fn(...)` is fine.
        const bare = new RegExp(`(?<![\\w.])${fn}\\s*\\(\\s*\\)`, 'g');
        assert.equal(src.match(bare), null,
          `${rel}: ${fn}() called without repoId - it would hit data-tier-0 whatever source was clicked`);
      }
    });
  }

  it('writeResolved gets repoId as its second argument, not only the files', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/store-conflict-resolver.js'), 'utf8');
    const calls = src.match(/writeResolved\s*\([^)]*\)/g) || [];
    assert.ok(calls.length > 0, 'expected at least one writeResolved call');
    for (const c of calls) {
      assert.match(c, /,/, `${c} - missing second argument (repoId)`);
    }
  });
});
