// modules/qa-tests/client/refresh-modal.js
// The "Refresh" dialog for QA Tests: a confirm step (data freshness), then
// a progress step over GET /refresh-stream (SSE).
// It cannot be closed while the stream runs (dismissible: false).
//
// Pattern: modules/sprint-stats/client/refresh-modal.js
// Difference: a single stage (no project choice), no force option
// (QA always fetches the full data).
//
// Does not import js/ds-modal.js statically - the caller (index.js) passes
// the loaded namespace in the dsModal parameter.

function _esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _fmtDate(iso) {
  if (!iso) return 'no data';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear()
    + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// Copy for each refusal code.
const REFUSAL_MESSAGES = {
  'test-mode':    'Refreshing is disabled in test mode.',
  'busy':         'A refresh is already running. Wait for it to finish.',
  'no-token':     'No Jira token. Unlock the Bitwarden vault in Settings.',
  'data-missing': 'The team data repository is not fetched. Fetch it in the Sync window.',
  'no-python':    'Python 3 is not available on this computer. Install Python 3 and check PATH.',
};

function _refusalMessage(code, fallback) {
  return REFUSAL_MESSAGES[code] || fallback || ('Error: ' + code);
}

/**
 * Opens the QA Tests refresh dialog.
 * Resolves when the dialog closes with { ok: boolean, ranStream: boolean }.
 * @param {{apiBase: string, overview: object|null, dsModal: object|null,
 *   registerViewCleanup?: Function, onDone?: Function}} opts
 * @returns {Promise<{ok: boolean, ranStream: boolean}>}
 */
export function openRefreshModal({ apiBase, overview, dsModal, registerViewCleanup, onDone }) {
  const generatedAt = overview && overview.index && overview.index.meta && overview.index.meta.generated_at;

  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.hidden = true;
  overlay.innerHTML = '<div class="ds-modal ds-modal--md qa-tests-refresh-modal" role="dialog" aria-modal="true">'
    + '<div class="ds-modal-header"><span class="ds-modal-title">Refresh QA Tests</span></div>'
    + '<div class="ds-modal-body">'
    // Confirm step
    + '<div class="qa-tests-refresh-step" data-step="confirm">'
    + '<p class="qa-tests-refresh-freshness">Latest data: <strong>' + _esc(_fmtDate(generatedAt)) + '</strong></p>'
    + '<p>The refresh fetches the current test case data from Jira and saves it in the team data repository.</p>'
    + '</div>'
    // Progress step
    + '<div class="qa-tests-refresh-step" data-step="progress" hidden>'
    + '<div class="ds-progress">'
    + '<div class="ds-progress-labels"><span class="qa-tests-refresh-step-label">Start...</span><span class="qa-tests-refresh-percent">0%</span></div>'
    + '<div class="ds-progress-track"><div class="ds-progress-fill ds-progress-fill--brand qa-tests-refresh-fill" style="width:0%"></div></div>'
    + '</div>'
    + '<div class="qa-tests-refresh-log"></div>'
    + '</div>'
    + '</div>'
    // Confirm footer: primary first (Refresh), then Cancel.
    + '<div class="ds-modal-footer" data-footer="confirm">'
    + '<button type="button" class="ds-btn ds-btn--primary" data-refresh-start>Refresh</button>'
    + '<button type="button" class="ds-btn ds-btn--tertiary" data-refresh-cancel>Cancel</button>'
    + '</div>'
    // Progress footer: Close (disabled until done).
    + '<div class="ds-modal-footer" data-footer="progress" hidden>'
    + '<button type="button" class="ds-btn ds-btn--primary" data-refresh-close disabled>Close</button>'
    + '</div>'
    + '</div>';
  document.body.appendChild(overlay);

  const q          = (sel) => overlay.querySelector(sel);
  const confirmStep  = q('[data-step="confirm"]');
  const progressStep = q('[data-step="progress"]');
  const confirmFooter  = q('[data-footer="confirm"]');
  const progressFooter = q('[data-footer="progress"]');
  const stepLabel    = q('.qa-tests-refresh-step-label');
  const percentLabel = q('.qa-tests-refresh-percent');
  const fillEl       = q('.qa-tests-refresh-fill');
  const logEl        = q('.qa-tests-refresh-log');
  const closeBtn     = q('[data-refresh-close]');

  let es       = null;
  let finished = false;

  function _log(text) {
    const row = document.createElement('div');
    row.className = 'qa-tests-refresh-log-line';
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

    function startStream() {
      confirmStep.hidden   = true;
      progressStep.hidden  = false;
      confirmFooter.hidden = true;
      progressFooter.hidden = false;
      _log('Starting the QA Tests refresh...');

      const url = apiBase + '/refresh-stream';
      try {
        es = new EventSource(url);
      } catch (err) {
        _log('Could not open the connection: ' + (err && err.message ? err.message : String(err)));
        _finishStream({ ok: false, message: 'Could not open the connection.' });
        return;
      }

      es.addEventListener('progress', (e) => {
        let p;
        try { p = JSON.parse(e.data); } catch { return; }
        _progress(Number(p.percent), p.step);
      });

      es.addEventListener('log', (e) => {
        let p;
        try { p = JSON.parse(e.data); } catch { return; }
        if (p && p.text) _log(p.text);
      });

      es.addEventListener('done', (e) => {
        let d;
        try { d = JSON.parse(e.data); } catch { d = {}; }
        _progress(100, 'Finished');
        _log('The refresh finished successfully.');
        _finishStream({ ok: true, data: d });
      });

      es.addEventListener('error', (e) => {
        let payload = null;
        try { payload = e.data ? JSON.parse(e.data) : null; } catch { payload = null; }
        if (payload && payload.error) {
          _log(_refusalMessage(payload.error, payload.message));
          _finishStream({ ok: false, message: payload.message });
          return;
        }
        if (payload && payload.message) {
          _log(payload.message);
          _finishStream({ ok: false, message: payload.message });
          return;
        }
        // Network disconnect without a parsed error event.
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

    q('[data-refresh-start]').addEventListener('click', () => startStream());
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

    if (dsModal && typeof dsModal.openDsModal === 'function') {
      dsModal.openDsModal(overlay, { dismissible: false });
    } else {
      overlay.hidden = false;
    }
  });
}
