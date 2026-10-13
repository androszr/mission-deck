// ── Mission Deck — js/team-directory.js ──────────────────────────────────
// The team directory: who is on the team and what they look like.
//
// The data lives in the data repo, which the server serves statically with
// no-cache, so this module needs no endpoint:
//
//   /data-sub-repositories/ds-data/team/team-members.json
//   /data-sub-repositories/ds-data/team/avatars/<file>
//
// Written by `node scripts/build-team-directory.js`. A fresh clone of the data
// repo has neither, so every function here works on an empty directory and the
// caller falls back to initials - a missing file is a normal state, never an
// error in the console.
//
// ONE resolver. Every place that shows a person - the top bar today, a card, a
// table or an assignee chip tomorrow - calls memberByName() and never matches
// names on its own. Matching is the hard part: a name reaches this app from a
// git identity, a Jira assignee or a hand-typed cell, so it may carry a
// contract code ("BS Jordan Lee"), a parenthesised suffix, different diacritics
// or the surname first.

import { normalizeSearch, initials } from './utils.js';

const DIRECTORY_URL = '/data-sub-repositories/ds-data/team/team-members.json';
const AVATARS_BASE = '/data-sub-repositories/ds-data/team/avatars/';

// Contract and unit codes glued to a display name by the systems this app reads
// from. Stripped before matching, never shown.
const ROLE_CODE_RE = /^(?:BS|BD|CTR|7N|I2S|BRI|AWA|DT|LG)\s+|\s+(?:BS|BD|CTR|7N|I2S|BRI|AWA|DT|LG)$|\s*\([^)]*\)\s*$/gi;

/**
 * Module-scope cache: the directory is one small file, fetched once - once it
 * ANSWERS. A miss is not cached: on a fresh install the top bar asks for the
 * roster the moment the page opens, while the data repo is still being cloned
 * or decrypted, and a 404 remembered for the whole session left every view
 * (the leave calendar first of all) on initials until an F5 - the data was on
 * disk, the browser had simply stopped asking. A 404 costs one small request
 * per caller, so asking again is the right trade.
 */
let _members = [];
let _loaded = false;
let _inFlight = null;

/**
 * Strip contract codes and a trailing parenthesised suffix from a name.
 * @param {string} name
 * @returns {string}
 */
function stripRoleCodes(name) {
  return String(name || '').replace(ROLE_CODE_RE, '').trim();
}

/**
 * Comparison key for a person name: diacritic- and case-insensitive, and blind
 * to the separator inside a double surname. A git identity, Jira or a typed
 * cell often spells "Morgan-Rivera" as "Morgan Rivera" (or with an en
 * dash), so a hyphen or dash counts as a space and runs of spaces collapse.
 * @param {string} name
 * @returns {string}
 */
function nameKey(name) {
  return normalizeSearch(name).replace(/[-\u2010-\u2015]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * "First Last" for one member record.
 * @param {object|null} member
 * @returns {string}
 */
export function fullName(member) {
  if (!member) return '';
  return [member.first_name, member.last_name].filter(Boolean).join(' ').trim();
}

/**
 * Fetch the directory once. Fire-and-forget: a data repo without a team folder
 * leaves the directory empty, which every caller already handles.
 * @param {boolean} [force] refetch even when the cache is warm
 * @returns {Promise<object[]>}
 */
export function loadTeamDirectory(force) {
  if (_loaded && !force) return Promise.resolve(_members);
  if (_inFlight) return _inFlight;
  _inFlight = fetch(DIRECTORY_URL, { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      // A miss after a hit (a forced reload during a network blip) keeps the
      // roster it already has; only a miss with nothing loaded yet stays empty.
      if (!data) { if (!_loaded) _members = []; return _members; }
      const list = Array.isArray(data.team_members) ? data.team_members : [];
      _members = list;
      _loaded = true;
      return _members;
    })
    .catch(() => {
      if (!_loaded) _members = [];
      return _members;
    })
    .finally(() => { _inFlight = null; });
  return _inFlight;
}

/**
 * The cached directory. Empty until loadTeamDirectory() resolves.
 * @returns {object[]}
 */
export function getTeamMembers() { return _members; }

/**
 * Find one person by any spelling of their name.
 *
 * Order, cheapest first: exact -> diacritic-, case- and hyphen-insensitive
 * (nameKey) -> the same after stripping contract codes -> surname-first.
 * @param {string} name
 * @returns {object|null}
 */
export function memberByName(name) {
  if (!name || _members.length === 0) return null;
  const raw = String(name).trim();

  const exact = _members.find((m) => fullName(m) === raw);
  if (exact) return exact;

  const norm = nameKey(raw);
  const byNorm = _members.find((m) => nameKey(fullName(m)) === norm);
  if (byNorm) return byNorm;

  const stripped = stripRoleCodes(raw);
  if (stripped && stripped !== raw) {
    const strippedNorm = nameKey(stripped);
    const byStripped = _members.find((m) => nameKey(fullName(m)) === strippedNorm);
    if (byStripped) return byStripped;
  }

  // "Last First" - the order half the source systems use. The first name is
  // the last token; everything before it is the surname, whatever separates
  // its parts.
  const tokens = (stripped || raw).split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    const reversed = nameKey(tokens[tokens.length - 1] + ' ' + tokens.slice(0, -1).join(' '));
    const byReversed = _members.find((m) => nameKey(fullName(m)) === reversed);
    if (byReversed) return byReversed;
  }
  return null;
}

/**
 * Find one person by mailbox. Exact, case-insensitive.
 * @param {string} email
 * @returns {object|null}
 */
export function memberByEmail(email) {
  if (!email || _members.length === 0) return null;
  const key = String(email).trim().toLowerCase();
  return _members.find((m) => String(m.email || '').toLowerCase() === key) || null;
}

/**
 * Find one person by the id the directory assigns.
 * @param {string} id
 * @returns {object|null}
 */
export function memberById(id) {
  if (!id || _members.length === 0) return null;
  return _members.find((m) => m.id === id) || null;
}

/**
 * URL of a member's photo, or '' when they have none.
 * @param {object|null} member
 * @returns {string}
 */
export function memberAvatarUrl(member) {
  if (!member || !member.avatar) return '';
  return AVATARS_BASE + encodeURIComponent(member.avatar);
}

/**
 * Photo URL for a name, or '' when the name is unknown or has no photo. The
 * one call a view needs to show a face.
 * @param {string} name
 * @returns {string}
 */
export function avatarUrlForName(name) {
  return memberAvatarUrl(memberByName(name));
}

/**
 * Initials for a name, preferring the directory spelling over the raw input so
 * "BS jordan lee" still renders "JL".
 * @param {string} name
 * @returns {string}
 */
export function memberInitials(name) {
  const member = memberByName(name);
  return initials(member ? fullName(member) : stripRoleCodes(name) || name);
}

/**
 * Test seam: preload the cache without a network call. `loaded: false` puts
 * the module back into its never-answered state, so a test can drive the
 * first fetch itself.
 */
export function __testSetMembers(list, loaded = true) {
  _members = Array.isArray(list) ? list : [];
  _loaded = loaded !== false;
  _inFlight = null;
}

export { DIRECTORY_URL, AVATARS_BASE };
