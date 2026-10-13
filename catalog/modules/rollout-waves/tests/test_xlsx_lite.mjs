// rollout-waves/tests/test_xlsx_lite.mjs
// The XLSX parser, against fixtures built IN MEMORY with scripts/zip.js's
// writeZip - no binary fixture file in the repo: parseFirstSheet and
// codesFromColumnA, which the two confirmation imports use.

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
import { APP_ROOT as ROOT } from './_root.mjs';
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { readZip, writeZip } = require(path.join(ROOT, 'scripts', 'zip.js'));
const xlsxLite = require(path.join(DIR, 'server', 'xlsx-lite.js'));

const LIMITS = { maxEntries: 64, maxFileBytes: 64 * 1024 * 1024, maxTotalBytes: 128 * 1024 * 1024 };

/**
 * Builds a minimal .xlsx buffer around one worksheet, with an optional
 * sharedStrings table and an optional non-default sheet target (to exercise
 * the workbook.xml.rels resolution). No binary fixture ever touches disk.
 * @param {{sheetXml: string, sharedStringsXml?: string, sheetTarget?: string}} opts
 */
function buildXlsx({ sheetXml, sharedStringsXml, sheetTarget }) {
  const target = sheetTarget || 'worksheets/sheet1.xml';
  const workbookXml = '<?xml version="1.0"?><workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>';
  const relsXml = '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="worksheet" Target="' + target + '"/></Relationships>';
  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0"?><Types/>') },
    { name: '_rels/.rels', data: Buffer.from('<?xml version="1.0"?><Relationships/>') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml) },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(relsXml) },
    { name: 'xl/' + target, data: Buffer.from(sheetXml) },
  ];
  if (sharedStringsXml) entries.push({ name: 'xl/sharedStrings.xml', data: Buffer.from(sharedStringsXml) });
  return writeZip(entries);
}

test('parseFirstSheet: shared string (plain and rich text), inline string, number, entity, sparse/empty cells', () => {
  const sharedStringsXml = '<?xml version="1.0"?><sst>'
    + '<si><t>plain</t></si>'
    + '<si><r><t>LOC</t></r><r><t>146</t></r></si>'
    + '</sst>';
  const sheetXml = '<?xml version="1.0"?><worksheet><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
    + '<row r="2"><c r="A2" t="inlineStr"><is><t>hello</t></is></c><c r="B2" s="3"/></row>'
    + '<row r="3"><c r="A3"><v>45938.5</v></c></row>'
    + '<row r="4"><c r="A4" t="inlineStr"><is><t>Tom &amp; Jerry</t></is></c></row>'
    + '<row r="5"><c r="A5" t="inlineStr"><is><t>a</t></is></c><c r="C5" t="inlineStr"><is><t>c</t></is></c></row>'
    + '</sheetData></worksheet>';
  const buf = buildXlsx({ sheetXml, sharedStringsXml });

  const { sheetName, rows } = xlsxLite.parseFirstSheet(buf, { readZip, limits: LIMITS });
  assert.equal(sheetName, 'Sheet1');
  assert.deepEqual(rows[0], ['plain', 'LOC146']);
  assert.deepEqual(rows[1], ['hello', '']); // self-closing empty cell -> ''
  assert.deepEqual(rows[2], ['45938.5']);
  assert.deepEqual(rows[3], ['Tom & Jerry']);
  assert.deepEqual(rows[4], ['a', '', 'c']); // B5 missing entirely -> gap filled ''
});

test('parseFirstSheet: resolves the sheet through workbook.xml.rels when the target is not sheet1.xml', () => {
  const sheetXml = '<?xml version="1.0"?><worksheet><sheetData>'
    + '<row r="1"><c r="A1" t="inlineStr"><is><t>via-rels</t></is></c></row>'
    + '</sheetData></worksheet>';
  const buf = buildXlsx({ sheetXml, sheetTarget: 'worksheets/sheetOther.xml' });
  const { rows } = xlsxLite.parseFirstSheet(buf, { readZip, limits: LIMITS });
  assert.deepEqual(rows[0], ['via-rels']);
});

test('columnIndex: letters to a 0-based array index', () => {
  assert.equal(xlsxLite.columnIndex('A'), 0);
  assert.equal(xlsxLite.columnIndex('Z'), 25);
  assert.equal(xlsxLite.columnIndex('AA'), 26);
  assert.equal(xlsxLite.columnIndex('AB'), 27);
});

test('codesFromColumnA: skips the header row and empty cells, trims, keeps order and duplicates', () => {
  const rows = [['Code'], ['LOC1'], [' LOC2 '], [''], ['LOC1'], [undefined]];
  assert.deepEqual(xlsxLite.codesFromColumnA(rows), ['LOC1', 'LOC2', 'LOC1']);
});
