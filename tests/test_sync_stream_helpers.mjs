// tests/test_sync_stream_helpers.mjs
// The transport-death branch of the two EventSource runners. The decision is
// pure (js/sync-stream-helpers.mjs) and read directly; the runners themselves
// touch `document` at import time, so their wiring is pinned as source text,
// the same technique as tests/test_module_sync_bar.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectionLostOutcome, streamErrorPayload } from '../js/sync-stream-helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('connectionLostOutcome tells the two states apart and never claims success', () => {
  const inFlight = connectionLostOutcome(true);
  assert.equal(inFlight.ok, false);
  assert.equal(inFlight.error, 'connection-lost');
  assert.match(inFlight.message, /^Connection lost — the operation continues on the server/);
  assert.match(inFlight.message, /Sync window/);

  const neverStarted = connectionLostOutcome(false);
  assert.equal(neverStarted.ok, false);
  assert.equal(neverStarted.error, 'connection-lost');
  assert.match(neverStarted.message, /^Could not connect to the server — the operation was not started\./);
  assert.notEqual(inFlight.message, neverStarted.message);
});

test('streamErrorPayload reads a server-sent error and answers null for a transport death', () => {
  assert.deepEqual(streamErrorPayload({ data: '{"error":"locked","message":"x"}' }), { error: 'locked', message: 'x' });
  assert.equal(streamErrorPayload({}), null, 'a bare network error carries no data');
  assert.equal(streamErrorPayload(null), null);
  assert.equal(streamErrorPayload({ data: '' }), null);
  assert.equal(streamErrorPayload({ data: 'not json' }), null);
  assert.equal(streamErrorPayload({ data: '"a string"' }), null, 'a non-object payload is not an error body');
});

for (const file of ['js/sub-repo-sync-stream.js', 'js/data-tier-0-sync.js']) {
  test(`${file} closes the EventSource on a transport death and reports through connectionLostOutcome`, () => {
    const src = read(file);
    assert.match(src, /import \{ connectionLostOutcome, streamErrorPayload \} from '\.\/sync-stream-helpers\.mjs';/);
    // The branch: no payload -> es.close() BEFORE the finish, so the browser
    // can never re-issue the mutating GET; the sentence comes from the helper.
    const branch = /es\.close\(\);\s*\n\s*_?finish\(connectionLostOutcome\(_?opened\)\);/;
    assert.match(src, branch, 'close first, then finish with the shared outcome');
    // The old guard is gone: a CONNECTING readyState used to fall through and
    // let the browser reconnect a push.
    assert.doesNotMatch(src, /readyState === EventSource\.CLOSED/, 'no readyState gate on the error branch');
    // `open` is what separates the two sentences.
    assert.match(src, /addEventListener\('open', (?:function \(\) \{ opened = true; \}|\(\) => \{ _opened = true; \})\)/);
  });
}
