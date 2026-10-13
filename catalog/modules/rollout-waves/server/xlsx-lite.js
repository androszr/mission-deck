'use strict';
// rollout-waves/server/xlsx-lite.js
// A ~150-line XLSX reader on an INJECTED readZip (never requires
// scripts/zip.js itself - server/index.js requires it lazily and passes it
// in, so this file stays disk-free and free of the app's scripts). No
// styles.xml, no formulas: cells are read as plain text/shared-string
// references. Used by the two confirmation imports (training/webinar), which
// read only column A (codesFromColumnA).
//
// Reads: xl/workbook.xml (first <sheet>) + xl/_rels/workbook.xml.rels (its
// target) + xl/sharedStrings.xml + the resolved worksheet XML. Cell address,
// not array position, decides the column - Excel omits empty cells from the
// XML, so "column 13" is r="M2", not the 13th <c> in the row.

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

module.exports = { parseFirstSheet, codesFromColumnA, columnIndex, unescapeXml };
