// ── Mission Deck — js/app-update-stash.mjs ───────────────────────────────
// Pure helpers behind the two-step "stash and update" path. Two surfaces carry
// the button - Settings > System (js/settings.js) and step 6 of the first-run
// wizard (js/onboarding-wizard.js) - and both paint from THIS file: the
// decisions AND the callout markup (HTML strings, no `document`), so the two
// cannot drift and tests/test_app_update_stash.mjs pins both. The shapes come
// from POST /api/app/update:
//
//   dirty-tree: { error: 'dirty-tree', files, stashable, unstashable, canStash, message }
//   202:        { ok: true, stashed: null | { ref, message, files } }
//
// Nothing here decides anything the server did not already decide: `canStash`
// is authoritative, the helpers only turn the payload into something a person
// can read without a hundred paths flooding one callout.

import { escHtml } from './utils.js';

/** How many paths a dirty-tree callout shows before "and N more". */
export const DIRTY_TREE_LIST_LIMIT = 8;

/** localStorage key holding the recovery note that must survive the reload. */
export const STASH_NOTE_KEY = 'cockpit.updateStashNote';

/** Selector of the "stash and update" button inside a dirty-tree callout. */
export const STASH_UPDATE_BTN_SELECTOR = '[data-stash-update]';

/** Selector of the "Got it, hide" button inside a stash-note callout. */
export const STASH_NOTE_DISMISS_SELECTOR = '[data-stash-note-dismiss]';

/**
 * English plural for a file count (1 file, 2 files, 0 files).
 * @param {number} n
 * @returns {string}
 */
export function pluralFiles(n) {
  const c = Math.abs(Number(n) || 0);
  return c === 1 ? '1 file' : c + ' files';
}

/**
 * The stash button appears only when the SERVER says the tree is stashable.
 * Re-derived defensively from the lists too: a payload where `canStash` is
 * true but something untracked is still listed would offer a stash that the
 * server itself would then refuse.
 * @param {object} body  parsed /api/app/update response
 * @returns {boolean}
 */
export function canOfferStash(body) {
  if (!body || body.error !== 'dirty-tree' || body.canStash !== true) return false;
  const stashable = Array.isArray(body.stashable) ? body.stashable : [];
  const unstashable = Array.isArray(body.unstashable) ? body.unstashable : [];
  return stashable.length > 0 && unstashable.length === 0;
}

/**
 * The rows a dirty-tree callout renders. Unstashable paths come FIRST, because
 * they are the reason the button is missing and must stay visible even when
 * the list is cut; within each group the server's order is kept.
 *
 * @param {object} body  parsed dirty-tree response
 * @param {number} [limit]
 * @returns {{ rows: Array<{path: string, unstashable: boolean}>, hidden: number, total: number, unstashableCount: number }}
 */
export function dirtyTreeRows(body, limit = DIRTY_TREE_LIST_LIMIT) {
  const files = Array.isArray(body && body.files) ? body.files.filter((f) => typeof f === 'string' && f) : [];
  const unstashable = new Set(Array.isArray(body && body.unstashable) ? body.unstashable : []);
  const blocked = files.filter((f) => unstashable.has(f));
  const rest = files.filter((f) => !unstashable.has(f));
  const ordered = [...blocked, ...rest];
  const max = Math.max(0, Number(limit) || 0);
  const shown = ordered.slice(0, max);
  return {
    rows: shown.map((path) => ({ path, unstashable: unstashable.has(path) })),
    hidden: Math.max(0, ordered.length - shown.length),
    total: files.length,
    unstashableCount: blocked.length,
  };
}

/**
 * The note kept for the person after a stash-and-update. Built from the 202
 * payload; `null` when that call stashed nothing, so the caller writes nothing.
 * @param {object} respBody  parsed 202 response
 * @param {string} [nowIso]
 * @returns {null | { ref: string, message: string, count: number, at: string }}
 */
export function stashNoteFromResponse(respBody, nowIso) {
  const st = respBody && respBody.stashed;
  if (!st || typeof st !== 'object') return null;
  const files = Array.isArray(st.files) ? st.files : [];
  return {
    ref: typeof st.ref === 'string' && st.ref ? st.ref : 'stash@{0}',
    message: typeof st.message === 'string' ? st.message : '',
    count: files.length,
    at: nowIso || new Date().toISOString(),
  };
}

/**
 * Parse a note read back from localStorage. Anything malformed is `null`, so a
 * corrupted entry paints nothing rather than "undefined files".
 * @param {string | null | undefined} raw
 * @returns {null | { ref: string, message: string, count: number, at: string }}
 */
export function parseStashNote(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let obj;
  try { obj = JSON.parse(raw); } catch (_e) { return null; }
  if (!obj || typeof obj !== 'object' || typeof obj.ref !== 'string' || !obj.ref) return null;
  const count = Number(obj.count);
  if (!Number.isFinite(count) || count < 0) return null;
  return {
    ref: obj.ref,
    message: typeof obj.message === 'string' ? obj.message : '',
    count,
    at: typeof obj.at === 'string' ? obj.at : '',
  };
}

/**
 * The sentences a stash note renders, in order. Kept here as data so
 * the wording is pinned by a test and the two places that paint it (the
 * success callout before the reload, the note after it) cannot drift.
 * @param {{ ref: string, count: number }} note
 * @returns {string[]}
 */
export function stashNoteSentences(note) {
  const ref = (note && note.ref) || 'stash@{0}';
  const count = pluralFiles(note ? note.count : 0);
  return [
    `Your local changes (${count}) are on the stash as ${ref}.`,
    'The app never runs git stash pop - after the restart you get them back yourself, e.g. git stash show -p ' + ref + ' (preview) or git stash pop.',
    'Note: after reset --hard the stash base is no longer HEAD, so popping anything non-trivial ends in a conflict to resolve by hand.',
    'The stash also took edits nobody typed (the model: lines from Settings > Agents, the GitNexus block) - they are harmless, the update overwrites them anyway, and model preferences come back on the next start.',
    'This note is only a convenience saved in this browser - another browser or a private window will not show it. The reliable trace is git stash list in the Mission Deck folder.',
  ];
}

/**
 * What to DO when the tree cannot be stashed. Since 2026-09-12 the stash
 * takes untracked files too (an explicit pathspec on `git stash push -u`),
 * so the one dead end left is a path git had to QUOTE in its status output -
 * a space, a quote or a control character in the name - which cannot be
 * handed to git as a pathspec. Names the action (rename, `git add`, or move
 * out) and what happens once it is done (the button appears), never just
 * the file names.
 * @param {number} unstashableCount
 * @returns {string[]}
 */
export function unstashableAdvice(unstashableCount) {
  const n = pluralFiles(unstashableCount);
  return [
    `The app will not stash these changes itself: ${n} on the list - labelled "not stashable" - have a character in the name that git has to quote (a space, a quote, a control character), and the stash cannot point at it.`,
    'What to do: rename the file to a name without those characters or move it out of the Mission Deck folder. Should it stay in the repository under this name? Add it with git add <file> - then the stash will take it.',
    'Then try again: once nothing "not stashable" is left on the list, a button appears that stashes the changes and updates Mission Deck.',
  ];
}

/**
 * The question every "stash and update" button asks before it acts, so the
 * four surfaces (Settings > System, the wizard, the update modal and the
 * banner) cannot word it differently. Says what is taken (count, first paths),
 * what happens next (hard reset, restart) and that the app never pops.
 * @param {object} body  dirty-tree response
 * @returns {string}
 */
export function stashConfirmText(body) {
  const files = Array.isArray(body && body.files) ? body.files.filter((f) => typeof f === 'string' && f) : [];
  const shown = files.slice(0, 6);
  const rest = files.length - shown.length;
  return [
    `Stash ${pluralFiles(files.length)} and update Mission Deck?`,
    '',
    shown.map((f) => '• ' + f).join('\n') + (rest > 0 ? `\n… and ${pluralFiles(rest)} more` : ''),
    '',
    'The changes go to the stash (including new, unadded files), then the app downloads the new version and restarts the server.',
    'The app does not run git stash pop - after the restart you get them back from the "Stash" pill in the top bar.',
  ].join('\n');
}

// ── Callout markup ───────────────────────────────────────────────────────────
// Inner HTML of a `.ds-callout`, wrapped in `.upd-dirty` (styles.css). Every
// path and every server sentence goes through escHtml. Buttons carry data
// attributes (STASH_UPDATE_BTN_SELECTOR, STASH_NOTE_DISMISS_SELECTOR) so a
// caller wires them after `innerHTML =` and the next repaint drops them - no
// cleanup registration needed on either surface.

/**
 * The dirty-tree answer: the mapped headline, the blocking paths (unstashable
 * first and marked - they are WHY the button is absent), the advice when the
 * tree cannot be stashed, the opt-in button when it can.
 * @param {object} body     dirty-tree response
 * @param {string} headline already-mapped sentence (mapAppUpdateError with stashActionHere)
 * @returns {string}
 */
export function dirtyTreeCalloutHtml(body, headline) {
  const { rows, hidden, unstashableCount } = dirtyTreeRows(body);
  const offer = canOfferStash(body);
  const items = rows.map((r) => `<li class="upd-dirty__file${r.unstashable ? ' upd-dirty__file--blocked' : ''}"><code>${escHtml(r.path)}</code>${r.unstashable ? ' <span class="ds-badge ds-badge--yellow ds-badge--sm">not stashable</span>' : ''}</li>`).join('');
  const more = hidden > 0 ? `<li class="upd-dirty__more">… and ${escHtml(pluralFiles(hidden))} more</li>` : '';
  const why = unstashableCount > 0
    ? unstashableAdvice(unstashableCount).map((t) => `<p class="upd-dirty__why">${escHtml(t)}</p>`).join('')
    : '';
  const button = offer
    ? '<div class="upd-dirty__actions"><button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-stash-update>Stash changes and update</button>'
      + '<span class="upd-dirty__hint">The app does not run <code>git stash pop</code> - after the restart you get them back yourself.</span></div>'
    : '';
  return '<div class="upd-dirty">'
    + `<p class="upd-dirty__headline">${escHtml(headline)}</p>`
    + (items ? `<ul class="upd-dirty__files">${items}${more}</ul>` : '')
    + why + button
    + '</div>';
}

/**
 * The stash note as callout markup: a headline, the sentences from
 * stashNoteSentences, the stash entry name, then an optional trailing line and
 * an optional dismiss button.
 * @param {string} headline
 * @param {{ ref: string, message: string, count: number, at: string }} note
 * @param {{ trailing?: string, dismiss?: boolean }} [opts]
 * @returns {string}
 */
export function stashNoteHtml(headline, note, opts) {
  const o = opts || {};
  return '<div class="upd-dirty">'
    + `<p class="upd-dirty__headline">${escHtml(headline)}</p>`
    + stashNoteSentences(note).map((s) => `<p class="upd-dirty__line">${escHtml(s)}</p>`).join('')
    + (note && note.message ? `<p class="upd-dirty__line">Stash entry: <code>${escHtml(note.message)}</code></p>` : '')
    + (o.trailing ? `<p class="upd-dirty__line">${escHtml(o.trailing)}</p>` : '')
    + (o.dismiss ? '<div class="upd-dirty__actions"><button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-stash-note-dismiss>Got it, hide</button></div>' : '')
    + '</div>';
}
