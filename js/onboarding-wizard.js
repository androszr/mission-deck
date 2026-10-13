// ── Mission Deck — js/onboarding-wizard.js ────────────────────────────
// First-run guide: seven steps from a bare checkout to a cockpit that can work.
// Everything renders INLINE into #onboarding-wizard-root - toasts only for the EK key hand-off, no state
// kept on the server. Every step's badge is derived from reality (the vault, the
// key file, the clone on disk), which is why the view is re-enterable at any
// time and re-fetches on every render instead of remembering anything.
//
// Steps, and why each one is here rather than in the source cockpit's four:
//   1 Environment   - /api/tools/status. Mission Deck only; the source has no probe.
//   2 Bitwarden     - ported; the vault is where every token lives.
//   3 App access    - /api/gitlab-tokens/*. Mission Deck only; tokens never sit in .env.
//                     The APP token alone - the data-repo token lives in step 5.
//   4 Keys          - ported, but the allowed repo ids come from the SERVER, and
//                     a saved key decrypts the sources already on this machine.
//   5 Team data     - the data-repo token, /api/data/data-tier-0/clone-stream.
//   6 Update        - ported.
//   7 Training      - ported, but navigates in-app instead of opening a second SPA.
//
// Data sources: GET /api/tools/status, /api/bitwarden/status,
//               /api/gitlab-tokens/targets, /api/settings/encryption-status,
//               /api/data/data-tier-0/status, /api/sync-overview,
//               /api/app/check-update, /api/app/update (step 6, two-step stash path).

import { escHtml } from './utils.js';
import { registerViewCleanup } from './view-lifecycle.js';
import { runSyncWithProgress, formatSyncStreamError } from './sub-repo-sync-stream.js';
import { decryptDataTierRepo } from './data-tier-0-sync.js';
import { loadTeamDirectory } from './team-directory.js';
import { mapAppUpdateError, mapCheckUpdateError } from './app-update-errors.js';
import {
  STASH_NOTE_KEY, STASH_UPDATE_BTN_SELECTOR, STASH_NOTE_DISMISS_SELECTOR,
  stashNoteFromResponse, parseStashNote, dirtyTreeCalloutHtml, stashNoteHtml, stashConfirmText,
} from './app-update-stash.mjs';
import { _openBitwardenModal, _openGitlabTokensModal, _fetchGitlabTokenTargets } from './settings.js';
import { onSecretsChanged } from './secrets-events.js';
import { confirmDsModal } from './ds-modal.js';
import { showToast } from './toast.js';
import { onInfraChanged } from './infra-events.js';
import { getInfraNetwork } from './infra-banner.js';

const VIEW_ID = 'onboarding-wizard';

// ── Module-level state ───────────────────────────────────────────────────────

let _navigate = null;
let _toolsStatus = null;
let _bwStatus = null;
let _tokenTargets = null;
let _encStatus = null;
let _repoStatus = null;
let _updateCheck = null;

// The one thing in this module that outlives a render: the poll that waits for
// the server to come back after an update. Cleared by the registered cleanup so
// navigating away mid-update does not leave it running (the source cockpit
// leaks exactly this timer).
let _updatePoll = null;

function _stopUpdatePoll() {
  if (_updatePoll) { clearInterval(_updatePoll); _updatePoll = null; }
}

// ── Small helpers ────────────────────────────────────────────────────────────

function _setPhase(el, text) {
  if (el) el.textContent = text;
}

function _setPct(el, pct) {
  if (el) el.style.setProperty('--ips-pct', pct + '%');
}

/** Paint one step's header badge. */
function _setChip(root, stepId, done, pendingLabel) {
  const chip = root.querySelector('#obw-' + stepId + '-chip');
  if (!chip) return;
  chip.className = 'ds-badge ' + (done ? 'ds-badge--green' : 'ds-badge--gray');
  chip.textContent = done ? 'Done' : (pendingLabel || 'To do');
}

const _REPO_BADGE_CLASS = {
  gray: 'ds-badge--gray',
  blue: 'ds-badge--blue',
  green: 'ds-badge--green',
  red: 'ds-badge--red',
};

function _addRepoRow(container, label) {
  const row = document.createElement('div');
  row.className = 'obw-repo-row';
  row.innerHTML = `
    <div class="obw-repo-row-main">
      <span class="obw-repo-label">${escHtml(label)}</span>
      <span class="ds-badge ds-badge--gray obw-repo-badge">Pending</span>
    </div>
    <p class="obw-repo-msg" hidden></p>`;
  container.appendChild(row);
  return row;
}

function _setRepoRow(row, color, badgeText, msg) {
  if (!row) return;
  const badge = row.querySelector('.obw-repo-badge');
  const msgEl = row.querySelector('.obw-repo-msg');
  if (badge) {
    badge.className = 'ds-badge obw-repo-badge ' + (_REPO_BADGE_CLASS[color] || 'ds-badge--gray');
    badge.textContent = badgeText;
  }
  if (msgEl) {
    if (msg) { msgEl.hidden = false; msgEl.textContent = msg; }
    else { msgEl.hidden = true; msgEl.textContent = ''; }
  }
}

/** Wraps a button for the duration of an async action. */
async function _withBusy(btn, busyLabel, fn) {
  if (!btn) return fn();
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = busyLabel;
  try { return await fn(); }
  finally { btn.disabled = false; btn.textContent = original; }
}

async function _getJson(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── Step 1 — environment ─────────────────────────────────────────────────────
// The five tools this cockpit cannot work without. The Tools tab probes
// eleven and owns every installer; this step only answers "can I start at all",
// so a missing Playwright or gitnexus is not what holds a newcomer up.
export const OBW_REQUIRED_TOOLS = ['node', 'npm', 'git', 'bitwarden', 'claude-cli'];

const _TOOL_LABELS = {
  node: 'Node.js',
  npm: 'npm',
  git: 'git',
  bitwarden: 'Bitwarden CLI',
  'claude-cli': 'Claude Code CLI',
};

/**
 * Is the environment step done? Pure - unit tested.
 * `installed === null` means the probe itself failed; treated as NOT ready,
 * because an unknown answer must not report a green step.
 * @param {object|null} status GET /api/tools/status payload
 * @returns {boolean}
 */
export function obwToolsReady(status) {
  const tools = (status && Array.isArray(status.tools)) ? status.tools : null;
  if (!tools) return false;
  return OBW_REQUIRED_TOOLS.every((id) => {
    const row = tools.find(t => t && t.id === id);
    return !!(row && row.installed === true);
  });
}

function _toolRowsHtml(status) {
  const tools = (status && Array.isArray(status.tools)) ? status.tools : [];
  return OBW_REQUIRED_TOOLS.map((id) => {
    const row = tools.find(t => t && t.id === id);
    const ok = !!(row && row.installed === true);
    const version = row && row.version ? row.version : null;
    const badge = ok ? 'ds-badge--green' : 'ds-badge--red';
    const text = ok ? (version ? version : 'present') : 'missing';
    return `
      <div class="obw-repo-row">
        <div class="obw-repo-row-main">
          <span class="obw-repo-label">${escHtml(_TOOL_LABELS[id] || id)}</span>
          <span class="ds-badge ${badge} obw-repo-badge">${escHtml(text)}</span>
        </div>
      </div>`;
  }).join('');
}

function _paintStep1(root) {
  const done = obwToolsReady(_toolsStatus);
  _setChip(root, 'step1', done);
  const listEl = root.querySelector('#obw-tools-list');
  if (listEl) listEl.innerHTML = _toolRowsHtml(_toolsStatus);
  const hintEl = root.querySelector('#obw-tools-hint');
  if (hintEl) {
    hintEl.hidden = done;
    hintEl.textContent = done
      ? ''
      : 'Something is missing. The Settings > Tools tab shows why and can install most of these tools with one click.';
  }
}

function _wireStep1(root) {
  const refreshBtn = root.querySelector('#obw-tools-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => _withBusy(refreshBtn, 'Checking...', async () => {
      _toolsStatus = await _getJson('/api/tools/status?refresh=1');
      _paintStep1(root);
    }));
  }
  const openBtn = root.querySelector('#obw-tools-open-btn');
  if (openBtn) {
    openBtn.addEventListener('click', () => {
      if (_navigate) _navigate('settings/tools');
      else window.location.hash = '#settings/tools';
    });
  }
}

// ── Step 2 — Bitwarden ───────────────────────────────────────────────────────

function _paintStep2(root) {
  const done = !!(_bwStatus && _bwStatus.hasSecrets);
  _setChip(root, 'step2', done);

  const statusEl = root.querySelector('#obw-bw-status');
  if (statusEl) {
    // The else branch is not decoration: this line starts as a loading
    // placeholder, and it is the ONE container on the view whose painter used
    // to skip an unanswered probe - which would leave the placeholder pulsing
    // for good. Every other painter overwrites unconditionally.
    if (_bwStatus) {
      const parts = [];
      parts.push(_bwStatus.installed ? 'CLI installed' : 'CLI not installed');
      if (_bwStatus.installed) {
        parts.push(_bwStatus.configured ? 'server configured' : 'server not configured');
        parts.push(_bwStatus.hasSecrets
          ? 'vault unlocked (' + (_bwStatus.loadedSecrets || []).length + ' keys)'
          : 'vault locked');
      }
      statusEl.textContent = parts.join(' · ');
      statusEl.className = 'obw-bw-status ' + (done ? 'obw-bw-status--ok' : 'obw-bw-status--pending');
    } else {
      statusEl.textContent = 'Could not check the vault state — try "Refresh status".';
      statusEl.className = 'obw-bw-status obw-bw-status--pending';
    }
  }
  _paintStep3(root);
  // Step 5 shows the data-repo token badge, which comes from the same vault
  // payload - without this an unlock would leave it stale at "Missing".
  _paintStep5(root);
  _paintStep7(root);
}

let _secretsWired = false;

async function _refreshStep2(root) {
  // The key step lists the sources the vault opens (obwVisibleKeyRows), so a
  // vault change re-reads the encryption status too - the two probes fan out.
  const [bw, enc] = await Promise.all([
    _getJson('/api/bitwarden/status?t=' + Date.now()),
    _getJson('/api/settings/encryption-status?t=' + Date.now()),
  ]);
  _bwStatus = bw;
  _encStatus = enc;
  _paintStep2(root);
  _paintStep4(root);
}

function _wireStep2(root) {
  const openBtn = root.querySelector('#obw-bw-open-btn');
  const refreshBtn = root.querySelector('#obw-bw-refresh-btn');
  if (openBtn) {
    // No callback: the modal announces a successful unlock on the shared
    // secrets bus and initOnboardingWizard listens for it, so this path and an
    // unlock started from the top bar pill repaint through exactly one route.
    // Passing a callback as well would only cost a second `bw status` spawn.
    openBtn.addEventListener('click', () => { _openBitwardenModal(); });
  }
  if (refreshBtn) {
    // Still useful: a vault unlocked from the top bar, or outside the app.
    refreshBtn.addEventListener('click', () => _withBusy(refreshBtn, 'Checking...', () => _refreshStep2(root)));
  }
}

// ── Step 3 — GitLab project tokens ───────────────────────────────────────────
// The project tokens live in Bitwarden, never in .env, so "done" is a question
// about the vault, not about a file. This step gates on the APP token alone -
// the one the cockpit needs for itself (update, MR). COCKPIT_DATA_TOKEN is
// listed in step 5 instead, next to the repository it actually opens, so the
// data-repo prerequisites (key, token, clone) sit in one card rather than
// being split across two steps a newcomer reads minutes apart.
const OBW_REQUIRED_TOKENS = ['COCKPIT_APP_TOKEN'];

/** The data-repo token. Shown in step 5, not here. */
const OBW_DATA_TOKEN = 'COCKPIT_DATA_TOKEN';

const _TOKEN_LABELS = {
  COCKPIT_APP_TOKEN: 'App repository token',
  COCKPIT_DATA_TOKEN: 'Data repository token',
};

/** Is one named secret loaded from the vault? */
function _secretLoaded(bwStatus, name) {
  const loaded = (bwStatus && Array.isArray(bwStatus.loadedSecrets)) ? bwStatus.loadedSecrets : [];
  return loaded.includes(name);
}

/**
 * Badge for one token row. A CLOSED vault is a different fact from a missing
 * entry, and saying "Missing" for both sends a person hunting through GitLab for
 * a token that is sitting in their vault. Pure - unit tested.
 * @param {object|null} bwStatus GET /api/bitwarden/status payload
 * @param {boolean} loaded whether this token is in loadedSecrets
 * @returns {{cls: string, text: string, msg: string}}
 */
export function obwTokenBadge(bwStatus, loaded) {
  if (loaded) return { cls: 'ds-badge--green', text: 'In the vault', msg: '' };
  const vaultOpen = !!(bwStatus && (bwStatus.sessionOpen === true || bwStatus.hasSecrets === true));
  if (!vaultOpen) {
    return {
      cls: 'ds-badge--gray',
      text: 'Vault locked',
      msg: 'Not known yet whether this key is in the vault — unlock it in step 2.',
    };
  }
  return { cls: 'ds-badge--gray', text: 'Missing', msg: '' };
}

/**
 * Which of the required tokens the vault has loaded. Pure - unit tested.
 * @param {object|null} bwStatus GET /api/bitwarden/status payload
 * @returns {{loaded: string[], missing: string[], done: boolean}}
 */
export function obwTokenState(bwStatus) {
  const loadedAll = (bwStatus && Array.isArray(bwStatus.loadedSecrets)) ? bwStatus.loadedSecrets : [];
  const loaded = OBW_REQUIRED_TOKENS.filter(n => loadedAll.includes(n));
  const missing = OBW_REQUIRED_TOKENS.filter(n => !loadedAll.includes(n));
  return { loaded, missing, done: missing.length === 0 };
}

function _paintStep3(root) {
  const state = obwTokenState(_bwStatus);
  _setChip(root, 'step3', state.done);
  const listEl = root.querySelector('#obw-tokens-list');
  if (listEl) {
    listEl.innerHTML = OBW_REQUIRED_TOKENS.map((name) => {
      const badge = obwTokenBadge(_bwStatus, state.loaded.includes(name));
      return `
        <div class="obw-repo-row">
          <div class="obw-repo-row-main">
            <span class="obw-repo-label">${escHtml(_TOKEN_LABELS[name] || name)}</span>
            <span class="ds-badge ${badge.cls} obw-repo-badge">${escHtml(badge.text)}</span>
          </div>
          ${badge.msg ? `<p class="obw-repo-msg">${escHtml(badge.msg)}</p>` : ''}
        </div>`;
    }).join('');
  }
  // Same gate the Keys tab applies (_gitlabBoxState): without the owner token
  // a create is refused by the server with a 503, so offering an enabled button
  // here would only produce a failure the tab already knows how to avoid. The
  // gate is fail-OPEN on an unanswered probe (null), exactly as it is there -
  // the authoritative refusal stays the server's.
  const createBtn = root.querySelector('#obw-tokens-create-btn');
  const gateHint = root.querySelector('#obw-tokens-gate');
  const targets = (_tokenTargets && _tokenTargets.targets) || [];
  const ownerMissing = !!(_tokenTargets && _tokenTargets.ownerTokenConfigured === false);
  if (createBtn) createBtn.disabled = targets.length === 0 || ownerMissing;
  if (gateHint) {
    gateHint.hidden = !ownerMissing;
    gateHint.textContent = ownerMissing
      ? 'Generating keys needs a GitLab account with Maintainer rights and an unlocked vault. Unlock the vault in step 2 or ask someone with that right to generate the keys.'
      : '';
  }
}

function _wireStep3(root) {
  const createBtn = root.querySelector('#obw-tokens-create-btn');
  if (createBtn) {
    createBtn.addEventListener('click', async () => {
      if (!_tokenTargets) _tokenTargets = await _fetchGitlabTokenTargets();
      await _openGitlabTokensModal(_tokenTargets.targets || []);
    });
  }
  const refreshBtn = root.querySelector('#obw-tokens-refresh-btn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => _withBusy(refreshBtn, 'Checking...', async () => {
      [_bwStatus, _tokenTargets] = await Promise.all([
        _getJson('/api/bitwarden/status?t=' + Date.now()),
        _fetchGitlabTokenTargets(),
      ]);
      _paintStep2(root);
    }));
  }
}

// ── Step 4 — encryption keys ─────────────────────────────────────────────────

const _KEY_ERROR_MESSAGES = {
  'key-invalid': 'Invalid key — expected 32 bytes encoded in base64.',
  'key-missing': 'Empty key.',
  'unknown-repo': 'Unknown repository.',
  'write-failed': 'Could not write the key file.',
  'invalid-body': 'The server did not understand the request.',
};

function _keyErrorMessage(code, fallback) {
  return _KEY_ERROR_MESSAGES[code] || fallback || 'Could not save the key.';
}

/** Allowed repo ids, straight from the server. Never a copy kept in this file. */
function _allowedRepoIds() {
  const repos = (_encStatus && Array.isArray(_encStatus.repos)) ? _encStatus.repos : [];
  return repos.map(r => r.id);
}

/**
 * Parse the textarea into entries plus per-line errors. Pure - unit tested.
 * @param {string} rawText
 * @param {string[]} allowedIds ids from GET /api/settings/encryption-status
 * @returns {{entries: Array<{repoId: string, key: string}>, errors: string[]}}
 */
export function obwParseKeyLines(rawText, allowedIds) {
  const allowed = allowedIds || [];
  const lines = String(rawText || '').split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));
  const entries = [];
  const errors = [];
  const seen = new Set();
  lines.forEach((line, idx) => {
    const eqIdx = line.indexOf('=');
    if (eqIdx < 1) {
      errors.push(`Line ${idx + 1}: expected the format repoId=key.`);
      return;
    }
    const repoId = line.slice(0, eqIdx).trim();
    const key = line.slice(eqIdx + 1).trim();
    if (!allowed.includes(repoId)) {
      errors.push(`Line ${idx + 1}: unknown repository "${repoId}".`);
      return;
    }
    if (!key) {
      errors.push(`Line ${idx + 1}: empty key.`);
      return;
    }
    if (seen.has(repoId)) {
      errors.push(`Line ${idx + 1}: repository "${repoId}" given twice.`);
      return;
    }
    seen.add(repoId);
    entries.push({ repoId, key });
  });
  return { entries, errors };
}

/**
 * Is the key step done? Gated on the ONE repo the next step actually clones
 * (OBW_DATA_REPO_ID, matched against the row's `repo` - the route id, which
 * for data-tier-0 differs from its key id `ds-data`). Every source now syncs,
 * so gating on "all wired repos" would demand seven more keys before the
 * button that fetches the team data unlocks - and those seven are optional
 * extras a person clones later, not a prerequisite for onboarding. The other
 * rows are still listed so nobody wonders where their other keys went.
 *
 * A payload from an older server carries no `repo` on any row; it falls back
 * to the `syncWired` rows, and then to the whole list, rather than reporting a
 * green step it cannot justify.
 * Pure - unit tested.
 * @param {object|null} encStatus GET /api/settings/encryption-status payload
 * @returns {boolean}
 */
export function obwKeysReady(encStatus) {
  if (!encStatus || !encStatus.keyPresent) return false;
  const repos = Array.isArray(encStatus.repos) ? encStatus.repos : [];
  if (repos.length === 0) return false;
  const dataRow = repos.filter(r => r && r.repo === OBW_DATA_REPO_ID);
  const wired = repos.filter(r => r && r.syncWired === true);
  const gated = dataRow.length > 0 ? dataRow : (wired.length > 0 ? wired : repos);
  return gated.every(r => r && r.keyPresent === true);
}

/**
 * Which rows the key step LISTS: only the sources the vault gave this person
 * access to (`hasToken` on the encryption-status row - the GitLab project
 * token loaded from Bitwarden). A newcomer's vault holds the entries for the
 * repositories they were let into, so a key for any other source is a row
 * they cannot act on; eight rows of "No key" hid the one that mattered.
 * The list is a VIEW: `_encStatus.repos` stays complete for the parser, the
 * chip and every other reader, and a payload from an older server (no
 * `hasToken` field) shows every row rather than hiding what it cannot judge.
 * Pure - unit tested.
 * @param {object|null} encStatus GET /api/settings/encryption-status payload
 * @returns {{rows: object[], reason: 'ok'|'vault-locked'|'no-access'|'no-data'}}
 */
export function obwVisibleKeyRows(encStatus) {
  const repos = (encStatus && Array.isArray(encStatus.repos)) ? encStatus.repos.filter(Boolean) : [];
  if (repos.length === 0) return { rows: [], reason: 'no-data' };
  const judged = repos.every(r => typeof r.hasToken === 'boolean');
  if (!judged) return { rows: repos, reason: 'ok' };
  const rows = repos.filter(r => r.hasToken === true);
  if (rows.length > 0) return { rows, reason: 'ok' };
  return { rows: [], reason: encStatus.bitwardenLocked === true ? 'vault-locked' : 'no-access' };
}

const _KEY_EMPTY_COPY = {
  'vault-locked': 'Unlock the vault in step 2 — the data sources you can access will then appear here.',
  'no-access': 'The vault holds no access key for any data source. Ask your team admin for access to the repository.',
  'no-data': 'The server returned no repository list.',
};

// Last painted row count, so the next load reserves the height this machine
// really ends up with. Only a hint - see _skelKeyRows.
const _KEY_ROWS_STORAGE = 'cockpit.obw.keyRows';

/**
 * Which key button a step-4 row gets. 'generate' wins when both could apply,
 * but they cannot: the server sets keyGeneratable only while no own line
 * exists and keyCopyable only when one does.
 * @param {{keyGeneratable?: boolean, keyPresent?: boolean, keyCopyable?: boolean}} row
 * @returns {'generate'|'copy'|null}
 */
export function obwKeyRowAction(row) {
  if (!row) return null;
  if (row.keyGeneratable === true && row.keyPresent !== true) return 'generate';
  if (row.keyCopyable === true) return 'copy';
  return null;
}

function _keyActionButton(r) {
  const action = obwKeyRowAction(r);
  if (action === 'generate') {
    return `<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-obw-gen-key="${escHtml(r.id)}">Generate a new key</button>`;
  }
  if (action === 'copy') {
    return `<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-obw-copy-key="${escHtml(r.id)}">Copy key</button>`;
  }
  return '';
}

const _GEN_ERR_COPY = {
  'mirror-not-empty': 'This source already has encrypted data - you need the key from the person who sent it.',
  'remote-unknown': 'Could not check the server. Check the VPN and try again.',
  'key-exists': 'A key for this source already exists on this computer.',
  'not-cloned': 'Clone this source in the Sync window first.',
  'test-mode': 'Test mode - the key was not saved.',
};

async function _postKeyOp(path, repoId) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ repoId }),
  });
  return res.json().catch(() => ({}));
}

// The key line goes server -> clipboard and nowhere else: never rendered,
// logged or put in a toast; the variable is dropped right after writeText.
async function _copyKeyToClipboard(repoId) {
  let line = null;
  try {
    const data = await _postKeyOp('/api/settings/encryption-key/export', repoId);
    if (!data || !data.ok || typeof data.line !== 'string') {
      showToast('error', 'Could not copy the key', (data && data.message) || '');
      return false;
    }
    line = data.line;
    await navigator.clipboard.writeText(line);
    showToast('success', 'Key copied to the clipboard - paste it into a note in Bitwarden.');
    return true;
  } catch {
    showToast('warning', 'The clipboard refused the write', 'Use the "Copy key" button next to this source.');
    return false;
  } finally {
    line = null;
  }
}

async function _runGenerateKey(root, btn, repoId) {
  const ok = await confirmDsModal({
    title: 'New encryption key',
    body: 'Use only for a new, empty source. The key is saved to the .encryption-key file on this computer - then hand the line to the people with access to this source. It is never shown on screen.',
    okLabel: 'Generate',
    trigger: btn,
  });
  if (!ok) return;
  btn.setAttribute('aria-busy', 'true');
  try {
    const data = await _postKeyOp('/api/settings/encryption-key/generate', repoId);
    if (data && data.ok) {
      showToast('success', 'Key generated and saved.');
      await _copyKeyToClipboard(repoId);
    } else {
      const code = data && data.error;
      showToast('error', 'Key not generated', _GEN_ERR_COPY[code] || (data && data.message) || 'Try again.');
    }
  } catch (err) {
    showToast('error', 'Network error', err.message);
  } finally {
    btn.removeAttribute('aria-busy');
  }
  _encStatus = await _getJson('/api/settings/encryption-status?t=' + Date.now());
  _paintStep4(root);
}

function _paintStep4(root) {
  _setChip(root, 'step4', obwKeysReady(_encStatus));
  const { rows, reason } = obwVisibleKeyRows(_encStatus);
  const listEl = root.querySelector('#obw-key-state');
  if (listEl) {
    listEl.innerHTML = rows.length
      ? rows.map(r => `
      <div class="obw-repo-row">
        <div class="obw-repo-row-main">
          <span class="obw-repo-label">${escHtml(r.label || r.id)} <code>${escHtml(r.id)}</code></span>
          <span class="ds-badge ${r.keyPresent ? 'ds-badge--green' : 'ds-badge--gray'} obw-repo-badge">${r.keyPresent ? 'Key present' : 'No key'}</span>
          ${_keyActionButton(r)}
        </div>
        ${r.keyPresent ? '' : `<p class="obw-repo-msg">Paste the line <code>${escHtml(r.id)}=key</code> above and save.</p>`}
      </div>`).join('')
      : `<p class="obw-repo-msg">${_KEY_EMPTY_COPY[reason] || _KEY_EMPTY_COPY['no-data']}</p>`;
    try { localStorage.setItem(_KEY_ROWS_STORAGE, String(rows.length)); } catch { /* storage may be unavailable */ }
  }
  const hintEl = root.querySelector('#obw-key-ids');
  if (hintEl) {
    const ids = rows.map(r => r.id);
    hintEl.textContent = ids.length
      ? 'Your source ids: ' + ids.join(', ') + '.'
      : (_allowedRepoIds().length ? 'The source list appears below once the vault is unlocked.' : 'The server returned no repository list.');
  }
  _paintStep5(root);
  _paintStep7(root);
}

async function _runKeySaveFlow(root, rawText, errEl) {
  const { entries, errors } = obwParseKeyLines(rawText, _allowedRepoIds());

  if (errEl) {
    if (errors.length) {
      errEl.hidden = false;
      errEl.replaceChildren();
      errors.forEach((msg) => {
        const line = document.createElement('div');
        line.textContent = msg;
        errEl.appendChild(line);
      });
    } else {
      errEl.hidden = true;
      errEl.replaceChildren();
    }
  }
  if (entries.length === 0) {
    if (errEl && !errors.length) {
      errEl.hidden = false;
      errEl.textContent = 'Paste at least one line in the format repoId=key.';
    }
    return;
  }

  const rowsEl = root.querySelector('#obw-key-rows');
  if (rowsEl) rowsEl.innerHTML = '';

  // Partial-validation convention: one rejected line never aborts the batch.
  for (const entry of entries) {
    const row = rowsEl ? _addRepoRow(rowsEl, entry.repoId) : null;
    _setRepoRow(row, 'blue', 'Saving...');
    try {
      const res = await fetch('/api/settings/encryption-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoId: entry.repoId, key: entry.key }),
      });
      const data = await res.json().catch(() => ({}));
      if (data && data.ok) _setRepoRow(row, 'green', 'Saved');
      else _setRepoRow(row, 'red', 'Error', _keyErrorMessage(data && data.error));
    } catch (err) {
      _setRepoRow(row, 'red', 'Error', 'Network error: ' + err.message);
    }
  }

  _encStatus = await _getJson('/api/settings/encryption-status?t=' + Date.now());
  _paintStep4(root);

  // A saved key changes nothing on disk until the mirror is decrypted again -
  // the source cockpit ran that decrypt right after the save, and so does this
  // card. The difference: there the clone chain was still running, so it polled
  // for up to ten minutes; here nothing clones by itself, so a source that is
  // not on this machine yet is reported as such instead of being waited for.
  await _runDecryptFlow(root, entries.map(e => e.repoId));
}

/**
 * Re-decrypt the sources whose key was just saved. Only the ones already
 * cloned - `pull-stream` on a missing clone would be a first clone, which is
 * step 5's decision (and, for the seven extras, the sync panel's), not this
 * one's.
 * @param {HTMLElement} root
 * @param {string[]} keyIds key ids (`ds-data`, `data-po`, ...), NOT route ids
 */
async function _runDecryptFlow(root, keyIds) {
  const progressEl = root.querySelector('#obw-key-progress');
  const phaseEl = root.querySelector('#obw-key-phase');
  const fillEl = root.querySelector('#obw-key-fill');
  const rowsEl = root.querySelector('#obw-key-decrypt-rows');
  if (!progressEl || !rowsEl || keyIds.length === 0) return;

  progressEl.hidden = false;
  rowsEl.innerHTML = '';
  _setPct(fillEl, 0);
  _setPhase(phaseEl, 'Checking which sources are already on this computer...');

  const overview = await _getJson('/api/sync-overview?t=' + Date.now());
  const rowByRepo = new Map(((overview && overview.repos) || []).map(r => [r.repo, r]));
  const encRepos = (_encStatus && Array.isArray(_encStatus.repos)) ? _encStatus.repos : [];

  // The route id is NOT the key id for the first source (`ds-data` ->
  // `data-tier-0`), so the URL is always built from the row's `repo` field.
  const items = keyIds.map((keyId) => {
    const row = encRepos.find(r => r && r.id === keyId) || null;
    return { keyId, repo: row ? row.repo : null, label: (row && row.label) || keyId };
  });

  const total = items.length;
  let doneCount = 0;
  let okCount = 0;
  let skippedCount = 0;
  for (const item of items) {
    const row = _addRepoRow(rowsEl, item.label);
    const src = item.repo ? rowByRepo.get(item.repo) : null;
    if (!src || src.status !== 'ready') {
      _setRepoRow(row, 'gray', 'Not downloaded', 'This source is not on this computer yet — download it in the Sync panel.');
      skippedCount++;
      doneCount++;
      _setPct(fillEl, Math.round((doneCount / total) * 100));
      continue;
    }
    // A decrypt writes the mirror OVER the plaintext tree the app writes to, so
    // a source holding work that was never pushed must not be overwritten
    // behind the person's back - a pasted key would silently cost them those
    // edits. The exception is a tree that never received the mirror's content
    // at all (`decrypted: false`): there is nothing of the mirror in it to
    // overwrite, and the decrypt op keeps whatever else it holds (prune:false).
    // The facts come from the same sync-overview row the panel reads.
    if (src.decrypted !== false && (src.plaintextDirty === true || (src.filesToSend || 0) > 0)) {
      _setRepoRow(row, 'gray', 'Local changes', 'This source has unsent changes — send them in the Sync panel, then fetch it again.');
      skippedCount++;
      doneCount++;
      _setPct(fillEl, Math.round((doneCount / total) * 100));
      continue;
    }
    _setPhase(phaseEl, `Decrypting ${doneCount + 1}/${total} — ${item.label}...`);
    _setRepoRow(row, 'blue', 'Decrypting...');
    // Decrypt only - not a pull. A pull encrypts the plaintext tree into the
    // mirror FIRST, and on a tree that never received the mirror's content
    // that step used to unlink every `.enc` the mirror held, which the next
    // push would have published as the deletion of the team's data. The
    // decrypt op touches no git state at all; fetching newer commits is the
    // sync panel's job afterwards.
    const result = await decryptDataTierRepo(item.repo);
    doneCount++;
    _setPct(fillEl, Math.round((doneCount / total) * 100));
    if (result && result.ok) {
      okCount++;
      _setRepoRow(row, 'green', 'Done', result.message || '');
      if (item.repo === OBW_DATA_REPO_ID) loadTeamDirectory(true);
    } else {
      _setRepoRow(row, 'red', 'Error', formatSyncStreamError(result || {}));
    }
  }

  _setPct(fillEl, 100);
  if (skippedCount === total) {
    _setPhase(phaseEl, 'Keys saved. None of these sources is on this computer yet.');
  } else if (okCount === total) {
    _setPhase(phaseEl, 'Data decrypted.');
  } else {
    _setPhase(phaseEl, `Decrypted ${okCount} of ${total - skippedCount}.`);
  }

  await _refreshRepoStatus();
  _paintStep5(root);
}

function _wireStep4(root) {
  const btn = root.querySelector('#obw-key-save-btn');
  const textarea = root.querySelector('#obw-key-textarea');
  const errEl = root.querySelector('#obw-key-error');
  const listEl = root.querySelector('#obw-key-state');
  if (listEl) {
    // Delegated: _paintStep4 rewrites the rows with innerHTML.
    listEl.addEventListener('click', (ev) => {
      const gen = ev.target.closest('[data-obw-gen-key]');
      if (gen) { _runGenerateKey(root, gen, gen.getAttribute('data-obw-gen-key')); return; }
      const copy = ev.target.closest('[data-obw-copy-key]');
      if (copy) {
        copy.setAttribute('aria-busy', 'true');
        _copyKeyToClipboard(copy.getAttribute('data-obw-copy-key')).finally(() => copy.removeAttribute('aria-busy'));
      }
    });
  }
  if (!btn || !textarea) return;
  btn.addEventListener('click', () => _withBusy(btn, 'Saving...', async () => {
    if (errEl) { errEl.hidden = true; errEl.replaceChildren(); }
    await _runKeySaveFlow(root, textarea.value, errEl);
  }));
}

// ── Step 5 — team data clone ─────────────────────────────────────────────────
// data-tier-0 is the ONE data repo whose pull/push is wired end to end. The
// other seven accept their key (step 4) but their sync is still
// _dataRepoCryptoNotWired on the server, so this card deliberately speaks about
// one repository rather than eight.

const OBW_DATA_REPO_ID = 'data-tier-0';

/**
 * Is the data step done? Pure - unit tested.
 * @param {object|null} repoStatus GET /api/data/data-tier-0/status payload
 * @returns {boolean}
 */
// Cloned AND readable. A mirror that was cloned before its key existed answers
// status 'ready' with `decrypted: false` - the files are on disk, but every
// view reading the plaintext directory (the team roster and avatars first of
// all) sees nothing, so the step is not done until the decrypt ran.
//
// `wrappedUpAt` is the second way to be unreadable and needs its own clause:
// after an "End of day" wipe, one stray write into the emptied tree gives
// mirrorOverlap something to find and `decrypted` flips back to true on a
// tree that is still essentially empty. Reading `decrypted` alone would tell
// the wizard the data step is done while the roster is gone. The server
// clears the marker on a successful decrypt, so its presence alone is the
// answer - the same rule repoStateBadge, dayCycleRowBadge and
// morningRowsToDecrypt follow.
export function obwDataReady(repoStatus) {
  if (!repoStatus || repoStatus.status !== 'ready') return false;
  if (repoStatus.wrappedUpAt) return false;
  return repoStatus.decrypted !== false;
}

/** Cloned, whether or not the plaintext directory has been filled yet. */
export function obwDataCloned(repoStatus) {
  return !!(repoStatus && repoStatus.status === 'ready');
}

function _paintStep5(root) {
  const done = obwDataReady(_repoStatus);
  _setChip(root, 'step5', done);

  const keysDone = obwKeysReady(_encStatus);
  const btn = root.querySelector('#obw-data-clone-btn');
  const stateEl = root.querySelector('#obw-data-state');

  // The token that opens this repository. It lives in the vault exactly like
  // the app token in step 3; it sits here because this is the card whose
  // button fails without it.
  const tokenEl = root.querySelector('#obw-data-token-list');
  if (tokenEl) {
    const badge = obwTokenBadge(_bwStatus, _secretLoaded(_bwStatus, OBW_DATA_TOKEN));
    const msg = badge.text === 'Missing'
      ? 'The key is not in the vault — generate it with the "Generate keys" button in step 3 and paste it into the named item.'
      : badge.msg;
    tokenEl.innerHTML = `
      <div class="obw-repo-row">
        <div class="obw-repo-row-main">
          <span class="obw-repo-label">${escHtml(_TOKEN_LABELS[OBW_DATA_TOKEN])}</span>
          <span class="ds-badge ${badge.cls} obw-repo-badge">${escHtml(badge.text)}</span>
        </div>
        ${msg ? `<p class="obw-repo-msg">${escHtml(msg)}</p>` : ''}
      </div>`;
  }

  const cloned = obwDataCloned(_repoStatus);
  if (btn) {
    btn.disabled = !keysDone;
    btn.textContent = (cloned && !done) ? 'Decrypt data' : done ? 'Fetch again' : 'Download team data';
  }
  if (stateEl) {
    if (cloned && !done) {
      stateEl.className = 'ds-callout ds-callout--warning obw-data-state';
      stateEl.textContent = keysDone
        ? 'Team data is downloaded but not decrypted yet — click "Decrypt data".'
        : 'Team data is downloaded but encrypted: without the key from step 4 it cannot be read.';
    } else if (!keysDone) {
      stateEl.className = 'ds-callout ds-callout--warning obw-data-state';
      stateEl.textContent = 'Step 4 first: without the team data key the downloaded files stay encrypted.';
    } else if (done) {
      const parts = ['Repository ready'];
      if (_repoStatus.branch) parts.push('branch ' + _repoStatus.branch);
      if (_repoStatus.lastSync) parts.push('last sync ' + _fmtDate(_repoStatus.lastSync));
      stateEl.className = 'ds-callout ds-callout--success obw-data-state';
      stateEl.textContent = parts.join(' · ') + '.';
    } else {
      // The strip under the top bar already knows when GitLab did not answer;
      // a card that only says "not downloaded yet" sends a person to a clone
      // that will fail the same way, so name the reason here too.
      const net = getInfraNetwork();
      const netState = net ? net.state : null;
      // Both bad readings end the same clone the same way; only the reason
      // and therefore the sentence differ.
      const blocked = netState === 'unreachable' || netState === 'refused';
      stateEl.className = `ds-callout ${blocked ? 'ds-callout--warning' : 'ds-callout--info'} obw-data-state`;
      const base = 'Team data is not downloaded to this computer yet.';
      if (netState === 'unreachable') {
        stateEl.textContent = base + ' GitLab is not responding right now - turn on the VPN before you click "Download team data".';
      } else if (netState === 'refused') {
        stateEl.textContent = base + ' GitLab refuses the connection from this computer - check the VPN and, if it works, renew the token before you click "Download team data".';
      } else {
        stateEl.textContent = base;
      }
    }
  }
  _paintStep7(root);
}

function _fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function _refreshRepoStatus() {
  _repoStatus = await _getJson(`/api/data/${OBW_DATA_REPO_ID}/status?t=` + Date.now());
}

function _wireStep5(root) {
  const btn = root.querySelector('#obw-data-clone-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const stateEl = root.querySelector('#obw-data-state');
    if (obwDataCloned(_repoStatus) && !obwDataReady(_repoStatus)) {
      // Cloned before the key existed: decrypt in place, no fetch, no modal.
      btn.disabled = true;
      const data = await decryptDataTierRepo(OBW_DATA_REPO_ID);
      // The roster and the photos live in the tree that just appeared; the
      // directory caches an empty answer otherwise until the next full reload.
      if (data && data.ok) loadTeamDirectory(true);
      await _refreshRepoStatus();
      _paintStep5(root);
      if (!(data && data.ok) && stateEl) {
        stateEl.className = 'ds-callout ds-callout--danger obw-data-state';
        stateEl.textContent = 'Decryption failed: ' + formatSyncStreamError(data || {});
      }
      return;
    }
    const exists = obwDataReady(_repoStatus);
    const op = exists ? 'pull-stream' : 'clone-stream';
    // The shared progress modal, not a private copy: it already carries the
    // live step log and every recovery action a failed sync needs.
    await runSyncWithProgress(`/api/data/${OBW_DATA_REPO_ID}/${op}`, {
      title: exists ? 'Syncing team data' : 'Downloading team data',
      repoBase: `data/${OBW_DATA_REPO_ID}`,
      encrypted: true,
      refreshStatus: _refreshRepoStatus,
      render: () => _paintStep5(root),
    });
    await _refreshRepoStatus();
    _paintStep5(root);
  });
}

// ── Step 6 — cockpit update ──────────────────────────────────────────────────

function _paintStep6(root) {
  const upToDate = !!(_updateCheck && _updateCheck.ok && !_updateCheck.hasUpdate);
  _setChip(root, 'step6', upToDate, 'To check');
}

async function _runUpdateCheck(root) {
  const resultEl = root.querySelector('#obw-update-result');
  if (!resultEl) return;
  resultEl.hidden = false;
  resultEl.className = 'obw-update-result ds-callout ds-callout--info';
  resultEl.textContent = 'Checking...';

  let body;
  try {
    const res = await fetch('/api/app/check-update', { cache: 'no-store' });
    body = await res.json();
  } catch (err) {
    resultEl.className = 'obw-update-result ds-callout ds-callout--danger';
    resultEl.textContent = 'Network error: ' + err.message;
    return;
  }
  _updateCheck = body;

  if (!body.ok) {
    resultEl.className = 'obw-update-result ds-callout ds-callout--danger';
    resultEl.textContent = mapCheckUpdateError(body, {
      'no-token': 'No token for the app repository — unlock the vault in step 2.',
      'no-access': 'No access to the repository — most often the VPN is off. If the VPN works, check the token in step 3.',
    });
    _paintStep6(root);
    return;
  }

  if (body.hasUpdate) {
    resultEl.className = 'obw-update-result ds-callout ds-callout--warning';
    resultEl.replaceChildren();
    const text = document.createElement('span');
    text.textContent = 'A newer version of Mission Deck is available. ';
    resultEl.appendChild(text);
    const updateBtn = document.createElement('button');
    updateBtn.type = 'button';
    updateBtn.className = 'ds-btn ds-btn--secondary ds-btn--sm';
    updateBtn.textContent = 'Update now';
    updateBtn.addEventListener('click', () => {
      updateBtn.disabled = true;
      _runUpdate(root, updateBtn).catch(() => { updateBtn.disabled = false; });
    });
    resultEl.appendChild(updateBtn);
  } else {
    _paintUpToDate(resultEl);
  }
  _paintStep6(root);
}

/**
 * "Mission Deck is up to date" - plus the recovery note when a stash-and-update on
 * the previous page load left one: the success callout below is followed by
 * location.reload() within seconds, and for a person who has never opened
 * Settings this step is the only place that note can reach them. Same
 * localStorage key and the same dismiss as the System tab.
 * @param {HTMLElement} resultEl
 */
function _paintUpToDate(resultEl) {
  let note = null;
  try { note = parseStashNote(localStorage.getItem(STASH_NOTE_KEY)); } catch (_e) { /* private mode */ }
  if (!note) {
    resultEl.className = 'obw-update-result ds-callout ds-callout--success';
    resultEl.textContent = 'Mission Deck is up to date.';
    return;
  }
  resultEl.className = 'obw-update-result ds-callout ds-callout--warning';
  resultEl.innerHTML = stashNoteHtml(
    `Mission Deck is up to date. After the last update your changes are waiting in the stash${note.at ? ' (' + _fmtDate(note.at) + ')' : ''}.`,
    note, { dismiss: true });
  const dismiss = resultEl.querySelector(STASH_NOTE_DISMISS_SELECTOR);
  if (dismiss) {
    dismiss.addEventListener('click', () => {
      try { localStorage.removeItem(STASH_NOTE_KEY); } catch (_e) { /* ignore */ }
      _paintUpToDate(resultEl);
    });
  }
}

/**
 * The dirty-tree answer: the shared callout from js/app-update-stash.mjs (the
 * same markup Settings > System paints) with the opt-in "stash and update"
 * button when the server says a stash would clear the tree. The button lives
 * inside the callout, so the next repaint drops it - no cleanup registration.
 * @param {HTMLElement} root
 * @param {HTMLElement} resultEl
 * @param {object} body
 * @param {number} status
 */
function _renderDirtyTree(root, resultEl, body, status) {
  resultEl.className = 'obw-update-result ds-callout ds-callout--danger';
  resultEl.innerHTML = dirtyTreeCalloutHtml(body, mapAppUpdateError(body, status, { stashActionHere: true }));
  const stashBtn = resultEl.querySelector(STASH_UPDATE_BTN_SELECTOR);
  if (stashBtn) {
    stashBtn.addEventListener('click', () => {
      if (!window.confirm(stashConfirmText(body))) return;
      stashBtn.disabled = true;
      _runUpdate(root, null, true).catch(() => { stashBtn.disabled = false; });
    });
  }
}

/**
 * POST /api/app/update. `stashDirty` is the second step of the dirty-tree
 * path: only the literal true opens the server's gate, and both steps share
 * this one response handler so the outcomes cannot drift apart.
 * @param {HTMLElement} root
 * @param {HTMLButtonElement|null} updateBtn
 * @param {boolean} [stashDirty]
 */
async function _runUpdate(root, updateBtn, stashDirty = false) {
  const resultEl = root.querySelector('#obw-update-result');
  if (!resultEl) return;
  resultEl.className = 'obw-update-result ds-callout ds-callout--info';
  resultEl.textContent = stashDirty
    ? 'Stashing your changes and downloading the update... This may take a few dozen seconds.'
    : 'Downloading the update... This may take a few dozen seconds.';

  let res;
  try {
    const payload = stashDirty === true ? { stashDirty: true } : {};
    res = await fetch('/api/app/update', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
  } catch (err) {
    resultEl.className = 'obw-update-result ds-callout ds-callout--danger';
    resultEl.textContent = 'Network error: ' + err.message;
    if (updateBtn) updateBtn.disabled = false;
    return;
  }

  if (res.status !== 202) {
    const body = await res.json().catch(() => ({}));
    if (body && body.error === 'dirty-tree') {
      _renderDirtyTree(root, resultEl, body, res.status);
    } else {
      resultEl.className = 'obw-update-result ds-callout ds-callout--danger';
      resultEl.textContent = mapAppUpdateError(body, res.status, { stashActionHere: true });
    }
    if (updateBtn) updateBtn.disabled = false;
    return;
  }

  const respBody = await res.json().catch(() => ({}));
  const installing = !!respBody.installing;
  // The note must outlive the reload that follows within seconds; the System
  // tab and _paintUpToDate above repaint it from this key until dismissed.
  const note = stashNoteFromResponse(respBody);
  if (note) {
    try { localStorage.setItem(STASH_NOTE_KEY, JSON.stringify(note)); } catch (_e) { /* private mode - the callout below is all we have */ }
  }
  resultEl.className = 'obw-update-result ds-callout ds-callout--info';
  const headline = installing
    ? 'Updated. Installing packages and restarting the server — this may take a few dozen seconds...'
    : 'Updated. Restarting the server — the page will reload automatically...';
  if (note) {
    resultEl.innerHTML = stashNoteHtml(headline, note, { trailing: 'This notice stays here after the restart until you close it.' });
  } else {
    resultEl.textContent = headline;
  }

  const deadline = Date.now() + (installing ? 120000 : 60000);
  let okStreak = 0;
  _stopUpdatePoll();
  _updatePoll = setInterval(async () => {
    let ok = false;
    try {
      const check = await fetch('/api/app/version', { cache: 'no-store' });
      ok = check.ok;
    } catch { /* still restarting */ }
    // Two consecutive hits, not one: the listening socket comes back before the
    // process is ready to answer every route.
    if (ok) {
      okStreak++;
      if (okStreak >= 2) { _stopUpdatePoll(); location.reload(); return; }
    } else {
      okStreak = 0;
    }
    if (Date.now() > deadline) {
      _stopUpdatePoll();
      resultEl.className = 'obw-update-result ds-callout ds-callout--danger';
      resultEl.textContent = 'The server did not come back automatically. Reload the page manually.';
      if (updateBtn) updateBtn.disabled = false;
    }
  }, 800);
}

function _wireStep6(root) {
  const btn = root.querySelector('#obw-update-check-btn');
  if (!btn) return;
  btn.addEventListener('click', () => _withBusy(btn, 'Checking...', () => _runUpdateCheck(root)));
}

// ── Step 7 — training ────────────────────────────────────────────────────────

/**
 * Is the cockpit ready to work? Vault + keys + data. The environment step is
 * NOT part of it: a missing Claude CLI does not stop anyone from reading the
 * cockpit, and the update step is independent by design.
 * Pure - unit tested.
 * @param {object|null} bwStatus @param {object|null} encStatus @param {object|null} repoStatus
 * @returns {boolean}
 */
export function obwAllDone(bwStatus, encStatus, repoStatus) {
  return !!(bwStatus && bwStatus.hasSecrets) && obwKeysReady(encStatus) && obwDataReady(repoStatus);
}

function _paintStep7(root) {
  const allDone = obwAllDone(_bwStatus, _encStatus, _repoStatus);
  _setChip(root, 'step7', allDone, 'Locked');

  const bodyEl = root.querySelector('#obw-step7-body');
  if (!bodyEl) return;
  bodyEl.replaceChildren();

  if (!allDone) {
    const p = document.createElement('p');
    p.className = 'obw-step-desc';
    p.textContent = 'Finish steps 2, 4 and 5 to unlock the training.';
    bodyEl.appendChild(p);
    return;
  }

  const callout = document.createElement('div');
  callout.className = 'ds-callout ds-callout--success obw-completion';
  const img = document.createElement('img');
  img.className = 'obw-completion-mascot';
  img.src = '/assets/mascot/pip-celebrating.svg';
  img.alt = '';
  const box = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = 'Onboarding complete';
  const desc = document.createElement('p');
  desc.textContent = 'Your Mission Deck is ready. The next step is getting to know it in the training module.';
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'ds-btn ds-btn--primary';
  link.textContent = 'Go to training';
  // In-app navigation, not target="_blank": opening the SPA a second time in a
  // new tab means a second boot and a second copy of every cached status.
  link.addEventListener('click', () => {
    if (_navigate) _navigate('academy');
    else window.location.hash = '#academy';
  });
  box.append(strong, desc, link);
  callout.append(img, box);
  bodyEl.appendChild(callout);
}

// ── Markup ───────────────────────────────────────────────────────────────────

// ── Loading skeletons ────────────────────────────────────────────────────────
// Five probes fan out at once and every card is filled by one of them, so
// without placeholders the page starts as a stack of empty cards and then jumps
// as each answer lands. The placeholders REUSE `.obw-repo-row`, which is what
// makes the reserved height the finished row's height instead of just moving
// the jump somewhere else. They need no teardown: every painter overwrites its
// container unconditionally (`innerHTML =`, `textContent =`, `replaceChildren`),
// so the first paint clears them even when the fetch answered null.

/** One placeholder row. `withMsg` reserves the second, smaller line too. */
function _skelRow(withMsg, wideLabel) {
  return `
    <div class="obw-repo-row">
      <div class="obw-repo-row-main">
        <span class="ds-skeleton obw-skel-bar obw-skel-bar--label${wideLabel ? '-wide' : ''}"></span>
        <span class="ds-skeleton obw-skel-bar obw-skel-bar--badge"></span>
      </div>
      ${withMsg ? '<span class="ds-skeleton obw-skel-bar obw-skel-bar--msg"></span>' : ''}
    </div>`;
}

// How many rows each list ends up with. A height hint only - nothing is
// validated against it, and a mismatch with the server costs one small reflow.
// The allowed repo ids still come from the server (`_allowedRepoIds`).
const _SKEL_TOOL_ROWS = OBW_REQUIRED_TOOLS.length;
const _SKEL_KEY_ROWS = 8;

function _skelRows(count, withMsg) {
  return Array.from({ length: count }, (_, i) => _skelRow(withMsg, i % 2 === 1)).join('');
}

/**
 * The key step's list: one row per source the vault opens for this person
 * (obwVisibleKeyRows), so the count differs per machine. The last painted
 * count is remembered in localStorage and reserved on the next load; a
 * browser that never painted it reserves the full list. Rows carry no
 * second line once their key is in, so none is reserved.
 */
function _skelKeyRows() {
  let count = _SKEL_KEY_ROWS;
  try {
    const saved = parseInt(localStorage.getItem(_KEY_ROWS_STORAGE), 10);
    if (Number.isFinite(saved) && saved >= 0 && saved <= _SKEL_KEY_ROWS) count = saved;
  } catch { /* storage may be unavailable - the default reserves the full list */ }
  if (count === 0) return _skelRow(false, true);
  return Array.from({ length: count }, (_, i) => _skelRow(false, i % 2 === 1)).join('');
}

function _card(stepId, title, bodyHtml) {
  return `
    <div class="ds-card obw-step-card">
      <div class="ds-card-header">
        <span class="ds-card-title">${title}</span>
        <span class="ds-skeleton obw-skel-chip" id="obw-${stepId}-chip"></span>
      </div>
      <div class="ds-card-body">${bodyHtml}</div>
    </div>`;
}

function _buildHtml() {
  return `
    <div class="obw-wrap">
      <div class="obw-hero">
        <img class="obw-mascot" src="/assets/mascot/pip-wave.svg" alt="">
        <img class="obw-mascot" src="/assets/mascot/pip-working.svg" alt="">
        <img class="obw-mascot" src="/assets/mascot/pip-success.svg" alt="">
      </div>
      <div class="page-header obw-header">
        <div class="page-header-row">
          <div>
            <h1>Welcome to Mission Deck</h1>
            <div class="subtitle">Let's set up your Mission Deck in seven steps. The order is a suggestion, not a rule — each step checks for itself whether it is already done.</div>
          </div>
        </div>
      </div>

      ${_card('step1', 'Step 1 — Environment', `
        <p class="obw-step-desc">The tools Mission Deck cannot run without. The full list of eleven checks, with installers, is in Settings.</p>
        <div class="obw-repo-rows" id="obw-tools-list">${_skelRows(_SKEL_TOOL_ROWS, false)}</div>
        <p class="obw-step-hint" id="obw-tools-hint" hidden></p>
        <div class="obw-step-actions">
          <button type="button" class="ds-btn ds-btn--secondary" id="obw-tools-refresh-btn">Check again</button>
          <button type="button" class="ds-btn ds-btn--secondary" id="obw-tools-open-btn">Open Tools</button>
        </div>`)}

      ${_card('step2', 'Step 2 — Bitwarden', `
        <p class="obw-step-desc">All access keys live in your Bitwarden vault (set <code>BW_SERVER_URL</code> for a self-hosted server). This app never writes them to disk.</p>
        <div class="obw-bw-instructions">
          <div class="obw-bw-instr-step">
            <span class="obw-bw-instr-num">1</span>
            <div>
              <strong>Install the Bitwarden CLI</strong>
              <p>In a terminal: <code>npm install -g @bitwarden/cli</code></p>
              <p>Check: <code>bw --version</code></p>
            </div>
          </div>
          <div class="obw-bw-instr-step">
            <span class="obw-bw-instr-num">2</span>
            <div>
              <strong>Configure the server and sign in</strong>
              <p><code>bw config server https://vault.bitwarden.com</code></p>
              <p><code>bw login --sso</code></p>
              <p class="obw-step-hint">In the browser, enter your organization's SSO identifier and sign in. You only do this once.</p>
            </div>
          </div>
          <div class="obw-bw-instr-step">
            <span class="obw-bw-instr-num">3</span>
            <div>
              <strong>Ask for access to a collection</strong>
              <p>Ask your team admin to prepare a vault collection named after you (for example <strong>first-last</strong>) with the starter tokens and share it with you. Your personal tokens (Figma, Jira, Confluence) you add yourself afterwards; create the Jira/Confluence personal access token (PAT) following your organization's API usage policy.</p>
            </div>
          </div>
          <div class="obw-bw-instr-step">
            <span class="obw-bw-instr-num">4</span>
            <div>
              <strong>Unlock the vault here</strong>
              <p>The button below opens a window where you enter the collection name and the master password.</p>
            </div>
          </div>
        </div>
        <p class="obw-bw-status obw-bw-status--pending" id="obw-bw-status"><span class="ds-skeleton obw-skel-bar obw-skel-bar--status"></span></p>
        <div class="obw-step-actions">
          <button type="button" class="ds-btn ds-btn--secondary" id="obw-bw-refresh-btn">Refresh status</button>
          <button type="button" class="ds-btn ds-btn--primary" id="obw-bw-open-btn">Open Bitwarden</button>
        </div>`)}

      ${_card('step3', 'Step 3 — Access to the app repository', `
        <p class="obw-step-desc">Mission Deck needs a GitLab project token for its own repository — that is where it gets updates. The token is created in GitLab and you paste it into your vault; Mission Deck never stores it.</p>
        <div class="obw-repo-rows" id="obw-tokens-list">${_skelRows(OBW_REQUIRED_TOKENS.length, false)}</div>
        <p class="obw-step-hint">If the vault is already unlocked in step 2 and you see "Missing" here — generate the keys below and paste them into the named vault items. The data repository key is created by the same button; check its state in step 5.</p>
        <p class="obw-step-hint" id="obw-tokens-gate" hidden></p>
        <div class="obw-step-actions">
          <button type="button" class="ds-btn ds-btn--secondary" id="obw-tokens-refresh-btn">Check again</button>
          <button type="button" class="ds-btn ds-btn--primary" id="obw-tokens-create-btn" disabled>Generate keys</button>
        </div>`)}

      ${_card('step4', 'Step 4 — Encryption keys', `
        <p class="obw-step-desc">Team data travels encrypted. Paste the keys in the format <code>repoId=key</code>, one per line.</p>
        <p class="obw-step-hint">Your team admin gives you the keys. <span id="obw-key-ids"><span class="ds-skeleton obw-skel-inline"></span></span></p>
        <textarea class="ds-textarea obw-textarea" id="obw-key-textarea" spellcheck="false" autocomplete="off" placeholder="ds-data=key_base64&#10;data-tier-0=key_base64"></textarea>
        <div class="obw-step-actions">
          <button type="button" class="ds-btn ds-btn--primary" id="obw-key-save-btn">Save keys</button>
        </div>
        <div class="obw-key-error" id="obw-key-error" hidden></div>
        <div class="obw-repo-rows" id="obw-key-state">${_skelKeyRows()}</div>
        <div class="obw-repo-rows" id="obw-key-rows"></div>
        <div class="obw-progress" id="obw-key-progress" hidden>
          <div class="ips-phase-label" id="obw-key-phase">Initializing...</div>
          <div class="ips-bar"><div class="ips-bar-fill" id="obw-key-fill"></div></div>
        </div>
        <div class="obw-repo-rows" id="obw-key-decrypt-rows"></div>`)}

      ${_card('step5', 'Step 5 — Team data', `
        <p class="obw-step-desc">Downloads the team data repository to this computer. The files are decrypted locally and never leave this machine in plain form.</p>
        <div class="obw-repo-rows" id="obw-data-token-list">${_skelRow(false, false)}</div>
        <div class="ds-callout ds-callout--neutral obw-data-state" id="obw-data-state"><span class="ds-skeleton obw-skel-bar obw-skel-bar--callout"></span></div>
        <div class="obw-step-actions">
          <button type="button" class="ds-btn ds-btn--primary" id="obw-data-clone-btn" disabled>Download team data</button>
        </div>`)}

      ${_card('step6', 'Step 6 — Updating Mission Deck', `
        <p class="obw-step-desc">Checks for and installs a newer version. This step is independent of the others — do it any time.</p>
        <div class="obw-step-actions">
          <button type="button" class="ds-btn ds-btn--secondary" id="obw-update-check-btn">Check for updates</button>
        </div>
        <div class="obw-update-result ds-callout ds-callout--neutral" id="obw-update-result"><span class="ds-skeleton obw-skel-bar obw-skel-bar--callout"></span></div>`)}

      ${_card('step7', 'Step 7 — Training', '<div id="obw-step7-body"><p class="obw-step-desc obw-skel-line"><span class="ds-skeleton obw-skel-bar obw-skel-bar--line"></span></p></div>')}
    </div>`;
}

// ── Entry points (view-registry contract) ────────────────────────────────────

/**
 * @param {(id: string) => void} navigate router callback from js/app.js
 */
export function initOnboardingWizard(navigate) {
  _navigate = navigate || null;
  // Registered from init, which app.js calls once per entry, so a re-entry
  // re-registers a fresh closure over the current timer handle.
  registerViewCleanup(VIEW_ID, _stopUpdatePoll);

  if (!_secretsWired) {
    _secretsWired = true;
    // The unlock can be started from the top bar pill while this view is on
    // screen, and then no callback of ours fires. _refreshStep2 repaints steps
    // 2 and 4 and cascades into 3, 5 and 7, so one refresh brings every
    // vault-derived badge along.
    onSecretsChanged(() => {
      const root = document.getElementById('onboarding-wizard-root');
      const view = document.getElementById('view-onboarding-wizard');
      if (root && view && view.classList.contains('active')) _refreshStep2(root);
    });
    // The VPN coming back is the same event one axis over: the clone card
    // stops blaming the network and the update check (step 6) gets an answer.
    onInfraChanged(() => {
      const root = document.getElementById('onboarding-wizard-root');
      const view = document.getElementById('view-onboarding-wizard');
      if (root && view && view.classList.contains('active')) _refreshStep2(root);
    });
  }
}

/** Paint the wizard. Self-fetches every time - the view holds no memory. */
export async function renderOnboardingWizard() {
  const root = document.getElementById('onboarding-wizard-root');
  if (!root) return;

  root.innerHTML = _buildHtml();
  _wireStep1(root);
  _wireStep2(root);
  _wireStep3(root);
  _wireStep4(root);
  _wireStep5(root);
  _wireStep6(root);

  // Five independent probes: fan out, never chain. A slow Bitwarden spawn must
  // not hold up the key file read.
  const [tools, bw, targets, enc, repo] = await Promise.all([
    _getJson('/api/tools/status'),
    _getJson('/api/bitwarden/status?t=' + Date.now()),
    _fetchGitlabTokenTargets(),
    _getJson('/api/settings/encryption-status?t=' + Date.now()),
    _getJson(`/api/data/${OBW_DATA_REPO_ID}/status?t=` + Date.now()),
  ]);
  _toolsStatus = tools;
  _bwStatus = bw;
  _tokenTargets = targets;
  _encStatus = enc;
  _repoStatus = repo;

  _paintStep1(root);
  _paintStep2(root);
  _paintStep4(root);
  _paintStep6(root);

  // The update check is the one probe that reaches GitLab, so it runs after the
  // page is already painted rather than holding the first render.
  _runUpdateCheck(root).catch(() => {});
}
