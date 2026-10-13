// tests/test_sync_file_list.mjs
// Pure-function pins for js/sync-file-list.js: the shared per-file row
// renderer js/topbar-sync-preview.js and js/module-sync-bar.js both use, so
// the two per-file lists in the app can never drift.

import test from 'node:test';
import assert from 'node:assert';
import { formatSyncDate, syncNewerByLabel, syncFileRowHtml } from '../js/sync-file-list.js';

test('formatSyncDate returns null for a falsy or unparsable input', () => {
  assert.strictEqual(formatSyncDate(null), null);
  assert.strictEqual(formatSyncDate(''), null);
  assert.strictEqual(formatSyncDate('not-a-date'), null);
});

test('formatSyncDate formats an ISO date as dd.mm.yyyy, hh:mm', () => {
  const out = formatSyncDate('2026-01-05T09:03:00.000Z');
  assert.match(out, /^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/);
});

test('syncNewerByLabel is null when either date is missing', () => {
  assert.strictEqual(syncNewerByLabel(null, '2026-01-01T00:00:00Z'), null);
  assert.strictEqual(syncNewerByLabel('2026-01-01T00:00:00Z', null), null);
});

test('syncNewerByLabel is null when the local copy is not newer', () => {
  assert.strictEqual(syncNewerByLabel('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'), null);
});

test('syncNewerByLabel is null under the one-hour noise threshold', () => {
  const local = new Date('2026-01-01T00:30:00Z').toISOString();
  const remote = new Date('2026-01-01T00:00:00Z').toISOString();
  assert.strictEqual(syncNewerByLabel(local, remote), null);
});

test('syncNewerByLabel reports hours under a day, days at and beyond it', () => {
  const base = new Date('2026-01-02T00:00:00Z').getTime();
  const local3h = new Date(base + 3 * 60 * 60 * 1000).toISOString();
  const remote = new Date(base).toISOString();
  assert.strictEqual(syncNewerByLabel(local3h, remote), 'newer by 3 h');

  const local2d = new Date(base + 48 * 60 * 60 * 1000).toISOString();
  assert.strictEqual(syncNewerByLabel(local2d, remote), 'newer by 2 days');
});

test('syncFileRowHtml renders a brand-new file as "none (new file)" with no newer-by hint', () => {
  const html = syncFileRowHtml({ path: 'team/team-members.json', localAt: '2026-01-01T00:00:00Z', onRemote: false, remoteAt: null });
  assert.match(html, /none \(new file\)/);
  assert.doesNotMatch(html, /tsp-newer/);
});

test('syncFileRowHtml escapes the path and shows both dates for a normal file', () => {
  const html = syncFileRowHtml({ path: '<script>x', localAt: '2026-01-02T00:00:00Z', onRemote: true, remoteAt: '2026-01-01T00:00:00Z' });
  assert.doesNotMatch(html, /<script>x/);
  assert.match(html, /&lt;script&gt;x/);
  assert.match(html, /local/);
  assert.match(html, /on the server/);
});

test('syncFileRowHtml falls back to a placeholder for a null path', () => {
  const html = syncFileRowHtml({ path: null, localAt: null, onRemote: true, remoteAt: null });
  assert.match(html, /unknown path/);
});
