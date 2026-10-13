'use strict';
// modules/costs/server/rates.js
// Pure: the daily rates live in costs/team-rates.json, shape
// { team_rates: [ { name, daily_rate, ...extra } ] }, keyed by NAME. A person is mapped to an entry with the module's
// own name matcher (exact token set first, then subset/prefix; a tie is
// ambiguous and never resolved silently). No default rate exists.

const { nameTokens, tokensMatch } = require('./match.js');

function entriesOf(doc) {
  return doc && Array.isArray(doc.team_rates) ? doc.team_rates : [];
}

/** -> { index } | { index: -1, reason: 'none' | 'ambiguous', candidates: [name] } */
function matchRateEntry(entries, name) {
  const at = nameTokens(name);
  if (!at.size) return { index: -1, reason: 'none', candidates: [] };
  const toks = entries.map((e) => nameTokens(e && e.name));
  const exact = [];
  toks.forEach((t, i) => { if (t.size === at.size && [...at].every((x) => t.has(x))) exact.push(i); });
  if (exact.length === 1) return { index: exact[0] };
  if (exact.length > 1) return { index: -1, reason: 'ambiguous', candidates: exact.map((i) => entries[i].name) };
  const hits = [];
  toks.forEach((t, i) => { if (t.size && tokensMatch(t, at)) hits.push(i); });
  if (hits.length === 1) return { index: hits[0] };
  if (hits.length > 1) return { index: -1, reason: 'ambiguous', candidates: hits.map((i) => entries[i].name) };
  return { index: -1, reason: 'none', candidates: [] };
}

function _num(e) {
  return e && typeof e.daily_rate === 'number' && Number.isFinite(e.daily_rate) ? e.daily_rate : null;
}

/**
 * people: [{ id, name }] -> { rates: [{ id, daily_rate }] (only people with a
 * numeric rate), unmatched: [{ name, daily_rate }] (entries nobody claims) }
 */
function mapRates(doc, people) {
  const entries = entriesOf(doc);
  const claimed = new Set();
  const rates = [];
  for (const p of people || []) {
    const m = matchRateEntry(entries, p.name);
    if (m.index < 0) continue;
    claimed.add(m.index);
    const v = _num(entries[m.index]);
    if (v !== null) rates.push({ id: p.id, daily_rate: v });
  }
  const unmatched = entries.map((e, i) => ({ e, i })).filter((x) => !claimed.has(x.i) && x.e && typeof x.e.name === 'string')
    .map((x) => ({ name: x.e.name, daily_rate: _num(x.e) }));
  return { rates, unmatched };
}

/**
 * Returns { ok: true, doc } with the new document (all other entries, order and
 * extra fields untouched) or { ok: false, reason, candidates }.
 * value null removes the person's entry; no entry + value appends one.
 */
function applyRate(doc, name, value) {
  const base = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
  const entries = entriesOf(base).slice();
  const m = matchRateEntry(entries, name);
  if (m.index < 0 && m.reason === 'ambiguous') return { ok: false, reason: 'ambiguous', candidates: m.candidates };
  if (m.index >= 0) {
    if (value === null) entries.splice(m.index, 1);
    else entries[m.index] = { ...entries[m.index], daily_rate: value };
  } else if (value !== null) {
    entries.push({ name, daily_rate: value });
  }
  return { ok: true, doc: { ...base, team_rates: entries } };
}

module.exports = { entriesOf, matchRateEntry, mapRates, applyRate };
