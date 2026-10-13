'use strict';
// modules/time-log/server/match.js
// Pure name-matching helpers (nameTokens, tokensMatch, displayShort,
// asciiLower) plus personSlug, which slugs the roster member.
//
// ROLE_CODES is a COPY of the contract-code list in js/team-directory.js
// (ROLE_CODE_RE) - CJS here cannot import that ESM file, so
// tests/test_time_log.mjs reads js/team-directory.js's source and checks
// this array stays identical to the codes in the regex.

const ROLE_CODES = ['BS', 'BD', 'CTR', '7N', 'I2S', 'BRI', 'AWA', 'DT', 'LG'];
const ROLE_CODE_SET = new Set(ROLE_CODES.map((c) => c.toLowerCase()));

// NFKD does not decompose the l-with-stroke (l/L), so it is mapped
// by hand before the rest of the diacritics are stripped - same rule
// js/utils.js normalizeSearch follows for the browser side.
function asciiLower(s) {
  const swapped = String(s || '').replace(/\u0142/g, 'l').replace(/\u0141/g, 'L');
  return swapped.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Tokens >= 2 chars, punctuation replaced with spaces, a parenthesised
// suffix dropped first, then a leading/trailing contract code stripped.
function nameTokens(s) {
  const noParens = String(s || '').replace(/\([^)]*\)/g, ' ');
  const cleaned = asciiLower(noParens).replace(/[^\w\s]/g, ' ');
  let tokens = cleaned.split(/\s+/).filter((t) => t.length >= 2);
  while (tokens.length && ROLE_CODE_SET.has(tokens[0])) tokens = tokens.slice(1);
  while (tokens.length && ROLE_CODE_SET.has(tokens[tokens.length - 1])) tokens = tokens.slice(0, -1);
  return new Set(tokens);
}

// Every member token must match an author token exactly, or the member
// token must EXTEND a shorter (>= 4 char) author token - the shape a
// truncated Jira display name takes ("Alex Morg" for "Alex
// Morgan"). Deliberately NOT the other direction: allowing a short
// member token to match as a PREFIX of a longer author token would let
// "Sam Rive" match "Sam Riverton", which is exactly the false
// positive this fallback exists to avoid - conservative on purpose.
function tokensMatch(memberTokens, authorTokens) {
  for (const mt of memberTokens) {
    if (authorTokens.has(mt)) continue;
    let ok = false;
    for (const at of authorTokens) {
      if (at.length >= 4 && mt.startsWith(at)) { ok = true; break; }
    }
    if (!ok) return false;
  }
  return true;
}

// "Alex Morgan" -> "A. Morgan"; "Sam Taylor Rivera" -> "S. Taylor Rivera".
function displayShort(fullName) {
  const parts = String(fullName || '').split(/\s+/).filter(Boolean);
  if (parts.length === 0) return fullName || '';
  if (parts.length === 1) return parts[0];
  return parts[0][0] + '. ' + parts.slice(1).join(' ');
}

function slugBase(member) {
  const name = [member.first_name, member.last_name].filter(Boolean).join(' ');
  return asciiLower(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Kept for a stable id across calls: buildAuthorIndex assigns slugs once per
// build so a name repeated in the same member list still collides
// deterministically (member order = roster order).
function personSlug(member, taken) {
  const base = slugBase(member) || 'person';
  if (!taken || !taken.has(base)) { if (taken) taken.add(base); return base; }
  let i = 2;
  while (taken.has(base + '-' + i)) i += 1;
  const slug = base + '-' + i;
  taken.add(slug);
  return slug;
}

// idx.byEmail: Map<lowercase email, member>. idx.tokens: [{ member, tokens }]
// in roster order, so the first roster match wins on an ambiguous author.
function buildAuthorIndex(members) {
  const byEmail = new Map();
  const tokens = [];
  for (const member of members) {
    if (member.email) byEmail.set(String(member.email).trim().toLowerCase(), member);
    const fullName = [member.first_name, member.last_name].filter(Boolean).join(' ');
    if (fullName) tokens.push({ member, tokens: nameTokens(fullName) });
  }
  return { byEmail, tokens };
}

// 1) author.name (Tempo's field carries the mailbox) matched case-insensitively
//    against the roster email; 2) author.displayName matched by tokens;
//    3) null - the author is outside the six teams this module tracks.
function matchAuthor(author, idx) {
  const email = author && author.name ? String(author.name).trim().toLowerCase() : '';
  if (email && idx.byEmail.has(email)) return idx.byEmail.get(email);
  const displayName = (author && author.displayName) || '';
  if (!displayName) return null;
  const authorTokens = nameTokens(displayName);
  if (authorTokens.size === 0) return null;
  for (const entry of idx.tokens) {
    if (entry.tokens.size > 0 && tokensMatch(entry.tokens, authorTokens)) return entry.member;
  }
  return null;
}

module.exports = { ROLE_CODES, asciiLower, nameTokens, tokensMatch, displayShort, personSlug, buildAuthorIndex, matchAuthor };
