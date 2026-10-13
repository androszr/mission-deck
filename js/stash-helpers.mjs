// ── Mission Deck — js/stash-helpers.mjs ─────────────────────────────────
// Decisions and user-facing copy behind the "Stash" pill in the top bar and the modal
// it opens (js/stash-modal.js). No `document`: everything here takes a parsed
// /api/app/stash payload and returns a value or an HTML string, so
// tests/test_stash_helpers.mjs pins the wording the way
// tests/test_app_update_stash.mjs pins the update callout.
//
// The one exception is fetchStashEntries at the bottom, and it is here rather
// than in the modal for a boot-cost reason: js/topbar.js imports THIS file
// statically and calls that fetch on every load, so putting it next to the
// modal would drag js/stash-modal.js (and ds-modal, toast, analytics behind it)
// onto the boot path and undo the dynamic import the pill exists to keep.
//
// The one judgement this file makes that the server does not: a stash is
// presented as WAITING WORK, never as a finished action. `POST /api/app/update`
// with `stashDirty: true` parks the tree and then hard-resets it, so the base
// of a cockpit-made entry is a commit that is gone - a conflict on apply is the
// expected outcome, not the edge case. That is why the modal leads with the
// Claude hand-off (claudePromptForStash) and treats "Apply changes" as an
// optimistic attempt behind one confirm.

import { escHtml } from './utils.js';

/** How many paths one entry's file preview shows before "and N more". */
export const STASH_FILE_LIST_LIMIT = 20;

/** Selectors the modal wires after `innerHTML =`. Data attributes, so a
 *  repaint drops the listeners with the nodes and nothing needs cleanup. */
export const STASH_APPLY_BTN_SELECTOR = '[data-stash-apply]';
export const STASH_DROP_BTN_SELECTOR = '[data-stash-drop]';
export const STASH_FILES_BTN_SELECTOR = '[data-stash-files]';
export const STASH_COPY_BTN_SELECTOR = '[data-stash-copy]';

/**
 * English plural for a stash count.
 * @param {number} n
 * @returns {string}
 */
export function pluralStashes(n) {
  const c = Math.abs(Number(n) || 0);
  return c === 1 ? '1 stash' : c + ' stashes';
}

/**
 * English plural for a file count. Duplicated from js/app-update-stash.mjs on
 * purpose: importing it would tie the top bar's boot path to the update
 * callout module, and the two surfaces are otherwise unrelated.
 * @param {number} n
 * @returns {string}
 */
export function pluralFiles(n) {
  const c = Math.abs(Number(n) || 0);
  return c === 1 ? '1 file' : c + ' files';
}

/**
 * Keep only the rows that carry what every button needs (a sha) and what every
 * row renders (a ref). A malformed entry is dropped rather than painted as
 * "undefined", same rule parseStashNote follows.
 * @param {object} body  parsed GET /api/app/stash
 * @returns {Array<{sha: string, ref: string, at: string, message: string, cockpit: boolean}>}
 */
export function stashEntries(body) {
  const raw = body && Array.isArray(body.entries) ? body.entries : [];
  return raw
    .filter((e) => e && typeof e.sha === 'string' && /^[0-9a-f]{40}$/.test(e.sha) && typeof e.ref === 'string' && e.ref)
    .map((e) => ({
      sha: e.sha,
      ref: e.ref,
      at: typeof e.at === 'string' ? e.at : '',
      message: typeof e.message === 'string' ? e.message : '',
      cockpit: e.cockpit === true,
    }));
}

/**
 * The pill appears only when there is something on the stash. No entries ->
 * no slot at all, which is why the slot ships no skeleton: reserving width for
 * a pill that is absent on almost every machine would flash on every load.
 * @param {Array} entries
 * @returns {boolean}
 */
export function shouldShowStashPill(entries) {
  return Array.isArray(entries) && entries.length > 0;
}

/**
 * The pill's label and tooltip. The count is on the pill because that is the
 * whole signal: something of yours is parked and not in the tree.
 * @param {Array} entries
 * @returns {{ label: string, title: string, count: number }}
 */
export function stashPillState(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const count = list.length;
  return {
    count,
    label: count > 1 ? `Stash (${count})` : 'Stash',
    title: count === 0
      ? 'No stashed changes'
      : `Your stashed changes: ${pluralStashes(count)}. Click to apply, preview or remove them.`,
  };
}

/**
 * `DD.MM.YYYY, HH:MM` in LOCAL time - never a UTC slice, same rule the top bar
 * states for its own clock. An unparseable value renders nothing rather than
 * "Invalid Date".
 * @param {string} iso
 * @returns {string}
 */
export function formatStashDate(iso) {
  if (typeof iso !== 'string' || !iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * The headline of one entry's card. A cockpit-made entry carries a machine
 * message (`cockpit-update <ISO> v<semver>`), which is precise and unreadable,
 * so it gets a sentence instead and keeps the raw message as the copyable name.
 * @param {{message: string, cockpit: boolean}} entry
 * @returns {string}
 */
export function stashEntryTitle(entry) {
  const msg = (entry && entry.message) || '';
  if (entry && entry.cockpit) {
    if (msg.startsWith('detached-head-repair')) return 'Changes stashed while repairing the branch';
    return 'Changes stashed before a Mission Deck update';
  }
  return msg || 'Changes stashed by hand';
}

/**
 * The text the person hands Claude. It names the entry by its sha, because
 * `stash@{N}` shifts under every drop and the sha is what survives; it says
 * apply-not-pop, because losing the entry to a conflict is the one
 * unrecoverable outcome here; and it says what to do WITH the conflict, since
 * on a cockpit-made entry that is the expected ending.
 * @param {{sha: string, ref: string, message: string}} entry
 * @returns {string}
 */
export function claudePromptForStash(entry) {
  const sha = (entry && entry.sha) || '';
  const msg = (entry && entry.message) || '';
  return [
    `Move my changes from stash ${sha} onto the current code.`,
    msg ? `The entry is called: "${msg}".` : '',
    'Start with a preview: git stash show -p ' + sha + ' — the base of this entry is a commit from before the update, so expect conflicts.',
    'Use git stash apply (never pop) so the entry stays in place, and resolve conflicts by hand, keeping both my changes and the new code.',
    'Finally, tell me what you changed and whether I can drop this entry from the stash.',
  ].filter(Boolean).join(' ');
}

/**
 * Turn a POST /api/app/stash/apply answer into what the callout says. Three
 * outcomes, and the middle one is the important one: `conflict` means the work
 * IS in the tree with markers in it - reporting that as a failure would send
 * somebody looking for changes that are already there.
 * @param {object} body
 * @param {number} status
 * @returns {{ kind: 'ok'|'conflict'|'error', tone: string, title: string, lines: string[], files: string[] }}
 */
export function stashApplyOutcome(body, status) {
  const b = body || {};
  const files = Array.isArray(b.files) ? b.files : [];
  if (status === 200 && b.ok === true) {
    return {
      kind: 'ok', tone: 'success',
      title: `Changes applied to the working tree (${pluralFiles(files.length)}).`,
      lines: [
        'The entry stays in the stash — the app never runs git stash pop, so a failed apply cannot delete your work.',
        'Check the changes and, when everything is right, remove the entry with the "Remove entry" button.',
      ],
      files,
    };
  }
  const conflicts = Array.isArray(b.conflicts) ? b.conflicts : [];
  // Every branch below is gated on a 200 the same way the success branch is:
  // this is the pure boundary, and a 5xx carrying a familiar-looking `error`
  // must never paint as if the server had answered the question.
  if (status === 200 && b.error === 'conflict') {
    return {
      kind: 'conflict', tone: 'warning',
      title: b.message || `Conflicts in ${pluralFiles(conflicts.length)}.`,
      lines: [
        'This is normal for an entry from before an update: the base of this stash is a commit that no longer exists, so git had to merge.',
        'Your changes ARE in the files — together with conflict markers (<<<<<<<). Resolve them by hand or copy the Claude prompt below.',
        'While the conflicts remain, the next Mission Deck update will not run either — the tree is dirty.',
        'The entry stays in the stash, so nothing is lost.',
      ],
      files: conflicts,
    };
  }
  if (status === 200 && b.error === 'stash-gone') {
    return {
      kind: 'error', tone: 'warning',
      title: b.message || 'This entry is no longer in the stash.',
      lines: ['The list was refreshed — another browser tab or a terminal may have removed the entry.'],
      files: [],
    };
  }
  if (status === 200 && b.error === 'test-mode') {
    return { kind: 'error', tone: 'warning', title: b.message || 'Action disabled in test mode.', lines: [], files: [] };
  }
  return {
    kind: 'error', tone: 'danger',
    title: b.message || 'Could not apply the changes from the stash.',
    lines: b.stderr ? [String(b.stderr).split('\n').slice(0, 3).join(' ')] : ['The entry stays in the stash — check the working tree and try again.'],
    files: [],
  };
}

// ── Markup ───────────────────────────────────────────────────────────────────
// HTML strings, no `document`, so the wording is pinned by a unit test. Every
// value goes through escHtml; buttons carry the data attributes above.

/**
 * One entry as a card: the headline, when it was made, the copyable entry name
 * and the four actions. The sha rides on every button, never the ref.
 * @param {{sha: string, ref: string, at: string, message: string, cockpit: boolean}} entry
 * @returns {string}
 */
export function stashEntryCardHtml(entry) {
  const sha = escHtml(entry.sha);
  const when = formatStashDate(entry.at);
  const shortSha = escHtml(entry.sha.slice(0, 10));
  return '<div class="stash-entry" data-stash-entry="' + sha + '">'
    + '<div class="stash-entry__head">'
    + `<p class="stash-entry__title">${escHtml(stashEntryTitle(entry))}</p>`
    + `<span class="ds-badge ds-badge--sm ${entry.cockpit ? 'ds-badge--blue' : 'ds-badge--gray'}">${entry.cockpit ? 'from Mission Deck' : 'manual'}</span>`
    + '</div>'
    + `<p class="stash-entry__meta">${when ? escHtml(when) + ' · ' : ''}<code>${escHtml(entry.ref)}</code> · <code>${shortSha}</code></p>`
    + (entry.message ? `<p class="stash-entry__meta">Entry name: <code>${escHtml(entry.message)}</code></p>` : '')
    + '<div class="stash-entry__actions">'
    + `<button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-stash-apply="${sha}">Apply changes</button>`
    + `<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-stash-files="${sha}">Show files</button>`
    + `<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-stash-copy="name" data-stash-sha="${sha}">Copy name</button>`
    + `<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-stash-copy="prompt" data-stash-sha="${sha}">Copy Claude prompt</button>`
    + `<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm stash-entry__drop" data-stash-drop="${sha}">Remove entry</button>`
    + '</div>'
    + '<div class="stash-entry__slot" data-stash-slot="' + sha + '"></div>'
    + '</div>';
}

/**
 * The file list of one entry, capped. `null` files (the request failed) and an
 * empty list are different answers and must not read alike.
 * @param {string[] | null} files
 * @param {number} [limit]
 * @returns {string}
 */
export function stashFilesHtml(files, limit = STASH_FILE_LIST_LIMIT) {
  if (files === null || files === undefined) {
    return '<p class="stash-entry__note">Could not read the file list of this entry.</p>';
  }
  const list = Array.isArray(files) ? files.filter((f) => typeof f === 'string' && f) : [];
  if (list.length === 0) return '<p class="stash-entry__note">This entry contains no files.</p>';
  const max = Math.max(0, Number(limit) || 0);
  const shown = list.slice(0, max);
  const hidden = list.length - shown.length;
  return `<p class="stash-entry__note">${escHtml(pluralFiles(list.length))} in this entry:</p>`
    + '<ul class="stash-entry__files">'
    + shown.map((f) => `<li><code>${escHtml(f)}</code></li>`).join('')
    + (hidden > 0 ? `<li class="stash-entry__more">… plus ${escHtml(pluralFiles(hidden))}</li>` : '')
    + '</ul>';
}

/**
 * The result of an apply, painted under the entry it belongs to.
 * @param {{kind: string, tone: string, title: string, lines: string[], files: string[]}} outcome
 * @returns {string}
 */
export function stashOutcomeHtml(outcome) {
  const o = outcome || { tone: 'danger', title: '', lines: [], files: [] };
  const files = Array.isArray(o.files) ? o.files.slice(0, STASH_FILE_LIST_LIMIT) : [];
  return `<div class="ds-callout ds-callout--${escHtml(o.tone || 'info')} stash-entry__outcome">`
    + `<p class="stash-entry__outcome-title">${escHtml(o.title || '')}</p>`
    + (Array.isArray(o.lines) ? o.lines.map((l) => `<p class="stash-entry__note">${escHtml(l)}</p>`).join('') : '')
    + (files.length > 0 ? '<ul class="stash-entry__files">' + files.map((f) => `<li><code>${escHtml(f)}</code></li>`).join('') + '</ul>' : '')
    + '</div>';
}

/**
 * The standing explanation at the top of the modal. Says what a stash is here,
 * why the app never pops, and that Claude is a first-class way out - the user's
 * own route, not a footnote.
 * @returns {string[]}
 */
export function stashIntroLines() {
  return [
    'Here are your changes that Mission Deck stashed before an update, plus everything you stashed yourself with git stash.',
    'The app never runs git stash pop — "Apply changes" uses git stash apply, so the entry stays in place and a failed merge deletes nothing.',
    'An entry from before an update is based on a commit that no longer exists, so conflicts are normal here. Easiest: copy the Claude prompt and paste it into the terminal — it moves the changes for you.',
  ];
}

/**
 * GET /api/app/stash. A failure answers an empty list rather than throwing:
 * every caller fallback is "no pill, no cards", which is also the normal state
 * on a machine that never stashed. The only impure function in this file - see
 * the header for why it lives here and not in js/stash-modal.js.
 * @returns {Promise<{entries: object[], error: string}>}
 */
export async function fetchStashEntries() {
  try {
    const res = await fetch('/api/app/stash', { cache: 'no-store' });
    if (!res.ok) return { entries: [], error: 'http' };
    const body = await res.json();
    return { entries: stashEntries(body), error: body && body.ok === false ? (body.error || 'error') : '' };
  } catch (_e) {
    return { entries: [], error: 'network' };
  }
}
