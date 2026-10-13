'use strict';
// on-call/server/build.js
// Turns parseScheduleHtml's flat { entries, roster, coordination, hours }
// into the two shapes written to team data: index.json (contacts, hours,
// coordination, the month list) and one months/YYYY-MM.json per month
// present in entries. Pure - no fs here, server/index.js does the writing so
// this stays testable with plain objects.

const COLUMN_ORDER = ['inventory', 'orders', 'platform', 'devops'];

function _columnRank(key) {
  const i = COLUMN_ORDER.indexOf(key);
  return i === -1 ? COLUMN_ORDER.length : i;
}

function _entrySortKey(e) {
  return e.date + '|' + _columnRank(e.column) + '|' + (e.person || e.person_raw || '');
}

/**
 * Keeps the previous copy of a small table when this fetch parsed it empty,
 * so a header the parser no longer recognises never wipes shared data.
 */
function _keepPrevious(fresh, existingIndex, key, warnings, label) {
  const list = Array.isArray(fresh) ? fresh : [];
  if (list.length === 0 && existingIndex && Array.isArray(existingIndex[key]) && existingIndex[key].length > 0) {
    warnings.push('The ' + label + ' table came back empty from this fetch - the previous one was kept.');
    return existingIndex[key];
  }
  return list;
}

/**
 * Groups entries into monthly shards. A write guard decides, before any
 * write happens, whether the parse is trustworthy enough to publish:
 * - no schedule rows at all -> 'parse-failed', nothing is written.
 * - roster / coordination / hours parsed empty while the previous index had
 *   rows -> the previous rows are kept and a warning is added (never a
 *   silent wipe).
 * @param {{roster: Array, coordination: Array, hours: Array, entries: Array, warnings: Array<string>}} parsed
 * @param {{generated_at: string, source_url: string, source_page_id: string, source_version: number|null, source_updated: string|null, source_title: string}} meta
 * @param {object|null} existingIndex previously written index.json, or null
 * @returns {{error?: string, message?: string, index?: object, months?: Record<string, object>}}
 */
function buildShards(parsed, meta, existingIndex) {
  const entries = Array.isArray(parsed && parsed.entries) ? parsed.entries : [];
  if (entries.length === 0) {
    return {
      error: 'parse-failed',
      message: 'Could not read the "Schedule" table from the page - check that the page still has the same layout and try again.',
    };
  }

  const warnings = Array.isArray(parsed.warnings) ? parsed.warnings.slice() : [];
  const roster = _keepPrevious(parsed.roster, existingIndex, 'roster', warnings, 'on-call roster');
  const coordination = _keepPrevious(parsed.coordination, existingIndex, 'coordination', warnings, 'coordination');
  const hours = _keepPrevious(parsed.hours, existingIndex, 'hours', warnings, 'on-call hours');

  const byMonth = {};
  for (const e of entries) {
    const ym = String(e.date || '').slice(0, 7);
    if (!ym) continue;
    if (!byMonth[ym]) byMonth[ym] = [];
    byMonth[ym].push(e);
  }

  const months = {};
  const monthKeys = Object.keys(byMonth).sort();
  for (const ym of monthKeys) {
    const monthEntries = byMonth[ym].slice().sort((a, b) => (
      _entrySortKey(a) < _entrySortKey(b) ? -1 : _entrySortKey(a) > _entrySortKey(b) ? 1 : 0
    ));
    months[ym] = {
      month: ym,
      generated_at: meta.generated_at,
      source_version: meta.source_version,
      entries: monthEntries,
    };
  }

  const index = {
    generated_at: meta.generated_at,
    source_url: meta.source_url,
    source_page_id: meta.source_page_id,
    source_version: meta.source_version,
    source_updated: meta.source_updated,
    source_title: meta.source_title,
    columns: COLUMN_ORDER.map((key) => ({ key, label: key })),
    roster,
    coordination,
    hours,
    months: monthKeys,
    warnings,
  };

  return { index, months };
}

module.exports = { buildShards, COLUMN_ORDER };
