// modules/sprint-stats/client/refresh-modal.js
// The "Refresh" window: a confirm step (freshness per source, choice between
// the default scope and a full re-fetch) then a progress step over
// GET /refresh-stream, SSE events start|progress|log|done|error. Cannot be
// dismissed while a stream is running - js/ds-modal.js's own dismiss layer
// is intentionally left off (opts.dismissible: false).
//
// This module never imports js/ds-modal.js statically (that file assumes a
// browser document and a /js/... URL resolver, which the plain-Node contract test does
// not have) - the caller (client/index.js) already holds the loaded
// namespace and passes it in.

import { teamLabel } from './sprint-model.mjs';

function _esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _fmtDate(iso) {
  if (!iso) return 'no data';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/**
 * Opens the refresh window. Resolves once the window is closed (after
 * `done`/`error`, or if the user cancels at the confirm step before any
 * stream starts) with `{ ok: boolean, ranStream: boolean }`.
 * @param {{apiBase: string, overview: object, dsModal: object|null,
 *   registerViewCleanup?: Function, onDone?: Function}} opts
 * @returns {Promise<{ok: boolean, ranStream: boolean}>}
 */
export function openRefreshModal({ apiBase, overview, dsModal, registerViewCleanup, onDone }) {
  const boards = (overview && overview.index && overview.index.boards) || {};
  const mainAt = boards.main && boards.main.generated_at;
  const platformAt = boards.platform && boards.platform.generated_at;
  const deltaLabel = teamLabel('Delta');

  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="ds-modal ds-modal--md sprint-stats-refresh-modal" role="dialog" aria-modal="true">
      <div class="ds-modal-header"><span class="ds-modal-title">Refreshing Sprint Stats</span></div>
      <div class="ds-modal-body">
        <div class="sprint-stats-refresh-step" data-step="confirm">
          <div class="sprint-stats-refresh-freshness">
            <div>MAIN: data from ${_esc(_fmtDate(mainAt))}</div>
            <div>${_esc(deltaLabel)}: data from ${_esc(_fmtDate(platformAt))}</div>
          </div>
        </div>
        <div class="sprint-stats-refresh-step" data-step="progress" hidden>
          <div class="sprint-stats-refresh-stages">
            <div class="sprint-stats-refresh-stage" data-stage="main"><span class="sprint-stats-refresh-stage-label">MAIN</span><span class="sprint-stats-refresh-stage-state"></span></div>
            <div class="sprint-stats-refresh-stage" data-stage="platform"><span class="sprint-stats-refresh-stage-label">${_esc(deltaLabel)}</span><span class="sprint-stats-refresh-stage-state"></span></div>
          </div>
          <div class="ds-progress">
            <div class="ds-progress-labels"><span class="sprint-stats-refresh-step-label">Start...</span><span class="sprint-stats-refresh-percent">0%</span></div>
            <div class="ds-progress-track"><div class="ds-progress-fill ds-progress-fill--brand sprint-stats-refresh-fill" style="width:0%"></div></div>
          </div>
          <div class="sprint-stats-refresh-log"></div>
        </div>
      </div>
      <div class="ds-modal-footer" data-footer="confirm">
        <button type="button" class="ds-btn ds-btn--primary" data-refresh-active>Refresh active sprints</button>
        <button type="button" class="ds-btn ds-btn--secondary" data-refresh-force>Re-fetch everything</button>
        <button type="button" class="ds-btn ds-btn--tertiary" data-refresh-cancel>Cancel</button>
      </div>
      <div class="ds-modal-footer" data-footer="progress" hidden>
        <button type="button" class="ds-btn ds-btn--primary" data-refresh-close disabled>Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const q = (sel) => overlay.querySelector(sel);
  const confirmStep = q('[data-step="confirm"]');
  const progressStep = q('[data-step="progress"]');
  const confirmFooter = q('[data-footer="confirm"]');
  const progressFooter = q('[data-footer="progress"]');
  const stepLabel = q('.sprint-stats-refresh-step-label');
  const percentLabel = q('.sprint-stats-refresh-percent');
  const fillEl = q('.sprint-stats-refresh-fill');
  const logEl = q('.sprint-stats-refresh-log');
  const closeBtn = q('[data-refresh-close]');

  let es = null;
  let finished = false;

  function _log(text) {
    const row = document.createElement('div');
    row.className = 'sprint-stats-refresh-log-line';
    row.textContent = text;
    logEl.appendChild(row);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function _progress(pct, step) {
    if (typeof pct === 'number' && Number.isFinite(pct)) {
      const p = Math.max(0, Math.min(100, Math.round(pct)));
      fillEl.style.width = p + '%';
      percentLabel.textContent = p + '%';
    }
    if (step) stepLabel.textContent = String(step);
  }

  function _setStage(id, state) {
    const row = overlay.querySelector('[data-stage="' + id + '"] .sprint-stats-refresh-stage-state');
    if (row) row.textContent = state;
  }

  function _close() {
    if (dsModal && typeof dsModal.closeDsModal === 'function') dsModal.closeDsModal(overlay);
    overlay.remove();
  }

  return new Promise((resolve) => {
    function finishAsCancelled() {
      _close();
      resolve({ ok: false, ranStream: false });
    }

    q('[data-refresh-cancel]').addEventListener('click', () => {
      if (finished || !es) finishAsCancelled();
    });

    function startStream(force) {
      confirmStep.hidden = true;
      progressStep.hidden = false;
      confirmFooter.hidden = true;
      progressFooter.hidden = false;
      _log('Refresh started' + (force ? ' (full fetch).' : '.'));
      _setStage('main', 'w toku...');

      const url = apiBase + '/refresh-stream' + (force ? '?force=1' : '');
      try {
        es = new EventSource(url);
      } catch (err) {
        _log('Could not open the connection: ' + (err && err.message ? err.message : String(err)));
        _finishStream({ ok: false, message: 'Could not open the connection.' });
        return;
      }

      es.addEventListener('progress', (e) => {
        let p; try { p = JSON.parse(e.data); } catch { return; }
        _progress(Number(p.percent), p.step);
        if (typeof p.percent === 'number') {
          _setStage(p.percent < 50 ? 'main' : 'platform', 'w toku...');
          if (p.percent >= 50) _setStage('main', 'done');
        }
      });
      es.addEventListener('log', (e) => {
        let p; try { p = JSON.parse(e.data); } catch { return; }
        if (p && p.text) _log(p.text);
      });
      es.addEventListener('done', (e) => {
        let d; try { d = JSON.parse(e.data); } catch { d = {}; }
        _setStage('main', d.stages && d.stages.main && d.stages.main.ok ? 'done' : 'error');
        _setStage('platform', d.stages && d.stages.platform && d.stages.platform.ok ? 'done' : 'error');
        _progress(100, 'Finished');
        _log('Refresh finished: ' + (d.written || 0) + ' sprints written.');
        _finishStream({ ok: true, data: d });
      });
      es.addEventListener('error', (e) => {
        let payload = null;
        try { payload = e.data ? JSON.parse(e.data) : null; } catch { payload = null; }
        if (payload) {
          if (payload.stages) {
            _setStage('main', payload.stages.main && payload.stages.main.ok ? 'done' : 'error');
            _setStage('platform', payload.stages.platform && payload.stages.platform.ok ? 'done' : 'error');
          }
          _log(payload.message || 'Refresh failed.');
          _finishStream({ ok: false, message: payload.message });
          return;
        }
        _log('Connection lost - the operation was stopped.');
        _finishStream({ ok: false, message: 'Connection lost.' });
      });
    }

    function _finishStream(result) {
      if (finished) return;
      finished = true;
      if (es) { try { es.close(); } catch { /* already closed */ } es = null; }
      if (!result.ok) {
        fillEl.classList.remove('ds-progress-fill--brand');
        fillEl.classList.add('ds-progress-fill--red');
      }
      closeBtn.disabled = false;
      closeBtn.focus();
      if (result.ok && typeof onDone === 'function') onDone(result.data);
    }

    q('[data-refresh-active]').addEventListener('click', () => startStream(false));
    q('[data-refresh-force]').addEventListener('click', () => startStream(true));
    closeBtn.addEventListener('click', () => {
      if (!finished) return;
      _close();
      resolve({ ok: true, ranStream: true });
    });

    if (typeof registerViewCleanup === 'function') {
      registerViewCleanup(() => {
        if (es) { try { es.close(); } catch { /* already closed */ } es = null; }
        if (overlay.isConnected) _close();
      });
    }

    if (dsModal && typeof dsModal.openDsModal === 'function') dsModal.openDsModal(overlay, { dismissible: false });
    else overlay.hidden = false;
  });
}
