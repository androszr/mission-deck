// modules/roadmap/client/kanban.js
// The "Kanban" tab. Five status columns x
// collapsible swim lanes (one per initiative), drag & drop between columns (arrow
// keys on a focused card as the keyboard alternative), a person / search filter, a
// hover popover and the "Add task" modal. Every Jira call goes through the
// module's own routes under `${apiBase}/kanban/*` - and with the person's OWN token
// (the technical one only reads; writes are refused by the server and disabled here).
//
// renderKanban(root, deps): paints into `root` (the pane element), unconditionally.
//   deps = { apiBase, showToast, registerViewCleanup, teamDir, esc, onOpenRow? }
// Called lazily on the first activation of the tab and again after a data sync.

import {
  KANBAN_COLUMNS, CHANGE_TYPE_OPTIONS, WORK_TYPE_OPTIONS, APPLIES_TO_OPTIONS,
  DEFAULT_CHANGE_TYPE, DEFAULT_WORK_TYPE, DEFAULT_APPLIES_TO, TECH_TOKEN_NOTE, NO_TOKEN_MESSAGE,
  normalizeBoard, normalizeStatus, groupBoard, cellView, collectPersons, togglePerson, moveIssue, stepColumn,
  typeBadgeClass, priorityColor, formatUpdated, personLabel, initialsOf, validateCreateTask, buildCreatePayload,
  buildTransitionPayload, columnById,
} from './kanban-helpers.js';
import { safeJiraHref } from './helpers.js';

const SVG_CHEVRON = '<svg class="crk-lane-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
const SVG_REFRESH = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>';

const isEl = (x) => Boolean(x) && typeof x.closest === 'function';
const _teardowns = new WeakMap(); // pane -> function that undoes the previous render's listeners

function _skeletonHtml() {
  return '<div class="crk-skel" data-skel="1" aria-hidden="true"><div class="ds-skeleton crk-skel-bar"></div><div class="ds-skeleton crk-skel-board"></div></div>';
}

export function renderKanban(root, deps) {
  if (!root) return;
  const prev = _teardowns.get(root);
  if (prev) prev();
  const d = deps || {};
  const esc = typeof d.esc === 'function' ? d.esc : (s) => String(s);
  const toast = typeof d.showToast === 'function' ? d.showToast : () => {};
  const apiBase = String(d.apiBase || '');

  const st = {
    board: normalizeBoard(null),
    status: normalizeStatus(null),
    filters: { search: '', unassigned: false, persons: null },
    expanded: new Set(),
    collapsed: new Set(),
    loaded: false,
    loading: true,
    error: null,
    busy: false,
    teamDir: d.teamDir || null,
    reqId: 0,
    dead: false,
  };
  let popEl = null;
  let popTimer = null;
  let modal = null; // { overlay, epicKey, close }

  // ---- People ------------------------------------------------------------------

  function canonical(name) {
    const td = st.teamDir;
    if (!td || !td.memberByName) return '';
    const m = td.memberByName(name);
    return m && td.fullName ? (td.fullName(m) || '') : '';
  }

  function avatar(name, size) {
    if (!name) return '';
    const label = personLabel(name, canonical);
    const td = st.teamDir;
    const url = td && td.avatarUrlForName ? td.avatarUrlForName(name) : '';
    if (url) return '<img class="crk-avatar" src="' + esc(url) + '" width="' + size + '" height="' + size + '" alt="" title="' + esc(label) + '" loading="lazy">';
    return '<span class="crk-avatar crk-avatar--initials" style="width:' + size + 'px;height:' + size + 'px" title="' + esc(label) + '">' + esc(initialsOf(label)) + '</span>';
  }

  function teamNames() {
    const td = st.teamDir;
    if (!td || !td.getTeamMembers || !td.fullName) return [];
    const names = new Set();
    for (const m of td.getTeamMembers() || []) { const n = td.fullName(m); if (n) names.add(n); }
    return [...names].sort((a, b) => a.localeCompare(b, 'en'));
  }

  // ---- Rendering -----------------------------------------------------------------

  function cardHtml(issue) {
    const href = safeJiraHref(st.board.jiraBase, issue.key);
    const key = href
      ? '<a class="crk-card-key" href="' + esc(href) + '" target="_blank" rel="noopener noreferrer" title="' + esc('Open ' + issue.key + ' in Jira') + '">' + esc(issue.key) + '</a>'
      : '<span class="crk-card-key">' + esc(issue.key) + '</span>';
    const draggable = st.status.canWrite && !st.busy;
    return '<div class="crk-card" data-crk-card="' + esc(issue.key) + '"' + (draggable ? ' draggable="true"' : '') + ' tabindex="0" role="article" aria-label="' + esc(issue.key + ': ' + issue.summary) + '">'
      + '<div class="crk-card-header">' + key
      + '<span class="crk-priority-dot" style="background:' + priorityColor(issue.priority) + '" title="' + esc('Priority: ' + (issue.priority || 'none')) + '"></span></div>'
      + '<p class="crk-card-summary">' + esc(issue.summary) + '</p>'
      + '<div class="crk-card-footer"><span class="ds-badge ds-badge--sm ' + typeBadgeClass(issue.issueType) + '">' + esc(issue.issueType || 'Task') + '</span>'
      + (issue.assignee ? avatar(issue.assignee.displayName, 20) : '') + '</div></div>';
  }

  function laneHtml(lane) {
    const collapsed = st.collapsed.has(lane.id);
    const canAdd = Boolean(lane.epicKey);
    const addDisabled = !st.status.canWrite;
    let html = '<div class="crk-lane" data-crk-lane="' + esc(lane.id) + '">'
      + '<div class="crk-lane-header" role="button" tabindex="0" aria-expanded="' + (collapsed ? 'false' : 'true') + '" data-crk-lane-toggle="' + esc(lane.id) + '">'
      + SVG_CHEVRON.replace('class="crk-lane-chevron"', 'class="crk-lane-chevron"' + (collapsed ? ' style="transform:rotate(-90deg)"' : ''))
      + '<span class="crk-lane-title">' + esc(lane.title) + '</span>'
      + '<span class="ds-badge ds-badge--sm ds-badge--gray">' + lane.total + '</span>'
      + (typeof d.onOpenRow === 'function' && lane.id !== '__other__' ? '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm crk-lane-btn" data-crk-open-row="' + esc(lane.id) + '" title="Show this initiative on the Table tab">In table</button>' : '')
      + (canAdd ? '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm crk-lane-btn" data-crk-add="' + esc(lane.epicKey) + '"' + (addDisabled ? ' disabled' : '') + ' title="' + esc(addDisabled ? 'Adding tasks needs your personal Jira token.' : 'Add a task to this initiative') + '">+ Add task</button>' : '')
      + '</div>'
      + '<div class="crk-lane-body" role="row"' + (collapsed ? ' hidden' : '') + '>';
    for (const col of KANBAN_COLUMNS) {
      const cards = lane.cols[col.id] || [];
      const cellKey = lane.id + ':' + col.id;
      const v = cellView(cards, col.id, st.expanded.has(cellKey));
      html += '<div class="crk-cell" role="cell" data-crk-cell="' + esc(col.id) + '">' + v.visible.map(cardHtml).join('');
      if (v.collapsible) {
        html += '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm crk-expand-btn" data-crk-expand="' + esc(cellKey) + '">'
          + (st.expanded.has(cellKey) ? 'Collapse' : 'Expand (' + v.hidden + ' more)') + '</button>';
      }
      html += '</div>';
    }
    return html + '</div></div>';
  }

  function boardHtml() {
    const g = groupBoard(st.board, st.filters);
    if (st.board.issues.length === 0) {
      return '<div class="ds-empty"><p class="ds-empty-title">No tasks</p><p class="ds-empty-desc">No DISC tasks were found in Jira.</p></div>';
    }
    if (g.total === 0) {
      return '<div class="ds-empty"><p class="ds-empty-title">No results</p><p class="ds-empty-desc">No task matches the search or the person filter.</p></div>';
    }
    let html = '<div class="crk-board" role="table" aria-label="Kanban Discovery"><div class="crk-col-header-row" role="row">';
    for (const col of KANBAN_COLUMNS) {
      html += '<div class="crk-col-header" role="columnheader"><span>' + esc(col.label) + '</span><span class="ds-badge ds-badge--sm ds-badge--gray">' + g.colTotals[col.id] + '</span></div>';
    }
    html += '</div>' + g.lanes.map(laneHtml).join('') + '</div>';
    return html;
  }

  function toolbarHtml() {
    const persons = collectPersons(st.board.issues, canonical);
    const all = st.filters.persons === null;
    let chips = '<div class="crk-person-filter"><button type="button" class="ds-btn ds-btn--secondary ds-btn--sm crk-chip crk-chip--all' + (all ? ' crk-chip--active' : '') + '" data-crk-person-all>Wszyscy</button>';
    for (const p of persons) {
      const selected = all || st.filters.persons.includes(p.displayName);
      chips += '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm crk-chip' + (selected ? ' crk-chip--active' : '') + '" data-crk-person="' + esc(p.displayName) + '" title="' + esc(p.label) + '" aria-pressed="' + (selected ? 'true' : 'false') + '">'
        + avatar(p.displayName, 24) + '<span>' + esc(p.label) + '</span></button>';
    }
    chips += '</div>';
    const note = st.status.token === 'technical'
      ? '<div class="ds-callout ds-callout--warning crk-token-note" data-crk-token-note><div>' + esc(TECH_TOKEN_NOTE) + '</div></div>' : '';
    return '<div class="crk-toolbar-top">'
      + '<div class="ds-input-wrap crk-search-wrap"><input type="search" class="ds-input" data-crk-search placeholder="Search by key or title..." autocomplete="off" aria-label="Search tasks"></div>'
      + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm' + (st.filters.unassigned ? ' crk-btn--on' : '') + '" data-crk-unassigned aria-pressed="' + (st.filters.unassigned ? 'true' : 'false') + '">Unassigned</button>'
      + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm crk-refresh" data-crk-refresh>' + SVG_REFRESH + '<span>Refresh from Jira</span></button></div>'
      + note + chips
      + (st.status.canWrite ? '<p class="crk-hint">Drag a card to another column, or select it and use the left and right arrow keys.</p>' : '');
  }

  function paintBoard() {
    const slot = root.querySelector('[data-crk-board]');
    if (!slot) return;
    if (st.loading && !st.loaded) { slot.innerHTML = _skeletonHtml(); return; }
    if (st.error) {
      slot.innerHTML = '<div class="ds-callout ds-callout--' + (st.error.kind === 'no-token' ? 'warning' : 'danger') + '"><div><strong>Could not load the Kanban board</strong><br>' + esc(st.error.message)
        + '</div></div><p><button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-crk-retry>Try again</button></p>';
      return;
    }
    slot.innerHTML = boardHtml();
  }

  function paintToolbar() {
    const slot = root.querySelector('[data-crk-toolbar]');
    if (!slot) return;
    const hadFocus = document.activeElement && document.activeElement.matches && document.activeElement.matches('[data-crk-search]');
    slot.innerHTML = toolbarHtml();
    const input = slot.querySelector('[data-crk-search]');
    if (input) {
      input.value = st.filters.search;
      if (hadFocus) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    }
  }

  function paintAll() { paintToolbar(); paintBoard(); }

  // ---- Data ------------------------------------------------------------------------

  async function getJson(path) {
    const res = await fetch(apiBase + path);
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    return { res, body };
  }

  async function postJson(path, payload) {
    const res = await fetch(apiBase + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    return { res, body };
  }

  async function load() {
    const mine = ++st.reqId;
    st.loading = true;
    if (!st.loaded) paintBoard();
    let board = null;
    let error = null;
    try {
      const [s, b] = await Promise.all([getJson('/kanban/status'), getJson('/kanban/board')]);
      if (mine !== st.reqId || st.dead) return;
      if (s.res.ok) st.status = normalizeStatus(s.body);
      if (b.res.ok && b.body && b.body.ok) board = normalizeBoard(b.body);
      else {
        const code = b.body && b.body.error;
        error = { kind: code === 'no-token' ? 'no-token' : 'error', message: (b.body && b.body.message) || (code === 'no-token' ? NO_TOKEN_MESSAGE : 'Jira answered with HTTP error ' + b.res.status + '.') };
      }
    } catch {
      if (mine !== st.reqId || st.dead) return;
      error = { kind: 'error', message: 'Could not connect to the server. Try again.' };
    }
    st.loading = false;
    if (board) { st.board = board; st.loaded = true; st.error = null; } else { st.error = error; st.loaded = false; }
    paintAll();
  }

  // ---- Moving a card -----------------------------------------------------------------

  async function moveCard(key, targetColId) {
    if (st.busy || !st.status.canWrite) return;
    const col = columnById(targetColId);
    const issue = st.board.issues.find((i) => i.key === key);
    if (!col || !issue) return;
    st.busy = true;
    const before = st.board;
    st.board = moveIssue(st.board, key, targetColId);
    paintBoard();
    focusCard(key);
    try {
      const { res, body } = await postJson('/kanban/transition', buildTransitionPayload(key, targetColId));
      if (st.dead) return;
      if (res.ok && body && body.ok) {
        toast('success', 'Przeniesiono ' + key, 'Kolumna: ' + col.label);
      } else {
        st.board = before;
        const level = body && body.error === 'no-transition' ? 'warning' : 'danger';
        toast(level, body && body.error === 'no-transition' ? 'No transition available' : 'Could not move the task', (body && body.message) || 'HTTP error ' + res.status + '.');
      }
    } catch {
      if (st.dead) return;
      st.board = before;
      toast('danger', 'Network error', 'Could not connect to the server.');
    }
    st.busy = false;
    paintBoard();
    focusCard(key);
    load(); // the truth comes from Jira
  }

  function focusCard(key) {
    const el = [...root.querySelectorAll('[data-crk-card]')].find((c) => c.getAttribute('data-crk-card') === key);
    if (el) el.focus({ preventScroll: true });
  }

  // ---- Popover (position: fixed, so it is never clipped by a lane) ------------------------

  function showPopover(cardEl) {
    const issue = st.board.issues.find((i) => i.key === cardEl.getAttribute('data-crk-card'));
    if (!issue) return;
    if (!popEl) {
      popEl = document.createElement('div');
      popEl.className = 'crk-popover ds-card';
      popEl.setAttribute('aria-hidden', 'true');
      document.body.appendChild(popEl);
    }
    const who = issue.assignee ? personLabel(issue.assignee.displayName, canonical) : 'Unassigned';
    popEl.innerHTML = '<div class="crk-pop-key">' + esc(issue.key) + '</div><div class="crk-pop-summary">' + esc(issue.summary) + '</div>'
      + '<div class="crk-pop-meta"><span>Status: <strong>' + esc(issue.statusName || '-') + '</strong></span>'
      + '<span>Type: <strong>' + esc(issue.issueType || '-') + '</strong></span>'
      + '<span>Priority: <strong>' + esc(issue.priority || '-') + '</strong></span>'
      + '<span>Assignee: <strong>' + esc(who) + '</strong></span>'
      + '<span>Updated: <strong>' + esc(formatUpdated(issue.updated)) + '</strong></span></div>';
    popEl.hidden = false;
    const rect = cardEl.getBoundingClientRect();
    const w = 260;
    const left = window.innerWidth - rect.right >= w + 8 ? rect.right + 8 : rect.left - w - 8;
    popEl.style.left = Math.max(8, left) + 'px';
    popEl.style.top = '0px';
    const h = popEl.offsetHeight;
    let top = rect.top;
    if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8;
    popEl.style.top = Math.max(8, top) + 'px';
  }

  function hidePopover() { if (popEl) popEl.hidden = true; }

  // ---- "Add task" modal -------------------------------------------------------------------

  function optionsHtml(list, selected) {
    return list.map((o) => '<option value="' + esc(o.value) + '"' + (o.value === selected ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('');
  }

  function modalFormValues(overlay) {
    const q = (n) => overlay.querySelector('[data-crk-f="' + n + '"]');
    return {
      summary: q('summary').value, description: q('description').value, assignee: q('assignee').value,
      appliesTo: q('appliesTo').value, changeTypeId: q('change-type').value, workTypeId: q('work-type').value,
    };
  }

  async function openCreateModal(epicKey) {
    if (modal || !st.status.canWrite) return;
    let modalApi = null;
    try { modalApi = await import('/js/ds-modal.js'); } catch { modalApi = null; }
    if (modal || st.dead) return;
    const overlay = document.createElement('div');
    overlay.className = 'ds-modal-overlay';
    overlay.hidden = true;
    overlay.innerHTML = '<div class="ds-modal crk-modal" role="dialog" aria-modal="true" aria-label="Add task">'
      + '<div class="ds-modal-header"><span class="ds-modal-title">Add task</span><button type="button" class="ds-modal-close" data-crk-close aria-label="Close">&times;</button></div>'
      + '<div class="ds-modal-body"><form class="crk-form" autocomplete="off" data-crk-form>'
      + '<div class="crk-field"><label class="crk-label" for="crk-f-summary">Title <span aria-hidden="true">*</span></label><div class="ds-input-wrap"><input id="crk-f-summary" class="ds-input" type="text" data-crk-f="summary" maxlength="255" placeholder="A short task title..." required></div></div>'
      + '<div class="crk-field"><label class="crk-label" for="crk-f-description">Description</label><div class="ds-input-wrap"><textarea id="crk-f-description" class="ds-input ds-textarea crk-textarea" data-crk-f="description" placeholder="Optional task description..."></textarea></div></div>'
      + '<div class="crk-field"><label class="crk-label" for="crk-f-assignee">Assignee</label><div class="ds-input-wrap"><input id="crk-f-assignee" class="ds-input" type="text" list="crk-people" data-crk-f="assignee" maxlength="120" placeholder="Search for a person..."><datalist id="crk-people">'
      + teamNames().map((n) => '<option value="' + esc(n) + '"></option>').join('') + '</datalist></div></div>'
      + '<div class="crk-field"><label class="crk-label" for="crk-f-appliesTo">Applies to</label><div class="ds-input-wrap"><select id="crk-f-appliesTo" class="ds-input" data-crk-f="appliesTo">' + optionsHtml(APPLIES_TO_OPTIONS, DEFAULT_APPLIES_TO) + '</select></div></div>'
      + '<div class="crk-row"><div class="crk-field"><label class="crk-label" for="crk-f-change-type">Change type</label><div class="ds-input-wrap"><select id="crk-f-change-type" class="ds-input" data-crk-f="change-type">' + optionsHtml(CHANGE_TYPE_OPTIONS, DEFAULT_CHANGE_TYPE) + '</select></div></div>'
      + '<div class="crk-field"><label class="crk-label" for="crk-f-work-type">Work type</label><div class="ds-input-wrap"><select id="crk-f-work-type" class="ds-input" data-crk-f="work-type">' + optionsHtml(WORK_TYPE_OPTIONS, DEFAULT_WORK_TYPE) + '</select></div></div></div>'
      + '<div class="crk-field"><label class="crk-label" for="crk-f-epic">Epic</label><div class="ds-input-wrap"><input id="crk-f-epic" class="ds-input" type="text" readonly value="' + esc(epicKey) + '"></div></div>'
      + '<p class="crk-error" data-crk-error hidden></p></form></div>'
      + '<div class="ds-modal-footer"><button type="button" class="ds-btn ds-btn--primary" data-crk-submit>Create</button><button type="button" class="ds-btn ds-btn--tertiary" data-crk-cancel>Cancel</button></div></div>';
    document.body.appendChild(overlay);

    const errEl = overlay.querySelector('[data-crk-error]');
    const submit = overlay.querySelector('[data-crk-submit]');
    const showError = (msg) => { errEl.textContent = msg; errEl.hidden = !msg; };
    let busy = false;
    const dirty = () => {
      const v = modalFormValues(overlay);
      return Boolean(v.summary.trim() || v.description.trim());
    };
    const teardown = () => {
      document.removeEventListener('keydown', onKey, true);
      if (modalApi) modalApi.closeDsModal(overlay);
      overlay.remove();
      modal = null;
    };
    const tryClose = async () => {
      if (busy) return;
      if (dirty() && modalApi) {
        const ok = await modalApi.confirmDsModal({ title: 'Close the form?', body: 'The form has unsaved data. Do you really want to close it?', okLabel: 'Close', danger: true });
        if (!ok) return;
      }
      teardown();
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // A confirmation opened above this form answers its own Escape.
      if ([...document.querySelectorAll('.ds-modal-overlay.open')].some((o) => o !== overlay)) return;
      e.stopPropagation();
      tryClose();
    };
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) tryClose(); });
    overlay.querySelector('[data-crk-close]').addEventListener('click', tryClose);
    overlay.querySelector('[data-crk-cancel]').addEventListener('click', tryClose);
    overlay.querySelector('[data-crk-form]').addEventListener('submit', (e) => e.preventDefault());
    submit.addEventListener('click', async () => {
      if (busy) return;
      const payload = buildCreatePayload(modalFormValues(overlay), epicKey);
      const v = validateCreateTask(payload);
      if (!v.ok) { showError(v.message); if (v.field === 'summary') overlay.querySelector('[data-crk-f="summary"]').focus(); return; }
      showError('');
      busy = true;
      submit.disabled = true;
      const label = submit.textContent;
      submit.textContent = 'Creating...';
      try {
        const { res, body } = await postJson('/kanban/create-task', payload);
        if (st.dead) return;
        if (res.ok && body && body.ok) {
          toast('success', 'Task created', body.key || '');
          if (body.assigneeRequested && !body.assigneeResolved) toast('warning', 'Person not found in Jira', 'The task was created without an assignee.');
          if (body.appliesToApplied === false) toast('warning', 'The "Applies to" field was not set', 'Fill it in in Jira.');
          busy = false;
          teardown();
          load();
          return;
        }
        showError((body && body.message) || 'HTTP error ' + res.status + '.');
      } catch {
        showError('Network error - could not connect to the server.');
      }
      busy = false;
      submit.disabled = false;
      submit.textContent = label;
    });
    modal = { overlay, epicKey, close: teardown };
    if (modalApi) modalApi.openDsModal(overlay, { dismissible: false, initialFocus: '[data-crk-f="summary"]' });
    else { overlay.hidden = false; overlay.classList.add('open'); }
  }

  // ---- Events (delegated on the pane) -----------------------------------------------------

  function onClick(e) {
    const t = e.target;
    if (!isEl(t)) return;
    if (t.closest('[data-crk-retry], [data-crk-refresh]')) { load(); return; }
    const open = t.closest('[data-crk-open-row]');
    if (open) { if (typeof d.onOpenRow === 'function') d.onOpenRow(open.getAttribute('data-crk-open-row')); return; }
    const add = t.closest('[data-crk-add]');
    if (add) { openCreateModal(add.getAttribute('data-crk-add')); return; }
    const exp = t.closest('[data-crk-expand]');
    if (exp) {
      const k = exp.getAttribute('data-crk-expand');
      if (st.expanded.has(k)) st.expanded.delete(k); else st.expanded.add(k);
      paintBoard();
      return;
    }
    if (t.closest('[data-crk-person-all]')) { st.filters.persons = null; paintAll(); return; }
    const person = t.closest('[data-crk-person]');
    if (person) {
      st.filters.persons = togglePerson(st.filters.persons, person.getAttribute('data-crk-person'), collectPersons(st.board.issues, canonical).map((p) => p.displayName));
      paintAll();
      return;
    }
    if (t.closest('[data-crk-unassigned]')) { st.filters.unassigned = !st.filters.unassigned; paintAll(); return; }
    const lane = t.closest('[data-crk-lane-toggle]');
    if (lane) {
      const id = lane.getAttribute('data-crk-lane-toggle');
      if (st.collapsed.has(id)) st.collapsed.delete(id); else st.collapsed.add(id);
      paintBoard();
    }
  }

  function onInput(e) {
    if (!isEl(e.target) || !e.target.matches('[data-crk-search]')) return;
    st.filters.search = e.target.value;
    paintBoard(); // the toolbar keeps the focused input
  }

  function onKeydown(e) {
    const t = e.target;
    if (!isEl(t)) return;
    const laneHead = t.closest('[data-crk-lane-toggle]');
    if (laneHead && t === laneHead && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); laneHead.click(); return; }
    const card = t.closest('[data-crk-card]');
    if (card && t === card && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && st.status.canWrite) {
      const key = card.getAttribute('data-crk-card');
      const issue = st.board.issues.find((i) => i.key === key);
      const target = issue ? stepColumn(issue, e.key === 'ArrowLeft' ? -1 : 1) : null;
      if (target) { e.preventDefault(); moveCard(key, target.id); }
    }
  }

  function onOver(e) {
    const card = isEl(e.target) ? e.target.closest('[data-crk-card]') : null;
    if (!card || card.contains(e.relatedTarget)) return;
    if (popTimer) { clearTimeout(popTimer); popTimer = null; }
    showPopover(card);
  }

  function onOut(e) {
    const card = isEl(e.target) ? e.target.closest('[data-crk-card]') : null;
    if (!card || card.contains(e.relatedTarget)) return;
    popTimer = setTimeout(hidePopover, 120);
  }

  function onFocusIn(e) {
    const card = isEl(e.target) ? e.target.closest('[data-crk-card]') : null;
    if (card && card === e.target) showPopover(card); else hidePopover();
  }

  function onDragStart(e) {
    const card = isEl(e.target) ? e.target.closest('[data-crk-card]') : null;
    if (!card || !e.dataTransfer) return;
    hidePopover();
    card.classList.add('crk-card--dragging');
    const cell = card.closest('[data-crk-cell]');
    e.dataTransfer.setData('text/plain', JSON.stringify({ key: card.getAttribute('data-crk-card'), sourceColId: cell ? cell.getAttribute('data-crk-cell') : '' }));
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragEnd(e) {
    const card = isEl(e.target) ? e.target.closest('[data-crk-card]') : null;
    if (card) card.classList.remove('crk-card--dragging');
    root.querySelectorAll('.crk-cell--over').forEach((c) => c.classList.remove('crk-cell--over'));
  }

  function onDragOver(e) {
    const cell = isEl(e.target) ? e.target.closest('[data-crk-cell]') : null;
    if (!cell || !st.status.canWrite) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    cell.classList.add('crk-cell--over');
  }

  function onDragLeave(e) {
    const cell = isEl(e.target) ? e.target.closest('[data-crk-cell]') : null;
    if (cell && !cell.contains(e.relatedTarget)) cell.classList.remove('crk-cell--over');
  }

  function onDrop(e) {
    const cell = isEl(e.target) ? e.target.closest('[data-crk-cell]') : null;
    if (!cell || !e.dataTransfer) return;
    e.preventDefault();
    cell.classList.remove('crk-cell--over');
    let payload = null;
    try { payload = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { payload = null; }
    const target = cell.getAttribute('data-crk-cell');
    if (!payload || !payload.key || !target || target === payload.sourceColId) return;
    moveCard(String(payload.key), target);
  }

  const handlers = [
    ['click', onClick], ['input', onInput], ['keydown', onKeydown], ['mouseover', onOver], ['mouseout', onOut],
    ['focusin', onFocusIn], ['dragstart', onDragStart], ['dragend', onDragEnd], ['dragover', onDragOver],
    ['dragleave', onDragLeave], ['drop', onDrop],
  ];
  for (const [ev, fn] of handlers) root.addEventListener(ev, fn);

  function teardownAll() {
    st.dead = true;
    for (const [ev, fn] of handlers) root.removeEventListener(ev, fn);
    if (popTimer) clearTimeout(popTimer);
    if (popEl) { popEl.remove(); popEl = null; }
    if (modal) modal.close();
    _teardowns.delete(root);
  }
  _teardowns.set(root, teardownAll);
  if (typeof d.registerViewCleanup === 'function') d.registerViewCleanup(teardownAll);

  // ---- First paint ---------------------------------------------------------------------------

  root.innerHTML = '<div class="crk-toolbar" data-crk-toolbar></div><div data-crk-board></div>';
  paintAll();
  load();
  if (!st.teamDir) {
    (async () => {
      try {
        const td = await import('/js/team-directory.js');
        if (td.loadTeamDirectory) await td.loadTeamDirectory();
        if (st.dead) return;
        st.teamDir = td;
        if (st.loaded) paintAll();
      } catch { /* initials fallback */ }
    })();
  }
}
