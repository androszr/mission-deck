// -- Mission Deck -- js/day-cycle-modal.js ----------------------------
// The evening "End of day" and morning "Good morning" modals, opened from the
// two top-bar pills (js/topbar.js). All markup for the day-cycle flow lives
// here; js/day-cycle-helpers.mjs stays free of `document` so its unit tests run under
// plain `node --test`. This module is never a view: no #view-<id> section, no
// VIEW_REGISTRY entry, no runActiveViewCleanup - the overlay is removed from
// the document on every exit path, so there is nothing left for a view cleanup to
// unregister.
//
// Evening (openWrapUpModal): for every row read off GET /api/sync-overview,
// wrapUpPlanForRow() decides push-and-clear / clear / skip. The run goes
// SEQUENTIALLY, one repo at a time - the server holds one file lock per
// source, so a parallel run would just collide and read back `locked`. A
// plaintext clear only ever follows a push once a FRESH, uncached read of
// /api/sync-overview confirms filesToSend === 0 for that row: the cached
// overview (fetchSyncOverview/getSyncOverview in js/data-tier-0-sync.js)
// keeps the LAST GOOD payload on a failed fetch, and reading that stale row
// here could greenlight a delete the push never actually finished shipping.
// The server's own gate (wrapUpClearEligibility) is the real backstop; this
// is a second, independent check on the client side of it.
//
// Morning (openMorningModal): no new endpoint - POST /api/data/<repoId>/decrypt
// on every row morningRowsToDecrypt() names. A successful decrypt clears the
// server-side wrappedUpAt marker on its own (server.js).
//
// The "Shut down Mission Deck" button is built ONLY once the run has finished and
// only inside the summary screen - never before confirmation, never mid-run.
// That is the safety gate: closing the process mid-encrypt, mid-push or
// mid-clear would leave a plaintext tree emptied halfway and possibly a held
// repo lock, and the server has no way to tell "the client is done" on its
// own.

import { openDsModal, closeDsModal } from './ds-modal.js';
import { showToast } from './toast.js';
import { state } from './state.js';
import { loadTeamDirectory, memberByName } from './team-directory.js';
import { refreshUserSlot, refreshDayCycleButton } from './topbar.js';
import { clearDataTierPlaintext, decryptDataTierRepo } from './data-tier-0-sync.js';
import { runSyncWithProgress, formatSyncStreamError } from './sub-repo-sync-stream.js';
import {
  wrapUpPlanForRow,
  pushOutcomeAllowsClear,
  morningRowsToDecrypt,
  summarizeWrapUp,
  dayCycleRowBadge,
} from './day-cycle-helpers.mjs';

/** @param {string} pose one of the mascot poses (assets/mascot/pip-<pose>.svg) @returns {string} */
function _mascotSrc(pose) {
  return `/assets/mascot/pip-${pose}.svg`;
}

// ASCII state code -> display label. Deliberately NOT in day-cycle-helpers.mjs:
// that file stays byte-ASCII (see its own header), so the one lookup table
// that turns a code into copy a person reads lives here instead.
const _BADGE_LABEL = {
  'not-ready': 'not cloned',
  'no-token': 'no token',
  'locked': 'vault locked',
  'no-key': 'no key',
  'wrapped-up': 'day already wrapped up',
  'not-decrypted': 'not decrypted',
  'pending': 'to send',
  'ready': 'ready',
};

/** @param {string} code @returns {string} */
function _badgeLabel(code) {
  return _BADGE_LABEL[code] || code;
}

const _OUTCOME_LABEL = {
  'pushed-and-cleared': 'sent and cleared',
  'cleared': 'cleared',
};

// Server error codes from POST .../clear-plaintext, mapped to a short readable
// reason for the summary line. `fs-error` carries a raw English
// Error.message - the contract says to wrap it, never render it verbatim.
const _CLEAR_ERROR_REASON = {
  'not-configured': 'source is not cloned',
  'key-missing': 'no encryption key',
  'refused': 'old folder layout',
  'plaintext-ahead': 'not sent to the team yet',
  'probe-failed': 'could not check the state of the copy',
  'locked': 'another process is syncing this data',
  'fs-error': 'file system error',
  // Not a server code: js/data-tier-0-sync.js `_postJson` answers this from
  // its own catch when the request never reached the server, and its
  // `message` is a raw English DOMException. Mapped here for the same reason
  // `fs-error` is - a summary line must never read "Failed to fetch".
  'network': 'no connection to the server',
};

/** @param {{error?: string, message?: string}} data @returns {string} */
function _clearErrorReason(data) {
  const info = data || {};
  if (info.error && _CLEAR_ERROR_REASON[info.error]) return _CLEAR_ERROR_REASON[info.error];
  return info.message || 'unknown error';
}

/** @param {Element} overlay */
function _closeOverlay(overlay) {
  closeDsModal(overlay);
  overlay.remove();
}

/**
 * Empty overlay/modal shell shared by both day-cycle modals.
 * @param {string} id
 * @returns {{overlay: Element, modal: Element}}
 */
function _buildShell(id) {
  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay day-cycle-overlay';
  overlay.id = id;

  const modal = document.createElement('div');
  modal.className = 'ds-modal ds-modal--lg day-cycle-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  return { overlay, modal };
}

/**
 * A modal that STAYS OPEN must only ever get an illustration whose CSS
 * animation loops (`infinite`). Every pose of the mascot does: the float and
 * the blink are infinite, and each SVG turns them off under
 * prefers-reduced-motion. `wave` greets in the morning and says goodbye on
 * the farewell screen, `sleeping` marks a wrapped-up day, `success` says there
 * is nothing left to do.
 * @param {string} name mascot pose @returns {Element}
 */
function _buildIllustration(name) {
  const img = document.createElement('img');
  img.className = 'day-cycle-mascot';
  img.src = _mascotSrc(name);
  img.alt = '';
  return img;
}

// ── Evening: "End of day" ────────────────────────────────────────────────────

let _wrapUpOverlay = null;

/** One row's plan-derived badge before confirmation. @returns {Element} */
function _buildPlanRow(row) {
  const plan = wrapUpPlanForRow(row);
  const card = document.createElement('div');
  card.className = 'ds-card day-cycle-row';
  card.dataset.repoId = row.repo || '';

  const labelEl = document.createElement('span');
  labelEl.className = 'day-cycle-row__label';
  labelEl.textContent = row.label || row.repo || '';
  card.appendChild(labelEl);

  const badge = document.createElement('span');
  badge.className = 'ds-badge day-cycle-row__badge ' + (
    plan.action === 'skip' ? 'ds-badge--gray' : plan.action === 'push-and-clear' ? 'ds-badge--yellow' : 'ds-badge--green'
  );
  badge.textContent = plan.action === 'push-and-clear' ? 'will send and clear'
    : plan.action === 'clear' ? 'will clear'
      : `will skip: ${_badgeLabel(plan.reason)}`;
  card.appendChild(badge);

  return card;
}

/** @param {Element} listEl @param {string} repoId @param {string} cls @param {string} text */
function _setRowBadge(listEl, repoId, cls, text) {
  const card = listEl.querySelector(`[data-repo-id="${repoId}"]`);
  const badge = card && card.querySelector('.day-cycle-row__badge');
  if (!badge) return;
  badge.className = 'ds-badge day-cycle-row__badge ' + cls;
  badge.textContent = text;
}


/**
 * Run the wrap-up sequentially, one row at a time, updating each row's badge
 * live. Returns the per-row outcomes summarizeWrapUp() reduces.
 * @param {object[]} rows
 * @param {Element} listEl
 * @returns {Promise<object[]>}
 */
async function _runWrapUp(rows, listEl) {
  const results = [];
  for (const row of rows) {
    const repoId = row.repo;
    const label = row.label || repoId;
    const plan = wrapUpPlanForRow(row);

    if (plan.action === 'skip') {
      // Resolve the code to display text HERE, not at the summary: every other
      // `reason` pushed into `results` below is already display text (a
      // wrapped push error, a mapped clear error), so the summary screen
      // renders one vocabulary instead of guessing per line.
      const reason = _badgeLabel(plan.reason);
      _setRowBadge(listEl, repoId, 'ds-badge--gray', `skipped: ${reason}`);
      results.push({ repoId, label, outcome: 'skipped', reason });
      continue;
    }

    let pushError = null;
    if (plan.action === 'push-and-clear') {
      _setRowBadge(listEl, repoId, 'ds-badge--yellow', 'sending...');
      const pushResult = await runSyncWithProgress(`/api/data/${repoId}/push-stream`, {
        title: `Sync ${label} (Send)`,
        repoBase: `data/${repoId}`,
        encrypted: true,
        // quiet: this modal is already open and renders every failure on the
        // row itself plus in the summary; the sync-log modal would land on
        // top of a run that is still going.
        inline: { quiet: true },
      });
      if (!pushResult.ok) pushError = pushResult.error || 'error';
    }

    if (plan.action === 'push-and-clear' && !pushOutcomeAllowsClear(pushError)) {
      const reason = 'the send blocked the clear: ' + formatSyncStreamError({ error: pushError });
      _setRowBadge(listEl, repoId, 'ds-badge--red', 'skipped');
      results.push({ repoId, label, outcome: 'skipped', reason });
      continue;
    }

    // No client-side "is it really sent?" pre-check here on purpose. The one
    // that used to sit here required `filesToSend === 0`, but that count
    // UNIONS unpushed COMMITS (`git diff @{upstream}...HEAD`, see
    // _repoPendingSet), so a push whose encrypt+commit succeeded and whose
    // network send failed still reads > 0 - and the row was skipped, its
    // plaintext never cleared. That inverted the rule this feature is built
    // on ("a failed push does not block the wipe, a failed encrypt does") and
    // made pushOutcomeAllowsClear's whole allow-branch unreachable: offline,
    // "End of day" cleaned nothing. The server's own gate is authoritative
    // and stricter where it matters - it recomputes added/changed under the
    // same lock as the delete - so let it answer, and render its
    // `plaintext-ahead` message on the row if it refuses.
    _setRowBadge(listEl, repoId, 'ds-badge--yellow', 'clearing...');
    const clearResult = await clearDataTierPlaintext(repoId);
    if (clearResult.ok) {
      const outcome = plan.action === 'push-and-clear' ? 'pushed-and-cleared' : 'cleared';
      _setRowBadge(listEl, repoId, 'ds-badge--green', _OUTCOME_LABEL[outcome]);
      results.push({ repoId, label, outcome });
    } else {
      const reason = _clearErrorReason(clearResult);
      _setRowBadge(listEl, repoId, 'ds-badge--red', 'skipped');
      results.push({ repoId, label, outcome: 'skipped', reason });
    }
  }
  return results;
}

/** @param {Element} overlay */
async function _confirmShutdown(overlay, body, footer) {
  try {
    const res = await fetch('/api/settings/shutdown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) {
      showToast('error', 'Could not shut down Mission Deck', `HTTP ${res.status}`);
      return;
    }
    _renderFarewellScreen(body, footer);
  } catch (e) {
    showToast('error', 'Could not shut down Mission Deck', String((e && e.message) || e));
  }
}

/** The permanent post-shutdown screen. The server is gone - never poll, never offer a way back. */
function _renderFarewellScreen(body, footer) {
  body.replaceChildren();
  body.appendChild(_buildIllustration('wave'));

  const title = document.createElement('h3');
  title.className = 'day-cycle-farewell-title';
  title.textContent = 'Mission Deck has shut down';
  body.appendChild(title);

  const p = document.createElement('p');
  p.className = 'day-cycle-farewell-text';
  p.textContent = 'The vault is locked. In the morning start Mission Deck as usual and click "Good morning".';
  body.appendChild(p);

  footer.replaceChildren();
}

/** The closing summary screen: what happened to each row, then the two exit buttons. */
function _renderWrapUpSummary(overlay, body, footer, results) {
  const summary = summarizeWrapUp(results);

  body.replaceChildren();
  body.appendChild(_buildIllustration('sleeping'));

  const list = document.createElement('div');
  list.className = 'day-cycle-row-list';
  for (const line of summary.lines) {
    const row = document.createElement('div');
    row.className = 'ds-card day-cycle-row';

    const labelEl = document.createElement('span');
    labelEl.className = 'day-cycle-row__label';
    labelEl.textContent = line.label;
    row.appendChild(labelEl);

    const badge = document.createElement('span');
    const skipped = line.outcome === 'skipped';
    badge.className = 'ds-badge ' + (skipped ? 'ds-badge--gray' : 'ds-badge--green');
    badge.textContent = skipped
      ? `skipped${line.reason ? ': ' + line.reason : ''}`
      : (_OUTCOME_LABEL[line.outcome] || line.outcome);
    row.appendChild(badge);

    list.appendChild(row);
  }
  body.appendChild(list);

  const summaryText = document.createElement('p');
  summaryText.className = 'day-cycle-summary-text';
  summaryText.textContent = `Cleared ${summary.cleared} of ${results.length}, sent ${summary.pushed}, skipped ${summary.skipped}.`;
  body.appendChild(summaryText);

  footer.replaceChildren();

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'ds-btn ds-btn--secondary';
  closeBtn.textContent = 'Close window';
  closeBtn.addEventListener('click', () => {
    _closeOverlay(overlay);
    _wrapUpOverlay = null;
  });

  const shutdownBtn = document.createElement('button');
  shutdownBtn.type = 'button';
  shutdownBtn.className = 'ds-btn ds-btn--danger';
  shutdownBtn.textContent = 'Shut down Mission Deck';
  shutdownBtn.addEventListener('click', () => _confirmShutdown(overlay, body, footer));

  footer.appendChild(closeBtn);
  footer.appendChild(shutdownBtn);

  // The application will visibly empty until the morning decrypt: the
  // avatar is the fastest tell, so it repaints right away rather than
  // waiting for the next view render.
  if (summary.cleared > 0) {
    try { localStorage.setItem('cockpit.dayCycle.lastCleared', new Date().toISOString()); } catch (_e) { /* private mode */ }
    loadTeamDirectory(true).catch(() => { /* empty directory is a normal state */ });
    refreshUserSlot();
    // The pill flips to "Good morning" the moment something was cleared - the
    // server now carries wrappedUpAt for that row, so a fresh read is enough.
    refreshDayCycleButton().catch(() => { /* the pill keeps its last paint */ });
  }
}

/** Open the evening "Done for today?" modal. Safe to call while already open (no-op). */
export async function openWrapUpModal() {
  if (_wrapUpOverlay) return;
  const { overlay, modal } = _buildShell('day-cycle-wrapup-modal');
  _wrapUpOverlay = overlay;

  const header = document.createElement('div');
  header.className = 'ds-modal-header';
  const title = document.createElement('span');
  title.className = 'ds-modal-title';
  title.textContent = 'Done for today?';
  header.appendChild(title);

  const body = document.createElement('div');
  body.className = 'ds-modal-body';
  body.appendChild(_buildIllustration('sleeping'));

  const listEl = document.createElement('div');
  listEl.className = 'day-cycle-row-list';
  const loadingP = document.createElement('p');
  loadingP.textContent = 'Loading data sources...';
  listEl.appendChild(loadingP);
  body.appendChild(listEl);

  const callout = document.createElement('div');
  callout.className = 'ds-callout ds-callout--warning';
  callout.textContent = 'Until the morning the app will look empty - team photos, prototypes, the mural and training progress come back once you decrypt in the morning.';
  body.appendChild(callout);

  const footer = document.createElement('div');
  footer.className = 'ds-modal-footer';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'ds-btn ds-btn--secondary';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    _closeOverlay(overlay);
    _wrapUpOverlay = null;
  });
  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'ds-btn ds-btn--primary';
  confirmBtn.textContent = 'Send and clear';
  footer.appendChild(cancelBtn);
  footer.appendChild(confirmBtn);

  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(footer);

  openDsModal(overlay);

  let rows = [];
  try {
    const res = await fetch('/api/sync-overview', { cache: 'no-store' });
    if (res.ok) {
      const d = await res.json();
      rows = Array.isArray(d.repos) ? d.repos : [];
    }
  } catch (_e) { /* empty rows below reads as "could not load" */ }

  listEl.replaceChildren();
  if (!rows.length) {
    const errCallout = document.createElement('div');
    errCallout.className = 'ds-callout ds-callout--danger';
    errCallout.textContent = 'Could not load the list of data sources.';
    listEl.appendChild(errCallout);
    confirmBtn.disabled = true;
  } else {
    for (const row of rows) listEl.appendChild(_buildPlanRow(row));
  }

  confirmBtn.addEventListener('click', async () => {
    cancelBtn.disabled = true;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Working...';
    const results = await _runWrapUp(rows, listEl);
    _renderWrapUpSummary(overlay, body, footer, results);
  });
}

// ── Morning: "Good morning" ──────────────────────────────────────────────────

let _morningOverlay = null;

/** @param {string|null|undefined} displayName @returns {string} */
function _firstName(displayName) {
  const s = String(displayName || '').trim();
  if (!s) return '';
  // The team directory is the ONE resolver that knows which token is the
  // first name: half the source systems hand this app "Lastname Firstname", and a
  // GitLab token carries whatever order the account was created with. Reading
  // token[0] greeted a person as "Hi, Morgan!" - their
  // surname. `memberByName` already handles the reversed order, the
  // diacritics and the contract-code prefixes (see js/team-directory.js), so
  // ask it first and keep the split only for a machine whose data repo has no
  // team/ folder yet, where every resolver returns empty by design.
  const member = memberByName(s);
  if (member && member.first_name) return String(member.first_name).trim();
  // No match, no guess. The fallback used to be `s.split(/\s+/)[0]`, which is
  // a coin flip on the order and lost it for this repo's own author. And it
  // loses it precisely HERE: the morning modal runs on a cockpit whose
  // `team/` folder was wiped last night, so the directory is empty and this
  // branch is the one that actually executes. Greeting somebody by their
  // surname is worse than not greeting them by name - the heading above
  // already says "Good morning", and the caller drops the line on an empty
  // string.
  return '';
}

/**
 * Render the morning modal's body once /api/sync-overview has answered.
 * Swaps the illustration to the `success` pose when there is nothing left to
 * decrypt, without needing a click.
 */
function _renderMorningContent(overlay, content, toDecrypt, noKeyRows) {
  content.replaceChildren();

  if (noKeyRows.length) {
    const callout = document.createElement('div');
    callout.className = 'ds-callout ds-callout--warning';
    callout.textContent = `No key for: ${noKeyRows.map((r) => r.label || r.repo).join(', ')}`;
    content.appendChild(callout);
  }

  if (!toDecrypt.length) {
    const mascotImg = overlay.querySelector('.day-cycle-mascot');
    if (mascotImg) mascotImg.src = _mascotSrc('success');
    const empty = document.createElement('p');
    empty.className = 'day-cycle-empty';
    empty.textContent = 'Everything is already decrypted - have a nice day!';
    content.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'day-cycle-row-list';
  for (const row of toDecrypt) {
    const card = document.createElement('div');
    card.className = 'ds-card day-cycle-row';
    card.dataset.repoId = row.repo || '';

    const labelEl = document.createElement('span');
    labelEl.className = 'day-cycle-row__label';
    labelEl.textContent = row.label || row.repo || '';
    card.appendChild(labelEl);

    const badgeInfo = dayCycleRowBadge(row);
    const badge = document.createElement('span');
    badge.className = 'ds-badge day-cycle-row__badge ' + badgeInfo.cls;
    badge.textContent = _badgeLabel(badgeInfo.state);
    card.appendChild(badge);

    list.appendChild(card);
  }
  content.appendChild(list);

  const decryptBtn = document.createElement('button');
  decryptBtn.type = 'button';
  decryptBtn.className = 'ds-btn ds-btn--primary';
  decryptBtn.textContent = 'Decrypt';
  decryptBtn.addEventListener('click', async () => {
    decryptBtn.disabled = true;
    decryptBtn.textContent = 'Decrypting...';
    let anyOk = false;
    // Sequential, same rule as the evening run: one repo file lock per source.
    for (const row of toDecrypt) {
      const repoId = row.repo;
      const card = list.querySelector(`[data-repo-id="${repoId}"]`);
      const badge = card && card.querySelector('.day-cycle-row__badge');
      const result = await decryptDataTierRepo(repoId);
      if (result.ok) {
        anyOk = true;
        if (badge) { badge.className = 'ds-badge day-cycle-row__badge ds-badge--green'; badge.textContent = 'decrypted'; }
      } else if (badge) {
        badge.className = 'ds-badge day-cycle-row__badge ds-badge--red';
        badge.textContent = formatSyncStreamError(result);
      }
    }
    decryptBtn.disabled = false;
    decryptBtn.textContent = 'Decrypt';
    if (anyOk) {
      loadTeamDirectory(true).catch(() => { /* empty directory is a normal state */ });
      refreshUserSlot();
      // A successful decrypt clears wrappedUpAt server-side, so this
      // re-read is what flips the pill back to "End of day".
      refreshDayCycleButton().catch(() => { /* the pill keeps its last paint */ });
      const mascotImg = overlay.querySelector('.day-cycle-mascot');
      if (mascotImg) mascotImg.src = _mascotSrc('success');
      showToast('success', 'Data decrypted', 'Team photos and progress are coming back on screen.');
    } else {
      showToast('error', 'Decryption failed', 'Check the list above.');
    }
  });
  content.appendChild(decryptBtn);
}

/** @param {Date} d @returns {string} local YYYY-MM-DD, never a UTC slice. */
function _localDateStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Open the morning "Good morning! Let's decrypt the data" modal.
 * @param {{auto?: boolean}} [opts] - `auto` is informational only (who called
 *   this): the greeted-on marker is set on every open, whoever triggered it.
 */
export async function openMorningModal(opts) {
  if (_morningOverlay) return;
  void opts; // caller context only; behaviour does not branch on it
  const { overlay, modal } = _buildShell('day-cycle-morning-modal');
  _morningOverlay = overlay;

  try { localStorage.setItem('cockpit.dayCycle.greetedOn', _localDateStr(new Date())); } catch (_e) { /* private mode */ }

  const header = document.createElement('div');
  header.className = 'ds-modal-header';
  const title = document.createElement('span');
  title.className = 'ds-modal-title';
  title.textContent = "Good morning! Let's decrypt the data";
  header.appendChild(title);
  const closeX = document.createElement('button');
  closeX.type = 'button';
  closeX.className = 'ds-modal-close';
  closeX.setAttribute('aria-label', 'Close');
  closeX.innerHTML = '&times;';
  closeX.addEventListener('click', () => {
    _closeOverlay(overlay);
    _morningOverlay = null;
  });
  header.appendChild(closeX);

  const body = document.createElement('div');
  body.className = 'ds-modal-body';
  body.appendChild(_buildIllustration('wave'));

  const firstName = _firstName(state.whoami && state.whoami.display_name);
  if (firstName) {
    const greeting = document.createElement('p');
    greeting.className = 'day-cycle-greeting-name';
    greeting.textContent = `Hi, ${firstName}!`;
    body.appendChild(greeting);
  }

  const content = document.createElement('div');
  content.className = 'day-cycle-morning-content';
  const loadingP = document.createElement('p');
  loadingP.textContent = 'Loading...';
  content.appendChild(loadingP);
  body.appendChild(content);

  const footer = document.createElement('div');
  footer.className = 'ds-modal-footer';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'ds-btn ds-btn--secondary';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => {
    _closeOverlay(overlay);
    _morningOverlay = null;
  });
  footer.appendChild(closeBtn);

  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(footer);

  openDsModal(overlay);

  let rows = [];
  try {
    const res = await fetch('/api/sync-overview', { cache: 'no-store' });
    if (res.ok) {
      const d = await res.json();
      rows = Array.isArray(d.repos) ? d.repos : [];
    }
  } catch (_e) { /* empty rows below reads as "could not load" */ }

  const toDecrypt = morningRowsToDecrypt(rows);
  const noKeyRows = rows.filter((r) => r && r.status === 'ready' && r.encryptionReady === false);
  _renderMorningContent(overlay, content, toDecrypt, noKeyRows);
}
