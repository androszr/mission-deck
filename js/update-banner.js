// ── Mission Deck — js/update-banner.js ─────────────────────────────────
// Global update-available banner. Checks /api/app/check-update AND
// /api/modules/updates once on load and re-checks every 30 min. Shows a
// sticky bar when a newer app version or an installed module's update
// exists - always ONE 40px row (single item inline, or a summary plus an
// expandable list), so the existing cockpit.updateBannerSeen reservation and
// the shared padding-top: 108px rule (styles.css) stay untouched.

import { mapAppUpdateError } from './app-update-errors.js';
import {
  canOfferStash, stashConfirmText, stashNoteFromResponse, STASH_NOTE_KEY,
} from './app-update-stash.mjs';
import { showUpdateModal } from './update-modal.js';
import { showToast } from './toast.js';
import { onInfraChanged } from './infra-events.js';
import {
  parseSnoozed, withSnooze, pruneSnoozed, visibleModuleUpdates, bannerModel, batchUpdateOrder,
} from './module-updates.mjs';

const RECHECK_MS = 30 * 60 * 1000;

// Key js/theme-boot.js reads before the first paint to reserve the banner row.
const SEEN_KEY = 'cockpit.updateBannerSeen';

// Key the module-row snooze lives under. theme-boot.js does NOT read this one -
// the reservation stays keyed on SEEN_KEY alone (see Context in the plan).
const SNOOZE_KEY = 'cockpit.moduleUpdateSnoozed';

// The last render model, kept so "Remind me later" can drop one item and
// re-render the rest without re-fetching either endpoint.
let _currentModel = { items: [], summary: null, expandable: false };

// While ANY module update (single row or batch) is running, every
// [data-mod-update], [data-mod-snooze] and the batch button are disabled, so
// a second click cannot start a download the first one's restart would cut
// mid-way.
let _updateInFlight = false;

function getBannerEl() {
  return document.getElementById('app-update-banner');
}

function _readSnoozed() {
  let raw = null;
  try { raw = localStorage.getItem(SNOOZE_KEY); } catch (_e) { /* private mode */ }
  return parseSnoozed(raw);
}

function _writeSnoozed(obj) {
  try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(obj)); } catch (_e) { /* private mode */ }
}

/**
 * Remember whether a banner is expected next load, and release the reservation
 * this load is running under. Called on EVERY settled outcome of checkOnce() -
 * including the failures - because the reservation only covers the window
 * between the first paint and an answer. Left standing after a check that could
 * not answer (offline, no token) it would hold 40px of blank space at the top
 * of every view for the whole session.
 * @param {boolean} expected an update is available, so a banner is coming
 */
function _settleReservation(expected) {
  try { localStorage.setItem(SEEN_KEY, expected ? '1' : '0'); } catch (_e) { /* private mode */ }
  document.documentElement.removeAttribute('data-update-banner');
}

/**
 * POST /api/app/update from the strip. `stashDirty` is the same two-step
 * dirty-tree path the other three surfaces run: the first answer lists what
 * a stash would take, and only a confirmed click on the second button sends
 * `stashDirty: true`. The strip has no room for the file list, so the list
 * lives in the confirm dialog (stashConfirmText) instead of a callout.
 * @param {HTMLButtonElement|null} btn
 * @param {HTMLElement|null} msg
 * @param {boolean} [stashDirty]
 */
async function triggerUpdate(btn, msg, stashDirty = false) {
  if (btn) btn.disabled = true;
  _dropStashButton(msg);
  if (msg) {
    msg.textContent = stashDirty
      ? 'Stashing your changes and downloading the update… This may take a few dozen seconds.'
      : 'Downloading the update… This may take a few dozen seconds.';
  }

  try {
    const res = await fetch('/api/app/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stashDirty === true ? { stashDirty: true } : {}),
    });

    if (res.status === 202) {
      // Same recovery note the other surfaces write: the reload is seconds
      // away, and js/settings.js repaints the note on the next load.
      const note = stashNoteFromResponse(await res.json().catch(() => ({})));
      if (note) {
        try { localStorage.setItem(STASH_NOTE_KEY, JSON.stringify(note)); } catch (_e) { /* private mode */ }
      }
      if (msg) msg.textContent = 'Updated. Restarting the server — the page will reload automatically…';
      const deadline = Date.now() + 20000;
      // Require two consecutive OK checks before reloading — see settings.js:
      // one success can hit a momentarily-up socket of a still-settling server,
      // making the reloaded page's first XHR fail with "Failed to fetch".
      let okStreak = 0;
      const poll = setInterval(async () => {
        let ok = false;
        try {
          const check = await fetch('/api/app/version', { cache: 'no-store' });
          ok = check.ok;
        } catch { /* still restarting */ }
        if (ok) {
          okStreak++;
          if (okStreak >= 2) { clearInterval(poll); location.reload(); return; }
        } else {
          okStreak = 0;
        }
        if (Date.now() > deadline) clearInterval(poll);
      }, 800);
    } else {
      const body = await res.json().catch(() => ({}));
      const offer = body && body.error === 'dirty-tree' && canOfferStash(body);
      if (msg) msg.textContent = mapAppUpdateError(body, res.status, { stashActionHere: offer });
      if (offer && msg) _addStashButton(btn, msg, body);
      if (btn) btn.disabled = false;
    }
  } catch (err) {
    if (msg) msg.textContent = 'Network error: ' + err.message;
    if (btn) btn.disabled = false;
  }
}

/**
 * The second button of the dirty-tree answer, placed right after the message
 * so it sits between the sentence and "Update". Rebuilt on every answer
 * (_dropStashButton first), so a repeated refusal never stacks two of them.
 * @param {HTMLButtonElement|null} updateBtn
 * @param {HTMLElement} msg
 * @param {object} body  dirty-tree response
 */
function _addStashButton(updateBtn, msg, body) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'app-update-banner__btn app-update-banner__btn--stash';
  b.setAttribute('data-stash-update', '');
  b.textContent = 'Stash changes and update';
  b.addEventListener('click', () => {
    if (!window.confirm(stashConfirmText(body))) return;
    b.disabled = true;
    triggerUpdate(updateBtn, msg, true);
  });
  msg.insertAdjacentElement('afterend', b);
}

/** Remove the stash button a previous answer may have left next to `msg`. */
function _dropStashButton(msg) {
  if (!msg || !msg.parentElement) return;
  msg.parentElement.querySelectorAll('[data-stash-update]').forEach((el) => el.remove());
}

/** POST /api/modules/install {id, overwrite:true} - shared by the single-row
 * update (step 15) and the batch run (step 15b). Never throws.
 * @param {string} id
 * @returns {Promise<{ok: boolean, message?: string, restartRequired?: boolean}>}
 */
async function _installModule(id) {
  let body = null;
  try {
    const res = await fetch('/api/modules/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, overwrite: true }),
    });
    body = await res.json().catch(() => null);
    if (!res.ok || !body || body.ok === false) {
      return { ok: false, message: body && body.message };
    }
    return { ok: true, restartRequired: Boolean(body.restartRequired) };
  } catch (err) {
    return { ok: false, message: 'Network error: ' + err.message };
  }
}

function _applyInFlightDisabled() {
  const banner = getBannerEl();
  if (!banner) return;
  banner.querySelectorAll('[data-mod-update], [data-mod-snooze], [data-mod-update-all]')
    .forEach((el) => { el.disabled = _updateInFlight; });
}

function _itemContainerFor(id) {
  const banner = getBannerEl();
  if (!banner) return null;
  const btn = banner.querySelector(`[data-mod-update="${id}"]`);
  return btn ? btn.closest('.app-update-banner__item, .app-update-banner__row') : null;
}

/** Single-module "Update": disables the row, installs, restarts once and
 * reloads. The remaining rows come back after the reload - correct, the
 * catalog still holds newer versions for them.
 * @param {object} item a bannerModel() module item
 * @param {HTMLElement|null} msg the item's .app-update-banner__msg node
 */
async function _updateModule(item, msg) {
  if (_updateInFlight) return;
  _updateInFlight = true;
  _applyInFlightDisabled();
  if (msg) msg.textContent = `Downloading the new version of module ${item.name}…`;

  const result = await _installModule(item.id);
  if (!result.ok) {
    if (msg) msg.textContent = result.message || 'Could not update the module.';
    _updateInFlight = false;
    _applyInFlightDisabled();
    return;
  }

  if (msg) msg.textContent = `Module ${item.name} updated. Restarting the server — the page will reload automatically…`;
  try {
    // Imported BEFORE the restart is posted: a cold fetch of this chunk right
    // after the process respawns can reject, and doing it first means a
    // failed import never leaves a half-restarted server behind a dead UI.
    const { waitForServerRestart } = await import('./settings.js');
    try {
      await fetch('/api/settings/restart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    } catch (_e) { /* the connection is cut by the restart — expected */ }
    if (await waitForServerRestart()) { location.reload(); return; }
    if (msg) msg.textContent = 'Restart is taking longer than usual — reload the page manually.';
    showToast('warning', 'Restart is taking longer than usual', 'Reload the page manually.');
  } catch (err) {
    // The import is awaited BEFORE the restart is posted, so the only
    // realistic way in here is a rejected import - the restart was never
    // requested, so a page refresh alone reloads the OLD, not-yet-restarted
    // server. Point at the manual restart in Settings instead.
    if (msg) {
      msg.textContent = 'Module updated, but the restart could not be started ('
        + err.message + '). Restart the server manually in Settings > System.';
    }
    showToast('warning', 'Could not start the restart', 'Restart the server manually in Settings > System.');
  } finally {
    // finally still runs on the location.reload() path too, but resetting the
    // flag there is harmless - the page is on its way out. Every other exit
    // (install failure above, timeout, import/fetch rejection) needs this to
    // actually re-enable the buttons for the rest of the session.
    _updateInFlight = false;
    _applyInFlightDisabled();
  }
}

/** "Remind me later": snoozes exactly this (id, catalogVersion) pair and
 * re-renders the reduced model. When nothing is left the banner hides and the
 * reservation is released - it must not survive a banner the person emptied.
 * @param {object} item a bannerModel() module item
 */
function _snoozeModule(item) {
  if (_updateInFlight) return;
  _writeSnoozed(withSnooze(_readSnoozed(), item.id, item.catalogVersion));

  const items = _currentModel.items.filter((i) => !(i.kind === 'module' && i.id === item.id));
  if (items.length === 0) {
    const banner = getBannerEl();
    if (banner) banner.classList.add('app-update-banner--hidden');
    _currentModel = { items: [], summary: null, expandable: false };
    _settleReservation(false);
    return;
  }
  const appPresent = items.some((i) => i.kind === 'app');
  const moduleRows = items.filter((i) => i.kind === 'module');
  showBanner(bannerModel(appPresent, moduleRows));
}

/** Sequential batch install of every module row, then ONE restart if at
 * least one succeeded. A row the server refuses (409 module-dirty) keeps the
 * server's own message on that row.
 */
async function _updateAllModules() {
  if (_updateInFlight) return;
  const { toUpdate } = batchUpdateOrder(_currentModel.items);

  _updateInFlight = true;
  _applyInFlightDisabled();

  let succeeded = 0;
  for (const item of toUpdate) {
    const container = _itemContainerFor(item.id);
    const msg = container && container.querySelector('.app-update-banner__msg');
    if (msg) msg.textContent = `Downloading the new version of module ${item.name}…`;
    // Sequential on purpose: the server serializes installs under
    // withModulesLock anyway, and one request at a time is what keeps the
    // progress text honest.
    const result = await _installModule(item.id);
    if (result.ok) {
      succeeded++;
      if (msg) msg.textContent = `Module ${item.name} updated.`;
    } else if (msg) {
      msg.textContent = result.message || 'Could not update the module.';
    }
  }

  const summaryEl = getBannerEl() && getBannerEl().querySelector('.app-update-banner__row .app-update-banner__msg');
  if (succeeded > 0) {
    if (summaryEl) {
      summaryEl.textContent = `Updated ${succeeded} of ${toUpdate.length} modules. `
        + 'Restarting the server — the page will reload automatically…';
    }
    try {
      // Imported BEFORE the restart is posted - see _updateModule above for
      // why: a rejected cold import must never leave a half-restarted server
      // behind a UI stuck disabled for the rest of the session.
      const { waitForServerRestart } = await import('./settings.js');
      try {
        await fetch('/api/settings/restart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      } catch (_e) { /* the connection is cut by the restart — expected */ }
      if (await waitForServerRestart()) { location.reload(); return; }
      if (summaryEl) summaryEl.textContent = 'Restart is taking longer than usual — reload the page manually.';
      showToast('warning', 'Restart is taking longer than usual', 'Reload the page manually.');
    } catch (err) {
      // Same reasoning as _updateModule above: this catch is reached only
      // when the import itself rejected, so the restart was never posted.
      if (summaryEl) {
        summaryEl.textContent = `Updated ${succeeded} of ${toUpdate.length} modules, but the restart could not `
          + 'be started (' + err.message + '). Restart the server manually in Settings > System.';
      }
      showToast('warning', 'Could not start the restart', 'Restart the server manually in Settings > System.');
    } finally {
      _updateInFlight = false;
      _applyInFlightDisabled();
    }
  } else {
    if (summaryEl) summaryEl.textContent = 'Could not update any module.';
    _updateInFlight = false;
    _applyInFlightDisabled();
  }
}

/**
 * Fills one item's content (message + buttons) into an already-attached
 * container - either the row itself (single-item state) or one
 * .app-update-banner__item inside the expandable list. Every value that came
 * from the server (name, versions) goes through textContent, never innerHTML.
 * @param {HTMLElement} container
 * @param {object} item a bannerModel() item ({kind:'app'} or a module item)
 */
function _fillItemInto(container, item) {
  if (item.kind === 'app') {
    const msg = document.createElement('span');
    msg.className = 'app-update-banner__msg';
    msg.textContent = 'A new app version is available.';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'app-update-banner__btn';
    btn.textContent = 'Update';
    btn.addEventListener('click', () => triggerUpdate(btn, msg));

    container.appendChild(msg);
    container.appendChild(btn);
    return;
  }

  const msg = document.createElement('span');
  msg.className = 'app-update-banner__msg';
  msg.textContent = `New version of module ${item.name} (${item.installedVersion} → ${item.catalogVersion})`;
  container.appendChild(msg);

  if (item.dirty) {
    const badge = document.createElement('span');
    badge.className = 'ds-badge ds-badge--sm ds-badge--yellow';
    badge.textContent = 'unsaved changes';
    container.appendChild(badge);
  }

  const updateBtn = document.createElement('button');
  updateBtn.type = 'button';
  updateBtn.className = 'app-update-banner__btn';
  updateBtn.textContent = 'Update';
  updateBtn.dataset.modUpdate = item.id;
  updateBtn.addEventListener('click', () => _updateModule(item, msg));
  container.appendChild(updateBtn);

  const snoozeBtn = document.createElement('button');
  snoozeBtn.type = 'button';
  snoozeBtn.className = 'app-update-banner__btn';
  snoozeBtn.textContent = 'Remind me later';
  snoozeBtn.dataset.modSnooze = item.id;
  snoozeBtn.addEventListener('click', () => _snoozeModule(item));
  container.appendChild(snoozeBtn);
}

/**
 * Renders the banner as ALWAYS exactly one 40px row (the reservation this
 * shares with theme-boot.js depends on it) plus a hidden expandable list.
 * @param {{items: Array, summary: (string|null), expandable: boolean}} model
 */
function showBanner(model) {
  const banner = getBannerEl();
  if (!banner) return;
  // A module update (single-row or batch) may still be running when the
  // 30-min recheck fires; rebuilding now would detach the very msg/button
  // nodes that update is writing progress into and collapse an expanded
  // list mid-run. Let the running update finish and repaint on its own.
  if (_updateInFlight) return;

  // Read the expanded state of the LIST THIS RENDER IS ABOUT TO REPLACE,
  // before it is torn down - the 30-min recheck must not silently collapse
  // "Details" out from under someone who has it open. Meaningless (and
  // unused below) when the previous render had no list at all.
  const prevList = banner.querySelector('.app-update-banner__list');
  const wasExpanded = Boolean(prevList) && !prevList.hidden;

  _currentModel = model;

  banner.innerHTML = '';
  banner.classList.remove('app-update-banner--hidden');

  const row = document.createElement('div');
  row.className = 'app-update-banner__row';

  const list = document.createElement('div');
  list.className = 'app-update-banner__list';
  list.hidden = true;

  if (model.items.length === 1) {
    _fillItemInto(row, model.items[0]);
  } else {
    const msg = document.createElement('span');
    msg.className = 'app-update-banner__msg';
    msg.textContent = model.summary;
    row.appendChild(msg);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'app-update-banner__btn app-update-banner__toggle';
    toggle.textContent = 'Details';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', () => {
      const willExpand = list.hidden;
      list.hidden = !willExpand;
      toggle.textContent = willExpand ? 'Collapse' : 'Details';
      toggle.setAttribute('aria-expanded', willExpand ? 'true' : 'false');
    });
    row.appendChild(toggle);

    const moduleCount = model.items.filter((i) => i.kind === 'module').length;
    if (moduleCount >= 2) {
      const allBtn = document.createElement('button');
      allBtn.type = 'button';
      allBtn.className = 'app-update-banner__btn';
      allBtn.textContent = 'Update all';
      allBtn.dataset.modUpdateAll = '1';
      allBtn.addEventListener('click', () => _updateAllModules());
      row.appendChild(allBtn);
    }

    for (const item of model.items) {
      const itemEl = document.createElement('div');
      itemEl.className = 'app-update-banner__item';
      _fillItemInto(itemEl, item);
      list.appendChild(itemEl);
    }

    // Reapply the expanded state the render this one replaces had - the
    // model is still expandable here (more than one item), so a rebuild
    // triggered by the recheck timer must not read as a collapse.
    if (wasExpanded) {
      list.hidden = false;
      toggle.textContent = 'Collapse';
      toggle.setAttribute('aria-expanded', 'true');
    }
  }

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'app-update-banner__dismiss';
  dismiss.setAttribute('aria-label', 'Close');
  dismiss.textContent = '✕';
  dismiss.addEventListener('click', () => {
    banner.classList.add('app-update-banner--hidden');
  });
  row.appendChild(dismiss);

  banner.appendChild(row);
  banner.appendChild(list);
  _applyInFlightDisabled();
}

// One check at a time: the interval, the boot call and the infra bus can
// overlap while a check-update waits on a slow remote (up to 45 s on a VPN),
// and two of them would mean two ls-remote for one answer.
let _checkInFlight = false;

async function checkOnce() {
  if (_checkInFlight) return;
  _checkInFlight = true;
  try {
    const [appResult, modResult] = await Promise.allSettled([
      fetch('/api/app/check-update'),
      fetch('/api/modules/updates'),
    ]);

    let app = null;
    if (appResult.status === 'fulfilled' && appResult.value.ok) {
      app = await appResult.value.json().catch(() => null);
    }

    // The server answers 200 even on no-token / gitlab-unreachable / internal,
    // each with an EMPTY modules[] - that is not an answer about which
    // modules exist, so pruning against it would erase every snooze on a
    // locked vault or a cold offline cache. Only an authoritative payload
    // (ok:true, which still covers reason:'no-modules') may prune.
    let modules = [];
    let modulesKnown = false;
    if (modResult.status === 'fulfilled' && modResult.value.ok) {
      const modBody = await modResult.value.json().catch(() => null);
      if (modBody && modBody.ok === true && Array.isArray(modBody.modules)) {
        modules = modBody.modules;
        modulesKnown = true;
      }
    }

    const snoozed = modulesKnown ? pruneSnoozed(_readSnoozed(), modules) : _readSnoozed();
    if (modulesKnown) _writeSnoozed(snoozed);
    const rows = visibleModuleUpdates(modules, snoozed);
    const appHasUpdate = Boolean(app && app.ok && app.hasUpdate);
    const model = bannerModel(appHasUpdate, rows);

    if (model.items.length > 0) {
      // Order matters: unhide first, then drop the attribute, so the padding
      // never falls back to 68px for a frame between the two rules.
      showBanner(model);
      _settleReservation(true);
      if (appHasUpdate) {
        showUpdateModal({
          currentVersion: app.currentVersion,
          remoteVersion: app.remoteVersion,
          currentHash: app.currentHash,
          remoteHash: app.remoteHash,
          currentDate: app.currentDate,
          remoteDate: app.remoteDate,
        });
      }
    } else {
      _settleReservation(false);
    }
  } catch {
    // Network error or an unexpected throw - a check that cannot answer is
    // not a reason to keep reserving the banner row.
    _settleReservation(false);
  } finally {
    _checkInFlight = false;
    // check-update's `ls-remote` is the ONE call on a normal load that can
    // record a refusal (GitLab answered 401 - the VPN is off on a public host
    // behind an IP allowlist), and it lands AFTER the top bar's first register
    // read. Without this the strip learned about it from the 60 s poll, a
    // minute after the person had already read "The token was not accepted".
    // A dynamic import, same as js/infra-banner.js: the top bar is the one
    // reader of the register, and a static edge here is a dependency the
    // banner does not otherwise have.
    import('./topbar.js').then(({ refreshInfraStatus }) => refreshInfraStatus()).catch(() => { /* the poll covers it */ });
  }
}

export function initUpdateBanner() {
  checkOnce();
  // Boot-global timer: intentionally runs for the full app lifetime regardless
  // of which view is active. Do NOT register in view-lifecycle.js cleanup registry.
  setInterval(checkOnce, RECHECK_MS);
  // Without the VPN check-update fails in silence and the banner hides, so a
  // person who was offline at boot never learns there is an update until the
  // next tick - which is how the fix for the strip under this banner failed
  // to reach the very people it was written for. The VPN coming back is the
  // moment to ask again.
  onInfraChanged(() => { checkOnce(); });
}
