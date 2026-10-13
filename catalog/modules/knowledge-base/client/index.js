// modules/knowledge-base/client/index.js
// Read-only browser of the knowledge base. One manifest view; the detail is an
// in-view state driven by the hash sub-path #knowledge-base-list/<encoded path>.
// Nothing here writes anything. Every non-GET fetch sends Content-Type JSON.

import {
  DOC_TYPES, categoryLabel, filterArticles, sortArticles, areaOptions, displayLabel, segmentCounts, hasConfluence, buildCrumbs,
} from './filters.mjs';

const VIEW_ID = 'knowledge-base-list';
const ROOT_ID = VIEW_ID + '-root';
const ACTIONS_ID = VIEW_ID + '-actions';
const ICONS = '/assets/icons/ds/';
// Strip tone per category: a state-token family (bg / text / border).
const STRIP_BY_CATEGORY = {
  interviews: 'info',
  research: 'brand',
  meetings: 'info',
  workshop: 'warning',
  'ux-brief': 'brand',
  'business-requirements': 'success',
  notes: 'info',
  'as-is': 'brand',
  estimates: 'warning',
  'data-analysis': 'success',
  general: 'inactive',
  other: 'inactive',
};

let _deps = null;
let _data = null;
let _filters = { area: '', subArea: '', docType: '', search: '', sort: 'date-desc' };
let _detail = null;
let _check = {};
let _tab = 'content';
let _md = null;
let _dsSelect = null;
let _confluence = null;
let _wired = null;
let _debounce = null;
let _selectEl = null;
let _listScroll = 0;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (slug) => '<img class="nav-icon" src="' + ICONS + slug + '.svg" alt="" aria-hidden="true">';
const apiBase = () => (_deps && _deps.apiBase) || '/api/m/knowledge-base';

function fmtDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? m[3] + '.' + m[2] + '.' + m[1] : String(s || '');
}

function unwire() {
  if (_debounce) { clearTimeout(_debounce); _debounce = null; }
  if (_selectEl && _dsSelect && typeof _dsSelect.destroySelect === 'function') {
    try { _dsSelect.destroySelect(_selectEl); } catch { /* already gone */ }
  }
  _selectEl = null;
  if (!_wired) return;
  const w = _wired;
  _wired = null;
  w.root.removeEventListener('click', w.onClick);
  w.root.removeEventListener('input', w.onInput);
  w.root.removeEventListener('change', w.onChange);
  if (w.actions) w.actions.removeEventListener('click', w.onActions);
}

function wire(root, actions) {
  const w = {
    root,
    actions,
    onClick: (e) => onRootClick(e),
    onInput: (e) => onSearchInput(e),
    onChange: (e) => onSortChange(e),
    onActions: (e) => onActionsClick(e),
  };
  root.addEventListener('click', w.onClick);
  root.addEventListener('input', w.onInput);
  root.addEventListener('change', w.onChange);
  if (actions) actions.addEventListener('click', w.onActions);
  _wired = w;
  _deps.registerViewCleanup(unwire);
}

function rootEl() { return document.getElementById(ROOT_ID); }

function warnCallout(message) {
  return '<div class="ds-callout ds-callout--warning"><div>' + esc(message) + '</div></div>';
}

// -- data --------------------------------------------------------------------

async function loadList() {
  const res = await fetch(apiBase() + '/list');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function loadConfluence() {
  if (_confluence) return _confluence;
  try {
    const res = await fetch('/api/knowledge-base/confluence-configured');
    _confluence = res.ok ? await res.json() : { configured: false, baseUrl: '' };
  } catch {
    _confluence = { configured: false, baseUrl: '' };
  }
  return _confluence;
}

// -- list --------------------------------------------------------------------

function withCount(label, n) {
  return n > 0 ? label + ' (' + n + ')' : label;
}

function segmentRow(label, items, activeId, dataAttr) {
  return '<div class="kb-toolbar" role="group" aria-label="' + esc(label) + '"><div class="ds-segmented kb-seg">'
    + items.map((it) => '<button type="button" class="ds-segment' + (it.id === activeId ? ' active' : '')
      + '" aria-pressed="' + (it.id === activeId ? 'true' : 'false') + '" ' + dataAttr + '="' + esc(it.id) + '">'
      + esc(it.label) + '</button>').join('')
    + '</div></div>';
}

function cardHtml(a) {
  const tone = STRIP_BY_CATEGORY[a.category] || 'inactive';
  const badges = [];
  if (a.type) badges.push('<span class="ds-badge ds-badge--sm ds-badge--gray">' + esc(a.type) + '</span>');
  if (a.status) badges.push('<span class="ds-badge ds-badge--sm ds-badge--green">' + esc(a.status) + '</span>');
  const meta = [fmtDate(a.date), a.author].filter(Boolean).join(' · ');
  return '<article class="ds-card kb-card" data-kb-card><div class="kb-card-strip kb-card-strip--' + tone + '">'
    + esc(categoryLabel(a.category)) + '</div><div class="ds-card-body">'
    + '<h3 class="kb-card-title"><a class="kb-card-link" href="#' + VIEW_ID + '/' + encodeURIComponent(a.path) + '" data-kb-open="'
    + esc(a.path) + '">' + esc(a.title) + '</a></h3>'
    + (badges.length ? '<div class="kb-card-badges">' + badges.join('') + '</div>' : '')
    + (a.summary ? '<p class="kb-card-summary">' + esc(a.summary) + '</p>' : '')
    + (meta ? '<div class="kb-card-meta">' + esc(meta) + '</div>' : '')
    + '</div></article>';
}

function crumbsHtml(areas, filters, title, withBack) {
  const items = buildCrumbs(areas, filters, title);
  const parts = items.map((c) => (c.current
    ? '<span class="kb-crumb-current" aria-current="page">' + esc(c.label) + '</span>'
    : '<a class="kb-crumb" href="#' + VIEW_ID + '" data-kb-crumb data-kb-c-area="' + esc(c.area) + '" data-kb-c-sub="' + esc(c.subArea) + '">' + esc(c.label) + '</a>'));
  const back = withBack
    ? '<a class="ds-btn ds-btn--tertiary ds-btn--sm kb-back" href="#' + VIEW_ID + '" data-kb-back>' + icon('16-ic-chevron-left') + 'Back to the list</a>'
    : '';
  return '<div class="kb-navrow">' + back + '<nav class="kb-crumbs" aria-label="Breadcrumb">'
    + parts.join('<span class="kb-crumb-sep" aria-hidden="true">›</span>') + '</nav></div>';
}

function listHtml() {
  const areas = areaOptions(_data.areas, _data.articles);
  const counts = segmentCounts(_data.articles, _filters);
  const cur = areas.find((a) => a.slug === _filters.area);
  const rows = [];
  rows.push(segmentRow('Area', [{ id: '', label: 'All areas' }].concat(areas.map((a) => ({ id: a.slug, label: withCount(displayLabel(a.label), counts.area[a.slug] || 0) }))), _filters.area, 'data-kb-area'));
  if (cur && cur.subareas.length) {
    rows.push(segmentRow('Sub-area', [{ id: '', label: 'All (' + (counts.sub[''] || 0) + ')' }].concat(cur.subareas.map((s) => ({ id: s.slug, label: displayLabel(s.label) + ' (' + (counts.sub[s.slug] || 0) + ')' }))), _filters.subArea, 'data-kb-sub'));
  }
  rows.push(segmentRow('Document type', DOC_TYPES.map((d) => ({ id: d.id, label: d.id ? withCount(d.label, counts.type[d.id] || 0) : 'All (' + counts.type[''] + ')' })), _filters.docType, 'data-kb-type'));
  rows.push('<div class="kb-toolbar">'
    + '<input type="search" class="ds-input kb-search" placeholder="Search..." aria-label="Search documents" value="' + esc(_filters.search) + '" data-kb-search>'
    + '<div class="kb-sort"><select class="ds-input" aria-label="Sort order" data-kb-sort>'
    + '<option value="date-desc"' + (_filters.sort === 'date-desc' ? ' selected' : '') + '>Newest</option>'
    + '<option value="title-asc"' + (_filters.sort === 'title-asc' ? ' selected' : '') + '>Title A-Z</option>'
    + '</select></div></div>');
  return crumbsHtml(areas, _filters, '', false) + '<div class="ds-card"><div class="ds-card-body kb-body">' + rows.join('') + '<div data-kb-results>' + resultsHtml() + '</div></div></div>';
}

function resultsHtml() {
  const list = sortArticles(filterArticles(_data.articles, _filters), _filters.sort);
  if (!list.length) {
    return '<div class="ds-empty"><div class="ds-empty-title">No documents match the filters.</div></div>';
  }
  return '<div class="kb-grid">' + list.map(cardHtml).join('') + '</div>';
}

function repaintResults() {
  const box = document.querySelector('#' + ROOT_ID + ' [data-kb-results]');
  if (box && _data) box.innerHTML = resultsHtml();
}

function enhanceSelect(root) {
  const sel = root.querySelector('[data-kb-sort]');
  if (!sel || !_dsSelect || typeof _dsSelect.initSelect !== 'function') return;
  try { _dsSelect.initSelect(sel); _selectEl = sel; } catch { /* bare select still works */ }
}

function renderListInto(root) {
  if (_data.storage !== 'ok') {
    root.innerHTML = warnCallout(_data.message || 'No knowledge base on this computer. Fetch the team data in the Sync window.');
    return;
  }
  root.innerHTML = listHtml();
  enhanceSelect(root);
}

// -- detail ------------------------------------------------------------------

function fileUrl(p, download) {
  return apiBase() + '/file?path=' + encodeURIComponent(p) + (download ? '&download=1' : '');
}

function actionsHtml(d) {
  let h = '<a class="ds-btn ds-btn--secondary ds-btn--sm" href="' + esc(fileUrl(d.path, true)) + '" download>Download .md</a>';
  if (d.hasHtml && d.htmlPath) {
    h += '<a class="ds-btn ds-btn--secondary ds-btn--sm" href="' + esc(fileUrl(d.htmlPath, false)) + '" target="_blank" rel="noopener noreferrer">HTML report '
      + icon('24-ic-external-link') + '</a>'
      + '<a class="ds-btn ds-btn--secondary ds-btn--sm" href="' + esc(fileUrl(d.htmlPath, true)) + '" download>Download .html</a>';
  }
  return h;
}

function confluenceLink(id) {
  const base = (_confluence && _confluence.baseUrl) || '';
  if (/^https?:\/\//.test(String(id))) return String(id);
  if (!base) return '';
  return base.replace(/\/+$/, '') + '/pages/viewpage.action?pageId=' + encodeURIComponent(id);
}

function checkRowHtml(id) {
  const r = _check[id];
  if (!r) return '';
  if (r.ok === false) {
    return '<div class="ds-callout ds-callout--danger"><div>' + esc(r.error || 'Could not check this page.') + '</div></div>';
  }
  const local = Number(_detail && _detail.confluenceVersion);
  const remote = Number(r.remoteVersion);
  if (Number.isFinite(local) && Number.isFinite(remote) && local > 0 && remote > local) {
    return '<span class="ds-badge ds-badge--amber">Newer version: v' + esc(remote) + (r.updated ? ' (' + esc(fmtDate(r.updated)) + ')' : '') + '</span>';
  }
  return '<span class="ds-badge ds-badge--green">Up to date</span>';
}

function confluenceTabHtml() {
  const d = _detail;
  const pages = d.confluencePages || [];
  if (!pages.length) return '<p>This document does not come from Confluence.</p>';
  const configured = !!(_confluence && _confluence.configured);
  const rows = pages.map((id) => {
    const href = confluenceLink(id);
    const label = /^https?:\/\//.test(String(id)) ? String(id) : 'Page ' + id;
    const link = href
      ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + '</a>'
      : '<span>' + esc(label) + '</span>';
    return '<div class="kb-check-row"><span class="kb-check-id">' + link + '</span><span></span><span data-kb-check="' + esc(id) + '">' + checkRowHtml(id) + '</span></div>';
  }).join('');
  return (d.confluenceVersion ? '<p class="kb-card-meta">Local version: v' + esc(d.confluenceVersion) + '</p>' : '')
    + rows
    + '<div class="ds-actions"><button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-kb-check-run'
    + (configured ? '' : ' disabled') + '>Check for updates</button></div>'
    + (configured ? '' : '<div class="ds-callout ds-callout--info"><div>No Confluence token - unlock the vault in Settings > Keys to check for updates.</div></div>')
    + '<div data-kb-check-msg></div>';
}

function detailHtml() {
  const d = _detail;
  const fm = d.frontmatter || {};
  const areas = _data ? areaOptions(_data.areas, _data.articles) : [];
  const flt = { area: d.area || '', subArea: d.subArea || '' };
  const trail = buildCrumbs(areas, flt, '').filter((c) => c.area).map((c) => c.label);
  const where = trail.length ? trail[trail.length - 1] === trail[0] ? trail[0] : trail.join(' / ') : '';
  const meta = [fmtDate(fm.date), categoryLabel(d.category), fm.author, where].filter(Boolean).join(' · ');
  const body = _md ? _md.renderMarkdown(d.body) : '<pre>' + esc(d.body) + '</pre>';
  const withConf = hasConfluence(d);
  const t = withConf && _tab === 'confluence' ? 'confluence' : 'content';
  const head = '<div class="kb-detail-head"><div class="kb-detail-titles"><h2 class="kb-title">' + esc(d.title) + '</h2>'
    + (meta ? '<div class="kb-detail-meta">' + esc(meta) + '</div>' : '') + '</div>'
    + '<div class="kb-detail-actions">' + actionsHtml(d) + '</div></div>';
  const content = '<div class="kb-article">' + body + '</div>';
  let inner;
  if (!withConf) {
    inner = content;
  } else {
    inner = '<div class="ds-tabs-list ds-framed-tabs" role="tablist" aria-label="Document sections">'
      + '<button type="button" class="ds-tab' + (t === 'content' ? ' active' : '') + '" role="tab" id="kb-tab-content" aria-selected="' + (t === 'content') + '" aria-controls="kb-panel-content" data-kb-tab="content">Content</button>'
      + '<button type="button" class="ds-tab' + (t === 'confluence' ? ' active' : '') + '" role="tab" id="kb-tab-confluence" aria-selected="' + (t === 'confluence') + '" aria-controls="kb-panel-confluence" data-kb-tab="confluence">Confluence</button>'
      + '</div>'
      + '<div class="kb-panel" id="kb-panel-content" role="tabpanel" aria-labelledby="kb-tab-content"' + (t === 'content' ? '' : ' hidden') + '>' + content + '</div>'
      + '<div class="kb-panel" id="kb-panel-confluence" role="tabpanel" aria-labelledby="kb-tab-confluence"' + (t === 'confluence' ? '' : ' hidden') + '>'
      + confluenceTabHtml() + '</div>';
  }
  return crumbsHtml(areas, flt, d.title, true)
    + '<div class="ds-card"><div class="ds-card-body kb-detail">' + head + inner + '</div></div>';
}

async function renderDetail(root, path) {
  root.innerHTML = '<div class="ds-skeleton kb-skel" data-skel="1" aria-hidden="true"></div>';
  let res;
  let j = null;
  try {
    res = await fetch(apiBase() + '/article?path=' + encodeURIComponent(path));
    if (res.ok) j = await res.json();
  } catch { res = null; }
  if (!res || !res.ok || !j || j.storage === 'unavailable') {
    _detail = null;
    root.innerHTML = (j && j.storage === 'unavailable')
      ? warnCallout(j.message)
      : '<div class="ds-callout ds-callout--danger"><div>Document not found.</div></div>';
    return;
  }
  _detail = j;
  _check = {};
  _tab = 'content';
  await loadConfluence();
  if (!_data) { try { _data = await loadList(); } catch { _data = null; } }
  window.scrollTo(0, 0);
  root.innerHTML = detailHtml();
}

async function runCheck(btn) {
  const d = _detail;
  if (!d || !d.confluencePages.length) return;
  const msg = document.querySelector('#' + ROOT_ID + ' [data-kb-check-msg]');
  btn.setAttribute('aria-busy', 'true');
  try {
    const res = await fetch('/api/knowledge-base/confluence-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages: d.confluencePages }),
    });
    const j = await res.json();
    if (j.error) {
      if (msg) msg.innerHTML = '<div class="ds-callout ds-callout--warning"><div>' + esc(j.message || 'Could not check Confluence for updates.') + '</div></div>';
      return;
    }
    if (msg) msg.innerHTML = '';
    _check = {};
    for (const p of j.pages || []) _check[String(p.id)] = p;
    for (const id of d.confluencePages) {
      const cell = document.querySelector('#' + ROOT_ID + ' [data-kb-check="' + CSS.escape(String(id)) + '"]');
      if (cell) cell.innerHTML = checkRowHtml(String(id));
    }
  } catch {
    if (msg) msg.innerHTML = '<div class="ds-callout ds-callout--danger"><div>Could not connect to Confluence.</div></div>';
  } finally {
    btn.removeAttribute('aria-busy');
  }
}

// -- events ------------------------------------------------------------------

function repaintList() {
  const root = rootEl();
  if (!root || !_data) return;
  unwire();
  const actions = document.getElementById(ACTIONS_ID);
  renderListInto(root);
  wire(root, actions);
}

function onActionsClick() { /* header-right slot stays empty */ }

function openDoc(p) {
  _listScroll = window.scrollY || 0;
  _deps.navigate(VIEW_ID + '/' + encodeURIComponent(p));
}

function onRootClick(e) {
  const t = e.target;
  const open = t.closest('[data-kb-open]');
  if (open) { e.preventDefault(); openDoc(open.getAttribute('data-kb-open')); return; }
  const back = t.closest('[data-kb-back]');
  if (back) { e.preventDefault(); _deps.navigate(VIEW_ID); return; }
  const crumb = t.closest('[data-kb-crumb]');
  if (crumb) {
    e.preventDefault();
    _filters.area = crumb.getAttribute('data-kb-c-area') || '';
    _filters.subArea = crumb.getAttribute('data-kb-c-sub') || '';
    _listScroll = 0;
    if (/^#knowledge-base-list\/./.test(location.hash)) _deps.navigate(VIEW_ID);
    else repaintList();
    return;
  }
  const card = t.closest('[data-kb-card]');
  if (card && !t.closest('a, button')) {
    const link = card.querySelector('[data-kb-open]');
    if (link) { openDoc(link.getAttribute('data-kb-open')); return; }
  }
  const tab = t.closest('[data-kb-tab]');
  if (tab) {
    _tab = tab.getAttribute('data-kb-tab');
    const root = rootEl();
    root.querySelectorAll('[data-kb-tab]').forEach((b) => {
      const on = b.getAttribute('data-kb-tab') === _tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    root.querySelector('#kb-panel-content').hidden = _tab !== 'content';
    root.querySelector('#kb-panel-confluence').hidden = _tab !== 'confluence';
    return;
  }
  const run = t.closest('[data-kb-check-run]');
  if (run) { runCheck(run); return; }
  if (!_data) return;
  const area = t.closest('[data-kb-area]');
  const sub = t.closest('[data-kb-sub]');
  const type = t.closest('[data-kb-type]');
  if (area) { _filters.area = area.getAttribute('data-kb-area'); _filters.subArea = ''; repaintList(); }
  else if (sub) { _filters.subArea = sub.getAttribute('data-kb-sub'); repaintList(); }
  else if (type) { _filters.docType = type.getAttribute('data-kb-type'); repaintList(); }
}

function onSearchInput(e) {
  if (!e.target.matches || !e.target.matches('[data-kb-search]')) return;
  const value = e.target.value;
  if (_debounce) clearTimeout(_debounce);
  _debounce = setTimeout(() => { _debounce = null; _filters.search = value; repaintResults(); }, 150);
}

function onSortChange(e) {
  if (!e.target.matches || !e.target.matches('[data-kb-sort]')) return;
  _filters.sort = e.target.value === 'title-asc' ? 'title-asc' : 'date-desc';
  repaintResults();
}

// -- view --------------------------------------------------------------------

export const views = {
  [VIEW_ID]: {
    init(deps) {
      _deps = deps;
      (async () => {
        try { _md = await import('/js/md-render.js'); } catch { _md = null; }
        try { _dsSelect = await import('/js/ds-select.js'); } catch { _dsSelect = null; }
      })();
    },

    async render(subPath, _opts) {
      const root = rootEl();
      if (!root) return;
      const actions = document.getElementById(ACTIONS_ID);
      unwire();
      if (actions) actions.innerHTML = '';
      wire(root, actions);
      if (!_md) { try { _md = await import('/js/md-render.js'); } catch { _md = null; } }
      if (!_dsSelect) { try { _dsSelect = await import('/js/ds-select.js'); } catch { _dsSelect = null; } }

      if (subPath) {
        await renderDetail(root, subPath);
        return;
      }
      if (_data === null) {
        root.innerHTML = '<div class="ds-skeleton kb-skel" data-skel="1" aria-hidden="true"></div>';
        try {
          _data = await loadList();
        } catch {
          _data = null;
          root.innerHTML = warnCallout('Could not load the document list. Try again in a moment.');
          return;
        }
      }
      renderListInto(root);
      if (_listScroll > 0) { const y = _listScroll; _listScroll = 0; window.scrollTo(0, y); }
    },
  },
};
