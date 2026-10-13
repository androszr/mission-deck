// ── Mission Deck — js/topbar-mr-helpers.mjs ───────────────────────────
// The decisions behind the "MR:" chips in the top bar, DOM-free so
// tests/test_topbar_mr_helpers.mjs can pin them. js/topbar.js paints from
// what these return and adds nothing of its own; the same split as
// js/stash-helpers.mjs and js/day-cycle-helpers.mjs.
//
// The payload is GET /api/merge-requests/counts: `{ ok, repos: [ { key,
// label, shortLabel, count, webUrl, error? } ] }`. The client keeps NO list
// of repos - every row the server sends is a chip, its text from the row's
// own `shortLabel` ("KM", the way the old bar said "App" / "KB") and its
// tooltip from `label`, so a second repository becomes a chip with one
// server-side line.

/**
 * Which rows of the payload get a chip. A row the server marks `no_token`
 * has nothing to say yet - the token is the normal thing missing on a fresh
 * install - so it is dropped rather than painted as "-"; a row with any
 * other error keeps its chip and reads "-", because "GitLab did not answer"
 * is worth a glance where "no token" is not.
 * @param {object|null|undefined} data
 * @returns {object[]} the rows to paint, in server order
 */
export function mrRowsToPaint(data) {
  if (!data || !Array.isArray(data.repos)) return [];
  return data.repos.filter(r => r && typeof r === 'object' && r.error !== 'no_token');
}

/**
 * One chip's paint instructions.
 * @param {{label?: string, shortLabel?: string, count?: number|null, webUrl?: string, error?: string}} row
 * @returns {{text: string, tone: 'red'|'gray', title: string, href: string|null}}
 */
export function mrChipState(row) {
  const label = String((row && row.label) || '').trim() || 'MR';
  const shortLabel = String((row && row.shortLabel) || '').trim() || label;
  const count = row ? row.count : null;
  const hasCount = typeof count === 'number' && Number.isFinite(count) && count >= 1;
  const known = typeof count === 'number' && Number.isFinite(count) && count >= 0;
  const text = shortLabel + ' ' + (known ? String(count) : '-');
  let title;
  if (row && row.error) {
    title = 'Open merge requests - ' + label + ': GitLab did not respond';
  } else if (!known) {
    title = 'Open merge requests - ' + label;
  } else if (count === 0) {
    title = 'No open merge requests - ' + label;
  } else {
    title = 'Open merge requests - ' + label + ': ' + count + ' to review';
  }
  const href = row && typeof row.webUrl === 'string' && /^https:\/\//.test(row.webUrl) ? row.webUrl : null;
  if (href) title += ' (opens GitLab)';
  return { text, tone: hasCount ? 'red' : 'gray', title, href };
}
