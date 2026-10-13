// demo/shell-loader.mjs
// Loads the REAL shell markup: one GET of /index.html (the only network call
// the demo makes), parsed with DOMParser, and the nodes named in
// demo/shell-contract.mjs lifted into a reusable template. Nothing from the
// parsed page executes - every <script> is dropped before the clone - and the
// loading skeletons are removed because the mocks paint the real content.
// Standalone export (scripts/demo-export.js) sets `data-demo-shell` on <html>
// to the exported snapshot of index.html; every URL is already relative there,
// so the shell is fetched from that attribute and left as it is.

import { SHELL_CONTRACT } from './shell-contract.mjs';

const URL_ATTRS = ['src', 'href'];
const STANDALONE_SHELL = document.documentElement.dataset.demoShell || '';

/** Root-absolute URLs only: a relative src from /index.html would resolve under /demo/. */
function _absolutizeUrls(root) {
  root.querySelectorAll('[src], [href]').forEach((el) => {
    for (const attr of URL_ATTRS) {
      const v = el.getAttribute(attr);
      if (v === null || v === '') continue;
      if (/^(\/|#|[a-z][a-z0-9+.-]*:)/i.test(v)) continue;
      el.setAttribute(attr, '/' + v.replace(/^\.\//, ''));
    }
  });
}

/**
 * Fetch and parse /index.html, lift the contract nodes into a template.
 * Throws an Error listing every selector that is missing, so a drifted shell
 * shows up as a visible message instead of an empty stage.
 * @returns {Promise<DocumentFragment>}
 */
export async function loadShellTemplate() {
  const res = await fetch(STANDALONE_SHELL || '/index.html', { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load the app’s look (HTTP ' + res.status + ').');
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');

  const missing = SHELL_CONTRACT.filter((c) => !doc.querySelector(c.selector)).map((c) => c.selector);
  if (missing.length) {
    throw new Error('The app’s look has changed and the demo does not recognise it. Missing elements: ' + missing.join(', '));
  }

  const frag = document.createDocumentFragment();
  let app = null;
  let main = null;
  for (const entry of SHELL_CONTRACT) {
    if (!entry.lift) continue;
    const src = doc.querySelector(entry.selector);
    const node = document.importNode(src, !entry.shallow);
    if (entry.selector === 'body > div.app') app = node;
    if (entry.selector === 'main.main') main = node;
    const parent = entry.lift === 'root' ? frag : entry.lift === 'app' ? app : main;
    if (!parent) throw new Error('Shell contract: element ' + entry.selector + ' needs an earlier parent.');
    parent.appendChild(node);
  }

  frag.querySelectorAll('script').forEach((s) => s.remove());
  frag.querySelectorAll('[data-skel]').forEach((s) => s.remove());
  frag.querySelectorAll('.view-section.active').forEach((s) => s.classList.remove('active'));
  if (!STANDALONE_SHELL) _absolutizeUrls(frag);
  return frag;
}

/**
 * Page-level state the shell CSS keys off. The rail is pinned EXPANDED for a
 * presentation; nothing is written to storage, because the demo shares an
 * origin with the real app and must not change how it opens next time.
 */
export function prepareDocument() {
  const html = document.documentElement;
  html.removeAttribute('data-update-banner');
  html.removeAttribute('data-infra-banner');
  html.setAttribute('data-rail', 'expanded');
  document.body.classList.remove('sidebar-collapsed');
}

/**
 * Rail classes on a freshly cloned shell: BOTH #sidebar.collapsed and
 * body.sidebar-collapsed move together (conventions section 5).
 * @param {HTMLElement} surfaceRoot
 * @param {boolean} collapsed
 */
export function applyRailState(surfaceRoot, collapsed) {
  const sidebar = surfaceRoot.querySelector('#sidebar');
  if (sidebar) sidebar.classList.toggle('collapsed', collapsed);
  // Same icon swap as js/topbar.js _applyRailState.
  const icon = surfaceRoot.querySelector('#topbar-rail-toggle-icon');
  if (icon) icon.src = '/assets/icons/ds/' + (collapsed ? '24-ic-chevron-right.svg' : '24-ic-chevron-left.svg');
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  document.documentElement.setAttribute('data-rail', collapsed ? 'collapsed' : 'expanded');
}

/** Paint a drifted-shell error as a DS callout (prose inside ONE wrapping div). */
export function paintShellError(stage, err) {
  const box = document.createElement('div');
  box.className = 'ds-callout ds-callout--danger demo-shell-error';
  const inner = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = 'The demo cannot start.';
  const p = document.createElement('p');
  p.textContent = (err && err.message) || String(err);
  inner.append(strong, p);
  box.appendChild(inner);
  stage.replaceChildren(box);
}
