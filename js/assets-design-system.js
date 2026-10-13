// ── Mission Deck — js/assets-design-system.js ─────────────────────────
// Design > Design System: the design tokens behind every screen and the core
// components drawn with them.
//
// Tokens are not copied into a catalog file: the view fetches the stylesheet
// the app itself loads, css/ds-tokens.css, and lists every custom property of
// its :root block, so the page can never drift from what the app paints.
// Swatches are painted with `var(--token)` rather than the parsed value, so
// they follow the active theme (css/ds-tokens-dark.css) like everything else.
//
// The Components tab is static markup over the DS classes in css/ds.css -
// buttons, badges, callouts, inputs, chips, progress - so a change to those
// classes shows up here first.

import { escHtml, normalizeSearch } from './utils.js';
import { emptyHeroHtml } from './empty-state.js';
import { registerViewCleanup } from './view-lifecycle.js';

const VIEW_ID = 'assets-design-system';
const ROOT_ID = 'assets-design-system-root';
const TOKENS_URL = '/css/ds-tokens.css';

/** Group id -> heading, in display order. */
export const TOKEN_GROUPS = Object.freeze([
  ['palette', 'Palette'],
  ['semantic', 'Semantic colours'],
  ['typography', 'Typography'],
  ['spacing', 'Spacing'],
  ['radius', 'Radius'],
  ['shadow', 'Shadows'],
  ['other', 'Aliases and other'],
]);

// ── Pure helpers (exported for tests) ────────────────────────────────────────

/**
 * Every custom property declared in the FIRST :root block of a stylesheet.
 * Comments are stripped first, so a commented-out token is not listed.
 *
 * @param {string} css
 * @returns {Array<{name: string, value: string}>}
 */
export function parseTokenCss(css) {
  const text = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
  const start = text.indexOf(':root');
  if (start < 0) return [];
  const open = text.indexOf('{', start);
  if (open < 0) return [];
  let depth = 0;
  let end = -1;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = text.slice(open + 1, end < 0 ? text.length : end);
  const out = [];
  const re = /(--[A-Za-z0-9_-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(body)) !== null) out.push({ name: m[1], value: m[2].trim() });
  return out;
}

/**
 * Which display group a token belongs to.
 * @param {string} name e.g. '--ds-brand-35'
 * @returns {string} one of the TOKEN_GROUPS ids
 */
export function tokenGroup(name) {
  if (/^--ds-[a-z]+-\d+$/.test(name)) return 'palette';
  if (/^--(body|clickable|state|table|form|legend|transparents)-/.test(name)) return 'semantic';
  if (/^--(font|text|lh|fw|weight|letter)-?/.test(name)) return 'typography';
  if (/^--space-/.test(name)) return 'spacing';
  if (/^--radius-/.test(name)) return 'radius';
  if (/^--shadow-/.test(name)) return 'shadow';
  return 'other';
}

/** @param {string} value @returns {boolean} the value paints as a colour */
export function isColorValue(value) {
  return /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|transparent$)/i.test(String(value).trim());
}

// ── State ─────────────────────────────────────────────────────────────────────

/** @type {Array<{name: string, value: string}>|null} null until the fetch settles */
let _tokens = null;
let _tab = 'tokens'; // 'tokens' | 'components'
let _query = '';

async function _fetchTokens() {
  try {
    const res = await fetch(`${TOKENS_URL}?t=${Date.now()}`);
    _tokens = res.ok ? parseTokenCss(await res.text()) : [];
  } catch {
    _tokens = [];
  }
}

// ── Painting: tokens ─────────────────────────────────────────────────────────

function _resolvesToColor(tok, byName) {
  let v = tok.value;
  for (let i = 0; i < 6; i++) {
    const ref = /^var\((--[A-Za-z0-9_-]+)\)$/.exec(v);
    if (!ref) break;
    const next = byName.get(ref[1]);
    if (!next) break;
    v = next;
  }
  return isColorValue(v);
}

function _tokenRowHtml(tok, group, byName) {
  const name = escHtml(tok.name);
  let preview = '';
  if (group === 'palette' || ((group === 'semantic' || group === 'other') && _resolvesToColor(tok, byName))) {
    preview = `<span class="ads-swatch" style="background: var(${name})" aria-hidden="true"></span>`;
  } else if (group === 'spacing') {
    preview = `<span class="ads-space" style="width: min(var(${name}), 160px)" aria-hidden="true"></span>`;
  } else if (group === 'radius') {
    preview = `<span class="ads-radius" style="border-radius: var(${name})" aria-hidden="true"></span>`;
  } else if (group === 'shadow') {
    preview = `<span class="ads-shadow" style="box-shadow: var(${name})" aria-hidden="true"></span>`;
  } else if (group === 'typography' && /^--text-/.test(tok.name)) {
    preview = `<span class="ads-type" style="font-size: var(${name})" aria-hidden="true">Aa</span>`;
  }
  return `<button type="button" class="ads-token" data-ads-copy="var(${name})" title="Copy var(${name})">
    <span class="ads-token-preview">${preview}</span>
    <span class="ads-token-name">${name}</span>
    <span class="ads-token-value">${escHtml(tok.value)}</span>
  </button>`;
}

function _tokensHtml() {
  const q = normalizeSearch(_query.trim());
  const byName = new Map((_tokens || []).map(t => [t.name, t.value]));
  const visible = (_tokens || []).filter(t => !q || normalizeSearch(`${t.name} ${t.value}`).includes(q));
  if (!visible.length) {
    return emptyHeroHtml({
      title: 'No results',
      message: 'No token matches that search. Change or clear the search.',
      mascot: 'thinking',
    });
  }
  const byGroup = new Map();
  for (const t of visible) {
    const g = tokenGroup(t.name);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(t);
  }
  return TOKEN_GROUPS.filter(([id]) => byGroup.has(id)).map(([id, label]) => `
    <section class="ads-group">
      <h2 class="ads-group-title">${escHtml(label)} <span class="ads-group-count">${byGroup.get(id).length}</span></h2>
      <div class="ads-token-grid">${byGroup.get(id).map(t => _tokenRowHtml(t, id, byName)).join('')}</div>
    </section>`).join('');
}

// ── Painting: components ─────────────────────────────────────────────────────

function _componentsHtml() {
  const card = (title, cls, body) => `
    <div class="ds-card ads-comp">
      <div class="ds-card-header"><div class="ds-card-title">${title}</div><code class="ads-comp-cls">${cls}</code></div>
      <div class="ds-card-body ads-comp-body">${body}</div>
    </div>`;
  return `<div class="ads-comp-grid">
    ${card('Buttons', '.ds-btn', `
      <button type="button" class="ds-btn ds-btn--primary">Primary</button>
      <button type="button" class="ds-btn ds-btn--secondary">Secondary</button>
      <button type="button" class="ds-btn ds-btn--tertiary">Tertiary</button>
      <button type="button" class="ds-btn ds-btn--danger">Danger</button>
      <button type="button" class="ds-btn ds-btn--primary ds-btn--sm">Small</button>
      <button type="button" class="ds-btn ds-btn--primary" disabled>Disabled</button>`)}
    ${card('Badges', '.ds-badge', `
      <span class="ds-badge ds-badge--brand">Brand</span>
      <span class="ds-badge ds-badge--green">Done</span>
      <span class="ds-badge ds-badge--yellow">Waiting</span>
      <span class="ds-badge ds-badge--red">Blocked</span>
      <span class="ds-badge ds-badge--blue">Info</span>
      <span class="ds-badge ds-badge--gray">Draft</span>`)}
    ${card('Callouts', '.ds-callout', `
      <div class="ds-callout ds-callout--info">An informational note.</div>
      <div class="ds-callout ds-callout--success">Everything is in sync.</div>
      <div class="ds-callout ds-callout--warning">Two files wait to be sent.</div>
      <div class="ds-callout ds-callout--danger">The pull stopped on a conflict.</div>`)}
    ${card('Inputs', '.ds-input', `
      <label class="ds-label" for="ads-demo-input">Label</label>
      <div class="ds-input-wrap"><input id="ads-demo-input" class="ds-input" placeholder="Placeholder"></div>
      <div class="ds-input-wrap"><input class="ds-input ds-input--error" value="Invalid value" aria-label="Invalid example"></div>
      <div class="ds-hint ds-hint--error">This field needs a value.</div>`)}
    ${card('Chips', '.ds-chip', `
      <span class="ds-chip">Neutral</span>
      <span class="ds-chip ds-chip--success">Success</span>
      <span class="ds-chip ds-chip--warning">Warning</span>`)}
    ${card('Progress', '.ds-progress', `
      <div class="ds-progress"><div class="ds-progress-track"><div class="ds-progress-fill ds-progress-fill--brand" style="width: 64%"></div></div></div>
      <div class="ds-progress"><div class="ds-progress-track"><div class="ds-progress-fill ds-progress-fill--green" style="width: 100%"></div></div></div>`)}
  </div>`;
}

// ── Painting: frame ──────────────────────────────────────────────────────────

function _paintBody() {
  const body = document.getElementById('assets-design-system-body');
  if (!body) return;
  body.innerHTML = _tab === 'tokens' ? _tokensHtml() : _componentsHtml();
  const search = document.getElementById('assets-design-system-search-wrap');
  if (search) search.hidden = _tab !== 'tokens';
}

function _paint() {
  const root = document.getElementById(ROOT_ID);
  if (!root) return;

  if (!_tokens || !_tokens.length) {
    root.innerHTML = emptyHeroHtml({
      title: 'No design tokens',
      message: 'Could not read css/ds-tokens.css. The file ships with the repository - check that the checkout is complete.',
      mascot: 'error',
    });
    return;
  }

  const seg = (id, label) => `<button type="button" class="ds-segment${_tab === id ? ' active' : ''}" data-ads-tab="${id}" aria-pressed="${_tab === id}">${label}</button>`;
  root.innerHTML = `<div class="asv-toolbar">
      <div class="ds-segmented" role="group" aria-label="Design System section">${seg('tokens', 'Tokens')}${seg('components', 'Components')}</div>
      <div class="ds-input-wrap asv-search-wrap" id="assets-design-system-search-wrap">
        <input type="search" class="ds-input" id="assets-design-system-search"
          placeholder="Search tokens..." value="${escHtml(_query)}"
          aria-label="Search tokens" autocomplete="off">
      </div>
      <span class="asv-count">${_tokens.length} tokens in css/ds-tokens.css</span>
    </div>
    <div id="assets-design-system-body"></div>`;

  const input = document.getElementById('assets-design-system-search');
  if (input) {
    input.addEventListener('input', function () {
      _query = this.value || '';
      _paintBody();
    });
  }
  _paintBody();
}

// ── Delegated clicks: tab switch and copy ────────────────────────────────────

async function _copy(btn) {
  const text = btn.dataset.adsCopy;
  if (!text || !navigator.clipboard) return;
  try {
    await navigator.clipboard.writeText(text);
    btn.classList.add('ads-token--copied');
    setTimeout(() => btn.classList.remove('ads-token--copied'), 1200);
  } catch { /* clipboard refused - nothing to undo */ }
}

function _wire() {
  const root = document.getElementById(ROOT_ID);
  if (!root || root.dataset.adsWired === '1') return;
  root.dataset.adsWired = '1';
  const onClick = e => {
    const tab = e.target.closest('[data-ads-tab]');
    if (tab) {
      _tab = tab.dataset.adsTab === 'components' ? 'components' : 'tokens';
      root.querySelectorAll('[data-ads-tab]').forEach(b => {
        const on = b.dataset.adsTab === _tab;
        b.classList.toggle('active', on);
        b.setAttribute('aria-pressed', String(on));
      });
      _paintBody();
      return;
    }
    const copy = e.target.closest('[data-ads-copy]');
    if (copy) _copy(copy);
  };
  root.addEventListener('click', onClick);
  registerViewCleanup(VIEW_ID, () => {
    root.removeEventListener('click', onClick);
    delete root.dataset.adsWired;
  });
}

// ── Public pair ──────────────────────────────────────────────────────────────

/** Paints the Design System page. Called on every navigation into the view. */
export async function renderAssetsDesignSystemView() {
  if (_tokens === null) await _fetchTokens();
  _paint();
  _wire();
}

/** One-time init. The delegated listener is registered for teardown in _wire(). */
export function initAssetsDesignSystem() {
}
