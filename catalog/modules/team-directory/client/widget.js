// modules/team-directory/client/widget.js
// Dashboard widget "Our teams" (contract: modules-template/README.md,
// "Dashboard widget"). The module has no server: it reads the core route
// GET /api/team/members -> { members, teams } (member fields first_name,
// last_name, role, team, email, id) and paints teams as avatar stacks. The
// kit resolves the photos by name. Teams follow the view's own order
// (orderTeams from the sibling lib: product teams first, guests last), so the
// tile and the page agree. No static import from the core's /js/.

import { orderTeams } from './team-directory-lib.js';

const NO_TEAM = 'No team';
// Four series tones for the named slices; neutral is kept for "Other".
const TEAM_TONES = ['info', 'ok', 'warn', 'error'];
const MAX_TEAMS = 3;
const MAX_SEGMENTS = 4;

export const EMPTY_TEXT = 'No team directory on this machine - pull the data in the Sync window or fill it in under Settings > Users.';

function _fullName(m) {
  return [m && m.first_name, m && m.last_name].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
}

function _peopleWord(n) {
  return n === 1 ? '1 person' : n + ' people';
}

/**
 * Groups members by team in the view's display order (orderTeams); members
 * without a team go to a "no team" bucket (NO_TEAM) after every team. Members
 * without a name are skipped.
 * @param {Array} members @returns {Array<{team: string, people: string[]}>}
 */
export function teamGroups(members) {
  const map = new Map();
  for (const m of Array.isArray(members) ? members : []) {
    const name = _fullName(m);
    if (!name) continue;
    const team = String(m.team || '').trim() || NO_TEAM;
    if (!map.has(team)) map.set(team, []);
    map.get(team).push(name);
  }
  const order = orderTeams([...map.keys()].filter((t) => t !== NO_TEAM)).flat();
  if (map.has(NO_TEAM)) order.push(NO_TEAM);
  return order.map((team) => ({ team, people: map.get(team) }));
}

/**
 * The first MAX_SEGMENTS teams plus one "Other" slice: a legend of eleven
 * names does not fit a quarter of a wide tile, and five tones cannot tell
 * eleven slices apart.
 */
function _segments(teams) {
  const head = teams.slice(0, MAX_SEGMENTS).map((t, i) => ({ label: t.team, value: t.people.length, tone: TEAM_TONES[i % TEAM_TONES.length] }));
  const rest = teams.slice(MAX_SEGMENTS).reduce((a, t) => a + t.people.length, 0);
  if (rest > 0) head.push({ label: 'Other', value: rest, tone: 'neutral' });
  return head;
}

/**
 * @param {Array} members
 * @returns {{blocks: Object<string, object>, empty: string|null}}
 */
export function buildBlocks(members) {
  const teams = teamGroups(members);
  if (!teams.length) return { blocks: {}, empty: EMPTY_TEXT };
  const total = teams.reduce((a, t) => a + t.people.length, 0);
  const blocks = {
    avatars_all: { type: 'avatars', label: 'Team', people: teams.flatMap((t) => t.people.map((name) => ({ name, tone: 'neutral' }))), max: 6 },
    tiles: { type: 'tiles', tiles: teams.map((t) => ({ label: t.team, value: String(t.people.length), tone: 'neutral' })) },
    segments: { type: 'segments', label: 'Team share (' + _peopleWord(total) + ')', segments: _segments(teams) },
  };
  teams.slice(0, MAX_TEAMS).forEach((t, i) => {
    blocks['avatars_' + (i + 1)] = { type: 'avatars', label: t.team + ' · ' + _peopleWord(t.people.length), people: t.people.map((name) => ({ name, tone: TEAM_TONES[i % TEAM_TONES.length] })), max: 6 };
  });
  return { blocks, empty: null };
}

export const VARIANT_BLOCKS = {
  s: ['avatars_all'],
  s2: ['tiles', 'avatars_all'],
  m: ['avatars_all'],
  m2: ['avatars_1', 'avatars_2', 'avatars_3'],
  l: ['tiles', 'avatars_1', 'avatars_2'],
  xl: ['avatars_1', 'avatars_2', 'avatars_3', 'segments'],
};

/** @returns {string} HTML */
export function paint(members, variantId, size, kit) {
  const { blocks, empty } = buildBlocks(members);
  if (empty) return kit.empty(empty);
  const keys = VARIANT_BLOCKS[variantId] || VARIANT_BLOCKS.m2;
  return kit.blocks(keys.map((k) => blocks[k]).filter(Boolean), size);
}

export async function renderWidget(el, ctx) {
  let disposed = false;
  let members = [];
  try {
    const res = await fetch('/api/team/members', { signal: ctx.signal });
    if (res.ok) {
      const body = await res.json();
      members = (body && body.members) || [];
    }
  } catch (e) {
    if (ctx.signal && ctx.signal.aborted) throw e;
  }
  const html = paint(members, ctx.variant.id, { cols: ctx.variant.cols, rows: ctx.variant.rows }, ctx.kit);
  if (!disposed && !(ctx.signal && ctx.signal.aborted)) el.innerHTML = html;
  return () => { disposed = true; };
}
