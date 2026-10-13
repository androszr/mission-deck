// modules/onboarding/client/onboarding-lib.js
// Pure functions with no document access - importable in plain Node so
// tests/test_onboarding_lib.mjs can exercise every one of these directly.
// Never imports js/utils.js (core ESM, resolves only under /js/... in the
// browser) - normalizeName below is a small local copy for the one thing
// this file needs, diacritic- and case-insensitive substring matching.

// -- view:// links -----------------------------------------------------------

export function isInternalUrl(url) {
  return typeof url === 'string' && url.startsWith('view://');
}

export function viewIdFromUrl(url) {
  return isInternalUrl(url) ? url.slice('view://'.length) : '';
}

// -- Who entries --------------------------------------------------------

const WHO_ENTRY_RE = /^(.*?)\s*\(([^)@]+@[^)]+)\)\s*$/;

export function parseWhoEntries(raw) {
  if (!raw) return [{ name: '', email: '' }];
  const parts = String(raw).split(/\s*,\s*/).filter(Boolean);
  if (parts.length === 0) return [{ name: '', email: '' }];
  return parts.map((part) => {
    const m = WHO_ENTRY_RE.exec(part);
    return m ? { name: m[1].trim(), email: m[2].trim() } : { name: part.trim(), email: '' };
  });
}

/**
 * @param {{name:string,email:string}[]} entries
 * @param {(name:string) => boolean} isMember true when the name resolves to a
 *   team directory record - the e-mail is appended only for someone outside it.
 */
export function buildWhoString(entries, isMember) {
  return (entries || [])
    .filter((e) => e && e.name)
    .map((e) => (e.name && !isMember(e.name) && e.email ? e.name + ' (' + e.email + ')' : e.name))
    .join(', ');
}

/**
 * @param {string} whoRaw
 * @param {(name:string) => string} emailForName looks up a directory e-mail
 */
export function recipientEmails(whoRaw, emailForName) {
  const text = String(whoRaw || '').trim();
  if (!text) return [];
  const parts = text.split(/\s*,\s*/).filter(Boolean);
  const emails = [];
  for (const part of parts) {
    const m = /\(([^)@]+@[^)]+)\)/.exec(part);
    if (m && m[1]) { emails.push(m[1].trim()); continue; }
    const plainName = part.replace(/\s*\([^)]*\)\s*$/, '').trim();
    const email = typeof emailForName === 'function' ? emailForName(plainName) : '';
    if (email) emails.push(email);
  }
  return [...new Set(emails.filter(Boolean))];
}

// -- Teams draft --------------------------------------------------------------

export function buildTeamsDraftUrl(emails, topic, message) {
  const users = (emails || []).filter(Boolean).join(',');
  if (!users) return '';
  const params = [['users', users]];
  if (topic) params.push(['topicName', topic]);
  if (message) params.push(['message', message]);
  return 'https://teams.microsoft.com/l/chat/0/0?' + params
    .map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value))
    .join('&');
}

export function sessionDraftText(row, plan) {
  const topic = (row && row.topic) || (plan && plan.name) || 'onboarding';
  return [
    'Hi,',
    '',
    'My onboarding checklist has this topic:',
    '',
    topic,
    '',
    'Could we schedule a session on it soon?',
  ].join('\n');
}

// -- Dates ---------------------------------------------------------------------

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function pad2(n) { return n < 10 ? '0' + n : '' + n; }

function parseIsoDate(s) {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return { y: parseInt(m[1], 10), mo: parseInt(m[2], 10), d: parseInt(m[3], 10) };
}

export function formatWhen(when) {
  if (!when) return '';
  if (!when.includes('|')) return when;
  const parts = when.split('|');
  const from = parseIsoDate(parts[0] || '');
  const to = parseIsoDate(parts[1] || '');
  const fmt = (dt) => dt.d + ' ' + MONTHS_SHORT[dt.mo - 1];
  if (from && to) {
    if (from.mo === to.mo && from.y === to.y) return from.d + ' - ' + to.d + ' ' + MONTHS_SHORT[from.mo - 1];
    return fmt(from) + ' - ' + fmt(to);
  }
  if (from) return fmt(from);
  if (to) return fmt(to);
  return '';
}

/**
 * @param {number} year
 * @param {number} month zero-based
 * @returns {{firstDow:number, days:number}} firstDow: 0 = Monday
 */
export function monthGrid(year, month) {
  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  return { firstDow, days };
}

// -- Team member search --------------------------------------------------------

const DIACRITICS_MAP = {
  a: '\u0105\u00e0\u00e1\u00e2\u00e3', c: '\u0107', e: '\u0119\u00e8\u00e9\u00ea', l: '\u0142',
  n: '\u0144\u00f1', o: '\u00f3\u00f2\u00f4\u00f5', s: '\u015b\u00df', z: '\u017a\u017c',
};
const DIACRITICS_RE = new RegExp('[' + Object.values(DIACRITICS_MAP).join('') + ']', 'g');

function normalizeName(s) {
  const map = {};
  for (const [plain, variants] of Object.entries(DIACRITICS_MAP)) {
    for (const ch of variants) map[ch] = plain;
  }
  return String(s || '').toLowerCase().replace(DIACRITICS_RE, (c) => map[c] || c).trim();
}

/**
 * @param {object[]} members team directory records {first_name,last_name,...}
 * @param {string} query
 * @param {number} [limit=8]
 */
export function filterMembers(members, query, limit = 8) {
  if (!Array.isArray(members) || members.length === 0) return [];
  const q = normalizeName(query);
  if (!q) return members.slice(0, limit);
  return members
    .filter((m) => {
      const name = [m && m.first_name, m && m.last_name].filter(Boolean).join(' ');
      return normalizeName(name).includes(q);
    })
    .slice(0, limit);
}

// -- Rows ------------------------------------------------------------------------

/** Returns a NEW array with the item at `from` moved to `to`. */
export function moveRow(rows, from, to) {
  const list = Array.isArray(rows) ? rows.slice() : [];
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return list;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  return list;
}

// -- Person chip colour ----------------------------------------------------------

export const CHIP_COLORS = [
  '--brand-accent',
  '--state-info-icon',
  '--state-warning-icon',
  '--state-danger-icon',
  '--state-success-icon',
  '--state-inactive-icon',
];

export function chipColorIndex(name) {
  const s = String(name || '');
  let sum = 0;
  for (let i = 0; i < s.length; i++) sum += s.charCodeAt(i);
  return sum % CHIP_COLORS.length;
}

// -- Plans -------------------------------------------------------------------------

/** Mirrors server/onboarding-store.js:sortPlans - template first, then
 * created_at ascending, then locale-aware name. Used only after POST /plans,
 * so the client does not have to reload GET /plans just to place one new tab. */
export function sortPlans(plans) {
  const list = Array.isArray(plans) ? plans.slice() : [];
  const template = list.find((p) => p && p.id === 'default') || null;
  const rest = list.filter((p) => p && p.id !== 'default').sort((a, b) => {
    const at = a.created_at || '';
    const bt = b.created_at || '';
    if (at !== bt) return at < bt ? -1 : 1;
    return String(a.name || '').localeCompare(String(b.name || ''), 'en');
  });
  return template ? [template, ...rest] : rest;
}

export function activePlanOrDefault(plans, storedId) {
  const list = Array.isArray(plans) ? plans : [];
  return list.find((p) => p && p.id === storedId) || list[0] || null;
}
