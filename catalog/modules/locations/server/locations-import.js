'use strict';
// locations/server/locations-import.js
// Pure domain logic for the locations directory: header detection, the
// column alias table, CSV parsing, building the full file and the light
// index, search normalisation and the read-time "vacant manager" label.
// Never requires anything and never touches fs - index.js does the I/O.
//
// A location row (both files use the same English keys):
//   code, name, status, city, postal_code, street, region, area, district,
//   operator, manager, partner, groups[]                <- index + full
//   phone, email, opened_at, sales_area_m2, latitude, longitude  <- full only
//
// The index never carries phone or email - GET /directory reads only the
// index, so contact details leave the server one location at a time
// (GET /location?code=).

const SCHEMA_VERSION = 1;

/** Canonical field -> accepted header spellings (compared after normalize()). */
const COLUMN_ALIASES = {
  code: ['code', 'location code', 'site code', 'location id', 'site id', 'id'],
  name: ['name', 'location name', 'site name'],
  status: ['status', 'location status'],
  city: ['city', 'town'],
  postal_code: ['postal code', 'postcode', 'zip', 'zip code'],
  street: ['street', 'address', 'street address'],
  region: ['region'],
  area: ['area'],
  district: ['district'],
  operator: ['operator', 'owner'],
  manager: ['manager'],
  partner: ['partner'],
  groups: ['groups', 'group', 'tags'],
  phone: ['phone', 'phone number'],
  email: ['email', 'e mail'],
  opened_at: ['opened', 'opened at', 'opening date'],
  sales_area_m2: ['sales area', 'sales area m2'],
  latitude: ['latitude', 'lat'],
  longitude: ['longitude', 'lng', 'lon'],
};

const REQUIRED_FIELDS = ['code', 'name', 'city'];
const INDEX_FIELDS = ['code', 'name', 'status', 'city', 'postal_code', 'street', 'region', 'area', 'district', 'operator', 'manager', 'partner', 'groups'];
const NUMERIC_FIELDS = new Set(['sales_area_m2', 'latitude', 'longitude']);
const HEADER_SCAN_ROWS = 10;

/**
 * Lowercase, strip diacritics (NFD plus the letters NFD does not decompose),
 * collapse everything that is not a letter or digit into single spaces.
 * @param {unknown} value
 * @returns {string}
 */
function normalize(value) {
  return String(value === null || value === undefined ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0141\u0142]/g, 'l')
    .replace(/[\u0110\u0111]/g, 'd')
    .replace(/[\u00d8\u00f8]/g, 'o')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** header text -> canonical field, or null for a column this module ignores. */
function fieldForHeader(header) {
  const h = normalize(header);
  if (!h) return null;
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (aliases.includes(h)) return field;
  }
  return null;
}

/**
 * Index of the header row within the first HEADER_SCAN_ROWS rows: the first
 * row with a cell that reads as the `code` column. Exports often carry a
 * title line above the header. -1 when none is found.
 * @param {Array<Array<unknown>>} rows
 */
function findHeaderOffset(rows) {
  const limit = Math.min(HEADER_SCAN_ROWS, rows.length);
  for (let i = 0; i < limit; i++) {
    const row = rows[i] || [];
    if (row.some((cell) => fieldForHeader(cell) === 'code')) return i;
  }
  return -1;
}

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function cleanNumber(value) {
  const text = cleanText(value).replace(',', '.');
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

function splitGroups(value) {
  const text = cleanText(value);
  if (!text) return [];
  const seen = new Set();
  const out = [];
  for (const part of text.split(/[,;|]/)) {
    const g = part.trim();
    if (g && !seen.has(g.toLowerCase())) { seen.add(g.toLowerCase()); out.push(g); }
  }
  return out;
}

/**
 * Minimal RFC 4180 CSV parser: quoted fields, doubled quotes, CRLF/LF, a BOM.
 * The delimiter is ';' when the first line has more semicolons than commas
 * (spreadsheet exports in many locales), else ','.
 * @param {string} text
 * @returns {string[][]}
 */
function parseCsv(text) {
  const src = String(text || '').replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] || '';
  const delim = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delim) { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * rows (header somewhere in the first rows) -> { ok, locations, warnings } or
 * { ok: false, error, missing? }.
 * @param {Array<Array<unknown>>} rows
 */
function buildLocations(rows) {
  const headerAt = findHeaderOffset(rows || []);
  if (headerAt < 0) return { ok: false, error: 'header-not-found' };

  const header = rows[headerAt] || [];
  const columnOf = {};
  header.forEach((cell, i) => {
    const field = fieldForHeader(cell);
    if (field && columnOf[field] === undefined) columnOf[field] = i;
  });
  const missing = REQUIRED_FIELDS.filter((f) => columnOf[f] === undefined);
  if (missing.length) return { ok: false, error: 'missing-columns', missing };

  const warnings = [];
  const byCode = new Map();
  let duplicates = 0;
  for (let r = headerAt + 1; r < rows.length; r++) {
    const raw = rows[r] || [];
    const code = cleanText(raw[columnOf.code]).toUpperCase();
    if (!code) continue;
    if (byCode.has(code)) { duplicates++; continue; }
    const loc = {};
    for (const field of Object.keys(COLUMN_ALIASES)) {
      const idx = columnOf[field];
      const value = idx === undefined ? undefined : raw[idx];
      if (field === 'groups') loc.groups = splitGroups(value);
      else if (NUMERIC_FIELDS.has(field)) loc[field] = cleanNumber(value);
      else loc[field] = cleanText(value);
    }
    loc.code = code;
    byCode.set(code, loc);
  }
  if (duplicates) warnings.push('duplicate-codes:' + duplicates);
  const locations = [...byCode.values()];
  if (!locations.length) return { ok: false, error: 'no-rows' };
  return { ok: true, locations, warnings };
}

/** One light index row (no contact details) plus a precomputed search_text. */
function buildIndexRow(loc) {
  const row = {};
  for (const f of INDEX_FIELDS) row[f] = f === 'groups' ? [...(loc.groups || [])] : (loc[f] || '');
  row.search_text = normalize([
    loc.code, loc.name, loc.city, loc.street, loc.postal_code, loc.region, loc.area,
    loc.district, loc.operator, loc.manager, loc.partner, (loc.groups || []).join(' '),
  ].join(' '));
  return row;
}

/**
 * A blank manager reads as `Vacant <area>` (an unfilled position; every
 * manager owns one area, so the area names the vacancy). Applied
 * at READ time on a copy - the files on disk keep the export's blank cell.
 * rollout-waves keys the same way (managerKeyFor).
 */
function withVacantManager(row) {
  if (!row || cleanText(row.manager) || !cleanText(row.area)) return row;
  const copy = { ...row, manager: 'Vacant ' + cleanText(row.area) };
  if (typeof copy.search_text === 'string') copy.search_text = (copy.search_text + ' ' + normalize(copy.manager)).trim();
  return copy;
}

/** The two payloads an import writes. */
function buildPayloads(locations, warnings, { sourceFile, nowIso, sourceModIso }) {
  const full = {
    metadata: {
      schema_version: SCHEMA_VERSION,
      source_file: sourceFile,
      updated_at: nowIso,
      source_file_modified_at: sourceModIso,
      total_rows: locations.length,
      warnings: warnings || [],
    },
    rows: locations,
  };
  const index = {
    metadata: { schema_version: SCHEMA_VERSION, generated_at: nowIso, source_file: sourceFile, row_count: locations.length },
    rows: locations.map(buildIndexRow),
  };
  return { full, index };
}

module.exports = {
  SCHEMA_VERSION, COLUMN_ALIASES, REQUIRED_FIELDS, INDEX_FIELDS,
  normalize, fieldForHeader, findHeaderOffset, parseCsv, buildLocations, buildIndexRow, withVacantManager, buildPayloads,
};
