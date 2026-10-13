// -- Mission Deck - js/topbar-sync-preview.js --------------------------
// Quick sync-status preview opened straight off the topbar "Sync"
// pill, styled after the flat per-file list the previous cockpit showed
// there (path, "local" / "on the server", "newer by X h"). Read-only:
// it never pushes, pulls, decrypts or clones - it only reads
// GET /api/sync-overview and GET /api/sync-modules/files (through
// js/sync-modules.js) and hands the person off to the full "Sync"
// modal (js/sync-center-modal.js) for every action, same contract as
// js/module-sync-bar.js.
//
// Positioning is computed at open time, never fixed in CSS: the panel opens
// below the topbar pill as usual, but below the update banner too whenever
// one is showing (#app-update-banner without .app-update-banner--hidden) -
// it must never sit on top of the banner and hide it, unlike the branch
// dropdown, which deliberately paints ABOVE the banner (see the z-index
// comment on .app-top-bar in styles.css). _position() re-reads both rects on
// every open, so a banner that appears or is dismissed while the pill sits
// idle is picked up on the next click with no listener of its own.

import { fetchSyncOverview, getSyncOverview } from './data-tier-0-sync.js';
import { fetchModuleFiles } from './sync-modules.js';
import { syncFileRowHtml } from './sync-file-list.js';

const PANEL_ID = 'topbar-sync-preview';
// Enough to match what the previous cockpit showed without a runaway page -
// the full, unbounded list stays one "Open" click away.
const MAX_FILES = 30;

let _outsideHandler = null;
let _escHandler = null;

/** @returns {boolean} whether the panel is currently open */
export function isSyncPreviewOpen() {
  return !!document.getElementById(PANEL_ID);
}

function _closePreview() {
  const el = document.getElementById(PANEL_ID);
  if (el) el.remove();
  if (_outsideHandler) { document.removeEventListener('mousedown', _outsideHandler); _outsideHandler = null; }
  if (_escHandler) { document.removeEventListener('keydown', _escHandler); _escHandler = null; }
}

function _footerHtml() {
  return `<div class="tsp-footer">
    <span class="tsp-footer-hint">Full sync and the other sources - in the "Sync" window.</span>
    <button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-tsp-open>Open</button>
  </div>`;
}

function _wireFooter(panel) {
  const btn = panel.querySelector('[data-tsp-open]');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    _closePreview();
    try {
      const { openSyncCenterModal } = await import('./sync-center-modal.js');
      await openSyncCenterModal();
    } catch (e) {
      console.error('[topbar-sync-preview] sync center failed to open:', e);
    }
  });
}

/**
 * Positions the panel below the anchor button AND below the update banner
 * (when one is visible) - never on top of either. Fixed positioning, so it
 * tracks neither scroll (the topbar itself never scrolls) nor resize once
 * open; a resize while the panel is open is rare enough that closing on the
 * next interaction (the outside-click handler) is an acceptable answer.
 * @param {HTMLElement} panel
 * @param {HTMLElement} anchorBtn
 */
function _position(panel, anchorBtn) {
  const btnRect = anchorBtn.getBoundingClientRect();
  const banner = document.getElementById('app-update-banner');
  const bannerVisible = !!banner
    && !banner.classList.contains('app-update-banner--hidden')
    && banner.getBoundingClientRect().height > 0;
  const bannerBottom = bannerVisible ? banner.getBoundingClientRect().bottom : 0;
  const top = Math.max(btnRect.bottom, bannerBottom) + 8;

  const width = panel.offsetWidth || 380;
  let left = btnRect.right - width;
  const minLeft = 12;
  const maxLeft = window.innerWidth - width - 12;
  if (left < minLeft) left = minLeft;
  if (left > maxLeft) left = maxLeft;

  panel.style.top = top + 'px';
  panel.style.left = left + 'px';
}

/**
 * Opens the preview panel (or closes it, if already open - the pill is a
 * toggle). Fire-and-forget from the caller: every exit path (success, empty,
 * error) resolves, never rejects.
 * @param {HTMLElement} anchorBtn
 * @returns {Promise<void>}
 */
export async function openSyncPreview(anchorBtn) {
  if (isSyncPreviewOpen()) { _closePreview(); return; }

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.className = 'topbar-sync-preview';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Data sync status');
  panel.innerHTML = '<div class="tsp-loading">Loading...</div>';
  document.body.appendChild(panel);
  _position(panel, anchorBtn);

  _outsideHandler = (e) => {
    if (panel.contains(e.target) || anchorBtn.contains(e.target)) return;
    _closePreview();
  };
  _escHandler = (e) => { if (e.key === 'Escape') _closePreview(); };
  document.addEventListener('mousedown', _outsideHandler);
  document.addEventListener('keydown', _escHandler);

  try {
    const overview = getSyncOverview() || await fetchSyncOverview();
    const repos = Array.isArray(overview && overview.repos) ? overview.repos : [];
    // Only sources that can actually be pushed from here and have something
    // waiting - a source with no working copy or no push permission (see
    // row.canPush in js/sync-center-modal.js) has nothing this panel can show.
    const pendingRepos = repos.filter((r) => r && r.canPush && Number(r.filesToSend) > 0);

    let files = [];
    let more = 0;
    for (const r of pendingRepos) {
      const res = await fetchModuleFiles(r.repo, '_all');
      if (res && res.ok && Array.isArray(res.files)) {
        files = files.concat(res.files);
        if (res.truncated) more += (Number(r.filesToSend) || res.files.length) - res.files.length;
      }
    }

    // Closed (or replaced by a second click) while the fetch was in flight.
    if (document.getElementById(PANEL_ID) !== panel) return;

    const total = pendingRepos.reduce((sum, r) => sum + (Number(r.filesToSend) || 0), 0);

    if (total === 0) {
      panel.innerHTML = '<div class="tsp-header">Data sync</div>'
        + '<div class="tsp-empty">Everything sent - no files waiting to be sent.</div>'
        + _footerHtml();
    } else {
      const shown = files.slice(0, MAX_FILES);
      const remaining = total - shown.length + more;
      panel.innerHTML = `<div class="tsp-header">To send (${total})</div>`
        + `<div class="tsp-list">${shown.map(syncFileRowHtml).join('')}</div>`
        + (remaining > 0 ? `<div class="tsp-more">and ${remaining} more - the full list is in the Sync window.</div>` : '')
        + _footerHtml();
    }
    _wireFooter(panel);
    _position(panel, anchorBtn);
  } catch (e) {
    console.error('[topbar-sync-preview] failed to load:', e);
    if (document.getElementById(PANEL_ID) !== panel) return;
    panel.innerHTML = '<div class="tsp-header">Data sync</div>'
      + '<div class="tsp-empty">Could not load the sync state.</div>'
      + _footerHtml();
    _wireFooter(panel);
  }
}
