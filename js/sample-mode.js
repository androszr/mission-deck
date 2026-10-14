// ── Mission Deck — js/sample-mode.js ──────────────────────────────────────
// "Try it with sample data": the DOM and the requests. Decisions and copy live
// in js/sample-mode-helpers.mjs. Three entry points:
//   refreshSampleBadge()      - the top-bar badge + "Leave sample mode" action
//   enterSampleMode(trigger)  - POST /api/sample-mode/enter, then restart
//   leaveSampleMode(trigger)  - confirm, POST /api/sample-mode/leave, restart
// Entering and leaving take effect after a restart (the server decides the
// team data folder once, at boot), so both end in POST /api/settings/restart
// and a reload once the server answers again.

import { showToast } from './toast.js';
import {
  fetchSampleModeStatus, shouldShowSampleBadge, sampleBadgeState, sampleLeaveConfirm,
  sampleEnterSummary, sampleErrorMessage,
} from './sample-mode-helpers.mjs';

let _busy = false;

async function _restartAndReload() {
  // Imported BEFORE the restart is posted (see js/update-banner.js): a cold
  // fetch right after the process respawns can fail.
  const { waitForServerRestart } = await import('./settings.js');
  try {
    await fetch('/api/settings/restart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  } catch (_e) { /* the connection is cut by the restart - expected */ }
  if (await waitForServerRestart()) { location.reload(); return; }
  showToast('warning', 'Restart is taking longer than usual', 'Reload the page manually.');
}

async function _post(path) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  let body = null;
  try { body = await res.json(); } catch (_e) { body = null; }
  return { ok: res.ok, body };
}

/**
 * Finish a pending change: just the restart and the reload.
 * @param {HTMLElement} [trigger]
 * @returns {Promise<void>}
 */
export async function restartSampleMode(trigger) {
  if (_busy) return;
  _busy = true;
  if (trigger) trigger.disabled = true;
  try { await _restartAndReload(); } finally { _busy = false; if (trigger) trigger.disabled = false; }
}

/**
 * Copy the sample data, install the modules, restart.
 * @param {HTMLElement} [trigger] the button, disabled while the work runs
 * @returns {Promise<boolean>} true when the restart was started
 */
export async function enterSampleMode(trigger) {
  if (_busy) return false;
  _busy = true;
  const original = trigger ? trigger.textContent : '';
  if (trigger) { trigger.disabled = true; trigger.textContent = 'Preparing the sample team...'; }
  try {
    const { ok, body } = await _post('/api/sample-mode/enter');
    if (!ok) {
      showToast('error', 'Could not start sample mode', sampleErrorMessage(body));
      return false;
    }
    showToast('success', 'Sample mode', sampleEnterSummary(body));
    await _restartAndReload();
    return true;
  } catch (_e) {
    showToast('error', 'Could not start sample mode', 'Check that Mission Deck is running and try again.');
    return false;
  } finally {
    _busy = false;
    if (trigger) { trigger.disabled = false; trigger.textContent = original; }
  }
}

/**
 * Ask, remove the sample copy, restart.
 * @param {HTMLElement} [trigger]
 * @returns {Promise<boolean>} true when the restart was started
 */
export async function leaveSampleMode(trigger) {
  if (_busy) return false;
  const { confirmDsModal } = await import('./ds-modal.js');
  const q = sampleLeaveConfirm();
  const yes = await confirmDsModal({ title: q.title, body: q.body, okLabel: q.okLabel, cancelLabel: q.cancelLabel, trigger });
  if (!yes) return false;
  _busy = true;
  if (trigger) trigger.disabled = true;
  try {
    const { ok, body } = await _post('/api/sample-mode/leave');
    if (!ok) {
      showToast('error', 'Could not leave sample mode', sampleErrorMessage(body));
      return false;
    }
    showToast('success', 'Leaving sample mode', 'Restarting Mission Deck with your own team data...');
    await _restartAndReload();
    return true;
  } catch (_e) {
    showToast('error', 'Could not leave sample mode', 'Check that Mission Deck is running and try again.');
    return false;
  } finally {
    _busy = false;
    if (trigger) trigger.disabled = false;
  }
}

/**
 * Paint (or empty) the top-bar slot from the current status. The slot has no
 * skeleton and stays empty unless the mode is on, so nothing reserves width
 * for a badge almost nobody sees.
 * @returns {Promise<void>}
 */
export async function refreshSampleBadge() {
  const root = document.getElementById('topbar-sample-root');
  if (!root) return;
  const status = await fetchSampleModeStatus();
  root.replaceChildren();
  // One attribute lets the stylesheet take the sync controls away: nothing is
  // synced in this mode, and their buttons would only answer 409 sample-mode.
  if (shouldShowSampleBadge(status)) document.documentElement.setAttribute('data-sample-mode', '1');
  else document.documentElement.removeAttribute('data-sample-mode');
  if (!shouldShowSampleBadge(status)) return;
  const state = sampleBadgeState(status);

  const badge = document.createElement('span');
  badge.className = 'ds-badge ds-badge--amber ds-badge--md topbar-sample-badge';
  badge.textContent = state.label;
  badge.title = state.title;
  root.appendChild(badge);

  const leave = document.createElement('button');
  leave.type = 'button';
  leave.className = 'ds-btn ds-btn--tertiary ds-btn--sm topbar-sample-leave';
  leave.textContent = state.actionLabel;
  leave.addEventListener('click', () => { leaveSampleMode(leave); });
  root.appendChild(leave);
}
