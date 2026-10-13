'use strict';
// on-call/server/parse-schedule.js
// Pure, browser-free HTML table parser for a Confluence "On-call schedule" page
// (body.export_view). No fs, no network - parseScheduleHtml(html, opts) is a
// straight function from string to data, which is what makes it testable
// against a fixture instead of a live connection.
//
// Expected page layout (four tables, found by their header text, in any
// order):
//   1. Roster       - header row: (blank) | Inventory | Orders | Platform |
//                     Email | Phone | Company | (role). Detected by "phone".
//   2. Coordination - first header cell "Person": Person | Email | Phone.
//   3. Hours        - header contains "Days of week": System | Days | Hours | Scope.
//   4. Schedule     - first header cell "Date": Date | Day | one column per
//                     on-call team (Inventory, Orders, Platform, DevOps).
//
// A positional table reader that drops colspan/rowspan would corrupt exactly
// the tables this module cares about (a one-person weekend duty spanning all
// four columns, a system name spanning three rows). expandTable() below
// walks the raw <tr>/<td> tree and copies a spanning cell into every grid
// position it covers BEFORE any column is read by index, so a short or
// irregular row is padded rather than misread.

// -- entity decoding ----------------------------------------------------------

const NAMED_ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  oacute: '\u00f3', Oacute: '\u00d3',
  eacute: '\u00e9', Eacute: '\u00c9',
  aacute: '\u00e1', Aacute: '\u00c1',
  iacute: '\u00ed', Iacute: '\u00cd',
  uacute: '\u00fa', Uacute: '\u00da',
  ntilde: '\u00f1', Ntilde: '\u00d1',
};

/**
 * Decodes numeric (decimal + hex) and a closed named-entity set. Confluence's
 * export_view carries most non-ASCII letters as raw UTF-8; the named set
 * covers the handful of Latin-1 entities it does emit.
 * @param {string} s
 * @returns {string}
 */
function decodeEntities(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => (
      Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : m
    ));
}

// -- diacritic folding (for keyword/weekday matching, not for display) -------

const COMBINING_MARKS_RE = /[\u0300-\u036f]/g;

function foldText(s) {
  let x = String(s === null || s === undefined ? '' : s);
  x = x.normalize('NFD').replace(COMBINING_MARKS_RE, '');
  x = x.replace(/[\u0142\u0141]/g, 'l'); // stroked l
  x = x.replace(/[\u0111\u0110]/g, 'd'); // stroked d
  x = x.replace(/[\u00f8\u00d8]/g, 'o'); // stroked o
  return x.toLowerCase();
}

/**
 * Same fold as foldText plus "spaces -> dash", for a stable per-person id.
 * @param {string} name
 * @returns {string}
 */
function slugify(name) {
  let s = foldText(name).trim();
  s = s.replace(/[-_\s]+/g, ' ').trim();
  s = s.replace(/\s+/g, '-');
  return s;
}

// -- tokenizer: HTML text -> tables -> rows -> cells -------------------------

const EMPTY_CELL = Object.freeze({ html: '', colspan: 1, rowspan: 1, header: false });

function _intAttr(attrs, name, fallback) {
  const m = new RegExp(name + '\\s*=\\s*"?(\\d+)"?', 'i').exec(attrs);
  return m ? parseInt(m[1], 10) : fallback;
}

/**
 * Splits the export_view HTML into tables, each an array of rows, each row
 * an array of raw (non-expanded) cells `{ html, colspan, rowspan, header }`.
 * Regex-based on purpose: the four tables this module reads are plain,
 * non-nested markup, and a browser-free parser is what keeps this file testable
 * with `node --test` alone.
 * @param {string} html
 * @returns {Array<Array<Array<{html: string, colspan: number, rowspan: number, header: boolean}>>>}
 */
function tokenizeTables(html) {
  const src = String(html || '');
  const tables = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;
  while ((tableMatch = tableRe.exec(src))) {
    const tableHtml = tableMatch[1];
    const rows = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRe.exec(tableHtml))) {
      const rowHtml = rowMatch[1];
      const cells = [];
      const cellRe = /<t([dh])\b([^>]*)>([\s\S]*?)<\/t\1>/gi;
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowHtml))) {
        const tag = cellMatch[1].toLowerCase();
        const attrs = cellMatch[2] || '';
        cells.push({
          html: cellMatch[3],
          colspan: _intAttr(attrs, 'colspan', 1),
          rowspan: _intAttr(attrs, 'rowspan', 1),
          header: tag === 'h',
        });
      }
      rows.push(cells);
    }
    tables.push(rows);
  }
  return tables;
}

/**
 * Expands a table's raw rows into a rectangular grid: a colspan/rowspan cell
 * is copied (same object reference) into every position it covers, and a row
 * left short by the source markup is padded with an empty cell rather than
 * throwing. This is what makes indexing a column safe afterwards.
 * @param {Array<Array<object>>} rows
 * @returns {Array<Array<object>>}
 */
function expandTable(rows) {
  const grid = [];
  const pending = {}; // col index -> { cell, rowsLeft }
  const list = Array.isArray(rows) ? rows : [];

  for (let r = 0; r < list.length; r += 1) {
    grid[r] = grid[r] || [];
    const rawRow = list[r] || [];
    let rawIdx = 0;
    let col = 0;
    while (rawIdx < rawRow.length || (pending[col] && pending[col].rowsLeft > 0)) {
      if (pending[col] && pending[col].rowsLeft > 0) {
        grid[r][col] = pending[col].cell;
        pending[col].rowsLeft -= 1;
        if (pending[col].rowsLeft <= 0) delete pending[col];
        col += 1;
        continue;
      }
      const cell = rawRow[rawIdx];
      rawIdx += 1;
      if (!cell) break;
      const colspan = Math.max(1, cell.colspan || 1);
      const rowspan = Math.max(1, cell.rowspan || 1);
      for (let c = 0; c < colspan; c += 1) grid[r][col + c] = cell;
      if (rowspan > 1) {
        for (let c = 0; c < colspan; c += 1) pending[col + c] = { cell, rowsLeft: rowspan - 1 };
      }
      col += colspan;
    }
  }

  let width = 0;
  for (const row of grid) width = Math.max(width, row.length);
  for (const row of grid) {
    for (let c = 0; c < width; c += 1) if (!row[c]) row[c] = EMPTY_CELL;
  }
  return grid;
}

/**
 * Splits a cell's inner HTML into text blocks at <br>/</p>/</div>/</li>
 * boundaries, strips remaining tags, decodes entities, trims and drops empty
 * blocks. Two <p> paragraphs in one cell therefore stay two
 * separate values instead of gluing into one string.
 * @param {string} cellHtml
 * @returns {Array<string>}
 */
function cellBlocks(cellHtml) {
  let s = String(cellHtml === null || cellHtml === undefined ? '' : cellHtml);
  // Confluence emits both <br/> and <br title=""/> - match any attribute list.
  s = s.replace(/<br\b[^>]*>/gi, '\n');
  s = s.replace(/<\/(p|div|li)>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return s.split('\n').map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// -- section detection --------------------------------------------------------

function _rowText(row) {
  return row.map((c) => cellBlocks(c.html).join(' ')).join(' | ');
}

function detectSection(grid) {
  if (!grid.length) return null;
  const header = foldText(_rowText(grid[0]));
  const firstCell = grid[0][0] ? foldText(cellBlocks(grid[0][0].html).join(' ')) : '';
  if (firstCell.indexOf('date') === 0) return 'schedule';
  if (firstCell.indexOf('person') === 0) return 'coordination';
  if (header.indexOf('days of week') !== -1) return 'hours';
  if (header.indexOf('phone') !== -1) return 'roster';
  return null;
}

// -- weekday / date derivation -------------------------------------------------

const WEEKDAY_FOLD = {
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
  sun: 0, sunday: 0,
};

function _weekdayIndex(token) {
  const key = foldText(token).trim().replace(/\.$/, '');
  return Object.prototype.hasOwnProperty.call(WEEKDAY_FOLD, key) ? WEEKDAY_FOLD[key] : null;
}

function _pad2(n) { return String(n).padStart(2, '0'); }
function _isoDate(y, m, d) { return y + '-' + _pad2(m) + '-' + _pad2(d); }

/**
 * Year derivation rule: candidates are anchor, anchor-1, anchor+1 in that
 * order; the first whose weekday matches the page's token wins. No weekday
 * token, or none matches, falls back to the anchor year with a warning - the
 * row is never dropped.
 * @param {string} dayMonth "D.M" or "DD.MM"
 * @param {string} weekdayToken
 * @param {Date|string|number} anchorDate
 * @returns {{date: string|null, warning: string|null}}
 */
function deriveDate(dayMonth, weekdayToken, anchorDate) {
  const m = /^(\d{1,2})\.(\d{1,2})$/.exec(String(dayMonth || '').trim());
  if (!m) return { date: null, warning: 'Invalid date in the schedule: "' + dayMonth + '"' };
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { date: null, warning: 'Invalid date in the schedule: "' + dayMonth + '"' };
  }
  // The page carries no year: pick the year (anchor, then anchor-1, then
  // anchor+1) in which day.month falls on the weekday the page names.
  const anchor = anchorDate instanceof Date ? anchorDate : new Date(anchorDate);
  const anchorYear = anchor.getFullYear();
  const wIdx = weekdayToken ? _weekdayIndex(weekdayToken) : null;

  if (wIdx === null) {
    return {
      date: _isoDate(anchorYear, month, day),
      warning: 'No recognised weekday for "' + dayMonth + '" - assumed year ' + anchorYear + '.',
    };
  }

  const candidates = [anchorYear, anchorYear - 1, anchorYear + 1];
  for (const y of candidates) {
    const d = new Date(y, month - 1, day);
    if (d.getFullYear() === y && d.getMonth() === month - 1 && d.getDate() === day && d.getDay() === wIdx) {
      return { date: _isoDate(y, month, day), warning: null };
    }
  }
  return {
    date: _isoDate(anchorYear, month, day),
    warning: 'Weekday "' + weekdayToken + '" does not fit any year around '
      + anchorYear + ' for "' + dayMonth + '" - assumed year ' + anchorYear + '.',
  };
}

// -- hours -----------------------------------------------------------------

const HOUR_RANGE_RE = /\d{1,2}:\d{2}-\d{1,2}:\d{2}/g;

/**
 * A block that is nothing but back-to-back HH:MM-HH:MM ranges (the flattened
 * "5:30-17:0020:00-23:00" shape) splits into one item per range; anything
 * else (including a range with trailing prose, e.g. "business 9:00-17:00")
 * stays verbatim as a single item.
 * @param {string} text
 * @returns {Array<string>}
 */
function splitHours(text) {
  const s = String(text === null || text === undefined ? '' : text).trim();
  if (!s) return [];
  const matches = s.match(HOUR_RANGE_RE);
  if (matches && matches.join('') === s) return matches;
  return [s];
}

// -- section parsers -----------------------------------------------------------

const COLUMN_KEYWORDS = [
  { key: 'inventory', kw: 'inventory' },
  { key: 'orders', kw: 'order' },
  { key: 'platform', kw: 'platform' },
  { key: 'devops', kw: 'devops' },
];

function _columnFromText(text) {
  const folded = foldText(text);
  for (const c of COLUMN_KEYWORDS) if (folded.indexOf(c.kw) !== -1) return c.key;
  return null;
}

function _detectColumnsFromHeader(headerRow) {
  const cols = [];
  for (let i = 2; i < headerRow.length; i += 1) {
    const text = cellBlocks(headerRow[i].html).join(' ');
    cols.push(_columnFromText(text));
  }
  return cols;
}

// The page marks a scope with an emoji IMAGE, not text: <img alt="check
// mark button"> for yes and <img alt="cross mark"> for no, so the cell's text
// is empty either way. A cross is an explicit "no"; a check, or any non-empty
// text (an "x", a "yes"), is "yes"; an empty cell is "no".
function _scopeTick(cell) {
  if (!cell) return false;
  const html = String(cell.html || '');
  const alts = [...html.matchAll(/<img\b[^>]*\balt="([^"]*)"/gi)].map((m) => foldText(m[1]));
  if (alts.some((a) => a.indexOf('cross') !== -1)) return false;
  if (alts.some((a) => a.indexOf('check') !== -1)) return true;
  return cellBlocks(html).join(' ').length > 0;
}

// Column layout (post-expand): 0 name, 1 Inventory, 2 Orders, 3 Platform,
// 4 Email, 5 Phone, 6 Company, 7 role (DEVOPS/BE).
function _parseRoster(grid, warnings) {
  const rows = grid.slice(1);
  const out = [];
  for (const row of rows) {
    const name = row[0] ? cellBlocks(row[0].html).join(' ') : '';
    if (!name) continue;
    const emailsRaw = row[4] ? cellBlocks(row[4].html).join(' ') : '';
    const emails = emailsRaw.split('/').map((e) => e.trim()).filter(Boolean);
    const phone = row[5] ? cellBlocks(row[5].html).join(' ') : '';
    const company = row[6] ? cellBlocks(row[6].html).join(' ') : '';
    const role = row[7] ? cellBlocks(row[7].html).join(' ') : '';
    out.push({
      name,
      person_slug: slugify(name),
      emails,
      phone,
      company,
      role,
      scopes: {
        inventory: _scopeTick(row[1]),
        orders: _scopeTick(row[2]),
        platform: _scopeTick(row[3]),
      },
    });
  }
  if (out.length === 0) warnings.push('The on-call roster table has no rows.');
  return out;
}

function _parseCoordination(grid) {
  const rows = grid.slice(1);
  const out = [];
  for (const row of rows) {
    const name = row[0] ? cellBlocks(row[0].html).join(' ') : '';
    if (!name) continue;
    const email = row[1] ? cellBlocks(row[1].html).join(' ') : '';
    const phoneRaw = row[2] ? cellBlocks(row[2].html).join(' ') : '';
    const noteMatch = /^(.*?)(?:\s*(or\s+teams.*))$/i.exec(phoneRaw);
    const phone_display = noteMatch ? noteMatch[1].trim() : phoneRaw;
    const note = noteMatch ? noteMatch[2].trim() : '';
    out.push({
      name,
      email,
      phone: phone_display.replace(/[^\d+]/g, ''),
      phone_display,
      note,
    });
  }
  return out;
}

// The system name (Inventory / Orders / Platform) is written ONCE, in the
// header row or in a section row whose other cells are empty or repeat the
// header, and the data rows under it leave the first cell blank - so it
// fills down until the next named row.
function _parseHours(grid) {
  const out = [];
  let system = '';
  for (const row of grid) {
    const first = row[0] ? cellBlocks(row[0].html).join(' ') : '';
    if (first) system = first;
    const days = row[1] ? cellBlocks(row[1].html).join(' ') : '';
    if (!days || foldText(days).indexOf('days of week') !== -1) continue; // header or section row
    const hoursBlocks = row[2] ? cellBlocks(row[2].html) : [];
    let hours = [];
    for (const b of hoursBlocks) hours = hours.concat(splitHours(b));
    const scope = row[3] ? cellBlocks(row[3].html).join(' ') : '';
    out.push({ system, days, hours, scope });
  }
  return out;
}

/**
 * Roster token-set match: order-independent so "Rivera Sam" and "Sam Rivera"
 * both hit the same roster entry. No fuzzy matching - an exact token set or
 * nothing.
 * @param {string} rawName
 * @param {Array<{name: string, tokens: Set<string>}>} roster
 * @returns {{name: string, matched: boolean}}
 */
function _matchRoster(rawName, roster) {
  const tokens = new Set(foldText(rawName).trim().split(/\s+/).filter(Boolean));
  for (const entry of roster) {
    if (entry.tokens.size !== tokens.size) continue;
    let allIn = true;
    for (const t of tokens) if (!entry.tokens.has(t)) { allIn = false; break; }
    if (allIn) return { name: entry.name, matched: true };
  }
  return { name: rawName, matched: false };
}

const NAME_SCOPE_RE = /^(.*?)\s+-\s+(.+)$/;

function _parseSchedule(grid, columns, roster, anchorDate, warnings) {
  const rows = grid.slice(1);
  const entries = [];
  const unmatchedSeen = new Set();
  let prevSeq = null;

  for (const row of rows) {
    const dayMonth = row[0] ? cellBlocks(row[0].html).join(' ') : '';
    if (!dayMonth) continue;
    const weekday = row[1] ? cellBlocks(row[1].html).join(' ') : '';
    // The page lists days in one unbroken run, so only the FIRST row needs
    // the weekday heuristic. Every later row continues from the previous
    // one (the year rolls over when the month goes down): the weekday column
    // is typed by hand and drifts, and trusting it can move half a month
    // into the previous year.
    let date;
    const dm = /^(\d{1,2})\.(\d{1,2})$/.exec(dayMonth.trim());
    if (dm && prevSeq) {
      const mo = parseInt(dm[2], 10);
      const dd = parseInt(dm[1], 10);
      const yr = mo < prevSeq.month ? prevSeq.year + 1 : prevSeq.year;
      const probe = new Date(yr, mo - 1, dd);
      if (probe.getFullYear() === yr && probe.getMonth() === mo - 1 && probe.getDate() === dd) {
        date = _isoDate(yr, mo, dd);
        const wIdx = weekday ? _weekdayIndex(weekday) : null;
        if (wIdx !== null && probe.getDay() !== wIdx) {
          warnings.push('Weekday "' + weekday + '" next to ' + date + ' does not match the calendar - the date was taken from the row order.');
        }
      }
    }
    if (!date) {
      const derived = deriveDate(dayMonth, weekday, anchorDate);
      if (derived.warning) warnings.push(derived.warning);
      date = derived.date;
    }
    if (!date) continue;
    prevSeq = { year: parseInt(date.slice(0, 4), 10), month: parseInt(date.slice(5, 7), 10) };

    for (let ci = 0; ci < columns.length; ci += 1) {
      const physicalCol = columns[ci];
      const cell = row[2 + ci];
      if (!cell) continue;
      const blocks = cellBlocks(cell.html);
      for (const block of blocks) {
        const pieces = block.split(' / ').map((p) => p.trim()).filter(Boolean);
        for (const piece of pieces) {
          const m = NAME_SCOPE_RE.exec(piece);
          const personRaw = (m ? m[1] : piece).trim();
          const scopeSuffix = m ? m[2].trim() : '';
          if (!personRaw) continue;
          const overrideCol = scopeSuffix ? _columnFromText(scopeSuffix) : null;
          const column = overrideCol || physicalCol;
          if (!column) continue;
          const match = _matchRoster(personRaw, roster);
          if (!match.matched && !unmatchedSeen.has(personRaw)) {
            unmatchedSeen.add(personRaw);
            warnings.push('Person not in the on-call roster: "' + personRaw + '".');
          }
          entries.push({
            date,
            weekday,
            column,
            person_raw: personRaw,
            person: match.name,
            person_slug: slugify(match.name),
            matched: match.matched,
            note: scopeSuffix && !overrideCol ? scopeSuffix : '',
          });
        }
      }
    }
  }
  return entries;
}

// -- entry point ---------------------------------------------------------------

/**
 * @param {string} html export_view HTML of the Confluence page
 * @param {{anchorDate?: Date|string|number}} opts anchorDate defaults to now
 * @returns {{roster: Array, coordination: Array, hours: Array, entries: Array, warnings: Array<string>}}
 */
function parseScheduleHtml(html, opts) {
  const anchorDate = (opts && opts.anchorDate) || new Date();
  const warnings = [];
  const tables = tokenizeTables(html);

  let rosterGrid = null;
  let coordinationGrid = null;
  let hoursGrid = null;
  let scheduleGrid = null;

  for (const rawRows of tables) {
    const grid = expandTable(rawRows);
    const section = detectSection(grid);
    if (section === 'roster' && !rosterGrid) rosterGrid = grid;
    else if (section === 'coordination' && !coordinationGrid) coordinationGrid = grid;
    else if (section === 'hours' && !hoursGrid) hoursGrid = grid;
    else if (section === 'schedule' && !scheduleGrid) scheduleGrid = grid;
  }

  const roster = rosterGrid ? _parseRoster(rosterGrid, warnings) : [];
  const coordination = coordinationGrid ? _parseCoordination(coordinationGrid) : [];
  const hours = hoursGrid ? _parseHours(hoursGrid) : [];

  const rosterIndex = roster.map((d) => ({
    name: d.name,
    tokens: new Set(foldText(d.name).trim().split(/\s+/).filter(Boolean)),
  }));

  let entries = [];
  if (scheduleGrid) {
    const columns = _detectColumnsFromHeader(scheduleGrid[0]);
    entries = _parseSchedule(scheduleGrid, columns, rosterIndex, anchorDate, warnings);
  }

  return { roster, coordination, hours, entries, warnings };
}

module.exports = {
  parseScheduleHtml,
  tokenizeTables,
  expandTable,
  cellBlocks,
  deriveDate,
  splitHours,
  slugify,
  foldText,
  decodeEntities,
};
