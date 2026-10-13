// modules/team-directory/client/team-directory-lib.js
// Pure functions, no document access, no team-directory state - importable from
// node --test and used by client/index.js for the render. Kept
// dependency-free so the contract test and the unit tests can import this
// file without a browser and without the roster ever going stale (the roster
// itself is re-fetched by the entry file only - see README.md).

const COMBINING_MARKS_RE = /[\u0300-\u036f]/g;

// Hardcoded team display order: null marks a visual separator between
// blocks. 'Guests' is pinned absolutely last. Not derivable from the roster -
// the `team` field carries no hierarchy - so the order lives here, in one
// place. Edit it to match your own teams.
export const TEAM_ORDER = [
  'Atlas', 'Borealis', 'Comet', 'Delta', 'Echo', 'Falcon',
  null, // separator
  'Leadership', 'Other', 'Platform',
  null, // separator
  'Guests',
];

// Team name -> logo slug. A slug may stay in the map even when nobody is on
// that team today - a new roster entry then gets a logo with no code change.
// Guests is deliberately absent: it has no logo and falls back to initials.
export const LOGO_TEAMS = {
  Atlas: 'atlas',
  Borealis: 'borealis',
  Comet: 'comet',
  Delta: 'delta',
  Echo: 'echo',
  Falcon: 'falcon',
  Leadership: 'leadership',
  Other: 'other',
  Platform: 'platform',
};

/**
 * TEAM_ORDER split into blocks at each `null` separator.
 * @returns {string[][]}
 */
function teamOrderBlocks() {
  const blocks = [[]];
  for (const v of TEAM_ORDER) {
    if (v === null) blocks.push([]);
    else blocks[blocks.length - 1].push(v);
  }
  return blocks;
}

/**
 * Orders the team names actually present in the roster into TEAM_ORDER's
 * blocks. A name not in TEAM_ORDER is inserted, alphabetically among itself,
 * into the block right before the last one (never after Guests, never
 * dropped). A block with none of its teams present is left out entirely, so
 * two adjacent present blocks never draw a double separator.
 * @param {string[]} names team names present in the data
 * @returns {string[][]} non-empty blocks, in display order
 */
export function orderTeams(names) {
  const list = Array.isArray(names) ? names : [];
  const rawBlocks = teamOrderBlocks();
  const known = new Set(rawBlocks.flat());
  const unlisted = list.filter((n) => !known.has(n)).sort((a, b) => a.localeCompare(b, 'en'));
  const insertIdx = Math.max(rawBlocks.length - 2, 0);
  rawBlocks[insertIdx] = [...rawBlocks[insertIdx], ...unlisted];
  const nameSet = new Set(list);
  return rawBlocks
    .map((block) => block.filter((n) => nameSet.has(n)))
    .filter((block) => block.length > 0);
}

/**
 * Groups roster members by their `team` field. A member with no team lands
 * in the empty-string key, which the caller can choose to skip.
 * @param {Array<{team?: string}>} members
 * @returns {Record<string, object[]>}
 */
export function groupByTeam(members) {
  const groups = {};
  for (const m of (Array.isArray(members) ? members : [])) {
    const key = (m && m.team) || '';
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  }
  return groups;
}

/**
 * Diacritic- and case-insensitive form of a string, for substring matching.
 * A private copy rather than an import of the core's normalizeSearch
 * (js/utils.js): this file is imported by `node --test` with no `/js/...`
 * resolver, so it stays dependency-free like the rest of this file.
 * @param {*} text
 * @returns {string}
 */
export function normalizeSearch(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/[\u0142\u0141]/g, 'l') // l/L with stroke - NFD leaves these intact
    .replace(/[\u0111\u0110]/g, 'd') // d/D with stroke
    .replace(/[\u00f8\u00d8]/g, 'o') // o/O with stroke
    .normalize('NFD')
    .replace(COMBINING_MARKS_RE, '')
    .toLowerCase();
}

/**
 * Keeps the members whose first name, last name, role or e-mail matches
 * every word of the query. Empty query returns the full list.
 * @param {Array<{first_name?: string, last_name?: string, role?: string, email?: string}>} members
 * @param {string} query
 * @returns {object[]}
 */
export function filterMembers(members, query) {
  const list = Array.isArray(members) ? members : [];
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return list;
  return list.filter((m) => {
    const haystack = normalizeSearch(
      [m && m.first_name, m && m.last_name, m && m.role, m && m.email].filter(Boolean).join(' '),
    );
    return words.every((w) => haystack.indexOf(w) !== -1);
  });
}

/**
 * Initials for a team name - the fallback drawn when a team has no logo
 * (Guests) or the logo file failed to load. One letter per word.
 * @param {string} name
 * @returns {string}
 */
export function teamInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  return parts.map((p) => p.charAt(0).toUpperCase()).join('');
}

/**
 * Logo slug for a team name, or '' when the team has no logo (Guests).
 * @param {string} team
 * @returns {string}
 */
export function logoSlug(team) {
  return LOGO_TEAMS[team] || '';
}

/**
 * Teams rendered with NO logo column at all - the people fill the whole card.
 * Distinct from "has no logo file": an unknown team still gets a column with
 * its initials, because the column is what keeps the cards in a row aligned.
 * Guests are visitors rather than a team, so they get no column.
 */
export const NO_LOGO_COLUMN_TEAMS = ['Guests'];

/**
 * Does this team get a logo column (with either a logo or its initials)?
 * @param {string} team
 * @returns {boolean}
 */
export function hasLogoColumn(team) {
  return !NO_LOGO_COLUMN_TEAMS.includes(team);
}

/**
 * "First L." caption under a person's tile - first name plus the initial of
 * the last name. A member with no last name shows the first name alone.
 * @param {{first_name?: string, last_name?: string}} member
 * @returns {string}
 */
export function personCaption(member) {
  const first = (member && member.first_name) || '';
  const last = (member && member.last_name) || '';
  if (!last) return first;
  return first + ' ' + last.charAt(0).toUpperCase() + '.';
}
