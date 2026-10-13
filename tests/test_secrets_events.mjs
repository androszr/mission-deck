// Unit tests for js/secrets-events.js - the one-event bus that tells every
// credential-derived slot (top bar avatar, "Aktywni" chip, Keys cards) to
// re-derive itself after a Bitwarden unlock.
// Run: node --test tests/test_secrets_events.mjs
//
// The module reads `globalThis.document` at CALL time, never at import time,
// which is what lets a plain Node process stand in an EventTarget for it.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  SECRETS_CHANGED_EVENT,
  emitSecretsChanged,
  onSecretsChanged,
} from '../js/secrets-events.js';

afterEach(() => { delete globalThis.document; });

describe('secrets-events', () => {
  it('names the event with an ASCII id', () => {
    assert.equal(SECRETS_CHANGED_EVENT, 'cockpit:secrets-changed');
    assert.match(SECRETS_CHANGED_EVENT, /^[\x20-\x7e]+$/);
  });

  it('delivers the event to every subscriber, with its detail', () => {
    globalThis.document = new EventTarget();
    const seen = [];
    onSecretsChanged(ev => seen.push('a:' + ev.detail.reason));
    onSecretsChanged(ev => seen.push('b:' + ev.detail.reason));

    emitSecretsChanged({ reason: 'unlock' });

    assert.deepEqual(seen, ['a:unlock', 'b:unlock']);
  });

  it('defaults the detail to an empty object rather than undefined', () => {
    globalThis.document = new EventTarget();
    let detail = 'not-called';
    onSecretsChanged(ev => { detail = ev.detail; });
    emitSecretsChanged();
    assert.deepEqual(detail, {});
  });

  it('stops delivering once the returned unsubscribe runs', () => {
    globalThis.document = new EventTarget();
    let calls = 0;
    const off = onSecretsChanged(() => { calls += 1; });
    emitSecretsChanged({ reason: 'unlock' });
    off();
    emitSecretsChanged({ reason: 'refresh-secrets' });
    assert.equal(calls, 1);
  });

  it('is a no-op without a browser document instead of throwing', () => {
    // Imported by modules a unit test loads under plain Node; a throw here
    // would turn "no browser" into a failing suite.
    assert.doesNotThrow(() => emitSecretsChanged({ reason: 'unlock' }));
    const off = onSecretsChanged(() => { throw new Error('never called'); });
    assert.equal(typeof off, 'function');
    assert.doesNotThrow(off);
  });
});
