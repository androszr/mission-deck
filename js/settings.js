// ── Mission Deck — js/settings.js ─────────────────────────────────────────
// Settings view: one tab per area (System / Keys / Agents / Skills / Modules /
// Users / Tools / Demo - static, opens /demo/index.html). Keys
// holds ONLY the Bitwarden-sourced tokens and is read-only; every plain setting
// (URLs, project keys, flags) is edited in .env alone, so there is never a
// second place for the same value to disagree. The server's ENV_SCHEMA `kind`
// field decides which tab renders a key.
//
// Every control in this file maps 1:1 onto an endpoint in
// user-data/BUILD-CONTRACT.md. That is the rule for adding one: no setting
// renders here unless the server can actually read or write it, so the tab can
// never show a switch that does nothing.

import { showToast } from './toast.js';
import { getTheme, setTheme } from './theme.js';
import { escHtml } from './utils.js';
import { openDsModal, closeDsModal } from './ds-modal.js';
import { formatVersionLabel } from './version-format.js';
import { mapAppUpdateError, mapCheckUpdateError } from './app-update-errors.js';
import {
  STASH_NOTE_KEY, STASH_UPDATE_BTN_SELECTOR, STASH_NOTE_DISMISS_SELECTOR,
  stashNoteFromResponse, parseStashNote, dirtyTreeCalloutHtml, stashNoteHtml, stashConfirmText,
} from './app-update-stash.mjs';
import { showUpToDateModal } from './update-modal.js';
import { renderAgenciSection } from './settings-agenci.js';
import { renderSkilleSection } from './settings-skille.js';
import { refreshModulyAttention, renderModulySection } from './settings-moduly.js';
import { renderModulesCatalogSection } from './settings-moduly-katalog.js';
import { renderUzytkownicySection } from './settings-uzytkownicy.js';
import { renderNarzedziaSection } from './settings-narzedzia.js';
import { repaintSyncButtonFromCache } from './topbar.js';
import {
  fetchDataTierStatus, runDataTierSync, pushDataTier,
} from './data-tier-0-sync.js';
import { emitSecretsChanged, onSecretsChanged } from './secrets-events.js';

// ── Tabs ──────────────────────────────────────────────────────────────────────
// Panels stay in the page at all times; only `hidden` toggles. Renderers write
// into slot ids regardless of which tab is active, so a re-render must never
// depend on visibility.

const SETT_TAB_IDS = ['system', 'keys', 'agents', 'skills', 'modules', 'users', 'tools', 'demo'];
// Legacy tab ids (the old localized names, the old Models tab) still resolve when stored or deep-linked.
const SETT_TAB_ALIASES = { modele: 'agents', klucze: 'keys', agenci: 'agents', skille: 'skills', moduly: 'modules', uzytkownicy: 'users', narzedzia: 'tools' };
let _activeSettingsTab = null;

/**
 * The tab to open: a one-shot sessionStorage deep link wins over the persisted
 * choice, which in turn wins over the 'system' default.
 * @returns {string}
 */
function _getStoredSettingsTab() {
  let oneShot = null;
  let stored = null;
  try {
    oneShot = sessionStorage.getItem('settingsTargetTab');
    if (oneShot) sessionStorage.removeItem('settingsTargetTab');
    stored = localStorage.getItem('settingsActiveTab');
  } catch (_e) { /* private mode */ }
  const raw = oneShot || stored;
  const candidate = SETT_TAB_ALIASES[raw] || raw;
  return SETT_TAB_IDS.includes(candidate) ? candidate : 'system';
}

/**
 * Pure page toggle — no re-render, so switching tabs never wipes a token form.
 * @param {string} tabId
 */
function _activateSettingsTab(tabId) {
  const root = document.getElementById('view-settings');
  if (!root) return;
  _activeSettingsTab = tabId;
  root.querySelectorAll('.sett-tabs .ds-tab').forEach(btn => {
    const active = btn.dataset.settTab === tabId;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  root.querySelectorAll('[data-sett-panel]').forEach(panel => {
    panel.hidden = panel.dataset.settPanel !== tabId;
  });
  try { localStorage.setItem('settingsActiveTab', tabId); } catch (_e) { /* ignore */ }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

/** @param {string} iso @returns {string} "DD.MM.YYYY HH:MM" in local time, or a dash. */
function _fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Wait for a server restart: first confirm the server actually went DOWN, then
 * wait for it to come back UP. Without the down-gate the first poll can hit the
 * still-alive old process and report "back" prematurely.
 *
 * @param {{downTimeout?: number, upTimeout?: number}} [opts]
 * @returns {Promise<boolean>} true once the fresh server responds
 */
export async function waitForServerRestart({ downTimeout = 8000, upTimeout = 20000 } = {}) {
  async function envOk() {
    try {
      const res = await fetch('/api/settings/env', { cache: 'no-store' });
      return res.ok;
    } catch (_e) { return false; }
  }

  const downDeadline = Date.now() + downTimeout;
  let wentDown = false;
  while (Date.now() < downDeadline) {
    if (!(await envOk())) { wentDown = true; break; }
    await new Promise(r => setTimeout(r, 250));
  }

  // If we never saw it drop (very fast restart), still poll briefly so a blip settles.
  const upDeadline = Date.now() + (wentDown ? upTimeout : 3000);
  while (Date.now() < upDeadline) {
    await new Promise(r => setTimeout(r, 500));
    if (await envOk()) return true;
  }
  return false;
}

/**
 * Save .env updates WITHOUT a restart. Only valid for hot-applied keys
 * (AUTO_SYNC_*), which the server re-reads on the fly.
 * @param {Record<string,string>} updates
 * @returns {Promise<boolean>}
 */
async function doSaveHot(updates) {
  try {
    const res = await fetch('/api/settings/env', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    });
    return res.ok;
  } catch (_e) { return false; }
}

/**
 * GET /api/settings/env.
 * @returns {Promise<Array<{id: string, label: string, keys: Array<object>}>>}
 */
async function fetchEnvGroups() {
  try {
    const res = await fetch('/api/settings/env', { cache: 'no-store' });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.groups) ? data.groups : [];
  } catch (_e) { return []; }
}

// ── System tab: app version ───────────────────────────────────────────────────

/**
 * Repaint the recovery note a stash-and-update left in localStorage, with a
 * dismiss button that removes it. Paints nothing when there is none, so the
 * result area keeps its `hidden` default. The button sits inside the callout
 * and disappears with the next innerHTML, so no cleanup registration.
 * @param {HTMLElement} resultArea
 */
function _paintPendingStashNote(resultArea) {
  let note = null;
  try { note = parseStashNote(localStorage.getItem(STASH_NOTE_KEY)); } catch (_e) { /* private mode */ }
  if (!note) return;
  resultArea.hidden = false;
  resultArea.className = 'sett-version-result ds-callout ds-callout--warning';
  resultArea.innerHTML = stashNoteHtml(
    `After the last update your changes are waiting in the stash${note.at ? ' (' + _fmtDate(note.at) + ')' : ''}.`,
    note, { dismiss: true });
  const dismiss = resultArea.querySelector(STASH_NOTE_DISMISS_SELECTOR);
  if (dismiss) {
    dismiss.addEventListener('click', () => {
      try { localStorage.removeItem(STASH_NOTE_KEY); } catch (_e) { /* ignore */ }
      resultArea.hidden = true;
      resultArea.textContent = '';
      resultArea.className = 'sett-version-result';
    });
  }
}

/** Hero card with the running version plus a check/apply-update flow. */
async function renderAppVersionBlock() {
  const el = document.getElementById('settings-app-version');
  if (!el) return;

  // Deliberately NOT cleared here. On first paint the host carries the static
  // skeleton from index.html, and on a re-render it carries the previous
  // version card - both are better than a one-line "Loading..." that
  // collapses the card's height and drops the whole System tab upwards.

  // Retry transient failures: this block renders right after an update/restart
  // auto-reload, when the freshly respawned server may refuse the first request.
  let data = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch('/api/app/version', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      data = await res.json();
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      if (attempt < 4) await new Promise(r => setTimeout(r, 500));
    }
  }
  if (!data) {
    el.innerHTML = '<div class="ds-callout ds-callout--danger">Could not load the version: '
      + escHtml(lastErr ? lastErr.message : 'unknown error') + '</div>';
    return;
  }

  const versionLabel = formatVersionLabel(data.semver || data.version, data.hash);
  const dateLabel = data.updatedAt ? _fmtDate(data.updatedAt) : null;

  el.innerHTML = `
    <div class="ds-card sett-hero-card">
      <div class="ds-card-header">
        <span class="sett-hero-card__icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg></span>
        <span class="ds-card-title">App version</span>
        <span class="ds-badge ${versionLabel ? 'ds-badge--green' : 'ds-badge--yellow'}">${escHtml(versionLabel || 'Unknown version')}</span>
        ${data.hasToken ? '' : '<span class="ds-badge ds-badge--yellow ds-badge--sm">No token</span>'}
      </div>
      <div class="ds-card-body">
        <div class="sett-version-info">
          <div class="sett-version-row"><span class="sett-version-label">Current version</span><span class="sett-version-value">${escHtml((versionLabel || 'Unknown') + (dateLabel ? ' · ' + dateLabel : ''))}</span></div>
          <div class="sett-version-row"><span class="sett-version-label">Repository</span><span class="sett-version-value">${escHtml(data.repoUrl || '—')}</span></div>
          ${data.hasToken ? '' : '<div class="sett-version-row"><span class="sett-version-label">Token</span><span class="sett-version-value sett-version-value--warn">COCKPIT_APP_TOKEN missing — set it in the Keys tab</span></div>'}
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:12px">
          <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="settings-check-update-btn">Check for updates</button>
        </div>
        <div class="sett-version-result" id="settings-version-result" hidden></div>
      </div>
    </div>`;

  const checkBtn = el.querySelector('#settings-check-update-btn');
  const resultArea = el.querySelector('#settings-version-result');

  // A stash-and-update that succeeded on the previous page load left a note:
  // the success callout is followed by location.reload() within seconds, so
  // the ref would be gone before anybody read it. Repaint it here until the
  // person dismisses it - it is the only pointer to their own work.
  _paintPendingStashNote(resultArea);

  /**
   * The dirty-tree answer, painted by the shared builder in
   * js/app-update-stash.mjs (the wizard's step 6 paints the very same markup).
   * The button lives inside the callout, so the next innerHTML drops it and
   * nothing needs a cleanup registration.
   * @param {object} body
   * @param {number} status
   */
  function renderDirtyTree(body, status) {
    resultArea.className = 'sett-version-result ds-callout ds-callout--danger';
    resultArea.innerHTML = dirtyTreeCalloutHtml(body, mapAppUpdateError(body, status, { stashActionHere: true }));
    const stashBtn = resultArea.querySelector(STASH_UPDATE_BTN_SELECTOR);
    if (stashBtn) {
      stashBtn.addEventListener('click', () => {
        if (!window.confirm(stashConfirmText(body))) return;
        stashBtn.disabled = true;
        triggerUpdate(true);
      });
    }
  }

  /**
   * POST /api/app/update. `stashDirty` is the second step of the dirty-tree
   * path: only the literal true opens the server's gate, and both steps share
   * this one response handler so the outcomes cannot drift apart.
   * @param {boolean} [stashDirty]
   */
  async function triggerUpdate(stashDirty = false) {
    resultArea.hidden = false;
    resultArea.className = 'sett-version-result ds-callout ds-callout--info';
    resultArea.textContent = stashDirty
      ? 'Stashing your changes and downloading the update... This may take a few dozen seconds.'
      : 'Downloading the update... This may take a few dozen seconds.';
    checkBtn.disabled = true;
    try {
      const payload = stashDirty === true ? { stashDirty: true } : {};
      const res = await fetch('/api/app/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (res.status !== 202) {
        const body = await res.json().catch(() => ({}));
        if (body && body.error === 'dirty-tree') {
          renderDirtyTree(body, res.status);
        } else {
          resultArea.className = 'sett-version-result ds-callout ds-callout--danger';
          resultArea.textContent = mapAppUpdateError(body, res.status, { stashActionHere: true });
        }
        checkBtn.disabled = false;
        return;
      }
      const respBody = await res.json().catch(() => ({}));
      const installing = !!respBody.installing;
      const note = stashNoteFromResponse(respBody);
      if (note) {
        try { localStorage.setItem(STASH_NOTE_KEY, JSON.stringify(note)); } catch (_e) { /* private mode - the callout below is all we have */ }
      }
      resultArea.className = 'sett-version-result ds-callout ds-callout--success';
      const headline = installing
        ? 'Updated. Installing packages and restarting the server...'
        : 'Updated. Restarting the server — the page will reload automatically...';
      if (note) {
        resultArea.innerHTML = stashNoteHtml(headline, note, { trailing: 'This notice stays here after the restart until you close it.' });
      } else {
        resultArea.textContent = headline;
      }
      // Require two consecutive OK checks: a single success can hit a socket of
      // a server that is still settling (or about to restart after npm install).
      const deadline = Date.now() + (installing ? 120000 : 60000);
      let okStreak = 0;
      const poll = setInterval(async () => {
        let ok = false;
        try { ok = (await fetch('/api/app/version', { cache: 'no-store' })).ok; } catch (_e) { /* restarting */ }
        if (ok) {
          okStreak++;
          if (okStreak >= 2) { clearInterval(poll); location.reload(); return; }
        } else { okStreak = 0; }
        if (Date.now() > deadline) {
          clearInterval(poll);
          resultArea.className = 'sett-version-result ds-callout ds-callout--danger';
          resultArea.innerHTML = 'The server did not come back automatically. Reload the page manually or run <code>npm start</code> again.';
          checkBtn.disabled = false;
        }
      }, 800);
    } catch (err) {
      resultArea.className = 'sett-version-result ds-callout ds-callout--danger';
      resultArea.textContent = 'Network error: ' + String((err && err.message) || err);
      checkBtn.disabled = false;
    }
  }

  checkBtn.addEventListener('click', async () => {
    checkBtn.disabled = true;
    resultArea.hidden = false;
    resultArea.className = 'sett-version-result ds-callout ds-callout--info';
    resultArea.textContent = 'Checking...';
    try {
      const body = await (await fetch('/api/app/check-update')).json();
      if (!body.ok) {
        resultArea.className = 'sett-version-result ds-callout ds-callout--danger';
        resultArea.textContent = mapCheckUpdateError(body, { 'no-token': 'No token (COCKPIT_APP_TOKEN).' });
        checkBtn.disabled = false;
        return;
      }
      if (body.hasUpdate) {
        resultArea.className = 'sett-version-result ds-callout ds-callout--warning';
        resultArea.textContent = 'A new version is available. ';
        const updateBtn = document.createElement('button');
        updateBtn.type = 'button';
        updateBtn.className = 'ds-btn ds-btn--secondary ds-btn--sm';
        updateBtn.textContent = 'Update now';
        // Not `triggerUpdate` bare: the listener would receive the click EVENT as
        // `stashDirty`, and the loading sentence keyed on it read "Stashing your changes
        // na stash" on a plain update (the payload stayed {} - only the literal
        // true opts in - so the wording was the whole damage).
        updateBtn.addEventListener('click', () => triggerUpdate());
        resultArea.appendChild(updateBtn);
      } else {
        resultArea.hidden = true;
        showUpToDateModal({
          currentVersion: body.currentVersion,
          currentHash: body.currentHash,
          currentDate: body.currentDate,
        });
      }
      checkBtn.disabled = false;
    } catch (err) {
      resultArea.className = 'sett-version-result ds-callout ds-callout--danger';
      resultArea.textContent = 'Network error: ' + String((err && err.message) || err);
      checkBtn.disabled = false;
    }
  });
}

// ── System tab: restart ───────────────────────────────────────────────────────

async function _doRestart(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Restarting...'; }
  try {
    await fetch('/api/settings/restart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  } catch (_e) { /* the connection is cut by the restart — expected */ }
  const cameBack = await waitForServerRestart();
  if (cameBack) { location.reload(); return; }
  showToast('warning', 'Restart is taking longer than usual', 'Reload the page manually.');
  if (btn) { btn.disabled = false; btn.textContent = 'Restart server'; }
}

function _wireRestartBar() {
  const btn = document.getElementById('settings-restart-btn');
  if (btn && !btn.dataset.wired) {
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => _doRestart(btn));
  }
}

// ── System tab: sync ──────────────────────────────────────────────────────────

/**
 * Sync card: data-tier-0 repo status + the two manual actions. The background
 * auto-sync toggle and its interval used to sit here; removed 2026-09-12 with
 * the loop itself (see _runStartupChain in server.js) - it covered one of
 * eight sources and is to come back for all of them at once, not one.
 */
async function renderSyncSection() {
  const el = document.getElementById('settings-sync-section');
  if (!el) return;

  const tier = await fetchDataTierStatus();

  let repoLine;
  if (!tier.ok) repoLine = '<span class="ds-badge ds-badge--gray">Server not responding</span>';
  else if (!tier.hasToken) repoLine = '<span class="ds-badge ds-badge--yellow">COCKPIT_DATA_TOKEN missing</span>';
  else if (!tier.exists) repoLine = '<span class="ds-badge ds-badge--yellow">Repository not downloaded yet</span>';
  else repoLine = `<span class="ds-badge ds-badge--green">Ready</span>`
    + (tier.ahead ? ` <span class="ds-badge ds-badge--yellow ds-badge--sm">${tier.ahead} to send</span>` : '')
    + (tier.dirty ? ' <span class="ds-badge ds-badge--yellow ds-badge--sm">local changes</span>' : '');

  el.innerHTML = `
    <div class="ds-card sett-sys-card">
      <div class="ds-card-header">
        <span class="ds-card-title">Data sync</span>
      </div>
      <div class="ds-card-body">
        <p style="font-size:var(--text-sm);color:var(--body-secondary-text);margin:0 0 10px">
          The team data repository <code>ds-data</code>. Sync is manual —
          here or with the "Sync" button in the top bar. Nothing is fetched
          or sent in the background.
        </p>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
          <span style="font-size:12px;color:var(--text-secondary)">Status:</span>${repoLine}
          ${tier.lastSync ? `<span style="font-size:12px;color:var(--text-secondary)">last: ${escHtml(_fmtDate(tier.lastSync))}</span>` : ''}
        </div>
        <div style="display:flex;gap:8px">
          <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="settings-tier-pull">${tier.exists ? 'Fetch changes' : 'Download repository'}</button>
          <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="settings-tier-push"${tier.exists ? '' : ' disabled'}>Send changes</button>
        </div>
      </div>
    </div>`;

  const pullBtn = el.querySelector('#settings-tier-pull');
  pullBtn.addEventListener('click', async () => {
    pullBtn.disabled = true;
    try {
      await runDataTierSync(tier.exists ? 'pull' : 'clone', { onFinish: () => { renderSyncSection(); repaintSyncButtonFromCache(); } });
    } finally { pullBtn.disabled = false; }
  });

  const pushBtn = el.querySelector('#settings-tier-push');
  pushBtn.addEventListener('click', async () => {
    pushBtn.disabled = true;
    try {
      await pushDataTier();
      renderSyncSection();
      repaintSyncButtonFromCache();
    } finally { pushBtn.disabled = false; }
  });

}

// ── System tab: theme ─────────────────────────────────────────────────────────

const THEME_LABELS = { light: 'Light', dark: 'Dark', system: 'System' };

function renderThemeSection() {
  const el = document.getElementById('settings-theme-section');
  if (!el) return;
  const current = getTheme();
  el.innerHTML = `
    <div class="ds-card sett-sys-card">
      <div class="ds-card-header">
        <span class="ds-card-title">Theme</span>
      </div>
      <div class="ds-card-body">
        <p style="font-size:var(--text-sm);color:var(--body-secondary-text);margin:0 0 10px">
          Choose the interface look: light, dark or matching the system setting.
        </p>
        <div class="ds-segmented" id="settings-theme-seg">
          ${Object.entries(THEME_LABELS).map(([value, label]) =>
            `<button type="button" class="ds-segment${current === value ? ' active' : ''}" data-theme-choice="${value}">${label}</button>`).join('')}
        </div>
      </div>
    </div>`;
  el.querySelectorAll('[data-theme-choice]').forEach(btn => {
    btn.addEventListener('click', () => {
      const choice = btn.getAttribute('data-theme-choice');
      setTheme(choice);
      renderThemeSection();
      showToast('info', 'Theme changed', THEME_LABELS[choice] + ' has been applied.');
    });
  });
}

// ── Keys tab: Bitwarden ────────────────────────────────────────────────────────

async function _fetchBitwardenStatus() {
  try {
    const r = await fetch('/api/bitwarden/status');
    return r.ok ? await r.json() : { status: 'unavailable', hasSecrets: false };
  } catch (_e) { return { status: 'unavailable', hasSecrets: false }; }
}

/**
 * Why an unlocked vault produced no secrets, in one sentence plus the item
 * names it actually saw. ITEM AND KEY NAMES ONLY - the server never puts a
 * value in `diagnostics`, and neither does this. Without it the only record of
 * the mismatch is a server log line that the detached respawn makes
 * unreachable, which is exactly how "I unlocked it and nothing happened"
 * becomes unanswerable.
 * @param {object} status
 * @returns {string} HTML, or '' when there is nothing to explain
 */
function _bwEmptyVaultHint(status) {
  if (status.status !== 'unlocked' || status.hasSecrets) return '';
  const d = status.diagnostics || {};
  const seen = Array.isArray(d.itemsSeen) ? d.itemsSeen : [];
  const skippedKeys = Array.isArray(d.skippedKeys) ? d.skippedKeys : [];
  // Mirrors BW_ITEM_MAP plus the two keys matched outside it (an item ending
  // in -jira, and the CONFLUENCE_TOKEN note key).
  const wanted = ['COCKPIT-APP', 'COCKPIT-DATA', 'first-last-jira',
    'jira_tech_cockpit', 'GITLAB-PERSONAL', 'FIGMA', 'COCKPIT-PROTO-DEPLOY',
    'GEMINI', 'AMPLITUDE-*'];

  let body = '<div><strong>The vault is unlocked, but no item matches.</strong> '
    + 'The password was right — collection <code>' + escHtml(status.collection || '?') + '</code> '
    + 'has no item with a name this app looks for.</div>'
    + '<div class="sett-hint">Item names looked for: ' + wanted.map(w => '<code>' + w + '</code>').join(', ')
    + '. The Jira token is matched by the <code>-jira</code> suffix.</div>'
    // Confluence is the one credential that never arrives as an item name - it
    // is a key INSIDE a note. Listing
    // it next to the item names would send the person to create an item called
    // CONFLUENCE_TOKEN, which matches nothing and loads nothing.
    + '<div class="sett-hint">The Confluence token is not a separate item but a line '
    + '<code>CONFLUENCE_TOKEN=...</code> in the note of the keys item.</div>';

  if (seen.length) {
    body += '<div class="sett-hint">Items seen in the collection: '
      + seen.slice(0, 40).map(n => '<code>' + escHtml(n) + '</code>').join(', ')
      + (seen.length > 40 ? ' and ' + (seen.length - 40) + ' more' : '') + '.</div>';
  } else {
    body += '<div class="sett-hint">The collection returned no item with a note.</div>';
  }
  // Set by _applyRestartHandoff: this process inherited an open session from
  // the one it replaced and never read the collection itself, so presenting
  // the inherited record as its own observation would be a lie.
  if (d.adopted) {
    body += '<div class="sett-hint">This diagnosis predates the last restart — '
      + 'this process took over an open vault session but did not read the collection itself.</div>';
  }
  if (skippedKeys.length) {
    body += '<div class="sett-hint">Keys skipped as not belonging to this app: '
      + skippedKeys.slice(0, 20).map(k => '<code>' + escHtml(k.key) + '</code>').join(', ') + '.</div>';
  }
  return '<div class="ds-callout ds-callout--warning">' + body + '</div>';
}

/** @param {object} status @returns {string} human label for the lock state */
function _bwStateLabel(status) {
  if (status.hasSecrets) return 'secrets loaded';
  if (status.installed === false || status.status === 'notInstalled') return 'not installed';
  if (!status.configured) return 'server not configured';
  if (status.status === 'unauthenticated') return 'not logged in';
  if (status.status === 'locked') return 'locked';
  if (status.status === 'unlocked') return 'unlocked, no matching items';
  return 'unavailable';
}

/** Hero card at the top of the Keys tab. */
export async function _refreshBitwardenCard() {
  const host = document.getElementById('settings-bitwarden-card');
  if (!host) return;
  const status = await _fetchBitwardenStatus();
  const dotColor = status.hasSecrets ? 'green'
    : (status.status === 'unlocked' || status.status === 'locked') ? 'yellow' : 'gray';

  host.innerHTML = `
    <div class="settings-section-card ds-card settings-section-card--hero" data-section-id="bitwarden" role="button" tabindex="0" aria-label="Bitwarden — vault status">
      <span class="sett-section-card__icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></span>
      <span class="sett-section-card__title">Bitwarden</span>
      <span class="sett-section-card__desc">Bitwarden vault — tokens fetched securely via SSO, never kept in the .env file.</span>
      <span class="sett-section-card__summary">
        <span class="settings-section-card__dot settings-section-card__dot--${dotColor}"></span>
        <span class="settings-section-card__count">${escHtml(_bwStateLabel(status))}</span>
      </span>
    </div>
    ${_bwEmptyVaultHint(status)}`;

  const card = host.querySelector('.settings-section-card');
  const open = () => _openBitwardenModal();
  card.addEventListener('click', open);
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
}

/**
 * Four-step Bitwarden onboarding modal. Exported: the top bar pill opens it and
 * the onboarding wizard reuses it. Takes no success callback on purpose - a
 * successful unlock is announced on the shared secrets bus
 * (js/secrets-events.js), which every caller already listens to.
 */
export function _openBitwardenModal() {
  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.innerHTML = `
    <div class="ds-modal" style="max-width:720px">
      <div class="ds-modal-header">
        <span class="ds-modal-title">Bitwarden</span>
        <button type="button" class="ds-modal-close" id="bw-modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="ds-modal-body" id="bw-modal-content">
        <p style="font-size:12px;color:var(--text-secondary)">Loading status...</p>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  openDsModal(overlay);

  const onEsc = e => { if (e.key === 'Escape') closeModal(); };
  // Every exit path goes through here, so the document listener is dropped
  // whichever one runs - the close button, the backdrop, Escape or the
  // self-close after a successful unlock.
  const closeModal = () => {
    document.removeEventListener('keydown', onEsc);
    closeDsModal(overlay);
    setTimeout(() => overlay.remove(), 200);
  };
  overlay.querySelector('#bw-modal-close').addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', onEsc);

  const copyRow = (id, value) =>
    `<div style="display:flex;gap:8px;align-items:center;margin-top:6px">
       <code style="flex:1;padding:6px 10px;background:var(--bg-secondary);border-radius:6px;font-size:12px;user-select:all">${escHtml(value)}</code>
       <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-bw-copy="${id}" data-bw-copy-value="${escHtml(value)}">Copy</button>
     </div>`;

  // A "collection not found" answer, kept across one re-render so the
  // session-open form can show it under the field. Set by the unlock branch
  // (which repaints into that form) and consumed on the next paint.
  let pendingCollectionHint = null;

  const collectionHintHtml = (d) => {
    if (!d) return '';
    const names = Array.isArray(d.availableCollections) ? d.availableCollections : [];
    return '<div class="ds-callout ds-callout--warning" id="bw-collection-hint" style="margin:6px 0 0">'
      + '<div>Collection <code>' + escHtml(d.requestedCollection || '?') + '</code> does not exist in the vault'
      + (d.requestedCollection && d.collection && d.requestedCollection !== d.collection
        ? ' — the previous name <code>' + escHtml(d.collection) + '</code> was kept.' : '.') + '</div>'
      + (names.length
        ? '<div class="sett-hint">Collections you can access: ' + names.map(n => '<code>' + escHtml(n) + '</code>').join(', ') + '.</div>'
        : '<div class="sett-hint">The vault returned no collection — ask for access to the team collection.</div>')
      + '</div>';
  };

  function renderStepper(status) {
    const content = overlay.querySelector('#bw-modal-content');
    if (!content) return;

    const installed = status.installed !== false && status.status !== 'notInstalled';
    const configured = !!status.configured;
    const loggedIn = installed && configured
      && status.status !== 'unauthenticated' && status.status !== 'unavailable';
    const unlocked = status.hasSecrets === true;

    const steps = [
      { num: 1, done: installed, label: 'Install the Bitwarden CLI' },
      { num: 2, done: configured, label: 'Configure the vault.bitwarden.com server' },
      { num: 3, done: loggedIn, label: 'Log in via SSO' },
      { num: 4, done: unlocked, label: 'Unlock the vault and fetch secrets' },
    ];
    const currentStep = steps.findIndex(s => !s.done);

    content.innerHTML = steps.map((s, idx) => {
      const isCurrent = idx === currentStep;
      const future = currentStep >= 0 && idx > currentStep;
      const mark = s.done
        ? '<span class="bw-step-num bw-step-num--done">&#10003;</span>'
        : `<span class="bw-step-num${isCurrent ? ' bw-step-num--current' : ''}">${s.num}</span>`;
      return `<div class="bw-step${future ? ' bw-step--future' : ''}">
        ${mark}
        <div class="bw-step-main">
          <div class="bw-step-label${isCurrent ? ' bw-step-label--current' : ''}">${s.label}</div>
          <div id="bw-step-body-${s.num}"></div>
        </div>
      </div>`;
    }).join('');

    const body1 = content.querySelector('#bw-step-body-1');
    if (!installed && body1) {
      body1.innerHTML = '<p style="margin:6px 0 0;font-size:12px;color:var(--text-secondary)">Install globally with npm:</p>'
        + copyRow('install', 'npm install -g @bitwarden/cli')
        + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="bw-refresh-status" style="margin-top:8px">Refresh status</button>';
    }

    const body2 = content.querySelector('#bw-step-body-2');
    if (installed && !configured && body2) {
      body2.innerHTML = '<p style="margin:6px 0 0;font-size:12px;color:var(--text-secondary)">Points the CLI at the team server:</p>'
        + '<button type="button" class="ds-btn ds-btn--primary ds-btn--sm" id="bw-configure-btn" style="margin-top:6px">Configure vault.bitwarden.com</button>'
        + '<p style="margin:10px 0 0;font-size:12px;color:var(--text-secondary)">SSO organization identifier (step 3):</p>'
        + copyRow('org', 'Entra ID');
    }

    const body3 = content.querySelector('#bw-step-body-3');
    if (installed && configured && !loggedIn && body3) {
      // No endpoint drives this on purpose: `bw login --sso` opens a browser
      // for Entra ID, which a server-side spawn cannot complete. So the command
      // is handed to the user's own terminal and the modal only re-reads the
      // status afterwards.
      body3.innerHTML = '<p style="margin:6px 0 0;font-size:12px;color:var(--text-secondary)">Run in a terminal — it opens a browser with the SSO login:</p>'
        + copyRow('sso', 'bw login --sso')
        + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="bw-refresh-status" style="margin-top:8px">Refresh status</button>';
    }

    const body4 = content.querySelector('#bw-step-body-4');
    // What decides between the two forms below is whether THIS process holds
    // a vault session, not how many secrets it holds. Secrets can be present
    // without a session (inherited from the operator's shell) and a refresh
    // then has nothing to go through, so that state gets the unlock form; a
    // session can be open with nothing matched (wrong collection), and that
    // state gets the refresh form, because the fix is a new name, not a
    // second password.
    const sessionOpen = status.sessionOpen === true;
    const savedCollection = status.collection || '';
    // The collection field stays on screen in EVERY state past login. It used
    // to disappear the moment the vault was unlocked, and a restart did not
    // bring it back either, because the restart handoff carries the open
    // session and the loaded tokens across - so a person who typed the wrong
    // collection once had no way to change it short of editing .env by hand.
    const collectionRow = `
        <div style="margin:6px 0 12px">
          <label for="bw-modal-collection" style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">Bitwarden collection</label>
          <div style="display:flex;gap:8px;align-items:center">
            <input type="text" class="ds-input" id="bw-modal-collection" style="flex:1" placeholder="e.g. first-last" value="${escHtml(savedCollection)}" autocomplete="off">
            <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="bw-save-collection-btn" disabled>Save</button>
          </div>
        </div>`;
    const bindCollectionRow = (root, onSave) => {
      const colInput = root.querySelector('#bw-modal-collection');
      const saveColBtn = root.querySelector('#bw-save-collection-btn');
      const isDirty = () => colInput.value.trim() !== '' && colInput.value.trim() !== savedCollection;
      colInput.addEventListener('input', () => { saveColBtn.disabled = !isDirty(); });
      const save = async () => {
        if (!isDirty()) return;
        saveColBtn.disabled = true;
        saveColBtn.textContent = 'Saving...';
        colInput.disabled = true;
        try { await onSave(colInput.value.trim()); } finally {
          colInput.disabled = false;
          saveColBtn.textContent = 'Save';
          saveColBtn.disabled = !isDirty();
        }
      };
      saveColBtn.addEventListener('click', save);
      colInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
      return colInput;
    };

    if (loggedIn && body4 && !sessionOpen) {
      const inheritedNote = unlocked && !sessionOpen
        ? '<div class="ds-callout ds-callout--info" style="margin:6px 0 0">Secrets are loaded, but the vault session is closed — changing the collection or refreshing tokens needs another unlock.</div>'
        : '';
      body4.innerHTML = inheritedNote + collectionRow + `
        <div style="display:flex;gap:8px;align-items:flex-end">
          <div style="flex:1">
            <label for="bw-modal-password" style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">Bitwarden master password</label>
            <input type="text" class="ds-input sett-masked-input" id="bw-modal-password" style="width:100%"
                   autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"
                   data-1p-ignore data-lpignore="true" data-bwignore data-form-type="other">
          </div>
          <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" id="bw-modal-unlock-btn">Unlock</button>
        </div>
        <p style="margin:8px 0 0;font-size:12px;color:var(--text-secondary)">The password is not stored — it is used once to load the tokens into server memory.</p>`;

      // Fall back to a real password field where text-security is unsupported
      // (older Firefox): an unmasked master password beats a save prompt.
      const pwInput = body4.querySelector('#bw-modal-password');
      if (pwInput && !(window.CSS && CSS.supports && (CSS.supports('-webkit-text-security', 'disc') || CSS.supports('text-security', 'disc')))) {
        pwInput.type = 'password';
        pwInput.classList.remove('sett-masked-input');
      }

      // Without a session there is nothing to re-read, so "Save" only stores
      // the name. BW_COLLECTION_NAME is a hot-applied text key, so this needs
      // no restart - the old save here rebooted the server for one
      // .env line. The unlock below sends the live field value anyway, so
      // pressing Save first is optional.
      const colInput = bindCollectionRow(body4, async (name) => {
        if (await doSaveHot({ BW_COLLECTION_NAME: name })) {
          showToast('success', 'Collection saved', name);
          renderStepper(await _fetchBitwardenStatus());
        } else {
          showToast('danger', 'Could not save the collection');
        }
      });

      const unlockBtn = body4.querySelector('#bw-modal-unlock-btn');
      const pwdInput = body4.querySelector('#bw-modal-password');
      const doUnlock = async () => {
        const password = pwdInput.value.trim();
        if (!password) { showToast('warning', 'Enter the master password'); return; }
        // Clear the field the moment the value is read, not on success. The
        // master password then never sits in the page while the request is in
        // flight, and a failed attempt leaves nothing behind either. Costs a
        // retype after a typo; that is the right trade for a vault master key.
        pwdInput.value = '';
        pwdInput.disabled = true;
        unlockBtn.disabled = true;
        unlockBtn.textContent = 'Unlocking...';
        try {
          // The server reads `masterPassword` (+ the live collection name);
          // sending `password` made every unlock answer 400.
          const r = await fetch('/api/bitwarden/unlock', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ masterPassword: password, collectionName: colInput.value.trim() }),
          });
          const d = await r.json().catch(() => ({}));
          if (r.ok && d.success !== false) {
            if (d.collectionNotFound || d.listFailed) {
              // The password worked and the session is open; only the name
              // matched no collection (or the list could not be read at
              // all). Repaint into the session-open form, where the same
              // field re-reads without a second password.
              if (d.listFailed) showToast('warning', 'Vault unlocked, but the collection could not be read', 'Check the VPN and the connection to vault.bitwarden.com, then use "Refresh secrets".');
              else { showToast('warning', 'Vault unlocked, but the collection does not exist', 'Check the collection name and save it again.'); pendingCollectionHint = d; }
              emitSecretsChanged({ reason: 'unlock' });
              renderStepper(await _fetchBitwardenStatus());
              return;
            }
            // Same rule as the refresh button: a failed `bw sync` means the
            // tokens just loaded came from the local CLI cache, so the toast
            // must not read like a clean pull.
            if (d.syncFailed) {
              showToast('warning', 'Vault unlocked, tokens from cache', 'Could not sync the vault (bw sync) - values may be out of date.');
            } else {
              showToast('success', 'Vault unlocked', 'Tokens loaded into server memory.');
            }
            // One announcement instead of a hand-written list of repaints. The
            // top bar (avatar, "Active", the pill) and this view's own
            // credential-dependent panels subscribe to it, so an unlock started
            // from anywhere catches up without a page reload.
            emitSecretsChanged({ reason: 'unlock' });
            // A successful unlock is the last thing this modal exists for, so
            // it closes itself instead of repainting a stepper with four ticks
            // that the person then has to dismiss by hand.
            closeModal();
            return;
          }
          showToast('danger', 'Could not unlock', d.error || d.message || '');
        } catch (e) {
          showToast('danger', 'Connection error', String((e && e.message) || e));
        }
        pwdInput.disabled = false;
        unlockBtn.disabled = false;
        unlockBtn.textContent = 'Unlock';
        pwdInput.focus();
      };
      unlockBtn.addEventListener('click', doUnlock);
      pwdInput.addEventListener('keydown', e => { if (e.key === 'Enter') doUnlock(); });
    }

    if (loggedIn && sessionOpen && body4) {
      const emptyNote = unlocked ? ''
        : '<div class="ds-callout ds-callout--warning" style="margin:6px 0 0">The vault is unlocked, but this collection has no matching items. Fix the collection name and save — the password is not needed again.</div>';
      body4.innerHTML = emptyNote + collectionRow
        + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="bw-refresh-secrets">Refresh secrets</button>'
        + collectionHintHtml(pendingCollectionHint);
      pendingCollectionHint = null;
      const showCollectionHint = (d) => {
        const old = body4.querySelector('#bw-collection-hint');
        if (old) old.remove();
        body4.insertAdjacentHTML('beforeend', collectionHintHtml(d));
      };

      // One request for both buttons: refresh-secrets re-reads the collection
      // through the OPEN session, with the name from the body when it changed.
      // No password, no restart - the session this process already holds is
      // exactly what the read needs.
      const refreshSecrets = async (collectionName) => {
        const payload = collectionName ? { collectionName } : {};
        const r = await fetch('/api/bitwarden/refresh-secrets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        const d = await r.json().catch(() => ({}));
        if (d.sessionLost) {
          // The server just forgot a session the vault no longer honours; the
          // stepper repaints into the password form with the field kept.
          showToast('warning', 'Vault session expired', 'Unlock Bitwarden again to refresh or change the collection.');
          renderStepper(await _fetchBitwardenStatus());
          return false;
        }
        if (!r.ok || d.success === false) {
          showToast('danger', 'Could not refresh secrets', d.error || d.message || '');
          return false;
        }
        if (d.listFailed) {
          showToast('danger', 'Could not read the collection from the vault', 'Check the VPN and the connection to vault.bitwarden.com — the previous tokens were kept.');
          return false;
        }
        if (d.collectionNotFound) {
          // Not a re-render: the field keeps what the person typed, and the
          // callout under it lists the names the vault actually has.
          showToast('warning', 'Collection not found', 'The name matches no collection in the vault.');
          showCollectionHint(d);
          return false;
        }
        // syncFailed means the vault could not be pulled, so the values below
        // come from the local CLI cache and may be stale. Saying "refreshed"
        // there would hide exactly the problem this sync was added to fix.
        if (d.syncFailed) {
          showToast('warning', 'Secrets from cache', 'Could not sync the vault (bw sync) - values may be out of date.');
        } else if (collectionName) {
          showToast('success', 'Collection changed', 'Tokens loaded from collection "' + collectionName + '".');
        } else {
          showToast('success', 'Secrets refreshed');
        }
        // Same reason as the unlock above: a refresh can ADD a token that was
        // missing (or drop one), so everything derived from a credential has
        // to be re-derived, not just this card.
        emitSecretsChanged({ reason: 'refresh-secrets' });
        return true;
      };

      bindCollectionRow(body4, async (name) => {
        try {
          if (await refreshSecrets(name)) renderStepper(await _fetchBitwardenStatus());
        } catch (_e) { showToast('danger', 'Connection error'); }
      });

      body4.querySelector('#bw-refresh-secrets').addEventListener('click', async function () {
        this.disabled = true;
        try {
          if (await refreshSecrets('')) renderStepper(await _fetchBitwardenStatus());
        } catch (_e) { showToast('danger', 'Connection error'); }
        this.disabled = false;
      });
    }

    content.querySelectorAll('[data-bw-copy]').forEach(btn => btn.addEventListener('click', () => {
      navigator.clipboard.writeText(btn.dataset.bwCopyValue)
        .then(() => showToast('info', 'Copied to clipboard'))
        .catch(() => showToast('warning', 'Could not copy'));
    }));

    const refreshBtn = content.querySelector('#bw-refresh-status');
    if (refreshBtn) refreshBtn.addEventListener('click', async () => {
      renderStepper(await _fetchBitwardenStatus());
    });

    const configureBtn = content.querySelector('#bw-configure-btn');
    if (configureBtn) configureBtn.addEventListener('click', async function () {
      this.disabled = true;
      this.textContent = 'Configuring...';
      try {
        const r = await fetch('/api/bitwarden/configure-server', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.success !== false) {
          showToast('success', 'Server configured: vault.bitwarden.com');
          renderStepper(await _fetchBitwardenStatus());
          return;
        }
        showToast('danger', d.error || 'Configuration error');
      } catch (_e) { showToast('danger', 'Could not connect to the server'); }
      this.disabled = false;
      this.textContent = 'Configure vault.bitwarden.com';
    });
  }

  _fetchBitwardenStatus().then(renderStepper);
}

// ── Keys: env keys ────────────────────────────────────────────────────────────
// The split between the two tabs is SERVER-DRIVEN. Every ENV_SCHEMA key carries
// a `kind`:
//   'secret' -> Keys tab         — the four tokens. They are never typed in
//                                  here; they arrive from the Bitwarden vault.
//   'config' -> not rendered     — plain settings, edited in .env only. The
//                                  Configuration tab was removed deliberately:
//                                  a second place to change the same values is
//                                  a second place for them to disagree.
//   'system' -> System tab       — auto-sync, owned by renderSyncSection().

const SETT_SECRET_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>';
const SETT_PROFILE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
const SETT_ACTIVITY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>';
const SETT_COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

/** Flat key list from the last GET /api/settings/env, tagged with its group. */
let _envKeys = [];
/** Cached GET /api/env-token-status (adds the "vault locked" distinction). */
let _tokenStatus = {};

/** @returns {Promise<object>} GET /api/env-token-status, or an empty object. */
async function _fetchTokenStatus() {
  try {
    const r = await fetch('/api/env-token-status', { cache: 'no-store' });
    return r.ok ? await r.json() : {};
  } catch (_e) { return {}; }
}

/**
 * Present / missing / vault-locked, for one CARD - which may hold one key or
 * ten. The count reads `n/m` for a multi-key card (Amplitude, Jira) and a plain
 * sentence for a single-key one, so a card never says "1/1".
 * @param {object[]} keys the schema keys sharing one `card` name
 * @returns {{ dot: string, count: string, label: string }}
 */
function _secretState(keys) {
  const total = keys.length;
  const present = keys.filter(k => k.set === true || _tokenStatus[k.key] === true).length;
  // Only a multi-key card gets a count. A single-key card would read "1/1",
  // which says nothing the dot has not already said.
  const count = total > 1 ? present + '/' + total : '';
  if (present === total) return { dot: 'green', count, label: 'token loaded' };
  if (present > 0) return { dot: 'gray', count, label: 'some tokens missing' };
  if (_tokenStatus._bitwardenLocked) return { dot: 'red', count, label: 'vault locked' };
  return { dot: 'gray', count, label: 'no token' };
}

/**
 * One small "name + copy" chip.
 * @param {string} value
 * @param {string} label
 * @returns {string}
 */
function _copyChip(value, label) {
  return `<span class="sett-token-name">${escHtml(value)}`
    + `<button type="button" class="sett-token-copy-btn" data-copy-key="${escHtml(value)}" aria-label="Copy ${escHtml(label)}">${SETT_COPY_ICON}</button></span>`;
}

/** Delegated copy-to-clipboard for every `.sett-token-copy-btn` inside `root`. */
function _wireCopyButtons(root) {
  root.querySelectorAll('.sett-token-copy-btn').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    const name = btn.dataset.copyKey;
    navigator.clipboard.writeText(name).then(() => {
      btn.classList.add('sett-token-copy-btn--ok');
      setTimeout(() => btn.classList.remove('sett-token-copy-btn--ok'), 1200);
      showToast('success', 'Key copied', name);
    }).catch(() => showToast('danger', 'Could not copy', name));
  }));
}

/**
 * Groups the secret keys into the layout the server declares: an ordered list
 * of categories, each holding an ordered list of cards, each holding its keys.
 * Order follows ENV_SCHEMA, so the tab is reordered in the schema, not here.
 * A key with no `category`/`card` still renders - it falls back to its own
 * label - so a newly added secret is never silently dropped from the grid.
 * @param {object[]} secrets
 * @returns {{ name: string, cards: { name: string, keys: object[] }[] }[]}
 */
function _groupSecrets(secrets) {
  const categories = [];
  for (const k of secrets) {
    const catName = k.category || 'Other';
    let cat = categories.find(c => c.name === catName);
    if (!cat) { cat = { name: catName, cards: [] }; categories.push(cat); }
    const cardName = k.card || k.label || k.key;
    let card = cat.cards.find(c => c.name === cardName);
    if (!card) { card = { name: cardName, keys: [] }; cat.cards.push(card); }
    card.keys.push(k);
  }
  return categories;
}

/**
 * Keys tab: one uppercase heading per category, one card per `card` name,
 * every variable in that card rendered as a copyable chip. Mirrors the section
 * split - several keys of one service are one box, not many.
 */
function _renderSecretCards() {
  const grid = document.getElementById('settings-section-grid');
  if (!grid) return;
  const secrets = _envKeys.filter(k => k.kind === 'secret');
  if (secrets.length === 0) {
    grid.innerHTML = '<div class="ds-callout ds-callout--warning">Could not load the server configuration.</div>';
    return;
  }

  // Compact on purpose: icon, name, a status dot plus a count, and the variable
  // names you can copy. Whether a token is loaded is a one-bit fact per
  // variable - a coloured dot plus `n/m` carries it, and a sentence of prose
  // per card only buried it. The dot's meaning lives in the legend below the
  // grid, once, not per card.
  grid.innerHTML = _groupSecrets(secrets).map(cat =>
    `<h3 class="sett-section-category">${escHtml(cat.name)}</h3>`
    + cat.cards.map(card => {
      const st = _secretState(card.keys);
      const wide = card.keys.length > 4 ? ' sett-secret-card--wide' : '';
      // A card whose token belongs to a repository links to it. The server
      // derives the URL (see _envKeyRepoUrl), so no address is spelled out here.
      const repoUrl = (card.keys.find(k => k.repoUrl) || {}).repoUrl || '';
      const repoLink = repoUrl
        ? `<a class="sett-repo-link" href="${escHtml(repoUrl)}" target="_blank" rel="noopener noreferrer" title="Open the repository in GitLab" aria-label="Open the repository in GitLab"><img src="/assets/icons/gitlab.svg" alt="" width="16" height="16"></a>`
        : '';
      return `<div class="ds-card settings-section-card sett-secret-card${wide}" title="${escHtml(st.label)}">
      <span class="sett-section-card__icon">${SETT_SECRET_ICON}</span>
      <div class="sett-section-card__content">
        <div class="sett-section-card__top-row">
          <span class="sett-section-card__title">${escHtml(card.name)}</span>
          ${repoLink}
          <span class="settings-section-card__dot settings-section-card__dot--${st.dot}"></span>
          <span class="settings-section-card__count">${escHtml(st.count)}</span>
        </div>
        <div class="sett-section-card__tokens">${card.keys.map(k => _copyChip(k.key, k.key)).join('')}</div>
      </div>
    </div>`;
    }).join('')
  ).join('');

  const legend = document.getElementById('settings-secret-legend');
  if (legend) {
    legend.innerHTML = '<span class="sett-legend-item"><span class="settings-section-card__dot settings-section-card__dot--green"></span>token loaded</span>'
      + '<span class="sett-legend-item"><span class="settings-section-card__dot settings-section-card__dot--gray"></span>no token</span>'
      + '<span class="sett-legend-item"><span class="settings-section-card__dot settings-section-card__dot--red"></span>vault locked</span>';
  }

  _wireCopyButtons(grid);
}

/**
 * Fetch the schema once, then paint both key tabs from it.
 * @returns {Promise<void>}
 */
async function _renderSettingsCardGrid() {
  const [groups, tokenStatus] = await Promise.all([fetchEnvGroups(), _fetchTokenStatus()]);
  _tokenStatus = tokenStatus;
  _envKeys = groups.flatMap(g => (g.keys || []).map(k => ({ ...k, schemaGroupId: g.id })));

  _renderSecretCards();
  _renderProfileCard();
  _renderActivityLinkCard();
  _renderGitlabTokenCard();
}

// ── Keys: identity and project token ─────────────────────────────────────────
// The Keys tab is READ-ONLY on the vault. Tokens live in Bitwarden and are
// added or replaced in Bitwarden -- this app has no write path into the vault
// and writes no token to .env either. What it does have is a way to CREATE a
// project token on GitLab; the value is shown once, masked, and the user pastes
// it into the COCKPIT-APP item themselves.

// ── Keys: identity card ──────────────────────────────────────────────────────
// Read-only on purpose: the person's name comes from the GitLab token's OWN
// name (`<first-last>-COCKPIT-APP`), so creating the token below IS the
// registration step. There is nothing here to type and no extra key in the
// vault -- change the token and the identity follows.

const SETT_IDENTITY_SOURCE_LABEL = {
  gitlab: 'from the GitLab token name',
  git: 'from git config',
  os: 'from the system account',
  none: 'not recognized',
};

/** Keys tab: who the app thinks you are, and where that came from. */
async function _renderProfileCard() {
  const host = document.getElementById('settings-profile-card');
  if (!host) return;

  let who = { valid: false, source: 'none' };
  try {
    const r = await fetch('/api/whoami', { cache: 'no-store' });
    if (r.ok) who = await r.json();
  } catch (_e) { /* keep the anonymous shape */ }

  const badge = who.valid
    ? `<span class="ds-badge ds-badge--green">${escHtml(SETT_IDENTITY_SOURCE_LABEL[who.source] || who.source)}</span>`
    : '<span class="ds-badge ds-badge--gray">no identity</span>';

  // A bare dash next to "GitLab account" reads like a bug. It is not: the GitLab
  // account is only knowable when a token exists, because that is what the
  // cockpit asks GitLab with. Say so instead of showing an empty cell.
  const rows = [
    ['Person', who.display_name || 'not recognized'],
    ['Identifier', who.person_slug || '—'],
    ['GitLab account', who.gitlab_username || (who.source === 'gitlab' ? '—' : 'unknown without a token')],
  ];

  host.innerHTML = `<div class="ds-card sett-secret-card">
    <div class="sett-secret-card__head">
      <span class="sett-secret-card__icon">${SETT_PROFILE_ICON}</span>
      <span class="sett-secret-card__title">Identity</span>
      ${badge}
    </div>
    <p class="sett-secret-card__hint">Derived from the GitLab token name. Without a token, from <code>git config</code>.</p>
    <div class="sett-secret-card__rows">
      ${rows.map(([label, value]) => `<div class="sett-secret-row">
        <span class="sett-secret-row__label">${escHtml(label)}</span>
        <span class="sett-profile-value">${escHtml(value)}</span>
      </div>`).join('')}
    </div>
  </div>`;
}

// ── Keys: link card to "GitLab activity" ────────────────────────────────────
// Not a data card: a link. The view it opens has its own fetch and its own
// refresh button, so this card stays free of a second copy of that logic.

/** Keys tab: link card into #view-gitlab-activity (topbar badge target). */
function _renderActivityLinkCard() {
  const host = document.getElementById('settings-activity-link-card');
  if (!host) return;

  host.innerHTML = `<div class="ds-card sett-secret-card">
    <div class="sett-secret-card__head">
      <span class="sett-secret-card__icon">${SETT_ACTIVITY_ICON}</span>
      <span class="sett-secret-card__title">Team activity</span>
    </div>
    <p class="sett-secret-card__hint">Who recently worked on the app repositories according to GitLab access tokens, and whose access expires soon.</p>
    <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="settings-activity-link-btn">Open</button>
  </div>`;

  host.querySelector('#settings-activity-link-btn').addEventListener('click', () => {
    location.hash = '#gitlab-activity';
  });
}

// ── Keys: creating GitLab project tokens ───────────────────────────────────
// Two targets, both named by the server: the app repo and the team data repo.
// The owner credential (COCKPIT_OWNER_TOKEN) stays on the server. The gate
// below is FAIL-OPEN on purpose — if the targets probe does not answer, the
// button stays live and the authoritative refusal is the server's 503.

/** Cached GET /api/gitlab-tokens/targets -> targets[]. */
let _gitlabTargets = [];

/**
 * GET /api/gitlab-tokens/targets, normalized. Exported for the onboarding
 * wizard, which needs the same rows to decide whether its access step is done
 * and to open the create modal with.
 * @returns {Promise<{ownerTokenConfigured: boolean|null, targets: object[]}>}
 */
export async function _fetchGitlabTokenTargets() {
  try {
    const res = await fetch('/api/gitlab-tokens/targets', { cache: 'no-store' });
    if (!res.ok) return { ownerTokenConfigured: null, targets: [] };
    const data = await res.json();
    return {
      ownerTokenConfigured: data.ownerTokenConfigured !== false,
      targets: Array.isArray(data.targets) ? data.targets : [],
    };
  } catch {
    return { ownerTokenConfigured: null, targets: [] };
  }
}

/**
 * THE gate for the token box, in one function with one call site so swapping
 * the condition stays a one-line change.
 *
 * SSH read access is the membership test: only a member of the project should
 * be offered a token at all. It is deliberately NOT a role test -- GitLab
 * grants SSH read to Reporters too, while minting a token needs Maintainer.
 * There is no better check: GitLab has no SSH API, and probing membership over
 * REST would need the very owner token we may not have. So the box says out
 * loud what SSH proves, and a 403 at creation is reported as the role problem
 * it is.
 *
 * One probe covers both targets on purpose: it runs `ssh` against the APP repo,
 * and the two live in the same GitLab group, so a second spawn would prove the
 * same key and cost another few seconds on every Settings open.
 *
 * An unanswered probe (null) is treated as a NEGATIVE for ssh -- the box is a
 * privileged action, so an unknown answer must not reveal it -- and as a
 * POSITIVE for the owner token, whose authoritative refusal is the server's 503.
 *
 * @param {boolean|null} ssh GET /api/gitlab/ssh-access -> ssh
 * @param {boolean|null} ownerConfigured GET /api/gitlab-tokens/targets -> ownerTokenConfigured
 * @returns {'hidden'|'disabled'|'enabled'}
 */
function _gitlabBoxState(ssh, ownerConfigured) {
  if (ssh !== true) return 'hidden';
  if (ownerConfigured === false) return 'disabled';
  return 'enabled';
}

const SETT_GITLAB_ACCESS_LEVELS = [
  { value: '10', label: 'Guest (10)' },
  { value: '20', label: 'Reporter (20)' },
  { value: '30', label: 'Developer (30)' },
  { value: '40', label: 'Maintainer (40)' },
  { value: '50', label: 'Owner (50)' },
];

// Why each target's default access level is what it is. PLAIN TEXT, because it
// is rendered as the row's `title` - the reason travels with the choice instead
// of living only in server.js, without stealing a paragraph of height from a
// list that is now ten rows long. Only the targets whose level is a real
// decision carry their own line; every data source shares the fallback below.
const SETT_GITLAB_LEVEL_HINT = {
  app: 'Developer (30) is enough: it can fetch app updates and open merge requests. It cannot write to the protected main - and does not need to. Do not raise this level "just in case".',
  modules: 'Developer (30) is enough and deliberate here: the module catalog changes through merge requests and the protected main refuses a direct push. Maintainer would quietly allow it again.',
};
const SETT_GITLAB_LEVEL_HINT_DATA = 'Maintainer (40) is needed here: sync writes team data straight to the default branch of the data repository, and a protected default branch refuses Developer - only at send time, with a message that looks like an app error. Go lower only when that branch is not protected.';

/** @param {object} target @returns {string} plain-text tooltip for the level select. */
function _gitlabLevelHint(target) {
  return SETT_GITLAB_LEVEL_HINT[target.id] || SETT_GITLAB_LEVEL_HINT_DATA;
}

// WHAT this token gives access to - one plain sentence per row.
// Without it the row spoke only in technical names (repository label,
// project path, variable name), and the person ticking the box could not
// tell what they were unlocking. Same shape as SETT_GITLAB_LEVEL_HINT:
// a map by id plus one fallback sentence for the data sources, which differ
// only by their content.
const SETT_GITLAB_PURPOSE = {
  app: 'App code: fetching app updates, pushing work branches and opening merge requests.',
  data: 'Team data of this app — people directory, prototypes, training progress. Without it sync fetches and sends nothing.',
  modules: 'Shared module catalog: downloading team modules and publishing your own through a merge request.',
};
const SETT_GITLAB_PURPOSE_DATA = 'An additional encrypted data source - fetch and send it in the Sync window.';

/** @param {object} target @returns {string} one sentence: what the token unlocks. */
function _gitlabPurpose(target) {
  return SETT_GITLAB_PURPOSE[target.id] || SETT_GITLAB_PURPOSE_DATA;
}

// The technical names the row used to spend two lines on. They matter when the
// token EXISTS (paste it under this key, into this vault item), not when it is
// being picked, and the result panel already prints both next to every created
// token - so here they travel in the tooltip together with the scopes the
// server will actually request.
function _gitlabKeysNote(target) {
  const scopes = Array.isArray(target.scopes) && target.scopes.length
    ? ` Scopes: ${target.scopes.join(', ')}.`
    : '';
  return `Key ${target.envVar}, Bitwarden item: ${target.bwItem}.${scopes}`;
}

// The tooltip on the project path. `cloned` is what decides it, and the answer
// differs per target: the app repo always has an origin, while every data repo
// is normally NOT cloned when you come here — the token is what unblocks the
// clone — so "no origin" must not be dressed up as a fault there.
function _gitlabPathNote(target) {
  if (target.cloned) return 'path read from git remote origin';
  if (target.id === 'data' || String(target.id).startsWith('data-')) {
    return 'path from configuration — the data repository is not cloned yet (the token is needed for that)';
  }
  if (target.id === 'modules') {
    return 'path from configuration — the module catalog is read through the API, not cloned';
  }
  return 'fallback path — the repository has no origin configured';
}

/**
 * Keys tab: ONE card for the whole roster, opening one modal in which the
 * repositories are ticked off.
 *
 * It used to be one card per target, which worked at two targets and stopped
 * working at ten: the tab became a wall of near-identical cards whose only
 * difference was a label, and minting tokens for a new machine meant ten
 * separate trips through the same modal.
 */
async function _renderGitlabTokenCard() {
  const host = document.getElementById('settings-gitlab-token-card');
  if (!host) return;

  // THE gate, in one place with one call site (see _gitlabBoxState).
  let ssh = null;
  let ownerConfigured = null;
  try {
    const [sshRes, targetRes] = await Promise.all([
      fetch('/api/gitlab/ssh-access', { cache: 'no-store' }),
      fetch('/api/gitlab-tokens/targets', { cache: 'no-store' }),
    ]);
    if (sshRes.ok) ssh = (await sshRes.json()).ssh === true;
    if (targetRes.ok) {
      const data = await targetRes.json();
      _gitlabTargets = data.targets || [];
      ownerConfigured = data.ownerTokenConfigured !== false;
    }
  } catch (_e) { /* both probes stay null -> _gitlabBoxState decides */ }

  const state = _gitlabBoxState(ssh, ownerConfigured);
  if (state === 'hidden') { host.innerHTML = ''; return; }

  const disabled = state === 'disabled' || _gitlabTargets.length === 0;
  const warning = state === 'disabled'
    ? '<div class="ds-callout ds-callout--warning"><div>Unlock the vault — the owner token comes from the <code>GITLAB-PERSONAL</code> item.</div></div>'
    : '';

  host.innerHTML = warning + `<div class="ds-card sett-secret-card sett-secret-card--wide">
    <div class="sett-secret-card__head">
      <span class="sett-secret-card__icon">${SETT_SECRET_ICON}</span>
      <span class="sett-secret-card__title">GitLab project tokens</span>
      ${state === 'disabled'
    ? '<span class="ds-badge ds-badge--yellow">no owner token</span>'
    : '<span class="ds-badge ds-badge--green">done</span>'}
    </div>
    <p class="sett-secret-card__hint">One wizard for every repository: tick the ones that need a token and they are created in one pass. Each is valid for 12 months and you will see its value once.</p>
    <div class="sett-secret-card__rows">
      <div class="sett-secret-row"><span class="sett-secret-row__label">Repositories</span><span class="sett-profile-value">${_gitlabTargets.length} to choose from</span></div>
    </div>
    <div class="sett-section-card__tokens">${_gitlabTargets.map(t => _copyChip(t.envVar, t.envVar)).join('')}</div>
    <div class="sett-secret-card__actions">
      <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" id="gtc-open-btn"${disabled ? ' disabled' : ''}>Create tokens</button>
    </div>
  </div>`;

  _wireCopyButtons(host);
  const openBtn = host.querySelector('#gtc-open-btn');
  if (openBtn) openBtn.addEventListener('click', () => _openGitlabTokensModal(_gitlabTargets));
}

/** Splits a display name into first + last for the token slug. */
function _splitDisplayName(displayName) {
  const parts = String(displayName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

/**
 * One selectable repository row in the creation modal: name, what the token
 * unlocks, and the project it will be minted on - three lines, exactly as many
 * as the row had before. The purpose sentence took the slot the
 * `KEY -> ITEM` line held, because at SELECTION time those two names are
 * plumbing and the question being answered is "what does this give access to".
 * They are not lost: `_gitlabKeysNote` puts them plus the scopes in the row's
 * tooltip, and the result panel prints both next to every created token.
 *
 * The level select sits in `.gtc-role-wrap` rather than carrying its own width:
 * `.ds-input` is `width: 100%` and css/ds.css loads AFTER styles.css, so a
 * `.gtc-role-sel { width: ... }` rule here would lose the cascade and silently
 * do nothing. A `width: fit-content` wrapper sidesteps the fight entirely.
 */
function _gitlabRepoRow(target, i) {
  const pathNote = _gitlabPathNote(target);
  const fallback = target.resolvedFrom === 'fallback';
  const level = String(target.defaultAccessLevel || 30);
  const label = target.label || target.repo;
  return `<div class="gtc-repo-row">
    <label class="gtc-repo-check">
      <input type="checkbox" class="gtc-repo-cb" data-gtc-idx="${i}">
      <span class="gtc-repo-text" title="${escHtml(_gitlabKeysNote(target))}">
        <span class="gtc-repo-name">${escHtml(label)}</span>
        <span class="gtc-repo-purpose">${escHtml(_gitlabPurpose(target))}</span>
        <span class="gtc-repo-path${fallback ? ' gtc-repo-path--fallback' : ''}" title="${escHtml(pathNote)}">${escHtml(target.projectPath || 'path unknown')}</span>
      </span>
    </label>
    <div class="gtc-role-wrap">
      <select class="ds-input gtc-role-sel" data-gtc-idx="${i}" aria-label="Access level — ${escHtml(label)}" title="${escHtml(_gitlabLevelHint(target))}">
        ${SETT_GITLAB_ACCESS_LEVELS.map(l => `<option value="${l.value}"${l.value === level ? ' selected' : ''}>${escHtml(l.label)}</option>`).join('')}
      </select>
    </div>
  </div>`;
}

/**
 * Modal: name + a ticked subset of the repositories in, one masked token per
 * ticked repository out.
 *
 * NOTHING is preselected and the submit button stays dead until at least one
 * row is ticked. That is not politeness: most of these repositories do not
 * exist on GitLab yet, and every miss costs three retries against a 30 s
 * timeout, so an "everything ticked" default would hang the modal for minutes.
 *
 * The creates run SEQUENTIALLY against the existing single-target endpoint and
 * a failure never stops the loop: each row lands in the result list the moment
 * its own call answers, so a repository that is not there yet costs its own
 * retries and nothing else.
 * Exported so the onboarding wizard's access step opens THIS modal instead of
 * carrying a second copy of the markup and the create flow.
 *
 * @param {object[]} targets rows of GET /api/gitlab-tokens/targets
 */
export async function _openGitlabTokensModal(targets) {
  if (!targets || targets.length === 0) return;

  let who = {};
  try {
    const r = await fetch('/api/whoami', { cache: 'no-store' });
    if (r.ok) who = await r.json();
  } catch (_e) { /* prefill is a convenience, not a requirement */ }
  const { first, last } = _splitDisplayName(who.display_name);

  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.innerHTML = `
    <div class="ds-modal ds-modal--xl">
      <div class="ds-modal-header">
        <span class="ds-modal-title">New GitLab tokens</span>
        <button type="button" class="ds-modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="ds-modal-body">
        <div data-gtc-panel="form">
          <p class="sett-field-hint">Each token is created in its own project, named
            <code>first-last-&lt;SUFFIX&gt;</code>, valid for 12 months. The server sets the scopes
            separately for each repository.</p>
          <div class="gtc-name-grid">
            <div class="sett-field-row sett-field-row--stacked">
              <label for="gtc-first">First name</label>
              <input type="text" class="ds-input" id="gtc-first" autocomplete="off" value="${escHtml(first)}">
            </div>
            <div class="sett-field-row sett-field-row--stacked">
              <label for="gtc-last">Last name</label>
              <input type="text" class="ds-input" id="gtc-last" autocomplete="off" value="${escHtml(last)}">
            </div>
          </div>
          <div class="gtc-repos">
            <div class="gtc-repos-head">
              <span class="gtc-repos-title">Repositories — tick at least one</span>
              <label class="gtc-repos-all"><input type="checkbox" id="gtc-all"> Select all</label>
            </div>
            <div class="gtc-repo-list">${targets.map((t, i) => _gitlabRepoRow(t, i)).join('')}</div>
          </div>
        </div>
        <div data-gtc-panel="result" hidden>
          <div class="ds-callout ds-callout--success">
            <div>
              <strong>The tokens are being created. Copy them now — GitLab will not show these values a second time.</strong>
              <ol class="sett-steps">
                <li>On each row click <strong>Copy entry</strong>. The whole line
                    <code>KEY=&lt;token&gt;</code> goes to the clipboard, ready to paste.</li>
                <li>Open the Bitwarden item named on the row and paste this line into its
                    <strong>notes</strong> field. If a line with this key is already there — replace it.</li>
                <li>Come back here, unlock the vault and check that the tokens loaded.</li>
                <li>Clear the clipboard.</li>
              </ol>
              Each token has ITS OWN vault item — this is not a single paste.
              This app never stores tokens: neither in the vault nor in the <code>.env</code> file.
            </div>
          </div>
          <div class="gtc-result-list" id="gtc-results"></div>
        </div>
      </div>
      <div class="ds-modal-footer" id="gtc-footer">
        <button type="button" class="ds-btn ds-btn--secondary" data-gtc-cancel>Cancel</button>
        <button type="button" class="ds-btn ds-btn--primary" data-gtc-submit disabled>Create</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  openDsModal(overlay);

  const close = () => { closeDsModal(overlay); setTimeout(() => overlay.remove(), 200); };
  overlay.querySelector('.ds-modal-close').addEventListener('click', close);
  overlay.querySelector('[data-gtc-cancel]').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const boxes = Array.from(overlay.querySelectorAll('.gtc-repo-cb'));
  const submitBtn = overlay.querySelector('[data-gtc-submit]');
  const allBox = overlay.querySelector('#gtc-all');
  const syncSubmit = () => {
    submitBtn.disabled = !boxes.some(cb => cb.checked);
    allBox.checked = boxes.every(cb => cb.checked);
  };
  boxes.forEach(cb => cb.addEventListener('change', syncSubmit));
  allBox.addEventListener('change', () => {
    boxes.forEach(cb => { cb.checked = allBox.checked; });
    syncSubmit();
  });

  submitBtn.addEventListener('click', () => {
    const firstName = overlay.querySelector('#gtc-first').value.trim();
    const lastName = overlay.querySelector('#gtc-last').value.trim();
    if (!firstName || !lastName) {
      showToast('warning', 'Complete the form', 'Enter your first and last name — the token name is built from them.');
      return;
    }
    const selections = boxes.filter(cb => cb.checked).map(cb => {
      const i = Number(cb.dataset.gtcIdx);
      const sel = overlay.querySelector(`.gtc-role-sel[data-gtc-idx="${i}"]`);
      return { target: targets[i], accessLevel: Number(sel ? sel.value : targets[i].defaultAccessLevel) };
    });
    _runGitlabTokenBatch(overlay, { firstName, lastName, selections }, close);
  });
}

/** One result row, in its pending state. Filled in place as the call answers. */
function _gitlabResultRow(target, i) {
  return `<div class="gtc-result-row" data-gtc-result="${i}">
    <div class="gtc-result-info">
      <span class="gtc-result-repo">${escHtml(target.label || target.repo)}</span>
      <span class="gtc-result-keys"><code>${escHtml(target.envVar)}</code> &rarr; <code>${escHtml(target.bwItem)}</code></span>
    </div>
    <div class="gtc-result-status"><span class="ds-badge ds-badge--gray">queued</span></div>
  </div>`;
}

/**
 * Runs the ticked creates one after another against POST
 * /api/gitlab-tokens/create — the SAME single-target endpoint the one-card
 * version used, so the origin check, the owner-token 503 and GitLab's
 * three-attempt retry all stay exactly where they are tested.
 *
 * Sequential and fail-soft on purpose: GitLab rate-limits token creation, and
 * a repository that does not exist yet must cost only its own row.
 * @param {Element} overlay @param {object} form @param {() => void} close
 */
async function _runGitlabTokenBatch(overlay, { firstName, lastName, selections }, close) {
  overlay.querySelector('[data-gtc-panel="form"]').hidden = true;
  overlay.querySelector('[data-gtc-panel="result"]').hidden = false;
  const list = overlay.querySelector('#gtc-results');
  list.innerHTML = selections.map((s, i) => _gitlabResultRow(s.target, i)).join('');

  const footer = overlay.querySelector('#gtc-footer');
  const total = selections.length;
  // `KEY=value` lines, one per created token, kept for the copy buttons only.
  const created = [];

  for (let i = 0; i < total; i++) {
    footer.innerHTML = `<span class="gtc-progress">Creating tokens… (${i + 1} of ${total})</span>`;
    const { target, accessLevel } = selections[i];
    const row = list.querySelector(`[data-gtc-result="${i}"] .gtc-result-status`);
    row.innerHTML = '<span class="ds-badge ds-badge--blue">creating…</span>';

    let ok = false;
    let data = {};
    try {
      const r = await fetch('/api/gitlab-tokens/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName, lastName, target: target.id, access_level: accessLevel }),
      });
      ok = r.ok;
      data = await r.json().catch(() => ({}));
    } catch (e) {
      data = { message: (e && e.message) || 'No connection to the server' };
    }

    if (!ok || !data.token) {
      row.innerHTML = `<span class="ds-badge ds-badge--red">error</span>`
        + `<span class="gtc-result-error" title="${escHtml(data.message || '')}">${escHtml(data.message || 'Could not create the token.')}</span>`;
      continue;
    }

    // Key and item name come from the RESPONSE, with the requested target as
    // the fallback: pasting one repository's token under another's key is the
    // one mistake here that fails silently, so neither name is ever hardcoded.
    const envVar = data.envVar || target.envVar;
    const bwItem = data.bwItem || target.bwItem;
    created.push({ bwItem, line: envVar + '=' + data.token });
    row.innerHTML = `<span class="ds-badge ds-badge--green">done</span>`
      + `<code class="gtc-result-preview" title="valid until ${escHtml(data.expiresAt || '')}">${escHtml(data.preview || '')}</code>`
      + `<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-gtc-copy-line="${created.length - 1}">Copy entry</button>`;
  }

  footer.innerHTML = `<button type="button" class="ds-btn ds-btn--secondary" data-gtc-close>Close</button>`
    + (created.length > 1 ? '<button type="button" class="ds-btn ds-btn--primary" data-gtc-copy-all>Copy all entries</button>' : '');
  footer.querySelector('[data-gtc-close]').addEventListener('click', close);

  const copy = async (text, desc) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast('success', 'Copied', desc);
    } catch (_e) {
      showToast('danger', 'Copy failed', 'The browser did not allow clipboard access.');
    }
  };

  list.querySelectorAll('[data-gtc-copy-line]').forEach(btn => btn.addEventListener('click', () => {
    const entry = created[Number(btn.dataset.gtcCopyLine)];
    if (entry) copy(entry.line, 'Paste this line into the note of item ' + entry.bwItem + ', then clear the clipboard.');
  }));
  const copyAll = footer.querySelector('[data-gtc-copy-all]');
  // Each block names its OWN Bitwarden item, because there is no single place
  // to paste this: one token, one item. A bare list of lines would read like a
  // .env file, which is exactly where these must NOT land.
  if (copyAll) {
    const text = created.map(e => '# item ' + e.bwItem + '\n' + e.line).join('\n\n') + '\n';
    copyAll.addEventListener('click', () => copy(text,
      'Each block is named after its Bitwarden item — paste them separately, then clear the clipboard.'));
  }

  if (created.length === 0) {
    showToast('danger', 'No token was created', 'Check the messages on the rows.');
  } else if (created.length < total) {
    showToast('warning', 'Some tokens failed', `Created ${created.length} of ${total}.`);
  } else {
    showToast('success', 'Tokens created', `Created ${created.length} of ${total}. Copy them into the vault now.`);
  }
}


// ── Header actions ────────────────────────────────────────────────────────────

// The three help documents. `icon` is a real file under
// /assets/icons/ds/ (the same source the sidebar uses); the
// previous inline glyphs rendered as broken images. `hash` opens a document
// `href` opens a standalone HTML guide in a new tab.
const HELP_LINKS = [
  {
    href: '/docs/guides/INSTALL.html',
    icon: '32-ic-download',
    title: 'Installation guide',
    desc: 'Step by step: installation and first run.',
  },
  {
    href: '/docs/guides/token-security.html',
    icon: '32-ic-shield',
    title: 'Token security',
    desc: 'How to take care of access tokens and .env files.',
  },
];

/** DS modal listing the instruction documents. */
function _openHelpModal() {
  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="ds-modal ds-modal--lg">
      <div class="ds-modal-header">
        <span class="ds-modal-title">Need help</span>
        <button type="button" class="ds-modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="ds-modal-body">
        <div class="sett-help-grid">
          ${HELP_LINKS.map(l => `<a class="sett-help-card ds-card" href="${escHtml(l.href)}" target="_blank" rel="noopener">
              <span class="sett-help-card__icon"><img src="/assets/icons/ds/${escHtml(l.icon)}.svg" alt="" aria-hidden="true"></span>
              <span class="sett-help-card__text">
                <span class="sett-help-card__title">${escHtml(l.title)}</span>
                <span class="sett-help-card__desc">${escHtml(l.desc)}</span>
              </span>
              <span class="sett-help-card__chevron" aria-hidden="true">
                <img src="/assets/icons/ds/24-ic-chevron-right.svg" alt="">
              </span>
            </a>`).join('')}
        </div>
      </div>
      <div class="ds-modal-footer">
        <button type="button" class="ds-btn ds-btn--secondary" data-help-close>Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  openDsModal(overlay);

  const close = () => { closeDsModal(overlay); setTimeout(() => overlay.remove(), 200); };
  overlay.querySelector('.ds-modal-close').addEventListener('click', close);
  overlay.querySelector('[data-help-close]').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

function _wireHeaderActions() {
  // No unlock button of its own on the Keys tab: the Bitwarden hero card
  // opens the same modal, and so does the pill in the top bar. A third entry
  // point only competed with the identity card for the top of the tab.
  const help = document.getElementById('settings-header-help-btn');
  if (help && !help.dataset.wired) {
    help.dataset.wired = '1';
    help.addEventListener('click', _openHelpModal);
  }

  const update = document.getElementById('settings-header-update-btn');
  if (update && !update.dataset.wired) {
    update.dataset.wired = '1';
    update.addEventListener('click', () => {
      _activateSettingsTab('system');
      const btn = document.getElementById('settings-check-update-btn');
      if (btn) btn.click();
    });
  }

  const restart = document.getElementById('settings-header-restart-btn');
  if (restart && !restart.dataset.wired) {
    restart.dataset.wired = '1';
    restart.addEventListener('click', () => {
      if (confirm('Restart the server? Running operations will be interrupted.')) _doRestart(restart);
    });
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Repaint only the panels whose content comes from a server-held credential,
 * and only while this view is the one on screen - a hidden Settings view is
 * re-rendered in full by renderSettingsView() the next time it is opened, so
 * doing the work now would just spend eleven tool probes on nobody.
 *
 * A targeted list rather than renderSettingsView(): that one also re-runs the
 * tab resolution, and the Agents/Skills/Users panels have nothing to do
 * with tokens.
 * @returns {Promise<void>}
 */
async function _refreshSettingsAfterSecrets() {
  const view = document.getElementById('view-settings');
  if (!view || !view.classList.contains('active')) return;
  await Promise.all([
    _refreshBitwardenCard().catch(e => console.error('[settings] bitwarden card:', e)),
    _renderSettingsCardGrid().catch(e => console.error('[settings] card grid:', e)),
    renderSyncSection().catch(e => console.error('[settings] sync section:', e)),
    // refresh:true bypasses the server's 60 s probe cache - the Bitwarden card
    // there reads the lock state this event is about, so the cached answer is
    // precisely the wrong one.
    renderNarzedziaSection({ refresh: true }).catch(e => console.error('[settings] narzedzia:', e)),
    // The catalog needs COCKPIT_MODULES_TOKEN, which the unlock may have just
    // supplied; the rest of the Modules tab reads the disk, apart from the two
    // to-do lists refreshed right below.
    renderModulesCatalogSection({ onRestart: _doRestart }).catch(e => console.error('[settings] moduly-katalog:', e)),
    // The "Need publishing / updating" lists compare against that
    // catalog too - the only part of Installed a token can change.
    refreshModulyAttention().catch(e => console.error('[settings] moduly-attention:', e)),
  ]);
}

let _secretsWired = false;

/** One-time wiring: tab buttons and header actions. */
export function initSettings() {
  if (!_secretsWired) {
    _secretsWired = true;
    onSecretsChanged(() => { _refreshSettingsAfterSecrets(); });
  }
  const tabs = document.getElementById('settings-tabs');
  if (tabs && !tabs.dataset.wired) {
    tabs.dataset.wired = '1';
    tabs.querySelectorAll('.ds-tab').forEach(btn => {
      btn.addEventListener('click', () => _activateSettingsTab(btn.dataset.settTab));
    });
  }
  _wireHeaderActions();
  _wireRestartBar();
}

/**
 * Render every panel. Panels stay mounted, so all renderers run regardless of
 * which tab is visible — that is what lets _activateSettingsTab be a pure
 * `hidden` toggle with no re-render.
 * @param {string} [subPath] optional deep-link tab, e.g. "#settings/keys"
 */
export async function renderSettingsView(subPath) {
  const target = SETT_TAB_IDS.includes(subPath) ? subPath : _getStoredSettingsTab();
  _activateSettingsTab(target);
  _wireRestartBar();
  // Painted first, before any await: it reads only localStorage, so gating it
  // behind the network panels would leave the Theme card blank for as long as
  // the slowest endpoint (or its retry budget) takes.
  renderThemeSection();

  // Fire the panels in parallel; each guards its own slot and swallows its own
  // failures, so a dead endpoint never blanks the rest of the page.
  await Promise.all([
    renderAppVersionBlock().catch(e => console.error('[settings] version block:', e)),
    renderSyncSection().catch(e => console.error('[settings] sync section:', e)),
    _refreshBitwardenCard().catch(e => console.error('[settings] bitwarden card:', e)),
    _renderSettingsCardGrid().catch(e => console.error('[settings] card grid:', e)),
    renderAgenciSection().catch(e => console.error('[settings] agenci:', e)),
    renderSkilleSection().catch(e => console.error('[settings] skille:', e)),
    renderModulySection({ onRestart: _doRestart, fresh: true }).catch(e => console.error('[settings] moduly:', e)),
    renderUzytkownicySection().catch(e => console.error('[settings] uzytkownicy:', e)),
    renderNarzedziaSection().catch(e => console.error('[settings] narzedzia:', e)),
  ]);
}

/** Currently active settings tab id — used by tests and deep links. */
export function _getActiveSettingsTab() {
  return _activeSettingsTab;
}
