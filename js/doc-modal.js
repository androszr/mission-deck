// ── Mission Deck — js/doc-modal.js ────────────────────────────────────────
// The shared "read a repo document" modal used by Settings > Agents (agent
// briefs) and Settings > Skills (skill instructions and command help). One
// overlay in index.html, one renderer, an optional file switcher when the
// document is part of a set.
// Exports: openDocModal({ title, files, load })

import { openDsModal, closeDsModal } from './ds-modal.js';
import { renderMarkdown } from './md-render.js';

function _els() {
  return {
    overlay: document.getElementById('doc-modal-overlay'),
    title: document.getElementById('doc-modal-title'),
    path: document.getElementById('doc-modal-path'),
    tabs: document.getElementById('doc-modal-tabs'),
    body: document.getElementById('doc-modal-body'),
  };
}

function _esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let _wired = false;
let _activeLoad = null;

function _wireOnce() {
  if (_wired) return;
  const { overlay, tabs } = _els();
  if (!overlay) return;
  _wired = true;
  const close = () => closeDsModal(overlay);
  document.getElementById('doc-modal-close')?.addEventListener('click', close);
  document.getElementById('doc-modal-close-footer')?.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) close();
  });
  tabs?.addEventListener('click', e => {
    const btn = e.target.closest('[data-doc-file]');
    if (!btn || !_activeLoad) return;
    for (const b of tabs.querySelectorAll('[data-doc-file]')) b.classList.toggle('active', b === btn);
    _show(_activeLoad, btn.dataset.docFile);
  });
}

async function _show(load, file) {
  const { path, body } = _els();
  body.innerHTML = '<p class="sett-loading">Loading...</p>';
  try {
    const doc = await load(file);
    path.textContent = doc.path || '';
    body.innerHTML = `<div class="md-body">${renderMarkdown(doc.content || '')}</div>`;
    body.scrollTop = 0;
  } catch (err) {
    path.textContent = '';
    body.innerHTML = `<div class="ds-callout ds-callout--danger"><div>${_esc(err.message)}</div></div>`;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.title heading of the modal
 * @param {{file: string, label: string}[]} [opts.files] file switcher; omitted or
 *   single-entry hides the switcher
 * @param {(file?: string) => Promise<{path: string, content: string}>} opts.load
 *   fetches one document; rejects with a message the modal shows as a callout
 */
export function openDocModal({ title, files, load }) {
  _wireOnce();
  const { overlay, title: titleEl, path, tabs, body } = _els();
  if (!overlay) return;
  _activeLoad = load;
  titleEl.textContent = title;
  path.textContent = '';
  body.innerHTML = '';
  const list = Array.isArray(files) ? files : [];
  if (list.length > 1) {
    tabs.innerHTML = list.map((f, i) => `
      <button type="button" class="doc-modal-tab${i === 0 ? ' active' : ''}" data-doc-file="${_esc(f.file)}">${_esc(f.label)}</button>
    `).join('');
    tabs.hidden = false;
  } else {
    tabs.innerHTML = '';
    tabs.hidden = true;
  }
  openDsModal(overlay);
  _show(load, list.length ? list[0].file : undefined);
}
