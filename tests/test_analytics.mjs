// Unit tests for js/analytics.js pure helpers + no-op safety contract.
// Run: node --test tests/test_analytics.mjs
//
// js/analytics.js deliberately has zero `import` statements and touches
// window/document only inside function bodies (the one top-level read is
// guarded by `typeof window !== 'undefined'`), so the module is importable
// under plain Node with no document. See the js/analytics.js module header.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeApiPath, trackEvent, initAnalytics } from '../js/analytics.js';

describe('normalizeApiPath — collapses ids, strips query/hash, caps segments', () => {
  it('handles the documented input/output pairs from the plan', () => {
    // Plain path with no id-like segments: kept verbatim (first three segments rule).
    assert.equal(
      normalizeApiPath('/api/modules/manifest'),
      '/api/modules/manifest',
    );

    // Jira-key id segment (PROJ-1234) + cache-bust ?t= query: id collapsed, query stripped.
    assert.equal(
      normalizeApiPath('/api/jira/issue-detail/PROJ-1234/comments?t=1699'),
      '/api/jira/issue-detail/:id/comments',
    );

    // Numeric id segment.
    assert.equal(
      normalizeApiPath('/api/docs/read/12345/meta'),
      '/api/docs/read/:id/meta',
    );

    // Absolute URL input (fetch() may be called with a full URL, not just a path).
    assert.equal(
      normalizeApiPath('http://localhost:3001/api/modules/456?t=1'),
      '/api/modules/:id',
    );

    // Query string alone, no id-like segment, still stripped.
    assert.equal(
      normalizeApiPath('/api/app/version?t=1699999999'),
      '/api/app/version',
    );
  });
});

describe('trackEvent / initAnalytics — no-op-safe before init and without window.amplitude', () => {
  it('trackEvent called before initAnalytics() returns without throwing', () => {
    assert.doesNotThrow(() => {
      const result = trackEvent('Test Event', { foo: 'bar' });
      assert.equal(result, undefined);
    });
  });

  it('initAnalytics() does not throw when window/amplitude are absent (plain Node env)', () => {
    assert.doesNotThrow(() => initAnalytics());
    // Still a no-op afterwards -- no SDK ever appeared, so trackEvent stays silent.
    assert.doesNotThrow(() => {
      const result = trackEvent('Test Event 2', {});
      assert.equal(result, undefined);
    });
  });
});

// Regression guard for a real defect: trackEvent() used to be a hard
// `if (!_ready) return;` no-op. Because js/app.js calls initAnalytics() and the
// boot navigate() in the SAME synchronous tick -- and the SDK attaches its
// transport asynchronously -- the first "View Viewed" of EVERY session was
// silently dropped. It must now fall through to the bounded pre-init buffer
// (window.__cockpitTrack, filled by js/theme-boot.js, drained by
// _drainBufferedQueue() once the transport is live).
//
// This is deliberately covered here rather than in the browser: the boot event
// is sent before any page-context instrumentation can attach, so Playwright can
// only establish it indirectly. The not-ready branch is exactly a unit-test job.
describe('trackEvent — buffers instead of dropping when the SDK is not ready yet', () => {
  it('hands the event to window.__cockpitTrack while not ready', () => {
    const calls = [];
    const priorWindow = globalThis.window;
    // No `amplitude` on this fake window -> trackEvent must take the not-ready path.
    globalThis.window = { __cockpitTrack: (name, props) => { calls.push([name, props]); } };
    try {
      const result = trackEvent('View Viewed', { view: 'dashboard' });
      assert.equal(result, undefined);
      assert.equal(calls.length, 1, 'not-ready trackEvent must buffer, not drop');
      assert.deepEqual(calls[0], ['View Viewed', { view: 'dashboard' }]);
    } finally {
      if (priorWindow === undefined) delete globalThis.window;
      else globalThis.window = priorWindow;
    }
  });

  it('stays silent (never throws) when even the buffer is missing', () => {
    const priorWindow = globalThis.window;
    globalThis.window = {};
    try {
      assert.doesNotThrow(() => trackEvent('View Viewed', { view: 'x' }));
    } finally {
      if (priorWindow === undefined) delete globalThis.window;
      else globalThis.window = priorWindow;
    }
  });
});
