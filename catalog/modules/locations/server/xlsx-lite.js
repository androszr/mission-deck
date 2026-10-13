'use strict';
// locations/server/xlsx-lite.js
// A small, dependency-free XLSX reader (modules cannot import code from one
// another, so rollout-waves keeps its own copy). It reads the first sheet as
// strings (parseFirstSheet), every sheet of a workbook (parseWorkbook), one
// sheet chosen BY NAME (parseSheetByName), and types cells (number /
// date-as-ISO / boolean / string) driven by xl/styles.xml.
//
// readZip (scripts/zip.js) is INJECTED through opts.readZip, never required
// here - this file stays disk-free and free of the app's own scripts.
//
// Full styles.xml fidelity (colors, widths, formulas) is out of scope - only
// date-format DETECTION, to type numeric cells correctly.

/** Column letters ('A', 'AB', ...) to a 0-based array index. AB -> 27. */
function columnIndex(cellRef) {
  const m = /^([A-Za-z]+)/.exec(String(cellRef || ''));
  if (!m) return 0;
  const letters = m[1].toUpperCase();
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n - 1;
}

/** &amp; &lt; &gt; &quot; &apos; &#NN; &#xHH; -> the real character. &amp; is decoded LAST. */
function unescapeXml(str) {
  return String(str === null || str === undefined ? '' : str)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, '\'')
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, '&');
}

/** Concatenates every <t> under one <si> (or one <is>) - rich text splits a cell across several <r><t>. */
function _textFromRuns(xmlFragment) {
  let text = '';
  const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g;
  let m;
  while ((m = tRe.exec(xmlFragment || ''))) {
    text += unescapeXml(m[1] || '');
  }
  return text;
}

/** xl/sharedStrings.xml -> ordered string array (index == the "s" cell reference). */
function _parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    out.push(_textFromRuns(m[1] || ''));
  }
  return out;
}

/** A Target attribute normalized to a repo path inside the zip (xl/worksheets/sheet1.xml). */
function _resolveSheetPath(target) {
  if (!target) return 'xl/worksheets/sheet1.xml';
  const stripped = String(target).replace(/^\/+/, '');
  return stripped.startsWith('xl/') ? stripped : 'xl/' + stripped;
}

/** One <row>'s cells, addressed by column, with gaps filled '' and self-closing/empty cells -> ''. */
function _parseRowCells(rowContent, sharedStrings) {
  const cells = [];
  let maxCol = -1;
  const cellRe = /<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g;
  let m;
  while ((m = cellRe.exec(rowContent))) {
    const attrs = m[1] !== undefined ? m[1] : m[2];
    const content = m[3] || '';
    const refMatch = /\br="([A-Za-z]+\d+)"/.exec(attrs || '');
    if (!refMatch) continue;
    const col = columnIndex(refMatch[1]);
    const typeMatch = /\bt="([a-zA-Z]+)"/.exec(attrs || '');
    const type = typeMatch ? typeMatch[1] : null;

    let value = '';
    if (content) {
      if (type === 's') {
        const vMatch = /<v[^>]*>([^<]*)<\/v>/.exec(content);
        const idx = vMatch ? parseInt(vMatch[1], 10) : NaN;
        value = Number.isInteger(idx) ? (sharedStrings[idx] || '') : '';
      } else if (type === 'inlineStr') {
        const isMatch = /<is>([\s\S]*?)<\/is>/.exec(content);
        value = isMatch ? _textFromRuns(isMatch[1]) : '';
      } else {
        const vMatch = /<v[^>]*>([^<]*)<\/v>/.exec(content);
        value = vMatch ? unescapeXml(vMatch[1]) : '';
      }
    }

    cells.push({ col, value });
    if (col > maxCol) maxCol = col;
  }
  const row = new Array(maxCol + 1).fill('');
  for (const c of cells) row[c.col] = c.value;
  return row;
}

/** xl/worksheets/sheetN.xml -> string[][], one array per <row>, in document order. */
function _parseSheetRows(xml, sharedStrings) {
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let m;
  while ((m = rowRe.exec(xml))) {
    rows.push(_parseRowCells(m[1], sharedStrings));
  }
  return rows;
}

/**
 * Parses the FIRST sheet of an .xlsx buffer into a plain string grid.
 * @param {Buffer} buf
 * @param {{readZip: Function, limits: {maxEntries: number, maxFileBytes: number, maxTotalBytes: number}}} opts
 *   `readZip` is injected (scripts/zip.js's export) - this file never requires it itself.
 * @returns {{sheetName: string, rows: string[][]}}
 */
function parseFirstSheet(buf, opts) {
  const readZip = opts && opts.readZip;
  const limits = opts && opts.limits;
  if (typeof readZip !== 'function') throw new Error('parseFirstSheet: opts.readZip is required');

  const entries = readZip(buf, limits);
  const byName = new Map();
  for (const entry of entries) {
    if (!entry.isDir) byName.set(entry.name.replace(/\\/g, '/'), entry.data);
  }
  const textOf = (name) => {
    const data = byName.get(name);
    return data ? data.toString('utf8') : null;
  };

  const workbookXml = textOf('xl/workbook.xml');
  let sheetName = 'Sheet1';
  let rId = null;
  if (workbookXml) {
    const tagMatch = /<sheet\b[^>]*>/.exec(workbookXml);
    if (tagMatch) {
      const nameMatch = /\bname="([^"]*)"/.exec(tagMatch[0]);
      const ridMatch = /\br:id="([^"]*)"/.exec(tagMatch[0]);
      if (nameMatch) sheetName = unescapeXml(nameMatch[1]);
      if (ridMatch) rId = ridMatch[1];
    }
  }

  let sheetPath = 'xl/worksheets/sheet1.xml';
  if (rId) {
    const relsXml = textOf('xl/_rels/workbook.xml.rels');
    if (relsXml) {
      const relRe = new RegExp('<Relationship\\b[^>]*\\bId="' + rId + '"[^>]*>');
      const relMatch = relRe.exec(relsXml);
      if (relMatch) {
        const targetMatch = /\bTarget="([^"]*)"/.exec(relMatch[0]);
        if (targetMatch) sheetPath = _resolveSheetPath(targetMatch[1]);
      }
    }
  }

  const sheetXml = textOf(sheetPath) || textOf('xl/worksheets/sheet1.xml');
  if (!sheetXml) throw new Error('worksheet not found in the xlsx file (' + sheetPath + ')');

  const sharedStrings = _parseSharedStrings(textOf('xl/sharedStrings.xml'));
  const rows = _parseSheetRows(sheetXml, sharedStrings);
  return { sheetName, rows };
}

/** Column A from row 2 onward, trimmed, empty skipped, order and duplicates kept. */
function codesFromColumnA(rows) {
  const out = [];
  for (let i = 1; i < (rows || []).length; i++) {
    const row = rows[i] || [];
    const raw = row[0];
    const code = String(raw === undefined || raw === null ? '' : raw).trim();
    if (!code) continue;
    out.push(code);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Multi-sheet, typed reading - added for this module.
// ---------------------------------------------------------------------------

/** <sheet name="..." r:id="..."/> entries from xl/workbook.xml, in document order, each with its resolved worksheet path. */
function _sheetList(workbookXml, relsXml) {
  const out = [];
  if (!workbookXml) return out;
  const sheetRe = /<sheet\b[^>]*>/g;
  let m;
  while ((m = sheetRe.exec(workbookXml))) {
    const tag = m[0];
    const nameMatch = /\bname="([^"]*)"/.exec(tag);
    const ridMatch = /\br:id="([^"]*)"/.exec(tag);
    const name = nameMatch ? unescapeXml(nameMatch[1]) : 'Sheet';
    const rId = ridMatch ? ridMatch[1] : null;
    out.push({ name, rId, path: _resolveSheetPathByRid(rId, relsXml) });
  }
  return out;
}

function _resolveSheetPathByRid(rId, relsXml) {
  if (!rId || !relsXml) return 'xl/worksheets/sheet1.xml';
  const relRe = new RegExp('<Relationship\\b[^>]*\\bId="' + rId + '"[^>]*>');
  const relMatch = relRe.exec(relsXml);
  if (!relMatch) return 'xl/worksheets/sheet1.xml';
  const targetMatch = /\bTarget="([^"]*)"/.exec(relMatch[0]);
  return targetMatch ? _resolveSheetPath(targetMatch[1]) : 'xl/worksheets/sheet1.xml';
}

// Built-in Excel numFmtId ranges that are date/time formats (ECMA-376 part 1,
// 18.8.30): 14-22 date/time, 27-36 and 50-58 localized date/time (CJK/Thai/
// Arabic calendars this cockpit never sees but the ids are reserved for
// them), 45-47 mm:ss / [h]:mm:ss / mmss.0.
const BUILTIN_DATE_NUM_FMT_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47,
  50, 51, 52, 53, 54, 55, 56, 57, 58,
]);

/** True when a custom numFmt formatCode is a date/time format: contains d, m, y or h OUTSIDE quoted literals and [bracketed] sections. */
function _isDateFormatCode(code) {
  const stripped = String(code || '')
    .replace(/\[[^\]]*\]/g, '')
    .replace(/"[^"]*"/g, '');
  return /[dmyh]/i.test(stripped);
}

/**
 * xl/styles.xml -> cellXfs[i].isDate, one entry per <xf> in <cellXfs>, in
 * document order (a cell's s="N" attribute indexes straight into this array).
 * @param {string|null} stylesXml
 * @returns {{numFmtId: number, isDate: boolean}[]}
 */
function _parseStyles(stylesXml) {
  if (!stylesXml) return [];

  const customFormats = new Map();
  const numFmtRe = /<numFmt\b([^>]*)\/>/g;
  let nm;
  while ((nm = numFmtRe.exec(stylesXml))) {
    const idMatch = /\bnumFmtId="(\d+)"/.exec(nm[1]);
    const codeMatch = /\bformatCode="([^"]*)"/.exec(nm[1]);
    if (idMatch && codeMatch) customFormats.set(parseInt(idMatch[1], 10), unescapeXml(codeMatch[1]));
  }

  const cellXfsMatch = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml);
  if (!cellXfsMatch) return [];

  const result = [];
  const xfOpenRe = /<xf\b([^>]*)>/g;
  let xm;
  while ((xm = xfOpenRe.exec(cellXfsMatch[1]))) {
    let attrs = xm[1];
    if (attrs.endsWith('/')) attrs = attrs.slice(0, -1);
    const idMatch = /\bnumFmtId="(\d+)"/.exec(attrs);
    const numFmtId = idMatch ? parseInt(idMatch[1], 10) : 0;
    let isDate = BUILTIN_DATE_NUM_FMT_IDS.has(numFmtId);
    if (!isDate && customFormats.has(numFmtId)) isDate = _isDateFormatCode(customFormats.get(numFmtId));
    result.push({ numFmtId, isDate });
  }
  return result;
}

const _EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const _MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Excel date serial (days since 1899-12-30, the 1900-leap-bug-corrected epoch) -> 'YYYY-MM-DDTHH:MM:SS' in UTC. */
function _excelSerialToIso(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n)) return String(serial);
  const d = new Date(_EXCEL_EPOCH_MS + Math.round(n * _MS_PER_DAY));
  const pad = (x) => String(x).padStart(2, '0');
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate())
    + 'T' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds());
}

/**
 * One <row>'s cells, TYPED: no `t` and numeric content -> Number; numeric
 * content in a date-styled cell -> ISO string; t="b" -> boolean;
 * t="s"/inlineStr/"str" -> string (which CAN legitimately be '' - a cell can
 * hold an empty shared string, distinct from holding no value at all); a
 * cell with no value (self-closing, or never referenced in the row's XML at
 * all) -> `null`, matching the source library's `None` for the same case - the
 * distinction is load-bearing for sheets-import.js's null-vs-'' rule.
 */
function _parseRowCellsTyped(rowContent, sharedStrings, cellXfs) {
  const cells = [];
  let maxCol = -1;
  const cellRe = /<c\b([^>]*?)\/>|<c\b([^>]*?)>([\s\S]*?)<\/c>/g;
  let m;
  while ((m = cellRe.exec(rowContent))) {
    const attrs = m[1] !== undefined ? m[1] : m[2];
    const content = m[3] || '';
    const refMatch = /\br="([A-Za-z]+\d+)"/.exec(attrs || '');
    if (!refMatch) continue;
    const col = columnIndex(refMatch[1]);
    const typeMatch = /\bt="([a-zA-Z]+)"/.exec(attrs || '');
    const type = typeMatch ? typeMatch[1] : null;
    const styleMatch = /\bs="(\d+)"/.exec(attrs || '');
    const styleIdx = styleMatch ? parseInt(styleMatch[1], 10) : -1;
    const isDateStyle = styleIdx >= 0 && Boolean(cellXfs[styleIdx] && cellXfs[styleIdx].isDate);

    let value = null;
    if (content) {
      if (type === 's') {
        const vMatch = /<v[^>]*>([^<]*)<\/v>/.exec(content);
        const idx = vMatch ? parseInt(vMatch[1], 10) : NaN;
        value = Number.isInteger(idx) ? (sharedStrings[idx] || '') : '';
      } else if (type === 'inlineStr') {
        const isMatch = /<is>([\s\S]*?)<\/is>/.exec(content);
        value = isMatch ? _textFromRuns(isMatch[1]) : '';
      } else if (type === 'b') {
        const vMatch = /<v[^>]*>([^<]*)<\/v>/.exec(content);
        value = vMatch ? vMatch[1] === '1' : false;
      } else if (type === 'str') {
        const vMatch = /<v[^>]*>([^<]*)<\/v>/.exec(content);
        value = vMatch ? unescapeXml(vMatch[1]) : '';
      } else {
        // No t attribute (plain numeric) or an unrecognised type - read <v> as a number.
        const vMatch = /<v[^>]*>([^<]*)<\/v>/.exec(content);
        const raw = vMatch ? vMatch[1] : '';
        if (raw === '') {
          value = null;
        } else if (isDateStyle) {
          value = _excelSerialToIso(raw);
        } else {
          const num = Number(raw);
          value = Number.isFinite(num) ? num : unescapeXml(raw);
        }
      }
    }

    cells.push({ col, value });
    if (col > maxCol) maxCol = col;
  }
  const row = new Array(maxCol + 1).fill(null);
  for (const c of cells) row[c.col] = c.value;
  return row;
}

function _parseSheetRowsTyped(xml, sharedStrings, cellXfs) {
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let m;
  while ((m = rowRe.exec(xml))) {
    rows.push(_parseRowCellsTyped(m[1], sharedStrings, cellXfs));
  }
  return rows;
}

/**
 * Parses EVERY sheet of an .xlsx buffer, cells typed via xl/styles.xml.
 * @param {Buffer} buf
 * @param {{readZip: Function, limits: object}} opts
 * @returns {{sheets: {name: string, rows: Array<Array<string|number|boolean>>}[]}}
 */
function parseWorkbook(buf, opts) {
  const readZip = opts && opts.readZip;
  const limits = opts && opts.limits;
  if (typeof readZip !== 'function') throw new Error('parseWorkbook: opts.readZip is required');

  const entries = readZip(buf, limits);
  const byName = new Map();
  for (const entry of entries) {
    if (!entry.isDir) byName.set(entry.name.replace(/\\/g, '/'), entry.data);
  }
  const textOf = (name) => {
    const data = byName.get(name);
    return data ? data.toString('utf8') : null;
  };

  const workbookXml = textOf('xl/workbook.xml');
  const relsXml = textOf('xl/_rels/workbook.xml.rels');
  const sheetList = _sheetList(workbookXml, relsXml);
  const sharedStrings = _parseSharedStrings(textOf('xl/sharedStrings.xml'));
  const cellXfs = _parseStyles(textOf('xl/styles.xml'));

  const sheets = [];
  for (const s of sheetList) {
    const sheetXml = textOf(s.path);
    if (!sheetXml) continue;
    sheets.push({ name: s.name, rows: _parseSheetRowsTyped(sheetXml, sharedStrings, cellXfs) });
  }
  return { sheets };
}

/**
 * Parses ONE sheet chosen by exact name (not by position - a workbook can
 * have its sheets reordered).
 * @param {Buffer} buf
 * @param {string} name
 * @param {{readZip: Function, limits: object}} opts
 * @returns {{sheetName: string, rows: Array<Array<string|number|boolean>>}}
 * @throws {Error} when no sheet with that exact name exists - message lists the available names
 */
function parseSheetByName(buf, name, opts) {
  const { sheets } = parseWorkbook(buf, opts);
  const found = sheets.find((s) => s.name === name);
  if (!found) {
    const available = sheets.map((s) => s.name).join(', ');
    throw new Error('no sheet "' + name + '" - available: ' + available);
  }
  return { sheetName: found.name, rows: found.rows };
}

module.exports = { parseFirstSheet, codesFromColumnA, columnIndex, unescapeXml, parseWorkbook, parseSheetByName };
