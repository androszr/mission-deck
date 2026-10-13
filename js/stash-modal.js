// ── Mission Deck — js/stash-modal.js ────────────────────────────────────
// The "Stash" window behind the top-bar pill. Dynamic-imported on first click
// (same pattern as js/day-cycle-modal.js), so nothing here is on the boot path.
//
// Everything this file decides or writes in English lives in
// js/stash-helpers.mjs; this module is the page code and the four fetches. One
// delegated click listener on the body handles every card, because the list is
// rebuilt after each action and per-button listeners would have to be rebound
// every time.
//
// The modal is mounted through openDsModal on a container built here rather
// than in index.html: it is opened from a pill that most people never see, so
// its markup has no business in the shell's parse cost.

import { openDsModal, closeDsModal } from './ds-modal.js';
import { showToast } from './toast.js';
import { escHtml } from './utils.js';
import {
  fetchStashEntries,
  stashEntryCardHtml,
  stashFilesHtml,
  stashOutcomeHtml,
  stashApplyOutcome,
  claudePromptForStash,
  stashIntroLines,
  pluralStashes,
} from './stash-helpers.mjs';

const OVERLAY_ID = 'stash-modal-overlay';

/** The entries the open modal is painted from. Also what a copy button reads,
 *  so a copy never has to re-fetch to find the sha it already rendered. */
let _entries = [];

/** True while a write is in flight: two applies must not overlap, and the
 *  server's own lock chain would only serialize them, not explain the wait. */
let _busy = false;

// ── Fetches ──────────────────────────────────────────────────────────────────


/**
 * POST one of the two write routes with the sha as the whole body.
 * @param {string} path
 * @param {string} sha
 * @returns {Promise<{status: number, body: object}>}
 */
async function _post(path, sha) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

// ── Painting ─────────────────────────────────────────────────────────────────

function _overlay() { return document.getElementById(OVERLAY_ID); }

function _bodyEl() {
  const o = _overlay();
  return o ? o.querySelector('[data-stash-body]') : null;
}

/**
 * Repaint the card list from `_entries`. Called on open and after every write,
 * because a drop renumbers every `stash@{N}` the previous paint showed.
 */
function _paintList() {
  const body = _bodyEl();
  if (!body) return;
  const intro = stashIntroLines().map((l) => `<p class="stash-modal__intro">${escHtml(l)}</p>`).join('');
  if (_entries.length === 0) {
    body.innerHTML = intro
      + '<div class="ds-callout ds-callout--info"><p>You have no stashed changes right now.</p></div>';
    return;
  }
  body.innerHTML = intro
    + `<p class="stash-modal__count">${escHtml(pluralStashes(_entries.length))} on this machine, newest first:</p>`
    + _entries.map(stashEntryCardHtml).join('');
}

/** The per-entry slot under the buttons, where files and outcomes land. */
function _slot(sha) {
  const body = _bodyEl();
  return body ? body.querySelector(`[data-stash-slot="${CSS.escape(sha)}"]`) : null;
}

/** Disable or re-enable every button while a write runs. */
function _setBusy(on) {
  _busy = on;
  const body = _bodyEl();
  if (!body) return;
  body.querySelectorAll('button').forEach((b) => { b.disabled = on; });
}

// ── Actions ──────────────────────────────────────────────────────────────────

/**
 * Copy text with the clipboard API, falling back to a hidden textarea the way
 * js/sync-center-modal.js does - a denied permission is a warning, never a red
 * error, because the person can still read the value off the card.
 * @param {string} text
 * @param {string} what
 */
async function _copy(text, what) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      showToast('success', 'Copied', what);
      return;
    } catch (_e) { /* fall through to the textarea */ }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('success', 'Copied', what);
  } catch (_e) {
    showToast('warning', 'Could not copy', 'Select the text on the card and copy it by hand.');
  }
}

/** GET the file list of one entry and paint it into that entry's slot. */
async function _showFiles(sha) {
  const slot = _slot(sha);
  if (!slot) return;
  slot.innerHTML = '<p class="stash-entry__note">Reading the file list…</p>';
  try {
    const res = await fetch(`/api/app/stash/files?sha=${encodeURIComponent(sha)}`, { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok !== true) {
      slot.innerHTML = stashFilesHtml(null);
      return;
    }
    slot.innerHTML = stashFilesHtml(body.files);
  } catch (_e) {
    slot.innerHTML = stashFilesHtml(null);
  }
}

/**
 * `git stash apply`, behind one confirm. The confirm names the two things a
 * person cannot undo by clicking again: the changes land in the working tree,
 * and a conflict leaves markers that also block the next cockpit update.
 * @param {string} sha
 */
async function _apply(sha) {
  if (_busy) return;
  const entry = _entries.find((e) => e.sha === sha);
  if (!entry) return;
  const ok = window.confirm(
    'Apply these changes to the current working tree?\n\n'
    + 'The entry stays in the stash (the app never runs git stash pop).\n'
    + 'If conflicts appear, the files keep <<<<<<< markers to resolve by hand — '
    + 'while they are there, the next Mission Deck update will not run either.',
  );
  if (!ok) return;

  _setBusy(true);
  const slot = _slot(sha);
  if (slot) slot.innerHTML = '<p class="stash-entry__note">Applying changes…</p>';
  try {
    const { status, body } = await _post('/api/app/stash/apply', sha);
    const outcome = stashApplyOutcome(body, status);
    // Repaint from the server first: a `stash-gone` answer means the list the
    // person is looking at is already wrong.
    const fresh = await fetchStashEntries();
    _entries = fresh.entries;
    _paintList();
    const after = _slot(sha);
    if (after) after.innerHTML = stashOutcomeHtml(outcome);
    else {
      const b = _bodyEl();
      if (b) b.insertAdjacentHTML('beforeend', stashOutcomeHtml(outcome));
    }
    if (outcome.kind === 'ok') showToast('success', 'Changes applied', 'The entry stays in the stash — remove it when everything is right.');
    else if (outcome.kind === 'conflict') showToast('warning', 'Conflicts to resolve', 'The changes are in the files together with conflict markers.');
    else showToast('error', 'Changes not applied', outcome.title);
  } catch (e) {
    const b = _bodyEl();
    if (b) b.insertAdjacentHTML('beforeend', stashOutcomeHtml({ tone: 'danger', title: 'Network error: ' + (e && e.message), lines: [], files: [] }));
  } finally {
    _setBusy(false);
    _refreshPillSafely();
  }
}

/** `git stash drop`, behind a confirm that says it cannot be undone. */
async function _drop(sha) {
  if (_busy) return;
  const entry = _entries.find((e) => e.sha === sha);
  if (!entry) return;
  const ok = window.confirm(
    `Remove entry ${entry.ref} from the stash?\n\n`
    + 'This cannot be undone — the changes stashed in it will be lost.\n'
    + 'If you have not applied them yet, first use "Apply changes" or copy the Claude prompt.',
  );
  if (!ok) return;

  _setBusy(true);
  try {
    const { body } = await _post('/api/app/stash/drop', sha);
    const fresh = await fetchStashEntries();
    _entries = fresh.entries;
    _paintList();
    if (body && body.ok === true) showToast('success', 'Entry removed', 'The stash no longer holds these changes.');
    else showToast('warning', 'Entry not removed', (body && body.message) || 'Refresh the list and try again.');
  } catch (e) {
    showToast('error', 'Network error', (e && e.message) || '');
  } finally {
    _setBusy(false);
    _refreshPillSafely();
  }
}

/**
 * Repaint the top-bar pill after a write. Dynamic-imported so this modal never
 * becomes a static edge into js/topbar.js, which already imports plenty.
 */
function _refreshPillSafely() {
  import('./topbar.js')
    .then((m) => { if (typeof m.refreshStashPill === 'function') m.refreshStashPill(); })
    .catch(() => { /* the pill repaints on the next load anyway */ });
}

// ── Open ─────────────────────────────────────────────────────────────────────

/** One delegated listener for every card, bound once per opened overlay. */
function _wire(overlay) {
  if (overlay.dataset.stashWired === '1') return;
  overlay.dataset.stashWired = '1';
  overlay.addEventListener('click', (ev) => {
    const t = ev.target;
    // A text node target has no closest(); the guard is the duck test rather
    // than instanceof Element, which ESLint's browser globals do not carry.
    if (!t || typeof t.closest !== 'function') return;
    const close = t.closest('[data-stash-close]');
    if (close) { closeDsModal(overlay); return; }
    const applyBtn = t.closest('[data-stash-apply]');
    if (applyBtn) { _apply(applyBtn.getAttribute('data-stash-apply')); return; }
    const filesBtn = t.closest('[data-stash-files]');
    if (filesBtn) { _showFiles(filesBtn.getAttribute('data-stash-files')); return; }
    const dropBtn = t.closest('[data-stash-drop]');
    if (dropBtn) { _drop(dropBtn.getAttribute('data-stash-drop')); return; }
    const copyBtn = t.closest('[data-stash-copy]');
    if (copyBtn) {
      const sha = copyBtn.getAttribute('data-stash-sha');
      const entry = _entries.find((e) => e.sha === sha);
      if (!entry) return;
      if (copyBtn.getAttribute('data-stash-copy') === 'prompt') {
        _copy(claudePromptForStash(entry), 'Paste this to Claude in the terminal.');
      } else {
        _copy(entry.message || entry.sha, 'The stash entry name.');
      }
    }
  });
}

/** Build the overlay once and keep it on document.body for later opens. */
function _ensureOverlay() {
  let overlay = _overlay();
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.id = OVERLAY_ID;
  overlay.hidden = true;
  overlay.innerHTML = '<div class="ds-modal ds-modal--lg stash-modal" role="dialog" aria-modal="true" aria-labelledby="stash-modal-title">'
    + '<div class="ds-modal-header">'
    + '<h2 class="ds-modal-title" id="stash-modal-title">Stashed changes</h2>'
    + '<button type="button" class="ds-modal-close" data-stash-close aria-label="Close">&times;</button>'
    + '</div>'
    + '<div class="ds-modal-body" data-stash-body></div>'
    + '<div class="ds-modal-footer"><button type="button" class="ds-btn ds-btn--secondary" data-stash-close>Close</button></div>'
    + '</div>';
  document.body.appendChild(overlay);
  return overlay;
}

/**
 * Open the stash window. Takes the entries the pill already fetched when it has
 * them, so the common path costs no second request; re-fetches otherwise.
 * @param {{entries?: object[]}} [opts]
 * @returns {Promise<void>}
 */
export async function openStashModal(opts) {
  const overlay = _ensureOverlay();
  _wire(overlay);
  const given = opts && Array.isArray(opts.entries) ? opts.entries : null;
  _entries = given || [];
  _paintList();
  openDsModal(overlay);
  if (!given) {
    const fresh = await fetchStashEntries();
    _entries = fresh.entries;
    _paintList();
  }
}
