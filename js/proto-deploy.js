// ── Mission Deck — js/proto-deploy.js ─────────────────────────────────
// Local build and publishing of a React prototype (stages 3-4 of the migration plan).
// Imported dynamically from the prototype details view, so nothing here sits
// on the app start path - the same as js/stash-modal.js.
//
// Two entry points, both from the details page header (js/prototypy.js):
//
//   * runLocalPreview(item, btn) - POST /api/prototypes/local-preview/<id>
//     with a progress modal (GET /api/prototypes/local-preview-status). The
//     browser tab is opened SYNCHRONOUSLY, inside the clicking person's
//     gesture: preparing the preview can take minutes (a cold Vite start,
//     `npm install`), and a window.open() after an await is no longer a
//     gesture, so browsers block it like a popup.
//   * openProtoDeployModal(item) - a confirmation, then an SSE stream
//     GET /api/prototypes/deploy-stream?id=... with the same event convention
//     as the data sync (start / log / progress / done / error).
//
// The progress modal here is its own, not shared with
// js/sub-repo-sync-stream.js: that one knows the git error taxonomy and the
// data repository repair actions, while this run ends with a link to the
// published version.

import { openDsModal, closeDsModal } from './ds-modal.js';
import { showToast } from './toast.js';
import { escHtml } from './utils.js';
import {
  deployConfirmHtml,
  progressLabel,
  deployResultHtml,
  deployErrorInfo,
  isStaleSourceError,
  staleSourceHtml,
  isUnsentSourceError,
  unsentSourceHtml,
  deployStreamUrl,
  previewSteps,
  previewStepsHtml,
  formatElapsed,
} from './proto-deploy-helpers.mjs';
import { runSyncWithProgress } from './sub-repo-sync-stream.js';

const OVERLAY_ID = 'proto-deploy-overlay';

/** The open stream, so closing the window stops it. */
let _es = null;

// ── Local preview ─────────────────────────────────────────────────────────────

const PREVIEW_OVERLAY_ID = 'proto-preview-overlay';
const PREVIEW_POLL_MS = 1000;

function _ensurePreviewOverlay() {
  const found = document.getElementById(PREVIEW_OVERLAY_ID);
  if (found) return found;
  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.id = PREVIEW_OVERLAY_ID;
  overlay.hidden = true;
  overlay.innerHTML = '<div class="ds-modal ds-modal--md proto-deploy-modal" role="dialog" aria-modal="true" aria-labelledby="proto-preview-title">'
    + '<div class="ds-modal-header">'
    + '<h2 class="ds-modal-title" id="proto-preview-title">Local preview</h2>'
    + '<button type="button" class="ds-modal-close" data-pp-close aria-label="Close">&times;</button>'
    + '</div>'
    + '<div class="ds-modal-body" data-pp-body></div>'
    + '<div class="ds-modal-footer" data-pp-footer></div>'
    + '</div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || (e.target.closest && e.target.closest('[data-pp-close]'))) {
      closeDsModal(overlay);
      overlay.dispatchEvent(new CustomEvent('proto-preview-closed'));
    }
  });
  return overlay;
}

/**
 * Starts the local preview of the prototype and moves the opened tab to it.
 * Throughout the preparation it shows a modal with the steps and an
 * explanation of what is happening and why it takes time
 * (GET /api/prototypes/local-preview-status every second). Closing the modal
 * does not stop the preparation - the tab still gets the URL once the preview
 * is ready.
 * @param {{id: string, name?: string}} item
 * @param {HTMLButtonElement|null} btn the button that triggered it
 * @param {Window|null} [openedTab] a tab already opened inside the user gesture
 * @returns {Promise<void>}
 */
export async function runLocalPreview(item, btn, openedTab) {
  const pendingTab = openedTab !== undefined ? openedTab : window.open('', '_blank');
  const origHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Preparing...';
  }

  const overlay = _ensurePreviewOverlay();
  const body = overlay.querySelector('[data-pp-body]');
  const footer = overlay.querySelector('[data-pp-footer]');
  const name = escHtml(item.name || item.id);
  body.innerHTML = `<p>Preparing the preview of prototype <strong>${name}</strong>. It opens in a new tab once the server is ready.</p>
    <div data-pp-steps>${previewStepsHtml(previewSteps(null))}</div>
    <p class="proto-preview-total" data-pp-total></p>
    <div class="proto-deploy-result" data-pp-result hidden></div>`;
  footer.innerHTML = '<span class="proto-preview-hint">You can close this window - the preparation continues.</span>'
    + '<button type="button" class="ds-btn ds-btn--secondary" data-pp-close>Close</button>';
  openDsModal(overlay);

  const stepsEl = body.querySelector('[data-pp-steps]');
  const totalEl = body.querySelector('[data-pp-total]');
  const resultEl = body.querySelector('[data-pp-result]');
  const t0 = Date.now();
  let settled = false;
  let timer = null;
  const stopPolling = () => { if (timer) clearTimeout(timer); timer = null; };
  overlay.addEventListener('proto-preview-closed', stopPolling, { once: true });

  const poll = async () => {
    timer = null;
    try {
      const r = await fetch('/api/prototypes/local-preview-status?id=' + encodeURIComponent(item.id), { cache: 'no-store' });
      const st = await r.json();
      if (settled) return;
      if (st && st.active) stepsEl.innerHTML = previewStepsHtml(previewSteps(st));
    } catch { /* the status is only a hint - next attempt in a second */ }
    if (settled) return;
    totalEl.textContent = `Total: ${formatElapsed(Date.now() - t0)}`;
    if (!overlay.hidden) timer = setTimeout(poll, PREVIEW_POLL_MS);
  };
  timer = setTimeout(poll, 300);

  const fail = (message) => {
    if (pendingTab) pendingTab.close();
    resultEl.hidden = false;
    resultEl.innerHTML = `<div class="ds-callout ds-callout--danger"><div>${escHtml(message || 'Could not prepare the local preview.')}</div></div>`;
    footer.innerHTML = '<button type="button" class="ds-btn ds-btn--secondary" data-pp-close>Close</button>';
    showToast('danger', 'Could not prepare the local preview', message || '');
  };

  try {
    const res = await fetch('/api/prototypes/local-preview/' + encodeURIComponent(item.id), { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    settled = true;
    stopPolling();
    if (!res.ok || !data.url) {
      fail(data.message);
      return;
    }
    if (pendingTab) pendingTab.location.href = data.url;
    else window.open(data.url, '_blank', 'noopener');
    closeDsModal(overlay);
    showToast('success', 'Local preview ready', data.url);
  } catch (e) {
    settled = true;
    stopPolling();
    fail((e && e.message) || '');
  } finally {
    overlay.removeEventListener('proto-preview-closed', stopPolling);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origHtml;
    }
  }
}

// ── Publish window ───────────────────────────────────────────────────────────

function _ensureOverlay() {
  const found = document.getElementById(OVERLAY_ID);
  if (found) return found;
  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.id = OVERLAY_ID;
  overlay.hidden = true;
  overlay.innerHTML = '<div class="ds-modal ds-modal--lg proto-deploy-modal" role="dialog" aria-modal="true" aria-labelledby="proto-deploy-title">'
    + '<div class="ds-modal-header">'
    + '<h2 class="ds-modal-title" id="proto-deploy-title">Publish prototype</h2>'
    + '<button type="button" class="ds-modal-close" data-pd-close aria-label="Close">&times;</button>'
    + '</div>'
    + '<div class="ds-modal-body" data-pd-body></div>'
    + '<div class="ds-modal-footer" data-pd-footer></div>'
    + '</div>';
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || (e.target.closest && e.target.closest('[data-pd-close]'))) _close(overlay);
  });
  return overlay;
}

function _close(overlay) {
  if (_es) {
    // Closing the window ends the stream. The server still finishes the step
    // it started - publishing is not interrupted, we just stop watching it.
    try { _es.close(); } catch { /* already closed */ }
    _es = null;
  }
  closeDsModal(overlay);
}

/**
 * Opens the publish confirmation window and, after confirming, the same modal
 * in its progress state, wired to the SSE stream.
 * @param {{id: string, name?: string, invitationCode?: string|null}} item
 * @param {() => void} [onDone] called after a successful publish
 */
export function openProtoDeployModal(item, onDone) {
  const overlay = _ensureOverlay();
  const body = overlay.querySelector('[data-pd-body]');
  const footer = overlay.querySelector('[data-pd-footer]');
  body.innerHTML = deployConfirmHtml(item);
  footer.innerHTML = '<button type="button" class="ds-btn ds-btn--secondary" data-pd-close>Cancel</button>'
    + '<button type="button" class="ds-btn ds-btn--primary" data-pd-start>Publish</button>';
  const start = footer.querySelector('[data-pd-start]');
  start.addEventListener('click', () => { _startStream(overlay, item, onDone, false); });
  openDsModal(overlay);
}

/**
 * @param {HTMLElement} overlay
 * @param {{id: string, name?: string}} item
 * @param {(() => void)|undefined} onDone
 * @param {boolean} force force=1 - only from the "Publish anyway" button
 *   under a `stale-source` refusal; the first "Publish" click never carries
 *   it, because the gate exists so the person sees the list first.
 */
function _startStream(overlay, item, onDone, force) {
  const body = overlay.querySelector('[data-pd-body]');
  const footer = overlay.querySelector('[data-pd-footer]');
  body.innerHTML = `<div class="proto-deploy-progress">
      <div class="proto-deploy-bar"><div class="proto-deploy-bar-fill" data-pd-bar style="width:0%"></div></div>
      <div class="proto-deploy-status" data-pd-status>${escHtml(progressLabel(0, 'Start...'))}</div>
      <ol class="proto-deploy-log" data-pd-log aria-live="polite"></ol>
      <div class="proto-deploy-result" data-pd-result hidden></div>
    </div>`;
  footer.innerHTML = '<button type="button" class="ds-btn ds-btn--secondary" data-pd-close>Close</button>';

  const bar = body.querySelector('[data-pd-bar]');
  const statusEl = body.querySelector('[data-pd-status]');
  const logEl = body.querySelector('[data-pd-log]');
  const resultEl = body.querySelector('[data-pd-result]');
  let lastMsg = '';

  const appendLog = (text) => {
    if (!text) return;
    const li = document.createElement('li');
    li.textContent = text;
    logEl.appendChild(li);
    logEl.scrollTop = logEl.scrollHeight;
  };
  const finish = (html, statusText) => {
    if (_es) { try { _es.close(); } catch { /* already closed */ } _es = null; }
    statusEl.textContent = statusText;
    resultEl.hidden = false;
    resultEl.innerHTML = html;
  };

  const es = new EventSource(deployStreamUrl(item.id, force));
  _es = es;

  es.addEventListener('log', (e) => {
    try { appendLog(JSON.parse(e.data).text); } catch { /* malformed event */ }
  });
  es.addEventListener('progress', (e) => {
    let d;
    try { d = JSON.parse(e.data); } catch { return; }
    if (d.msg) lastMsg = d.msg;
    bar.style.width = Math.max(0, Math.min(100, Number(d.pct) || 0)) + '%';
    statusEl.textContent = progressLabel(d.pct, d.msg, lastMsg);
  });
  es.addEventListener('done', (e) => {
    let d = {};
    try { d = JSON.parse(e.data); } catch { /* no details */ }
    bar.style.width = '100%';
    finish(deployResultHtml({ ok: true, message: d.message, url: d.url, pushed: d.pushed, unsynced: d.unsynced }), progressLabel(100, d.message || 'Done'));
    showToast('success', 'Prototype published', d.message || '');
    if (typeof onDone === 'function') onDone();
  });
  es.addEventListener('error', (e) => {
    const info = deployErrorInfo(e && e.data);
    if (isStaleSourceError(info)) {
      // A gate refusal, not a failure: the person sees the file list and decides.
      // The second run carries force=1 and passes this one gate - ESLint and the
      // build still apply.
      finish(staleSourceHtml(info), 'Publishing paused');
      footer.innerHTML = '<button type="button" class="ds-btn ds-btn--secondary" data-pd-close>Close</button>'
        + '<button type="button" class="ds-btn ds-btn--danger" data-pd-force>Publish anyway</button>';
      footer.querySelector('[data-pd-force]').addEventListener('click', () => { _startStream(overlay, item, onDone, true); });
      showToast('warning', 'Publishing paused', 'The published version has not gone through the shared data repository.');
      return;
    }
    if (isUnsentSourceError(info)) {
      // The hosting must not run ahead of shared data: there is no "anyway" here.
      // The button sends team data (the same push as Sync) and, after a
      // successful send, starts the publish again.
      finish(unsentSourceHtml(info), 'Publishing paused');
      footer.innerHTML = '<button type="button" class="ds-btn ds-btn--secondary" data-pd-close>Close</button>'
        + '<button type="button" class="ds-btn ds-btn--primary" data-pd-push>Send data and publish</button>';
      const pushBtn = footer.querySelector('[data-pd-push]');
      pushBtn.addEventListener('click', async () => {
        pushBtn.disabled = true;
        statusEl.textContent = 'Sending team data...';
        const pushed = await runSyncWithProgress('/api/data/data-tier-0/push-stream', {
          title: 'Sync team data (Send)',
          repoBase: 'data/data-tier-0',
          encrypted: true,
          inline: { quiet: true, onLog: (text) => appendLog(text) },
        });
        if (pushed && pushed.ok) {
          _startStream(overlay, item, onDone, force);
          return;
        }
        pushBtn.disabled = false;
        statusEl.textContent = 'Sending data failed';
        showToast('danger', 'Sending team data failed', (pushed && pushed.message) || 'Try it in Sync.');
      });
      showToast('warning', 'Publishing paused', 'The prototype files are not sent to the shared data repository.');
      return;
    }
    finish(deployResultHtml({ ok: false, message: info.message }), 'Publishing interrupted');
    showToast('danger', 'Publishing the prototype failed', info.message);
  });
}
