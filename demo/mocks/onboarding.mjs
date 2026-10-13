// demo/mocks/onboarding.mjs
// "Start here" (js/onboarding-wizard.js): the seven step cards with their
// real headings and classes, plus the pieces a step repaints as it completes.
// Copy follows the real wizard; every address, collection and person in it is
// replaced with a fictitious one.
//
// Full-screen mocks (surface: 'screen') sit next to the wizard: the
// VPN client menu-bar app on a macOS desktop (`vpn-client-screen`, reused
// by the `updates` chapter) and the Bitwarden web vault
// (`bitwarden-vault-screen`, its Send pages). None carries a vendor logo; every
// account and secret in them is an obvious placeholder.

import { esc, icon, repoRow, modalShell } from './common.mjs';

export const STEP_TITLES = [
  'Step 1 — Environment',
  'Step 2 — Bitwarden',
  'Step 3 — Access to the app repository',
  'Step 4 — Encryption keys',
  'Step 5 — Team data',
  'Step 6 — Mission Deck update',
  'Step 7 — Academy',
];

const TOOLS = [
  ['Node.js', 'v22.11.0'], ['npm', '10.9.0'], ['git', '2.47.1'],
  ['Bitwarden CLI', '2025.1.3'], ['Claude Code CLI', '2.1.4'],
];

const KEY_ROWS = [
  { id: 'ds-data', label: 'Team data' },
  { id: 'data-reports', label: 'Team reports' },
  { id: 'data-finance', label: 'Team finance' },
  { id: 'data-new', label: 'New team source' },
];

function chip(stepId, done, pending = 'To do') {
  return `<span class="ds-badge ${done ? 'ds-badge--green' : 'ds-badge--gray'}" id="obw-${stepId}-chip">${done ? 'Done' : esc(pending)}</span>`;
}

function card(stepId, title, body, pending) {
  return `<div class="ds-card obw-step-card" id="obw-${stepId}-card">
      <div class="ds-card-header">
        <span class="ds-card-title">${title}</span>
        ${chip(stepId, false, pending)}
      </div>
      <div class="ds-card-body">${body}</div>
    </div>`;
}

function toolRows(ok) {
  return TOOLS.map(([label, version]) => repoRow({ label: esc(label), badge: ok ? version : 'checking', tone: ok ? 'green' : 'gray' })).join('');
}

function tokenRows(loaded) {
  return repoRow({
    label: 'App repository token',
    badge: loaded ? 'In the vault' : 'Vault locked',
    tone: loaded ? 'green' : 'gray',
    msg: loaded ? '' : 'It is not known yet whether this key is in the vault — unlock it in step 2.',
  });
}

function keyRows(present) {
  return KEY_ROWS.map((r) => {
    const has = present.includes(r.id);
    const gen = r.id === 'data-new' && !has
      ? `<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-obw-gen-key="${esc(r.id)}">Generate a new key</button>`
      : '';
    return repoRow({
      label: `${esc(r.label)} <code>${esc(r.id)}</code>`,
      badge: has ? 'Key present' : 'No key',
      tone: has ? 'green' : 'gray',
      extra: gen,
      msg: has ? '' : `Paste a <code>${esc(r.id)}=key</code> line above and save.`,
    });
  }).join('');
}

function dataTokenRow(loaded) {
  return repoRow({ label: 'Data repository token', badge: loaded ? 'In the vault' : 'Vault locked', tone: loaded ? 'green' : 'gray' });
}

/** The window frame shared by both full-screen mocks: dots, title, body. */
function _window(rootId, rootClass, title, body) {
  return `<div class="onb-screen ${rootClass}" id="${esc(rootId)}">
      <div class="onb-window">
        <div class="onb-window-bar"><span class="onb-window-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="onb-window-title">${esc(title)}</span></div>
        ${body}
      </div>
    </div>`;
}

function _field(id, label, value, { type = 'text', readonly = false, placeholder = '' } = {}) {
  return `<div class="ds-input-wrap"><label class="ds-label" for="${esc(id)}">${esc(label)}</label>
      <input type="${type}" class="ds-input" id="${esc(id)}" value="${esc(value)}"${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}${readonly ? ' readonly' : ''} autocomplete="off"></div>`;
}

// -- VPN client (macOS menu-bar app; layout from the vendor's user guide, no logo) --

/** The portal the autopilot types: the company portal (user's explicit request). */
export const VPN_PORTAL = 'vpn.example.com';
export const VPN_LOGIN = 'alex.morgan';
const VPN_STATES = ['disconnected', 'connecting', 'connected'];

/** Neutral glyphs drawn from simple shapes - never the vendor's logo. */
const GP_GLOBE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 7h14M5 17h14"/></svg>';
const GP_SHIELD_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l8 3v6c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10v-6z" fill="currentColor"/><path class="onb-gp-check" d="M8.2 12.2l2.6 2.6 5-5.2" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const GP_MENU_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>';
const GP_WIFI_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2.5 9a14 14 0 0 1 19 0M5.5 12.5a9.5 9.5 0 0 1 13 0M8.6 16a5 5 0 0 1 6.8 0"/><circle cx="12" cy="19.2" r="1" fill="currentColor"/></svg>';

/** The macOS menu bar with the VPN client status item (#onb-vpn-tray) on the right. */
function _gpMenuBar(on) {
  return `<div class="onb-gp-menubar">
      <span class="onb-gp-menubar-left"><b>Finder</b><span>File</span><span>Edit</span><span>View</span><span>Window</span></span>
      <span class="onb-gp-menubar-right">
        <button type="button" class="onb-gp-tray${on ? ' onb-gp-tray--on' : ''}" id="onb-vpn-tray" aria-label="VPN client" data-tip="${on ? 'Connected' : 'Not Connected'}">${on ? GP_SHIELD_SVG : GP_GLOBE_SVG}</button>
        <span class="onb-gp-menubar-ico">${GP_WIFI_SVG}</span>
        <span>Sun 4 Oct 09:12</span>
      </span>
    </div>`;
}

/** The popover panel (#onb-vpn-card), anchored under the status item. */
function _gpPanel(st, portal, full) {
  let body;
  if (st === 'connected') {
    body = `<div class="onb-gp-status onb-gp-status--on"><span class="onb-gp-big onb-gp-big--on">${GP_SHIELD_SVG}</span>
        <div class="onb-gp-state" id="onb-vpn-status">Connected</div></div>
      <dl class="onb-gp-lines"><dt>Portal</dt><dd>${esc(portal)}</dd><dt>Gateway</dt><dd>Best Available Gateway</dd></dl>
      <div class="onb-gp-foot"><button type="button" class="onb-gp-btn onb-gp-btn--secondary" id="onb-vpn-connect">Disconnect</button></div>`;
  } else if (st === 'connecting') {
    body = `<div class="onb-gp-status"><span class="onb-gp-spinner" aria-hidden="true"></span>
        <div class="onb-gp-state" id="onb-vpn-status">Connecting...</div>
        <div class="onb-gp-sub">Still working...</div></div>
      <dl class="onb-gp-lines"><dt>Portal</dt><dd>${esc(portal)}</dd></dl>
      <div class="onb-gp-track"><div class="onb-gp-fill onb-fill" id="onb-vpn-bar"></div></div>
      <div class="onb-gp-foot"><button type="button" class="onb-gp-btn onb-gp-btn--secondary" id="onb-vpn-connect">Cancel</button></div>`;
  } else if (full) {
    body = `<div class="onb-gp-status"><span class="onb-gp-big">${GP_GLOBE_SVG}</span>
        <div class="onb-gp-state" id="onb-vpn-status">Not Connected</div></div>
      <label class="onb-gp-label" for="onb-vpn-portal">Portal</label>
      <input type="text" class="onb-gp-input" id="onb-vpn-portal" value="${esc(portal)}" autocomplete="off">
      <div class="onb-gp-foot"><button type="button" class="onb-gp-btn" id="onb-vpn-connect">Connect</button></div>`;
  } else {
    body = `<div class="onb-gp-status"><span class="onb-gp-big">${GP_GLOBE_SVG}</span>
        <div class="onb-gp-state" id="onb-vpn-status">Welcome to your VPN</div>
        <div class="onb-gp-sub">Please enter your portal address</div></div>
      <input type="text" class="onb-gp-input" id="onb-vpn-portal" value="" placeholder="Portal address" autocomplete="off">
      <div class="onb-gp-foot"><button type="button" class="onb-gp-btn" id="onb-vpn-connect">Connect</button></div>`;
  }
  return `<div class="onb-gp-panel" id="onb-vpn-card" role="dialog" aria-label="VPN client">
      <div class="onb-gp-head"><span>VPN client</span><button type="button" class="onb-gp-menu" aria-label="Settings">${GP_MENU_SVG}</button></div>
      <div class="onb-gp-body">${body}</div>
    </div>`;
}

/** The SAML sign-in window ("VPN Login") with the neutral company SSO card. */
function _gpLogin(login) {
  return `<div class="onb-gp-login" id="onb-vpn-sso">
      <div class="onb-window-bar"><span class="onb-window-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="onb-window-title">VPN Login</span></div>
      <div class="onb-gp-login-body">
        <div class="ds-card onb-gp-sso-card">
          <div class="ds-card-header"><span class="ds-card-title">Company sign-in (SSO)</span></div>
          <div class="ds-card-body">
            <p class="onb-screen-lead">Sign in with your work account to connect to the company network.</p>
            ${_field('onb-vpn-sso-email', 'Email address', '', { placeholder: `${login}@example.com` })}
            ${_field('onb-vpn-sso-password', 'Password', '', { type: 'password' })}
            <div class="onb-vpn-actions"><button type="button" class="ds-btn ds-btn--primary" id="onb-vpn-sso-submit">Sign in</button></div>
          </div>
        </div>
      </div>
    </div>`;
}

/**
 * vpn-client-screen - the VPN client menu-bar app on a macOS desktop.
 * props API (all optional; `{}` = popover open on first run, empty portal):
 *   state   'disconnected' (default) | 'connecting' | 'connected'
 *   filled  true = the portal is already saved (Not Connected + Connect);
 *           defaults to true for 'connecting' / 'connected'
 *   stage   'menubar' = popover closed, only the status item in the menu bar
 *   sso     true = the "VPN Login" window over the desktop
 *   portal  the portal shown (default vpn.example.com); login = SSO account hint
 * Stable ids: #onb-vpn-screen (root, swap with show mode 'outer'), #onb-vpn-tray
 * (status item), #onb-vpn-card (popover), #onb-vpn-portal, #onb-vpn-connect
 * (Connect / Cancel / Disconnect), #onb-vpn-status, #onb-vpn-bar (progress fill,
 * driven by `progress { bar, pct }`), #onb-vpn-sso, #onb-vpn-sso-email,
 * #onb-vpn-sso-password, #onb-vpn-sso-submit. Shared with `updates`.
 */
function _vpnScreen({ state = 'disconnected', login = VPN_LOGIN, filled, stage = '', sso = false, portal = VPN_PORTAL } = {}) {
  const st = VPN_STATES.includes(state) ? state : 'disconnected';
  const full = filled === undefined ? st !== 'disconnected' : !!filled;
  const on = st === 'connected';
  return `<div class="onb-screen onb-gp" id="onb-vpn-screen">
      ${_gpMenuBar(on)}
      ${stage === 'menubar' ? '' : _gpPanel(st, portal, full)}
      ${sso ? _gpLogin(login) : ''}
    </div>`;
}

// -- Bitwarden vault (the web vault's layout and palette, no logo graphic) --
// Mirrors the current Bitwarden web app: a dark-blue product nav on the left,
// the "Vaults" page with a filter panel and an items table, a bit-dialog for
// a new item and a success toast. The wordmark is plain text, never the logo.

/**
 * The person's own collection: the Mission Deck maintainer prepares it, names it
 * after the person and shares it with them. Nobody creates it themselves.
 */
export const BW_COLLECTION = 'alex-morgan';
export const BW_EMAIL = 'alex.morgan@example.com';
/** The fictitious organisation that owns the team collection. */
export const BW_ORG = 'Example Org Ltd';
/**
 * The ONE secure note in the person's collection. Its notes field holds every
 * token as a KEY=VALUE line - the server's multi-key format (_loadBwCollectionTokens,
 * _bwNoteAssignments). Keys are env names from BW_DIRECT_ENV_KEYS.
 */
export const BW_KEYS_NOTE = 'COCKPIT-KEYS';
/** The starter lines the maintainer pastes into the note (what "Copy item" copies). */
export const BW_START_LINES = [
  'COCKPIT_APP_TOKEN=glpat-DEMO••••••',
  'COCKPIT_DATA_TOKEN=glpat-DEMO••••••',
  'COCKPIT_MODULES_TOKEN=glpat-DEMO••••••',
  'COCKPIT_DATA_EXTRA_0_TOKEN=glpat-DEMO••••••',
  'COCKPIT_DATA_EXTRA_1_TOKEN=glpat-DEMO••••••',
  'COCKPIT_DATA_EXTRA_4_TOKEN=glpat-DEMO••••••',
];
/** The personal lines the person appends herself. */
export const BW_PERSONAL_LINES = [
  'FIGMA_TOKEN=figd_DEMO••••••',
  'JIRA_TOKEN=DEMO-jira••••••',
  'CONFLUENCE_TOKEN=DEMO••••••',
];
/** What the cockpit loads on unlock: one token per line of the note. */
export const BW_LOADED_COUNT = BW_START_LINES.length + BW_PERSONAL_LINES.length;
/** The encryption key lines a person receives in a one-time Send (placeholders). */
export const BW_KEY_LINES = 'ds-data=DEMO…\ndata-reports=DEMO…\ndata-finance=DEMO…';

/** Generic eye glyph (show / hide password); the DS icon set has none. */
const BW_CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.8 2.8L16 10"/></svg>';
const BW_EYE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="16" height="16" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';

function _bwIcon(slug, extra = '') { return icon(slug, 'onb-bwv-ico' + (extra ? ' ' + extra : '')); }

/** A bit-form-field: label above, bordered input, optional suffix icon buttons. */
function _bwField(id, label, value, { type = 'text', readonly = false, placeholder = '', suffix = '', hint = '' } = {}) {
  return `<div class="onb-bwv-field"><label class="onb-bwv-label" for="${esc(id)}">${esc(label)}</label>
      <div class="onb-bwv-control"><input type="${type}" class="onb-bwv-input" id="${esc(id)}" value="${esc(value)}"${placeholder ? ` placeholder="${esc(placeholder)}"` : ''}${readonly ? ' readonly' : ''} autocomplete="off">${suffix}</div>
      ${hint ? `<div class="onb-bwv-hint">${esc(hint)}</div>` : ''}</div>`;
}

/** A read-only select look (bit-select): value plus a chevron. */
function _bwSelect(id, label, value) {
  return `<div class="onb-bwv-field"><label class="onb-bwv-label" for="${esc(id)}">${esc(label)}</label>
      <div class="onb-bwv-control onb-bwv-control--select"><input type="text" class="onb-bwv-input" id="${esc(id)}" value="${esc(value)}" readonly>${_bwIcon('16-ic-chevron-bottom', 'onb-bwv-suffix-ico')}</div></div>`;
}

function _bwIconBtn(label, inner) {
  return `<button type="button" class="onb-bwv-icon-btn" aria-label="${esc(label)}" title="${esc(label)}">${inner}</button>`;
}

function _bwRows(items) {
  if (!items.length) {
    return `<div class="onb-bwv-empty"><strong>There are no items to list</strong>
        <span>This collection is still empty. Add the first item with the “New” button.</span></div>`;
  }
  return items.map((n) => {
    return `<div class="onb-bwv-row" data-onb-item="${esc(n)}">
        <span class="onb-bwv-check" aria-hidden="true"></span>
        <span class="onb-bwv-row-kind">${_bwIcon('16-ic-file')}</span>
        <span class="onb-bwv-row-main"><span class="onb-bwv-row-name">${esc(n)}</span>
          <span class="onb-bwv-row-desc">Secure note · Mission Deck keys, KEY=value lines</span></span>
        <span class="onb-bwv-owner">${esc(BW_ORG)}</span>
        ${_bwIconBtn('Options', _bwIcon('16-ic-context-menu-vertical'))}
      </div>`;
  }).join('');
}

/** The new-item bit-dialog with its backdrop, painted into #onb-bwv-detail. */
function _bwForm({ kind = 'login', collection = BW_COLLECTION, placeholder = '', name = '', lines = [] } = {}) {
  const note = kind === 'note';
  const edit = lines.length > 0;
  // Edit mode: the existing lines sit above an empty textarea in ONE bordered
  // field, so the autopilot types only what it appends (type replaces a value).
  const notesField = edit
    ? `<div class="onb-bwv-notes-box"><pre class="onb-bwv-notes-old">${esc(lines.join('\n'))}</pre><textarea class="onb-bwv-input onb-bwv-note onb-bwv-note--append" id="onb-bwv-note" spellcheck="false"></textarea></div>`
    : '<textarea class="onb-bwv-input onb-bwv-note" id="onb-bwv-note" spellcheck="false"></textarea>';
  const pwdSuffix = `<span class="onb-bwv-suffix">${_bwIconBtn('Show password', BW_EYE_SVG)}${_bwIconBtn('Copy password', _bwIcon('16-ic-copy'))}${_bwIconBtn('Generate password', _bwIcon('16-ic-refresh'))}</span>`;
  const credentials = note
    ? `<section class="onb-bwv-section"><h3 class="onb-bwv-section-title">Additional options</h3>
        <div class="onb-bwv-section-card"><div class="onb-bwv-field"><label class="onb-bwv-label" for="onb-bwv-note">Notes</label>
          ${notesField}</div></div></section>`
    : `<section class="onb-bwv-section"><h3 class="onb-bwv-section-title">Login credentials</h3>
        <div class="onb-bwv-section-card">
          ${_bwField('onb-bwv-user', 'Username', 'mission-deck')}
          ${_bwField('onb-bwv-value', 'Password', '', { placeholder: 'paste the token', suffix: pwdSuffix })}
        </div></section>`;
  const title = edit ? 'Edit secure note' : (note ? 'New secure note' : 'New login');
  return `<div class="onb-bwv-backdrop" aria-hidden="true"></div>
    <div class="onb-bwv-dialog" id="onb-bwv-form" role="dialog" aria-label="${title}">
      <div class="onb-bwv-dialog-head"><h2 class="onb-bwv-dialog-title">${title}</h2>
        ${_bwIconBtn('Close', _bwIcon('16-ic-cross'))}</div>
      <div class="onb-bwv-dialog-body">
        <section class="onb-bwv-section"><h3 class="onb-bwv-section-title">Item details</h3>
          <div class="onb-bwv-section-card onb-bwv-grid2">
            ${_bwField('onb-bwv-name', 'Item name (required)', name, { placeholder: placeholder || (note ? 'e.g. COCKPIT-KEYS' : 'e.g. COCKPIT-APP') })}
            ${_bwSelect('onb-bwv-folder', 'Folder', 'No folder')}
          </div></section>
        ${credentials}
        <section class="onb-bwv-section"><h3 class="onb-bwv-section-title">Ownership</h3>
          <div class="onb-bwv-section-card onb-bwv-grid2">
            ${_bwSelect('onb-bwv-org', 'Organization', BW_ORG)}
            <div class="onb-bwv-field"><label class="onb-bwv-label" for="onb-bwv-collection">Collections</label>
              <div class="onb-bwv-control onb-bwv-control--chips"><span class="onb-bwv-chip">${esc(collection)}</span><input type="hidden" id="onb-bwv-collection" value="${esc(collection)}"></div></div>
          </div></section>
      </div>
      <div class="onb-bwv-dialog-foot"><button type="button" class="onb-bwv-btn onb-bwv-btn--primary" id="onb-bwv-save">Save</button>
        <button type="button" class="onb-bwv-btn onb-bwv-btn--secondary">Cancel</button></div>
    </div>`;
}

/** A saved secure note opened read-only (the maintainer's key lines), into #onb-bwv-detail. */
function _bwView({ name = BW_KEYS_NOTE, lines = BW_START_LINES } = {}) {
  return `<div class="onb-bwv-backdrop" aria-hidden="true"></div>
    <div class="onb-bwv-dialog" id="onb-bwv-view" role="dialog" aria-label="${esc(name)}">
      <div class="onb-bwv-dialog-head"><h2 class="onb-bwv-dialog-title">${esc(name)}</h2>
        ${_bwIconBtn('Close', _bwIcon('16-ic-cross'))}</div>
      <div class="onb-bwv-dialog-body">
        <section class="onb-bwv-section"><h3 class="onb-bwv-section-title">Notes</h3>
          <div class="onb-bwv-section-card"><div class="onb-bwv-field"><label class="onb-bwv-label" for="onb-bwv-view-notes">Notes</label>
            <textarea class="onb-bwv-input onb-bwv-note onb-bwv-note--tall" id="onb-bwv-view-notes" readonly>${esc(lines.join('\n'))}</textarea></div></div></section>
        <section class="onb-bwv-section"><h3 class="onb-bwv-section-title">Ownership</h3>
          <div class="onb-bwv-section-card onb-bwv-grid2">
            ${_bwSelect('onb-bwv-view-org', 'Organization', BW_ORG)}
            <div class="onb-bwv-field"><span class="onb-bwv-label">Collections</span>
              <div class="onb-bwv-control onb-bwv-control--chips"><span class="onb-bwv-chip">${esc(BW_COLLECTION)}</span></div></div>
          </div></section>
      </div>
      <div class="onb-bwv-dialog-foot"><button type="button" class="onb-bwv-btn onb-bwv-btn--primary" id="onb-bwv-edit">Edit</button>
        <button type="button" class="onb-bwv-btn onb-bwv-btn--secondary">Close</button></div>
    </div>`;
}

/** The dialog closes; a bit-toast reports the save, painted into #onb-bwv-detail. */
function _bwSaved({ name = BW_KEYS_NOTE, collection = BW_COLLECTION, text = '' } = {}) {
  return `<div class="onb-bwv-toast" id="onb-bwv-toast" role="status">
      <span class="onb-bwv-toast-ico">${BW_CHECK_SVG}</span>
      <div class="onb-bwv-toast-text"><strong>Success</strong><span>${text ? esc(text) : `Item “${esc(name)}” saved in collection ${esc(collection)}.`}</span></div>
      ${_bwIconBtn('Close', _bwIcon('16-ic-cross'))}
      <span class="onb-bwv-toast-bar" aria-hidden="true"></span>
    </div>`;
}

/** The "+ New" dropdown (bit-menu) under the button, painted into #onb-bwv-detail. */
const BW_NEW_MENU = [
  ['login', 'Login', '16-ic-locked'], ['card', 'Card', '16-ic-money'], ['identity', 'Identity', '16-ic-user'],
  ['note', 'Note', '16-ic-file'], ['ssh', 'SSH key', '16-ic-shield'],
];
function _bwMenu() {
  const items = BW_NEW_MENU.map(([id, label, slug]) => `<button type="button" class="onb-bwv-menu-item" id="onb-bwv-new-${id}" role="menuitem">${_bwIcon(slug)}<span>${esc(label)}</span></button>`).join('');
  return `<div class="onb-bwv-menu" id="onb-bwv-menu" role="menu" aria-label="New">${items}
      <div class="onb-bwv-menu-sep" role="separator"></div>
      <button type="button" class="onb-bwv-menu-item" role="menuitem">${_bwIcon('16-ic-folder')}<span>Folder</span></button>
      <button type="button" class="onb-bwv-menu-item" id="onb-bwv-new-collection" role="menuitem">${_bwIcon('16-ic-files')}<span>Collection</span></button>
    </div>`;
}

/** A bit-dialog shell with backdrop: title, optional tabs, body sections, footer. */
function _bwDialog(id, title, body, foot, tabs = null) {
  const tabBar = tabs
    ? `<div class="onb-bwv-tabs" role="tablist">${tabs.map(([label, on]) => `<span class="onb-bwv-tab${on ? ' onb-bwv-tab--active' : ''}" role="tab" aria-selected="${on ? 'true' : 'false'}">${esc(label)}</span>`).join('')}</div>`
    : '';
  return `<div class="onb-bwv-backdrop" aria-hidden="true"></div>
    <div class="onb-bwv-dialog" id="${esc(id)}" role="dialog" aria-label="${esc(title)}">
      <div class="onb-bwv-dialog-head"><h2 class="onb-bwv-dialog-title">${esc(title)}</h2>
        ${_bwIconBtn('Close', _bwIcon('16-ic-cross'))}</div>
      ${tabBar}
      <div class="onb-bwv-dialog-body">${body}</div>
      <div class="onb-bwv-dialog-foot">${foot}</div>
    </div>`;
}

function _bwSection(title, inner, grid = false) {
  return `<section class="onb-bwv-section"><h3 class="onb-bwv-section-title">${esc(title)}</h3>
      <div class="onb-bwv-section-card${grid ? ' onb-bwv-grid2' : ''}">${inner}</div></section>`;
}

function _bwCheckbox(label, on, hint = '') {
  return `<label class="onb-bwv-remember onb-bwv-checkline"><span class="onb-bwv-check${on ? ' onb-bwv-check--on' : ''}" aria-hidden="true"></span><span>${esc(label)}${hint ? `<small class="onb-bwv-hint">${esc(hint)}</small>` : ''}</span></label>`;
}

/** "New collection" (Admin Console), into #onb-bwv-detail. */
function _bwCollForm() {
  const body = _bwSection('Collection info', `
      ${_bwField('onb-bwv-coll-name', 'Name (required)', '', { placeholder: 'e.g. first-last' })}
      ${_bwSelect('onb-bwv-coll-org', 'Organization', BW_ORG)}
      ${_bwSelect('onb-bwv-coll-parent', 'Nest collection under', 'None')}`);
  const foot = `<button type="button" class="onb-bwv-btn onb-bwv-btn--primary" id="onb-bwv-coll-save">Save</button>
      <button type="button" class="onb-bwv-btn onb-bwv-btn--secondary">Cancel</button>`;
  return _bwDialog('onb-bwv-coll-form', 'New collection', body, foot, [['Info', true], ['Access', false]]);
}

/**
 * The collection's "Access" tab: who may open it and with which permission,
 * into #onb-bwv-detail. props: { collection, members: [{ name, email, initials, you }] }.
 * Ids: #onb-bwv-access, #onb-bwv-access-input, #onb-bwv-access-remove-<initials>, #onb-bwv-access-save.
 */
function _bwAccess({ collection = BW_COLLECTION, members = [] } = {}) {
  const rows = members.map((m) => `<div class="onb-bwv-member" data-onb-member="${esc(m.email)}">
        <span class="onb-bwv-avatar">${esc(m.initials)}</span>
        <span class="onb-bwv-row-main"><span class="onb-bwv-member-name">${esc(m.name)}${m.you ? ' <em class="onb-bwv-filter-badge">You</em>' : ''}</span><span class="onb-bwv-row-desc">${esc(m.email)}</span></span>
        <span class="onb-bwv-control onb-bwv-control--select onb-bwv-perm"><span>Can manage</span>${_bwIcon('16-ic-chevron-bottom', 'onb-bwv-suffix-ico')}</span>
        <button type="button" class="onb-bwv-icon-btn" id="onb-bwv-access-remove-${esc(String(m.initials).toLowerCase())}" aria-label="Remove access: ${esc(m.name)}" title="Remove access">${_bwIcon('16-ic-cross')}</button>
      </div>`).join('');
  const body = _bwSection('Access', `
      ${_bwField('onb-bwv-access-input', 'Select groups or people', '', { placeholder: 'Enter an email address' })}
      <div class="onb-bwv-members-head"><span>Person</span><span>Permission</span></div>
      <div class="onb-bwv-members" id="onb-bwv-members">${rows || '<p class="onb-bwv-hint">Nobody has access to this collection yet.</p>'}</div>`);
  const foot = `<button type="button" class="onb-bwv-btn onb-bwv-btn--primary" id="onb-bwv-access-save">Save</button>
      <button type="button" class="onb-bwv-btn onb-bwv-btn--secondary">Cancel</button>`;
  return _bwDialog('onb-bwv-access', `Edit collection ${collection}`, body, foot, [['Info', false], ['Access', true]]);
}

/** The Send page's "New" dropdown, into #onb-bwv-detail. Ids #onb-bwv-send-new-text|file. */
function _bwSendMenu() {
  return `<div class="onb-bwv-menu onb-bwv-menu--send" id="onb-bwv-menu" role="menu" aria-label="New Send">
      <button type="button" class="onb-bwv-menu-item" id="onb-bwv-send-new-text" role="menuitem">${_bwIcon('16-ic-file')}<span>Text</span></button>
      <button type="button" class="onb-bwv-menu-item" id="onb-bwv-send-new-file" role="menuitem">${_bwIcon('16-ic-attachment')}<span>File</span></button>
    </div>`;
}

/**
 * "New Send" (text), into #onb-bwv-detail. Ids: #onb-bwv-send-form,
 * #onb-bwv-send-name, #onb-bwv-send-text, #onb-bwv-send-pass, #onb-bwv-send-save.
 */
function _bwSendForm() {
  const details = _bwSection('Send details', `
      ${_bwField('onb-bwv-send-name', 'Name (required)', '', { placeholder: 'e.g. Encryption keys for Robin' })}
      <div class="onb-bwv-field"><label class="onb-bwv-label" for="onb-bwv-send-text">Text to share</label>
        <textarea class="onb-bwv-input onb-bwv-note onb-bwv-note--short" id="onb-bwv-send-text" spellcheck="false"></textarea></div>
      <div class="onb-bwv-grid2">
        ${_bwSelect('onb-bwv-send-delete', 'Deletion date', 'In 7 days')}
        ${_bwCheckbox('Hide text by default', true, 'The recipient reveals it.')}
      </div>`);
  const options = _bwSection('Additional options', `
      ${_bwField('onb-bwv-send-pass', 'Password (optional)', '', { type: 'password' })}
      ${_bwField('onb-bwv-send-max', 'Maximum access count', '1')}`, true);
  const foot = `<button type="button" class="onb-bwv-btn onb-bwv-btn--primary" id="onb-bwv-send-save">Save</button>
      <button type="button" class="onb-bwv-btn onb-bwv-btn--secondary">Cancel</button>`;
  return _bwDialog('onb-bwv-send-form', 'New text Send', details + options, foot);
}

/** Rows of the Send list, into #onb-bwv-sends. props: { sends: [{ name, deletion }] }. Copy button #onb-bwv-send-copy. */
function _bwSendRows(sends = []) {
  if (!sends.length) {
    return `<div class="onb-bwv-empty"><strong>There are no Sends to list</strong>
        <span>Use Send to share encrypted text or a file securely with one person.</span></div>`;
  }
  return sends.map((x, i) => `<div class="onb-bwv-row onb-bwv-send-row" data-onb-send="${esc(x.name)}">
        <span class="onb-bwv-row-kind">${_bwIcon('16-ic-file')}</span>
        <span class="onb-bwv-row-main"><span class="onb-bwv-row-name">${esc(x.name)}</span>
          <span class="onb-bwv-row-desc">Text · max. 1 view · text hidden</span></span>
        <span class="onb-bwv-row-desc">${esc(x.deletion || '')}</span>
        <button type="button" class="onb-bwv-btn onb-bwv-btn--secondary onb-bwv-btn--sm"${i === 0 ? ' id="onb-bwv-send-copy"' : ''}>${_bwIcon('16-ic-link')}Copy link</button>
        ${_bwIconBtn('Options', _bwIcon('16-ic-context-menu-vertical'))}
      </div>`).join('');
}

/**
 * bitwarden-send-view - the page a recipient opens from a Send link.
 * props: { name, text, revealed, deletion }. Ids: #onb-bwv-sendview (root),
 * #onb-bwv-sv-card, #onb-bwv-sv-reveal, #onb-bwv-sv-text, #onb-bwv-sv-copy.
 */
function _sendViewScreen({ name = 'Encryption keys', text = BW_KEY_LINES, revealed = false, deletion = '11.10.2026' } = {}) {
  const value = revealed
    ? `<textarea class="onb-bwv-input onb-bwv-note" id="onb-bwv-sv-text" readonly>${esc(text)}</textarea>`
    : '<div class="onb-bwv-sv-hidden" id="onb-bwv-sv-text">••••••••••••••••••••••••</div>';
  const body = `<div class="onb-bwv-auth">
      <div class="onb-bwv-auth-top"><span class="onb-bwv-word">bitwarden</span> <span class="onb-bwv-sv-product">Send</span></div>
      <div class="onb-bwv-auth-icon">${_bwIcon('24-ic-locked')}</div>
      <h1 class="onb-bwv-auth-title">Someone shared a Send with you</h1>
      <div class="onb-bwv-auth-card onb-bwv-sv-card" id="onb-bwv-sv-card">
        <div class="onb-bwv-sv-name">${esc(name)}</div>
        <div class="onb-bwv-field"><span class="onb-bwv-label">Text</span>${value}</div>
        <div class="onb-bwv-sv-actions">
          <button type="button" class="onb-bwv-btn onb-bwv-btn--secondary" id="onb-bwv-sv-reveal">${revealed ? 'Hide text' : 'Show text'}</button>
          <button type="button" class="onb-bwv-btn onb-bwv-btn--primary" id="onb-bwv-sv-copy">${_bwIcon('16-ic-copy', 'onb-bwv-ico--on-primary')}Copy text</button>
        </div>
        <p class="onb-bwv-hint">This Send will be deleted on ${esc(deletion)}. ${revealed ? 'That was the only allowed view — the link no longer works.' : 'It can be viewed only once.'}</p>
      </div>
      <p class="onb-bwv-auth-server">Bitwarden Send transmits sensitive data in encrypted form.</p>
    </div>`;
  return _window('onb-bwv-sendview', 'onb-bwv onb-bwv--login', 'Bitwarden Send', body);
}

function _bwNavItem(label, slug, { active = false, group = false, id = '' } = {}) {
  return `<span class="onb-bwv-nav-item${active ? ' onb-bwv-nav-item--active' : ''}"${id ? ` id="${esc(id)}"` : ''}>${_bwIcon(slug, 'onb-bwv-nav-ico')}<span class="onb-bwv-nav-text">${esc(label)}</span>${group ? _bwIcon('16-ic-chevron-bottom', 'onb-bwv-nav-ico onb-bwv-nav-chev') : ''}</span>`;
}

function _bwFilter(label, slug, { active = false, id = '', badge = '' } = {}) {
  const cls = `onb-bwv-filter${active ? ' onb-bwv-filter--active' : ''}`;
  const inner = `${_bwIcon(slug)}<span>${esc(label)}</span>${badge ? `<em class="onb-bwv-filter-badge" title="Shared with you by the Mission Deck maintainer">${esc(badge)}</em>` : ''}`;
  return id
    ? `<button type="button" class="${cls}" id="${esc(id)}">${inner}</button>`
    : `<span class="${cls}">${inner}</span>`;
}

/**
 * bitwarden-vault-screen - props: { view: 'login'|'vault', step: 'email'|'password',
 * email, collection: boolean, items: [name] }. Default `{}` = sign-in page 1
 * (e-mail). Ids: #onb-bwv-screen (root, swap with show mode 'outer'),
 * #onb-bwv-login-card, #onb-bwv-email, #onb-bwv-continue, #onb-bwv-sso (page 1),
 * #onb-bwv-master, #onb-bwv-login (page 2), #onb-bwv-coll, #onb-bwv-new,
 * #onb-bwv-items, #onb-bwv-detail (an empty overlay slot: the "New" menu,
 * the dialog and the toast are painted into it), #onb-bwv-toast.
 */
function _vaultScreen({
  view = 'login', step = 'email', email = BW_EMAIL, collection = false,
  items = [BW_KEYS_NOTE],
  collectionName = BW_COLLECTION, collections = null, shared = true, initials = 'AM',
  page = 'vault', sends = [], accessBtn = false,
} = {}) {
  if (view !== 'vault') {
    // Two pages, as in the real web vault: e-mail first, then the master password.
    const card = step === 'password'
      ? `<div class="onb-bwv-auth-card" id="onb-bwv-login-card">
          <div class="onb-bwv-account"><span class="onb-bwv-avatar">AM</span><span class="onb-bwv-account-mail">${esc(email)}</span></div>
          ${_bwField('onb-bwv-master', 'Master password (required)', '', { type: 'password', suffix: `<span class="onb-bwv-suffix">${_bwIconBtn('Show password', BW_EYE_SVG)}</span>`, hint: 'You sign in through the company SSO; the master password decrypts the vault.' })}
          <button type="button" class="onb-bwv-btn onb-bwv-btn--primary onb-bwv-btn--block" id="onb-bwv-login">Log in with master password</button>
          <div class="onb-bwv-or">or</div>
          <button type="button" class="onb-bwv-btn onb-bwv-btn--secondary onb-bwv-btn--block">Log in with device</button>
          <p class="onb-bwv-auth-link">Forgot master password? <span>Get a hint</span></p>
        </div>`
      : `<div class="onb-bwv-auth-card" id="onb-bwv-login-card">
          ${_bwField('onb-bwv-email', 'Email address (required)', '', { placeholder: 'first.last@example.com' })}
          <label class="onb-bwv-remember"><span class="onb-bwv-check onb-bwv-check--on" aria-hidden="true"></span>Remember email</label>
          <button type="button" class="onb-bwv-btn onb-bwv-btn--primary onb-bwv-btn--block" id="onb-bwv-continue">Continue</button>
          <div class="onb-bwv-or">or</div>
          <button type="button" class="onb-bwv-btn onb-bwv-btn--secondary onb-bwv-btn--block" id="onb-bwv-sso">${_bwIcon('16-ic-key-enter')}Use single sign-on</button>
        </div>`;
    const body = `<div class="onb-bwv-auth">
        <div class="onb-bwv-auth-top"><span class="onb-bwv-word">bitwarden</span></div>
        <div class="onb-bwv-auth-icon">${_bwIcon('24-ic-locked')}</div>
        <h1 class="onb-bwv-auth-title">${step === 'password' ? 'Your master password' : 'Log in to Bitwarden'}</h1>
        ${card}
        <p class="onb-bwv-auth-server">Logging in on: <strong>vault.example.test</strong></p>
      </div>`;
    return _window('onb-bwv-screen', 'onb-bwv onb-bwv--login', 'Log in | Bitwarden Web Vault', body);
  }
  const send = page === 'send';
  const title = send ? 'Send' : (collection ? collectionName : 'All vaults');
  const empty = `<div class="onb-bwv-empty"><strong>There are no items to list</strong>
      <span>Your personal vault is empty. The tokens are in the ${esc(collectionName)} collection.</span></div>`;
  const collList = (collections || [collectionName]).map((c) => _bwFilter(c, '16-ic-files', {
    active: collection && c === collectionName,
    id: c === collectionName ? 'onb-bwv-coll' : '',
    badge: shared && c === collectionName ? 'Shared' : '',
  })).join('');
  const crumb = send ? '' : (collection ? `<span class="onb-bwv-crumb">${esc(BW_ORG)} · Collections${shared ? ' · shared with you' : ''}</span>` : '');
  const newBtn = send
    ? `<button type="button" class="onb-bwv-btn onb-bwv-btn--primary" id="onb-bwv-send-new">${_bwIcon('16-ic-add', 'onb-bwv-ico--on-primary')}New${_bwIcon('16-ic-chevron-bottom', 'onb-bwv-ico--on-primary')}</button>`
    : `<button type="button" class="onb-bwv-btn onb-bwv-btn--primary" id="onb-bwv-new">${_bwIcon('16-ic-add', 'onb-bwv-ico--on-primary')}New${_bwIcon('16-ic-chevron-bottom', 'onb-bwv-ico--on-primary')}</button>`;
  const access = !send && collection && accessBtn
    ? `<button type="button" class="onb-bwv-btn onb-bwv-btn--secondary" id="onb-bwv-coll-access">${_bwIcon('16-ic-user')}Access</button>` : '';
  const content = send
    ? `<div class="onb-bwv-content onb-bwv-content--single">
          <div class="onb-bwv-table" role="table" aria-label="Sendy">
            <div class="onb-bwv-thead onb-bwv-thead--send" role="row"><span></span><span>Name</span><span>Deletion date</span><span></span><span></span></div>
            <div class="onb-bwv-items" id="onb-bwv-sends">${_bwSendRows(sends)}</div>
          </div>
        </div>`
    : null;
  const body = `<div class="onb-bwv-app">
      <nav class="onb-bwv-nav" aria-label="Vault navigation">
        <div class="onb-bwv-brand"><span class="onb-bwv-word">bitwarden</span><span class="onb-bwv-product">Password Manager</span></div>
        <div class="onb-bwv-nav-list">
          ${_bwNavItem('Vaults', '16-ic-locked', { active: !send, id: 'onb-bwv-nav-vault' })}
          ${_bwNavItem('Send', '16-ic-upload', { active: send, id: 'onb-bwv-nav-send' })}
          ${_bwNavItem('Tools', '16-ic-tweak-horizontal', { group: true })}
          <span class="onb-bwv-nav-item onb-bwv-nav-item--sub">Generator</span>
          <span class="onb-bwv-nav-item onb-bwv-nav-item--sub">Import data</span>
          <span class="onb-bwv-nav-item onb-bwv-nav-item--sub">Export vault</span>
          ${_bwNavItem('Reports', '16-ic-reports')}
          ${_bwNavItem('Settings', '16-ic-settings', { group: true })}
        </div>
        <div class="onb-bwv-nav-foot">
          <span class="onb-bwv-nav-item">${_bwIcon('16-ic-shop-managing', 'onb-bwv-nav-ico')}<span class="onb-bwv-nav-text">Admin Console</span></span>
        </div>
      </nav>
      <section class="onb-bwv-main" id="onb-bwv-main">
        <header class="onb-bwv-head">
          <div class="onb-bwv-head-titles">
            ${crumb}
            <h1 class="onb-bwv-title">${esc(title)}</h1>
          </div>
          <div class="onb-bwv-head-actions">
            ${access}${newBtn}
            <span class="onb-bwv-avatar" title="${esc(email)}">${esc(initials)}</span>
          </div>
        </header>
        ${content || `<div class="onb-bwv-content">
          <aside class="onb-bwv-filters" aria-label="Filters">
            <div class="onb-bwv-search">${_bwIcon('16-ic-search')}<span>Search vault</span></div>
            <div class="onb-bwv-filter-head">Vaults</div>
            ${_bwFilter('My vault', '16-ic-user')}
            ${_bwFilter(BW_ORG, '16-ic-shop')}
            <div class="onb-bwv-filter-head">Items</div>
            ${_bwFilter('All items', '16-ic-files', { active: !collection })}
            ${_bwFilter('Favorites', '16-ic-star-simple')}
            <div class="onb-bwv-filter-head">Types</div>
            ${_bwFilter('Login', '16-ic-locked')}
            ${_bwFilter('Card', '16-ic-money')}
            ${_bwFilter('Identity', '16-ic-user')}
            ${_bwFilter('Secure note', '16-ic-file')}
            <div class="onb-bwv-filter-head">Folders</div>
            ${_bwFilter('No folder', '16-ic-folder')}
            <div class="onb-bwv-filter-head">Collections</div>
            ${collList}
            ${_bwFilter('Trash', '16-ic-trashcan')}
          </aside>
          <div class="onb-bwv-table" role="table" aria-label="Items">
            <div class="onb-bwv-thead" role="row"><span class="onb-bwv-check" aria-hidden="true"></span><span></span>
              <span>Name</span><span>Owner</span><span></span></div>
            <div class="onb-bwv-items" id="onb-bwv-items">${items.length || collection ? _bwRows(items) : empty}</div>
          </div>
        </div>`}
      </section>
      <div class="onb-bwv-detail" id="onb-bwv-detail"></div>
    </div>`;
  return _window('onb-bwv-screen', 'onb-bwv onb-bwv--vault', `${send ? 'Send' : 'Vaults'} | Bitwarden Web Vault`, body);
}

export const MOCKS = {
  'onboarding-wizard': () => `<div class="obw-wrap">
      <div class="obw-hero">
        <img class="obw-mascot" src="/assets/mascot/pip-success.svg" alt="">
        <img class="obw-mascot" src="/assets/mascot/pip-wave.svg" alt="">
        <img class="obw-mascot" src="/assets/mascot/pip-success.svg" alt="">
      </div>
      <div class="page-header obw-header">
        <div class="page-header-row">
          <div>
            <h1>Welcome to the Mission Deck community</h1>
            <div class="subtitle">Let’s set up your Mission Deck in seven steps. The order is a hint, not a rule — every step checks on its own whether it is already done.</div>
          </div>
        </div>
      </div>
      ${card('step1', STEP_TITLES[0], `
        <p class="obw-step-desc">The tools Mission Deck cannot run without. The full list of the eleven things checked, with their installers, is in Settings.</p>
        <div class="obw-repo-rows" id="obw-tools-list">${toolRows(false)}</div>
        <div class="obw-step-actions">
          <button type="button" class="ds-btn ds-btn--secondary" id="obw-tools-refresh-btn">Check again</button>
          <button type="button" class="ds-btn ds-btn--secondary" id="obw-tools-open-btn">Open Tools</button>
        </div>`)}
      ${card('step2', STEP_TITLES[1], `
        <p class="obw-step-desc">All the access keys live in the company Bitwarden vault. This app never writes them to disk.</p>
        <div class="obw-bw-instructions">
          <div class="obw-bw-instr-step"><span class="obw-bw-instr-num">1</span><div><strong>Install the Bitwarden CLI</strong><p>Settings › Tools › “Install” — or ask Claude: “install the Bitwarden CLI”.</p></div></div>
          <div class="obw-bw-instr-step"><span class="obw-bw-instr-num">2</span><div><strong>Configure the server and sign in with SSO</strong><p>Ask Claude: “connect the Bitwarden CLI to the vault.example.test vault and sign me in with SSO” — it runs the commands itself.</p></div></div>
          <div class="obw-bw-instr-step"><span class="obw-bw-instr-num">3</span><div><strong>Ask for access to a collection</strong><p>Contact the Mission Deck maintainer — they prepare a collection named after you (e.g. <strong>first-last</strong>) with the starter tokens and share it with you. You add your own tokens (Figma, Jira, Confluence) yourself afterwards.</p></div></div>
          <div class="obw-bw-instr-step"><span class="obw-bw-instr-num">4</span><div><strong>Unlock the vault here</strong><p>The button below opens a window where you enter the collection name and the master password.</p></div></div>
        </div>
        <p class="obw-bw-status obw-bw-status--pending" id="obw-bw-status">CLI installed · server configured · vault locked</p>
        <div class="obw-step-actions">
          <button type="button" class="ds-btn ds-btn--secondary" id="obw-bw-refresh-btn">Refresh status</button>
          <button type="button" class="ds-btn ds-btn--primary" id="obw-bw-open-btn">Open Bitwarden</button>
        </div>`)}
      ${card('step3', STEP_TITLES[2], `
        <p class="obw-step-desc">Mission Deck needs a GitLab project key for its own repository — that is where it gets updates from. The key is created in GitLab and you paste it into your vault; Mission Deck never stores it anywhere.</p>
        <div class="obw-repo-rows" id="obw-tokens-list">${tokenRows(false)}</div>
        <div class="obw-step-actions">
          <button type="button" class="ds-btn ds-btn--secondary" id="obw-tokens-refresh-btn">Check again</button>
          <button type="button" class="ds-btn ds-btn--primary" id="obw-tokens-create-btn" disabled>Generate keys</button>
        </div>`)}
      ${card('step4', STEP_TITLES[3], `
        <p class="obw-step-desc">Team data travels encrypted. Paste the keys as <code>repoId=key</code>, one per line.</p>
        <p class="obw-step-hint">You get the keys from the team data maintainer.</p>
        <textarea class="ds-textarea obw-textarea" id="obw-key-textarea" spellcheck="false" autocomplete="off" placeholder="ds-data=base64_key"></textarea>
        <div class="obw-step-actions">
          <button type="button" class="ds-btn ds-btn--primary" id="obw-key-save-btn">Save keys</button>
        </div>
        <div class="obw-repo-rows" id="obw-key-state">${keyRows([])}</div>`)}
      ${card('step5', STEP_TITLES[4], `
        <p class="obw-step-desc">Downloads the team data repository to this computer. The downloaded files are decrypted locally and never leave this machine in plaintext.</p>
        <div class="obw-repo-rows" id="obw-data-token-list">${dataTokenRow(false)}</div>
        <div class="ds-callout ds-callout--warning obw-data-state" id="obw-data-state">Step 4 first: without the team data key the downloaded files stay encrypted.</div>
        <div class="obw-step-actions">
          <button type="button" class="ds-btn ds-btn--primary" id="obw-data-clone-btn">Download team data</button>
        </div>`)}
      ${card('step6', STEP_TITLES[5], `
        <p class="obw-step-desc">Checks for and installs a newer version. This step does not depend on the others — you can do it any time.</p>
        <div class="obw-step-actions">
          <button type="button" class="ds-btn ds-btn--secondary" id="obw-update-check-btn">Check for updates</button>
        </div>
        <div class="obw-update-result ds-callout ds-callout--neutral" id="obw-update-result">Not checked yet.</div>`)}
      ${card('step7', STEP_TITLES[6], '<div id="obw-step7-body"><p class="obw-step-desc">Finish steps 2, 4 and 5 to unlock the Academy.</p></div>', 'Locked')}
    </div>`,

  'obw-tools-rows': ({ ok = true } = {}) => toolRows(ok),
  'obw-token-rows': ({ loaded = true } = {}) => tokenRows(loaded),
  'obw-data-token-row': ({ loaded = true } = {}) => dataTokenRow(loaded),
  'obw-key-rows': ({ present = [] } = {}) => keyRows(present),

  'obw-data-state': ({ done = false, ready = false } = {}) => {
    if (done) return '<div class="ds-callout ds-callout--success obw-data-state" id="obw-data-state">Repository ready · branch main · last sync 04.10.2026 09:14.</div>';
    if (ready) return '<div class="ds-callout ds-callout--info obw-data-state" id="obw-data-state">The team data has not been downloaded to this computer yet.</div>';
    return '<div class="ds-callout ds-callout--warning obw-data-state" id="obw-data-state">Step 4 first: without the team data key the downloaded files stay encrypted.</div>';
  },

  'obw-bw-status': ({ unlocked = true } = {}) => (unlocked
    ? `<p class="obw-bw-status obw-bw-status--ok" id="obw-bw-status">CLI installed · server configured · vault unlocked (${BW_LOADED_COUNT} tokens)</p>`
    : '<p class="obw-bw-status obw-bw-status--pending" id="obw-bw-status">CLI installed · server configured · vault locked</p>'),

  /** The success banner js/sync-log-modal.js paints when a run ends ok. */
  'slm-banner-ok': () => '<div class="ds-callout ds-callout--success sync-log-modal__banner sync-log-modal__banner--success">Sync completed successfully</div>',

  'obw-update-result': () => '<div class="obw-update-result ds-callout ds-callout--success" id="obw-update-result">Mission Deck is up to date.</div>',

  'obw-step7-done': () => `<div class="ds-callout ds-callout--success obw-completion">
      <img class="obw-completion-mascot" src="/assets/mascot/pip-success.svg" alt="">
      <div>
        <strong>Onboarding complete</strong>
        <p>Your Mission Deck is ready to work. The next step is getting to know it in the Academy.</p>
        <button type="button" class="ds-btn ds-btn--primary" id="obw-step7-go">Go to the Academy</button>
      </div>
    </div>`,

  /** The Bitwarden window (js/settings.js _openBitwardenModal) at its fourth step. */
  'bw-unlock-modal': () => modalShell({
    id: 'demo-bw-modal',
    title: 'Bitwarden',
    body: `<div class="bw-step"><span class="bw-step-num bw-step-num--done">&#10003;</span><div class="bw-step-main"><div class="bw-step-label">Install the Bitwarden CLI</div></div></div>
      <div class="bw-step"><span class="bw-step-num bw-step-num--done">&#10003;</span><div class="bw-step-main"><div class="bw-step-label">Configure the vault server</div></div></div>
      <div class="bw-step"><span class="bw-step-num bw-step-num--done">&#10003;</span><div class="bw-step-main"><div class="bw-step-label">Sign in with SSO</div></div></div>
      <div class="bw-step"><span class="bw-step-num bw-step-num--current">4</span><div class="bw-step-main">
        <div class="bw-step-label bw-step-label--current">Unlock the vault and fetch the secrets</div>
        <div style="margin:6px 0 12px">
          <label for="demo-bw-collection" style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">Bitwarden collection</label>
          <input type="text" class="ds-input" id="demo-bw-collection" placeholder="e.g. first-last" autocomplete="off">
        </div>
        <div style="display:flex;gap:8px;align-items:flex-end">
          <div style="flex:1">
            <label for="demo-bw-password" style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:4px">Bitwarden master password</label>
            <input type="password" class="ds-input" id="demo-bw-password" autocomplete="off">
          </div>
          <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" id="demo-bw-unlock-btn">Unlock</button>
        </div>
        <p style="margin:8px 0 0;font-size:12px;color:var(--text-secondary)">The password is not stored — it is used once to fetch the tokens into the server’s memory.</p>
      </div></div>`,
  }),

  /** confirmDsModal from the key step (js/onboarding-wizard.js _runGenerateKey). */
  'obw-genkey-modal': () => modalShell({
    id: 'demo-genkey-modal',
    title: 'New encryption key',
    body: 'Use only for a new, empty source. The key is saved in the .encryption-key file on this computer - then pass the line on to the people with access to this source. We will not show it on screen.',
    footer: '<button type="button" class="ds-btn ds-btn--primary" id="demo-genkey-ok">Generate</button><button type="button" class="ds-btn ds-btn--tertiary">Cancel</button>',
  }),

  /** VPN client on a macOS desktop (surface: 'screen'); props API above _vpnScreen. Shared with `updates`. */
  'vpn-client-screen': (p) => _vpnScreen(p),
  /** Full-screen vault app (surface: 'screen'); props API above _vaultScreen. */
  'bitwarden-vault-screen': (p) => _vaultScreen(p),
  /** The "+ New" dropdown, into #onb-bwv-detail. Items #onb-bwv-new-login|card|identity|note|ssh. */
  'onb-bwv-menu': () => _bwMenu(),
  /** The vault's new-item form, into #onb-bwv-detail. props: { kind: 'login'|'note' } */
  'onb-bwv-form': (p) => _bwForm(p),
  /** "New collection", into #onb-bwv-detail. Ids #onb-bwv-coll-name, #onb-bwv-coll-save. */
  'onb-bwv-coll-form': () => _bwCollForm(),
  /** A collection's "Access" tab, into #onb-bwv-detail; props API above _bwAccess. */
  'onb-bwv-access': (p) => _bwAccess(p),
  /** The Send page's "New" dropdown, into #onb-bwv-detail. */
  'onb-bwv-send-menu': () => _bwSendMenu(),
  /** "New text Send", into #onb-bwv-detail; ids above _bwSendForm. */
  'onb-bwv-send-form': () => _bwSendForm(),
  /** The Send list rows, into #onb-bwv-sends. props: { sends: [{ name, deletion }] } */
  'onb-bwv-send-list': ({ sends = [] } = {}) => _bwSendRows(sends),
  /** The recipient's Send page (surface: 'screen'); props API above _sendViewScreen. */
  'bitwarden-send-view': (p) => _sendViewScreen(p),
  /** A saved secure note opened read-only, into #onb-bwv-detail. props: { name, lines }; Edit = #onb-bwv-edit. */
  'onb-bwv-view': (p) => _bwView(p),
  /** The saved item with its "Saved" notice, into #onb-bwv-detail. props: { name } */
  'onb-bwv-saved': (p) => _bwSaved(p),
  /** The collection's item list, into #onb-bwv-items. props: { items: [name] } */
  'onb-bwv-list': ({ items = [] } = {}) => _bwRows(items),
};

export const LABELS = [
  ...STEP_TITLES, 'Check again', 'Open Tools', 'Refresh status', 'Open Bitwarden',
  'Generate keys', 'Save keys', 'Download team data', 'Check for updates',
  'Generate a new key', 'New encryption key', 'Generate', 'Cancel', 'Unlock',
  'Bitwarden collection', 'Bitwarden master password', 'Onboarding complete', 'Go to the Academy',
  'Sync completed successfully', 'Vault locked',
  'Login', 'Password', 'Company sign-in (SSO)', 'Sign in with your work account to connect to the company network.',
  'Email address', 'Sign in', 'File', 'Edit', 'View', 'Window', 'Sun 4 Oct 09:12',
  'Log in | Bitwarden Web Vault', 'Vaults | Bitwarden Web Vault', 'Log in to Bitwarden',
  'Email address (required)', 'Remember email', 'Master password (required)', 'Continue', 'or',
  'Use single sign-on', 'You sign in through the company SSO; the master password decrypts the vault.', 'Logging in on:',
  'Vaults', 'Tools', 'Import data', 'Export vault', 'Reports', 'Settings', 'Admin Console',
  'All vaults', 'New', 'Search vault', 'My vault', 'Items', 'All items', 'Favorites',
  'Types', 'Card', 'Identity', 'Secure note', 'Folders', 'No folder', 'Collections', 'Trash',
  'Name', 'Owner', 'Options', 'There are no items to list',
  'This collection is still empty. Add the first item with the “New” button.',
  'Your personal vault is empty. The tokens are in the', 'New login', 'New secure note',
  'Close', 'Item details', 'Item name (required)', 'Folder', 'Login credentials', 'Username',
  'Show password', 'Copy password', 'Generate password', 'Additional options', 'Notes', 'Ownership', 'Organization',
  'Save', 'Success', 'saved in collection', BW_ORG,
  'New collection', 'Info', 'Access', 'Collection info', 'Name (required)', 'Nest collection under', 'None',
  'Edit collection', 'Select groups or people', 'Enter an email address', 'Person', 'Permission', 'Can manage', 'You',
  'Remove access', 'Nobody has access to this collection yet.', 'New Send', 'Text', 'File', 'New text Send',
  'Send details', 'Text to share', 'Hide text by default', 'The recipient reveals it.', 'Deletion date', 'In 7 days',
  'Additional options', 'Password (optional)', 'Maximum access count',
  'There are no Sends to list', 'Use Send to share encrypted text or a file securely with one person.',
  'Text · max. 1 view · text hidden', 'Copy link', 'Someone shared a Send with you', 'Show text', 'Hide text',
  'Copy text', 'This Send will be deleted on', 'That was the only allowed view — the link no longer works.',
  'It can be viewed only once.', 'Bitwarden Send transmits sensitive data in encrypted form.', 'Encryption keys',
  'Shared', 'Shared with you by the Mission Deck maintainer', 'shared with you',
  'Edit', 'Edit secure note', 'Secure note · Mission Deck keys, KEY=value lines',
  'Your master password', 'Log in with master password', 'Log in with device',
  'Forgot master password?', 'Get a hint', 'Note', 'SSH key', 'Collection',
  'In the vault', 'Key present', 'No key', 'Done', 'To do', 'Locked',
];
