// ── Mission Deck — js/infra-banner.js ─────────────────────────────────
// The "no connection to the cockpit infrastructure" strip: a second fixed bar
// under the top bar, same shape as js/update-banner.js. It paints from TWO
// readings and takes no fetch of its own - js/topbar.js hands it every
// /api/bitwarden/status answer the Bitwarden pill paints from (boot and every
// `cockpit:secrets-changed`) and every /api/infra/status answer (boot, after
// the identity lookup, the 60 s poll, a recheck), so the strip, the pill and
// the server register can never disagree. Which half is wrong decides the
// sentence and the buttons (js/infra-banner-helpers.mjs).
//
// The height is reserved the way the update banner's is: the last answer is
// remembered in localStorage, js/theme-boot.js stamps
// html[data-infra-banner="reserved"] before the first paint, and every settled
// answer here releases it - a locked vault at boot then costs no jump, and a
// machine that was fine last time reserves nothing.

import {
  INFRA_BANNER_TEXTS, INFRA_BANNER_OPEN_VAULT, INFRA_BANNER_RECHECK, INFRA_BANNER_RECHECKING,
  infraBannerState, infraBannerVisible, infraBannerCanOpenVault, infraBannerCanRecheck, infraRecovered,
} from './infra-banner-helpers.mjs';
import { emitInfraChanged } from './infra-events.js';
import { showToast } from './toast.js';

// Key js/theme-boot.js reads before the first paint to reserve the row.
const SEEN_KEY = 'cockpit.infraBannerSeen';

// The two readings, kept so either one arriving can repaint the whole strip.
let _status;
let _net;

// The X hides the strip for THIS session only, and only for the KIND it was
// clicked on: a vault strip dismissed in the morning must not silence the
// network strip in the afternoon, and a strip that went away and came back
// (hide in between) deserves a fresh one. The first version kept one boolean
// that reset only on `hide`, so one click muted the strip for the session.
let _dismissedKind = null;

function _el() {
  return document.getElementById('infra-banner');
}

/**
 * Remember whether the strip is expected next load and release the
 * reservation this load runs under. Called on every settled answer.
 * @param {boolean} expected
 */
function _settleReservation(expected) {
  try { localStorage.setItem(SEEN_KEY, expected ? '1' : '0'); } catch (_e) { /* private mode */ }
  document.documentElement.removeAttribute('data-infra-banner');
}

function _hide(banner) {
  banner.classList.add('app-update-banner--hidden');
}

async function _openVault() {
  try {
    // The same modal the pill opens; a successful unlock announces itself
    // on the secrets bus and the top bar repaints this strip from it.
    const { _openBitwardenModal } = await import('./settings.js');
    _openBitwardenModal();
  } catch (e) {
    console.error('[infra-banner] bitwarden modal failed to open:', e);
    showToast('warning', 'Could not open Bitwarden', 'Reload the page and try again.');
  }
}

/**
 * One click, one probe. The fetch lives in js/topbar.js (the one reader of
 * every status this strip paints from); a dynamic import, because the top
 * bar imports this module statically and a second static edge would close
 * a cycle.
 * @param {HTMLButtonElement} btn
 */
async function _recheck(btn) {
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = INFRA_BANNER_RECHECKING;
  try {
    const { recheckInfra } = await import('./topbar.js');
    const out = await recheckInfra();
    // Every state the probe can come back in that is still a problem gets its
    // own sentence. Without the `refused` arm a still-locked-out recheck said
    // nothing at all, which reads as success.
    const state = out && out.network ? out.network.state : null;
    if (state === 'unreachable') {
      showToast('warning', 'GitLab is still not answering', 'Check that the VPN is connected and try again.');
    } else if (state === 'refused') {
      showToast('warning', 'GitLab still refuses the connection', 'Check that the VPN is connected. If it is, renew the token in Settings > Keys.');
    }
  } catch (e) {
    console.error('[infra-banner] recheck failed:', e);
    showToast('warning', 'Could not check the connection', 'Reload the page and try again.');
  } finally {
    // The repaint after a settled recheck rebuilds the row; this only matters
    // when the strip is still on screen with the same button in it.
    if (btn.isConnected) { btn.disabled = false; btn.textContent = label; }
  }
}

/**
 * @param {HTMLElement} banner
 * @param {'vault'|'network'|'access'|'both'} kind
 */
function _render(banner, kind) {
  banner.innerHTML = '';
  banner.classList.remove('app-update-banner--hidden');
  banner.dataset.kind = kind;

  const row = document.createElement('div');
  row.className = 'app-update-banner__row';

  const msg = document.createElement('span');
  msg.className = 'app-update-banner__msg';
  msg.textContent = INFRA_BANNER_TEXTS[kind];
  row.appendChild(msg);

  if (infraBannerCanOpenVault(kind, _status)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'app-update-banner__btn';
    btn.textContent = INFRA_BANNER_OPEN_VAULT;
    btn.addEventListener('click', _openVault);
    row.appendChild(btn);
  }

  if (infraBannerCanRecheck(kind)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'app-update-banner__btn';
    btn.textContent = INFRA_BANNER_RECHECK;
    btn.addEventListener('click', () => { _recheck(btn); });
    row.appendChild(btn);
  }

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'app-update-banner__dismiss';
  dismiss.setAttribute('aria-label', 'Close');
  dismiss.textContent = '✕';
  dismiss.addEventListener('click', () => {
    _dismissedKind = kind;
    _hide(banner);
  });
  row.appendChild(dismiss);

  banner.appendChild(row);
}

/** Repaint from both readings as they stand. */
function _repaint() {
  const banner = _el();
  if (!banner) return;
  const kind = infraBannerState(_status, _net);
  if (infraBannerVisible(kind)) {
    // Unhide first, release second - the other order leaves a frame where
    // .main pads for neither state. A strip already showing THIS kind is
    // left alone: the 60 s poll lands here with an unchanged reading, and a
    // rebuild would swap a disabled "Checking…" for a live button while
    // its probe is still running.
    const showing = !banner.classList.contains('app-update-banner--hidden') && banner.dataset.kind === kind;
    if (_dismissedKind === kind) _hide(banner); else if (!showing) _render(banner, kind);
    _settleReservation(true);
    return;
  }
  _dismissedKind = null;
  _hide(banner);
  _settleReservation(false);
}

/**
 * Paint the vault half from one /api/bitwarden/status answer. `null` means
 * the request could not answer; that half then says nothing, because a dead
 * endpoint is not evidence about the vault.
 * @param {object|null} status
 */
export function paintInfraBanner(status) {
  _status = status && typeof status === 'object' ? status : null;
  _repaint();
}

/**
 * Paint the network half from the `network` field of one /api/infra/status
 * (or /api/infra/recheck) answer. `null` says nothing. A flip from
 * unreachable to reachable is announced on the infra bus, so every surface
 * that memoised the outage re-derives itself without an F5.
 * @param {object|null} net
 */
export function paintInfraNetwork(net) {
  const next = net && typeof net === 'object' ? net : null;
  const recovered = infraRecovered(_net, next);
  // `_net` is assigned BEFORE the bus fires, and that order is what stops a
  // loop: every listener re-reads /api/infra/status and lands back here, and
  // a second reading of `reachable` over a `_net` that already says so is
  // not a recovery. Repaint first and this would emit on every echo.
  _net = next;
  _repaint();
  if (recovered) emitInfraChanged({ reason: 'network-recovered' });
}

/** The last network reading this strip painted from (for views that want to say why). */
export function getInfraNetwork() {
  return _net || null;
}
