// ── Mission Deck — js/topbar.js ───────────────────────────────────────────
// Fixed top bar: rail collapse toggle, data-tier-0 sync button, Bitwarden pill,
// Claude terminal pill, "MR:" chips, active-people badge and user avatar.
//
// Nothing else belongs up here: a control earns a slot in the top bar only if
// it is needed on every view AND has an endpoint in user-data/BUILD-CONTRACT.md.
// That test is what keeps this file small.
//
// Exception: "End of day" and "Good morning" have no entry in BUILD-CONTRACT -
// they operate on the same sources the Sync pill does and
// must stay reachable from every view; plan 2026-09-08-koniec-dnia-dzien-dobry.
//
// The "Stash" pill DOES have its entry (GET|POST /api/app/stash*) and is the
// narrowest slot here: absent entirely unless git stash list has something.
// See the section at the bottom of this file for why it earns the bar.
//
// The help/feedback button passes both halves of the rule too: needed on
// every view (a report is about the screen someone is on right now) and its
// own entry, POST /api/feedback/submit, is in BUILD-CONTRACT.

import { state } from './state.js';
import { fetchWhoami } from './whoami.js';
import { initials } from './utils.js';
import { loadTeamDirectory, memberByName, memberAvatarUrl, fullName } from './team-directory.js';
import { showToast } from './toast.js';
import { fetchDataTierStatus, getDataTierStatus, dataTierPending } from './data-tier-0-sync.js';
import { onSecretsChanged } from './secrets-events.js';
import { onInfraChanged } from './infra-events.js';
import { paintInfraBanner, paintInfraNetwork } from './infra-banner.js';
import { clearSkeleton } from './skeleton.js';
import { dayCycleMode, shouldAutoOpenMorning } from './day-cycle-helpers.mjs';
import { shouldShowStashPill, stashPillState, fetchStashEntries } from './stash-helpers.mjs';
import { mrRowsToPaint, mrChipState } from './topbar-mr-helpers.mjs';

// ── User avatar slot ──────────────────────────────────────────────────────────

// GET /api/whoami is the single source of truth about the current person. The
// name comes from the GitLab token's OWN name (the token this cockpit mints is
// called <imie-nazwisko>-COCKPIT-APP), falling back to git config and then
// the OS account. It always answers 200 -- anonymous is a normal state -- so
// this fetch never puts a red line in the console.

/**
 * Fetch the identity once and repaint the avatar. Fire-and-forget: a failure
 * leaves the anonymous avatar in place, which is what the slot renders anyway.
 * @returns {Promise<void>}
 */
async function _loadIdentity(opts) {
  // The team directory rides along: it decides whether the slot shows the team
  // photo instead of the GitLab one. A data repo with no team folder resolves
  // to an empty directory, so this never turns into an error. Both reads go
  // out at once - they are independent, and in series the avatar waited for
  // team-members.json before even asking who the person is.
  const [, who] = await Promise.all([
    loadTeamDirectory().catch(() => undefined),
    fetchWhoami(opts),
  ]);
  if (who) refreshUserSlot();
  // The identity lookup is the first GitLab call of a page load, so the
  // reachability register has its first verdict right after it - read it
  // now rather than waiting for the 60 s poll.
  refreshInfraStatus().catch(() => {});
}

// ── Infrastructure strip: the network half ────────────────────────────────────
// The strip (js/infra-banner.js) never fetches; this is its one reader for
// /api/infra/status, a register read the server fills from the GitLab calls
// it already makes. Cheap enough to ride the 60 s sync poll.

/**
 * Read the reachability verdict and hand it to the strip. `null` on a dead
 * endpoint, which says nothing.
 * @returns {Promise<void>}
 */
// Sequence of the newest read in flight: the poll and the read after an
// identity lookup can overlap, and an older answer landing second would
// paint a stale verdict - and, on the next read, a second recovery edge
// with the whole re-derive behind it.
let _infraReadSeq = 0;

export async function refreshInfraStatus() {
  const mine = ++_infraReadSeq;
  try {
    const res = await fetch('/api/infra/status?t=' + Date.now());
    if (mine !== _infraReadSeq) return;
    if (!res.ok) { paintInfraNetwork(null); return; }
    const body = await res.json();
    if (mine !== _infraReadSeq) return;
    paintInfraNetwork(body && body.network ? body.network : null);
  } catch (_e) { if (mine === _infraReadSeq) paintInfraNetwork(null); }
}

/**
 * The strip's "Check again": one identity lookup against GitLab on the
 * server, then the verdict it produced. Returns the body so the strip can
 * say "still down" in a toast.
 * @returns {Promise<object|null>}
 */
export async function recheckInfra() {
  const res = await fetch('/api/infra/recheck', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error('recheck ' + res.status);
  const body = await res.json();
  paintInfraNetwork(body && body.network ? body.network : null);
  return body;
}

/**
 * Paint the avatar button. Falls back to a generic user icon whenever whoami
 * is unavailable — which is the normal state before a token is configured.
 * @param {Element} root
 * @param {object|null} who
 */
function _renderUserSlot(root, who) {
  root.replaceChildren();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'app-top-bar__user-btn';

  const anon = !who || !who.valid;

  if (anon) {
    const icon = document.createElement('img');
    icon.className = 'nav-icon app-top-bar__user-icon';
    icon.setAttribute('src', '/assets/icons/ds/24-ic-user.svg');
    icon.setAttribute('alt', '');
    icon.setAttribute('aria-hidden', 'true');
    btn.appendChild(icon);
    const hint = 'Configure the COCKPIT_APP_TOKEN token in Settings';
    btn.setAttribute('title', hint);
    btn.setAttribute('aria-label', hint);
  } else {
    // Three sources, best first: the team photo from the data repo, the avatar
    // the GitLab account carries, then initials. The team photo wins because it
    // is the same face every other view will show once they use the directory.
    const member = memberByName(who.display_name || '');
    const label = fullName(member) || who.display_name || who.gitlab_username || '';
    const photoUrl = memberAvatarUrl(member) || who.avatar_url || '';
    if (photoUrl) {
      const img = document.createElement('img');
      img.className = 'app-top-bar__user-img';
      img.setAttribute('src', photoUrl);
      img.setAttribute('alt', '');
      img.setAttribute('aria-hidden', 'true');
      img.setAttribute('referrerpolicy', 'no-referrer');

      const fallback = document.createElement('span');
      fallback.className = 'app-top-bar__user-initials';
      fallback.textContent = initials(label);
      fallback.hidden = true;
      img.addEventListener('error', () => { img.hidden = true; fallback.hidden = false; });

      btn.appendChild(img);
      btn.appendChild(fallback);
    } else {
      const ini = document.createElement('span');
      ini.className = 'app-top-bar__user-initials';
      ini.textContent = initials(label);
      btn.appendChild(ini);
    }
    btn.setAttribute('title', label);
    btn.setAttribute('aria-label', label);
  }

  btn.addEventListener('click', () => { location.hash = '#settings'; });
  root.appendChild(btn);
}

/** Repaint the avatar from the cached identity. */
export function refreshUserSlot() {
  const root = document.getElementById('topbar-user-root');
  if (!root) return;
  _renderUserSlot(root, state.whoami);
}

// ── Rail collapse/expand toggle ───────────────────────────────────────────────

const _COLLAPSED_KEY = 'cockpit.sidebarCollapsed';
const _ICON_COLLAPSED = '/assets/icons/ds/24-ic-chevron-right.svg';
const _ICON_EXPANDED = '/assets/icons/ds/24-ic-chevron-left.svg';

function _applyRailState(sidebar, body, iconEl, collapsed) {
  // The ATTRIBUTE is what the stylesheet reads - js/theme-boot.js sets it
  // before the first paint from the same localStorage key, so the rail never
  // paints at the wrong width. The two classes stay because JS queries them
  // (_showSidebarTooltip in js/app.js, the toggle handler below); all three
  // are written here so they can never disagree.
  document.documentElement.setAttribute('data-rail', collapsed ? 'collapsed' : 'expanded');
  if (collapsed) {
    sidebar.classList.add('collapsed');
    body.classList.add('sidebar-collapsed');
  } else {
    sidebar.classList.remove('collapsed');
    body.classList.remove('sidebar-collapsed');
  }
  if (iconEl) iconEl.src = collapsed ? _ICON_COLLAPSED : _ICON_EXPANDED;
}

function _initRailToggle() {
  const toggle = document.getElementById('topbar-rail-toggle');
  const iconEl = document.getElementById('topbar-rail-toggle-icon');
  const sidebar = document.getElementById('sidebar');
  if (!toggle || !sidebar) return;

  const body = document.body;
  // Default: collapsed.
  let stored = null;
  try { stored = localStorage.getItem(_COLLAPSED_KEY); } catch (_e) { /* private mode */ }
  _applyRailState(sidebar, body, iconEl, stored === null ? true : stored === '1');

  toggle.addEventListener('click', () => {
    const isNowCollapsed = !sidebar.classList.contains('collapsed');
    try { localStorage.setItem(_COLLAPSED_KEY, isNowCollapsed ? '1' : '0'); } catch (_e) { /* ignore */ }
    _applyRailState(sidebar, body, iconEl, isNowCollapsed);
  });
}

// ── Bitwarden pill ────────────────────────────────────────────────────────────

const _BW_KEY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="16" height="16" aria-hidden="true"><circle cx="8" cy="15" r="3"/><path d="M11 15h9M14 12v6"/><path d="M17 15V9.5a5.5 5.5 0 0 0-11 0"/></svg>';

/**
 * Render the Bitwarden lock-state pill. Renders nothing when the CLI is not
 * installed — the pill would only offer an action that cannot work.
 * @param {Element} root
 */
// A failed check is NOT a final answer, and telling the two apart is the whole
// point of this block. `notInstalled` is a fact - no Bitwarden CLI on this
// machine - and paints nothing, the way it always has. Anything else that
// leaves us without a status (a dead endpoint, a probe that did not answer)
// is a MISSING fact: it used to take the same silent path, so the pill simply
// disappeared from the bar with nothing to click and nothing to read, and
// since this slot has no poll of its own it never came back. Now it paints a
// neutral pill that says the check failed, and retries a few times.
const _BW_RETRY_MS = 6000;
const _BW_RETRY_MAX = 3;
let _bwRetryTimer = null;
let _bwRetries = 0;

/**
 * The state has settled, so forget the retry budget AND drop any timer still
 * queued behind it: without the clearTimeout a retry scheduled while the check
 * was failing still fired after a `cockpit:secrets-changed` had already
 * painted the real answer, costing one pointless render and one pointless
 * `bw status` spawn after everything was already correct.
 */
function _bwRetrySettled() {
  if (_bwRetryTimer) { clearTimeout(_bwRetryTimer); _bwRetryTimer = null; }
  _bwRetries = 0;
}

/** One pending retry at a time, and a bounded number of them. */
function _scheduleBwRetry(root) {
  if (_bwRetryTimer || _bwRetries >= _BW_RETRY_MAX) return;
  _bwRetries += 1;
  _bwRetryTimer = setTimeout(() => {
    _bwRetryTimer = null;
    _renderBitwardenButton(root);
  }, _BW_RETRY_MS);
}

/** The neutral "could not check" pill: readable, clickable, never silent. */
function _paintBwUnknown(root) {
  root.replaceChildren();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sidebar-ai-toggle-btn topbar-bw-btn';
  btn.style.borderColor = 'var(--body-tertiary-text)';
  btn.innerHTML = `<span style="display:inline-flex;color:var(--body-tertiary-text)">${_BW_KEY_SVG}</span><span>Bitwarden</span>`;
  btn.title = 'Bitwarden - could not check the vault state. Click to try again.';
  btn.setAttribute('aria-label', btn.title);
  btn.addEventListener('click', () => { _bwRetrySettled(); _renderBitwardenButton(root); });
  root.appendChild(btn);
}

export async function _renderBitwardenButton(root) {
  let status;
  try {
    const res = await fetch('/api/bitwarden/status?t=' + Date.now());
    if (!res.ok) { paintInfraBanner(null); _paintBwUnknown(root); _scheduleBwRetry(root); return; }
    status = await res.json();
  } catch (_e) { paintInfraBanner(null); _paintBwUnknown(root); _scheduleBwRetry(root); return; }
  // The infrastructure strip (js/infra-banner.js) paints from THIS answer and
  // never fetches on its own - one status read, two surfaces, no disagreement.
  // A machine with no CLI still gets the strip: it holds no token either.
  paintInfraBanner(status);
  // No CLI at all: a fact, and a final one. Paint nothing and drop the
  // skeleton with it, or it pulses for the whole session.
  if (status && status.status === 'notInstalled') { _bwRetrySettled(); clearSkeleton(root); return; }
  if (!status || !status.installed) { _paintBwUnknown(root); _scheduleBwRetry(root); return; }
  _bwRetrySettled();

  // Three states, not two. An unlocked vault that matched no item is NOT the
  // same as a locked one: the password worked, the collection just holds
  // nothing this cockpit declares. Painting that red sends people back to
  // re-type a password that was never the problem.
  // The pill answers "does the app have secrets", not "is the vault open":
  // secrets survive a self-restart while the vault session does not, and a
  // fully authenticated cockpit painted red sent people to re-unlock for
  // nothing. `sessionOpen` only changes the tooltip.
  const vaultOpen = status.status === 'unlocked';
  const unlocked = !!status.hasSecrets;
  const openButEmpty = vaultOpen && !status.hasSecrets;
  root.replaceChildren();

  const borderColor = unlocked
    ? 'var(--state-success-text, #059669)'
    : openButEmpty
      ? 'var(--state-warning-text, #b45309)'
      : 'var(--state-error-text, #dc2626)';
  const btn = document.createElement('button');
  btn.type = 'button';
  // Deliberately shares `sidebar-ai-toggle-btn` with the sibling sync button
  // (SRC js/topbar.js does the same) so both pills match.
  btn.className = 'sidebar-ai-toggle-btn topbar-bw-btn';
  btn.style.borderColor = borderColor;
  btn.innerHTML = `<span style="display:inline-flex;color:${borderColor}">${_BW_KEY_SVG}</span><span>Bitwarden</span>`;
  btn.title = unlocked
    ? (status.sessionOpen === false
      ? 'Bitwarden - secrets loaded. Vault locked after the restart: refreshing secrets needs an unlock.'
      : 'Bitwarden - secrets loaded')
    : openButEmpty
      ? 'Bitwarden - vault unlocked, but no item matches. Check Settings > Keys.'
      : 'Bitwarden - locked';
  btn.addEventListener('click', async () => {
    try {
      const { _openBitwardenModal } = await import('./settings.js');
      _openBitwardenModal();
    } catch (e) {
      console.error('[topbar] bitwarden modal failed to open:', e);
      showToast('warning', 'Could not open Bitwarden', 'Reload the page and try again.');
    }
  });
  root.appendChild(btn);
}

// ── data-tier-0 sync button ───────────────────────────────────────────────────

let _syncPollTimer = null;

function _paintSyncButton(btn, dot, status) {
  const pending = dataTierPending(status);
  btn.classList.toggle('topbar-sync-btn--pending', pending);
  dot.hidden = !pending;
  if (status && status.lastSync) btn.title = 'Last sync: ' + status.lastSync;
}

/**
 * Render the "Sync" pill. One click runs a streamed pull of
 * data-tier-0; a 60 s poll keeps the pending dot current.
 * @param {Element} root
 */
export async function _renderSyncButton(root) {
  root.replaceChildren();

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sidebar-ai-toggle-btn topbar-sync-btn';
  btn.title = 'Data sync';

  // Masked <span> rather than <img>: the icon has to follow currentColor so it
  // turns amber with the pill. Mask url lives in styles.css.
  const icon = document.createElement('span');
  icon.className = 'topbar-sync-btn-icon';
  icon.setAttribute('aria-hidden', 'true');
  btn.appendChild(icon);

  const label = document.createElement('span');
  label.textContent = 'Sync';
  btn.appendChild(label);

  const dot = document.createElement('span');
  dot.className = 'topbar-sync-dot';
  dot.hidden = true;
  btn.appendChild(dot);

  // Opens the quick read-only preview (js/topbar-sync-preview.js) rather than
  // firing a pull or jumping straight into the full modal - a pull can
  // rewrite the working copy, so the confirmation step stays behind the
  // preview's own "Open" button. Dynamic import keeps both modules' markup
  // out of the boot path.
  btn.addEventListener('click', async () => {
    try {
      const { openSyncPreview } = await import('./topbar-sync-preview.js');
      await openSyncPreview(btn);
    } catch (e) {
      // A failed dynamic import (stale cached bundle after a deploy, offline
      // tab) or a throw inside the panel must not die as an unhandled rejection.
      console.error('[topbar] sync preview failed to open:', e);
      showToast('warning', 'Could not open the sync preview', 'Reload the page and try again.');
    } finally {
      _paintSyncButton(btn, dot, getDataTierStatus());
    }
  });

  root.appendChild(btn);

  _paintSyncButton(btn, dot, await fetchDataTierStatus());

  if (_syncPollTimer) clearInterval(_syncPollTimer);
  _syncPollTimer = setInterval(async () => {
    if (document.hidden) return;
    // The infrastructure strip's network half rides this timer: a register
    // read on the server, no probe, so it costs nothing to ask every minute.
    refreshInfraStatus().catch(() => {});
    _paintSyncButton(btn, dot, await fetchDataTierStatus());
  }, 60000);
}

/** Repaint the sync pill from the cached status (called after a settings action). */
export function repaintSyncButtonFromCache() {
  const root = document.getElementById('topbar-sync-root');
  if (!root) return;
  const btn = root.querySelector('.topbar-sync-btn');
  const dot = root.querySelector('.topbar-sync-dot');
  if (btn && dot) _paintSyncButton(btn, dot, getDataTierStatus());
}

// ── Claude Code terminal pill ─────────────────────────────────────────────────
// The top bar owns the only pointer-driven entry point to the bottom-docked
// terminal (the other way in is the Ctrl+` shortcut wired in js/app.js). One
// entry point on purpose: two would need their toggle state kept in sync.

const _TERM_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="14" height="14" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><polyline points="6 9 9 12 6 15"/><line x1="12" y1="15" x2="17" y2="15"/></svg>';

/**
 * Render the terminal toggle. The module is imported lazily so xterm.js and
 * the WebSocket only load when someone actually opens a terminal.
 * @param {Element} root
 */
function _renderTerminalButton(root) {
  root.replaceChildren();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sidebar-ai-toggle-btn topbar-term-btn';
  btn.title = 'Terminal Claude Code (Ctrl+`)';
  btn.innerHTML = _TERM_SVG + '<span>Terminal</span>';
  btn.addEventListener('click', async () => {
    try {
      const mod = await import('./claude-terminal.js');
      mod.initUnifiedTerminal();
      mod.toggleUnifiedTerminal();
    } catch (e) {
      console.error('[topbar] terminal failed to open:', e);
      showToast('warning', 'Could not open the terminal', 'Reload the page and try again.');
    }
  });
  root.appendChild(btn);
}

// ── Day cycle: one pill, two modes ───────────────────────────────────────────
// ONE slot (#topbar-daycycle-root), never two: the pill shows "End of day"
// (wrap-up) or "Good morning" (morning decrypt) depending on
// dayCycleMode(rows) - never both at once. Dynamic-imports
// js/day-cycle-modal.js on first click, same pattern as the terminal button
// above, so the modal markup stays out of the boot path.

/**
 * Paint the day-cycle pill for one mode and wire its click to the matching
 * modal. Rebuilt (not toggled in place) every time the mode is (re)computed,
 * so the click handler always opens the modal for the mode actually shown.
 * @param {Element} root
 * @param {'morning'|'wrapup'} mode
 */
function _renderDayCycleButton(root, mode) {
  root.replaceChildren();
  const isMorning = mode === 'morning';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sidebar-ai-toggle-btn topbar-daycycle-btn' + (isMorning ? ' topbar-daycycle-btn--morning' : '');

  const label = document.createElement('span');
  label.textContent = isMorning ? 'Good morning' : 'End of day';
  btn.appendChild(label);

  if (isMorning) {
    // Same dot the "Sync" pill uses for "something is waiting" -
    // data is sitting encrypted, so there is something to do here too.
    const dot = document.createElement('span');
    dot.className = 'topbar-sync-dot';
    btn.appendChild(dot);
  }

  const title = isMorning ? 'Decrypt the data for a new day' : 'Send changes and clear the data from disk';
  btn.title = title;
  btn.setAttribute('aria-label', title);

  btn.addEventListener('click', async () => {
    try {
      const mod = await import('./day-cycle-modal.js');
      if (isMorning) await mod.openMorningModal({ auto: false });
      else await mod.openWrapUpModal();
    } catch (e) {
      console.error('[topbar] day-cycle modal failed to open:', e);
      showToast('warning', 'Could not open the window', 'Reload the page and try again.');
    }
  });

  root.appendChild(btn);
}

/**
 * Re-read /api/sync-overview and repaint the day-cycle pill from it. The one
 * fetch this whole flow costs outside a modal: called once at boot and again
 * after the two actions that can flip the mode (a wrap-up that cleared
 * something, a morning decrypt that succeeded) - no polling in between.
 * @returns {Promise<{rows: object[], mode: 'morning'|'wrapup'}>}
 */
export async function refreshDayCycleButton() {
  const root = document.getElementById('topbar-daycycle-root');
  let rows = [];
  try {
    const res = await fetch('/api/sync-overview', { cache: 'no-store' });
    if (res.ok) {
      const d = await res.json();
      rows = Array.isArray(d.repos) ? d.repos : [];
    }
  } catch (_e) { /* empty rows -> 'wrapup', the neutral default */ }
  const mode = dayCycleMode(rows);
  if (root) _renderDayCycleButton(root, mode);
  return { rows, mode };
}

/** Local YYYY-MM-DD, never a UTC slice - same rule `_fmtHHMM` above states. */
function _localDateStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Auto-open the morning modal at most once a day, and only after an evening
 * that actually cleared something. Takes the rows `refreshDayCycleButton()`
 * already fetched - a fresh install carries neither localStorage key, so
 * `shouldAutoOpenMorning` answers false without needing a fetch of its own.
 * @param {object[]} rows
 */
async function _autoOpenMorningIfDue(rows) {
  if (location.hash.replace(/^#/, '') === 'onboarding-wizard') return;
  let lastCleared = null;
  let greetedOn = null;
  try {
    lastCleared = localStorage.getItem('cockpit.dayCycle.lastCleared');
    greetedOn = localStorage.getItem('cockpit.dayCycle.greetedOn');
  } catch (_e) { return; }
  if (!shouldAutoOpenMorning({ lastCleared, greetedOn, today: _localDateStr(new Date()) })) return;

  if (!rows.some((r) => r && r.wrappedUpAt)) {
    // The marker was already cleared some other way (e.g. from the sync
    // window) - stop asking every load.
    try { localStorage.removeItem('cockpit.dayCycle.lastCleared'); } catch (_e) { /* ignore */ }
    return;
  }

  try {
    const mod = await import('./day-cycle-modal.js');
    await mod.openMorningModal({ auto: true });
  } catch (e) {
    console.error('[topbar] auto-open morning modal failed:', e);
  }
}

// ── Merge request chips ───────────────────────────────────────────────────────
// "MR:" plus one chip per repository fed by GET /api/merge-requests/counts -
// the same slot an earlier version of the app had for its app and knowledge-base
// repos, here for the module catalog: every new or updated module reaches
// the team as a merge request on `cockpit-modules`, and one waiting for
// review belongs to no view, which is what earns it the bar. The chip is a
// link to the GitLab list (`webUrl` from the server); a red chip means
// something is waiting, gray means nothing is. The route is in
// user-data/BUILD-CONTRACT.md. Decisions live in js/topbar-mr-helpers.mjs.

let _mrPollTimer = null;

/**
 * Paint the "MR:" chips into `root`. Renders nothing while no row has a
 * token (`error: 'no_token'` on every row) - the normal state of a fresh
 * install - and, like the activity chip, is able to UNPAINT: a server
 * restart drops every vault-loaded token, so the poll must take the chips
 * off the bar again rather than leave a stale count there for good.
 * @param {Element} root
 */
export async function _renderMrBadges(root) {
  let data;
  // A dead endpoint paints nothing, so the skeleton goes too; the no-rows
  // path below calls replaceChildren(), which drops it on its own.
  try {
    const res = await fetch('/api/merge-requests/counts?t=' + Date.now());
    if (!res.ok) { clearSkeleton(root); return; }
    data = await res.json();
  } catch (_e) {
    clearSkeleton(root);
    return;
  }
  const rows = mrRowsToPaint(data);
  root.replaceChildren();
  if (rows.length === 0) return;

  const label = document.createElement('span');
  label.className = 'app-top-bar__mr-label';
  label.textContent = 'MR:';
  root.appendChild(label);

  for (const row of rows) {
    const chip = mrChipState(row);
    const el = document.createElement(chip.href ? 'a' : 'span');
    el.className = 'app-top-bar__mr-chip ds-badge ds-badge--sm '
      + (chip.tone === 'red' ? 'ds-badge--red' : 'ds-badge--gray');
    if (chip.href) {
      el.href = chip.href;
      el.target = '_blank';
      el.rel = 'noopener noreferrer';
    }
    el.textContent = chip.text;
    el.title = chip.title;
    el.setAttribute('aria-label', chip.title);
    root.appendChild(el);
  }
}

/** Repaint the "MR:" chips from a fresh server answer (secrets bus, publish). */
export async function refreshMrBadges() {
  const root = document.getElementById('topbar-mr-root');
  if (root) await _renderMrBadges(root);
}

// ── Activity badge ────────────────────────────────────────────────────────────
// "Active:" chip fed by GET /api/gitlab-activity/active-count (60 s server
// cache; a missing COCKPIT_OWNER_TOKEN answers `error: 'no_token'` and the
// slot stays empty — that is the normal state for most of the team, not a
// fault to flash on every reload). Popover lists the people, portaled to
// document.body so no ancestor can clip it. First click pins the popover open,
// a second click navigates to the "GitLab activity" view.

let _activePeople = [];
let _activePopoverEl = null;
let _activePopoverPinned = false;
let _activeOutsideHandler = null;
let _activityPollTimer = null;

/** Format an ISO-8601 timestamp as local HH:MM. Never a UTC slice. */
function _fmtHHMM(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '--:--';
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/** Remove the portaled popover and its outside-click listener. */
function _hideActivePopover() {
  if (_activePopoverEl) {
    _activePopoverEl.remove();
    _activePopoverEl = null;
  }
  _activePopoverPinned = false;
  if (_activeOutsideHandler) {
    document.removeEventListener('click', _activeOutsideHandler);
    _activeOutsideHandler = null;
  }
}

/**
 * One row's avatar: the team photo when the directory knows this person and
 * has a file for them, initials otherwise. A photo that fails to load swaps
 * itself for the initials, so a half-synced data repo never leaves a hole.
 * @param {object|null} member team directory record, or null
 * @param {string} label name the initials are derived from
 * @returns {Element}
 */
function _buildActiveAvatar(member, label) {
  const photoUrl = memberAvatarUrl(member);
  const ini = document.createElement('span');
  ini.className = 'topbar-active-popover__avatar topbar-active-popover__avatar--initials';
  ini.textContent = initials(label);
  if (!photoUrl) return ini;

  const wrap = document.createElement('span');
  wrap.className = 'topbar-active-popover__avatar-wrap';
  const img = document.createElement('img');
  img.className = 'topbar-active-popover__avatar topbar-active-popover__avatar--img';
  img.setAttribute('src', photoUrl);
  img.setAttribute('alt', '');
  img.setAttribute('aria-hidden', 'true');
  ini.hidden = true;
  img.addEventListener('error', () => { img.hidden = true; ini.hidden = false; });
  wrap.appendChild(img);
  wrap.appendChild(ini);
  return wrap;
}

/** Build and portal the popover below-right-aligned to anchorEl. */
function _showActivePopover(anchorEl) {
  _hideActivePopover();

  const panel = document.createElement('div');
  panel.className = 'topbar-active-popover';
  panel.setAttribute('role', 'tooltip');

  if (_activePeople.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'topbar-active-popover__empty';
    empty.textContent = 'Nobody active in the last hour';
    panel.appendChild(empty);
  } else {
    for (const p of _activePeople) {
      const row = document.createElement('div');
      row.className = 'topbar-active-popover__row';

      // Same resolver and same order as the user slot: the team photo from the
      // data repo first, then initials. The display name here comes from a
      // token name (`alex-morgan-COCKPIT-APP`), so it carries no
      // diacritics - the directory spelling does, and wins whenever it matches.
      const member = memberByName(p.display_name || '');
      const label = fullName(member) || p.display_name || '?';
      row.appendChild(_buildActiveAvatar(member, label));

      const nameSpan = document.createElement('span');
      nameSpan.className = 'topbar-active-popover__name';
      nameSpan.textContent = label;
      row.appendChild(nameSpan);

      const timeSpan = document.createElement('span');
      timeSpan.className = 'topbar-active-popover__time';
      timeSpan.textContent = _fmtHHMM(p.last_used_at);
      row.appendChild(timeSpan);

      panel.appendChild(row);
    }
  }

  document.body.appendChild(panel);
  _activePopoverEl = panel;

  // position:fixed + getBoundingClientRect, mirrors js/ds-select.js.
  const rect = anchorEl.getBoundingClientRect();
  panel.style.position = 'fixed';
  panel.style.top = (rect.bottom + 4) + 'px';
  const panelW = panel.offsetWidth || 200;
  let left = rect.right - panelW;
  if (left < 8) left = 8;
  panel.style.left = left + 'px';
  panel.style.zIndex = '4000';
}

/**
 * Paint the "Active:" chip into `root`. Renders nothing when no personal
 * GitLab token is configured server-side (`error: 'no_token'`).
 * @param {Element} root
 */
export async function _renderActivityBadge(root) {
  // The popover resolves faces out of this cache; the load is cached and
  // deduplicated, and an empty directory is a normal state (fresh clone).
  try { await loadTeamDirectory(); } catch (_e) { /* fall back to initials */ }
  let data;
  // Same rule as the Bitwarden pill: a dead endpoint paints nothing, so the
  // skeleton goes too. The 'no_token' path below already calls
  // replaceChildren(), which drops it on its own.
  try {
    const res = await fetch('/api/gitlab-activity/active-count?t=' + Date.now());
    if (!res.ok) { clearSkeleton(root); return; }
    data = await res.json();
  } catch (_e) {
    clearSkeleton(root);
    return;
  }
  if (!data || data.error === 'no_token') {
    // The credential can vanish mid-session: a server restart drops BW_SESSION
    // and every ENV_SCHEMA key, so the poll must be able to UNPAINT a chip it
    // painted earlier. Without this a stale count sticks on the bar for good.
    _hideActivePopover();
    root.replaceChildren();
    _activePeople = [];
    return;
  }

  _activePeople = Array.isArray(data.people) ? data.people : [];

  root.replaceChildren();
  // A pinned popover anchored to the button this repaint is about to discard
  // would dangle on screen otherwise.
  _hideActivePopover();

  const count = data.count;
  const isOn = typeof count === 'number' && count >= 1;

  let titleText = 'Active in the last hour - Mission Deck repositories';
  if (data.error) titleText += ' (' + data.error + ')';

  const dot = document.createElement('span');
  dot.className = 'app-top-bar__active-dot' + (isOn ? ' app-top-bar__active-dot--on' : '');

  const label = document.createElement('span');
  label.className = 'app-top-bar__active-label';
  label.textContent = 'Active:';

  const displayCount = (count !== null && count !== undefined) ? String(count) : '-';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'app-top-bar__active-badge-btn ds-badge ds-badge--sm ds-badge--gray';
  btn.textContent = displayCount;
  btn.title = titleText;
  btn.setAttribute('aria-label', titleText);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_activePopoverPinned) {
      _hideActivePopover();
      location.hash = '#gitlab-activity';
      return;
    }
    _showActivePopover(root);
    _activePopoverPinned = true;
    _activeOutsideHandler = (ev) => {
      if (_activePopoverEl && !_activePopoverEl.contains(ev.target) && !root.contains(ev.target)) {
        _hideActivePopover();
      }
    };
    document.addEventListener('click', _activeOutsideHandler);
  });

  // `root` survives the 5-minute poll (only its children are rebuilt), so its
  // hover listeners are wired once via a dataset flag.
  if (!root.dataset.activeHoverWired) {
    root.addEventListener('mouseenter', () => { if (!_activePopoverPinned) _showActivePopover(root); });
    root.addEventListener('mouseleave', () => { if (!_activePopoverPinned) _hideActivePopover(); });
    root.dataset.activeHoverWired = '1';
  }
  btn.addEventListener('focus', () => { if (!_activePopoverPinned) _showActivePopover(root); });
  btn.addEventListener('blur', () => { if (!_activePopoverPinned) _hideActivePopover(); });

  root.appendChild(dot);
  root.appendChild(label);
  root.appendChild(btn);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Repaint the Bitwarden pill from the live vault state. The pill is painted at
 * boot, when the vault is still locked; without this the border stays red
 * after a successful unlock until the page is reloaded, which reads as "the
 * unlock did not work" even though the tokens are already in memory.
 */
export async function refreshBitwardenButton() {
  const root = document.getElementById('topbar-bw-root');
  if (root) await _renderBitwardenButton(root);
}

/**
 * Repaint every slot whose content is derived from a server-held credential.
 * Called when the vault hands the server a new set of secrets, so the bar
 * catches up without a page reload: before this, a fresh unlock left the
 * anonymous avatar and an empty "Active" chip on screen until F5.
 *
 * Every server cache behind these three endpoints is keyed by the TOKEN
 * (`_gitlabIdentityCache`, `_gitlabActivityCountCache` in server.js), so a
 * credential that just appeared is a cache MISS - no bypass parameter needed.
 * @returns {Promise<void>}
 */
export async function refreshTopbarAfterSecrets() {
  await Promise.all([
    refreshBitwardenButton().catch(e => console.error('[topbar] bitwarden pill:', e)),
    // Repaints the avatar itself once whoami answers. Forced: the shared
    // reader would otherwise hand back the pre-unlock answer.
    _loadIdentity({ force: true }),
    (async () => {
      const activeRoot = document.getElementById('topbar-active-badge-root');
      if (activeRoot) await _renderActivityBadge(activeRoot);
    })().catch(e => console.error('[topbar] activity badge:', e)),
    // COCKPIT_MODULES_TOKEN arrives with the same unlock; the server cache
    // behind the route is keyed by the token, so this is a miss, not a replay.
    refreshMrBadges().catch(e => console.error('[topbar] mr chips:', e)),
    (async () => {
      // Fresh status, not repaintSyncButtonFromCache(): the cached copy was
      // taken while the data token was still missing, so it is exactly the
      // value that must not survive this repaint.
      const syncRoot = document.getElementById('topbar-sync-root');
      const btn = syncRoot && syncRoot.querySelector('.topbar-sync-btn');
      const dot = syncRoot && syncRoot.querySelector('.topbar-sync-dot');
      if (btn && dot) _paintSyncButton(btn, dot, await fetchDataTierStatus());
    })().catch(e => console.error('[topbar] sync pill:', e)),
  ]);
}

let _secretsWired = false;
let _helpWired = false;

/**
 * Idempotent click binding for the help/feedback button: the modal itself
 * (js/feedback-modal.js) is dynamic-imported on first click, same pattern as
 * the Stash pill below, so it never rides the boot path for people who never
 * open it.
 */
function _initHelpButton() {
  if (_helpWired) return;
  const btn = document.getElementById('topbar-help-btn');
  if (!btn) return;
  _helpWired = true;
  btn.addEventListener('click', async () => {
    try {
      const mod = await import('./feedback-modal.js');
      await mod.openFeedbackModal({ trigger: btn });
    } catch (e) {
      console.error('[topbar] feedback modal failed to open:', e);
      showToast('warning', 'Could not open the window', 'Reload the page and try again.');
    }
  });
}

/** Wire every top bar slot. Safe to call once, at boot. */
export function initTopbar() {
  _initRailToggle();
  _initHelpButton();

  if (!_secretsWired) {
    _secretsWired = true;
    onSecretsChanged(() => { refreshTopbarAfterSecrets(); });
    // The VPN coming back is the same event one axis over: every slot painted
    // from a GitLab answer memoised the outage and has to re-derive itself.
    onInfraChanged(() => { refreshTopbarAfterSecrets(); });
  }

  const mrRoot = document.getElementById('topbar-mr-root');
  if (mrRoot) {
    _renderMrBadges(mrRoot);
    // Same global timer shape as the activity poll below.
    if (_mrPollTimer) clearInterval(_mrPollTimer);
    _mrPollTimer = setInterval(() => {
      if (document.hidden) return;
      _renderMrBadges(mrRoot);
    }, 5 * 60 * 1000);
  }

  const activeRoot = document.getElementById('topbar-active-badge-root');
  if (activeRoot) {
    _renderActivityBadge(activeRoot);
    // Global top-bar timer (same pattern as the sync poll above), NOT
    // registered with runActiveViewCleanup: it outlives every view and only
    // repaints the existing chip, it never creates a new element.
    if (_activityPollTimer) clearInterval(_activityPollTimer);
    _activityPollTimer = setInterval(() => {
      if (document.hidden) return;
      _renderActivityBadge(activeRoot);
    }, 5 * 60 * 1000);
  }

  const termRoot = document.getElementById('topbar-terminal-root');
  if (termRoot) _renderTerminalButton(termRoot);

  const syncRoot = document.getElementById('topbar-sync-root');
  if (syncRoot) _renderSyncButton(syncRoot);

  const bwRoot = document.getElementById('topbar-bw-root');
  if (bwRoot) _renderBitwardenButton(bwRoot);

  const userRoot = document.getElementById('topbar-user-root');
  if (userRoot) {
    _renderUserSlot(userRoot, state.whoami);
    _loadIdentity();
  }

  // One fetch for both: the pill's initial mode and the auto-open decision
  // share the same /api/sync-overview read.
  refreshDayCycleButton().then(({ rows }) => _autoOpenMorningIfDue(rows));

  refreshStashPill();
}

// ── Stash pill ───────────────────────────────────────────────────────────────
// The third exception to the rule at the top of this file, and the narrowest:
// the pill is ABSENT unless `git stash list` has something, so on almost every
// machine it costs no slot at all. When it is there, it is there because the
// person's own uncommitted work is parked outside the tree - which is not a
// state any single view owns, and the update flow that usually creates it
// (POST /api/app/update with `stashDirty: true`) ends in a restart that leaves
// nothing on screen. Its four routes are in user-data/BUILD-CONTRACT.md.
//
// No skeleton in the slot, deliberately: reserving width for a pill that is
// usually absent would flash a grey bar on every load for everybody. The pill
// is horizontal-only in a fixed-height bar, so its late arrival shifts no view.

/** Paint the pill for a non-empty entry list, or empty the slot. */
function _renderStashPill(root, entries) {
  root.replaceChildren();
  if (!shouldShowStashPill(entries)) return;
  const { label, title } = stashPillState(entries);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sidebar-ai-toggle-btn topbar-stash-btn';

  const icon = document.createElement('img');
  icon.className = 'nav-icon';
  icon.setAttribute('src', '/assets/icons/ds/24-ic-saved-order.svg');
  icon.setAttribute('alt', '');
  icon.setAttribute('aria-hidden', 'true');
  btn.appendChild(icon);

  const text = document.createElement('span');
  text.textContent = label;
  btn.appendChild(text);

  btn.title = title;
  btn.setAttribute('aria-label', title);

  btn.addEventListener('click', async () => {
    try {
      const mod = await import('./stash-modal.js');
      // The entries this paint already holds, so the common open costs no
      // second request; the modal re-fetches after every write anyway.
      await mod.openStashModal({ entries });
    } catch (e) {
      console.error('[topbar] stash modal failed to open:', e);
      showToast('warning', 'Could not open the window', 'Reload the page and try again.');
    }
  });

  root.appendChild(btn);
}

/**
 * Re-read GET /api/app/stash and repaint the pill. Called once at boot and
 * again after every apply or drop the modal runs - no polling: a stash appears
 * only through a deliberate action (an update that parked the tree, or a
 * `git stash` in a terminal), and the next load picks that up.
 * @returns {Promise<{entries: object[]}>}
 */
export async function refreshStashPill() {
  const root = document.getElementById('topbar-stash-root');
  // The fetch comes from the helpers module, NOT from js/stash-modal.js: this
  // runs on every load, and importing the modal here would put it (and
  // ds-modal, toast and analytics behind it) on the boot path.
  const { entries } = await fetchStashEntries();
  if (root) _renderStashPill(root, entries);
  return { entries };
}
