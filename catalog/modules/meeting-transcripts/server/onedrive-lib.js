'use strict';
// modules/meeting-transcripts/server/onedrive-lib.js
// Pure rules of the OneDrive / SharePoint source - shared by the server
// (index.js, settings and schedule) and the browser worker (sso-worker.js).
// Folder parsing, filters and the daily slot that decides when Teams
// recordings are downloaded (by default at 01:00).

const LOGIN_HOSTS = Object.freeze([
  'login.microsoftonline.com',
  'login.microsoft.com',
  'login.live.com',
  'account.activedirectory.windowsazure.com',
]);

const VIDEO_EXTS = Object.freeze(['.mp4', '.mov', '.wmv', '.mkv', '.m4v', '.avi', '.webm', '.mp3', '.m4a', '.wav']);

// No folder is watched until somebody adds one in the settings: every OneDrive
// folder belongs to a real person and tenant, so none can ship as a default.
// Example of a folder path: /personal/alex_morgan_contoso_com/Documents/Recordings
const DEFAULT_FOLDERS = Object.freeze([]);

const DEFAULT_SETTINGS = Object.freeze({
  schedule: { enabled: true, time: '01:00' },
  minSizeMb: 50,
  sinceDate: '2026-08-25',
  maxFilesPerRun: 20,
  autoPublish: false,
  keepaliveHours: 4,
  paused: false,
});

// Manual label -> name assignments; empty by default (the org-label rule in
// frames.js resolves "BS Morg", "BS Riv" etc. from the team directory).
const DEFAULT_ALIASES = Object.freeze([]);

function normalizeAliases(raw) {
  const out = [];
  for (const a of Array.isArray(raw) ? raw : DEFAULT_ALIASES) {
    const label = typeof (a && a.label) === 'string' ? a.label.trim().slice(0, 80) : '';
    const name = typeof (a && a.name) === 'string' ? a.name.trim().slice(0, 80) : '';
    if (label.length >= 3 && name && !out.some((x) => x.label.toLowerCase() === label.toLowerCase())) out.push({ label, name });
    if (out.length >= 100) break;
  }
  return out;
}

const KEEPALIVE_HOURS = Object.freeze([0, 1, 2, 4, 8, 12]);

const MAX_FOLDERS = 30;
const MAX_ATTEMPTS = 3;
const SETTLE_MS = 15 * 60 * 1000; // a file modified less than this ago may still be uploading
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SITE_RE = /^\/(personal|sites|teams)\/[A-Za-z0-9_.-]+$/;
// The worker names the download <uniqueId><ext> inside inbox/: the id comes
// from SharePoint, so it must be a plain file-name token (queue.isValidInput).
const UNIQUE_ID_RE = /^[a-z0-9{}_-][a-z0-9{}._-]{0,79}$/;

/**
 * A OneDrive / SharePoint folder address -> its parts, or null.
 * Accepts the browser address of the folder view (`...onedrive.aspx?id=<path>`,
 * `.../my?id=<path>`, `.../Forms/AllItems.aspx?id=<path>`) and the direct path
 * (`https://<host>/personal/<user>/Documents/<folder>`). Sharing links
 * (`/:f:/g/...`) carry no path and are refused.
 * @param {unknown} raw
 * @returns {{host: string, site: string, siteUrl: string, serverRelativePath: string, url: string}|null}
 */
function parseFolderUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2000) return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || !/^[a-z0-9-]+(-my)?\.sharepoint\.com$/i.test(u.hostname)) return null;
  let p = u.searchParams.get('id') || '';
  if (!p) {
    try { p = decodeURIComponent(u.pathname); } catch { return null; }
    // "/:f:/r/<path>" (copy-link "redirect" form) carries the real path;
    // "/:f:/g/<token>" is an opaque sharing token and stays refused.
    p = p.replace(/^\/:[a-z]:\/r(?=\/)/i, '');
    if (/^\/:[a-z]:\//i.test(p) || /\/_layouts\//i.test(p) || /\.aspx$/i.test(p)) return null;
  }
  p = p.replace(/\/+$/, '');
  if (!p.startsWith('/') || p.split('/').some((s) => s === '..' || s === '.')) return null;
  if (/['\u0000-\u001f]/.test(p)) return null;
  const segs = p.split('/');
  const site = '/' + segs[1] + '/' + segs[2];
  if (!SITE_RE.test(site) || segs.length < 4) return null;
  const host = u.hostname.toLowerCase();
  return {
    host,
    site,
    siteUrl: 'https://' + host + site,
    serverRelativePath: p,
    url: 'https://' + host + p.split('/').map(encodeURIComponent).join('/'),
  };
}

/** Stable short id of a folder (the path, hashed). */
function folderId(serverRelativePath, host) {
  let h = 2166136261;
  const s = host + '|' + serverRelativePath.toLowerCase();
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return 'f' + h.toString(36);
}

/**
 * Normalised folder entry, or null.
 * @param {{label?: unknown, url?: unknown, enabled?: unknown}} f
 */
function normalizeFolder(f) {
  const parsed = parseFolderUrl(f && f.url);
  if (!parsed) return null;
  const label = typeof f.label === 'string' && f.label.trim()
    ? f.label.trim().slice(0, 80)
    : parsed.serverRelativePath.split('/').slice(-1)[0].slice(0, 80); // already decoded by parseFolderUrl
  return {
    id: folderId(parsed.serverRelativePath, parsed.host),
    label,
    url: parsed.url,
    host: parsed.host,
    siteUrl: parsed.siteUrl,
    serverRelativePath: parsed.serverRelativePath,
    enabled: f.enabled !== false,
  };
}

/**
 * Settings with every field validated; unknown keys dropped.
 * @param {object|null} raw stored settings (null on first start -> defaults, no folders)
 */
function normalizeSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : null;
  const d = DEFAULT_SETTINGS;
  const sched = (r && r.schedule) || {};
  const folders = [];
  const seen = new Set();
  for (const f of (r && Array.isArray(r.folders) ? r.folders : DEFAULT_FOLDERS)) {
    const n = normalizeFolder(f);
    if (n && !seen.has(n.id) && folders.length < MAX_FOLDERS) { seen.add(n.id); folders.push(n); }
  }
  const num = (v, min, max, def) => (v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max ? Math.round(Number(v)) : def);
  return {
    schedule: {
      enabled: typeof sched.enabled === 'boolean' ? sched.enabled : d.schedule.enabled,
      time: TIME_RE.test(sched.time || '') ? sched.time : d.schedule.time,
    },
    folders,
    minSizeMb: num(r && r.minSizeMb, 0, 5000, d.minSizeMb),
    sinceDate: r && (r.sinceDate === null || DATE_RE.test(r.sinceDate || '')) ? r.sinceDate : d.sinceDate,
    maxFilesPerRun: num(r && r.maxFilesPerRun, 1, 100, d.maxFilesPerRun),
    autoPublish: !!(r && r.autoPublish),
    paused: !!(r && r.paused),
    aliases: normalizeAliases(r ? r.aliases : undefined),
    keepaliveHours: r && KEEPALIVE_HOURS.includes(Number(r.keepaliveHours)) && r.keepaliveHours !== null ? Number(r.keepaliveHours) : d.keepaliveHours,
  };
}

/** Lower-case extension with the dot, or ''. */
function extOf(name) {
  const m = /\.[A-Za-z0-9]{1,5}$/.exec(String(name || ''));
  return m ? m[0].toLowerCase() : '';
}

/**
 * Which listed files are worth downloading, oldest first.
 * @param {{Name: string, Length: string|number, TimeLastModified: string, TimeCreated?: string, UniqueId: string}[]} files
 * @param {{minBytes: number, sinceIso: string|null, known: Set<string>, archivedNames: Set<string>, nowMs: number}} o
 * @returns {{take: object[], skipped: {reason: string, name: string}[]}}
 */
function pickNewFiles(files, o) {
  const take = [];
  const skipped = [];
  for (const f of files || []) {
    if (!f || typeof f.Name !== 'string' || !f.UniqueId) continue;
    const name = f.Name;
    const id = String(f.UniqueId).toLowerCase();
    if (!UNIQUE_ID_RE.test(id) || id.includes('..')) { skipped.push({ reason: 'bad-id', name }); continue; }
    const size = Number(f.Length) || 0;
    const mtime = Date.parse(f.TimeLastModified || '') || 0;
    const ctime = Date.parse(f.TimeCreated || '') || mtime;
    if (o.known.has(id)) continue;
    if (!VIDEO_EXTS.includes(extOf(name))) { skipped.push({ reason: 'ext', name }); continue; }
    if (size < o.minBytes) { skipped.push({ reason: 'size', name }); continue; }
    if (o.sinceIso && ctime && ctime < Date.parse(o.sinceIso)) { skipped.push({ reason: 'old', name }); continue; }
    if (o.archivedNames.has(name)) { skipped.push({ reason: 'archived', name, uniqueId: id }); continue; }
    if (mtime && o.nowMs - mtime < SETTLE_MS) { skipped.push({ reason: 'settling', name }); continue; }
    take.push({ uniqueId: id, name, size, created: f.TimeCreated || null, modified: f.TimeLastModified || null });
  }
  take.sort((a, b) => String(a.created).localeCompare(String(b.created)));
  return { take, skipped };
}

/**
 * Local slot key and instant of today's scheduled run.
 * @param {string} time 'HH:MM'
 * @param {Date} now
 * @returns {{key: string, at: Date}}
 */
function todaySlot(time, now) {
  const [h, m] = time.split(':').map(Number);
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return { key: at.getFullYear() + '-' + pad(at.getMonth() + 1) + '-' + pad(at.getDate()) + 'T' + time, at };
}

/**
 * Is a keepalive due? Never while hours is 0 (off).
 * @param {number} hours
 * @param {string|null} lastIso last keepalive (or login / scan that touched the sites)
 * @param {number} nowMs
 */
function keepaliveDue(hours, lastIso, nowMs) {
  if (!hours) return false;
  const last = Date.parse(lastIso || '') || 0;
  return nowMs - last >= hours * 3600 * 1000;
}

/**
 * Is a scheduled run due? Once per day, at or after the slot; a machine that
 * was asleep at 01:00 runs when it wakes the same day.
 * @param {{enabled: boolean, time: string}} schedule
 * @param {string|null} lastSlot key of the last slot that ran
 * @param {Date} now
 */
function isDue(schedule, lastSlot, now) {
  if (!schedule || !schedule.enabled) return false;
  const slot = todaySlot(schedule.time, now);
  return now >= slot.at && lastSlot !== slot.key;
}

/** ISO of the next scheduled run. */
function nextRunAt(schedule, lastSlot, now) {
  if (!schedule || !schedule.enabled) return null;
  const slot = todaySlot(schedule.time, now);
  if (lastSlot !== slot.key) return (now >= slot.at ? now : slot.at).toISOString();
  const tomorrow = new Date(slot.at.getTime());
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString();
}

module.exports = {
  LOGIN_HOSTS, VIDEO_EXTS, KEEPALIVE_HOURS, keepaliveDue, normalizeAliases, DEFAULT_FOLDERS, DEFAULT_SETTINGS, MAX_ATTEMPTS, SETTLE_MS,
  parseFolderUrl, folderId, normalizeFolder, normalizeSettings, extOf, pickNewFiles, todaySlot, isDue, nextRunAt,
};
