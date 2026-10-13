// ── Mission Deck — js/utils.js ────────────────────────────────────────────
// Shared, dependency-free helpers. Domain formatting does NOT belong here - a
// helper earns a place in this file only if more than one module calls it and
// it needs no knowledge of any particular payload shape.

/**
 * Diacritic- and case-insensitive search key. Polish l-with-stroke has no
 * decomposed form, so it is folded explicitly before NFD normalization.
 * @param {*} text
 * @returns {string}
 */
export function normalizeSearch(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/\u0142/g, 'l')   // U+0142 lowercase l with stroke
    .replace(/\u0141/g, 'l')   // U+0141 uppercase L with stroke -> lowercase l
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * Escape a string for safe interpolation into an HTML template literal.
 * @param {*} str
 * @returns {string}
 */
export function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Short local timestamp: "DD.MM HH:MM". Empty string for missing/invalid input.
 * @param {string} isoStr
 * @returns {string}
 */
export function fmtTimestamp(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    if (isNaN(d.getTime())) return '';
    const day = String(d.getDate()).padStart(2, '0');
    const mon = String(d.getMonth() + 1).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${day}.${mon} ${h}:${m}`;
  } catch (_e) { return ''; }
}

/**
 * Two-letter avatar initials from a display name.
 * @param {string} name
 * @returns {string}
 */
export function initials(name) {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}
