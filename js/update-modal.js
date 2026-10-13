// ── Mission Deck — js/update-modal.js ────────────────────────────────────
// Prominent update-available modal. Complements (does NOT replace) the sticky
// banner in js/update-banner.js — the two are fully independent: dismissing one
// never affects the other.

import { mapAppUpdateError } from './app-update-errors.js';
import {
  dirtyTreeCalloutHtml, stashNoteFromResponse, stashConfirmText, STASH_NOTE_KEY, STASH_UPDATE_BTN_SELECTOR,
} from './app-update-stash.mjs';
import { formatVersionLabel } from './version-format.js';
import { openDsModal, closeDsModal } from './ds-modal.js';
import { startLoadingAnimation } from './loading-animations.js';

function _escHtml(s) {
  return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// localStorage key: 'updateModalDismissedUntil' — remind-later dismiss gating.
const STORAGE_KEY = 'updateModalDismissedUntil';
const REMIND_LATER_MS = 60 * 60 * 1000; // 1 hour

let _listenersAttached = false;

// Mascot loading animation, one per modal — started when the modal opens,
// stopped on every close path. Guarded so a double-open never stacks two
// animations on the same slot.
let _stopUpdateAnim = null;
let _stopUptodateAnim = null;

function _safeStop(stopFn) {
  try { if (typeof stopFn === 'function') stopFn(); } catch (_e) { /* ignore */ }
}

export function shouldShowUpdateModal() {
  const dismissedUntil = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
  return Date.now() > dismissedUntil;
}

function getOverlay() {
  return document.getElementById('update-modal-overlay');
}

function _dismissModal() {
  localStorage.setItem(STORAGE_KEY, String(Date.now() + REMIND_LATER_MS));
  _safeStop(_stopUpdateAnim);
  _stopUpdateAnim = null;
  const overlay = getOverlay();
  if (!overlay) return;
  closeDsModal(overlay);
}

/**
 * POST /api/app/update. `stashDirty` is the second step of the dirty-tree
 * path - the SAME two-step shape Settings > System and the wizard's step 6
 * use, and the SAME shared callout from js/app-update-stash.mjs. This modal
 * is where most people meet an update, so answering a dirty tree here with a
 * sentence pointing at Settings was the reason the button went unnoticed.
 * The action stays opt-in and still lists every blocking file first.
 * @param {boolean} [stashDirty]
 */
async function _runAppUpdate(stashDirty = false) {
  const btn = document.getElementById('update-modal-update');
  const laterBtn = document.getElementById('update-modal-later');
  const versionsEl = document.getElementById('update-modal-versions');

  if (btn) btn.disabled = true;
  if (laterBtn) laterBtn.disabled = true;
  if (versionsEl) {
    versionsEl.textContent = stashDirty
      ? 'Stashing your changes and downloading the update... This may take a few dozen seconds.'
      : 'Downloading the update... This may take a few dozen seconds.';
  }

  try {
    const res = await fetch('/api/app/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stashDirty === true ? { stashDirty: true } : {}),
    });

    if (res.status === 202) {
      // Same recovery note Settings > System writes: this modal reloads
      // the page within seconds, so the stash ref would otherwise vanish
      // before anybody read it. js/settings.js repaints it on the next load.
      const note = stashNoteFromResponse(await res.json().catch(() => ({})));
      if (note) {
        try { localStorage.setItem(STASH_NOTE_KEY, JSON.stringify(note)); } catch (_e) { /* private mode */ }
      }
      if (versionsEl) versionsEl.textContent = 'Updated. Restarting the server - the page will reload automatically...';
      const deadline = Date.now() + 20000;
      // Require two consecutive OK checks before reloading — one success can hit a
      // momentarily-up socket of a still-settling server (see update-banner.js).
      let okStreak = 0;
      await new Promise((resolve) => {
        const poll = setInterval(async () => {
          let ok = false;
          try {
            const check = await fetch('/api/app/version', { cache: 'no-store' });
            ok = check.ok;
          } catch { /* still restarting */ }
          if (ok) {
            okStreak++;
            if (okStreak >= 2) {
              clearInterval(poll);
              resolve();
              _safeStop(_stopUpdateAnim);
              _stopUpdateAnim = null;
              location.reload();
              return;
            }
          } else {
            okStreak = 0;
          }
          if (Date.now() > deadline) { clearInterval(poll); resolve(); }
        }, 800);
      });
    } else {
      const body = await res.json().catch(() => ({}));
      if (versionsEl && body && body.error === 'dirty-tree') {
        // The shared markup, with the opt-in button wired the way
        // js/settings.js wires it: the button lives INSIDE the callout, so
        // the next paint drops it and nothing needs a cleanup registration.
        versionsEl.innerHTML = dirtyTreeCalloutHtml(body, mapAppUpdateError(body, res.status, { stashActionHere: true }));
        const stashBtn = versionsEl.querySelector(STASH_UPDATE_BTN_SELECTOR);
        if (stashBtn) {
          stashBtn.addEventListener('click', () => {
            if (!window.confirm(stashConfirmText(body))) return;
            stashBtn.disabled = true;
            _runAppUpdate(true);
          });
        }
      } else if (versionsEl) {
        versionsEl.textContent = mapAppUpdateError(body, res.status);
      }
    }
  } catch (err) {
    if (versionsEl) versionsEl.textContent = 'Network error: ' + err.message;
  } finally {
    if (btn) btn.disabled = false;
    if (laterBtn) laterBtn.disabled = false;
  }
}

function _attachListeners(overlay) {
  if (_listenersAttached) return;
  _listenersAttached = true;

  const closeBtn = document.getElementById('update-modal-close');
  const laterBtn = document.getElementById('update-modal-later');
  const updateBtn = document.getElementById('update-modal-update');

  if (closeBtn) closeBtn.addEventListener('click', _dismissModal);
  if (laterBtn) laterBtn.addEventListener('click', _dismissModal);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) _dismissModal();
  });
  if (updateBtn) updateBtn.addEventListener('click', () => _runAppUpdate());
}

function _formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch { return ''; }
}

export function showUpdateModal({ currentVersion, remoteVersion, currentHash, remoteHash, currentDate, remoteDate } = {}) {
  if (!shouldShowUpdateModal()) return;

  const overlay = getOverlay();
  if (!overlay) return;

  const versionsEl = document.getElementById('update-modal-versions');
  if (versionsEl) {
    const current = formatVersionLabel(currentVersion, currentHash) || '?';
    const remote = formatVersionLabel(remoteVersion, remoteHash) || '?';
    const currentDateStr = _formatDate(currentDate);
    const remoteDateStr = _formatDate(remoteDate);
    const dateSuffix = (s) => s ? ` <span class="update-modal-version-date">(${_escHtml(s)})</span>` : '';
    versionsEl.innerHTML =
      `Current version: <span class="update-modal-version-label">${_escHtml(current)}</span>${dateSuffix(currentDateStr)}<br>` +
      `New version: <span class="update-modal-version-label">${_escHtml(remote)}</span>${dateSuffix(remoteDateStr)}`;
  }

  _attachListeners(overlay);

  openDsModal(overlay);

  _safeStop(_stopUpdateAnim);
  const animEl = document.getElementById('update-modal-anim');
  _stopUpdateAnim = animEl ? startLoadingAnimation(animEl) : null;
}

let _uptodateListenersAttached = false;

export function showUpToDateModal({ currentVersion, currentHash, currentDate } = {}) {
  const overlay = document.getElementById('uptodate-modal-overlay');
  if (!overlay) return;

  const infoEl = document.getElementById('uptodate-modal-info');
  if (infoEl) {
    const ver = formatVersionLabel(currentVersion, currentHash) || '?';
    const dateStr = _formatDate(currentDate);
    const dateSuffix = dateStr ? ` <span class="update-modal-version-date">(${_escHtml(dateStr)})</span>` : '';
    infoEl.innerHTML =
      `Your version is up to date.<br>` +
      `Version: <span class="update-modal-version-label">${_escHtml(ver)}</span>${dateSuffix}`;
  }

  if (!_uptodateListenersAttached) {
    _uptodateListenersAttached = true;
    const closeOverlay = () => {
      _safeStop(_stopUptodateAnim);
      _stopUptodateAnim = null;
      closeDsModal(overlay);
    };
    const closeBtn = document.getElementById('uptodate-modal-close');
    const okBtn = document.getElementById('uptodate-modal-ok');
    if (closeBtn) closeBtn.addEventListener('click', closeOverlay);
    if (okBtn) okBtn.addEventListener('click', closeOverlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });
  }

  openDsModal(overlay);

  _safeStop(_stopUptodateAnim);
  const animEl = document.getElementById('uptodate-modal-anim');
  _stopUptodateAnim = animEl ? startLoadingAnimation(animEl) : null;
}

// Playwright testability hook — allows forcing the modal open without a real update.
if (typeof window !== 'undefined') {
  window.__showUpdateModal = showUpdateModal;
  window.__showUpToDateModal = showUpToDateModal;
}
