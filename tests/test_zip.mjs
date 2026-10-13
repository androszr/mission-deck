// tests/test_zip.mjs
// Unit tests for scripts/zip.js: writer, reader, limits, isSafeEntryName.
// Pure, no server (node --test).

import { createRequire } from 'node:module';
import assert from 'node:assert';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { writeZip, readZip, crc32, isSafeEntryName } = require('../scripts/zip.js');

test('round-trip STORE method on uncompressible data', () => {
  const data = require('crypto').randomBytes(2048);
  const buf = writeZip([{ name: 'random.bin', data }]);
  const entries = readZip(buf, { maxEntries: 10, maxFileBytes: 10000, maxTotalBytes: 10000 });
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].name, 'random.bin');
  assert.ok(Buffer.compare(entries[0].data, data) === 0, 'data must round-trip byte for byte');
});

test('round-trip DEFLATE method on compressible data', () => {
  const data = Buffer.from('a'.repeat(20000));
  const buf = writeZip([{ name: 'compressible.txt', data }]);
  const entries = readZip(buf, { maxEntries: 10, maxFileBytes: 30000, maxTotalBytes: 30000 });
  assert.strictEqual(entries.length, 1);
  assert.ok(buf.length < data.length, 'archive must be smaller than the original for compressible data');
  assert.strictEqual(entries[0].data.toString(), data.toString());
});

test('writeZip works without an explicit mtime', () => {
  const buf = writeZip([{ name: 'no-mtime.txt', data: Buffer.from('hi') }]);
  const entries = readZip(buf, { maxEntries: 10, maxFileBytes: 100, maxTotalBytes: 100 });
  assert.strictEqual(entries[0].data.toString(), 'hi');
});

test('crc32 matches the known test vector', () => {
  assert.strictEqual(crc32(Buffer.from('123456789')), 0xCBF43926);
});

test('readZip throws when maxEntries is exceeded', () => {
  const buf = writeZip([
    { name: 'a.txt', data: Buffer.from('a') },
    { name: 'b.txt', data: Buffer.from('b') },
  ]);
  assert.throws(() => readZip(buf, { maxEntries: 1, maxFileBytes: 100, maxTotalBytes: 100 }));
});

test('readZip throws when maxFileBytes is exceeded', () => {
  const buf = writeZip([{ name: 'big.txt', data: Buffer.from('x'.repeat(1000)) }]);
  assert.throws(() => readZip(buf, { maxEntries: 10, maxFileBytes: 10, maxTotalBytes: 10000 }));
});

test('readZip throws when maxTotalBytes is exceeded', () => {
  const buf = writeZip([
    { name: 'a.txt', data: Buffer.from('x'.repeat(600)) },
    { name: 'b.txt', data: Buffer.from('x'.repeat(600)) },
  ]);
  assert.throws(() => readZip(buf, { maxEntries: 10, maxFileBytes: 1000, maxTotalBytes: 1000 }));
});

test('readZip throws a readable message on a corrupt EOCD', () => {
  const buf = Buffer.from('this is not a zip archive at all');
  assert.throws(
    () => readZip(buf, { maxEntries: 10, maxFileBytes: 100, maxTotalBytes: 100 }),
    /EOCD/,
  );
});

test('readZip throws on an unknown compression method', () => {
  const buf = writeZip([{ name: 'a.txt', data: Buffer.from('hello') }]);
  // Corrupt the compression method field of the local header (offset 8) and
  // the matching central-directory method field to an unsupported value (99).
  const patched = Buffer.from(buf);
  patched.writeUInt16LE(99, 8);
  const centralMethodOffset = patched.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 10;
  patched.writeUInt16LE(99, centralMethodOffset);
  assert.throws(
    () => readZip(patched, { maxEntries: 10, maxFileBytes: 100, maxTotalBytes: 100 }),
    /unsupported compression method/,
  );
});

test('isSafeEntryName accepts plain relative paths', () => {
  assert.strictEqual(isSafeEntryName('a/b.txt'), true);
  assert.strictEqual(isSafeEntryName('module.json'), true);
});

test('isSafeEntryName rejects traversal, absolute paths and windows drives', () => {
  assert.strictEqual(isSafeEntryName('../x'), false);
  assert.strictEqual(isSafeEntryName('a/../../x'), false);
  assert.strictEqual(isSafeEntryName('/etc/passwd'), false);
  assert.strictEqual(isSafeEntryName('C:\\x'), false);
  assert.strictEqual(isSafeEntryName('a\\b'), false);
  assert.strictEqual(isSafeEntryName(''), false);
});

// Regression: a zip bomb declares a small uncompressed size and inflates to
// gigabytes. Every size check in readZip trusts that declared number, so the
// decompression call itself has to carry the cap - otherwise the allocation
// happens first and the mismatch is noticed too late to matter.
test('readZip refuses an entry that lies about its uncompressed size', () => {
  const zlib = require('zlib');
  // 40 MB of zeros compresses to a few KB and would otherwise inflate in full.
  const bomb = Buffer.alloc(40 * 1024 * 1024, 0);
  const honest = writeZip([{ name: 'payload.bin', data: bomb }]);

  // Rewrite both copies of the uncompressed size (local header + central
  // directory) to a small lie, so no pre-inflate check can catch it.
  const patched = Buffer.from(honest);
  const lie = 1024;
  let patchedCount = 0;
  for (let i = 0; i + 4 <= patched.length; i++) {
    if (patched.readUInt32LE(i) === bomb.length) { patched.writeUInt32LE(lie, i); patchedCount++; }
  }
  assert.ok(patchedCount >= 2, 'expected to patch the local header and the central directory');

  assert.throws(
    () => readZip(patched, { maxEntries: 10, maxFileBytes: 64 * 1024, maxTotalBytes: 128 * 1024 }),
    /exceeds maxFileBytes when decompressed|could not be decompressed|size mismatch/,
  );
});

test('readZip still round-trips a deflated entry that fits under the cap', () => {
  const data = Buffer.alloc(200 * 1024, 7);
  const buf = writeZip([{ name: 'ok.bin', data }]);
  const out = readZip(buf, { maxEntries: 10, maxFileBytes: 1024 * 1024, maxTotalBytes: 1024 * 1024 });
  assert.strictEqual(out.length, 1);
  assert.ok(out[0].data.equals(data));
});
