// modules/onboarding/client/index.js
// Onboarding: helpful links + per-person onboarding plans. One view, one
// module-scope instance for the whole page session (see
// modules-template/README.md "Refreshing after a data sync" - a data-repo sync re-enters this
// file from scratch, so all mutable state lives here and NOT in the two
// sibling files, which stay pure/stateless).
//
// export const views = { 'onboarding-main': { init(deps), render(subPath, opts) } }
//
// deps (passed to init, and reachable from every handler via _deps):
//   navigate(viewId)                 - go to another view
//   registerViewCleanup(cb)          - MANDATORY for timers, listeners
//   showToast(variant, title, desc)  - variant: success | danger | info | warning | neutral
//   apiBase                          - '/api/m/onboarding'
//
// js/team-directory.js and js/ds-modal.js are CORE ESM modules - the import
// MUST be dynamic and only ever run inside init(), in try/catch: a static
// import would break the contract test, which loads this file in plain Node
// with no document and no /js/... URL resolver (modules/team-directory/client/index.js
// is the reference pattern this file follows for that bridge).
//
// DS classes only (ds-card, ds-table, ds-btn, ds-badge, ds-input, ds-tabs,
// the ds-modal-* family) and tokens from css/ds-tokens.css - never a hex.
// Every destructive action goes through confirmDsModal (js/ds-modal.js),
// never the browser's native confirm dialog.

import {
  isInternalUrl, viewIdFromUrl, parseWhoEntries, buildWhoString, recipientEmails,
  buildTeamsDraftUrl, sessionDraftText, formatWhen, MONTHS_FULL, pad2, monthGrid,
  filterMembers, moveRow, chipColorIndex, sortPlans, activePlanOrDefault,
} from './onboarding-lib.js';
import { buildPlanExportHtml } from './onboarding-export.js';

const ROOT_ID = 'onboarding-main-root';
const ACTIONS_ID = 'onboarding-main-actions';
const STORAGE_KEY = 'onboarding-active-plan';
const ICONS = '/assets/icons/ds/';

// -- module-scope state (one instance for the whole page session) ------------

let _deps = null;
let _teamDir = null; // '/js/team-directory.js' namespace once loaded, else null
let _dsModal = null; // '/js/ds-modal.js' namespace once loaded, else null
let _dirReady = false;
let _mounted = false;
let _loaded = false; // GET /links + GET /plans have answered at least once
let _loadError = false;
let _links = [];
let _plans = [];
let _activePlanId = (typeof localStorage !== 'undefined' && localStorage.getItem(STORAGE_KEY)) || 'default';

let _wired = false;
let _actionsWired = false;
let _teardownWired = false;
// The row-edit modal's one document-level dropdown-dismiss listener - at most
// one at a time (only one modal is ever open), dropped in close() AND in the
// view's cleanup (one listener per person entry, kept forever, would leak).
let _docClickForDropdown = null;

function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function _toast(variant, title, desc) {
  if (_deps && typeof _deps.showToast === 'function') _deps.showToast(variant, title, desc || '');
}

// -- team-directory bridge (all safe when the dynamic import never lands) ----

function _teamMembers() {
  return _teamDir && typeof _teamDir.getTeamMembers === 'function' ? _teamDir.getTeamMembers() : [];
}
function _memberByName(name) {
  return _teamDir && typeof _teamDir.memberByName === 'function' ? _teamDir.memberByName(name) : null;
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

function _refreshTeamDir() {
  if (!_teamDir || typeof _teamDir.loadTeamDirectory !== 'function') { _dirReady = true; return Promise.resolve(); }
  const before = _teamMembers().length;
  return _teamDir.loadTeamDirectory()
    .then(() => {
      const changed = _teamMembers().length !== before;
      const firstAnswer = !_dirReady;
      _dirReady = true;
      if ((changed || firstAnswer) && _mounted) {
        const root = document.getElementById(ROOT_ID);
        if (root) { _paint(root); _wireActivePlanDrag(root); }
      }
    })
    .catch(() => { _dirReady = true; });
}

// -- modal bridge (all safe when the dynamic import never lands) -------------

function _openOverlay(overlay, trigger) {
  if (_dsModal && typeof _dsModal.openDsModal === 'function') { _dsModal.openDsModal(overlay, { trigger }); return; }
  overlay.hidden = false;
  overlay.classList.add('open');
}

function _closeOverlay(overlay, onClose) {
  if (typeof onClose === 'function') onClose();
  if (_dsModal && typeof _dsModal.closeDsModal === 'function') {
    _dsModal.closeDsModal(overlay);
  } else {
    overlay.classList.remove('open');
    overlay.hidden = true;
  }
  setTimeout(() => overlay.remove(), 200);
}

// Never the browser's native confirm dialog - a missing js/ds-modal.js
// import (which never happens in the running app) means a delete simply
// does not proceed.
async function _confirmDanger(opts) {
  if (!_dsModal || typeof _dsModal.confirmDsModal !== 'function') return false;
  return _dsModal.confirmDsModal(opts);
}

// -- API ----------------------------------------------------------------------

async function _apiFetch(path, opts) {
  const res = await fetch(_deps.apiBase + path, opts);
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) {
    const message = (data && data.message) || ('HTTP error ' + res.status);
    const err = new Error(message);
    err.status = res.status;
    err.code = data && data.error;
    throw err;
  }
  // Every _apiFetch is a write (POST/PUT/DELETE) into data-tier-0's
  // onboarding/. Announce it on the core's data bus, so the core repaints
  // the module sync bar (local date, pending files) and calls onDataChanged()
  // below - which repaints only when the reloaded links/plans differ from
  // what the caller has already patched into memory.
  _announceDataWrite();
  return data;
}

async function _announceDataWrite() {
  try {
    const ev = await import('/js/data-events.js');
    ev.emitDataChanged({ source: 'onboarding' });
  } catch { /* the bar catches up on the next view entry */ }
}

// What the view paints from, as one comparable string (onDataChanged).
function _snapshotData() {
  try { return JSON.stringify([_links, _plans, _storage, _loadError]); } catch { return null; }
}

async function _loadData() {
  try {
    const [linksRes, plansRes] = await Promise.all([
      fetch(_deps.apiBase + '/links'),
      fetch(_deps.apiBase + '/plans'),
    ]);
    if (!linksRes.ok || !plansRes.ok) throw new Error('HTTP error');
    const linksData = await linksRes.json();
    const plansData = await plansRes.json();
    _links = Array.isArray(linksData.links) ? linksData.links : [];
    _plans = Array.isArray(plansData.plans) ? plansData.plans : [];
    _storageState(linksData.storage, plansData.storage);
    _loaded = true;
    _loadError = false;
    if (!_plans.find((p) => p.id === _activePlanId)) {
      _activePlanId = 'default';
      _persistActivePlan();
    }
  } catch {
    _loadError = true;
  }
}

// Kept as a named step for clarity even though the result is only used for
// the empty-repository callout below - see _paint().
let _storage = 'ok';
function _storageState(a, b) {
  _storage = (a === 'unavailable' || b === 'unavailable') ? 'unavailable' : 'ok';
}

function _persistActivePlan() {
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, _activePlanId);
}

// -- view helpers ---------------------------------------------------------------

function _isViewInstalled(viewId) {
  return !!(viewId && document.getElementById('view-' + viewId));
}

function _iconImg(slug) {
  return '<img class="onboarding-ic" src="' + ICONS + slug + '.svg" alt="">';
}

// -- skeleton / error ------------------------------------------------------------

function _introHtml() {
  return '<p class="onboarding-intro">This view collects helpful links and individual onboarding plans. '
    + 'Links can be edited and extended; plans are copies of the template for each new person.</p>';
}

function _skeletonHtml() {
  const cards = Array(5).fill('<div class="ds-skeleton onboarding-skeleton-card"></div>').join('');
  const rows = Array(6).fill('<div class="ds-skeleton onboarding-skeleton-row"></div>').join('');
  return _introHtml()
    + '<div class="ds-card"><div class="ds-card-body"><div class="onboarding-skeleton-grid">' + cards + '</div></div></div>'
    + '<div class="ds-card onboarding-plans-card"><div class="ds-card-body">' + rows + '</div></div>';
}

function _errorCalloutHtml() {
  return '<div class="ds-callout ds-callout--danger">'
    + '<div>Could not load the onboarding links and plans.</div>'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-action="reload-data">Refresh</button>'
    + '</div>';
}

function _emptyRepoCalloutHtml() {
  return '<div class="ds-callout ds-callout--info">'
    + '<div>No template and no links yet - add them here, or pull the team data in the Sync window.</div>'
    + '</div>';
}

// -- links card ---------------------------------------------------------------

function _linksCardHtml() {
  const grid = _links.length === 0
    ? '<div class="ds-empty"><div class="ds-empty-title">No links</div>'
      + '<div class="ds-empty-desc">Add the first link with the button above.</div></div>'
    : '<div class="onboarding-link-card-grid">' + _links.map((l) => _linkCardHtml(l)).join('') + '</div>';
  return '<div class="ds-card" id="onboarding-links-card">'
    + '<div class="ds-card-header"><span class="ds-card-title">Helpful links</span>'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-action="add-link">+ Add link</button>'
    + '</div>'
    + '<div class="ds-card-body">' + grid + '</div>'
    + '</div>';
}

function _linkCardHtml(link) {
  let titleHtml;
  if (isInternalUrl(link.url)) {
    const viewId = viewIdFromUrl(link.url);
    titleHtml = _isViewInstalled(viewId)
      ? '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-action="navigate-view" data-view-id="' + esc(viewId) + '">'
        + _iconImg('16-ic-dashboard') + '<span>' + esc(link.title) + '</span></button>'
        + '<span class="ds-badge ds-badge--sm onboarding-internal-badge">app</span>'
      : '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" disabled '
        + 'aria-label="This view is not installed" title="This view is not installed">'
        + _iconImg('16-ic-dashboard') + '<span>' + esc(link.title) + '</span></button>'
        + '<span class="ds-badge ds-badge--gray ds-badge--sm onboarding-internal-badge">not installed</span>';
  } else {
    titleHtml = '<a class="ds-link" href="' + esc(link.url) + '" target="_blank" rel="noopener noreferrer">'
      + _iconImg('16-ic-external-link') + esc(link.title) + '</a>';
  }
  return '<div class="ds-card onboarding-link-card">'
    + '<div class="onboarding-link-card-title">' + titleHtml + '</div>'
    + (link.description ? '<p class="onboarding-link-card-desc">' + esc(link.description) + '</p>' : '')
    + '<div class="onboarding-link-card-actions">'
    + '<button type="button" class="ds-icon-btn ds-icon-btn--sm" data-action="edit-link" data-id="' + esc(link.id) + '" aria-label="Edit link">' + _iconImg('16-ic-edit') + '</button>'
    + '<button type="button" class="ds-icon-btn ds-icon-btn--sm" data-action="delete-link" data-id="' + esc(link.id) + '" aria-label="Delete link">' + _iconImg('16-ic-trashcan') + '</button>'
    + '</div></div>';
}

function _repaintLinksCard() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  const el = root.querySelector('#onboarding-links-card');
  if (el) el.outerHTML = _linksCardHtml();
}

function _openLinkModal(existing, trigger) {
  const isEdit = !!existing;
  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay onboarding-modal-overlay';
  overlay.innerHTML = '<div class="ds-modal" role="dialog" aria-modal="true">'
    + '<div class="ds-modal-header"><span class="ds-modal-title">' + (isEdit ? 'Edit link' : 'Add link') + '</span>'
    + '<button type="button" class="ds-modal-close" data-close aria-label="Close">&times;</button></div>'
    + '<div class="ds-modal-body">'
    + '<div class="ds-input-wrap"><label class="ds-label">Title <span aria-hidden="true">*</span></label>'
    + '<input type="text" class="ds-input" id="oc-link-title" placeholder="e.g. Confluence" value="' + esc(existing ? existing.title : '') + '"></div>'
    + '<div class="ds-input-wrap" style="margin-top:12px"><label class="ds-label">URL <span aria-hidden="true">*</span></label>'
    + '<input type="text" class="ds-input" id="oc-link-url" placeholder="https://... or view://team-directory-main" value="' + esc(existing ? existing.url : '') + '"></div>'
    + '<div class="ds-input-wrap" style="margin-top:12px"><label class="ds-label">Description</label>'
    + '<input type="text" class="ds-input" id="oc-link-desc" placeholder="Optional description" value="' + esc(existing ? (existing.description || '') : '') + '"></div>'
    + '</div>'
    + '<div class="ds-modal-footer">'
    + '<button type="button" class="ds-btn ds-btn--primary" data-submit>' + (isEdit ? 'Save' : 'Add') + '</button>'
    + '<button type="button" class="ds-btn ds-btn--tertiary" data-close>Cancel</button>'
    + '</div></div>';
  document.body.appendChild(overlay);
  _openOverlay(overlay, trigger);
  const close = () => _closeOverlay(overlay);
  overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));

  const submitBtn = overlay.querySelector('[data-submit]');
  submitBtn.addEventListener('click', async () => {
    const titleInput = overlay.querySelector('#oc-link-title');
    const urlInput = overlay.querySelector('#oc-link-url');
    const descInput = overlay.querySelector('#oc-link-desc');
    const title = titleInput.value.trim();
    const url = urlInput.value.trim();
    const description = descInput.value.trim();
    const urlValid = /^(https?:\/\/|view:\/\/)/i.test(url);
    titleInput.classList.toggle('ds-input--error', !title);
    urlInput.classList.toggle('ds-input--error', !url || !urlValid);
    if (!title || !url || !urlValid) return;
    submitBtn.setAttribute('aria-busy', 'true');
    try {
      const data = isEdit
        ? await _apiFetch('/links?id=' + encodeURIComponent(existing.id), {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, url, description }),
        })
        : await _apiFetch('/links', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, url, description }),
        });
      _links = isEdit ? _links.map((l) => (l.id === existing.id ? data.link : l)) : _links.concat([data.link]);
      close();
      _repaintLinksCard();
      _toast('success', 'Link saved');
    } catch (err) {
      _toast('danger', 'Could not save the link', err.message);
    } finally {
      submitBtn.removeAttribute('aria-busy');
    }
  });
}

async function _deleteLink(id, btn) {
  const ok = await _confirmDanger({ title: 'Delete this link?', okLabel: 'Delete', danger: true, trigger: btn });
  if (!ok) return;
  btn.setAttribute('aria-busy', 'true');
  try {
    await _apiFetch('/links?id=' + encodeURIComponent(id), { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
    _links = _links.filter((l) => l.id !== id);
    _repaintLinksCard();
    _toast('success', 'Link deleted');
  } catch (err) {
    _toast('danger', 'Could not delete the link', err.message);
  } finally {
    btn.removeAttribute('aria-busy');
  }
}

// -- person chip / cell (shared by the table, the dropdown and the export) ----

function _personChipHtml(name) {
  if (!name) return '';
  const initials = _memberInitials(name);
  const colorIdx = chipColorIndex(name);
  return '<span class="onboarding-person-chip">'
    + '<span class="onboarding-person-initials onboarding-person-initials--sm onboarding-chip--' + colorIdx + '">' + esc(initials) + '</span>'
    + '<span>' + esc(name) + '</span></span>';
}

function _personCellHtml(who) {
  if (!who) return '';
  const parts = String(who).split(/\s*,\s*/).filter(Boolean);
  if (parts.length > 1) {
    return '<div class="onboarding-person-cell-list">' + parts.map((p) => _personCellHtml(p)).join('') + '</div>';
  }
  const part = parts[0] || who;
  const rawDisplayName = part.replace(/\s*\([^)]*\)\s*/g, '').trim();
  const member = _memberByName(rawDisplayName);
  const avatarUrl = member ? _memberAvatarUrl(member) : '';
  let avatarHtml;
  if (avatarUrl) {
    avatarHtml = '<img class="onboarding-person-avatar" src="' + esc(avatarUrl) + '" alt="' + esc(rawDisplayName) + '" loading="lazy">';
  } else {
    const initials = member ? _memberInitials(rawDisplayName)
      : rawDisplayName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
    avatarHtml = '<span class="onboarding-person-initials onboarding-chip--' + chipColorIndex(rawDisplayName) + '">' + esc(initials) + '</span>';
  }
  const role = member ? (member.role || '') : '';
  const emailMatch = /\(([^)@]+@[^)]+)\)/.exec(part);
  const email = member && member.email ? member.email : (emailMatch ? emailMatch[1] : '');
  const teamsBtn = email
    ? '<a class="onboarding-teams-btn" href="https://teams.microsoft.com/l/chat/0/0?users=' + encodeURIComponent(email) + '" '
      + 'target="_blank" rel="noopener noreferrer" aria-label="Message on Teams: ' + esc(email) + '">' + _iconImg('16-ic-chatbubbles') + '</a>'
    : '';
  return '<div class="onboarding-person-cell">' + avatarHtml
    + '<div class="onboarding-person-info"><span class="onboarding-person-info-name">' + esc(rawDisplayName) + teamsBtn + '</span>'
    + (role ? '<span class="onboarding-person-info-role">' + esc(role) + '</span>' : '')
    + '</div></div>';
}

// -- plans card -----------------------------------------------------------------

function _plansCardHtml() {
  const activePlan = activePlanOrDefault(_plans, _activePlanId);
  const tabsHtml = _plans.map((p) => {
    const active = activePlan && p.id === activePlan.id;
    return '<button type="button" class="ds-tab' + (active ? ' active' : '') + '" role="tab" '
      + 'id="oc-tab-' + esc(p.id) + '" data-plan-id="' + esc(p.id) + '" '
      + 'aria-selected="' + (active ? 'true' : 'false') + '" aria-controls="onboarding-plan-panel" '
      + 'tabindex="' + (active ? '0' : '-1') + '">' + esc(p.name) + '</button>';
  }).join('');
  return '<div class="ds-card onboarding-plans-card" id="onboarding-plans-card">'
    + '<div class="ds-card-header"><span class="ds-card-title">Onboarding plans</span></div>'
    + '<div class="ds-card-body">'
    + '<div class="onboarding-tab-bar">'
    + '<nav class="ds-tabs-list ds-framed-tabs" role="tablist">' + tabsHtml + '</nav>'
    + '</div>'
    + '<div id="onboarding-plan-panel" role="tabpanel"'
    + (activePlan ? ' aria-labelledby="oc-tab-' + esc(activePlan.id) + '"' : '') + '>'
    + (activePlan ? _planPanelHtml(activePlan) : '<div class="ds-empty"><div class="ds-empty-title">No plans</div></div>')
    + '</div></div></div>';
}

function _planPanelHtml(plan) {
  const isDefault = plan.id === 'default';
  const headerHtml = isDefault
    ? '<div class="onboarding-plan-header"><h3 class="onboarding-plan-name">Template</h3></div>'
    : '<div class="onboarding-plan-header">'
      + '<h3 class="onboarding-plan-name">'
      + '<span class="onboarding-plan-name-text" data-plan-id="' + esc(plan.id) + '">' + esc(plan.name) + '</span>'
      + '<button type="button" class="ds-icon-btn ds-icon-btn--sm" data-action="rename-plan" data-id="' + esc(plan.id) + '" aria-label="Rename plan">' + _iconImg('16-ic-edit') + '</button>'
      + '</h3>'
      + '<div class="onboarding-plan-name-actions">'
      + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-action="export-plan" data-id="' + esc(plan.id) + '">Export HTML</button>'
      + '<button type="button" class="ds-btn ds-btn--danger ds-btn--sm" data-action="delete-plan" data-id="' + esc(plan.id) + '">Delete plan</button>'
      + '</div></div>';

  const rows = plan.rows || [];
  const rowsHtml = rows.map((row, idx) => {
    const done = !!row.done;
    const doneBtn = isDefault
      ? ''
      : '<button type="button" class="ds-icon-btn ds-icon-btn--sm' + (done ? ' onboarding-done-active' : '') + '" '
        + 'data-action="toggle-done" data-plan-id="' + esc(plan.id) + '" data-row-idx="' + idx + '" '
        + 'aria-label="' + (done ? 'Restore' : 'Mark as done') + '">'
        + _iconImg(done ? '16-ic-task-returned' : '16-ic-tick') + '</button>';
    return '<tr draggable="true" data-row-idx="' + idx + '"' + (done ? ' class="onboarding-row-done"' : '') + '>'
      + '<td><button type="button" class="ds-icon-btn ds-icon-btn--sm onboarding-drag-handle" '
      + 'aria-label="Drag to reorder (Alt+arrow)" data-action="drag-handle" '
      + 'data-plan-id="' + esc(plan.id) + '" data-row-idx="' + idx + '">' + _iconImg('16-ic-drag-handle') + '</button></td>'
      + '<td>' + esc(row.topic || '') + '</td>'
      + '<td><div class="onboarding-description-cell" title="' + esc(row.description || '') + '">' + esc(row.description || '') + '</div></td>'
      + '<td>' + (row.who ? _personCellHtml(row.who) : '') + '</td>'
      + '<td>' + esc(formatWhen(row.when || '')) + '</td>'
      + '<td><div class="onboarding-row-actions">'
      + doneBtn
      + '<button type="button" class="ds-icon-btn ds-icon-btn--sm" data-action="draft-session" data-plan-id="' + esc(plan.id) + '" data-row-idx="' + idx + '" aria-label="Schedule a session">' + _iconImg('16-ic-chatbubbles') + '</button>'
      + '<button type="button" class="ds-icon-btn ds-icon-btn--sm" data-action="edit-row" data-plan-id="' + esc(plan.id) + '" data-row-idx="' + idx + '" aria-label="Edit row">' + _iconImg('16-ic-edit') + '</button>'
      + '<button type="button" class="ds-icon-btn ds-icon-btn--sm" data-action="delete-row" data-plan-id="' + esc(plan.id) + '" data-row-idx="' + idx + '" aria-label="Delete row">' + _iconImg('16-ic-trashcan') + '</button>'
      + '</div></td></tr>';
  }).join('');

  const emptyRows = rows.length === 0
    ? '<tr><td colspan="6"><div class="ds-empty"><div class="ds-empty-title">No rows</div>'
      + '<div class="ds-empty-desc">Add the first row below.</div></div></td></tr>'
    : '';

  return headerHtml
    + '<div class="ds-table-wrap"><table class="ds-table">'
    + '<thead><tr><th style="width:28px"></th><th>Topic</th><th>Description</th><th>Who</th><th>When</th><th></th></tr></thead>'
    + '<tbody>' + rowsHtml + emptyRows + '</tbody>'
    + '</table></div>'
    + '<div class="onboarding-table-actions" style="margin-top:8px">'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-action="add-row" data-plan-id="' + esc(plan.id) + '">+ Add row</button>'
    + '</div>';
}

function _paintPlanPanel(root) {
  const panel = root.querySelector('#onboarding-plan-panel');
  if (!panel) return;
  const plan = activePlanOrDefault(_plans, _activePlanId);
  if (plan) panel.setAttribute('aria-labelledby', 'oc-tab-' + plan.id);
  panel.innerHTML = plan ? _planPanelHtml(plan) : '<div class="ds-empty"><div class="ds-empty-title">No plans</div></div>';
  root.querySelectorAll('.ds-tabs-list .ds-tab').forEach((t) => {
    const active = plan && t.dataset.planId === plan.id;
    t.classList.toggle('active', !!active);
    t.setAttribute('aria-selected', active ? 'true' : 'false');
    t.setAttribute('tabindex', active ? '0' : '-1');
  });
  if (plan) {
    const tbody = panel.querySelector('tbody');
    if (tbody) _wireRowDrag(tbody, plan.id, root);
  }
}

function _repaintPlansCard() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;
  const el = root.querySelector('#onboarding-plans-card');
  if (!el) return;
  el.outerHTML = _plansCardHtml();
  _wireActivePlanDrag(root);
}

function _wireActivePlanDrag(root) {
  const panel = root.querySelector('#onboarding-plan-panel');
  if (!panel) return;
  const tbody = panel.querySelector('tbody');
  const plan = activePlanOrDefault(_plans, _activePlanId);
  if (tbody && plan) _wireRowDrag(tbody, plan.id, root);
}

// -- plan / row mutations --------------------------------------------------------

async function _putPlan(id, patch) {
  const data = await _apiFetch('/plans?id=' + encodeURIComponent(id), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
  });
  _plans = _plans.map((p) => (p.id === id ? data.plan : p));
  return data.plan;
}

function _startRename(planId, nameEl) {
  const plan = _plans.find((p) => p.id === planId);
  if (!plan) return;
  const currentName = plan.name;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'ds-input';
  input.value = currentName;
  nameEl.textContent = '';
  nameEl.appendChild(input);
  input.focus();
  input.select();

  let cancelled = false;
  const save = async () => {
    if (cancelled) return;
    const newName = input.value.trim();
    if (!newName || newName === currentName) { nameEl.textContent = currentName; return; }
    nameEl.textContent = newName;
    try {
      await _putPlan(planId, { name: newName });
      _repaintPlansCard(); // the tab button carries the name too
    } catch (err) {
      nameEl.textContent = currentName;
      _toast('danger', 'Could not rename the plan', err.message);
    }
  };
  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    // Removing a focused input fires blur in some browsers - the flag keeps
    // that blur from saving the edit Escape just discarded.
    if (e.key === 'Escape') { cancelled = true; nameEl.textContent = currentName; }
  });
}

async function _addRow(planId, root) {
  const plan = _plans.find((p) => p.id === planId);
  if (!plan) return;
  const rows = (plan.rows || []).concat([{ topic: '', description: '', who: '', when: '' }]);
  try {
    await _putPlan(planId, { rows });
    _paintPlanPanel(root);
  } catch (err) {
    _toast('danger', 'Could not add the row', err.message);
  }
}

async function _deleteRow(planId, rowIdx, root, trigger) {
  const ok = await _confirmDanger({ title: 'Delete this row?', okLabel: 'Delete', danger: true, trigger });
  if (!ok) return;
  const plan = _plans.find((p) => p.id === planId);
  if (!plan) return;
  const rows = (plan.rows || []).filter((_r, i) => i !== rowIdx);
  try {
    await _putPlan(planId, { rows });
    _paintPlanPanel(root);
  } catch (err) {
    _toast('danger', 'Could not delete the row', err.message);
  }
}

async function _toggleDone(planId, rowIdx, root) {
  const plan = _plans.find((p) => p.id === planId);
  if (!plan) return;
  const rows = (plan.rows || []).map((r, i) => (i === rowIdx ? { ...r, done: !r.done } : r));
  try {
    await _putPlan(planId, { rows });
    _paintPlanPanel(root);
  } catch (err) {
    _toast('danger', 'Could not update the row', err.message);
  }
}

async function _deletePlan(id, btn) {
  const ok = await _confirmDanger({ title: 'Delete this plan? This cannot be undone.', okLabel: 'Delete', danger: true, trigger: btn });
  if (!ok) return;
  btn.setAttribute('aria-busy', 'true');
  try {
    await _apiFetch('/plans?id=' + encodeURIComponent(id), { method: 'DELETE', headers: { 'Content-Type': 'application/json' } });
    _plans = _plans.filter((p) => p.id !== id);
    _activePlanId = 'default';
    _persistActivePlan();
    _repaintPlansCard();
    _toast('success', 'Plan deleted');
  } catch (err) {
    _toast('danger', 'Could not delete the plan', err.message);
    btn.removeAttribute('aria-busy');
  }
}

function _wireRowDrag(tbody, planId, root) {
  let dragSrcIdx = null;
  tbody.addEventListener('dragstart', (e) => {
    const tr = e.target.closest('tr[data-row-idx]');
    if (!tr) return;
    dragSrcIdx = parseInt(tr.dataset.rowIdx, 10);
    tr.classList.add('onboarding-row-dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  tbody.addEventListener('dragend', () => {
    tbody.querySelectorAll('tr').forEach((r) => {
      r.classList.remove('onboarding-row-dragging');
      r.classList.remove('onboarding-row-drag-over');
    });
  });
  tbody.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const tr = e.target.closest('tr[data-row-idx]');
    if (!tr) return;
    tbody.querySelectorAll('tr').forEach((r) => r.classList.remove('onboarding-row-drag-over'));
    if (parseInt(tr.dataset.rowIdx, 10) !== dragSrcIdx) tr.classList.add('onboarding-row-drag-over');
  });
  tbody.addEventListener('drop', async (e) => {
    e.preventDefault();
    const tr = e.target.closest('tr[data-row-idx]');
    if (!tr || dragSrcIdx === null) return;
    const dropIdx = parseInt(tr.dataset.rowIdx, 10);
    if (dropIdx === dragSrcIdx) return;
    const plan = _plans.find((p) => p.id === planId);
    if (!plan) return;
    const rows = moveRow(plan.rows || [], dragSrcIdx, dropIdx);
    dragSrcIdx = null;
    try {
      await _putPlan(planId, { rows });
      _paintPlanPanel(root);
    } catch (err) {
      _toast('danger', 'Could not reorder the rows', err.message);
    }
  });
}

// -- person entry (row-edit modal "Who" field) -----------------------------------

function _createPersonEntryEl(initialName, initialEmail, onRemove) {
  const isMember = !!_memberByName(initialName);
  const el = document.createElement('div');
  el.className = 'onboarding-person-entry';
  el.innerHTML = '<div class="onboarding-entry-name-wrap">'
    + '<input type="text" class="ds-input onboarding-entry-name" autocomplete="off" placeholder="Full name" value="' + esc(initialName) + '">'
    + '<div class="onboarding-person-dropdown" hidden></div>'
    + '</div>'
    + '<div class="onboarding-entry-email-wrap"' + (isMember ? ' hidden' : '') + '>'
    + '<input type="email" class="ds-input onboarding-entry-email" autocomplete="off" placeholder="name@example.com" value="' + esc(initialEmail) + '"></div>'
    + '<button type="button" class="ds-icon-btn ds-icon-btn--sm onboarding-entry-remove" aria-label="Remove person">' + _iconImg('16-ic-trashcan') + '</button>';

  const nameInput = el.querySelector('.onboarding-entry-name');
  const dropdown = el.querySelector('.onboarding-person-dropdown');
  const emailWrap = el.querySelector('.onboarding-entry-email-wrap');
  const emailInput = el.querySelector('.onboarding-entry-email');
  const removeBtn = el.querySelector('.onboarding-entry-remove');

  const updateEmailVisibility = (name) => {
    const member = !!_memberByName(name);
    emailWrap.hidden = member;
    if (member) emailInput.value = '';
  };

  const showDropdown = (query) => {
    const members = filterMembers(_teamMembers(), query);
    if (members.length === 0) { dropdown.hidden = true; dropdown.innerHTML = ''; return; }
    dropdown.innerHTML = members.map((m) => {
      const name = _fullName(m);
      return '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm onboarding-person-dropdown-item" data-name="' + esc(name) + '">' + _personChipHtml(name) + '</button>';
    }).join('');
    dropdown.hidden = false;
  };

  nameInput.addEventListener('focus', () => showDropdown(nameInput.value));
  nameInput.addEventListener('input', () => {
    showDropdown(nameInput.value);
    updateEmailVisibility(nameInput.value.trim());
  });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') dropdown.hidden = true; });

  dropdown.addEventListener('click', (e) => {
    const item = e.target.closest('.onboarding-person-dropdown-item');
    if (!item) return;
    nameInput.value = item.dataset.name;
    dropdown.hidden = true;
    updateEmailVisibility(item.dataset.name);
    nameInput.focus();
  });

  removeBtn.addEventListener('click', () => { el.remove(); if (onRemove) onRemove(); });

  return { el, getName: () => nameInput.value.trim(), getEmail: () => emailInput.value.trim() };
}

// -- inline date-range picker ("When" field) --------------------------------------

function _createWhenPicker(container, initialFrom, initialTo) {
  let from = initialFrom || '';
  let to = initialTo || '';
  let step = 0; // 0 = picking start, 1 = picking end
  const now = new Date();
  let viewYear = from ? parseInt(from.slice(0, 4), 10) : now.getFullYear();
  let viewMonth = from ? parseInt(from.slice(5, 7), 10) - 1 : now.getMonth();

  container.className = 'onboarding-when-wrap';
  container.innerHTML = '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-role="trigger">Pick a date</button>'
    + '<button type="button" class="ds-icon-btn ds-icon-btn--sm" data-role="clear" aria-label="Clear">' + _iconImg('16-ic-cross') + '</button>'
    + '<div class="onboarding-cal" data-role="cal" hidden>'
    + '<div class="onboarding-cal-header">'
    + '<button type="button" class="ds-icon-btn ds-icon-btn--sm onboarding-cal-nav" data-role="prev" aria-label="Previous month">&lsaquo;</button>'
    + '<span class="onboarding-cal-title" data-role="title"></span>'
    + '<button type="button" class="ds-icon-btn ds-icon-btn--sm onboarding-cal-nav" data-role="next" aria-label="Next month">&rsaquo;</button>'
    + '</div>'
    + '<div class="onboarding-cal-grid" data-role="grid"></div>'
    + '</div>';

  const trigger = container.querySelector('[data-role="trigger"]');
  const clearBtn = container.querySelector('[data-role="clear"]');
  const cal = container.querySelector('[data-role="cal"]');
  const grid = container.querySelector('[data-role="grid"]');
  const title = container.querySelector('[data-role="title"]');

  function syncTrigger() {
    const label = formatWhen(from + (from ? '|' + to : ''));
    trigger.textContent = label || 'Pick a date';
  }

  function renderGrid() {
    title.textContent = MONTHS_FULL[viewMonth] + ' ' + viewYear;
    const dows = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
    let html = dows.map((d) => '<span class="onboarding-cal-dow">' + d + '</span>').join('');
    const { firstDow, days } = monthGrid(viewYear, viewMonth);
    for (let i = 0; i < firstDow; i++) {
      html += '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm onboarding-cal-day onboarding-cal-day--empty" disabled tabindex="-1"></button>';
    }
    for (let d = 1; d <= days; d++) {
      const iso = viewYear + '-' + pad2(viewMonth + 1) + '-' + pad2(d);
      let cls = 'ds-btn--tertiary ds-btn--sm onboarding-cal-day';
      if (from && to) {
        if (iso === from) cls += ' onboarding-cal-day--range-start';
        if (iso === to) cls += ' onboarding-cal-day--range-end';
        if (iso > from && iso < to) cls += ' onboarding-cal-day--in-range';
      } else if (from && iso === from) {
        cls += ' onboarding-cal-day--range-start onboarding-cal-day--range-end';
      }
      html += '<button type="button" class="ds-btn ' + cls + '" data-date="' + iso + '">' + d + '</button>';
    }
    grid.innerHTML = html;
    grid.querySelectorAll('.onboarding-cal-day[data-date]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const picked = el.dataset.date;
        if (step === 0) {
          from = picked; to = ''; step = 1;
          renderGrid();
        } else {
          if (picked < from) { to = from; from = picked; } else { to = picked; }
          step = 0;
          syncTrigger();
          cal.hidden = true;
          renderGrid();
        }
      });
    });
  }

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !cal.hidden;
    cal.hidden = open;
    if (!open) renderGrid();
  });
  clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    from = ''; to = ''; step = 0;
    syncTrigger();
    cal.hidden = true;
  });
  container.querySelector('[data-role="prev"]').addEventListener('click', (e) => {
    e.stopPropagation();
    viewMonth -= 1; if (viewMonth < 0) { viewMonth = 11; viewYear -= 1; }
    renderGrid();
  });
  container.querySelector('[data-role="next"]').addEventListener('click', (e) => {
    e.stopPropagation();
    viewMonth += 1; if (viewMonth > 11) { viewMonth = 0; viewYear += 1; }
    renderGrid();
  });

  syncTrigger();
  return { getFrom: () => from, getTo: () => to };
}

// -- row-edit modal ------------------------------------------------------------------

function _openRowEditModal(planId, rowIdx, trigger) {
  const plan = _plans.find((p) => p.id === planId);
  if (!plan) return;
  const row = (plan.rows || [])[rowIdx];
  if (!row) return;

  let whenFrom = '';
  let whenTo = '';
  if (row.when && row.when.includes('|')) {
    const parts = row.when.split('|');
    whenFrom = parts[0] || '';
    whenTo = parts[1] || '';
  }
  const whoEntries = parseWhoEntries(row.who || '');

  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay onboarding-modal-overlay';
  overlay.innerHTML = '<div class="ds-modal" role="dialog" aria-modal="true">'
    + '<div class="ds-modal-header"><span class="ds-modal-title">Edit plan row</span>'
    + '<button type="button" class="ds-modal-close" data-close aria-label="Close">&times;</button></div>'
    + '<div class="ds-modal-body">'
    + '<div class="ds-input-wrap"><label class="ds-label">Topic</label>'
    + '<input type="text" class="ds-input" id="oc-row-topic" value="' + esc(row.topic || '') + '"></div>'
    + '<div class="ds-input-wrap" style="margin-top:12px"><label class="ds-label">Description</label>'
    + '<textarea class="ds-textarea" id="oc-row-description" rows="6">' + esc(row.description || '') + '</textarea></div>'
    + '<div class="ds-input-wrap" style="margin-top:12px"><label class="ds-label">Who</label>'
    + '<div id="oc-row-who-list"></div>'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="oc-row-add-person" style="margin-top:8px">+ Add person</button>'
    + '</div>'
    + '<div class="ds-input-wrap" style="margin-top:12px"><label class="ds-label">When</label>'
    + '<div id="oc-row-when-picker"></div>'
    + '</div>'
    + '</div>'
    + '<div class="ds-modal-footer">'
    + '<button type="button" class="ds-btn ds-btn--primary" data-submit>Save</button>'
    + '<button type="button" class="ds-btn ds-btn--tertiary" data-close>Cancel</button>'
    + '</div></div>';
  document.body.appendChild(overlay);

  if (_docClickForDropdown) { document.removeEventListener('click', _docClickForDropdown); _docClickForDropdown = null; }
  _docClickForDropdown = (e) => {
    overlay.querySelectorAll('.onboarding-person-dropdown:not([hidden])').forEach((dd) => {
      const wrap = dd.closest('.onboarding-entry-name-wrap');
      if (wrap && !wrap.contains(e.target)) dd.hidden = true;
    });
  };
  document.addEventListener('click', _docClickForDropdown);

  const close = () => _closeOverlay(overlay, () => {
    if (_docClickForDropdown) { document.removeEventListener('click', _docClickForDropdown); _docClickForDropdown = null; }
  });
  overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  _openOverlay(overlay, trigger);

  const whenPicker = _createWhenPicker(overlay.querySelector('#oc-row-when-picker'), whenFrom, whenTo);

  const personEntries = [];
  const whoList = overlay.querySelector('#oc-row-who-list');
  const addPersonEntry = (name, email) => {
    const entry = _createPersonEntryEl(name || '', email || '', () => {
      const idx = personEntries.indexOf(entry);
      if (idx !== -1) personEntries.splice(idx, 1);
    });
    personEntries.push(entry);
    whoList.appendChild(entry.el);
  };
  whoEntries.forEach((en) => addPersonEntry(en.name, en.email));

  overlay.querySelector('#oc-row-add-person').addEventListener('click', () => {
    addPersonEntry('', '');
    const inputs = whoList.querySelectorAll('.onboarding-entry-name');
    const last = inputs[inputs.length - 1];
    if (last) last.focus();
  });

  const submitBtn = overlay.querySelector('[data-submit]');
  submitBtn.addEventListener('click', async () => {
    const topic = overlay.querySelector('#oc-row-topic').value.trim();
    const description = overlay.querySelector('#oc-row-description').value.trim();
    const od = whenPicker.getFrom();
    const doVal = whenPicker.getTo();
    const who = buildWhoString(
      personEntries.map((en) => ({ name: en.getName(), email: en.getEmail() })),
      (name) => !!_memberByName(name),
    );
    let when = '';
    if (od && doVal) when = od + '|' + doVal;
    else if (od) when = od + '|';
    submitBtn.setAttribute('aria-busy', 'true');
    try {
      const rows = (plan.rows || []).map((r, i) => (i === rowIdx ? { ...r, topic, description, who, when } : r));
      await _putPlan(planId, { rows });
      close();
      const root = document.getElementById(ROOT_ID);
      if (root) _paintPlanPanel(root);
      _toast('success', 'Row saved');
    } catch (err) {
      _toast('danger', 'Could not save the row', err.message);
    } finally {
      submitBtn.removeAttribute('aria-busy');
    }
  });
}

// -- copy-plan modal ------------------------------------------------------------------

function _openCopyPlanModal(trigger) {
  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay onboarding-modal-overlay';
  overlay.innerHTML = '<div class="ds-modal" role="dialog" aria-modal="true">'
    + '<div class="ds-modal-header"><span class="ds-modal-title">Copy the plan for a new person</span>'
    + '<button type="button" class="ds-modal-close" data-close aria-label="Close">&times;</button></div>'
    + '<div class="ds-modal-body"><div class="ds-input-wrap">'
    + '<label class="ds-label">Full name / e-mail</label>'
    + '<input type="text" class="ds-input" id="oc-copy-name" placeholder="e.g. Alex Morgan" autocomplete="off"></div></div>'
    + '<div class="ds-modal-footer">'
    + '<button type="button" class="ds-btn ds-btn--primary" data-submit>Copy</button>'
    + '<button type="button" class="ds-btn ds-btn--tertiary" data-close>Cancel</button>'
    + '</div></div>';
  document.body.appendChild(overlay);
  _openOverlay(overlay, trigger);
  const close = () => _closeOverlay(overlay);
  overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));

  const submitBtn = overlay.querySelector('[data-submit]');
  submitBtn.addEventListener('click', async () => {
    const input = overlay.querySelector('#oc-copy-name');
    const name = input.value.trim();
    input.classList.toggle('ds-input--error', !name);
    if (!name) return;
    submitBtn.setAttribute('aria-busy', 'true');
    try {
      const data = await _apiFetch('/plans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
      });
      _plans = sortPlans(_plans.concat([data.plan]));
      _activePlanId = data.plan.id;
      _persistActivePlan();
      close();
      _repaintPlansCard();
      _toast('success', 'Plan copied');
    } catch (err) {
      _toast('danger', 'Could not copy the plan', err.message);
    } finally {
      submitBtn.removeAttribute('aria-busy');
    }
  });
}

// -- "schedule a session" (session draft) modal -----------------------------------------------

function _openSessionDraftModal(planId, rowIdx, trigger) {
  const plan = _plans.find((p) => p.id === planId);
  if (!plan) return;
  const row = (plan.rows || [])[rowIdx];
  if (!row) return;

  const recipients = recipientEmails(row.who || '', (name) => {
    const m = _memberByName(name);
    return m ? (m.email || '') : '';
  });
  const defaultTopic = row.topic ? ('Session: ' + row.topic) : ('Onboarding session' + (plan.name ? (' - ' + plan.name) : ''));
  const defaultMessage = sessionDraftText(row, plan);

  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay onboarding-modal-overlay';
  overlay.innerHTML = '<div class="ds-modal" role="dialog" aria-modal="true">'
    + '<div class="ds-modal-header"><span class="ds-modal-title">Schedule a session</span>'
    + '<button type="button" class="ds-modal-close" data-close aria-label="Close">&times;</button></div>'
    + '<div class="ds-modal-body">'
    + '<div class="ds-input-wrap"><label class="ds-label">Recipients</label>'
    + '<div class="onboarding-session-recipient-list">'
    + (recipients.length > 0
      ? recipients.map((email) => '<span class="onboarding-session-recipient">' + esc(email) + '</span>').join('')
      : '<span class="onboarding-session-empty">No e-mail address for this row.</span>')
    + '</div></div>'
    + '<div class="ds-input-wrap" style="margin-top:12px"><label class="ds-label">Chat topic</label>'
    + '<input type="text" class="ds-input" id="oc-session-topic" value="' + esc(defaultTopic) + '"></div>'
    + '<div class="ds-input-wrap" style="margin-top:12px"><label class="ds-label">Message draft</label>'
    + '<textarea class="ds-textarea" id="oc-session-message" rows="8">' + esc(defaultMessage) + '</textarea></div>'
    + '<div class="onboarding-session-hint">Teams opens the chat as a draft. The message is not sent automatically.</div>'
    + '</div>'
    + '<div class="ds-modal-footer">'
    + '<button type="button" class="ds-btn ds-btn--primary" id="oc-session-open"' + (recipients.length === 0 ? ' disabled' : '') + '>Open in Teams</button>'
    + '<button type="button" class="ds-btn ds-btn--secondary" id="oc-session-copy">Copy draft</button>'
    + '</div></div>';
  document.body.appendChild(overlay);
  _openOverlay(overlay, trigger);
  const close = () => _closeOverlay(overlay);
  overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));

  const topicInput = overlay.querySelector('#oc-session-topic');
  const messageInput = overlay.querySelector('#oc-session-message');
  const copyBtn = overlay.querySelector('#oc-session-copy');
  const openBtn = overlay.querySelector('#oc-session-open');

  copyBtn.addEventListener('click', async () => {
    copyBtn.setAttribute('aria-busy', 'true');
    try {
      await navigator.clipboard.writeText(messageInput.value.trim());
      _toast('success', 'Draft copied');
    } catch (err) {
      _toast('danger', 'Could not copy the draft', err.message);
    } finally {
      copyBtn.removeAttribute('aria-busy');
    }
  });

  openBtn.addEventListener('click', () => {
    const url = buildTeamsDraftUrl(recipients, topicInput.value.trim(), messageInput.value.trim());
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  });
}

// -- HTML export ------------------------------------------------------------------------

async function _fetchAsDataUrl(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

async function _exportPlanToHtml(plan) {
  const rows = plan.rows || [];
  const avatarCache = new Map();
  const resolvedRows = [];
  for (const row of rows) {
    const whoParts = String(row.who || '').split(/\s*,\s*/).filter(Boolean);
    const people = [];
    for (const part of whoParts) {
      const clean = part.replace(/\s*\([^)]*\)\s*/g, '').trim();
      if (!clean) continue;
      const member = _memberByName(clean);
      const words = clean.split(/\s+/).filter(Boolean);
      const initials = words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
      let avatarDataUrl = null;
      const avatarUrl = member ? _memberAvatarUrl(member) : '';
      if (avatarUrl) {
        if (avatarCache.has(avatarUrl)) {
          avatarDataUrl = avatarCache.get(avatarUrl);
        } else {
          avatarDataUrl = await _fetchAsDataUrl(avatarUrl);
          avatarCache.set(avatarUrl, avatarDataUrl);
        }
      }
      const emailMatch = /\(([^)@]+@[^)]+)\)/.exec(part);
      const email = member && member.email ? member.email : (emailMatch ? emailMatch[1] : '');
      people.push({ displayName: clean, initials, email, avatarDataUrl });
    }
    resolvedRows.push({ row, people, whenText: formatWhen(row.when || '') });
  }
  const now = new Date();
  const generatedAtText = now.toLocaleString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  const html = buildPlanExportHtml(plan, resolvedRows, generatedAtText);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = String(plan.name || 'plan').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
  a.download = 'onboarding_' + safeName + '.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// -- paint --------------------------------------------------------------------------

function _paint(root) {
  if (_loadError) { root.innerHTML = _errorCalloutHtml(); return; }
  if (!_loaded) { root.innerHTML = _skeletonHtml(); return; }
  const empty = _storage === 'ok' && _links.length === 0 && _plans.length === 0;
  root.innerHTML = _introHtml() + (empty ? _emptyRepoCalloutHtml() : '') + _linksCardHtml() + _plansCardHtml();
}

// -- delegated listeners --------------------------------------------------------------

async function _onRootClick(e, root) {
  const addLinkBtn = e.target.closest('[data-action="add-link"]');
  if (addLinkBtn) { _openLinkModal(null, addLinkBtn); return; }

  const editLinkBtn = e.target.closest('[data-action="edit-link"]');
  if (editLinkBtn) {
    const link = _links.find((l) => l.id === editLinkBtn.dataset.id);
    if (link) _openLinkModal(link, editLinkBtn);
    return;
  }

  const delLinkBtn = e.target.closest('[data-action="delete-link"]');
  if (delLinkBtn) { _deleteLink(delLinkBtn.dataset.id, delLinkBtn); return; }

  const navBtn = e.target.closest('[data-action="navigate-view"]');
  if (navBtn) {
    const viewId = navBtn.dataset.viewId;
    if (viewId && _deps && typeof _deps.navigate === 'function') _deps.navigate(viewId);
    return;
  }

  const tabBtn = e.target.closest('.ds-tab[data-plan-id]');
  if (tabBtn) {
    _activePlanId = tabBtn.dataset.planId;
    _persistActivePlan();
    _paintPlanPanel(root);
    return;
  }

  const renameBtn = e.target.closest('[data-action="rename-plan"]');
  if (renameBtn) {
    const nameEl = root.querySelector('.onboarding-plan-name-text[data-plan-id="' + CSS.escape(renameBtn.dataset.id) + '"]');
    if (nameEl) _startRename(renameBtn.dataset.id, nameEl);
    return;
  }

  const exportBtn = e.target.closest('[data-action="export-plan"]');
  if (exportBtn) {
    const plan = _plans.find((p) => p.id === exportBtn.dataset.id);
    if (!plan) return;
    exportBtn.setAttribute('aria-busy', 'true');
    try {
      await _exportPlanToHtml(plan);
      _toast('success', 'File downloaded');
    } catch (err) {
      _toast('danger', 'Could not export the plan', err.message);
    } finally {
      exportBtn.removeAttribute('aria-busy');
    }
    return;
  }

  const delPlanBtn = e.target.closest('[data-action="delete-plan"]');
  if (delPlanBtn) { _deletePlan(delPlanBtn.dataset.id, delPlanBtn); return; }

  const addRowBtn = e.target.closest('[data-action="add-row"]');
  if (addRowBtn) { _addRow(addRowBtn.dataset.planId, root); return; }

  const delRowBtn = e.target.closest('[data-action="delete-row"]');
  if (delRowBtn) { _deleteRow(delRowBtn.dataset.planId, parseInt(delRowBtn.dataset.rowIdx, 10), root, delRowBtn); return; }

  const toggleBtn = e.target.closest('[data-action="toggle-done"]');
  if (toggleBtn) { _toggleDone(toggleBtn.dataset.planId, parseInt(toggleBtn.dataset.rowIdx, 10), root); return; }

  const draftBtn = e.target.closest('[data-action="draft-session"]');
  if (draftBtn) { _openSessionDraftModal(draftBtn.dataset.planId, parseInt(draftBtn.dataset.rowIdx, 10), draftBtn); return; }

  const editRowBtn = e.target.closest('[data-action="edit-row"]');
  if (editRowBtn) { _openRowEditModal(editRowBtn.dataset.planId, parseInt(editRowBtn.dataset.rowIdx, 10), editRowBtn); return; }

  const reloadBtn = e.target.closest('[data-action="reload-data"]');
  if (reloadBtn) {
    reloadBtn.setAttribute('aria-busy', 'true');
    await _loadData();
    _paint(root);
    _wireActivePlanDrag(root);
  }
}

// Keyboard twin of the drag handle (Alt+ArrowUp/ArrowDown moves the row) and of the tablist (ArrowLeft/ArrowRight switches
// tabs) - everything a mouse reaches, a keyboard reaches too (conventions 2c).
function _onRootKeydown(e, root) {
  const handle = e.target.closest && e.target.closest('[data-action="drag-handle"]');
  if (handle && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    const planId = handle.dataset.planId;
    const rowIdx = parseInt(handle.dataset.rowIdx, 10);
    const plan = _plans.find((p) => p.id === planId);
    if (!plan) return;
    const rows = plan.rows || [];
    const to = rowIdx + (e.key === 'ArrowUp' ? -1 : 1);
    if (to < 0 || to >= rows.length) return;
    const newRows = moveRow(rows, rowIdx, to);
    _putPlan(planId, { rows: newRows }).then(() => {
      _paintPlanPanel(root);
      const btn = root.querySelector('[data-action="drag-handle"][data-plan-id="' + CSS.escape(planId) + '"][data-row-idx="' + to + '"]');
      if (btn) btn.focus();
    }).catch((err) => _toast('danger', 'Could not reorder the rows', err.message));
    return;
  }

  const tab = e.target.closest && e.target.closest('.ds-tab[role="tab"]');
  if (tab && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    e.preventDefault();
    const tabs = Array.from(root.querySelectorAll('.ds-tabs-list .ds-tab'));
    const idx = tabs.indexOf(tab);
    if (idx === -1) return;
    const nextIdx = e.key === 'ArrowLeft' ? (idx - 1 + tabs.length) % tabs.length : (idx + 1) % tabs.length;
    const nextTab = tabs[nextIdx];
    if (!nextTab) return;
    _activePlanId = nextTab.dataset.planId;
    _persistActivePlan();
    _paintPlanPanel(root);
    const newTab = root.querySelector('.ds-tab[data-plan-id="' + CSS.escape(_activePlanId) + '"]');
    if (newTab) newTab.focus();
  }
}

function _onActionsClick(e) {
  const btn = e.target.closest('[data-action="copy-plan"]');
  if (btn) _openCopyPlanModal(btn);
}

function _paintActions() {
  const actions = document.getElementById(ACTIONS_ID);
  if (!actions) return;
  actions.innerHTML = '<button type="button" class="ds-btn ds-btn--primary" data-action="copy-plan">Copy the plan for a new person</button>';
}

// -- wiring (idempotent, dropped in registerViewCleanup on every exit) --------------

function _ensureWired(root) {
  if (!_wired) {
    _wired = true;
    const onClick = (e) => { _onRootClick(e, root); };
    const onKeydown = (e) => { _onRootKeydown(e, root); };
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', onKeydown);
    if (_deps && typeof _deps.registerViewCleanup === 'function') {
      _deps.registerViewCleanup(() => {
        root.removeEventListener('click', onClick);
        root.removeEventListener('keydown', onKeydown);
        _wired = false;
      });
    }
  }

  const actions = document.getElementById(ACTIONS_ID);
  if (actions && !_actionsWired) {
    _actionsWired = true;
    const onActionsClick = (e) => _onActionsClick(e);
    actions.addEventListener('click', onActionsClick);
    if (_deps && typeof _deps.registerViewCleanup === 'function') {
      _deps.registerViewCleanup(() => {
        actions.removeEventListener('click', onActionsClick);
        _actionsWired = false;
      });
    }
  }

  if (!_teardownWired && _deps && typeof _deps.registerViewCleanup === 'function') {
    _teardownWired = true;
    _deps.registerViewCleanup(() => {
      _teardownWired = false;
      if (_docClickForDropdown) { document.removeEventListener('click', _docClickForDropdown); _docClickForDropdown = null; }
      document.querySelectorAll('.onboarding-modal-overlay').forEach((overlay) => {
        if (_dsModal && typeof _dsModal.closeDsModal === 'function') _dsModal.closeDsModal(overlay);
        overlay.remove();
      });
    });
  }
}

// -- view -----------------------------------------------------------------------------

export const views = {

  'onboarding-main': {
    /** @param {{ navigate, registerViewCleanup, showToast, apiBase }} deps */
    init(deps) {
      _deps = deps;

      // Dynamic on purpose - this file is imported by the contract test in
      // plain Node with no document and no /js/... URL resolver.
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
      _paintActions();
      if (!_loaded) root.innerHTML = _skeletonHtml();
      await _loadData();
      const stillHere = document.getElementById(ROOT_ID);
      if (!stillHere) return; // navigated away while the fetch was in flight
      _mounted = true;
      _paint(stillHere);
      _wireActivePlanDrag(stillHere);
      _ensureWired(stillHere);
    },

    // Opt-out of the core's re-entry on cockpit:data-changed (a pull, or one
    // of this view's own writes - see _apiFetch): re-read in place, and skip
    // the repaint when nothing changed, so an open inline edit, the active
    // plan tab and the keyboard focus all stay where they are.
    async onDataChanged() {
      const root = document.getElementById(ROOT_ID);
      if (!root || !_mounted) return;
      const before = _snapshotData();
      await _loadData();
      const stillHere = document.getElementById(ROOT_ID);
      if (!stillHere) return;
      if (before !== null && _snapshotData() === before) return;
      _paint(stillHere);
      _wireActivePlanDrag(stillHere);
      _ensureWired(stillHere);
    },
  },
};
