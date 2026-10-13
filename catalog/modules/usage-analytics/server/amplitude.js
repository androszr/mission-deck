'use strict';
// modules/usage-analytics/server/amplitude.js
// Amplitude Export API in pure Node (modules never import from each other, so
// the CET helpers live here). The export is the WHOLE Amplitude project: every
// record that is not stamped event_properties.cockpit with one of COCKPIT_STAMPS
// belongs to another app sharing the project and is dropped line by line while
// streaming. What survives is a
// closed whitelist (normalizeEvent) - nothing else is read off the record.
//
// Keys are read from process.env by the caller (server/index.js) at request
// time and handed in as `auth`; this file never touches process.env.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { Readable } = require('stream');
const { DAY_RE, readJsonSafe, writeJsonAtomic } = require('./paths.js');

const EXPORT_URL = 'https://analytics.eu.amplitude.com/api/2/export';
const ZIP_LIMITS = { maxEntries: 500, maxFileBytes: 64 * 1024 * 1024, maxTotalBytes: 256 * 1024 * 1024, maxMemberOutputBytes: 4 * 1024 * 1024 * 1024 };
// The value the core's analytics enrichment stamps on event_properties.cockpit.
const COCKPIT_STAMPS = new Set(['mission-deck', 'starter']);
// taxonomy v1 of Mission Deck; nothing before this day is ours
const FLOOR_DAY = '2026-07-29';
const MAX_HISTORY_DAYS = 180;
const SETTLE_MS = 6 * 60 * 60 * 1000;

const KEEP_EVENTS = new Set([
  'View Viewed', 'View Exited', 'View Render Failed', 'Toast Shown',
  'Data Repo Sync Started', 'Data Repo Sync Finished', 'session_start', 'session_end',
]);
const PROP_KEYS = [
  'view', 'base_view', 'sub_path', 'view_title', 'hub_group', 'previous_view', 'trigger',
  'duration_ms', 'phase', 'message', 'variant', 'title', 'repo', 'operation', 'outcome',
  'app_version', 'app_hash',
];

function _pad(n, width) {
  return String(n).padStart(width, '0');
}

function lastSunday(year, month1) {
  const lastDayOfMonth = new Date(Date.UTC(year, month1, 0));
  const dow = lastDayOfMonth.getUTCDay();
  return new Date(Date.UTC(year, month1 - 1, lastDayOfMonth.getUTCDate() - dow));
}

/** UTC offset (hours) of a CET/CEST calendar day. */
function cetOffset(dayIso) {
  const [y, m, d] = dayIso.split('-').map(Number);
  const dayUtcMs = Date.UTC(y, m - 1, d);
  return (dayUtcMs >= lastSunday(y, 3).getTime() && dayUtcMs < lastSunday(y, 10).getTime()) ? 2 : 1;
}

function _dayStr(d) {
  return _pad(d.getUTCFullYear(), 4) + '-' + _pad(d.getUTCMonth() + 1, 2) + '-' + _pad(d.getUTCDate(), 2);
}

function _dateTimeStr(d) {
  return _dayStr(d) + ' ' + _pad(d.getUTCHours(), 2) + ':' + _pad(d.getUTCMinutes(), 2) + ':' + _pad(d.getUTCSeconds(), 2);
}

/** Amplitude event_time (UTC, no offset) -> Date whose UTC getters read CET/CEST wall-clock time. */
function utcToCet(eventTime) {
  if (!eventTime) return null;
  const ms = Date.parse(String(eventTime).slice(0, 19).replace(' ', 'T') + 'Z');
  if (!Number.isFinite(ms)) return null;
  const y = new Date(ms).getUTCFullYear();
  const cestStartMs = Date.UTC(y, 2, lastSunday(y, 3).getUTCDate(), 2, 0, 0);
  const cestEndMs = Date.UTC(y, 9, lastSunday(y, 10).getUTCDate(), 1, 0, 0);
  return new Date(ms + ((ms >= cestStartMs && ms < cestEndMs) ? 2 : 1) * 3600000);
}

/** Export API window covering CET day dayIso (hour granularity). */
function dayParams(dayIso) {
  const [y, m, d] = dayIso.split('-').map(Number);
  const off = cetOffset(dayIso);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  const startDatePart = _pad(prev.getUTCFullYear(), 4) + _pad(prev.getUTCMonth() + 1, 2) + _pad(prev.getUTCDate(), 2);
  const endDatePart = _pad(y, 4) + _pad(m, 2) + _pad(d, 2);
  return { start: startDatePart + 'T' + _pad(24 - off, 2), end: endDatePart + 'T' + _pad(23 - off, 2) };
}

function _addDays(dayIso, n) {
  const [y, m, d] = dayIso.split('-').map(Number);
  return _dayStr(new Date(Date.UTC(y, m - 1, d + n)));
}

/** CET calendar day of an epoch ms (default: now). */
function todayCet(nowMs) {
  return _dayStr(utcToCet(new Date(nowMs === undefined ? Date.now() : nowMs).toISOString().slice(0, 19).replace('T', ' ')));
}

/** Epoch ms of the end of CET/CEST day dayIso. */
function dayEndMs(dayIso) {
  const [y, m, d] = dayIso.split('-').map(Number);
  return Date.UTC(y, m - 1, d + 1) - cetOffset(dayIso) * 3600000;
}

/**
 * One raw export record -> the compact stored record, or null when it is not ours.
 * @param {object} raw
 * @param {string} [dayIso] when given, the CET day of the event must equal it
 */
function normalizeEvent(raw, dayIso) {
  if (!raw || typeof raw !== 'object') return null;
  const ep = (raw.event_properties && typeof raw.event_properties === 'object') ? raw.event_properties : {};
  if (!COCKPIT_STAMPS.has(ep.cockpit)) return null;
  const type = raw.event_type;
  if (!KEEP_EVENTS.has(type)) return null;
  const cet = utcToCet(raw.event_time);
  if (!cet) return null;
  if (dayIso && _dayStr(cet) !== dayIso) return null;
  const p = {};
  for (const k of PROP_KEYS) {
    const v = ep[k];
    if (v === undefined || v === null || typeof v === 'object') continue;
    p[k] = v;
  }
  const sid = Number(raw.session_id);
  const up = (raw.user_properties && typeof raw.user_properties === 'object') ? raw.user_properties : {};
  const out = {
    t: _dateTimeStr(cet),
    e: type,
    u: raw.user_id ? String(raw.user_id) : null,
    s: Number.isFinite(sid) && sid > 0 ? sid : null,
    p,
  };
  if (typeof up.full_name === 'string' && up.full_name.trim()) out.up = { full_name: up.full_name.trim() };
  return out;
}

/**
 * Unpacks one Export API response (outer zip of gzipped JSONL) and keeps only
 * our events. Streamed line by line, never gunzipSync'd into one string (a
 * peak-hour member is far larger than any sane string cap).
 * @returns {Promise<object[]>} records sorted by t
 */
async function recordsFromExportZip(buf, dayIso, readZip, stats) {
  const entries = readZip(buf, ZIP_LIMITS);
  if (stats) stats.entries = entries.length;
  const out = [];
  for (const entry of entries) {
    let seen = 0;
    try {
      const rl = readline.createInterface({ input: Readable.from([entry.data]).pipe(zlib.createGunzip()), crlfDelay: Infinity });
      for await (const line of rl) {
        seen += line.length + 1;
        if (seen > ZIP_LIMITS.maxMemberOutputBytes) throw new Error('member too large');
        const trimmed = line.trim();
        if (!trimmed) continue;
        let ev;
        try { ev = JSON.parse(trimmed); } catch { continue; }
        const rec = normalizeEvent(ev, dayIso);
        if (rec) out.push(rec);
      }
    } catch {
      if (stats) { stats.skipped = (stats.skipped || 0) + 1; }
    }
  }
  out.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return out;
}

/**
 * @param {string[]} cachedDays days already cached AND settled ('YYYY-MM-DD')
 * @param {string} todayIso CET today
 * @param {string} [floorIso] earliest day worth fetching
 * @returns {string[]} days to fetch, ascending. Today and yesterday are always included.
 */
function planDays(cachedDays, todayIso, floorIso) {
  const have = new Set(cachedDays || []);
  const yesterday = _addDays(todayIso, -1);
  let start = floorIso || FLOOR_DAY;
  const clamp = _addDays(todayIso, -MAX_HISTORY_DAYS);
  if (start < clamp) start = clamp;
  const days = [];
  let cur = start;
  let guard = 0;
  while (cur <= todayIso && guard < 2000) {
    if (cur >= yesterday || !have.has(cur)) days.push(cur);
    cur = _addDays(cur, 1);
    guard += 1;
  }
  return days;
}

/**
 * @param {string} dayIso
 * @param {{key: string, secret: string}} auth
 * @param {(url: string, opts: object) => Promise<Response>} fetchImpl injected: tests never hit the network
 * @param {Function} readZip scripts/zip.js readZip
 * @param {AbortSignal} [signal]
 */
async function fetchDay(dayIso, auth, fetchImpl, readZip, signal) {
  const { start, end } = dayParams(dayIso);
  const url = EXPORT_URL + '?start=' + start + '&end=' + end;
  const authHeader = 'Basic ' + Buffer.from(auth.key + ':' + auth.secret).toString('base64');
  const resp = await fetchImpl(url, { headers: { Authorization: authHeader }, signal });
  if (resp.status === 404) return [];
  if (!resp.ok) {
    const err = new Error('Amplitude export ' + dayIso + ': HTTP ' + resp.status);
    err.status = resp.status;
    throw err;
  }
  const arrayBuffer = await resp.arrayBuffer();
  return recordsFromExportZip(Buffer.from(arrayBuffer), dayIso, readZip);
}

/** Cheap listing (file names only): the cached day strings, sorted. */
function listCacheDays(cacheDir) {
  try {
    return fs.readdirSync(cacheDir).filter((f) => f.endsWith('.json') && DAY_RE.test(f.slice(0, -5))).map((f) => f.slice(0, -5)).sort();
  } catch {
    return [];
  }
}

/**
 * Reads every day file. `full` = fetched after the day settled (Amplitude lags
 * a few hours), so only settled days are skipped by planDays.
 * @returns {{days: Array<{date: string, count: number, full: boolean}>, events: object[]}}
 */
function readCache(cacheDir) {
  const days = [];
  const events = [];
  for (const day of listCacheDays(cacheDir)) {
    const shard = readJsonSafe(path.join(cacheDir, day + '.json'));
    if (!shard) continue;
    const list = Array.isArray(shard.events) ? shard.events : [];
    const fetchedMs = Date.parse(shard.fetched_at || '');
    days.push({ date: day, count: list.length, full: Number.isFinite(fetchedMs) && fetchedMs >= dayEndMs(day) + SETTLE_MS });
    for (const ev of list) events.push(ev);
  }
  return { days, events };
}

/** Local cache write (fetched_at never leaves this machine). */
function writeDayFile(cacheDir, dayIso, events) {
  const payload = { date: dayIso, count: events.length, events, fetched_at: new Date().toISOString() };
  writeJsonAtomic(path.join(cacheDir, dayIso + '.json'), payload);
  return payload;
}

module.exports = {
  FLOOR_DAY, MAX_HISTORY_DAYS, SETTLE_MS, KEEP_EVENTS,
  lastSunday, cetOffset, utcToCet, dayParams, todayCet, dayEndMs,
  normalizeEvent, recordsFromExportZip, planDays, fetchDay, listCacheDays, readCache, writeDayFile,
  addDays: _addDays,
};
