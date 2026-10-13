// tests/test_topbar_mr_helpers.mjs
// Pure decisions behind the top-bar "MR:" chips (js/topbar-mr-helpers.mjs).
// Real ESM import, no server, no document. The painter in js/topbar.js is
// deliberately untested, like the rest of that file.

import { test } from 'node:test';
import assert from 'node:assert';

import { mrRowsToPaint, mrChipState } from '../js/topbar-mr-helpers.mjs';

const URL = 'https://gitlab.example.com/your-group/mission-deck-modules/-/merge_requests';

test('mrRowsToPaint: no payload, no repos, garbage -> nothing to paint', () => {
  assert.deepStrictEqual(mrRowsToPaint(null), []);
  assert.deepStrictEqual(mrRowsToPaint(undefined), []);
  assert.deepStrictEqual(mrRowsToPaint({}), []);
  assert.deepStrictEqual(mrRowsToPaint({ repos: 'x' }), []);
  assert.deepStrictEqual(mrRowsToPaint({ repos: [null, 1, 'a'] }), []);
});

test('mrRowsToPaint: a row without a token is dropped, every other row stays in server order', () => {
  const rows = [
    { key: 'modules', label: 'Module catalog', count: null, error: 'no_token' },
    { key: 'app', label: 'Aplikacja', count: 2 },
    { key: 'kb', label: 'Baza wiedzy', count: null, error: 'gitlab_error' },
  ];
  assert.deepStrictEqual(mrRowsToPaint({ ok: true, repos: rows }).map(r => r.key), ['app', 'kb']);
  // The fresh-install state: one row, no token -> the slot stays empty.
  assert.deepStrictEqual(mrRowsToPaint({ ok: true, repos: [rows[0]] }), []);
});

test('mrChipState: a count of one or more is red and says how many wait', () => {
  const s = mrChipState({ label: 'Module catalog', shortLabel: 'KM', count: 3, webUrl: URL });
  assert.strictEqual(s.text, 'KM 3');
  // The tooltip spells the repository out; the chip only has room for "KM".
  assert.match(s.title, /Module catalog/);
  assert.strictEqual(s.tone, 'red');
  assert.strictEqual(s.href, URL);
  assert.match(s.title, /3 to review/);
  assert.match(s.title, /opens GitLab/);
});

test('mrChipState: zero is gray and says nothing is waiting', () => {
  const s = mrChipState({ label: 'Module catalog', shortLabel: 'KM', count: 0, webUrl: URL });
  assert.strictEqual(s.text, 'KM 0');
  assert.strictEqual(s.tone, 'gray');
  assert.match(s.title, /^No open merge requests/);
});

test('mrChipState: a GitLab failure paints "-" in gray and names the failure', () => {
  const s = mrChipState({ label: 'Module catalog', shortLabel: 'KM', count: null, error: 'gitlab_error', webUrl: URL });
  assert.strictEqual(s.text, 'KM -');
  assert.strictEqual(s.tone, 'gray');
  assert.match(s.title, /GitLab did not respond/);
  // The link still works: GitLab being down for the API is not GitLab being
  // down for the browser, and the person may well want to look.
  assert.strictEqual(s.href, URL);
});

test('mrChipState: only an https webUrl becomes a link', () => {
  assert.strictEqual(mrChipState({ label: 'X', count: 1, webUrl: '' }).href, null);
  assert.strictEqual(mrChipState({ label: 'X', count: 1, webUrl: 'javascript:alert(1)' }).href, null);
  assert.strictEqual(mrChipState({ label: 'X', count: 1, webUrl: 'http://gitlab.local/x' }).href, null);
  assert.strictEqual(mrChipState({ label: 'X', count: 1 }).href, null);
  assert.doesNotMatch(mrChipState({ label: 'X', count: 1 }).title, /opens GitLab/);
});

test('mrChipState: a missing shortLabel falls back to the label, a missing label to "MR", a bad count to "-"', () => {
  assert.strictEqual(mrChipState({ label: 'Module catalog', count: 1 }).text, 'Module catalog 1');
  assert.strictEqual(mrChipState({ label: 'Module catalog', shortLabel: ' ', count: 1 }).text, 'Module catalog 1');
  assert.strictEqual(mrChipState({ count: 1 }).text, 'MR 1');
  assert.strictEqual(mrChipState({ label: '  ', count: 1 }).text, 'MR 1');
  assert.strictEqual(mrChipState({ label: 'X', count: -1 }).text, 'X -');
  assert.strictEqual(mrChipState({ label: 'X', count: '4' }).text, 'X -');
  assert.strictEqual(mrChipState({ label: 'X', count: NaN }).text, 'X -');
  assert.strictEqual(mrChipState(null).text, 'MR -');
  assert.strictEqual(mrChipState(null).tone, 'gray');
});
