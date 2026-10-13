// modules/meeting-archive/client/index.js
// Meeting archive - archive of processed meetings. ONE view carries
// both screens: no sub-path = list (folder tree / flat search), sub-path =
// the folder name of one meeting. The HTML report only ever reaches the page
// through a sandboxed iframe srcdoc: the static path is not frameable.
// Edits (meeting meta, delete, categories, folders) POST to this module's
// server, which writes meeting-archive/ and pushes it to the team at once; every
// write answers {push: {ok, error, message}} and pushToast() says which.

import {
  filterMeetings, childrenOf, meetingsIn, countDeep,
  groupTranscript, speakerLabel, tsLabel, buildCrumbs,
} from './list-helpers.mjs';

const VIEW_ID = 'meeting-archive-main';
const FOLDER_RE = /^[A-Za-z0-9_.\-]+$/;
const MAX_AVATARS = 5;

// Core helpers are reached by dynamic import so this file stays importable
// in plain Node (the contract test does exactly that).
let _td = null;
let _md = null;
let _selectLib = null;
let _empty = null;

// List state survives the trip to a detail and back; a reload starts at the root.
let _data = null;
let _search = '';
let _categoryId = '';
let _folderId = null;
let _renderToken = 0;
let _listScroll = 0;
// Detail state.
let _detail = null;
const _htmlCache = new Map();

/**
 * @param {unknown} s
 * @returns {string}
 */
function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** @param {string} name */
function icon(name) {
  return '<img class="nav-icon" src="/assets/icons/ds/' + name + '.svg" alt="" aria-hidden="true">';
}

function skeletonHtml() {
  return '<div class="ds-skeleton" data-skel="1" style="height: 320px"></div>';
}

/** @param {string} html */
function calloutHtml(kind, html) {
  return '<div class="ds-callout ds-callout--' + kind + '"><div>' + html + '</div></div>';
}

/**
 * Avatar stack for a participants list. Faces come from the team directory,
 * initials are the honest fallback.
 * @param {{name: string, memberId?: string|null}[]} people
 * @param {{names?: boolean}} [opt]
 * @returns {string}
 */
function avatarsHtml(people, opt) {
  const list = people || [];
  if (!list.length) return '<span>—</span>';
  const withNames = !!(opt && opt.names);
  const shown = withNames ? list : list.slice(0, MAX_AVATARS);
  const faces = shown.map((p) => {
    let member = null;
    if (_td) member = (p.memberId && _td.memberById(p.memberId)) || _td.memberByName(p.name);
    const url = _td && member ? _td.memberAvatarUrl(member) : '';
    const ini = _td ? _td.memberInitials(p.name) : '';
    const face = url
      ? '<img class="ma-avatar" src="' + esc(url) + '" alt="" loading="lazy">'
      : '<span class="ma-avatar ma-avatar--initials" aria-hidden="true">' + esc(ini) + '</span>';
    return withNames
      ? '<li class="ma-person">' + face + '<span>' + esc(p.name) + '</span></li>'
      : face;
  });
  if (withNames) return '<ul class="ma-people">' + faces.join('') + '</ul>';
  const more = list.length > shown.length
    ? '<span class="ma-avatar ma-avatar--more" aria-hidden="true">+' + (list.length - shown.length) + '</span>' : '';
  const label = list.map((p) => p.name).join(', ');
  return '<div class="ma-avatars" role="img" aria-label="' + esc(label) + '">' + faces.join('') + more + '</div>';
}

/** @returns {Record<string, {id: string, name: string}>} */
function categoriesById() {
  const out = {};
  for (const c of (_data && _data.categories) || []) out[c.id] = c;
  return out;
}

function paintActions(mode) {
  const actions = document.getElementById(VIEW_ID + '-actions');
  if (!actions) return;
  if (mode === 'detail') {
    actions.innerHTML = '';
    if (!_actionsWired) wireActions(actions);
    return;
  }
  if (!_actionsWired) wireActions(actions);
  const manage = _data && _data.storage === 'ok'
    ? '<button type="button" class="ds-btn ds-btn--tertiary" data-ma-manage>Categories and folders</button>' : '';
  actions.innerHTML = manage + (document.getElementById('view-meeting-transcripts-main')
    ? '<a class="ds-btn ds-btn--secondary" href="#meeting-transcripts-main">New recording</a>'
    : '<button type="button" class="ds-btn ds-btn--secondary" disabled title="Install the Meeting transcripts module to process new recordings">New recording</button>');
}

/**
 * @param {string} url
 * @returns {Promise<{ok: boolean, status: number, body: any}>}
 */
async function getJson(url) {
  const res = await fetch(url);
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { ok: res.ok, status: res.status, body };
}

// -- List ------------------------------------------------------------------

function tableRowsHtml(flat) {
  const folders = _data.folders || [];
  const cats = categoriesById();
  const rows = [];
  let meetings;
  if (flat) {
    meetings = filterMeetings(_data.meetings, { query: _search, categoryId: _categoryId, categoriesById: cats });
  } else {
    for (const f of childrenOf(folders, _folderId)) {
      rows.push('<tr><td colspan="4"><div class="ma-folder-row">'
        + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-ma-folder="' + esc(f.id) + '">'
        + icon('16-ic-folder') + '<span>' + esc(f.name) + '</span></button>'
        + '<span class="ds-badge ds-badge--gray ds-badge--sm">' + countDeep(_data.meetings, folders, f.id) + '</span>'
        + '</div></td></tr>');
    }
    meetings = [...meetingsIn(_data.meetings, folders, _folderId)]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }
  for (const m of meetings) {
    const badges = (m.status === 'error' ? ' <span class="ds-badge ds-badge--red ds-badge--sm">Error</span>' : '')
      + (m.isManual ? ' <span class="ds-badge ds-badge--gray ds-badge--sm">Manual</span>' : '')
      + (m.autoFolder ? ' <span class="ds-badge ds-badge--yellow ds-badge--sm" title="' + esc(m.autoFolder.reason) + '">Auto folder</span>' : '');
    const catNames = (m.categoryIds || []).map((id) => (cats[id] ? cats[id].name : '')).filter(Boolean).join(', ');
    rows.push('<tr>'
      + '<td>' + esc(m.date || '—') + '</td>'
      + '<td><a class="ds-btn ds-btn--tertiary ds-btn--sm ma-open" data-ma-open href="#' + VIEW_ID + '/' + encodeURIComponent(m.folder) + '">'
      + esc(m.title) + '</a>' + badges + '</td>'
      + '<td>' + esc(catNames || '—') + '</td>'
      + '<td><div>' + avatarsHtml(m.participants) + '</div></td>'
      + '</tr>');
  }
  if (!rows.length) {
    rows.push('<tr><td colspan="4">' + (flat ? 'No results for these filters.' : 'This folder is empty.') + '</td></tr>');
  }
  return rows.join('');
}

function paintTable() {
  const holder = document.getElementById('ma-table');
  if (!holder || !_data) return;
  const flat = !!(_search.trim() || _categoryId);
  holder.innerHTML = '<div class="ds-table-wrap ma-table-scroll"><table class="ds-table ma-table"><thead><tr>'
    + '<th>Meeting date</th><th>Topic</th><th>Category</th><th>Participants</th>'
    + '</tr></thead><tbody>' + tableRowsHtml(flat) + '</tbody></table></div>';
  const crumbs = document.getElementById('ma-breadcrumb');
  if (crumbs) crumbs.hidden = flat;
}

/**
 * The one navigation row of both screens. Detail adds the back button on the left.
 * @param {string} title meeting title in the detail, '' on the list
 * @param {string|null} folderId
 * @returns {string}
 */
function navRowHtml(title, folderId) {
  const items = buildCrumbs((_data && _data.folders) || [], folderId, title);
  const parts = items.map((c) => (c.current
    ? '<span class="ma-crumb-current" aria-current="page">' + esc(c.label) + '</span>'
    : '<a class="ma-crumb" href="#' + VIEW_ID + '" data-ma-crumb="' + esc(c.folderId) + '">' + esc(c.label) + '</a>'));
  const back = title
    ? '<a class="ds-btn ds-btn--tertiary ds-btn--sm ma-back" href="#' + VIEW_ID + '" data-ma-back>'
      + icon('16-ic-chevron-left') + 'Back to the list</a>'
    : '';
  return '<div class="ma-navrow" id="ma-breadcrumb">' + back + '<nav class="ma-crumbs" aria-label="Path">'
    + parts.join('<span class="ma-crumb-sep" aria-hidden="true">›</span>') + '</nav></div>';
}

function paintList(root) {
  // The folder the person was in may be gone (deleted in "Categories and folders"
  // or by a teammate): without this the list sticks on an empty folder whose
  // breadcrumb has no link back.
  if (_folderId && !((_data.folders || []).some((f) => f.id === _folderId))) _folderId = null;
  if (_data.storage === 'unavailable') {
    root.innerHTML = _empty
      ? _empty.emptyHeroHtml({
        title: 'No meeting archive on this computer',
        message: 'Pull the "Team data" source in the Sync window and the archive will appear here.',
      })
      : calloutHtml('info', 'No meeting archive on this computer. Pull the "Team data" source in the Sync window.');
    return;
  }
  const options = '<option value="">All categories</option>'
    + (_data.categories || []).map((c) => '<option value="' + esc(c.id) + '"'
      + (c.id === _categoryId ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('');
  root.innerHTML = navRowHtml('', _folderId)
    + '<div class="ma-filter-row">'
    + '<input type="search" class="ds-input" id="ma-search" placeholder="Search meetings..." aria-label="Search meetings" value="' + esc(_search) + '">'
    + '<select class="ds-input" id="ma-category" aria-label="Category">' + options + '</select>'
    + '</div><div id="ma-table"></div>';
  const sel = root.querySelector('#ma-category');
  if (sel && _selectLib) { try { _selectLib.initSelect(sel); } catch { /* native select stays */ } }
  paintTable();
}

async function renderList(root, token) {
  paintActions('list');
  root.innerHTML = skeletonHtml();
  if (!_data) {
    let r;
    try { r = await getJson(view._deps.apiBase + '/list'); } catch { r = { ok: false, status: 0, body: null }; }
    if (token !== _renderToken) return;
    if (!r.ok || !r.body) {
      root.innerHTML = calloutHtml('danger', 'Could not load the meeting archive. Try again in a moment.');
      return;
    }
    _data = r.body;
  }
  if (token !== _renderToken) return;
  paintActions('list');
  paintList(root);
  if (_listScroll > 0) { const y = _listScroll; _listScroll = 0; window.scrollTo(0, y); }
}

// -- Detail ----------------------------------------------------------------

function downloadBlob(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function summaryTextHtml(d) {
  if (!d.summaryMd) return '<p>No summary.</p>';
  return _md && _md.renderMarkdown
    ? '<div class="ma-article">' + _md.renderMarkdown(d.summaryMd) + '</div>'
    : '<pre class="ma-pre">' + esc(d.summaryMd) + '</pre>';
}

function transcriptHtml(d) {
  if (d.transcript && d.transcript.length) {
    const blocks = groupTranscript(d.transcript);
    if (blocks.length) {
      return blocks.map((b, i) => '<div class="ma-transcript-block">'
        + '<div><span class="ma-transcript-spk">' + esc(speakerLabel(b.speaker, i)) + '</span> '
        + '<span class="ma-transcript-ts">' + esc(tsLabel(b.start)) + '</span></div>'
        + b.texts.map((t) => '<p>' + esc(t) + '</p>').join('') + '</div>').join('');
    }
  }
  if (d.transcriptText) return '<pre class="ma-pre">' + esc(d.transcriptText) + '</pre>';
  return '<p>' + (d.isManual ? 'Entry added by hand - no recording and no transcript.' : 'No transcript.') + '</p>';
}

function detailHtml(d) {
  const kinds = d.htmlKinds || [];
  const hasTranscript = !!(d.hasTranscript || (d.transcript && d.transcript.length) || d.transcriptText);
  const badges = (d.categories || []).map((c) => '<span class="ds-badge ds-badge--blue ds-badge--sm">' + esc(c.name) + '</span>')
    .concat(d.status === 'error' ? ['<span class="ds-badge ds-badge--red ds-badge--sm">Error</span>'] : [])
    .concat(d.isManual ? ['<span class="ds-badge ds-badge--gray ds-badge--sm">Manual</span>'] : [])
    .concat(d.autoFolder ? ['<span class="ds-badge ds-badge--yellow ds-badge--sm" title="' + esc(d.autoFolder.reason) + '">Folder assigned automatically'
      + (d.autoFolder.by === 'claude' ? ' (Claude)' : ' (series)') + '</span>'] : [])
    .concat(d.sourceTranscript ? ['<span class="ds-badge ds-badge--gray ds-badge--sm" title="' + esc(d.sourceTranscript) + '">From the Transcripts module</span>'] : []);
  const meta = [d.date || '', d.durationSec > 0 ? tsLabel(d.durationSec) : ''].filter(Boolean).join(' · ');
  const head = '<div class="ma-detail-head"><div class="ma-detail-titles"><h2 class="ma-title">' + esc(d.title) + '</h2>'
    + '<div class="ma-detail-meta">' + (meta ? '<span>' + esc(meta) + '</span>' : '') + badges.join('') + '</div></div>'
    + '<div class="ma-detail-actions">'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ma-edit>' + icon('16-ic-edit') + 'Edit</button>'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ma-dl="md">Download .md</button>'
    + (kinds.length ? '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ma-dl="html">Download .html</button>' : '')
    + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm ma-danger" data-ma-delete>Delete</button>'
    + '</div></div>';
  const danger = d.status === 'error'
    ? calloutHtml('danger', esc(d.errorReason || 'Processing the meeting ended with an error.')) : '';
  const brief = String(d.brief || '').split(/\n\s*\n/).filter((p) => p.trim())
    .map((p) => '<p>' + esc(p.trim()) + '</p>').join('');
  const intro = (brief ? '<div class="ma-brief">' + brief + '</div>' : '')
    + ((d.participants || []).length ? '<div class="ma-people-wrap">' + avatarsHtml(d.participants, { names: true }) + '</div>' : '');
  const segs = kinds.length
    ? '<div class="ma-summary-toolbar"><div class="ds-segmented" role="group" aria-label="Summary view">'
      + '<button type="button" class="ds-segment active" data-ma-seg="text" aria-pressed="true">Text</button>'
      + '<button type="button" class="ds-segment" data-ma-seg="report" aria-pressed="false">Report</button></div></div>' : '';
  const summary = segs + '<div id="ma-summary-content">' + summaryTextHtml(d) + '</div>';
  let inner;
  if (!hasTranscript) {
    inner = '<div id="ma-panel-summary">' + summary + '</div>';
  } else {
    inner = '<nav class="ds-tabs-list ds-framed-tabs" role="tablist" aria-label="Meeting content">'
      + '<button type="button" class="ds-tab active" role="tab" id="ma-tab-summary" aria-selected="true" aria-controls="ma-panel-summary" data-ma-tab="summary">Summary</button>'
      + '<button type="button" class="ds-tab" role="tab" id="ma-tab-transcript" aria-selected="false" aria-controls="ma-panel-transcript" data-ma-tab="transcript">Transcript</button>'
      + '</nav>'
      + '<div role="tabpanel" id="ma-panel-summary" aria-labelledby="ma-tab-summary">' + summary + '</div>'
      + '<div role="tabpanel" id="ma-panel-transcript" aria-labelledby="ma-tab-transcript" hidden>' + transcriptHtml(d) + '</div>';
  }
  const fid = d.folderId || (((_data && _data.meetings) || []).find((m) => m.folder === d.folder) || {}).folderId || null;
  return navRowHtml(d.title, fid)
    + '<div class="ds-card"><div class="ds-card-body ma-detail">' + head + danger + intro + inner + '</div></div>';
}

async function renderDetail(root, folder, token) {
  paintActions('detail');
  root.innerHTML = skeletonHtml();
  if (!FOLDER_RE.test(folder) || folder.startsWith('_')) {
    root.innerHTML = calloutHtml('danger', 'Invalid meeting address.');
    return;
  }
  let r;
  try { r = await getJson(view._deps.apiBase + '/meeting?folder=' + encodeURIComponent(folder)); } catch { r = { ok: false, status: 0, body: null }; }
  if (token !== _renderToken) return;
  if (r.status === 404) {
    root.innerHTML = calloutHtml('warning', 'Meeting not found.');
    return;
  }
  if (!r.ok || !r.body) {
    root.innerHTML = calloutHtml('danger', 'Could not load the meeting. Try again in a moment.');
    return;
  }
  if (r.body.storage === 'unavailable') {
    root.innerHTML = calloutHtml('info', 'No meeting archive on this computer. Pull the "Team data" source in the Sync window.');
    return;
  }
  _detail = r.body;
  if (!_data) {
    try { const l = await getJson(view._deps.apiBase + '/list'); if (l.ok && l.body) _data = l.body; } catch { /* crumbs without folders */ }
    if (token !== _renderToken) return;
  }
  window.scrollTo(0, 0);
  root.innerHTML = detailHtml(_detail);
}

async function fetchHtml(folder, kinds) {
  const kind = kinds.includes('summary') ? 'summary' : 'report';
  const key = folder + '|' + kind;
  if (_htmlCache.has(key)) return _htmlCache.get(key);
  const r = await getJson(view._deps.apiBase + '/html?folder=' + encodeURIComponent(folder) + '&kind=' + kind);
  if (!r.ok || !r.body || typeof r.body.html !== 'string') throw new Error('html-' + r.status);
  _htmlCache.set(key, r.body.html);
  return r.body.html;
}

async function showSegment(root, seg, btn) {
  const holder = root.querySelector('#ma-summary-content');
  if (!holder || !_detail) return;
  root.querySelectorAll('[data-ma-seg]').forEach((b) => {
    const on = b === btn;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  if (seg === 'text') { holder.innerHTML = summaryTextHtml(_detail); return; }
  holder.innerHTML = skeletonHtml();
  try {
    const html = await fetchHtml(_detail.folder, _detail.htmlKinds || []);
    if (!root.contains(holder)) return;
    holder.innerHTML = '<iframe class="ma-html-frame" sandbox="" title="Meeting HTML report"></iframe>';
    holder.firstElementChild.srcdoc = html;
  } catch {
    holder.innerHTML = calloutHtml('danger', 'Could not load the HTML report.');
  }
}

async function downloadHtml(btn) {
  if (!_detail) return;
  btn.setAttribute('aria-busy', 'true');
  try {
    const html = await fetchHtml(_detail.folder, _detail.htmlKinds || []);
    downloadBlob(html, _detail.folder + '.html', 'text/html');
  } catch {
    view._deps.showToast('danger', 'Could not download the HTML report.');
  } finally {
    btn.removeAttribute('aria-busy');
  }
}

function selectTab(root, name) {
  root.querySelectorAll('[data-ma-tab]').forEach((b) => {
    const on = b.getAttribute('data-ma-tab') === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  const sum = root.querySelector('#ma-panel-summary');
  const tr = root.querySelector('#ma-panel-transcript');
  if (sum) sum.hidden = name !== 'summary';
  if (tr) tr.hidden = name !== 'transcript';
}

// -- Writes ----------------------------------------------------------------

let _actionsWired = false;

/** Actions bar lives outside the root: one delegated listener for it. */
function wireActions(actions) {
  _actionsWired = true;
  const onClick = (e) => {
    if (e.target && e.target.closest && e.target.closest('[data-ma-manage]')) openManageModal(e.target.closest('[data-ma-manage]'));
  };
  actions.addEventListener('click', onClick);
  view._deps.registerViewCleanup(() => { actions.removeEventListener('click', onClick); _actionsWired = false; });
}

/**
 * @param {string} path module route
 * @param {object} body
 * @returns {Promise<any>} parsed answer; throws with the server message
 */
async function postJson(path, body) {
  const res = await fetch(view._deps.apiBase + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) throw new Error((data && data.message) || ('HTTP ' + res.status));
  return data;
}

/** Sentence for a failed push code. */
function pushFailText(push) {
  const code = (push && push.error) || '';
  if (code === 'unknown-operation') return 'Pushing to the "Team data" source is not enabled in this Mission Deck yet.';
  if (code === 'no-write-token' || code === 'no-token') return 'No token with write access to team data - unlock the vault (Bitwarden).';
  if (code === 'key-missing') return 'No encryption key for team data on this computer.';
  if (code === 'locked') return 'Another process is syncing team data right now.';
  return (push && push.message) || 'The push failed (' + (code || 'error') + ').';
}

/**
 * @param {string} what "Saved ..." headline
 * @param {{ok: boolean, error?: string, message?: string}} push
 */
function pushToast(what, push) {
  if (push && push.ok) {
    view._deps.showToast('success', what, 'Changes sent to the team.');
  } else {
    view._deps.showToast('warning', what + ' on this computer only',
      pushFailText(push) + ' Send them later in the Sync window.');
  }
}

/**
 * Minimal DS form modal.
 * @param {{title: string, bodyHtml: string, submitLabel: string, danger?: boolean,
 *   onSubmit: (overlay: HTMLElement) => Promise<boolean>, onClick?: (e: Event, overlay: HTMLElement) => void,
 *   onClose?: () => void}} o
 * @param {HTMLElement} [trigger]
 */
async function openFormModal(o, trigger) {
  let dsModal = null;
  try { dsModal = await import('/js/ds-modal.js'); } catch { dsModal = null; }
  document.querySelectorAll('[data-ma-modal]').forEach((el) => el.remove());
  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.setAttribute('data-ma-modal', '1');
  overlay.hidden = true;
  overlay.innerHTML = '<div class="ds-modal ds-modal--md" role="dialog" aria-modal="true" aria-labelledby="ma-modal-title">'
    + '<div class="ds-modal-header"><h2 class="ds-modal-title" id="ma-modal-title">' + esc(o.title) + '</h2>'
    + '<button type="button" class="ds-icon-btn ds-icon-btn--sm" data-ma-close aria-label="Close">' + icon('16-ic-cross') + '</button></div>'
    + '<form class="ds-modal-body ma-form" data-ma-form novalidate>' + o.bodyHtml + '</form>'
    + '<div class="ds-modal-footer">'
    + (o.submitLabel ? '<button type="button" class="ds-btn ' + (o.danger ? 'ds-btn--danger' : 'ds-btn--primary') + '" data-ma-submit>' + esc(o.submitLabel) + '</button>' : '')
    + '<button type="button" class="ds-btn ds-btn--tertiary" data-ma-close>' + (o.submitLabel ? 'Cancel' : 'Close') + '</button></div></div>';
  document.body.appendChild(overlay);
  const shut = () => {
    if (!overlay.isConnected) return;
    if (dsModal) dsModal.closeDsModal(overlay);
    overlay.remove();
    if (o.onClose) o.onClose();
  };
  const submit = async () => {
    const btn = overlay.querySelector('[data-ma-submit]');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    let close = false;
    try { close = await o.onSubmit(overlay); } finally {
      if (btn.isConnected) { btn.disabled = false; btn.removeAttribute('aria-busy'); }
    }
    if (close) shut();
  };
  overlay.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-ma-close]')) { shut(); return; }
    if (t.closest('[data-ma-submit]')) { submit(); return; }
    if (o.onClick) o.onClick(e, overlay);
  });
  overlay.addEventListener('submit', (e) => { e.preventDefault(); submit(); });
  view._deps.registerViewCleanup(() => { if (overlay.isConnected) shut(); });
  if (dsModal) dsModal.openDsModal(overlay, { trigger });
  else { overlay.hidden = false; overlay.classList.add('open'); }
  return overlay;
}

/** Folder options, indented by depth. */
function folderOptionsHtml(selectedId, excludeIds) {
  const folders = (_data && _data.folders) || [];
  const out = ['<option value="">(no folder)</option>'];
  const walk = (parentId, depth) => {
    for (const f of childrenOf(folders, parentId)) {
      if (excludeIds && excludeIds.has(f.id)) continue;
      out.push('<option value="' + esc(f.id) + '"' + (f.id === selectedId ? ' selected' : '') + '>'
        + '  '.repeat(depth) + esc(f.name) + '</option>');
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out.join('');
}

async function ensureList() {
  if (_data) return;
  try { const l = await getJson(view._deps.apiBase + '/list'); if (l.ok && l.body) _data = l.body; } catch { /* empty pickers */ }
}

async function openEditModal(trigger) {
  const d = _detail;
  if (!d) return;
  await ensureList();
  const cats = (_data && _data.categories) || [];
  const chosen = new Set(d.categoryIds || []);
  const body = '<div class="ds-input-wrap"><label class="ds-label" for="ma-edit-title">Title</label>'
    + '<input class="ds-input" id="ma-edit-title" name="title" maxlength="200" value="' + esc(d.customTitle || d.title) + '"></div>'
    + '<div class="ds-input-wrap"><label class="ds-label" for="ma-edit-date">Meeting date</label>'
    + '<input class="ds-input" type="date" id="ma-edit-date" name="date" value="' + esc(d.date || '') + '"></div>'
    + '<div class="ds-input-wrap"><label class="ds-label" for="ma-edit-folder">Folder</label>'
    + '<select class="ds-input" id="ma-edit-folder" name="folder">' + folderOptionsHtml(d.folderId || null) + '</select></div>'
    + '<fieldset class="ma-fieldset"><legend class="ds-label">Categories</legend>'
    + (cats.length
      ? '<div class="ds-checkbox-group ma-checks">' + cats.map((c) => '<label class="ds-checkbox-label"><input type="checkbox" name="cat" value="' + esc(c.id) + '"'
        + (chosen.has(c.id) ? ' checked' : '') + '><span>' + esc(c.name) + '</span></label>').join('') + '</div>'
      : '<div class="ds-hint">No categories. Add them in the "Categories and folders" window.</div>')
    + '</fieldset>';
  await openFormModal({
    title: 'Edit meeting',
    bodyHtml: body,
    submitLabel: 'Save and send',
    onSubmit: async (ov) => {
      const title = ov.querySelector('#ma-edit-title').value.trim();
      const date = ov.querySelector('#ma-edit-date').value || null;
      const folderId = ov.querySelector('#ma-edit-folder').value || null;
      const categoryIds = [...ov.querySelectorAll('input[name="cat"]:checked')].map((i) => i.value);
      try {
        const r = await postJson('/meta', {
          folder: d.folder, title: title === d.title && !d.customTitle ? '' : title, date, folderId, categoryIds,
        });
        pushToast('Meeting changes saved', r.push);
        refreshAfterWrite();
        return true;
      } catch (e) {
        view._deps.showToast('danger', 'Could not save', e.message || '');
        return false;
      }
    },
  }, trigger);
}

async function confirmDelete(trigger) {
  const d = _detail;
  if (!d) return;
  await openFormModal({
    title: 'Delete meeting?',
    bodyHtml: '<p>The meeting <b>' + esc(d.title) + '</b> will disappear from the whole team\'s archive (summary, transcript and report). '
      + 'If it came from the Meeting transcripts module, you can send it again from there.</p>',
    submitLabel: 'Delete from archive',
    danger: true,
    onSubmit: async () => {
      try {
        const r = await postJson('/delete', { folder: d.folder });
        pushToast('Meeting deleted', r.push);
        _detail = null;
        _data = null;
        view._deps.navigate(VIEW_ID);
        return true;
      } catch (e) {
        view._deps.showToast('danger', 'Could not delete', e.message || '');
        return false;
      }
    },
  }, trigger);
}

function refreshAfterWrite() {
  _data = null;
  _htmlCache.clear();
  view.render(location.hash.replace(/^#meeting-archive-main\/?/, '').split('?')[0]);
}

function manageBodyHtml() {
  const cats = (_data && _data.categories) || [];
  const folders = (_data && _data.folders) || [];
  const rowsCats = cats.map((c) => '<li class="ma-manage-row"><span>' + esc(c.name) + '</span>'
    + '<span class="ma-manage-acts"><button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-ma-cat-rename="' + esc(c.id) + '">Rename</button>'
    + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm ma-danger" data-ma-cat-delete="' + esc(c.id) + '">Delete</button></span></li>').join('');
  const rowsFolders = [];
  const walk = (pid, depth) => {
    for (const f of childrenOf(folders, pid)) {
      rowsFolders.push('<li class="ma-manage-row" style="padding-left:' + (depth * 16) + 'px"><span>' + icon('16-ic-folder') + esc(f.name) + '</span>'
        + '<span class="ma-manage-acts"><button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-ma-fld-rename="' + esc(f.id) + '">Rename</button>'
        + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm ma-danger" data-ma-fld-delete="' + esc(f.id) + '">Delete</button></span></li>');
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return '<h3 class="ma-manage-h">Categories</h3>'
    + '<ul class="ma-manage-list">' + (rowsCats || '<li class="ds-hint">No categories.</li>') + '</ul>'
    + '<div class="ma-manage-add"><input class="ds-input" id="ma-new-cat" maxlength="80" placeholder="New category" aria-label="New category name">'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ma-cat-add>Add</button></div>'
    + '<h3 class="ma-manage-h">Folders</h3>'
    + '<ul class="ma-manage-list">' + (rowsFolders.join('') || '<li class="ds-hint">No folders.</li>') + '</ul>'
    + '<div class="ma-manage-add"><input class="ds-input" id="ma-new-folder" maxlength="80" placeholder="New folder" aria-label="New folder name">'
    + '<select class="ds-input" id="ma-new-folder-parent" aria-label="Parent folder">' + folderOptionsHtml(null).replace('(no folder)', '(top level)') + '</select>'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-ma-fld-add>Add</button></div>'
    + '<div class="ds-hint">Every change is saved at once and sent to the team.</div>';
}

/** DS confirm dialog (danger); "no" when the core helper is missing. */
async function ask(title, body) {
  try {
    const m = await import('/js/ds-modal.js');
    return await m.confirmDsModal({ title, body, okLabel: 'Delete', danger: true });
  } catch {
    return false;
  }
}

async function openManageModal(trigger) {
  await ensureList();
  const run = async (ov, path, body, okText) => {
    try {
      const r = await postJson(path, body);
      pushToast(okText, r.push);
      _data = null;
      await ensureList();
      const form = ov.querySelector('[data-ma-form]');
      if (form) form.innerHTML = manageBodyHtml();
    } catch (e) {
      view._deps.showToast('danger', 'Could not save', e.message || '');
    }
  };
  const nameOf = (list, id) => ((list || []).find((x) => x.id === id) || {}).name || '';
  await openFormModal({
    title: 'Categories and folders',
    bodyHtml: manageBodyHtml(),
    submitLabel: '',
    onSubmit: async () => true,
    // The modal can change the tree under the list: repaint on close.
    onClose: () => { if (!/^#meeting-archive-main\/./.test(location.hash)) refreshAfterWrite(); },
    onClick: (e, ov) => {
      const t = e.target;
      if (t.closest('[data-ma-cat-add]')) {
        const v = ov.querySelector('#ma-new-cat').value.trim();
        if (v) run(ov, '/categories', { action: 'add', name: v }, 'Category added');
        return;
      }
      if (t.closest('[data-ma-fld-add]')) {
        const v = ov.querySelector('#ma-new-folder').value.trim();
        const parentId = ov.querySelector('#ma-new-folder-parent').value || null;
        if (v) run(ov, '/folders', { action: 'add', name: v, parentId }, 'Folder added');
        return;
      }
      const cr = t.closest('[data-ma-cat-rename]');
      if (cr) {
        const id = cr.getAttribute('data-ma-cat-rename');
        const v = window.prompt('New category name', nameOf(_data.categories, id));
        if (v && v.trim()) run(ov, '/categories', { action: 'rename', id, name: v.trim() }, 'Category renamed');
        return;
      }
      const cd = t.closest('[data-ma-cat-delete]');
      if (cd) {
        const id = cd.getAttribute('data-ma-cat-delete');
        ask('Delete category?', 'The category "' + nameOf(_data.categories, id) + '" will disappear and meetings will lose this label.')
          .then((yes) => { if (yes) run(ov, '/categories', { action: 'delete', id }, 'Category deleted'); });
        return;
      }
      const fr = t.closest('[data-ma-fld-rename]');
      if (fr) {
        const id = fr.getAttribute('data-ma-fld-rename');
        const v = window.prompt('New folder name', nameOf(_data.folders, id));
        if (v && v.trim()) run(ov, '/folders', { action: 'rename', id, name: v.trim() }, 'Folder renamed');
        return;
      }
      const fd = t.closest('[data-ma-fld-delete]');
      if (fd) {
        const id = fd.getAttribute('data-ma-fld-delete');
        ask('Delete folder?', 'The folder "' + nameOf(_data.folders, id) + '" will disappear together with its subfolders. Its meetings move one level up.')
          .then((yes) => { if (yes) run(ov, '/folders', { action: 'delete', id }, 'Folder deleted'); });
      }
    },
  }, trigger);
}

// -- View ------------------------------------------------------------------

async function loadHelpers() {
  const tryImport = async (p) => { try { return await import(p); } catch { return null; } };
  [_td, _md, _selectLib, _empty] = await Promise.all([
    tryImport('/js/team-directory.js'), tryImport('/js/md-render.js'),
    tryImport('/js/ds-select.js'), tryImport('/js/empty-state.js'),
  ]);
  if (_td && _td.loadTeamDirectory) { try { await _td.loadTeamDirectory(); } catch { /* initials only */ } }
}

const view = {
  _wired: false,
  _deps: null,
  _ready: null,

  /** @param {{ navigate, registerViewCleanup, showToast, apiBase }} deps */
  init(deps) {
    this._deps = deps;
    this._ready = loadHelpers();
  },

  /**
   * @param {string} subPath folder name of one meeting, or '' for the list
   */
  async render(subPath) {
    const root = document.getElementById(VIEW_ID + '-root');
    if (!root) return;
    const token = ++_renderToken;
    if (this._ready) await this._ready;
    if (token !== _renderToken) return;
    this._wire(root);
    const folder = String(subPath || '').replace(/^\/+|\/+$/g, '');
    if (folder) await renderDetail(root, folder, token);
    else await renderList(root, token);
  },

  /** Team data changed: drop every cache and repaint where the user is. */
  onDataChanged() {
    _data = null;
    _detail = null;
    _htmlCache.clear();
  },

  _wire(root) {
    if (this._wired) return;
    this._wired = true;
    let timer = null;
    const onClick = (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      const open = t.closest('[data-ma-open]');
      if (open) { _listScroll = window.scrollY || 0; return; }
      const back = t.closest('[data-ma-back]');
      if (back) { e.preventDefault(); this._deps.navigate(VIEW_ID); return; }
      const crumb = t.closest('[data-ma-crumb]');
      if (crumb) {
        e.preventDefault();
        _folderId = crumb.getAttribute('data-ma-crumb') || null;
        _listScroll = 0;
        if (_detail && /^#meeting-archive-main\/./.test(location.hash)) this._deps.navigate(VIEW_ID);
        else paintList(root);
        return;
      }
      const folder = t.closest('[data-ma-folder]');
      if (folder) { _folderId = folder.getAttribute('data-ma-folder'); paintList(root); return; }
      const tab = t.closest('[data-ma-tab]');
      if (tab) { selectTab(root, tab.getAttribute('data-ma-tab')); return; }
      const seg = t.closest('[data-ma-seg]');
      if (seg) { showSegment(root, seg.getAttribute('data-ma-seg'), seg); return; }
      const edit = t.closest('[data-ma-edit]');
      if (edit) { openEditModal(edit); return; }
      const del = t.closest('[data-ma-delete]');
      if (del) { confirmDelete(del); return; }
      const dl = t.closest('[data-ma-dl]');
      if (dl && _detail) {
        if (dl.getAttribute('data-ma-dl') === 'md') downloadBlob(_detail.summaryMd || '', _detail.folder + '.md', 'text/markdown');
        else downloadHtml(dl);
      }
    };
    const onInput = (e) => {
      if (!e.target || e.target.id !== 'ma-search') return;
      clearTimeout(timer);
      timer = setTimeout(() => { _search = e.target.value; paintTable(); }, 150);
    };
    const onChange = (e) => {
      if (!e.target || e.target.id !== 'ma-category') return;
      _categoryId = e.target.value;
      paintTable();
    };
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    this._deps.registerViewCleanup(() => {
      clearTimeout(timer);
      root.removeEventListener('click', onClick);
      root.removeEventListener('input', onInput);
      root.removeEventListener('change', onChange);
      const sel = root.querySelector('#ma-category');
      if (sel && _selectLib) { try { _selectLib.destroySelect(sel); } catch { /* already gone */ } }
      this._wired = false;
    });
  },
};

export const views = { [VIEW_ID]: view };
