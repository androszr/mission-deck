// locations/tests/test_xlsx_lite.mjs
// The XLSX parser, against fixtures built IN MEMORY with scripts/zip.js's
// writeZip - no binary fixture file in the repo. Covers parseFirstSheet,
// codesFromColumnA, columnIndex, parseWorkbook (every sheet, in document
// order), parseSheetByName (by NAME, not position) and cell typing driven by
// xl/styles.xml (built-in and custom date formats, booleans, plain numbers).

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

const LIMITS = { maxEntries: 256, maxFileBytes: 96 * 1024 * 1024, maxTotalBytes: 192 * 1024 * 1024 };

/**
 * Builds a minimal single-sheet .xlsx buffer, the minimal shape parseFirstSheet reads.
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

/**
 * Builds a multi-sheet .xlsx buffer with an optional styles.xml, for
 * parseWorkbook/parseSheetByName.
 * @param {{sheets: {name: string, xml: string}[], stylesXml?: string}} opts
 */
function buildWorkbookXlsx({ sheets, stylesXml }) {
  const sheetTags = sheets.map((s, i) => '<sheet name="' + s.name + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('');
  const workbookXml = '<?xml version="1.0"?><workbook><sheets>' + sheetTags + '</sheets></workbook>';
  const relTags = sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('');
  const relsXml = '<?xml version="1.0"?><Relationships>' + relTags + '</Relationships>';
  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0"?><Types/>') },
    { name: '_rels/.rels', data: Buffer.from('<?xml version="1.0"?><Relationships/>') },
    { name: 'xl/workbook.xml', data: Buffer.from(workbookXml) },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(relsXml) },
  ];
  sheets.forEach((s, i) => entries.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: Buffer.from(s.xml) }));
  if (stylesXml) entries.push({ name: 'xl/styles.xml', data: Buffer.from(stylesXml) });
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
  assert.deepEqual(rows[1], ['hello', '']);
  assert.deepEqual(rows[2], ['45938.5']);
  assert.deepEqual(rows[3], ['Tom & Jerry']);
  assert.deepEqual(rows[4], ['a', '', 'c']);
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

// ---------------------------------------------------------------------------
// parseWorkbook / parseSheetByName - multi-sheet reading.
// ---------------------------------------------------------------------------

const STYLES_XML = '<?xml version="1.0"?><styleSheet>'
  + '<numFmts count="2">'
  + '<numFmt numFmtId="164" formatCode="dd.mm.yyyy"/>'
  + '<numFmt numFmtId="165" formatCode="0.00"/>'
  + '</numFmts>'
  + '<cellXfs count="4">'
  + '<xf numFmtId="0"/>'
  + '<xf numFmtId="14"/>'
  + '<xf numFmtId="164"/>'
  + '<xf numFmtId="165"/>'
  + '</cellXfs>'
  + '</styleSheet>';

function threeSheetFixture() {
  const sheet1Xml = '<?xml version="1.0"?><worksheet><sheetData>'
    + '<row r="1"><c r="A1" t="inlineStr"><is><t>one</t></is></c></row>'
    + '</sheetData></worksheet>';
  const sheet2Xml = '<?xml version="1.0"?><worksheet><sheetData>'
    + '<row r="1"><c r="A1" t="inlineStr"><is><t>two</t></is></c></row>'
    + '</sheetData></worksheet>';
  const sheet3Xml = '<?xml version="1.0"?><worksheet><sheetData>'
    + '<row r="1">'
    + '<c r="A1"><v>43252</v></c>'
    + '<c r="B1" s="1"><v>43252</v></c>'
    + '<c r="C1" s="2"><v>43252</v></c>'
    + '<c r="D1" s="3"><v>3.14</v></c>'
    + '<c r="E1" t="b"><v>1</v></c>'
    + '</row>'
    + '</sheetData></worksheet>';
  return buildWorkbookXlsx({
    sheets: [{ name: 'Sheet1', xml: sheet1Xml }, { name: 'Sheet2', xml: sheet2Xml }, { name: 'Scores', xml: sheet3Xml }],
    stylesXml: STYLES_XML,
  });
}

test('parseWorkbook: every sheet, in workbook.xml document order', () => {
  const buf = threeSheetFixture();
  const { sheets } = xlsxLite.parseWorkbook(buf, { readZip, limits: LIMITS });
  assert.deepEqual(sheets.map((s) => s.name), ['Sheet1', 'Sheet2', 'Scores']);
  assert.deepEqual(sheets[0].rows[0], ['one']);
  assert.deepEqual(sheets[1].rows[0], ['two']);
});

test('parseWorkbook: cell typing - plain number, built-in date format, custom date format, custom numeric format, boolean', () => {
  const buf = threeSheetFixture();
  const { sheets } = xlsxLite.parseWorkbook(buf, { readZip, limits: LIMITS });
  const row = sheets[2].rows[0];
  assert.equal(row[0], 43252); // no style -> plain Number
  assert.equal(row[1], '2018-06-01T00:00:00'); // built-in numFmtId 14 (date) -> ISO
  assert.equal(row[2], '2018-06-01T00:00:00'); // custom "dd.mm.yyyy" -> ISO
  assert.equal(row[3], 3.14); // custom "0.00" is NOT a date format -> stays a number
  assert.equal(row[4], true); // t="b", <v>1</v> -> boolean true
});

test('parseSheetByName: finds a sheet chosen by name, not by position', () => {
  const buf = threeSheetFixture();
  const { sheetName, rows } = xlsxLite.parseSheetByName(buf, 'Scores', { readZip, limits: LIMITS });
  assert.equal(sheetName, 'Scores');
  assert.equal(rows[0][0], 43252);
});

test('parseSheetByName: throws with the available sheet names when the name does not exist', () => {
  const buf = threeSheetFixture();
  assert.throws(
    () => xlsxLite.parseSheetByName(buf, 'Missing', { readZip, limits: LIMITS }),
    (e) => e.message.includes('Missing') && e.message.includes('Sheet1') && e.message.includes('Scores'),
  );
});
