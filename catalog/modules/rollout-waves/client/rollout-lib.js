// rollout-waves/client/rollout-lib.js
// Pure functions for the Rollout waves view - no browser document, no fetch, so
// tests/test_rollout_lib.mjs can import this file directly in plain Node.
//
// Status KEYS coming off the server are ASCII (rollout_status:
// 'live' | 'in-progress' | 'planned'; a wave's status:
// 'done' | 'current' | 'planned') and are never compared against
// a label - STATUS_LABELS / WAVE_STATUS_LABELS hold the text a person
// reads, keyed by those same ASCII keys.

/** Escapes a value for safe insertion into HTML text content. */
export function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** "12.5%" - one decimal place. An unknown value reads as a dash. */
export function fmtPct(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toFixed(1) + '%';
}

/** "2026-10-13" -> "13.10.2026". An unusable value reads as a dash. */
export function fmtDate(iso) {
  if (!iso || typeof iso !== 'string' || iso.length < 10) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return d + '.' + m + '.' + y;
}

export const STATUS_LABELS = {
  live: 'Live',
  'in-progress': 'In progress',
  planned: 'Planned',
};

export const WAVE_STATUS_LABELS = {
  done: 'Done',
  current: 'Current',
  planned: 'Planned',
};

const BADGE_CLASS_MAP = {
  live: 'ds-badge--green',
  'in-progress': 'ds-badge--yellow',
  planned: 'ds-badge--gray',
  done: 'ds-badge--green',
  current: 'ds-badge--yellow',
};

/** ASCII status key -> ds-badge modifier. Unknown keys read as neutral gray. */
export function statusBadgeClass(key) {
  return BADGE_CLASS_MAP[key] || 'ds-badge--gray';
}

/**
 * Diacritic- and case-insensitive fold, mirroring the app's name
 * normaliser: an NFD pass strips combining marks, but the stroked L and the Scandinavian/Croatian D-with-stroke and O-with-slash do
 * NOT decompose under NFD, so they are folded explicitly afterwards - or a
 * name spelled with one of them would never match its plain-ASCII query.
 */
function _normalizeSearch(s) {
  return String(s === null || s === undefined ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u0142\u0141]/g, 'l')
    .replace(/[\u0111\u0110]/g, 'd')
    .replace(/[\u00f8\u00d8]/g, 'o')
    .toLowerCase();
}

/**
 * The single searchable string behind one store row - code, city,
 * operator, manager, partner and district, folded through
 * `_normalizeSearch` and joined with spaces. Computed ONCE per store when a
 * payload lands (client/index.js, right after every fetch that can change the
 * store list), never per keystroke: ten thousand rows repainting on every key makes
 * a per-keystroke rebuild the difference between smooth typing and a
 * stutter. `matchesFilters` falls back to calling this itself when a row
 * carries no precomputed haystack, so a bare fixture needs no preparation.
 * @param {object} s a projected store record from GET /dashboard
 * @returns {string}
 */
export function buildHaystack(s) {
  const rec = s || {};
  return _normalizeSearch([
    rec.code, rec.city, rec.operator, rec.manager, rec.partner, rec.district,
  ].map((v) => (v === null || v === undefined ? '' : v)).join(' '));
}

/**
 * AND-semantics filter used by both the KPI recompute and the store table.
 * @param {object} s a projected store record from GET /dashboard, optionally
 *   carrying a precomputed `__haystack` (see `buildHaystack`)
 * @param {{activeWave?: string, district?: string, manager?: string, partner?: string, search?: string}} filters
 * @returns {boolean}
 */
export function matchesFilters(s, filters) {
  const f = filters || {};
  if (f.activeWave && f.activeWave !== 'all' && String(s.wave) !== f.activeWave) return false;
  if (f.district && s.district !== f.district) return false;
  if (f.manager && s.manager !== f.manager) return false;
  if (f.partner && s.partner !== f.partner) return false;
  if (f.search) {
    // Collapsed on split + filter(Boolean): a leading/trailing/doubled space
    // never produces an empty token, and an all-whitespace query yields no
    // tokens at all, which is "no filter" rather than "match nothing".
    const tokens = _normalizeSearch(f.search).split(/\s+/).filter(Boolean);
    if (tokens.length > 0) {
      const hay = (typeof s.__haystack === 'string') ? s.__haystack : buildHaystack(s);
      for (const t of tokens) {
        if (hay.indexOf(t) === -1) return false;
      }
    }
  }
  return true;
}

/**
 * KPI numbers recomputed from whatever store list is currently visible
 * (usually the filtered one), so the bar reacts to every filter change
 * without a round trip to the server.
 * @param {Array<object>} stores
 * @returns {{locations_count:number, live:number, to_go_live:number, progress_pct:number, trainings_done:number, trainings_total:number, webinar_done:number, webinar_total:number}}
 */
export function computeKpi(stores) {
  const list = Array.isArray(stores) ? stores : [];
  const total = list.length;
  let live = 0;
  let trainingDone = 0;
  let webinarDone = 0;
  for (const s of list) {
    if (s.rollout_status === 'live') live++;
    if (s.training_done) trainingDone++;
    if (s.webinar_done) webinarDone++;
  }
  return {
    locations_count: total,
    live,
    to_go_live: total - live,
    progress_pct: total > 0 ? (live / total) * 100 : 0,
    trainings_done: trainingDone,
    trainings_total: total,
    webinar_done: webinarDone,
    webinar_total: total,
  };
}

/** Unique, non-empty ('-' is a placeholder, not a value), 'en'-sorted list. */
function uniqSorted(values) {
  const set = new Set((values || []).filter((v) => v && v !== '-'));
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'en'));
}

/**
 * The single-wave breakdown behind the "Waves table" expander: every manager,
 * partner, district and store code that wave touches, each list unique and
 * sorted. Built from the FULL (unfiltered) store list - the plan of a wave is
 * independent of whatever filter the dashboard currently has applied.
 * @param {Array<object>} stores
 * @param {number} waveN
 * @returns {{managers:string[], partners:string[], districts:string[], locations:string[]}}
 */
export function buildWaveDetail(stores, waveN) {
  const list = Array.isArray(stores) ? stores : [];
  const waveStores = list.filter((s) => s.wave === waveN);
  return {
    managers: uniqSorted(waveStores.map((s) => s.manager)),
    partners: uniqSorted(waveStores.map((s) => s.partner)),
    districts: uniqSorted(waveStores.map((s) => s.district)),
    locations: uniqSorted(waveStores.map((s) => s.code)),
  };
}

/**
 * Managers grouped by wave, each with the union of districts they cover in that
 * wave - the data behind the "Managers per wave" modal. `waves` (from
 * GET /dashboard) supplies the display order; a wave with no manager in the
 * store list is simply absent from the result.
 * @param {Array<object>} stores
 * @param {Array<{wave:number}>} waves
 * @returns {Array<{wave:number, rows: Array<{manager:string, districts:string}>}>}
 */
export function buildManagersPerWave(stores, waves) {
  const list = Array.isArray(stores) ? stores : [];
  const wavesList = Array.isArray(waves) ? waves : [];
  const byWave = new Map();
  for (const s of list) {
    if (s.wave === null || s.wave === undefined || !s.manager) continue;
    if (!byWave.has(s.wave)) byWave.set(s.wave, new Map());
    const managers = byWave.get(s.wave);
    if (!managers.has(s.manager)) managers.set(s.manager, new Set());
    managers.get(s.manager).add(s.district || '-');
  }

  const order = wavesList.length > 0
    ? wavesList.map((t) => t.wave)
    : Array.from(byWave.keys()).sort((a, b) => a - b);

  const groups = [];
  for (const wave of order) {
    const managers = byWave.get(wave);
    if (!managers) continue;
    const names = Array.from(managers.keys()).sort((a, b) => a.localeCompare(b, 'en'));
    const rows = names.map((manager) => ({
      manager,
      districts: Array.from(managers.get(manager)).sort((a, b) => a.localeCompare(b, 'en')).join(', '),
    }));
    groups.push({ wave, rows });
  }
  return groups;
}

function doneBadgeHtml(done) {
  return done
    ? '<span class="ds-badge ds-badge--green ds-badge--sm">Yes</span>'
    : '<span class="ds-badge ds-badge--gray ds-badge--sm">No</span>';
}

/**
 * One mobile card for the narrow-viewport fallback of the store table. Every
 * value is escaped; a field with nothing to show is omitted rather than
 * printed empty.
 * @param {object} s a projected store record from GET /dashboard
 * @returns {string}
 */
export function storeCardHtml(s) {
  const badgeCls = statusBadgeClass(s.rollout_status);
  const statusLabel = STATUS_LABELS[s.rollout_status] || '—';
  const waveLabel = s.wave !== null && s.wave !== undefined ? 'W' + esc(String(s.wave)) : '—';
  const kv = (label, value) => (value
    ? '<div class="rollout-waves-store-card-row"><span class="rollout-waves-store-card-k">' + esc(label)
      + '</span><span class="rollout-waves-store-card-v">' + esc(value) + '</span></div>'
    : '');
  return '<div class="ds-card rollout-waves-store-card">'
    + '<div class="rollout-waves-store-card-head">'
    + '<code>' + esc(s.code) + '</code>'
    + '<span class="ds-badge ' + badgeCls + ' ds-badge--sm">' + esc(statusLabel) + '</span>'
    + '</div>'
    + kv('Wave', waveLabel)
    + kv('District', s.district)
    + kv('Manager', s.manager)
    + kv('Partner', s.partner)
    + kv('Operator', s.operator)
    + kv('City', s.city)
    + '<div class="rollout-waves-store-card-badges">'
    + '<span class="rollout-waves-store-card-k">Training</span>' + doneBadgeHtml(s.training_done)
    + '<span class="rollout-waves-store-card-k">Webinar</span>' + doneBadgeHtml(s.webinar_done)
    + '</div></div>';
}
