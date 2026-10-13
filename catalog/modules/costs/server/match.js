'use strict';
// modules/costs/server/match.js
// Author -> roster member matching. E-mail first (Tempo puts the e-mail in
// author.name), then a token-set match on the display name. Ambiguity is never resolved silently: two or more
// candidates mean "unassigned" with the candidate names.

// Vendor tags some Tempo instances put in front of a contractor's display name
// ("EXT Sam Rivera"); adjust to your organisation.
const ORG_PREFIXES = new Set(['ext', 'vnd', 'ctr']);

// NFKD does not decompose the l-with-stroke (U+0141/U+0142), so it is mapped by hand.
function asciiLower(s) {
  const swapped = String(s || '').replace(/ł/g, 'l').replace(/Ł/g, 'L');
  return swapped.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Tokens >= 2 chars; a leading org prefix and a trailing "ctr" are dropped. */
function nameTokens(s) {
  const cleaned = asciiLower(String(s || '').replace(/\([^)]*\)/g, ' ')).replace(/[^\w\s]/g, ' ');
  let tokens = cleaned.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length && ORG_PREFIXES.has(tokens[0])) tokens = tokens.slice(1);
  if (tokens.length && tokens[tokens.length - 1] === 'ctr') tokens = tokens.slice(0, -1);
  return new Set(tokens);
}

function _subset(a, b) {
  for (const t of a) if (!b.has(t)) return false;
  return true;
}

function _prefixCover(a, b) {
  // every token of a equals a token of b or shares a 4-char prefix with one
  for (const t of a) {
    if (b.has(t)) continue;
    let ok = false;
    if (t.length >= 4) {
      for (const u of b) {
        if (u.length >= 4 && (t.startsWith(u) || u.startsWith(t))) { ok = true; break; }
      }
    }
    if (!ok) return false;
  }
  return true;
}

/** Subset either direction, then the 4-char prefix rule either direction. */
function tokensMatch(a, b) {
  if (!a.size || !b.size) return false;
  if (_subset(a, b) || _subset(b, a)) return true;
  return _prefixCover(a, b) || _prefixCover(b, a);
}

function memberName(m) {
  return [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || m.name || '';
}

/**
 * allMembers: every roster member with an e-mail (decisive e-mail match).
 * includedMembers: members outside the roster (external people); added to the e-mail index and the token targets.
 * Both are { id, name, email? }.
 */
function buildAuthorIndex(allMembers, includedMembers) {
  const byEmail = new Map();
  // Roster first, so a roster e-mail is never taken over by an external entry.
  for (const m of [...(allMembers || []), ...(includedMembers || [])]) {
    const e = String(m.email || '').trim().toLowerCase();
    if (e && !byEmail.has(e)) byEmail.set(e, m);
  }
  // Token targets = the WHOLE roster (plus included members outside it), so a
  // non-included "Casey Brookfield" is never costed to included "Casey Brook".
  const tokens = [];
  const seenIds = new Set();
  for (const m of [...(allMembers || []), ...(includedMembers || [])]) {
    if (m.id !== undefined && seenIds.has(m.id)) continue;
    if (m.id !== undefined) seenIds.add(m.id);
    const t = nameTokens(memberName(m));
    if (t.size > 0) tokens.push({ member: m, tokens: t });
  }
  return { byEmail, tokens };
}

/** -> { member } | { member: null, reason: 'none' | 'ambiguous', candidates: [name] } */
function matchAuthor(author, idx) {
  const key = String((author && author.key) || '').trim().toLowerCase();
  if (key && idx.byEmail.has(key)) return { member: idx.byEmail.get(key) };
  const at = nameTokens(author && author.displayName);
  const hits = [];
  if (at.size > 0) {
    // An exact token-set match wins over subset/prefix hits, so included
    // "Alex Morgan" is not made ambiguous by "Alex Morgan-Reed".
    const exact = idx.tokens.filter(e => e.tokens.size === at.size && [...at].every(t => e.tokens.has(t)));
    if (exact.length === 1) return { member: exact[0].member };
    if (exact.length > 1) return { member: null, reason: 'ambiguous', candidates: exact.map(e => memberName(e.member)) };
    for (const e of idx.tokens) if (tokensMatch(e.tokens, at)) hits.push(e.member);
  }
  if (hits.length === 1) return { member: hits[0] };
  if (hits.length > 1) return { member: null, reason: 'ambiguous', candidates: hits.map(memberName) };
  return { member: null, reason: 'none', candidates: [] };
}

module.exports = { ORG_PREFIXES, asciiLower, nameTokens, tokensMatch, memberName, buildAuthorIndex, matchAuthor };
