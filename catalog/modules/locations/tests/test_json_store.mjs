// locations/tests/test_json_store.mjs
// json-store.js: readJsonSafe, mtimeOf, stripVolatile, writeJsonIfChanged.
// Every write happens inside a per-test os.tmpdir() directory, never near
// data-sub-repositories/.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const js = require(path.join(DIR, 'server', 'json-store.js'));

function tmpFile(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'locations-json-store-'));
  return path.join(dir, name || 'data.json');
}

test('readJsonSafe: null on a missing file, on unparsable JSON, and on a non-object result - never throws', () => {
  assert.equal(js.readJsonSafe(tmpFile()), null);
  const badFile = tmpFile();
  fs.writeFileSync(badFile, 'not json');
  assert.equal(js.readJsonSafe(badFile), null);
  const arrayFile = tmpFile();
  fs.writeFileSync(arrayFile, '"just a string"');
  assert.equal(js.readJsonSafe(arrayFile), null);
});

test('mtimeOf: 0 for a missing file, a positive number for an existing one', () => {
  assert.equal(js.mtimeOf(tmpFile()), 0);
  const file = tmpFile();
  fs.writeFileSync(file, '{}');
  assert.ok(js.mtimeOf(file) > 0);
});

test('stripVolatile: removes only the four volatile metadata keys, leaves everything else', () => {
  const payload = {
    metadata: { updated_at: 'a', generated_at: 'b', created_at: 'c', source_file_modified_at: 'd', dataset: 'x', row_count: 3 },
    rows: [1, 2, 3],
  };
  const out = js.stripVolatile(payload);
  assert.deepEqual(out.metadata, { dataset: 'x', row_count: 3 });
  assert.deepEqual(out.rows, [1, 2, 3]);
  // the original payload is untouched
  assert.equal(payload.metadata.updated_at, 'a');
});

test('writeJsonIfChanged: first write reports written and creates the file', () => {
  const file = tmpFile();
  const result = js.writeJsonIfChanged(file, { metadata: { updated_at: 't1', dataset: 'x' }, rows: [1] });
  assert.equal(result.status, 'written');
  assert.ok(fs.existsSync(file));
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).rows, [1]);
});

test('writeJsonIfChanged: a second write that differs only by a volatile timestamp reports unchanged and does not touch mtime', () => {
  const file = tmpFile();
  js.writeJsonIfChanged(file, { metadata: { updated_at: 't1', dataset: 'x' }, rows: [1] });
  const mtimeBefore = fs.statSync(file).mtimeMs;
  const result = js.writeJsonIfChanged(file, { metadata: { updated_at: 't2', dataset: 'x' }, rows: [1] });
  assert.equal(result.status, 'unchanged');
  assert.equal(fs.statSync(file).mtimeMs, mtimeBefore);
  // the file on disk still carries the FIRST write's timestamp - a
  // no-op import never overwrites even the volatile field.
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).metadata.updated_at, 't1');
});

test('writeJsonIfChanged: a real content change reports written', () => {
  const file = tmpFile();
  js.writeJsonIfChanged(file, { metadata: { updated_at: 't1', dataset: 'x' }, rows: [1] });
  const result = js.writeJsonIfChanged(file, { metadata: { updated_at: 't2', dataset: 'x' }, rows: [1, 2] });
  assert.equal(result.status, 'written');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).rows, [1, 2]);
});

test('writeJsonIfChanged: no .tmp.* file is left behind after a write', () => {
  const file = tmpFile();
  js.writeJsonIfChanged(file, { metadata: { updated_at: 't1' }, rows: [1] });
  const dir = path.dirname(file);
  const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.tmp.'));
  assert.deepEqual(leftovers, []);
});

test('writeJsonIfChanged: creates the destination directory when it does not exist yet', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'locations-json-store-'));
  const file = path.join(base, 'nested', 'dir', 'data.json');
  const result = js.writeJsonIfChanged(file, { metadata: { updated_at: 't1' }, rows: [] });
  assert.equal(result.status, 'written');
  assert.ok(fs.existsSync(file));
});
