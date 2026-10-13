// modules/prod-bugs/client/refresh-modal.js
// The "Refresh from Jira" window: a confirm step (data freshness, choice between
// the default scope and a full re-fetch) then a progress step over
// GET /refresh-stream, SSE events start|progress|log|done|error. Shape copied
// from modules/sprint-stats/client/refresh-modal.js with a single stage.
// Cannot be dismissed while a stream runs (openDsModal dismissible: false).
//
// The EventSource is closed on done, on every error (a native error would
// otherwise auto-reconnect and start a SECOND run) and in the view cleanup.
// js/ds-modal.js is never imported statically (plain-Node contract test): the
// caller passes the loaded namespace in.

function _esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _fmtDateTime(iso) {
  if (!iso) return 'no data';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

/**
 * @param {{apiBase: string, overview: object, dsModal: object|null,
 *   registerViewCleanup?: Function, onDone?: Function}} opts
 * @returns {Promise<{ok: boolean, ranStream: boolean}>} resolves when the window closes
 */
export function openRefreshModal({ apiBase, overview, dsModal, registerViewCleanup, onDone }) {
  const fetchedAt = overview && overview.fetchedAt;

  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="ds-modal ds-modal--md prod-bugs-refresh-modal" role="dialog" aria-modal="true" aria-label="Refreshing production bugs">
      <div class="ds-modal-header"><span class="ds-modal-title">Refreshing production bugs</span></div>
      <div class="ds-modal-body">
        <div class="prod-bugs-refresh-step" data-step="confirm">
          <div class="prod-bugs-refresh-freshness">Data from: ${_esc(_fmtDateTime(fetchedAt))}</div>
          <p class="prod-bugs-refresh-hint">By default only the current sprint is recalculated and past sprints come from the cache. "Re-fetch everything" recalculates every sprint from Jira and takes longer.</p>
        </div>
        <div class="prod-bugs-refresh-step" data-step="progress" hidden>
          <div class="ds-progress">
            <div class="ds-progress-labels"><span class="prod-bugs-refresh-step-label">Start...</span><span class="prod-bugs-refresh-percent">0%</span></div>
            <div class="ds-progress-track"><div class="ds-progress-fill ds-progress-fill--brand prod-bugs-refresh-fill" style="width:0%"></div></div>
          </div>
          <div class="prod-bugs-refresh-log" role="log" aria-live="polite"></div>
        </div>
      </div>
      <div class="ds-modal-footer" data-footer="confirm">
        <button type="button" class="ds-btn ds-btn--primary" data-refresh-current>Refresh current sprint</button>
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
  const stepLabel = q('.prod-bugs-refresh-step-label');
  const percentLabel = q('.prod-bugs-refresh-percent');
  const fillEl = q('.prod-bugs-refresh-fill');
  const logEl = q('.prod-bugs-refresh-log');
  const closeBtn = q('[data-refresh-close]');

  let es = null;
  let finished = false;

  function _log(text) {
    const row = document.createElement('div');
    row.className = 'prod-bugs-refresh-log-line';
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

  function _closeStream() {
    if (es) { try { es.close(); } catch { /* already closed */ } es = null; }
  }

  function _close() {
    _closeStream();
    if (dsModal && typeof dsModal.closeDsModal === 'function') dsModal.closeDsModal(overlay);
    overlay.remove();
  }

  return new Promise((resolve) => {
    function _finishStream(result) {
      if (finished) return;
      finished = true;
      _closeStream();
      if (!result.ok) {
        fillEl.classList.remove('ds-progress-fill--brand');
        fillEl.classList.add('ds-progress-fill--red');
      }
      closeBtn.disabled = false;
      closeBtn.focus();
      if (result.ok && typeof onDone === 'function') onDone(result.data);
    }

    function startStream(force) {
      confirmStep.hidden = true;
      progressStep.hidden = false;
      confirmFooter.hidden = true;
      progressFooter.hidden = false;
      _log('Refresh started' + (force ? ' (full re-fetch).' : '.'));

      try {
        es = new EventSource(apiBase + '/refresh-stream' + (force ? '?force=1' : ''));
      } catch (err) {
        _log('Could not open the connection: ' + (err && err.message ? err.message : String(err)));
        _finishStream({ ok: false });
        return;
      }

      es.addEventListener('progress', (e) => {
        let p; try { p = JSON.parse(e.data); } catch { return; }
        _progress(Number(p.percent), p.step);
      });
      es.addEventListener('log', (e) => {
        let p; try { p = JSON.parse(e.data); } catch { return; }
        if (p && p.text) _log(p.text);
      });
      es.addEventListener('done', (e) => {
        let d; try { d = JSON.parse(e.data); } catch { d = {}; }
        _progress(100, 'Finished');
        _log('Refresh finished, sprints written: ' + (d.written || 0) + '.');
        _finishStream({ ok: true, data: d });
      });
      es.addEventListener('error', (e) => {
        let payload = null;
        try { payload = e && e.data ? JSON.parse(e.data) : null; } catch { payload = null; }
        if (payload) {
          _log(payload.message || 'Refresh failed.');
          if (Array.isArray(payload.tail)) payload.tail.slice(-8).forEach((l) => _log(String(l)));
        } else {
          _log('Connection lost - the operation was stopped.');
        }
        _finishStream({ ok: false });
      });
    }

    q('[data-refresh-cancel]').addEventListener('click', () => {
      if (es) return;
      _close();
      resolve({ ok: false, ranStream: false });
    });
    q('[data-refresh-current]').addEventListener('click', () => startStream(false));
    q('[data-refresh-force]').addEventListener('click', () => startStream(true));
    closeBtn.addEventListener('click', () => {
      if (!finished) return;
      _close();
      resolve({ ok: true, ranStream: true });
    });

    if (typeof registerViewCleanup === 'function') {
      registerViewCleanup(() => {
        _closeStream();
        if (overlay.isConnected) _close();
        resolve({ ok: false, ranStream: !!finished });
      });
    }

    if (dsModal && typeof dsModal.openDsModal === 'function') dsModal.openDsModal(overlay, { dismissible: false });
    else overlay.hidden = false;
  });
}
