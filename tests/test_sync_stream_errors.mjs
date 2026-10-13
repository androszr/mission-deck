// Unit tests for js/sub-repo-sync-stream.js's pure error-handling surface:
// formatSyncStreamError (server error category -> Polish message) and
// buildSyncErrorActions (which recovery buttons render for which category).
// Run: node --test tests/test_sync_stream_errors.mjs
//
// js/sub-repo-sync-stream.js pulls in js/toast.js, js/sync-log-modal.js,
// js/store-conflict-resolver.js, js/analytics.js and js/ds-modal.js, but none
// of them touch `document`/`window` at module scope - every document access lives
// inside a function body, so importing the module under plain Node (no document,
// no jsdom) is safe as long as we never invoke a handler that would.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { formatSyncStreamError, buildSyncErrorActions } from '../js/sub-repo-sync-stream.js';

// The full taxonomy the backend contract promises (server.js classifyGitError
// plus the five encryption error codes from Phase C).
const ALL_CATEGORIES = [
  'not-configured', 'no-write-token', 'network', 'auth-expired', 'no-access',
  'timeout', 'conflict', 'conflict-markers', 'detached-head', 'locked',
  'rejected', 'aborted', 'abort-would-lose', 'no-repo-url', 'ssh-url',
  'fs-error', 'error',
  'key-missing', 'key-invalid', 'decrypt-failed', 'decrypt-destructive', 'encrypt-failed',
];

describe('formatSyncStreamError', () => {
  it('gives every documented category a non-empty Polish message', () => {
    for (const error of ALL_CATEGORIES) {
      const msg = formatSyncStreamError({ error });
      assert.equal(typeof msg, 'string');
      assert.ok(msg.length > 0, `category "${error}" produced an empty message`);
    }
  });

  it('all five encryption categories are wired (AC15)', () => {
    const encryptionCategories = ['key-missing', 'key-invalid', 'decrypt-failed', 'decrypt-destructive', 'encrypt-failed'];
    for (const error of encryptionCategories) {
      const msg = formatSyncStreamError({ error });
      assert.notEqual(msg, 'Unknown error.');
    }
  });

  it('prefers a server-supplied message when one is present', () => {
    const msg = formatSyncStreamError({ error: 'conflict', message: 'A message from the server' });
    assert.equal(msg, 'A message from the server');
  });

  it('an unknown category falls back to a safe default sentence', () => {
    const msg = formatSyncStreamError({ error: 'totally-unknown-category-xyz' });
    assert.equal(msg, 'Unknown error.');
  });

  it('an unknown category with a server message still surfaces that message', () => {
    const msg = formatSyncStreamError({ error: 'totally-unknown-category-xyz', message: 'Something went wrong' });
    assert.equal(msg, 'Something went wrong');
  });

  it('locked formats the remaining lock time instead of a static sentence', () => {
    const msg = formatSyncStreamError({ error: 'locked', lockAgeMs: 0, lockMaxMs: 600000 });
    assert.match(msg, /lock expires/);
  });
});

describe('buildSyncErrorActions', () => {
  it('returns no actions for a successful result', () => {
    assert.deepEqual(buildSyncErrorActions({ ok: true }, {}), []);
  });

  it('conflict yields exactly two actions: merge and overwrite', () => {
    const actions = buildSyncErrorActions({ ok: false, error: 'conflict' }, { repoBase: 'data-tier-0' });
    assert.equal(actions.length, 2);
    assert.deepEqual(actions.map(a => a.label), ['Merge remote changes', 'Overwrite my changes']);
  });

  it('rejected behaves like conflict (same two actions)', () => {
    const actions = buildSyncErrorActions({ ok: false, error: 'rejected' }, { repoBase: 'data-tier-0' });
    assert.deepEqual(actions.map(a => a.label), ['Merge remote changes', 'Overwrite my changes']);
  });

  it('conflict-markers yields "Accept remote" and "Cancel merge", never an AI action', () => {
    const actions = buildSyncErrorActions({ ok: false, error: 'conflict-markers' }, { repoBase: 'data-tier-0' });
    assert.deepEqual(actions.map(a => a.label), ['Accept remote', 'Cancel merge']);
    assert.ok(!actions.some(a => /AI/i.test(a.label)), 'no action label may mention AI');
  });

  it('autostash-conflict offers both sides explicitly - mine and the team\'s - and neither is marked as danger', () => {
    const actions = buildSyncErrorActions({ ok: false, error: 'autostash-conflict' }, { repoBase: 'data/data-rollouts' });
    assert.deepEqual(actions.map(a => a.label), ['Keep my versions', 'Take the team versions']);
    assert.ok(actions.every(a => !a.danger), 'the other version stays in the stash either way');
  });

  it('autostash-conflict has a Polish fallback sentence when the server sent no message', () => {
    assert.match(formatSyncStreamError({ error: 'autostash-conflict' }), /nothing was sent or overwritten/);
  });

  it('detached-head renders no action when no repair URL is supplied', () => {
    const actions = buildSyncErrorActions({ ok: false, error: 'detached-head' }, { repoBase: 'data-tier-0' });
    assert.deepEqual(actions, []);
  });

  it('detached-head renders exactly one action when a repair URL is supplied', () => {
    const actions = buildSyncErrorActions(
      { ok: false, error: 'detached-head' },
      { repoBase: 'data-tier-0', repairDetachedHeadUrl: '/api/data-tier-0/repair-detached-head' },
    );
    assert.equal(actions.length, 1);
    assert.equal(actions[0].label, 'Repair branch');
  });

  it('a plain network/error failure offers a single merge action', () => {
    const actions = buildSyncErrorActions({ ok: false, error: 'network' }, { repoBase: 'data-tier-0' });
    assert.deepEqual(actions.map(a => a.label), ['Merge remote changes']);
  });

  it('an unrecognized error category renders no actions rather than throwing', () => {
    const actions = buildSyncErrorActions({ ok: false, error: 'key-missing' }, { repoBase: 'data-tier-0' });
    assert.deepEqual(actions, []);
  });
});
