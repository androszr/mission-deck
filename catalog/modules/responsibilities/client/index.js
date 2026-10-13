// modules/responsibilities/client/index.js
// Responsibilities - RAG matrix per project. One view, four project tabs
// (subPath: main | web | mobile | platform).
//
// Read-only mode: the matrix lives in the team data plaintext tree. While
// GET /api/sync-overview says canPush === false for data-tier-0 (or does not
// answer) an edit could never reach the team and a later pull would
// overwrite it, so every editing control is disabled and the client never
// calls POST /prepare. See README.md.
//
// Core helpers (/js/ds-modal.js, /js/empty-state.js, /js/ds-select.js) are
// imported dynamically in init(): this file must stay importable in plain
// Node for the contract test.

import {
  PROJECTS, STATUS_LABELS, isValidProject, monthLabel, defaultMonth,
  monthWindow, timelineMonths, countsForMonth, groupCounts,
} from './responsibilities-lib.js';

const VIEW_ID = 'responsibilities-main';
const ROOT_ID = VIEW_ID + '-root';
const ACTIONS_ID = VIEW_ID + '-actions';
const PANEL_ID = 'odp-panel';
const ICON_BASE = '/assets/icons/ds/';
const READONLY_TEXT = 'This computer cannot send team data to the team yet - the view is read-only so that no rating gets lost.';

let _deps = null;
let _dsModal = null;
let _emptyState = null;
let _dsSelect = null;

let _project = 'main';
let _data = null;          // the loaded matrix of _project, or null
let _phase = 'loading';    // loading | ready | unavailable | missing | corrupt | error
let _canWrite = false;
let _month = '';
let _showAll = false;
const _collapsed = new Set();
let _seq = 0;
let _mounted = false;

let _wiredRoot = null;
let _wiredActions = null;
let _onRootClick = null;
let _onRootInput = null;
let _onActionsClick = null;
let _saveTimer = null;
let _pendingSave = null;
let _reloadOnBlur = false; // a data change arrived while an actions textarea had focus
let _modalEl = null;

// -- small helpers ------------------------------------------------------------

function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _api(p) { return (_deps && _deps.apiBase ? _deps.apiBase : '/api/m/responsibilities') + p; }

function _toast(variant, title, desc) {
  if (_deps && typeof _deps.showToast === 'function') _deps.showToast(variant, title, desc || '');
}

function _icon(name) {
  return '<img class="nav-icon" src="' + ICON_BASE + name + '.svg" alt="">';
}

function _dis() { return _canWrite ? '' : ' disabled'; }

function _groups() { return (_data && Array.isArray(_data.groups)) ? _data.groups : []; }

function _findGroup(id) { return _groups().find((g) => g.id === id) || null; }

function _findArea(group, id) { return group ? (group.areas || []).find((a) => a.id === id) || null : null; }

function _ownerSuggestions() {
  const set = new Set();
  _groups().forEach((g) => (g.areas || []).forEach((a) => { if (a.owner) set.add(a.owner); }));
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'en'));
}

// -- network --------------------------------------------------------------------

async function _post(path, body) {
  try {
    const res = await fetch(_api(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ project: _project }, body)),
    });
    let json = {};
    try { json = await res.json(); } catch { json = {}; }
    return { ok: res.ok, json };
  } catch (e) {
    return { ok: false, json: { message: 'No connection to Mission Deck.' }, netError: e };
  }
}

async function _readCanWrite() {
  try {
    const res = await fetch('/api/sync-overview');
    if (!res.ok) return false;
    const payload = await res.json();
    const row = ((payload && payload.repos) || []).find((r) => r.repo === 'data-tier-0');
    return !!row && row.canPush === true;
  } catch {
    return false;
  }
}

async function _fetchData(project) {
  const res = await fetch(_api('/data?project=' + encodeURIComponent(project)));
  if (!res.ok) throw new Error('The server answered ' + res.status);
  return res.json();
}

function _applyPayload(payload) {
  if (payload && payload.available && payload.data) {
    _data = payload.data;
    _phase = 'ready';
    return;
  }
  _data = null;
  if (payload && payload.storage === 'unavailable') _phase = 'unavailable';
  else if (payload && payload.reason === 'corrupt') _phase = 'corrupt';
  else _phase = 'missing';
}

function _pickMonth() {
  const months = (_data && _data.months) || [];
  if (!_month || !months.includes(_month)) _month = defaultMonth(months, new Date());
}

/** Loads the matrix of the current project; keeps month and collapsed groups. */
async function _load(root, opts) {
  const seq = ++_seq;
  const project = _project;
  const withSetup = !!(opts && opts.setup);
  let payload = null;
  let error = null;
  try {
    if (withSetup) {
      const [canWrite, first] = await Promise.all([_readCanWrite(), _fetchData(project)]);
      if (seq !== _seq) return;
      _canWrite = canWrite;
      payload = first;
      if (_canWrite) {
        const prep = await _post('/prepare', {});
        if (seq !== _seq) return;
        if (prep.ok && prep.json && (prep.json.initialized || prep.json.monthsAdded > 0)) {
          payload = await _fetchData(project);
        }
      }
    } else {
      payload = await _fetchData(project);
    }
  } catch (e) {
    error = e;
  }
  if (seq !== _seq) return;
  if (error) {
    _data = null;
    _phase = 'error';
    _paint(root);
    _toast('danger', 'Could not load responsibilities', error.message || '');
    return;
  }
  _applyPayload(payload);
  _pickMonth();
  _paint(root);
}

// -- markup -----------------------------------------------------------------------

function _skeletonHtml() {
  return '<div data-skel="1">'
    + '<div class="ds-skeleton odp-skel-tabs"></div>'
    + '<div class="ds-skeleton odp-skel-months"></div>'
    + '<div class="ds-skeleton odp-skel-card"></div>'
    + '<div class="ds-skeleton odp-skel-card"></div>'
    + '</div>';
}

function _paintActionsSkeleton() {
  const actions = document.getElementById(ACTIONS_ID);
  if (actions) actions.innerHTML = '<div class="ds-skeleton odp-skel-actions" data-skel="1"></div>';
}

function _paintActions() {
  const actions = document.getElementById(ACTIONS_ID);
  if (!actions) return;
  const noGroups = _groups().length === 0;
  const editable = _canWrite && (_phase === 'ready' || _phase === 'missing');
  const addGroupDis = editable ? '' : ' disabled';
  const addAreaDis = (editable && !noGroups) ? '' : ' disabled';
  actions.innerHTML =
    '<button type="button" class="ds-btn ds-btn--primary" data-odp-add-group' + addGroupDis + '>Add group</button>'
    + '<button type="button" class="ds-btn ds-btn--secondary" data-odp-add-area' + addAreaDis
    + (noGroups ? ' title="Add a group first - areas have to belong to a group"' : '')
    + '>Add area</button>';
}

function _tabsHtml() {
  return '<div class="ds-tabs-list odp-tabs" role="tablist" aria-label="Project">'
    + PROJECTS.map((p) => {
      const on = p.id === _project;
      return '<button type="button" class="ds-tab' + (on ? ' active' : '') + '" role="tab" id="odp-tab-' + p.id + '"'
        + ' aria-selected="' + on + '" aria-controls="' + PANEL_ID + '" tabindex="' + (on ? '0' : '-1') + '"'
        + ' data-odp-tab="' + p.id + '">' + esc(p.label) + '</button>';
    }).join('')
    + '</div>';
}

function _introHtml() {
  return '<p class="odp-intro">The responsibility matrix shows which areas run smoothly (G), have challenges (A) '
    + 'or need action (R), and who owns them.</p>'
    + '<p class="odp-intro">The rating is set per month with one click. Status R requires writing down what needs to be done.</p>';
}

function _metaHtml() {
  const meta = (_data && _data.meta) || {};
  const c = countsForMonth(_data, _month);
  const updated = meta.last_updated ? String(meta.last_updated).slice(0, 16).replace('T', ' ') : '-';
  return '<div class="odp-meta">Last updated: ' + esc(updated) + ' &middot; ' + c.total + ' areas'
    + ' | ' + c.red + ' need action | ' + c.amber + ' challenges | ' + c.green + ' OK</div>';
}

function _monthBarHtml() {
  const w = monthWindow(_data.months, _month, _showAll);
  let html = '<div class="odp-month-bar"><span class="odp-month-label">Month:</span>';
  if (w.hiddenCount > 0) {
    html += '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-odp-earlier>&larr; Earlier (' + w.hiddenCount + ')</button>';
  }
  if (w.canCollapse) {
    html += '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-odp-collapse-months>Collapse &rarr;</button>';
  }
  html += '<div class="ds-segmented" role="group" aria-label="Month">'
    + w.visible.map((m) => '<button type="button" class="ds-segment' + (m === _month ? ' active' : '') + '"'
      + ' aria-pressed="' + (m === _month) + '" data-odp-month="' + esc(m) + '">' + esc(monthLabel(m)) + '</button>').join('')
    + '</div></div>';
  return html;
}

function _ragHtml(area, groupId, status) {
  const defs = [['red', 'R'], ['amber', 'A'], ['green', 'G']];
  return '<div class="ds-segmented odp-rag" role="group" aria-label="Status: ' + esc(area.name) + '"'
    + ' data-odp-area="' + esc(area.id) + '" data-odp-group="' + esc(groupId) + '">'
    + defs.map(([key, letter]) => '<button type="button" class="ds-segment odp-rag-' + key + '"'
      + ' aria-pressed="' + (status === key) + '" aria-label="' + esc(STATUS_LABELS[key]) + '"'
      + ' data-odp-status="' + key + '"' + _dis() + '>' + letter + '</button>').join('')
    + '</div>';
}

function _trendHtml(area, keys) {
  return '<div class="odp-trend">' + keys.map((m) => {
    const r = area.ratings && area.ratings[m];
    const s = r && r.status ? r.status : null;
    const label = s ? STATUS_LABELS[s] : 'Not rated';
    return '<span class="odp-trend-cell odp-trend-' + (s || 'unset') + '" role="img" aria-label="'
      + esc(monthLabel(m) + ': ' + label) + '"></span>';
  }).join('') + '</div>';
}

function _areaRowsHtml(group, keys) {
  return (group.areas || []).map((area) => {
    const rating = area.ratings && area.ratings[_month];
    const status = rating ? rating.status : null;
    const actions = rating ? rating.actions : null;
    const gid = esc(group.id);
    let html = '<tr>'
      + '<td><div class="odp-area-cell"><div class="odp-area-text">'
      + '<div class="odp-area-name">' + esc(area.name) + '</div>'
      + (area.description ? '<div class="odp-area-desc" aria-label="' + esc(area.description) + '">' + esc(area.description) + '</div>' : '')
      + '</div><div class="odp-row-actions">'
      + '<button type="button" class="ds-icon-btn ds-icon-btn--sm" aria-label="Edit area ' + esc(area.name) + '"'
      + ' data-odp-edit-area="' + esc(area.id) + '" data-odp-area-group="' + gid + '"' + _dis() + '>' + _icon('16-ic-edit') + '</button>'
      + '<button type="button" class="ds-icon-btn ds-icon-btn--sm" aria-label="Delete area ' + esc(area.name) + '"'
      + ' data-odp-delete-area="' + esc(area.id) + '" data-odp-area-group="' + gid + '"' + _dis() + '>' + _icon('16-ic-trashcan') + '</button>'
      + '</div></div></td>'
      + '<td><span class="odp-owner">' + (esc(area.owner) || '-') + '</span></td>'
      + '<td>' + _ragHtml(area, group.id, status) + '</td>'
      + '<td>' + _trendHtml(area, keys) + '</td></tr>';
    if (status === 'red') {
      html += '<tr class="odp-action-row"><td colspan="4">'
        + '<div class="ds-callout ds-callout--danger"><div class="odp-action-wrap">'
        + '<label class="ds-label" for="odp-actions-' + esc(area.id) + '">Actions to take (required):</label>'
        + '<textarea class="ds-textarea" id="odp-actions-' + esc(area.id) + '" rows="2"'
        + ' data-odp-actions data-odp-area="' + esc(area.id) + '" data-odp-group="' + gid + '"'
        + ' placeholder="Describe what action is needed..."' + _dis() + '>' + esc(actions || '') + '</textarea>'
        + '</div></div></td></tr>';
    }
    return html;
  }).join('');
}

function _groupCardHtml(group, keys) {
  const gc = groupCounts(group, _month);
  const collapsed = _collapsed.has(group.id);
  const bodyId = 'odp-group-' + group.id;
  const gid = esc(group.id);
  return '<div class="ds-card odp-group">'
    + '<div class="ds-section-head odp-group-head">'
    + '<h3 class="ds-section-head-title"><button type="button" class="ds-row-toggle" aria-expanded="' + (!collapsed) + '"'
    + ' aria-controls="' + esc(bodyId) + '" data-odp-toggle="' + gid + '">'
    + '<span class="ds-row-toggle-chevron" aria-hidden="true">&#9654;</span>'
    + '<span>' + esc(group.name) + '</span>'
    + '<span class="odp-group-count">(' + (group.areas || []).length + ')</span></button></h3>'
    + '<div class="ds-section-head-actions">'
    + '<span class="ds-badge ds-badge--sm ds-badge--red" aria-label="' + gc.red + ' need action">' + gc.red + ' R</span>'
    + '<span class="ds-badge ds-badge--sm ds-badge--yellow" aria-label="' + gc.amber + ' challenges">' + gc.amber + ' A</span>'
    + '<span class="ds-badge ds-badge--sm ds-badge--green" aria-label="' + gc.green + ' OK">' + gc.green + ' G</span>'
    + '<button type="button" class="ds-icon-btn ds-icon-btn--sm" aria-label="Add area to group" data-odp-add-area-to="' + gid + '"' + _dis() + '>' + _icon('16-ic-add') + '</button>'
    + '<button type="button" class="ds-icon-btn ds-icon-btn--sm" aria-label="Rename group" data-odp-edit-group="' + gid + '"' + _dis() + '>' + _icon('16-ic-edit') + '</button>'
    + '<button type="button" class="ds-icon-btn ds-icon-btn--sm" aria-label="Delete group" data-odp-delete-group="' + gid + '"' + _dis() + '>' + _icon('16-ic-trashcan') + '</button>'
    + '</div></div>'
    + '<div id="' + esc(bodyId) + '"' + (collapsed ? ' hidden' : '') + '>'
    + '<div class="ds-table-wrap"><table class="ds-table odp-table">'
    + '<colgroup><col class="odp-col-area"><col class="odp-col-owner"><col class="odp-col-status"><col class="odp-col-trend"></colgroup>'
    + '<thead><tr><th>Area</th><th>Owner</th><th>Status</th><th>Trend</th></tr></thead>'
    + '<tbody>' + _areaRowsHtml(group, keys) + '</tbody></table></div></div></div>';
}

function _emptyHtml(hasShell) {
  const title = hasShell ? 'No responsibility groups' : 'No responsibility data';
  const message = hasShell
    ? 'Add the first group (e.g. Teams, Processes), then assign areas with owners to it.'
    : 'The file does not exist on this computer yet. Add the first group to create it.';
  let hero = '';
  if (_emptyState && typeof _emptyState.emptyHeroHtml === 'function') {
    hero = _emptyState.emptyHeroHtml({ title, message });
  } else {
    hero = '<div class="ds-callout ds-callout--info"><div><strong>' + esc(title) + '</strong><br>' + esc(message) + '</div></div>';
  }
  return hero + '<div class="odp-empty-cta"><button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-odp-add-group'
    + _dis() + '>Add group</button></div>';
}

function _bodyHtml() {
  if (_phase === 'unavailable') {
    return '<div class="ds-callout ds-callout--info"><div>The team data source is not pulled on this computer - open Sync in the top bar.</div></div>';
  }
  if (_phase === 'corrupt') {
    return '<div class="ds-callout ds-callout--danger"><div>The responsibilities file is corrupt and was not changed. Pull the team data again in Sync.</div></div>';
  }
  if (_phase === 'error') {
    return '<div class="ds-callout ds-callout--danger"><div>Could not load the data. Refresh the view to try again.</div></div>';
  }
  if (_phase !== 'ready' || _groups().length === 0) {
    return _emptyHtml(_phase === 'ready');
  }
  const keys = timelineMonths(new Date());
  return _metaHtml() + _introHtml() + _monthBarHtml()
    + '<div class="odp-groups">' + _groups().map((g) => _groupCardHtml(g, keys)).join('') + '</div>';
}

function _paint(root) {
  if (!root) return;
  const readOnly = !_canWrite
    ? '<div class="ds-callout ds-callout--warning odp-readonly"><div>' + esc(READONLY_TEXT) + '</div></div>'
    : '';
  root.innerHTML = readOnly + _tabsHtml()
    + '<div role="tabpanel" id="' + PANEL_ID + '" aria-labelledby="odp-tab-' + _project + '">' + _bodyHtml() + '</div>';
  _paintActions();
  _wire(root);
}

// -- modals -----------------------------------------------------------------------

function _closeModal() {
  if (!_modalEl) return;
  const el = _modalEl;
  _modalEl = null;
  if (_dsModal && typeof _dsModal.closeDsModal === 'function') _dsModal.closeDsModal(el);
  if (el.parentNode) el.parentNode.removeChild(el);
}

function _openOverlay(html, trigger) {
  _closeModal();
  const el = document.createElement('div');
  el.className = 'ds-modal-overlay';
  el.hidden = true;
  el.innerHTML = html;
  document.body.appendChild(el);
  _modalEl = el;
  if (_dsModal && typeof _dsModal.openDsModal === 'function') _dsModal.openDsModal(el, { trigger });
  else { el.hidden = false; el.classList.add('open'); }
  // A closed modal (Escape, overlay) must not leave a detached node behind.
  const obs = new MutationObserver(() => {
    if (!el.classList.contains('open') && _modalEl === el) {
      _modalEl = null;
      obs.disconnect();
      if (el.parentNode) el.parentNode.removeChild(el);
    }
  });
  obs.observe(el, { attributes: true, attributeFilter: ['class'] });
  return el;
}

function _modalShell(id, title, bodyHtml, footerHtml) {
  return '<div class="ds-modal ds-modal--md" role="dialog" aria-modal="true" aria-labelledby="' + id + '-title">'
    + '<form data-odp-form novalidate>'
    + '<div class="ds-modal-header"><span class="ds-modal-title" id="' + id + '-title">' + esc(title) + '</span>'
    + '<button type="button" class="ds-modal-close" data-odp-modal-close aria-label="Close">&times;</button></div>'
    + '<div class="ds-modal-body odp-form">' + bodyHtml + '</div>'
    + footerHtml + '</form></div>';
}

function _field(id, label, inner) {
  return '<div class="ds-input-wrap"><label class="ds-label" for="' + id + '">' + label + '</label>' + inner + '</div>';
}

function _openGroupModal(group, trigger) {
  const isNew = !group;
  const body = _field('odp-f-gname', 'Group name *',
    '<input type="text" class="ds-input" id="odp-f-gname" maxlength="500" autocomplete="off" value="' + esc(group ? group.name : '') + '">');
  const footer = '<div class="ds-modal-footer">'
    + '<button type="submit" class="ds-btn ds-btn--primary">Save</button>'
    + '<button type="button" class="ds-btn ds-btn--secondary" data-odp-modal-close>Cancel</button>'
    + (isNew ? '' : '<button type="button" class="ds-btn ds-btn--danger" data-odp-modal-delete>Delete</button>')
    + '</div>';
  const el = _openOverlay(_modalShell('odp-gm', isNew ? 'Add group' : 'Edit group', body, footer), trigger);
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-odp-modal-close]')) { _closeModal(); return; }
    if (e.target.closest('[data-odp-modal-delete]')) { _deleteGroup(group, e.target); }
  });
  el.addEventListener('submit', (e) => { e.preventDefault(); _saveGroup(group); });
  const input = el.querySelector('#odp-f-gname');
  if (input) input.focus();
}

function _openAreaModal({ area, group, trigger }) {
  const isNew = !area;
  const groups = _groups();
  const options = '<option value="">- choose -</option>' + groups.map((g) =>
    '<option value="' + esc(g.id) + '"' + (group && g.id === group.id ? ' selected' : '') + '>' + esc(g.name) + '</option>').join('');
  const body = _field('odp-f-name', 'Area *',
    '<input type="text" class="ds-input" id="odp-f-name" maxlength="500" autocomplete="off" value="' + esc(area ? area.name : '') + '">')
    + '<div class="odp-form-row">'
    + _field('odp-f-group', 'Group *', '<select class="ds-input" id="odp-f-group">' + options + '</select>')
    + _field('odp-f-owner', 'Owner *',
      '<input type="text" class="ds-input" id="odp-f-owner" maxlength="500" list="odp-owners" autocomplete="off"'
      + ' placeholder="Choose or type" value="' + esc(area ? area.owner : '') + '">'
      + '<datalist id="odp-owners">' + _ownerSuggestions().map((o) => '<option value="' + esc(o) + '"></option>').join('') + '</datalist>')
    + '</div>'
    + _field('odp-f-desc', 'Description',
      '<textarea class="ds-textarea" id="odp-f-desc" rows="3" maxlength="2000">' + esc(area ? area.description : '') + '</textarea>');
  const footer = '<div class="ds-modal-footer">'
    + '<button type="submit" class="ds-btn ds-btn--primary">Save</button>'
    + '<button type="button" class="ds-btn ds-btn--secondary" data-odp-modal-close>Cancel</button>'
    + (isNew ? '' : '<button type="button" class="ds-btn ds-btn--danger" data-odp-modal-delete>Delete</button>')
    + '</div>';
  const el = _openOverlay(_modalShell('odp-am', isNew ? 'Add area' : 'Edit area', body, footer), trigger);
  const sel = el.querySelector('#odp-f-group');
  if (sel && _dsSelect && typeof _dsSelect.initSelect === 'function') {
    try { _dsSelect.initSelect(sel); } catch { /* bare select still works */ }
  }
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-odp-modal-close]')) { _closeModal(); return; }
    if (e.target.closest('[data-odp-modal-delete]')) { _deleteArea(group, area, e.target); }
  });
  el.addEventListener('submit', (e) => { e.preventDefault(); _saveArea(area, group); });
  const input = el.querySelector('#odp-f-name');
  if (input) input.focus();
}

// -- mutations --------------------------------------------------------------------

// A successful write lands in one of the responsibilities/*.json files, so it
// is announced on the core's data bus: the core repaints the module sync bar
// (local date, pending files) and calls onDataChanged() below, which re-reads
// the matrix in place. Returns false when the bus could not be reached - the
// caller then re-reads by itself. Dynamic import keeps this file Node-safe.
async function _announceDataWrite() {
  try {
    const ev = await import('/js/data-events.js');
    ev.emitDataChanged({ source: 'responsibilities' });
    return true;
  } catch {
    return false;
  }
}

async function _afterStructural(root, message) {
  if (!(await _announceDataWrite())) await _load(root || document.getElementById(ROOT_ID), {});
  _toast('success', message);
}

function _failToast(result, fallback) {
  const msg = (result && result.json && result.json.message) || fallback;
  _toast('danger', 'Save error: ' + msg);
}

async function _saveGroup(group) {
  if (!_canWrite) return;
  const name = (document.getElementById('odp-f-gname') || {}).value;
  if (!name || !name.trim()) { _toast('warning', 'Enter a group name'); return; }
  const r = group
    ? await _post('/groups/rename', { groupId: group.id, name: name.trim() })
    : await _post('/groups/add', { name: name.trim() });
  if (r.ok && (r.json.status === 'added' || r.json.status === 'saved')) {
    _closeModal();
    await _afterStructural(null, group ? 'Group saved' : 'Group added');
  } else {
    _failToast(r, 'unknown');
  }
}

async function _saveArea(area, sourceGroup) {
  if (!_canWrite) return;
  const val = (id) => ((document.getElementById(id) || {}).value || '').trim();
  const name = val('odp-f-name');
  const owner = val('odp-f-owner');
  const groupId = val('odp-f-group');
  const description = val('odp-f-desc');
  if (!name || !owner || !groupId) { _toast('warning', 'Fill in the required fields: Area, Group, Owner'); return; }
  const r = area
    ? await _post('/areas/rename', { groupId: sourceGroup.id, areaId: area.id, targetGroupId: groupId, name, description, owner })
    : await _post('/areas/add', { groupId, name, description, owner });
  if (r.ok && (r.json.status === 'added' || r.json.status === 'saved')) {
    _closeModal();
    await _afterStructural(null, area ? 'Area saved' : 'Area added');
  } else {
    _failToast(r, 'unknown');
  }
}

async function _deleteGroup(group, trigger) {
  if (!_canWrite || !group || !_dsModal) return;
  const n = (group.areas || []).length;
  const ok = await _dsModal.confirmDsModal({
    title: 'Delete group?',
    body: n > 0
      ? 'Really delete the group "' + group.name + '" with its ' + n + ' areas and the whole rating history?'
      : 'Really delete the group "' + group.name + '"?',
    okLabel: 'Delete', cancelLabel: 'Cancel', danger: true, trigger,
  });
  if (!ok) return;
  const r = await _post('/groups/delete', { groupId: group.id });
  if (r.ok && r.json.status === 'deleted') {
    _closeModal();
    await _afterStructural(null, 'Group deleted');
  } else {
    _failToast(r, 'unknown');
  }
}

async function _deleteArea(group, area, trigger) {
  if (!_canWrite || !group || !area || !_dsModal) return;
  const ok = await _dsModal.confirmDsModal({
    title: 'Delete area?',
    body: 'Really delete the area "' + area.name + '"? Its rating history will be deleted.',
    okLabel: 'Delete', cancelLabel: 'Cancel', danger: true, trigger,
  });
  if (!ok) return;
  const r = await _post('/areas/delete', { groupId: group.id, areaId: area.id });
  if (r.ok && r.json.status === 'deleted') {
    _closeModal();
    await _afterStructural(null, 'Area deleted');
  } else {
    _failToast(r, 'unknown');
  }
}

/** Optimistic rating save; a non-'saved' answer rolls the local change back. */
async function _saveRating(groupId, areaId, month, status, actions, opts) {
  if (!_canWrite) return;
  const area = _findArea(_findGroup(groupId), areaId);
  if (!area) return;
  if (!area.ratings) area.ratings = {};
  const previous = area.ratings[month];
  area.ratings[month] = { status, actions: actions || null };
  const root = document.getElementById(ROOT_ID);
  if (!(opts && opts.noRepaint)) _paint(root);
  const r = await _post('/rating', { groupId, areaId, month, status, actions: actions || null });
  if (r.ok && r.json.status === 'saved') {
    _toast('success', 'Saved');
    // The local matrix already holds the change (optimistic), so a failed
    // announce needs no fallback - only the sync bar would stay behind.
    _announceDataWrite();
    return;
  }
  if (previous === undefined) delete area.ratings[month]; else area.ratings[month] = previous;
  _paint(document.getElementById(ROOT_ID));
  _failToast(r, 'unknown');
}

// -- events -----------------------------------------------------------------------

function _flushPendingSave() {
  if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
  const fn = _pendingSave;
  _pendingSave = null;
  if (fn) fn();
}

function _handleClick(e) {
  const t = e.target && e.target.closest ? e.target : null;
  if (!t) return;

  const tab = t.closest('[data-odp-tab]');
  if (tab) {
    const p = tab.dataset.odpTab;
    if (p !== _project && _deps && typeof _deps.navigate === 'function') _deps.navigate(VIEW_ID + '/' + p);
    return;
  }
  const monthBtn = t.closest('[data-odp-month]');
  if (monthBtn) { _month = monthBtn.dataset.odpMonth; _paint(document.getElementById(ROOT_ID)); return; }
  if (t.closest('[data-odp-earlier]')) { _showAll = true; _paint(document.getElementById(ROOT_ID)); return; }
  if (t.closest('[data-odp-collapse-months]')) { _showAll = false; _paint(document.getElementById(ROOT_ID)); return; }

  const toggle = t.closest('[data-odp-toggle]');
  if (toggle) {
    const gid = toggle.dataset.odpToggle;
    if (_collapsed.has(gid)) _collapsed.delete(gid); else _collapsed.add(gid);
    _paint(document.getElementById(ROOT_ID));
    return;
  }

  if (t.closest('[data-odp-add-group]')) { if (_canWrite) _openGroupModal(null, t); return; }

  const addAreaTo = t.closest('[data-odp-add-area-to]');
  if (addAreaTo) {
    if (_canWrite) _openAreaModal({ area: null, group: _findGroup(addAreaTo.dataset.odpAddAreaTo), trigger: addAreaTo });
    return;
  }
  const editGroup = t.closest('[data-odp-edit-group]');
  if (editGroup) {
    const g = _findGroup(editGroup.dataset.odpEditGroup);
    if (g && _canWrite) _openGroupModal(g, editGroup);
    return;
  }
  const delGroup = t.closest('[data-odp-delete-group]');
  if (delGroup) { _deleteGroup(_findGroup(delGroup.dataset.odpDeleteGroup), delGroup); return; }

  const editArea = t.closest('[data-odp-edit-area]');
  if (editArea) {
    const g = _findGroup(editArea.dataset.odpAreaGroup);
    const a = _findArea(g, editArea.dataset.odpEditArea);
    if (a && g && _canWrite) _openAreaModal({ area: a, group: g, trigger: editArea });
    return;
  }
  const delArea = t.closest('[data-odp-delete-area]');
  if (delArea) {
    const g = _findGroup(delArea.dataset.odpAreaGroup);
    _deleteArea(g, _findArea(g, delArea.dataset.odpDeleteArea), delArea);
    return;
  }

  const ragBtn = t.closest('[data-odp-status]');
  if (ragBtn && _canWrite) { _handleRag(ragBtn); }
}

function _handleRag(ragBtn) {
  const sel = ragBtn.closest('[data-odp-area]');
  if (!sel) return;
  const areaId = sel.dataset.odpArea;
  const groupId = sel.dataset.odpGroup;
  const clicked = ragBtn.dataset.odpStatus;
  const area = _findArea(_findGroup(groupId), areaId);
  const current = area && area.ratings && area.ratings[_month] ? area.ratings[_month].status : null;

  if (clicked === current) { _saveRating(groupId, areaId, _month, null, null); return; }

  if (clicked === 'red') {
    // Nothing is saved until the actions are written (the server refuses R without them).
    if (area) {
      if (!area.ratings) area.ratings = {};
      const existing = area.ratings[_month];
      area.ratings[_month] = { status: 'red', actions: (existing && existing.actions) || null };
    }
    _paint(document.getElementById(ROOT_ID));
    const ta = document.querySelector('[data-odp-actions][data-odp-area="' + areaId + '"]');
    if (ta) ta.focus();
    return;
  }
  _saveRating(groupId, areaId, _month, clicked, null);
}

function _handleInput(e) {
  const ta = e.target && e.target.matches && e.target.matches('textarea[data-odp-actions]') ? e.target : null;
  if (!ta || !_canWrite) return;
  const areaId = ta.dataset.odpArea;
  const groupId = ta.dataset.odpGroup;
  const month = _month;
  const actions = ta.value.trim();
  if (_saveTimer) clearTimeout(_saveTimer);
  _pendingSave = () => {
    if (actions) _saveRating(groupId, areaId, month, 'red', actions, { noRepaint: true });
  };
  _saveTimer = setTimeout(() => { _saveTimer = null; const fn = _pendingSave; _pendingSave = null; if (fn) fn(); }, 800);
}

function _handleActionsClick(e) {
  const t = e.target && e.target.closest ? e.target : null;
  if (!t || !_canWrite) return;
  if (t.closest('[data-odp-add-group]')) { _openGroupModal(null, t.closest('button')); return; }
  if (t.closest('[data-odp-add-area]')) {
    if (_groups().length === 0) { _toast('info', 'Add a group first'); _openGroupModal(null, t.closest('button')); return; }
    _openAreaModal({ area: null, group: null, trigger: t.closest('button') });
  }
}

// Bound ONCE per visit: `root.innerHTML =` never replaces the persistent root,
// so wiring in every paint would save a rating twice. The slot is a fresh
// element after a data reload, hence tracked separately.
function _wire(root) {
  const actions = document.getElementById(ACTIONS_ID);
  let fresh = false;
  if (_wiredRoot !== root) {
    _onRootClick = _handleClick;
    _onRootInput = _handleInput;
    root.addEventListener('click', _onRootClick);
    root.addEventListener('input', _onRootInput);
    _wiredRoot = root;
    fresh = true;
  }
  if (actions && _wiredActions !== actions) {
    _onActionsClick = _handleActionsClick;
    actions.addEventListener('click', _onActionsClick);
    _wiredActions = actions;
    fresh = true;
  }
  if (fresh && _deps && typeof _deps.registerViewCleanup === 'function') {
    _deps.registerViewCleanup(_cleanup);
  }
}

function _cleanup() {
  _flushPendingSave();
  if (_wiredRoot) {
    _wiredRoot.removeEventListener('click', _onRootClick);
    _wiredRoot.removeEventListener('input', _onRootInput);
  }
  if (_wiredActions) _wiredActions.removeEventListener('click', _onActionsClick);
  _wiredRoot = null;
  _wiredActions = null;
  _closeModal();
}

// -- view ---------------------------------------------------------------------------

export const views = {

  [VIEW_ID]: {
    /** @param {{ navigate, registerViewCleanup, showToast, apiBase }} deps */
    init(deps) {
      _deps = deps;
      _mounted = true;
      (async () => {
        try { _dsModal = await import('/js/ds-modal.js'); } catch { _dsModal = null; }
        try { _emptyState = await import('/js/empty-state.js'); } catch { _emptyState = null; }
        try { _dsSelect = await import('/js/ds-select.js'); } catch { _dsSelect = null; }
      })();
    },

    /**
     * @param {string} subPath project id (main | web | mobile | platform)
     * @param {object} _opts navigation options
     */
    async render(subPath, _opts) {
      const root = document.getElementById(ROOT_ID);
      if (!root) return;
      const seg = String(subPath || '').split('/')[0];
      const project = isValidProject(seg) ? seg : 'main';
      if (project !== _project) {
        _flushPendingSave();
        _project = project;
        _data = null;
        _month = '';
        _showAll = false;
        _collapsed.clear();
      }
      if (_data && _phase === 'ready') {
        _paint(root);
      } else {
        _phase = 'loading';
        root.innerHTML = _skeletonHtml();
        _paintActionsSkeleton();
      }
      await _load(root, { setup: true });
    },

    /** Team data was pulled: re-read the matrix, keep month and collapsed groups. */
    async onDataChanged() {
      if (!_mounted) return;
      const root = document.getElementById(ROOT_ID);
      if (!root) return;
      // A repaint now would take the focus (and any text typed since the
      // debounced save) out of the actions textarea - which is exactly when
      // _saveRating announces its own writes. Re-read once it loses focus.
      const active = document.activeElement;
      if (active && root.contains(active) && active.matches && active.matches('textarea[data-odp-actions]')) {
        if (!_reloadOnBlur) {
          _reloadOnBlur = true;
          active.addEventListener('focusout', () => {
            _reloadOnBlur = false;
            if (_mounted && document.getElementById(ROOT_ID) === root) views[VIEW_ID].onDataChanged();
          }, { once: true });
        }
        return;
      }
      _flushPendingSave();
      await _load(root, { setup: true });
    },
  },
};
