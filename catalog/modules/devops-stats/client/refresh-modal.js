// modules/devops-stats/client/refresh-modal.js
// The "Refresh" window: a confirm step (freshness line, choice between the
// incremental and the full fetch) then a progress step over
// GET /refresh-stream, SSE events start|progress|log|done|error. Not
// dismissible while a stream runs (opts.dismissible: false). The EventSource
// is closed on done/error and on view teardown - never left to auto-reconnect,
// a reconnect would start a second refresh.
//
// js/ds-modal.js is never imported here (it needs a browser document and a /js/ URL
// resolver); the caller passes the loaded namespace in.

export const ERROR_MESSAGES = {
  'test-mode': 'Refresh is disabled in test mode.',
  busy: 'A refresh is already running - wait for it to finish.',
  'no-token': 'No Jira token. Unlock the vault (Settings > Keys) and try again.',
  'data-missing': 'The team data source is missing - pull it in the Sync window.',
  'etl-failed': 'Fetching from Jira failed.',
  'etl-invalid': 'The Jira data failed validation - nothing saved.',
  'etl-empty': 'Jira returned no issues - nothing saved.',
};

/** User-facing message for an SSE error payload. */
export function errorMessage(payload) {
  if (payload && ERROR_MESSAGES[payload.error]) return ERROR_MESSAGES[payload.error];
  return (payload && payload.message) || 'Refresh failed.';
}

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
 * Opens the refresh window. Resolves once it is closed with
 * `{ ok, ranStream }`.
 * @param {{apiBase: string, overview: object, dsModal: object|null,
 *   registerViewCleanup?: Function, onDone?: Function}} opts
 */
export function openRefreshModal({ apiBase, overview, dsModal, registerViewCleanup, onDone }) {
  const generatedAt = overview && overview.index && overview.index.generated_at;
  const hasIndex = !!(overview && overview.index);

  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="ds-modal ds-modal--md devops-stats-refresh-modal" role="dialog" aria-modal="true">
      <div class="ds-modal-header"><span class="ds-modal-title">Refreshing DEVOPS Stats</span></div>
      <div class="ds-modal-body">
        <div class="devops-stats-refresh-step" data-step="confirm">
          <div>Data from: ${_esc(_fmtDate(generatedAt))}</div>
          <div class="devops-stats-refresh-hint">${hasIndex
    ? '"Refresh changes" fetches only the issues changed since the last refresh. "Fetch everything again" reads a whole year from Jira and takes longer.'
    : 'This is the first fetch - a whole year will be read from Jira, which can take a few minutes.'}</div>
        </div>
        <div class="devops-stats-refresh-step" data-step="progress" hidden>
          <div class="ds-progress">
            <div class="ds-progress-labels"><span class="devops-stats-refresh-step-label">Starting...</span><span class="devops-stats-refresh-percent">0%</span></div>
            <div class="ds-progress-track"><div class="ds-progress-fill ds-progress-fill--brand devops-stats-refresh-fill" style="width:0%"></div></div>
          </div>
          <div class="devops-stats-refresh-log" aria-live="polite"></div>
        </div>
      </div>
      <div class="ds-modal-footer" data-footer="confirm">
        <button type="button" class="ds-btn ds-btn--primary" data-refresh-incremental>Refresh changes</button>
        <button type="button" class="ds-btn ds-btn--secondary" data-refresh-full>Fetch everything again</button>
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
  const stepLabel = q('.devops-stats-refresh-step-label');
  const percentLabel = q('.devops-stats-refresh-percent');
  const fillEl = q('.devops-stats-refresh-fill');
  const logEl = q('.devops-stats-refresh-log');
  const closeBtn = q('[data-refresh-close]');

  let es = null;
  let finished = false;
  let lastOk = false;

  function _log(text) {
    const row = document.createElement('div');
    row.className = 'devops-stats-refresh-log-line';
    row.textContent = text;
    logEl.appendChild(row);
    while (logEl.children.length > 200) logEl.removeChild(logEl.firstChild);
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

  return new Promise((resolveRaw) => {
    // Every exit (cancel, close, view teardown) resolves exactly once, so the
    // caller's `finally` always resets its busy flag.
    let settled = false;
    function resolve(result) {
      if (settled) return;
      settled = true;
      resolveRaw(result);
    }

    function _finishStream(result) {
      if (finished) return;
      finished = true;
      lastOk = !!result.ok;
      if (es) { try { es.close(); } catch { /* already closed */ } es = null; }
      if (!result.ok) {
        fillEl.classList.remove('ds-progress-fill--brand');
        fillEl.classList.add('ds-progress-fill--red');
      }
      closeBtn.disabled = false;
      closeBtn.focus();
      if (result.ok && typeof onDone === 'function') onDone(result.data);
    }

    function startStream(full) {
      confirmStep.hidden = true;
      progressStep.hidden = false;
      confirmFooter.hidden = true;
      progressFooter.hidden = false;
      _log('Refresh started' + (full ? ' (full fetch).' : '.'));
      try {
        es = new EventSource(apiBase + '/refresh-stream' + (full ? '?full=1' : ''));
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
        _log('Refresh finished: ' + (d.issues || 0) + ' issues, files written: ' + (d.written || 0) + '.');
        _finishStream({ ok: true, data: d });
      });
      es.addEventListener('error', (e) => {
        let payload = null;
        try { payload = e.data ? JSON.parse(e.data) : null; } catch { payload = null; }
        if (payload) {
          _log(errorMessage(payload));
          if (Array.isArray(payload.tail)) payload.tail.slice(-5).forEach((l) => _log(String(l)));
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
    q('[data-refresh-incremental]').addEventListener('click', () => startStream(false));
    q('[data-refresh-full]').addEventListener('click', () => startStream(true));
    closeBtn.addEventListener('click', () => {
      if (!finished) return;
      _close();
      resolve({ ok: lastOk, ranStream: true });
    });

    if (typeof registerViewCleanup === 'function') {
      registerViewCleanup(() => {
        const ranStream = finished || es !== null;
        if (es) { try { es.close(); } catch { /* already closed */ } es = null; }
        if (overlay.isConnected) _close();
        resolve({ ok: finished && lastOk, ranStream });
      });
    }

    if (dsModal && typeof dsModal.openDsModal === 'function') dsModal.openDsModal(overlay, { dismissible: false });
    else { overlay.hidden = false; overlay.classList.add('open'); }
  });
}
