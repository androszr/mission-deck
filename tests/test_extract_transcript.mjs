// tests/test_extract_transcript.mjs
// scripts/extract-transcript.js: the two halves that can silently produce a
// wrong document - the Polish-to-ASCII slug and the JSON transcript flattener -
// plus the .docx unzip path, exercised against a ZIP built in the test.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ex = require(path.join(ROOT, 'scripts', 'extract-transcript.js'));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'transcript-'));

test('slugify transliterates Polish letters and caps at 60 chars', () => {
  assert.strictEqual(ex.slugify('Przeglad sprintu'), 'przeglad-sprintu');
  assert.strictEqual(ex.slugify('Zakonczenie sesji UX'), 'zakonczenie-sesji-ux');
  // Every Polish diacritic maps to its ASCII base, including l-stroke.
  assert.strictEqual(ex.slugify('Łączność żywności'), 'laczosc-zywnosci'.replace('laczosc', 'lacznosc'));
  assert.strictEqual(ex.slugify('  --Temat--  '), 'temat');
  const long = ex.slugify('a'.repeat(80));
  assert.ok(long.length <= 60);
  assert.strictEqual(ex.slugify(''), '');
});

test('a JSON transcript flattens to speaker: text lines', () => {
  const file = path.join(TMP, 't.json');
  fs.writeFileSync(file, JSON.stringify({
    segments: [
      { speaker: 'Ala', text: 'Zaczynamy.' },
      { speakerName: { name: 'Sam' }, content: 'Zgoda.' },
      { text: '   ' },
      { note: 'ignored - no text field' },
    ],
  }));
  assert.strictEqual(ex.extract(file), 'Ala: Zaczynamy.\nSam: Zgoda.');
});

test('an unrecognised JSON shape falls back to pretty-printed JSON', () => {
  const file = path.join(TMP, 'other.json');
  fs.writeFileSync(file, JSON.stringify({ meeting: 'x' }));
  assert.ok(ex.extract(file).includes('"meeting"'));
});

test('a .docx is unzipped and stripped to plain text', () => {
  // Minimal ZIP with one deflated member: word/document.xml
  const name = Buffer.from('word/document.xml');
  const xml = Buffer.from('<w:p><w:r><w:t>Punkt &amp; wniosek</w:t></w:r></w:p><w:p><w:t>Druga linia</w:t></w:p>');
  const deflated = zlib.deflateRawSync(xml);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);            // method: deflate
  local.writeUInt32LE(deflated.length, 18);
  local.writeUInt32LE(xml.length, 22);
  local.writeUInt16LE(name.length, 26);
  const localAll = Buffer.concat([local, name, deflated]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(deflated.length, 20);
  central.writeUInt32LE(xml.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);         // local header offset
  const centralAll = Buffer.concat([central, name]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralAll.length, 12);
  eocd.writeUInt32LE(localAll.length, 16);

  const file = path.join(TMP, 'notes.docx');
  fs.writeFileSync(file, Buffer.concat([localAll, centralAll, eocd]));

  const text = ex.extract(file);
  assert.ok(text.includes('Punkt & wniosek'), 'entities are decoded');
  assert.ok(text.includes('Druga linia'), 'every paragraph survives');
  assert.ok(!text.includes('<w:'), 'no markup leaks into the transcript');
});

test('topSection captures the template purpose block, not the body', () => {
  const tpl = [
    '---', 'title: x', '---', '',
    '# Template: Status update',
    '> Purpose: status.',
    '> When NOT to use: decisions.',
    '',
    '---',
    '',
    '# Status update: {Temat}',
    'Body that must not be part of the selector input.',
  ].join('\n');
  const top = ex.topSection(tpl);
  assert.ok(top.includes('Purpose'));
  assert.ok(top.includes('When NOT to use'));
  assert.ok(!top.includes('Body that must not'));
});

test('listTemplates reads the shipped meeting templates', () => {
  const tpls = ex.listTemplates();
  assert.ok(tpls.length >= 8, 'templates/meeting-notes/ ships eight meeting types');
  for (const t of tpls) {
    assert.ok(t.name && t.path.endsWith('.template.md'));
    assert.strictEqual(typeof t.topSection, 'string');
  }
});
