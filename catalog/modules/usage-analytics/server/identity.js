'use strict';
// modules/usage-analytics/server/identity.js
// Raw Amplitude user ids -> one person. The core derives person_slug from a GitLab
// display name, git user.name or an OS login, so one human shows up under several ids
// (alex-morgan, morgan.alex@example.com, morgana ...). Pure: the team directory and the
// optional alias map arrive as arguments.
//   1. aliases (raw id -> member email), exact, always first
//   2. rule A: normalized token set equals the member's {first,last} tokens, the tokens of
//      the member's email local part, or {initial,last}; also first+last joined as one token
//   3. rule B (single login-style token): prefix(last, >= 4 chars) + non-empty prefix(first),
//      e.g. "morgana" = "morgan" + "a"(lex)
//   ambiguous or none -> unmatched (the raw id stays its own person)

const PREFIXES = new Set(['bs', 'fr', 'dt', 'ext']);

function stripDiacritics(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L');
}

/** @returns {string[]} normalized tokens of a raw id / name / email */
function normalizeTokens(raw) {
  let s = stripDiacritics(String(raw || '')).toLowerCase();
  s = s.replace(/[„“”"'`]/g, '').trim();
  const at = s.indexOf('@');
  if (at >= 0) s = s.slice(0, at);
  s = s.replace(/[-_.]app[-_.]access$/, '');
  let tokens = s.split(/[.\-_\s]+/).filter(Boolean);
  if (tokens.length > 1 && PREFIXES.has(tokens[0])) tokens = tokens.slice(1);
  return tokens.map((t) => t.replace(/[0-9]/g, '')).filter(Boolean);
}

const keyOf = (tokens) => tokens.slice().sort().join('|');

function buildResolver(members, aliases) {
  const list = (Array.isArray(members) ? members : []).filter((m) => m && m.email && m.first_name && m.last_name);
  const rows = list.map((m) => {
    const first = normalizeTokens(m.first_name);
    const last = normalizeTokens(m.last_name);
    const f = first.join('');
    const l = last.join('');
    return {
      m,
      email: String(m.email).toLowerCase(),
      nameKey: keyOf(first.concat(last)),
      emailKey: keyOf(normalizeTokens(m.email)),
      last: last.join('|'),
      f, l,
      joined: new Set([f + l, l + f]),
    };
  });
  const byEmail = new Map(rows.map((r) => [r.email, r]));
  const aliasMap = new Map();
  for (const [k, v] of Object.entries(aliases && typeof aliases === 'object' ? aliases : {})) {
    if (typeof v === 'string' && v) aliasMap.set(String(k).trim().toLowerCase(), v.trim().toLowerCase());
  }
  const cache = new Map();

  function person(r) {
    return { key: r.email, display_name: r.m.first_name + ' ' + r.m.last_name, matched: true };
  }

  function compute(rawId) {
    const al = aliasMap.get(String(rawId).trim().toLowerCase());
    if (al) {
      const r = byEmail.get(al);
      return r ? person(r) : { key: al, display_name: null, matched: true };
    }
    const tokens = normalizeTokens(rawId);
    if (!tokens.length) return null;
    const k = keyOf(tokens);
    let hits = rows.filter((r) => r.nameKey === k || r.emailKey === k);
    if (!hits.length && tokens.length === 1) hits = rows.filter((r) => r.joined.has(tokens[0]));
    if (!hits.length) {
      const initials = tokens.filter((t) => t.length === 1);
      if (initials.length === 1) {
        const rest = keyOf(tokens.filter((t) => t.length !== 1));
        hits = rows.filter((r) => r.last === rest && r.f.startsWith(initials[0]));
      }
    }
    if (!hits.length && tokens.length === 1) {
      const t = tokens[0];
      hits = rows.filter((r) => {
        for (let n = 4; n <= r.l.length; n++) {
          const rest = t.slice(n);
          if (t.startsWith(r.l.slice(0, n)) && rest && r.f.startsWith(rest)) return true;
        }
        return false;
      });
    }
    return hits.length === 1 ? person(hits[0]) : null;
  }

  /** @returns {{key: string, display_name: string|null, matched: boolean}} */
  return function resolve(rawId) {
    const id = String(rawId);
    let r = cache.get(id);
    if (!r) {
      r = compute(id) || { key: id, display_name: null, matched: false };
      cache.set(id, r);
    }
    return r;
  };
}

module.exports = { normalizeTokens, buildResolver };
