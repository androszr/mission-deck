// ── Mission Deck — js/module-card.mjs ─────────────────────────────────
// Every section of a module's description, rendered from module.json alone.
// Shared by the two lists that describe the same thing: the installed table in
// Settings > Modules (js/settings-moduly.js) and the catalog table next to it
// (js/settings-moduly-katalog.js), plus the details modal each of them opens.
// modules-template/README.md states the invariant these functions exist to
// keep - nothing rendered here comes from anywhere but the manifest (or the
// curation file), so what a person reads cannot drift from the module it
// describes. The file kept its name through the move from cards to tables:
// renaming it would move every import for no behaviour.
//
// DOM-free on purpose, like js/academy-mural.mjs: the unit suite
// imports this file directly and checks both the shape and the escaping of
// every field, because a manifest is a file the module's AUTHOR writes and
// every string in it reaches innerHTML.
//
// The one thing here that is NOT from the manifest is renderStatusBadge():
// enabled/disabled is per-installation state from data/modules-registry.json.
// A manifest field for it would be a module declaring itself enabled while
// the registry says otherwise - two answers to one question.

import { escHtml, normalizeSearch } from './utils.js';
import { isCoreHub, coreHubLabel } from './core-hubs.mjs';

// ── Shape ─────────────────────────────────────────────────────────────────────
// The item-vs-hub rule the CARD promises and the rule the SIDEBAR builds have
// to be one rule, or a card promises a flyout that never appears. They used to
// be two copies of `kind === 'hub' && views.length > 1`, kept in sync by a
// comment; js/module-host.js now IMPORTS this predicate instead, so the two
// cannot drift. The view count is no longer part of it: the manifest's `kind`
// decides alone, because a hub that starts with one view (Support -> Time off)
// is a deliberate shape - the flyout is where the next views land.

export function isHubShape(manifest) {
  const m = manifest || {};
  const views = Array.isArray(m.views) ? m.views : [];
  return !!(m.sidebar && m.sidebar.kind === 'hub') && views.length >= 1;
}

/**
 * The CORE hub this module puts its pages into (`sidebar.kind: "page"`), or
 * null when it owns its rail entry. Returns the id only for a hub that really
 * exists: js/module-host.js gives a module naming an unknown hub no menu entry
 * at all, so the card must not promise one either.
 * @param {object} manifest
 * @returns {string|null}
 */
export function hubPageTarget(manifest) {
  const sidebar = (manifest && manifest.sidebar) || {};
  if (sidebar.kind !== 'page') return null;
  return isCoreHub(sidebar.hub) ? sidebar.hub : null;
}

/**
 * Icon URL for a manifest. `module:<file>` resolves inside the module's own
 * client/ directory, which only exists once the module is ON DISK - so the
 * catalog card passes no moduleId and falls back to the DS default instead of
 * linking a 404.
 * @param {object} manifest
 * @param {string|null} moduleId id of the installed directory, or null
 * @returns {string}
 */
export function moduleIconPath(manifest, moduleId) {
  const icon = manifest && manifest.icon;
  const DS = '/assets/icons/ds/';
  if (typeof icon !== 'string' || !icon) return DS + '24-ic-folder.svg';
  if (icon.startsWith('module:')) {
    if (!moduleId) return DS + '24-ic-folder.svg';
    return '/modules/' + moduleId + '/client/' + icon.slice('module:'.length);
  }
  return DS + icon + '.svg';
}

export function renderShapeBadge(manifest) {
  const m = manifest || {};
  const hub = hubPageTarget(m);
  if (m.sidebar && m.sidebar.kind === 'page' && !hub) {
    return '<span class="ds-badge ds-badge--red">No menu entry</span>';
  }
  const ownLabel = [m.sidebar?.label, m.name, m.id]
    .find(value => typeof value === 'string' && value.trim());
  const label = hub ? coreHubLabel(hub) : ownLabel;
  if (!m.sidebar || !['page', 'hub', 'item'].includes(m.sidebar.kind)
      || !Array.isArray(m.views) || !label) {
    return '<span class="ds-badge ds-badge--gray">No menu data</span>';
  }
  return `<span class="ds-badge ds-badge--gray">${escHtml(label)} (${Number(m.views.length)})</span>`;
}

export function moduleArea(manifest, extra = {}) {
  const curated = typeof extra.area === 'string' ? extra.area.trim().replace(/ {2,}/g, ' ') : '';
  const area = typeof manifest?.area === 'string' ? manifest.area.trim().replace(/ {2,}/g, ' ') : '';
  return curated || area;
}

export function areaFilterKey(area) {
  return normalizeSearch(typeof area === 'string' ? area : '').trim().replace(/ {2,}/g, ' ');
}

export function renderAreaBadge(area) {
  const label = moduleArea({ area });
  return label
    ? `<span class="ds-badge ds-badge--blue">${escHtml(label)}</span>`
    : '<span class="ds-badge ds-badge--yellow">Area not set</span>';
}

export const MODULE_AREA_SUGGESTIONS = ['Product', 'Engineering', 'Operations'];

export function areaInputError(value) {
  // Mirror validateModuleArea: inspect raw controls BEFORE normalization.
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) {
    return 'The area must not contain control characters.';
  }
  const normalized = value.trim().replace(/ {2,}/g, ' ');
  if (!normalized) return 'Enter the business area of the module.';
  if (normalized.length < 2 || normalized.length > 40
      || !/^[\p{L}\p{N} .&+/-]+$/u.test(normalized)) {
    return 'The area must have 2 to 40 characters: letters, digits, spaces or - . & + /.';
  }
  return '';
}

export function areaSuggestions(values = []) {
  return [...new Set([...MODULE_AREA_SUGGESTIONS, ...(Array.isArray(values) ? values : [])]
    .filter(value => !areaInputError(value))
    .map(value => value.trim().replace(/ {2,}/g, ' ')))]
    .sort((a, b) => a.localeCompare(b, 'en'));
}

export function renderStatusBadge(enabled) {
  return enabled
    ? '<span class="ds-badge ds-badge--green">Enabled</span>'
    : '<span class="ds-badge ds-badge--gray">Disabled</span>';
}

// Maturity (stable / beta / deprecated) - module.json `status`, which the
// publish modal writes and catalog.json may override. One renderer for both
// cards, so an installed module and its catalog entry wear the same badge.
// Mirrors MODULE_STATUSES in server.js; an unknown or missing value draws
// nothing, because a badge that guesses "stable" for a module nobody rated
// would be a claim the manifest never made.
const MATURITY_BADGE = {
  stable: '<span class="ds-badge ds-badge--green">stable</span>',
  beta: '<span class="ds-badge ds-badge--yellow">beta</span>',
  deprecated: '<span class="ds-badge ds-badge--gray">deprecated</span>',
};

export function renderMaturityBadge(status) {
  return MATURITY_BADGE[status] || '';
}

// ── Self-description ──────────────────────────────────────────────────────────

// Tags come from module.json; for a catalog module catalog.json may override
// them (mergeModulesCatalog in server.js), which is why the caller passes the
// list rather than the manifest.
export function renderTagBadges(tags) {
  const list = Array.isArray(tags) ? tags.filter(t => typeof t === 'string' && t) : [];
  if (!list.length) return '';
  return `<div class="moduly-badge-row">${
    list.map(t => `<span class="ds-badge ds-badge--gray">${escHtml(t)}</span>`).join('')
  }</div>`;
}

// sidebar.label is what a person will actually read in the rail
// (js/module-host.js). It is usually the module name, and saying it twice
// would be noise - so the card mentions it only when it differs.
export function renderMenuLabel(manifest) {
  const m = manifest || {};
  const label = m.sidebar && typeof m.sidebar.label === 'string' ? m.sidebar.label : '';
  if (!label || label === m.name) return '';
  return `<span class="moduly-card-menu-label">W menu: ${escHtml(label)}</span>`;
}

// ── Origin ────────────────────────────────────────────────────────────────────
// origin comes from data/modules-origin.json (GET /api/modules/installed
// origin field), never from the manifest - a fresh install/import/publish
// writes it, an older copy has none. Shared by the card meta row and the
// publish modal, same "one renderer, two callers" pattern as the rest of
// this file.

const ORIGIN_SOURCE_LABEL = {
  catalog: 'From the catalog',
  zip: 'From a zip file',
  publish: 'Published',
};

/**
 * @param {{source: 'catalog'|'zip'|'publish', version: string, at: string}|null} origin
 * @returns {string} '' when there is no record or the source is unknown
 */
export function renderOriginLine(origin) {
  if (!origin || typeof origin !== 'object') return '';
  const label = ORIGIN_SOURCE_LABEL[origin.source];
  if (!label) return '';
  const version = typeof origin.version === 'string' && origin.version ? origin.version : '?';
  const date = formatGitDate(origin.at);
  const text = date ? `${label}: ${version}, ${date}` : `${label}: ${version}`;
  return `<span class="moduly-card-origin">${escHtml(text)}</span>`;
}

// ── Badge helpers ─────────────────────────────────────────────────────────────

function _badge(tone, iconClass, text, title) {
  const titleAttr = title ? ` title="${escHtml(title)}"` : '';
  const ico = iconClass
    ? `<span class="moduly-badge-ico moduly-badge-ico--${iconClass}" aria-hidden="true"></span>`
    : '';
  return `<span class="ds-badge ds-badge--${tone} moduly-badge"${titleAttr}>${ico}${escHtml(text)}</span>`;
}

// A declaration entry is a bare name, or an object carrying at least `name`.
// Both forms are validated server-side (validateModuleManifest).
function _declEntries(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    if (typeof entry === 'string') return { name: entry, description: '', paths: [], access: 'write' };
    if (!entry || typeof entry !== 'object') return null;
    const name = typeof entry.name === 'string' && entry.name ? entry.name : '';
    if (!name) return null;
    return {
      name,
      description: typeof entry.description === 'string' ? entry.description : '',
      paths: Array.isArray(entry.paths) ? entry.paths.filter(p => typeof p === 'string' && p) : [],
      access: entry.access === 'read' ? 'read' : 'write',
    };
  }).filter(Boolean);
}

// The compact form: the NAME is the badge, the prose is the hover tip. A repo
// description runs to a full sentence ("Team data - read and write of
// the demo-hub/ folder"), so a row of them pushed the actions off the card;
// what a reviewer scans for is which repo and which keys, not the sentence.
function _declBadge(tone, iconClass, entry, fallbackTip) {
  const tipParts = [];
  if (entry.description) tipParts.push(entry.description);
  if (entry.paths.length) tipParts.push('Paths: ' + entry.paths.join(', '));
  const baseTip = tipParts.length ? tipParts.join(' · ') : fallbackTip;
  const isRead = entry.access === 'read';
  const tip = isRead ? 'Read only · ' + baseTip : baseTip;
  return _badge(tone, iconClass, isRead ? entry.name + ' (read)' : entry.name, tip);
}

// ── Declarations: data repos and env keys ─────────────────────────────────────
// Still a DECLARATION, never a permission: the core neither mounts these nor
// enforces them, so the list says what the module CLAIMS to touch - which is
// exactly what somebody deciding whether to enable it wants to see.

export function renderDeclarationBlock(manifest) {
  const m = manifest || {};
  const repos = _declEntries(m.dataRepos);
  const keys = _declEntries(m.envKeys);
  if (!repos.length && !keys.length) return '';
  const badges = [
    ...repos.map(r => _declBadge('sky', 'repo', r, 'Team data repository.')),
    ...keys.map(k => _declBadge('amber', 'key', k, 'An environment key the module expects.')),
  ].join('');
  return `
    <div class="moduly-card-decl">
      <p class="moduly-card-decl-hint">Module declarations (a declaration, not a permission):</p>
      <div class="moduly-badge-row">${badges}</div>
    </div>`;
}

// ── Capabilities ──────────────────────────────────────────────────────────────
// What the module SHIPS, read off client/server entries. The catalog already
// warns at install time that a module runs its author's code with full rights
// in the server process; the card is where that is visible BEFORE the click.

// Text-only on purpose: the DS icon set has a clear folder and a clear
// padlock (used above for the two declaration classes) but nothing that reads
// unambiguously as "browser", "stylesheet" or "server process", and a badge
// with a puzzling glyph is worse than a badge with a word.
export function renderCapabilityBadges(manifest, moduleId) {
  const m = manifest || {};
  const id = moduleId || (typeof m.id === 'string' ? m.id : '');
  const client = m.client && typeof m.client === 'object' ? m.client : {};
  const server = m.server && typeof m.server === 'object' ? m.server : {};
  const out = [];
  if (typeof client.entry === 'string' && client.entry) {
    out.push(_badge('transparent', '', 'Frontend', 'Browser code: ' + client.entry));
  }
  if (typeof client.style === 'string' && client.style) {
    out.push(_badge('transparent', '', 'Style', 'Own stylesheet: ' + client.style));
  }
  if (typeof server.entry === 'string' && server.entry) {
    const route = id ? ' · trasy pod /api/m/' + id + '/' : '';
    out.push(_badge('transparent', '', 'Backend', 'Server process code: ' + server.entry + route));
  }
  return out.join('');
}

// ── Views ─────────────────────────────────────────────────────────────────────
// views[].label is the flyout entry, views[].title the page h1 and
// views[].subtitle the line under it (js/module-host.js). All three were in
// the manifest and only the first reached the card, so a hub whose pages are
// titled differently from its menu entries could not be read off the card.

export function renderViewsBlock(manifest) {
  const m = manifest || {};
  const views = Array.isArray(m.views) ? m.views : [];
  if (!views.length) return '';
  const items = views.map((v) => {
    const view = v && typeof v === 'object' ? v : {};
    const label = (typeof view.label === 'string' && view.label) || (typeof view.id === 'string' ? view.id : '');
    const title = typeof view.title === 'string' ? view.title : '';
    const subtitle = typeof view.subtitle === 'string' ? view.subtitle : '';
    // Three separate elements, never one joined string: the menu label and the
    // page title are two different names for one page, and rendered as two
    // adjacent inline spans they read as one word ("NoteTest note").
    const heading = title && title !== label ? title : '';
    return `<li class="moduly-view-item">
        <span class="moduly-view-head">
          <span class="moduly-view-label">${escHtml(label)}</span>
          ${heading ? `<span class="moduly-view-title">${escHtml(heading)}</span>` : ''}
        </span>
        ${subtitle ? `<span class="moduly-view-meta" title="${escHtml(subtitle)}">${escHtml(subtitle)}</span>` : ''}
      </li>`;
  }).join('');
  return `
    <div class="moduly-card-views">
      <p class="moduly-card-views-label">Views (${views.length}):</p>
      <ul class="moduly-view-list">${items}</ul>
    </div>`;
}

// ── Search ────────────────────────────────────────────────────────────────────
// The haystack behind the search box above each card grid. Built from the
// same manifest the card is rendered from, so a person can find a module by
// anything the card shows: name, id, description, author, tags and the view
// labels. `extra` carries the fields that live outside the manifest - the
// catalog's curated summary, tags and author. Diacritic- and case-insensitive
// through normalizeSearch(), the same rule the Users search follows.

export function moduleSearchText(manifest, extra = {}) {
  const m = manifest || {};
  const views = Array.isArray(m.views) ? m.views : [];
  const parts = [
    m.name, m.id, extra.id, m.description, extra.summary, m.author, extra.author,
    moduleArea(m, extra),
    ...(Array.isArray(m.tags) ? m.tags : []),
    ...(Array.isArray(extra.tags) ? extra.tags : []),
    ...views.map(v => (v && (v.label || v.title)) || ''),
  ];
  return normalizeSearch(parts.filter(Boolean).join(' ')).replace(/\s+/g, ' ').trim();
}

/** True when every whitespace-separated word of `query` occurs in `haystack`. */
export function matchesSearch(haystack, query) {
  const q = normalizeSearch(query).trim();
  if (!q) return true;
  const hay = String(haystack || '');
  return q.split(/\s+/).every(part => hay.includes(part));
}

// ── Local module repository (scripts/_module-git.js) ─────────────────────────
// A card is a snapshot of GET /api/modules/installed, never a second reader
// of the repository - if the answer is wrong the fix is server-side.

/**
 * English plural of "change", number-inclusive so a caller never glues the
 * count onto the word twice: "1 change", "2 changes", "0 changes".
 * @param {number} n
 * @returns {string}
 */
export function pluralZmiany(n) {
  const num = Number(n) || 0;
  return `${num} ${num === 1 ? 'change' : 'changes'}`;
}

/**
 * `<lastCommit.date>` (git `%aI`, full ISO with offset) formatted DD.MM.YYYY
 * in the viewer's local time.
 * @param {string} iso
 * @returns {string} empty string when `iso` does not parse
 */
export function formatGitDate(iso) {
  if (typeof iso !== 'string' || !iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

/**
 * The same date with the local time appended, `DD.MM.YYYY HH:MM` - several
 * versions saved on one day are told apart by the clock, not by the date.
 * The "last save" line and the "History" list both use this one, so the
 * two can never show the same commit in two forms.
 * @param {string} iso
 * @returns {string} empty string when `iso` does not parse
 */
export function formatGitDateTime(iso) {
  const date = formatGitDate(iso);
  if (!date) return '';
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${date} ${hh}:${mi}`;
}

/**
 * The git row under `.moduly-card-meta`: branch, dirty state and the button
 * that moves it forward. `id` is the third thing every state needs (the
 * button's `data-moduly-git-init`/`data-moduly-git-commit`), so the signature
 * is `(id, git, gitAvailable)` even though the plan's file list shorthanded
 * it as `renderGitRow(git, gitAvailable)`.
 * @param {string} id module id
 * @param {object} git one of the three shapes GET /api/modules/installed sends
 * @param {boolean} gitAvailable top-level flag from the same payload
 * @returns {string}
 */
export function renderGitRow(id, git, gitAvailable) {
  // A server older than this client, or a payload still in flight, may carry
  // no gitAvailable at all - treat anything but `true` as "not available"
  // rather than falling through to a badge/button built from a shape (1)
  // `{ present }`-only object.
  // Two rows of FIXED geometry in every state - a 32px action row (the height
  // of ds-btn--sm, so a badge-only row is as tall as a button row) over one
  // ellipsized text line. The first version let a long "last save" span
  // wrap under the badges, so initializing a repo grew the card by a line and
  // the whole grid below it jumped.
  // The text always sits in its own span (never a bare text node): the last
  // line is a flex row so the "History" toggle can share it, and a text node
  // in a flex container cannot be ellipsized. `historyHtml` (toggle plus the
  // hidden list container) is present only in the one state that has commits
  // to list; it adds no height until a person opens it.
  const block = (rowHtml, lastText, historyHtml = { toggle: '', list: '' }) => `<div class="moduly-card-git">
      <div class="moduly-card-git-row">${rowHtml}</div>
      <div class="moduly-card-git-last"><span class="moduly-card-git-last-text" title="${escHtml(lastText)}">${escHtml(lastText)}</span>${historyHtml.toggle}</div>${historyHtml.list}
    </div>`;

  if (gitAvailable !== true) {
    return block('<span class="ds-badge ds-badge--gray">Git unavailable</span>',
      'Install Git to version the module locally');
  }

  const g = git && typeof git === 'object' ? git : { present: false };

  if (!g.present) {
    return block(`<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-moduly-git-init="${escHtml(id)}">Initialize repository</button>`,
      'The module has no local version history yet');
  }

  if (g.error) {
    return block(`<span class="ds-badge ds-badge--red" title="${escHtml(g.error)}">Repository read error</span>`,
      String(g.error));
  }

  const branch = typeof g.branch === 'string' && g.branch ? g.branch : 'main';
  const dirty = !!g.dirty;
  const statusText = dirty ? pluralZmiany(g.changedFiles) : 'no changes';

  // An unborn branch (fresh `git init`, no commits yet) carries
  // `lastCommit:null` and `dirty:true` at the same time - never a date.
  const lastCommit = g.lastCommit && typeof g.lastCommit === 'object' ? g.lastCommit : null;
  const commitDate = lastCommit ? formatGitDateTime(lastCommit.date) : '';
  const subject = lastCommit && typeof lastCommit.subject === 'string' ? lastCommit.subject : '';
  const lastText = commitDate ? `last save ${commitDate} · ${subject}` : 'no saved versions';

  const commitBtn = dirty
    ? `<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-moduly-git-commit="${escHtml(id)}">Save version</button>`
    : '';

  // "History" expands the EARLIER commits under the last-commit line, in the
  // same "DD.MM.RRRR HH:MM - subject" form. The list is fetched on the first click
  // (GET /api/modules/git-log), never with the card, and the toggle carries
  // the sha7 the line above already shows so the list can leave that one out.
  const sha7 = lastCommit && typeof lastCommit.sha7 === 'string' ? lastCommit.sha7 : '';
  const history = commitDate
    ? {
      toggle: `<button type="button" class="moduly-card-git-history-toggle ds-link" data-moduly-git-log="${escHtml(id)}" data-moduly-git-last-sha="${escHtml(sha7)}" aria-expanded="false">History</button>`,
      list: `<div class="moduly-card-git-history" data-moduly-git-history="${escHtml(id)}" hidden></div>`,
    }
    : undefined;

  return block(`<span class="ds-badge ds-badge--gray">${escHtml(branch)}</span>
      <span>${escHtml(statusText)}</span>
      ${commitBtn}`, lastText, history);
}

/**
 * Inner HTML of the "History" container: the earlier commits of a module,
 * newest first, one line each in the same form as the "last save" line
 * (`DD.MM.RRRR HH:MM - subject`, dot-separated). The commit whose sha7 equals `skipSha7` - the one
 * the line above already shows - is left out, so the list really is "what
 * came BEFORE". An entry without a parsable date still lists its subject.
 * @param {Array<{sha7?: string, date?: string, subject?: string}>} commits from GET /api/modules/git-log
 * @param {{skipSha7?: string}} [opts]
 * @returns {string}
 */
export function renderGitHistory(commits, opts = {}) {
  const list = Array.isArray(commits) ? commits.filter((c) => c && typeof c === 'object') : [];
  const skip = typeof opts.skipSha7 === 'string' && opts.skipSha7 ? opts.skipSha7 : null;
  const earlier = list.filter((c) => !(skip && c.sha7 === skip));
  if (earlier.length === 0) {
    return '<div class="moduly-card-git-history-empty">No earlier versions</div>';
  }
  const items = earlier.map((c) => {
    const date = formatGitDateTime(c.date);
    const subject = typeof c.subject === 'string' ? c.subject : '';
    const text = date ? `${date} · ${subject}` : subject;
    return `<li title="${escHtml(text)}">${escHtml(text)}</li>`;
  }).join('');
  return `<ul class="moduly-card-git-history-list">${items}</ul>`;
}

/**
 * Inner HTML of the "History" container when the log could not be read:
 * one user-facing sentence, the server's message in the tip.
 * @param {string} message
 * @returns {string}
 */
export function renderGitHistoryError(message) {
  const msg = typeof message === 'string' && message ? message : 'Unknown error';
  return `<div class="moduly-card-git-history-empty" title="${escHtml(msg)}">Could not load the history</div>`;
}

// ── Table row and details modal ──────────────────────────────────────────────
// The two lists (Settings > Modules: "Installed" and "Catalog") are
// TABLES, not card grids - with dozens of modules a grid of tall boxes stops
// being scannable and the eye has nothing to run down. A row carries only what
// a person scans and acts on; everything else - description, author, origin,
// capabilities, tags, views, declarations and the local git repository - moves
// into one details modal.
//
// Same rule as the cards it replaces: ONE renderer for both lists, so an
// installed module and its catalog entry cannot describe themselves
// differently. Every block below is composed from the functions above rather
// than re-implemented, which is why the escaping test over this file still
// covers the modal.

/**
 * The first cell of a row: the icon tile, the module name and its id.
 * @param {object} manifest
 * @param {{id?: string, iconModuleId?: string|null}} [opts] `iconModuleId` is
 *   the installed directory a `module:<file>` icon lives in - null for a
 *   catalog entry, which is not on disk yet.
 * @returns {string}
 */
export function renderModuleNameCell(manifest, opts = {}) {
  const m = manifest || {};
  const id = opts.id || (typeof m.id === 'string' ? m.id : '');
  const iconModuleId = opts.iconModuleId === undefined ? null : opts.iconModuleId;
  return `<span class="moduly-row-name">
      <span class="moduly-row-icon" aria-hidden="true"><img src="${escHtml(moduleIconPath(m, iconModuleId))}" alt=""></span>
      <span class="moduly-row-name-text">
        <strong class="moduly-row-title" title="${escHtml(m.name || id)}">${escHtml(m.name || id)}</strong>
        <code class="moduly-card-id">${escHtml(m.id || id)}</code>
      </span>
    </span>`;
}

/**
 * The "Details" action, one per row. A dedicated button rather than a
 * clickable row: the row already carries four icon buttons of its own, and a
 * row that is itself a control fights every one of them.
 * @param {string} id module id, carried on the button
 * @param {string} attr the data attribute name (`moduly-details` /
 *   `katalog-details`), so the two lists keep their own delegation
 * @returns {string}
 */
export function renderDetailsButton(id, attr) {
  return `<button type="button" class="ds-icon-btn ds-icon-btn--sm" data-tip="Details" aria-label="Details" data-${escHtml(attr)}="${escHtml(id)}"><span class="moduly-action-ico moduly-action-ico--info" aria-hidden="true"></span></button>`;
}

/**
 * Body of the details modal - everything a row deliberately leaves out.
 * `description`, `author` and `tags` are passed in rather than read off the
 * manifest, because a catalog entry may curate all three (catalog.json wins
 * over module.json, mergeModulesCatalog in server.js).
 *
 * The git block is present only when the caller passes `git` - the catalog
 * describes a module that is not on this disk, so it has no repository to
 * describe. Its buttons keep the same data attributes the card used, so the
 * delegation in js/settings-moduly.js works unchanged once it is bound to the
 * modal as well.
 *
 * @param {object} manifest
 * @param {object} [opts]
 * @returns {string}
 */
export function renderModuleDetailsBody(manifest, opts = {}) {
  const m = manifest || {};
  const id = opts.id || (typeof m.id === 'string' ? m.id : '');
  const description = typeof opts.description === 'string' && opts.description
    ? opts.description
    : (typeof m.description === 'string' ? m.description : '');
  const author = typeof opts.author === 'string' && opts.author
    ? opts.author
    : (typeof m.author === 'string' ? m.author : '');
  const tags = Array.isArray(opts.tags) ? opts.tags : (Array.isArray(m.tags) ? m.tags : []);
  const iconModuleId = opts.iconModuleId === undefined ? null : opts.iconModuleId;

  const meta = [
    `<span class="moduly-card-version">Version ${escHtml(m.version || '?')}</span>`,
    `<span>Area: ${renderAreaBadge(moduleArea(m, opts))}</span>`,
    author ? `<span class="moduly-card-author">Author: ${escHtml(author)}</span>` : '',
    renderMenuLabel(m),
    renderOriginLine(opts.origin || null),
  ].filter(Boolean).join('');

  const badges = [
    renderShapeBadge(m),
    renderCapabilityBadges(m, id),
  ].filter(Boolean).join('');

  const git = opts.git !== undefined
    ? renderGitRow(id, opts.git, opts.gitAvailable === true)
    : '';

  return `
    <div class="moduly-detail">
      <div class="moduly-detail-head">
        <span class="moduly-row-icon" aria-hidden="true"><img src="${escHtml(moduleIconPath(m, iconModuleId))}" alt=""></span>
        <div class="moduly-row-name-text">
          <strong class="moduly-row-title">${escHtml(m.name || id)}</strong>
          <code class="moduly-card-id">${escHtml(m.id || id)}</code>
        </div>
      </div>
      ${description ? `<p class="moduly-detail-desc">${escHtml(description)}</p>` : ''}
      <div class="moduly-card-meta">${meta}</div>
      ${badges ? `<div class="moduly-badge-row">${badges}</div>` : ''}
      ${renderTagBadges(tags)}
      ${git}
      ${renderViewsBlock(m)}
      ${renderDeclarationBlock(m)}
    </div>`;
}
