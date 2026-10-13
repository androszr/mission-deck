'use strict';
// rollout-waves/server/rollout-core.js
// Pure domain logic - zero fs, zero ctx, zero requires: wave dates, location
// status, waves-config normalisation, per-location projection, dashboard
// aggregation and the merge-only "done" import. Kept requires-free on purpose
// so shard-store.js can require THIS file (for normalizeWaveConfig) without a
// require cycle; the tiny prefix helper below is a private duplicate of
// shard-store.js's prefixOf for exactly that reason - the two must agree
// (both test suites check it) but must never require each other.
//
// Status KEYS are ASCII and separate from their labels; the labels live only
// on the client (client/rollout-lib.js STATUS_LABELS / WAVE_STATUS_LABELS).
//
// Input rows come from the locations module's light index
// (locations/locations.index.json): { code, status, city, region, area,
// district, operator, manager, partner, ... }.

const FIRST_WAVE_DEFAULT = '2026-09-22';
const WAVES_COUNT_DEFAULT = 12;

// A location with status "open" is always in the plan. These statuses count
// only when the row also names an operator (post-trim) - a site that is
// about to open or is briefly closed still needs the rollout.
const OPEN_STATUS = 'open';
const CONDITIONAL_STATUSES = new Set(['contract signed', 'handover', 'temporarily closed']);

/** Adds `days` (may be negative) to an ISO YYYY-MM-DD date string, UTC-safe. */
function addDaysIso(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Derived dates for wave n (1-based): start = first wave + (n-1)*7d; staff
 * training = start-22d..start-21d; location training window =
 * start-20d..start-11d; webinar = start-14d.
 * @param {number} n
 * @param {string} firstWaveStart ISO YYYY-MM-DD
 */
function computeWaveDates(n, firstWaveStart) {
  const start = addDaysIso(firstWaveStart, (n - 1) * 7);
  return {
    wave: n,
    start,
    staff_training_start: addDaysIso(start, -22),
    staff_training_end: addDaysIso(start, -21),
    location_training_start: addDaysIso(start, -20),
    location_training_end: addDaysIso(start, -11),
    webinar: addDaysIso(start, -14),
  };
}

/**
 * 'live' once the wave start date has passed; 'in-progress' once the
 * location training window has opened but the wave has not started yet;
 * else 'planned'. ISO YYYY-MM-DD strings compare correctly as strings.
 */
function computeStoreStatus(waveStart, trainingStart, today) {
  if (today >= waveStart) return 'live';
  if (today >= trainingStart) return 'in-progress';
  return 'planned';
}

/**
 * Normalizes a parsed waves-config.json into { firstWaveStart, wavesCount, managers, source }.
 * Two shapes: the full one ({ first_wave_start, waves_count, managers }, source 'new')
 * and a flat one (a plain manager -> wave number map, source 'flat').
 * Anything else - including a missing/unparsable file, represented here as a
 * falsy `parsed` - falls back to the defaults (source 'default').
 * Individual bad fields inside the full shape (an out-of-range waves_count,
 * an unparsable first_wave_start) fall back on their own without discarding
 * `managers`.
 * @param {unknown} parsed
 */
function normalizeWaveConfig(parsed) {
  const isPlainObject = parsed && typeof parsed === 'object' && !Array.isArray(parsed);
  if (isPlainObject && parsed.managers && typeof parsed.managers === 'object' && !Array.isArray(parsed.managers)) {
    let firstWaveStart = FIRST_WAVE_DEFAULT;
    if (typeof parsed.first_wave_start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(parsed.first_wave_start)) {
      firstWaveStart = parsed.first_wave_start;
    }
    let wavesCount = WAVES_COUNT_DEFAULT;
    const tc = Number(parsed.waves_count);
    if (Number.isInteger(tc) && tc >= 1 && tc <= 52) wavesCount = tc;
    return { firstWaveStart, wavesCount, managers: parsed.managers, source: 'new' };
  }
  if (isPlainObject) {
    return { firstWaveStart: FIRST_WAVE_DEFAULT, wavesCount: WAVES_COUNT_DEFAULT, managers: parsed, source: 'flat' };
  }
  return { firstWaveStart: FIRST_WAVE_DEFAULT, wavesCount: WAVES_COUNT_DEFAULT, managers: {}, source: 'default' };
}

/**
 * A blank manager cell and the literal `Vacant <area>` are INTERCHANGEABLE:
 * an export leaves the cell empty for an unfilled position, and every
 * manager owns exactly one area, so the area is the deterministic key for a
 * blank cell. The locations module applies the same read-time rule. A key
 * the config does not name lands in the out-of-config list UNDER THAT KEY,
 * which is the line the person editing the config has to add.
 */
const VACANT_PREFIX = 'Vacant ';
const NO_MANAGER_LABEL = '(no manager)';

function managerKeyFor(row) {
  const manager = String((row && row.manager) || '').trim();
  if (manager) return manager;
  const area = String((row && row.area) || '').trim();
  return area ? VACANT_PREFIX + area : '';
}

function _isBlankOrVacant(row) {
  const manager = String((row && row.manager) || '').trim();
  return !manager || manager.startsWith(VACANT_PREFIX);
}

function _hasDone(map, id) {
  return !!(id && Object.prototype.hasOwnProperty.call(map || {}, id));
}

/**
 * A location IN the plan without a wave yet: a vacancy (`Vacant <area>`)
 * whose key the config does not name. It counts in every total - it has to
 * be rolled out either way, and a config gap must not shrink the plan - so
 * it rides in `stores` with `wave: null`, no dates, status 'planned',
 * outside every per-wave row.
 */
function projectStoreNoWave(row, ctx) {
  const id = row.code || null;
  return {
    code: id,
    district: row.district || '-',
    area: row.area || '-',
    region: row.region || null,
    manager: ctx.manager || null,
    partner: row.partner || null,
    operator: row.operator || null,
    city: row.city || null,
    wave: null,
    wave_start: null,
    training_start: null,
    training_end: null,
    webinar_date: null,
    training_done: _hasDone(ctx.trainingsDone, id),
    webinar_done: _hasDone(ctx.webinarDone, id),
    rollout_status: 'planned',
  };
}

/**
 * Lean per-location record for the dashboard. NEVER includes phone numbers
 * or e-mails - the light index does not carry them in the first place.
 */
function projectStore(row, ctx) {
  const dates = computeWaveDates(ctx.wave, ctx.firstWaveStart);
  const id = row.code || null;
  return {
    code: id,
    district: row.district || '-',
    area: row.area || '-',
    region: row.region || null,
    manager: managerKeyFor(row) || null,
    partner: row.partner || null,
    operator: row.operator || null,
    city: row.city || null,
    wave: ctx.wave,
    wave_start: dates.start,
    training_start: dates.location_training_start,
    training_end: dates.location_training_end,
    webinar_date: dates.webinar,
    training_done: _hasDone(ctx.trainingsDone, id),
    webinar_done: _hasDone(ctx.webinarDone, id),
    rollout_status: computeStoreStatus(dates.start, dates.location_training_start, ctx.today),
  };
}

/**
 * Joins location rows with waves-config.json (exact manager match). Status
 * "open" (case-insensitive, trimmed) is always included; the
 * CONDITIONAL_STATUSES only when the row has a non-empty operator; any other
 * status is excluded. Locations whose manager is not a config key are out of
 * scope, counted in `diagnostics` instead of silently dropped.
 * @param {Record<string, unknown>[]} rows location index rows
 * @param {{firstWaveStart: string, wavesCount: number, managers: Record<string, unknown>}} waveConfig
 * @param {Record<string, unknown>} trainingsDone code -> {imported_at, source}
 * @param {Record<string, unknown>} webinarDone code -> {imported_at, source}
 * @param {string} today ISO YYYY-MM-DD
 */
function buildStores(rows, waveConfig, trainingsDone, webinarDone, today) {
  const stores = [];
  const matchedManagers = new Set();
  const outOfConfigCounts = new Map();
  let managersOutOfConfig = 0;
  const vacantNoWaveCounts = new Map();
  let vacantNoWave = 0;

  for (const row of rows || []) {
    const status = String(row.status || '').trim().toLowerCase();
    if (status === OPEN_STATUS) {
      // unconditional
    } else if (CONDITIONAL_STATUSES.has(status)) {
      if (!String(row.operator || '').trim()) continue;
    } else {
      continue;
    }

    const manager = managerKeyFor(row);
    if (_isBlankOrVacant(row) && manager && !Object.prototype.hasOwnProperty.call(waveConfig.managers, manager)) {
      vacantNoWave += 1;
      vacantNoWaveCounts.set(manager, (vacantNoWaveCounts.get(manager) || 0) + 1);
      stores.push(projectStoreNoWave(row, { manager, trainingsDone, webinarDone }));
      continue;
    }
    if (!manager || !Object.prototype.hasOwnProperty.call(waveConfig.managers, manager)) {
      managersOutOfConfig += 1;
      // Listed always, blank cells included - an empty list next to a
      // non-zero counter would hide which config line is missing.
      const label = manager || NO_MANAGER_LABEL;
      outOfConfigCounts.set(label, (outOfConfigCounts.get(label) || 0) + 1);
      continue;
    }
    const wave = Number(waveConfig.managers[manager]);
    if (!Number.isInteger(wave) || wave < 1 || wave > waveConfig.wavesCount) continue;

    matchedManagers.add(manager);
    stores.push(projectStore(row, { wave, firstWaveStart: waveConfig.firstWaveStart, trainingsDone, webinarDone, today }));
  }

  const managersNoMatch = Object.keys(waveConfig.managers || {}).filter((m) => !matchedManagers.has(m)).length;
  const byName = (a, b) => a.manager.localeCompare(b.manager);
  return {
    stores,
    diagnostics: {
      managers_out_of_config: managersOutOfConfig,
      managers_no_match: managersNoMatch,
      managers_out_of_config_list: Array.from(outOfConfigCounts.entries()).map(([manager, count]) => ({ manager, stores: count })).sort(byName),
      vacant_no_wave: vacantNoWave,
      vacant_no_wave_list: Array.from(vacantNoWaveCounts.entries()).map(([manager, count]) => ({ manager, stores: count })).sort(byName),
    },
  };
}

/**
 * KPI + N-wave table + next_start, from an already-built location list.
 * @param {object[]} stores from buildStores
 * @param {object} diagnostics from buildStores
 * @param {{firstWaveStart: string, wavesCount: number, managers: object, source: string}} waveConfig
 * @param {string} today ISO YYYY-MM-DD
 * @param {object|null} meta directory metadata to echo back verbatim
 */
function buildDashboard(stores, diagnostics, waveConfig, today, meta) {
  const total = stores.length;
  const live = stores.filter((s) => s.rollout_status === 'live').length;
  const pct = (n, of) => (of ? Math.round((n / of) * 1000) / 10 : 0);

  const waves = [];
  for (let n = 1; n <= waveConfig.wavesCount; n++) {
    const dates = computeWaveDates(n, waveConfig.firstWaveStart);
    const waveStores = stores.filter((s) => s.wave === n);
    const count = waveStores.length;
    let status = 'planned';
    if (today >= dates.start) status = 'done';
    else if (today >= dates.location_training_start) status = 'current';
    waves.push({
      wave: n,
      start: dates.start,
      training_start: dates.location_training_start,
      training_end: dates.location_training_end,
      webinar_date: dates.webinar,
      locations_count: count,
      pct_training: pct(waveStores.filter((s) => s.training_done).length, count),
      pct_webinar: pct(waveStores.filter((s) => s.webinar_done).length, count),
      status,
    });
  }

  return {
    kpi: {
      no_wave: stores.filter((s) => s.wave === null).length,
      locations_count: total,
      live,
      to_go_live: total - live,
      progress_pct: pct(live, total),
      trainings_done: stores.filter((s) => s.training_done).length,
      trainings_total: total,
      webinar_done: stores.filter((s) => s.webinar_done).length,
      webinar_total: total,
    },
    waves,
    next_start: waves.find((t) => t.start >= today) || null,
    diagnostics,
    stores,
    config: {
      first_wave_start: waveConfig.firstWaveStart,
      waves_count: waveConfig.wavesCount,
      managers_count: Object.keys(waveConfig.managers || {}).length,
      source: waveConfig.source,
    },
    directory: meta || null,
  };
}

// Private duplicate of shard-store.js's prefixOf - see file header. Used only
// to report which shards a done-import touched.
function _localPrefixOf(code) {
  const trimmed = String(code === null || code === undefined ? '' : code).trim().toUpperCase();
  return trimmed.length < 3 ? 'other' : trimmed.slice(0, 3);
}

/**
 * Merges `codes` into an already-loaded done-state map. Never removes
 * earlier entries - a code imported twice simply gets a fresher imported_at.
 * Unknown codes are reported, never treated as a fatal error.
 * @param {Record<string, unknown>} currentStores code -> {imported_at, source}
 * @param {string[]} codes raw codes from column A
 * @param {Set<string>} knownCodes valid location codes from the directory
 * @param {string} importedAt ISO timestamp
 * @param {string} source
 * @returns {{stores: object, imported: number, unknown: string[], touchedPrefixes: Set<string>}}
 */
function mergeDoneCodes(currentStores, codes, knownCodes, importedAt, source) {
  const stores = { ...(currentStores || {}) };
  const unknown = [];
  const touchedPrefixes = new Set();
  let imported = 0;

  for (const rawCode of codes || []) {
    const code = String(rawCode === null || rawCode === undefined ? '' : rawCode).trim().toUpperCase();
    if (!code) continue;
    if (!knownCodes.has(code)) { unknown.push(code); continue; }
    stores[code] = { imported_at: importedAt, source: source || 'xlsx' };
    touchedPrefixes.add(_localPrefixOf(code));
    imported += 1;
  }

  return { stores, imported, unknown, touchedPrefixes };
}

module.exports = {
  FIRST_WAVE_DEFAULT,
  WAVES_COUNT_DEFAULT,
  OPEN_STATUS,
  CONDITIONAL_STATUSES,
  VACANT_PREFIX,
  addDaysIso,
  computeWaveDates,
  computeStoreStatus,
  normalizeWaveConfig,
  projectStore, projectStoreNoWave, managerKeyFor,
  buildStores,
  buildDashboard,
  mergeDoneCodes,
};
