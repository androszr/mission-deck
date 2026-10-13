// demo/mocks/ch-design.mjs
// Painters for chapter `design`: the four pages of the core hub "Design"
// (js/assets-design-system.js, js/assets-icons.js + js/assets-svg-catalog.js,
// js/assets-illustrations.js, js/assets-mascot.js) in their real markup and classes.
// The data (token names, icon slugs, mascot poses) is the real committed set -
// css/ds-tokens.css, assets/icons/ds/manifest.json, assets/mascot/ - and the
// SVGs are served statically, so every <img> here points at a file that exists.
// Pure (props) => htmlString, no network, no listeners.

import { esc } from './common.mjs';

const ICON_BASE = '/assets/icons/ds/';
const MASCOT_BASE = '/assets/mascot/pip-';

/** The first entries of assets/icons/ds/manifest.json, in manifest order. */
const ICONS_FIRST = [
  '16-ic-add', '16-ic-attachment', '16-ic-chatbubbles', '16-ic-chevron-bottom', '16-ic-chevron-left',
  '16-ic-chevron-right', '16-ic-clock', '16-ic-context-menu-vertical', '16-ic-copy', '16-ic-cross',
  '16-ic-dashboard', '16-ic-download', '16-ic-drag-handle', '16-ic-edit', '16-ic-external-link',
  '16-ic-file', '16-ic-file-movie', '16-ic-files', '16-ic-folder', '16-ic-info',
  '24-ic-calendar', '24-ic-settings', '24-ic-user', '24-ic-reports',
];
const ICONS_TOTAL = 98;
/** Every icon whose slug contains "calendar", in manifest order. */
const ICONS_CALENDAR = ['24-ic-calendar', '24-ic-calendar-edit', '24-ic-calendar-text', '24-ic-calendar-tick', '24-ic-calendar-with-money'];

/** assets/mascot/manifest.json, in manifest order. */
const MASCOTS = ['idle', 'wave', 'thinking', 'working', 'success', 'error', 'sleeping', 'celebrating'];
const MASCOTS_TOTAL = MASCOTS.length;
const MASCOTS_HAPPY = ['success', 'celebrating'];

/** A sample of css/ds-tokens.css, grouped the way the page groups it. */
const TOKEN_SAMPLE = [
  ['Palette', 'palette', ['--ds-brand-25', '--ds-brand-35', '--ds-brand-50', '--ds-brand-90', '--ds-gray-15', '--ds-gray-95']],
  ['Semantic colours', 'semantic', ['--clickable-primary-default-bg', '--body-brand-text', '--state-success-bg', '--state-error-text']],
  ['Spacing', 'spacing', ['--space-4', '--space-8', '--space-16', '--space-24']],
  ['Radius', 'radius', ['--radius-s', '--radius-m', '--radius-l', '--radius-max']],
];
const TOKENS_TOTAL = 420;

function _header(title, subtitle) {
  return `<div class="page-header">
      <div class="page-header-row">
        <div>
          <h1>${esc(title)}</h1>
          <div class="subtitle">${esc(subtitle)}</div>
        </div>
      </div>
    </div>`;
}

/** The empty state the catalogs paint for a search with no hit (js/empty-state.js emptyHeroHtml). */
function _noResults(message) {
  return `<div class="empty-hero">
      <img src="${MASCOT_BASE}thinking.svg" alt="" aria-hidden="true" class="empty-mascot-img empty-mascot-img--hero">
      <div class="empty-hero-text">
        <div class="empty-hero-title">No results</div>
        <div class="empty-hero-msg">${esc(message)}</div>
      </div>
    </div>`;
}

// ── Design System (js/assets-design-system.js) ──────────────────────────

function _tokenRow(name, group, id) {
  let preview = '';
  if (group === 'palette' || group === 'semantic') preview = `<span class="ads-swatch" style="background: var(${name})"></span>`;
  else if (group === 'spacing') preview = `<span class="ads-space" style="width: min(var(${name}), 160px)"></span>`;
  else if (group === 'radius') preview = `<span class="ads-radius" style="border-radius: var(${name})"></span>`;
  return `<button type="button" class="ads-token"${id ? ` id="${esc(id)}"` : ''} title="Copy var(${esc(name)})">
    <span class="ads-token-preview">${preview}</span>
    <span class="ads-token-name">${esc(name)}</span>
    <span class="ads-token-value">var(${esc(name)})</span>
  </button>`;
}

function _tokensBody() {
  return TOKEN_SAMPLE.map(([label, group, names]) => `<section class="ads-group">
      <h2 class="ads-group-title">${esc(label)} <span class="ads-group-count">${names.length}</span></h2>
      <div class="ads-token-grid">${names.map((n) => _tokenRow(n, group, n === '--ds-brand-35' ? 'design-token-brand' : '')).join('')}</div>
    </section>`).join('');
}

function _componentsBody() {
  return `<div class="ads-comp-grid">
    <div class="ds-card ads-comp" id="design-comp-buttons">
      <div class="ds-card-header"><div class="ds-card-title">Buttons</div><code class="ads-comp-cls">.ds-btn</code></div>
      <div class="ds-card-body ads-comp-body">
        <span class="ds-btn ds-btn--primary">Primary</span>
        <span class="ds-btn ds-btn--secondary">Secondary</span>
        <span class="ds-btn ds-btn--tertiary">Tertiary</span>
      </div>
    </div>
    <div class="ds-card ads-comp">
      <div class="ds-card-header"><div class="ds-card-title">Badges</div><code class="ads-comp-cls">.ds-badge</code></div>
      <div class="ds-card-body ads-comp-body">
        <span class="ds-badge ds-badge--brand">Brand</span>
        <span class="ds-badge ds-badge--green">Done</span>
        <span class="ds-badge ds-badge--red">Blocked</span>
      </div>
    </div>
    <div class="ds-card ads-comp">
      <div class="ds-card-header"><div class="ds-card-title">Callouts</div><code class="ads-comp-cls">.ds-callout</code></div>
      <div class="ds-card-body ads-comp-body">
        <div class="ds-callout ds-callout--info">An informational note.</div>
        <div class="ds-callout ds-callout--success">Everything is in sync.</div>
      </div>
    </div>
  </div>`;
}

function _dsRoot(tab) {
  const seg = (id, label) => `<button type="button" class="ds-segment${tab === id ? ' active' : ''}" id="design-tab-${id}">${label}</button>`;
  return `<div class="asv-toolbar">
      <div class="ds-segmented" role="group" aria-label="Design System section">${seg('tokens', 'Tokens')}${seg('components', 'Components')}</div>
      <div class="ds-input-wrap asv-search-wrap"${tab === 'tokens' ? '' : ' hidden'}>
        <input type="search" class="ds-input" placeholder="Search tokens..." aria-label="Search tokens" autocomplete="off">
      </div>
      <span class="asv-count">${TOKENS_TOTAL} tokens in css/ds-tokens.css</span>
    </div>
    <div id="assets-design-system-body">${tab === 'components' ? _componentsBody() : _tokensBody()}</div>`;
}

// ── Icons / Illustrations (js/assets-svg-catalog.js) ────────────────────────

function _svgCard(label, src, variant, id) {
  return `<div class="asv-card ${variant}"${id ? ` id="${esc(id)}"` : ''}>
      <div class="asv-preview"><img src="${esc(src)}" alt="${esc(label)}" loading="lazy"></div>
      <div class="asv-name" title="${esc(label)}">${esc(label)}</div>
      <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm asv-copy-btn" aria-label="Copy SVG source: ${esc(label)}">Copy SVG</button>
    </div>`;
}

function _iconLabel(slug) {
  const [size, , ...rest] = slug.split('-');
  const base = rest.join(' ');
  return size + ' / ' + base.charAt(0).toUpperCase() + base.slice(1);
}

function _iconGrid(query) {
  if (query === 'kalender') return { html: _noResults('Nothing matches that search. Change or clear the search.'), shown: 0, empty: true };
  const list = query === 'calendar' ? ICONS_CALENDAR : ICONS_FIRST;
  const html = list.map((slug, i) => _svgCard(_iconLabel(slug), ICON_BASE + slug + '.svg', 'asv-card--icon',
    query === 'calendar' && i === 0 ? 'design-icon-calendar' : '')).join('');
  return { html, shown: query === 'calendar' ? ICONS_CALENDAR.length : ICONS_TOTAL, empty: false };
}

/** Toolbar + grid of the icon catalog; `query` drives both the field value and the grid. */
function _iconsBody(query = '') {
  const g = _iconGrid(query);
  return `<div class="asv-toolbar">
      <div class="ds-input-wrap asv-search-wrap">
        <input type="search" class="ds-input" id="assets-icons-search" placeholder="Search icons..." value="${esc(query)}" aria-label="Search icons" autocomplete="off">
      </div>
      <span class="asv-count" id="assets-icons-count" aria-live="polite">Showing <strong>${g.shown}</strong> of <strong>${ICONS_TOTAL}</strong> icons</span>
    </div>
    <div class="asv-grid${g.empty ? ' asv-grid--empty' : ''}" id="assets-icons-grid">${g.html}</div>`;
}

function _illustrationsBody() {
  return `<div class="asv-toolbar">
      <div class="ds-input-wrap asv-search-wrap">
        <input type="search" class="ds-input" id="assets-illustrations-search" placeholder="Search illustrations..." aria-label="Search illustrations" autocomplete="off">
      </div>
      <span class="asv-count" id="assets-illustrations-count" aria-live="polite">Showing <strong>${MASCOTS_TOTAL}</strong> of <strong>${MASCOTS_TOTAL}</strong> illustrations</span>
    </div>
    <div class="asv-grid" id="assets-illustrations-grid">${MASCOTS.map((n) => _svgCard('Pip, ' + n, MASCOT_BASE + n + '.svg', 'asv-card--ill', n === 'working' ? 'design-ill-working' : '')).join('')}</div>`;
}

// ── Mascot (js/assets-mascot.js) ─────────────────────────────────────────────

function _mascotCard(pose, id) {
  return `<div class="ds-card amas-card"${id ? ` id="${esc(id)}"` : ''}>
    <div class="ds-card-body amas-card-body">
      <div class="amas-thumb"><img src="${MASCOT_BASE}${esc(pose)}.svg" alt="Pip, ${esc(pose)}" loading="lazy" class="amas-img"></div>
      <div class="amas-name" title="pip-${esc(pose)}">${esc(pose)}</div>
      <code class="amas-usage">mascot: '${esc(pose)}'</code>
      <div class="amas-actions">
        <span class="ds-btn ds-btn--secondary ds-btn--sm">SVG</span>
      </div>
    </div>
  </div>`;
}

function _mascotBody(query = '') {
  const list = query ? MASCOTS_HAPPY : MASCOTS;
  return `<div class="asv-toolbar">
      <div class="ds-input-wrap asv-search-wrap">
        <input type="search" class="ds-input" id="assets-mascot-search" placeholder="Search poses..." value="${esc(query)}" aria-label="Search poses" autocomplete="off">
      </div>
      <span class="asv-count" id="assets-mascot-count" aria-live="polite">Showing <strong>${list.length}</strong> of <strong>${MASCOTS_TOTAL}</strong> poses</span>
    </div>
    <div class="amas-grid" id="assets-mascot-grid">${list.map((n) => _mascotCard(n, n === 'celebrating' ? 'design-mascot-focus' : '')).join('')}</div>`;
}

export const MOCKS = {
  /** The four "Design" sections, appended to main.main so the flyout click finds them. */
  'design-sections': () => `<div class="view-section" id="view-assets-design-system" data-back-view="dashboard">
      ${_header('Design System', 'The design tokens behind every screen (read live from css/ds-tokens.css) and the core components drawn with them.')}
      <div class="view-data" id="assets-design-system-root">${_dsRoot('tokens')}</div>
    </div>
    <div class="view-section" id="view-assets-icons" data-back-view="dashboard">
      ${_header('Icons', 'Every icon the app ships (Lucide, ISC licence) - preview, search and copy the SVG source.')}
      <div class="view-data" id="assets-icons-root">${_iconsBody('')}</div>
    </div>
    <div class="view-section" id="view-assets-illustrations" data-back-view="dashboard">
      ${_header('Illustrations', 'Illustrations for empty states, modals and onboarding - preview, search and copy the SVG source.')}
      <div class="view-data" id="assets-illustrations-root">${_illustrationsBody()}</div>
    </div>
    <div class="view-section" id="view-assets-mascot" data-back-view="dashboard">
      ${_header('Mascot', 'Pip, the Mission Deck mascot - every pose, animated, with the name an empty state uses and an SVG download.')}
      <div class="view-data" id="assets-mascot-root">${_mascotBody('')}</div>
    </div>`,

  /** The Design System page on one tab, `{ tab: 'tokens'|'components' }`. */
  'design-ds-root': ({ tab = 'tokens' } = {}) => _dsRoot(tab),
  /** Icon catalog for a query: '', 'kalender' (no hit) or 'calendar'. */
  'design-icons-root': ({ query = '' } = {}) => _iconsBody(query),
  /** The "Copy SVG" button after a click: the real one flips its own text, no toast. */
  'design-copy-done': () => 'Copied!',
  'design-mascot-root': ({ query = '' } = {}) => _mascotBody(query),
};

/** Every visible label these painters paint (copy gate). */
export const LABELS = [
  'Design System', 'Icons', 'Illustrations', 'Mascot', 'Tokens', 'Components',
  'Search tokens...', 'Search icons...', 'Search illustrations...', 'Search poses...',
  'Copy SVG', 'Copied!', 'No results',
  'The design tokens behind every screen (read live from css/ds-tokens.css) and the core components drawn with them.',
  'Pip, the Mission Deck mascot - every pose, animated, with the name an empty state uses and an SVG download.',
];
