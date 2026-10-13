// modules/knowledge-base/client/widget.js
// Dashboard widget "New in the knowledge base" (contract: modules-template/README.md,
// "Dashboard widget"). Reads GET <apiBase>/widget - the total, the type split,
// monthly counts and the 5 newest articles, never article bodies. A 404 means
// the server has not been restarted since the route was added: say so, never
// fall back to the heavy /list (it scans the whole repo).
// No static import from the core's /js/: the kit arrives as ctx.kit. The type
// split uses the module's own filter lib (sibling import), so it matches the
// "Document type" counts of the module view.

import { DOC_TYPES, docTypeOf } from './filters.mjs';

const UNAVAILABLE_TEXT = 'No knowledge base data. Fetch the data in the Sync window.';
const EMPTY_TEXT = 'The knowledge base is empty - it has no documents yet.';
const RESTART_TEXT = 'This tile needs a server restart: Settings > Restart server.';
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
// Categorical, not judgemental: no 'error' for a document type.
const TYPE_TONES = ['info', 'ok', 'warn'];
const TOP_TYPES = 3;

function _num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** "document" / "documents". */
export function documentsLabel(n) {
  return n === 1 ? 'document' : 'documents';
}

/** "1 new" / "3 new". */
export function newLabel(n) {
  return n + ' new';
}

/**
 * Category counts -> the module's document types: top TOP_TYPES by count, the
 * rest (and categories with no type) folded into one "Other".
 * @param {Array<{category: string, count: number}>} categories
 * @returns {Array<{label: string, count: number}>}
 */
export function typeSplit(categories) {
  const byType = new Map();
  let other = 0;
  for (const c of Array.isArray(categories) ? categories : []) {
    const n = _num(c && c.count);
    const id = docTypeOf(c && c.category);
    const def = id ? DOC_TYPES.find((d) => d.id === id) : null;
    if (def) byType.set(def.label, (byType.get(def.label) || 0) + n);
    else other += n;
  }
  const sorted = Array.from(byType.entries()).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const out = sorted.slice(0, TOP_TYPES).map(([label, count]) => ({ label, count }));
  other += sorted.slice(TOP_TYPES).reduce((a, e) => a + e[1], 0);
  if (other > 0) out.push({ label: 'Other', count: other });
  return out;
}

/** An author worth an avatar: "First Last", not "Confluence import" or "Sam (team Atlas)". */
export function authorPerson(author) {
  const a = String(author || '').trim();
  return /^\p{Lu}[\p{L}-]+(?: \p{Lu}[\p{L}-]+)+$/u.test(a) ? a : '';
}

/** "2026-10-06" -> "06.10"; anything else -> "-". */
export function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? m[3] + '.' + m[2] : '-';
}

function _clip(s, n) {
  const t = String(s || '');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

/** @returns {{blocks: Object<string, object>, empty: string|null}} */
export function buildBlocks(data) {
  if (!data || data.storage !== 'ok') return { blocks: {}, empty: UNAVAILABLE_TEXT };
  const total = _num(data.total);
  if (total === 0) return { blocks: {}, empty: EMPTY_TEXT };
  const fresh = _num(data.newThisMonth);
  const blocks = {
    big: {
      type: 'big', value: String(total), unit: documentsLabel(total),
      label: 'in the knowledge base · ' + newLabel(fresh) + ' this month', tone: 'neutral',
    },
  };
  const types = typeSplit(data.categories);
  if (types.length > 0) {
    blocks.pie = {
      type: 'pie', center: String(total),
      segments: types.map((t, i) => ({ label: t.label, value: t.count, tone: t.label === 'Other' ? 'neutral' : TYPE_TONES[i % TYPE_TONES.length] })),
    };
  }
  const arts = Array.isArray(data.articles) ? data.articles : [];
  if (arts.length > 0) {
    blocks.timeline = {
      type: 'timeline',
      events: arts.map((a) => {
        const ev = { date: shortDate(a.date), label: _clip(a.title, 60), tone: 'info' };
        const person = authorPerson(a.author);
        if (person) ev.person = person;
        return ev;
      }),
    };
  }
  const months = Array.isArray(data.months) ? data.months : [];
  if (months.length >= 2) {
    blocks.line = {
      type: 'line', label: 'New documents per month',
      labels: months.map((m) => ROMAN[(_num(m.month) - 1 + 12) % 12]),
      series: [{ label: 'Documents', values: months.map((m) => _num(m.count)), tone: 'info', last: String(_num(months[months.length - 1].count)) }],
    };
  }
  return { blocks, empty: null };
}

export const VARIANT_BLOCKS = {
  s: ['big'],
  s2: ['big', 'line'],
  m: ['big', 'pie'],
  m2: ['timeline', 'pie'],
  l: ['big', 'pie', 'timeline', 'line'],
};

/** @returns {string} HTML for a variant */
export function paint(data, variantId, size, kit) {
  const { blocks, empty } = buildBlocks(data);
  if (empty) return kit.empty(empty);
  const keys = VARIANT_BLOCKS[variantId] || VARIANT_BLOCKS.m;
  const html = kit.blocks(keys.map((k) => blocks[k]).filter(Boolean), size);
  return html || kit.empty(EMPTY_TEXT);
}

export async function renderWidget(el, ctx) {
  let disposed = false;
  const res = await fetch(ctx.apiBase + '/widget', { signal: ctx.signal });
  if (res.status === 404) {
    if (!(ctx.signal && ctx.signal.aborted)) el.innerHTML = ctx.kit.empty(RESTART_TEXT);
    return () => { disposed = true; };
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (!disposed && !(ctx.signal && ctx.signal.aborted)) {
    el.innerHTML = paint(data, ctx.variant.id, { cols: ctx.variant.cols, rows: ctx.variant.rows }, ctx.kit);
  }
  return () => { disposed = true; };
}
