// modules/team-directory/client/index.js
// Team directory - read-only team roster grouped by team. Costs, rates,
// hours and finance tabs are out of scope. No server layer: everything comes from
// the roster the core already serves statically, through js/team-directory.js.
//
// export const views = { 'team-directory-main': { init(deps), render(subPath, opts) } }
// - the shape js/module-host.js expects (see modules/time-off/client/index.js
//   and modules/rollout-waves/client/index.js for the working pattern).
//
// deps (passed to init):
//   navigate(viewId)                 - go to another view
//   registerViewCleanup(cb)          - MANDATORY for timers, listeners
//   showToast(variant, title, desc)  - variant: success | danger | info | warning | neutral
//   apiBase                          - '/api/m/team-directory' (unused - no server layer)
//
// js/team-directory.js and js/ds-modal.js are CORE ESM modules - the import
// MUST be dynamic and only ever run inside init(), in try/catch: a static
// import would break the contract test, which loads this file in plain Node
// with no browser document and no /js/... URL resolver (see modules/time-off/client/index.js
// for the same pattern and modules/rollout-waves/client/index.js for the
// same treatment of js/ds-modal.js).
//
// DS classes only (ds-card, ds-badge, ds-input, ds-callout, ds-btn, the
// ds-modal-* family) and tokens from css/ds-tokens.css - never a hex.
//
// Read-only: the sole writer of team-members.json is Settings > Users
// (/api/team/*). This view never edits anything - see README.md.

import {
  orderTeams, groupByTeam, filterMembers, teamInitials, logoSlug, personCaption,
  hasLogoColumn,
} from './team-directory-lib.js';

const ROOT_ID = 'team-directory-main-root';
const LOGOS_BASE = '/data-sub-repositories/ds-data/team/logos/';
const SEARCH_LABEL = 'Search people: first name, last name, role or e-mail';

// Module-scope state - one view instance for the whole app session, same
// pattern as modules/time-off/client/index.js and modules/demo-hub/client/index.js.
let _deps = null;
let _teamDir = null; // '/js/team-directory.js' namespace once loaded, else null
let _dsModal = null; // '/js/ds-modal.js' namespace once loaded, else null
let _mounted = false;
// True once the first loadTeamDirectory() call has settled - distinguishes
// "not answered yet" (skeleton) from "answered, roster is empty" (empty
// state), which a plain member-count comparison cannot tell apart.
let _dirReady = false;
let _query = ''; // free-text filter, module state, not a document attribute

function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function _toast(variant, title, desc) {
  if (_deps && typeof _deps.showToast === 'function') _deps.showToast(variant, title, desc || '');
}

// ── team-directory bridge (all safe when the dynamic import never lands) ───
// Same shape as modules/time-off/client/index.js.

function _teamMembers() {
  return _teamDir && typeof _teamDir.getTeamMembers === 'function' ? _teamDir.getTeamMembers() : [];
}

function _memberAvatarUrl(member) {
  return _teamDir && typeof _teamDir.memberAvatarUrl === 'function' ? _teamDir.memberAvatarUrl(member) : '';
}

function _memberInitials(name) {
  return _teamDir && typeof _teamDir.memberInitials === 'function' ? _teamDir.memberInitials(name) : '';
}

function _fullName(member) {
  return _teamDir && typeof _teamDir.fullName === 'function' ? _teamDir.fullName(member) : '';
}

// Ask the directory again on entry: it is a no-op once it has answered, and on
// a fresh install it may have been asked before the data repo was decrypted -
// the view would then paint the empty state for a roster that was on disk all
// along. Repaints on every count change, and once more on the very first
// answer even with no change (0 -> 0 is still "loading" -> "confirmed empty",
// two different screens).
function _refreshTeamDir() {
  if (!_teamDir || typeof _teamDir.loadTeamDirectory !== 'function') {
    _dirReady = true;
    return Promise.resolve();
  }
  const before = _teamMembers().length;
  return _teamDir.loadTeamDirectory()
    .then(() => {
      const changed = _teamMembers().length !== before;
      const firstAnswer = !_dirReady;
      _dirReady = true;
      if (changed || firstAnswer) _repaintIfMounted();
    })
    .catch(() => { _dirReady = true; _repaintIfMounted(); });
}

function _repaintIfMounted() {
  if (!_mounted) return;
  const root = document.getElementById(ROOT_ID);
  if (root) _paint(root);
}

// ── modal bridge (all safe when the dynamic import never lands) ───────────
// Pattern from modules/rollout-waves/client/index.js.

function _openModal(el, opts) {
  if (!el) return;
  if (_dsModal && typeof _dsModal.openDsModal === 'function') { _dsModal.openDsModal(el, opts); return; }
  el.hidden = false;
  el.classList.add('open');
}

function _closeModal(el) {
  if (!el) return;
  if (_dsModal && typeof _dsModal.closeDsModal === 'function') { _dsModal.closeDsModal(el); return; }
  el.classList.remove('open');
  el.hidden = true;
}

// ── toolbar ─────────────────────────────────────────────────────────────

function _countLabel(shown, total) {
  return 'People shown: ' + shown + ' of ' + total;
}

function _toolbarHtml() {
  const total = _teamMembers().length;
  const shown = filterMembers(_teamMembers(), _query).length;
  return '<div class="team-directory-toolbar">'
    + '<input type="text" class="ds-input team-directory-search" id="team-directory-search-input" '
    + 'placeholder="' + esc(SEARCH_LABEL) + '" aria-label="' + esc(SEARCH_LABEL) + '" value="' + esc(_query) + '">'
    + '<span class="team-directory-count" id="team-directory-count">' + esc(_countLabel(shown, total)) + '</span>'
    + '</div>';
}

// ── grid ────────────────────────────────────────────────────────────────

function _skeletonGridHtml() {
  const card = '<div class="ds-card team-directory-team-card team-directory-team-card--skeleton">'
    + '<div class="team-directory-logo-col"><span class="ds-skeleton team-directory-skeleton-logo"></span></div>'
    + '<div class="team-directory-team-body">'
    + '<div class="ds-skeleton team-directory-skeleton-line team-directory-skeleton-line--title"></div>'
    + '<div class="team-directory-people-grid">'
    + Array(6).fill('<span class="ds-skeleton team-directory-skeleton-avatar"></span>').join('')
    + '</div></div></div>';
  return card + card;
}

function _emptyStateHtml(message) {
  return '<div class="ds-callout ds-callout--info team-directory-empty">' + esc(message) + '</div>';
}

function _teamCardHtml(team, members) {
  const slug = logoSlug(team);
  // Three shapes: a team with a logo file, a team
  // with none (its initials hold the column, so the cards in a row stay
  // aligned), and a team with no column at all (see NO_LOGO_COLUMN_TEAMS).
  let logoHtml = '';
  if (hasLogoColumn(team)) {
    logoHtml = slug
      ? '<div class="team-directory-logo-col">'
        + '<div class="team-directory-logo-imgs">'
        + '<img class="team-directory-team-logo team-directory-team-logo--light" src="' + LOGOS_BASE + esc(slug) + '_light.png" alt="' + esc(team) + '" loading="lazy">'
        + '<img class="team-directory-team-logo team-directory-team-logo--dark" src="' + LOGOS_BASE + esc(slug) + '_dark.png" alt="' + esc(team) + '" loading="lazy">'
        + '</div>'
        + '<span class="team-directory-team-logo-initials" hidden>' + esc(teamInitials(team)) + '</span>'
        + '</div>'
      : '<div class="team-directory-logo-col team-directory-logo-col--initials">'
        + '<span class="team-directory-team-logo-initials">' + esc(teamInitials(team)) + '</span>'
        + '</div>';
  }
  const cardCls = logoHtml
    ? 'ds-card team-directory-team-card'
    : 'ds-card team-directory-team-card team-directory-team-card--no-logo-col';
  return '<div class="' + cardCls + '">'
    + logoHtml
    + '<div class="team-directory-team-body">'
    + '<div class="team-directory-team-header">'
    + '<span class="team-directory-team-name">' + esc(team) + '</span>'
    + '<span class="ds-badge team-directory-team-badge">' + members.length + '</span>'
    + '</div>'
    + '<div class="team-directory-people-grid">'
    + members.map((m) => _personTileHtml(m)).join('')
    + '</div>'
    + '</div>'
    + '</div>';
}

function _personTileHtml(member) {
  const name = _fullName(member) || [member.first_name, member.last_name].filter(Boolean).join(' ');
  const avatarUrl = _memberAvatarUrl(member);
  const avatarHtml = avatarUrl
    ? '<img class="team-directory-person-avatar" src="' + esc(avatarUrl) + '" alt="' + esc(name) + '" loading="lazy">'
    : '<span class="team-directory-person-avatar team-directory-person-avatar--initials">' + esc(_memberInitials(name)) + '</span>';
  const role = (member && member.role) || '';
  const email = (member && member.email) || '';
  // ds-tooltip-wrap/ds-tooltip-content is the DS tooltip: it carries the
  // positioning context, the surface and pointer-events: none. It ships with
  // no show/hide rule (and no other caller in the app), so the module adds
  // only that - never a second hover surface of its own. aria-hidden because
  // the tile's aria-label already announces the person.
  return '<div class="team-directory-person-tile ds-tooltip-wrap" data-id="' + esc((member && member.id) || '') + '" tabindex="0" role="button" aria-label="' + esc(name) + '">'
    + avatarHtml
    + '<span class="team-directory-person-caption">' + esc(personCaption(member)) + '</span>'
    + '<span class="team-directory-person-role">' + esc(role) + '</span>'
    + '<span class="ds-tooltip-content team-directory-person-tip" aria-hidden="true">'
    + '<span class="team-directory-tip-name">' + esc(name) + '</span>'
    + (role ? '<span class="team-directory-tip-role">' + esc(role) + '</span>' : '')
    + '<span class="team-directory-tip-email">' + esc(email || 'No e-mail address') + '</span>'
    + '</span>'
    + '</div>';
}

function _gridInnerHtml() {
  const allMembers = _teamMembers();
  if (!_dirReady && allMembers.length === 0) return _skeletonGridHtml();
  if (allMembers.length === 0) {
    return _emptyStateHtml('The team directory is empty. Check data sync in the top bar.');
  }
  const filtered = filterMembers(allMembers, _query);
  if (filtered.length === 0) return _emptyStateHtml('Nobody matches the query.');
  const grouped = groupByTeam(filtered);
  const teamNames = Object.keys(grouped).filter(Boolean);
  const blocks = orderTeams(teamNames);
  let html = '';
  blocks.forEach((block, i) => {
    if (i > 0) html += '<div class="team-directory-divider"></div>';
    block.forEach((team) => { html += _teamCardHtml(team, grouped[team]); });
  });
  return html;
}

// ── person modal ────────────────────────────────────────────────────────

function _personModalHtml() {
  return '<div id="team-directory-person-modal-overlay" class="ds-modal-overlay" hidden>'
    + '<div class="ds-modal ds-modal--md" role="dialog" aria-modal="true" aria-label="Person profile">'
    + '<div class="ds-modal-header"><span class="ds-modal-title">Person profile</span>'
    + '<button type="button" class="ds-modal-close" data-modal-close aria-label="Close">&times;</button></div>'
    + '<div class="ds-modal-body" id="team-directory-person-modal-body"></div>'
    + '</div></div>';
}

function _personModalBodyHtml(member) {
  const name = _fullName(member) || [member.first_name, member.last_name].filter(Boolean).join(' ');
  const avatarUrl = _memberAvatarUrl(member);
  const avatarHtml = avatarUrl
    ? '<img class="team-directory-modal-avatar" src="' + esc(avatarUrl) + '" alt="' + esc(name) + '">'
    : '<span class="team-directory-modal-avatar team-directory-modal-avatar--initials">' + esc(_memberInitials(name)) + '</span>';
  const team = (member && member.team) || 'None';
  const role = (member && member.role) || 'None';
  const email = (member && member.email) || '';
  const mailHtml = email
    ? '<a href="mailto:' + esc(email) + '" class="team-directory-modal-email">' + esc(email) + '</a>'
    : '<span class="team-directory-modal-email-empty">No e-mail address</span>';
  // Two full literal footers, not one string built with a mid-expression
  // ternary: "Message on Teams" is the primary/first action ONLY when there
  // is an e-mail to open Teams with - without one, "Close" is the sole
  // (tertiary) action.
  const teamsHtml = email
    ? '<div class="ds-modal-footer">'
      + '<a class="ds-btn ds-btn--primary team-directory-modal-teams-btn" '
      + 'href="https://teams.microsoft.com/l/chat/0/0?users=' + encodeURIComponent(email) + '" '
      + 'target="_blank" rel="noopener noreferrer">Message on Teams'
      + '<svg class="team-directory-external-icon" aria-hidden="true" focusable="false" viewBox="0 0 16 16" width="14" height="14">'
      + '<path fill="currentColor" d="M4 3.5h5V5H5v6h6V7.5h1.5v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/>'
      + '<path fill="currentColor" d="M9.5 2.5H13v3.5H11.5V5.06L8.06 8.5 7 7.44l3.44-3.44H9.5v-1.5z"/>'
      + '</svg></a>'
      + '<button type="button" class="ds-btn ds-btn--tertiary" data-modal-close>Close</button>'
      + '</div>'
    : '<div class="ds-modal-footer">'
      + '<button type="button" class="ds-btn ds-btn--tertiary" data-modal-close>Close</button>'
      + '</div>';
  return '<div class="team-directory-modal-hero">'
    + avatarHtml
    + '<h2 class="team-directory-modal-name">' + esc(name) + '</h2>'
    + '<span class="ds-badge team-directory-modal-team-badge">' + esc(team) + '</span>'
    + '</div>'
    + '<div class="team-directory-modal-rows">'
    + '<div class="team-directory-modal-row"><span class="team-directory-modal-label">Role</span><span class="team-directory-modal-value">' + esc(role) + '</span></div>'
    + '<div class="team-directory-modal-row"><span class="team-directory-modal-label">E-mail</span><span class="team-directory-modal-value">' + mailHtml + '</span></div>'
    + '</div>'
    + '<div class="ds-callout ds-callout--info team-directory-modal-callout">Person details are edited in Settings > Users.</div>'
    + teamsHtml;
}

function _openPersonModal(root, member, tile) {
  try {
    const overlay = root.querySelector('#team-directory-person-modal-overlay');
    const body = root.querySelector('#team-directory-person-modal-body');
    if (!overlay || !body) return;
    body.innerHTML = _personModalBodyHtml(member);
    _openModal(overlay, { trigger: tile });
  } catch (err) {
    _toast('danger', 'Could not open the person profile', (err && err.message) || '');
  }
}

// ── paint ───────────────────────────────────────────────────────────────

function _paint(root) {
  root.innerHTML = _toolbarHtml()
    + '<div class="team-directory-grid" id="team-directory-grid">' + _gridInnerHtml() + '</div>'
    + _personModalHtml();
}

function _updateGrid(root) {
  const total = _teamMembers().length;
  const filtered = filterMembers(_teamMembers(), _query);
  const countEl = root.querySelector('#team-directory-count');
  if (countEl) countEl.textContent = _countLabel(filtered.length, total);
  const gridEl = root.querySelector('#team-directory-grid');
  if (gridEl) gridEl.innerHTML = _gridInnerHtml();
}

// ── delegated listeners (one each, wired once per mounted root) ───────────

function _onRootClick(e, root) {
  const closeBtn = e.target.closest && e.target.closest('[data-modal-close]');
  if (closeBtn) {
    _closeModal(closeBtn.closest('.ds-modal-overlay'));
    return;
  }
  if (e.target && e.target.classList && e.target.classList.contains('ds-modal-overlay')) {
    _closeModal(e.target);
    return;
  }
  const tile = e.target.closest && e.target.closest('.team-directory-person-tile');
  if (!tile) return;
  const id = tile.dataset.id;
  const member = _teamMembers().find((m) => m && String(m.id) === String(id));
  if (member) _openPersonModal(root, member, tile);
}

// Keyboard twin of _onRootClick's tile branch: the tile already carries
// role="button" tabindex="0" (a11y contract for a clickable div), so a
// keyboard-only visitor must be able to reach it with Tab and open it with
// Enter, the same way a native button element reacts to a click.
function _onRootKeydown(e, root) {
  if (e.key !== 'Enter') return;
  const tile = e.target.closest && e.target.closest('.team-directory-person-tile');
  if (!tile) return;
  const id = tile.dataset.id;
  const member = _teamMembers().find((m) => m && String(m.id) === String(id));
  if (member) _openPersonModal(root, member, tile);
}

function _onRootInput(e, root) {
  const input = e.target.closest && e.target.closest('#team-directory-search-input');
  if (!input) return;
  _query = input.value || '';
  _updateGrid(root);
}

function _onRootError(e) {
  const img = e.target;
  if (!img || !img.classList || !img.classList.contains('team-directory-team-logo')) return;
  const col = img.closest('.team-directory-logo-col');
  if (!col) return;
  const imgs = col.querySelector('.team-directory-logo-imgs');
  const initialsEl = col.querySelector('.team-directory-team-logo-initials');
  if (imgs) imgs.hidden = true;
  if (initialsEl) initialsEl.hidden = false;
}

// ── wiring ──────────────────────────────────────────────────────────────
// `deps.registerViewCleanup` callbacks run on EVERY exit from the view, not
// only on a full module reload (js/app.js calls runActiveViewCleanup() from
// navigate() on plain navigation too) - so a listener wired once would work
// on the first visit and answer nothing on every one after. `_wired` makes
// re-wiring idempotent and every cleanup callback drops it, so the next
// render() (called on every re-entry, mounted or not) re-attaches. Same
// re-register-on-every-entry shape as _ensureEscapeHandler in
// modules/rollout-waves/client/index.js.

let _wired = false;

function _ensureWired(root) {
  if (_wired) return;
  _wired = true;

  const onClick = (e) => _onRootClick(e, root);
  root.addEventListener('click', onClick);
  if (_deps && typeof _deps.registerViewCleanup === 'function') {
    _deps.registerViewCleanup(() => { root.removeEventListener('click', onClick); _wired = false; });
  }

  // Delegated on the root - repainting the whole grid on every keystroke is
  // cheap at ~100 records, and one listener beats one per tile.
  const onInput = (e) => _onRootInput(e, root);
  root.addEventListener('input', onInput);
  if (_deps && typeof _deps.registerViewCleanup === 'function') {
    _deps.registerViewCleanup(() => { root.removeEventListener('input', onInput); _wired = false; });
  }

  // The image "error" event does not bubble, so this listener must run in
  // the CAPTURE phase to see it delegated from the root.
  const onError = (e) => _onRootError(e);
  root.addEventListener('error', onError, { capture: true });
  if (_deps && typeof _deps.registerViewCleanup === 'function') {
    _deps.registerViewCleanup(() => { root.removeEventListener('error', onError, { capture: true }); _wired = false; });
  }

  const onKeydown = (e) => _onRootKeydown(e, root);
  root.addEventListener('keydown', onKeydown);
  if (_deps && typeof _deps.registerViewCleanup === 'function') {
    _deps.registerViewCleanup(() => { root.removeEventListener('keydown', onKeydown); _wired = false; });
  }

  // openDsModal's own Escape/overlay-click listener lives only between open
  // and close - closing here on exit means a view switch never leaves that
  // document-level keydown listener behind.
  if (_deps && typeof _deps.registerViewCleanup === 'function') {
    _deps.registerViewCleanup(() => {
      const overlay = root.querySelector('#team-directory-person-modal-overlay');
      if (overlay && !overlay.hidden) _closeModal(overlay);
    });
  }
}

// ── mount ───────────────────────────────────────────────────────────────

function _mount(root) {
  _paint(root);
  _ensureWired(root);
  _mounted = true;
}

// ── view ────────────────────────────────────────────────────────────────

export const views = {

  'team-directory-main': {
    /** @param {{ navigate, registerViewCleanup, showToast, apiBase }} deps */
    init(deps) {
      _deps = deps;

      // Dynamic on purpose - see the header comment: this file is imported by
      // the contract test in plain Node with no browser document and no /js/... resolver.
      (async () => {
        try { _teamDir = await import('/js/team-directory.js'); } catch { _teamDir = null; }
        await _refreshTeamDir();
      })();
      (async () => {
        try { _dsModal = await import('/js/ds-modal.js'); } catch { _dsModal = null; }
      })();
    },

    /**
     * @param {string} _subPath path segment after the view id
     * @param {object} _opts navigation options
     */
    async render(_subPath, _opts) {
      const root = document.getElementById(ROOT_ID);
      if (!root) return;
      if (!_mounted) { _mount(root); return; }
      _paint(root);
      _ensureWired(root);
    },
  },
};
