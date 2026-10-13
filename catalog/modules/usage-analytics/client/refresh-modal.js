// modules/usage-analytics/client/refresh-modal.js
// "Refresh" progress window: checks GET /status first (test mode, keys,
// storage, busy -> a callout, no stream), then streams
// GET /refresh-stream (SSE). The EventSource is closed on done/error and in
// the view cleanup - a browser auto-reconnect would start a second fetch.

let _dsModal = null;

async function _loadDsModal() {
  if (_dsModal) return _dsModal;
  try { _dsModal = await import('/js/ds-modal.js'); } catch { _dsModal = null; }
  return _dsModal;
}

function _esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Why a refresh cannot start, from a /status payload; null when it can.
 * Pure - used by the view (to disable the button) and by the modal.
 */
export function refreshBlocker(st) {
  if (!st) return { kind: 'warning', text: 'Could not check the refresh state. Try again in a moment.' };
  if (st.testMode) return { kind: 'info', text: 'Refreshing is disabled in test mode.' };
  if (st.storage !== 'ok') {
    return { kind: 'warning', text: 'Team data is unavailable - check the Sync panel (the data-tier-0 repository must be cloned and decrypted).' };
  }
  if (!st.keysPresent) {
    return { kind: 'warning', text: 'The Amplitude keys (Mission Deck project) are missing. Unlock the vault in Settings > Keys and try again.' };
  }
  if (st.busy) return { kind: 'info', text: 'A refresh is already running - wait for it to finish.' };
  return null;
}

function _calloutHtml(kind, text) {
  return '<div class="ds-callout ds-callout--' + kind + '"><div>' + _esc(text) + '</div></div>';
}

/**
 * @param {{apiBase: string, registerViewCleanup: Function}} opts
 * @returns {Promise<object>} done/error payload ({ok, ...}); never throws.
 */
export async function openRefreshModal({ apiBase, registerViewCleanup }) {
  const dsModal = await _loadDsModal();

  let status = null;
  try {
    const r = await fetch(apiBase + '/status', { cache: 'no-store' });
    status = r.ok ? await r.json() : null;
  } catch { status = null; }
  const blocker = refreshBlocker(status);

  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay usage-analytics-modal';
  overlay.hidden = true;
  overlay.innerHTML = '<div class="ds-modal ds-modal--md" role="dialog" aria-modal="true"'
    + ' aria-labelledby="usage-analytics-refresh-title">'
    + '<div class="ds-modal-header"><span class="ds-modal-title" id="usage-analytics-refresh-title">'
    + 'Refreshing data from Amplitude</span></div>'
    + '<div class="ds-modal-body">'
    + (blocker
      ? _calloutHtml(blocker.kind, blocker.text)
      : '<p class="usage-analytics-note">The first fetch can take more than ten minutes'
        + ' (about 15 s per day of history), later ones a few minutes. Do not close this window.</p>'
        + '<div class="ds-progress"><div class="ds-progress-labels">'
        + '<span class="usage-analytics-refresh-step">Start...</span>'
        + '<span class="usage-analytics-refresh-percent">0%</span></div>'
        + '<div class="ds-progress-track"><div class="ds-progress-fill ds-progress-fill--brand usage-analytics-refresh-fill"'
        + ' style="width:0%"></div></div></div>'
        + '<div class="usage-analytics-log" aria-live="polite"></div>')
    + '<div class="usage-analytics-refresh-summary" hidden></div>'
    + '</div>'
    + '<div class="ds-modal-footer"><button type="button" class="ds-btn ds-btn--primary usage-analytics-refresh-close"'
    + (blocker ? '' : ' disabled') + '>Close</button></div></div>';
  document.body.appendChild(overlay);

  const q = (sel) => overlay.querySelector(sel);
  const closeBtn = q('.usage-analytics-refresh-close');
  let finished = !!blocker;
  let es = null;
  // Settles a still-running stream when the view cleanup closes the modal, so the
  // caller's promise (and its "refreshing" flag) never hangs past navigation.
  let settlePending = null;

  const onKey = (e) => { if (e.key === 'Escape' && finished) close(); };
  function close() {
    if (settlePending) settlePending();
    if (es) { try { es.close(); } catch { /* closed */ } es = null; }
    if (dsModal) dsModal.closeDsModal(overlay);
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay && finished) close(); });
  closeBtn.addEventListener('click', () => { if (finished) close(); });
  if (typeof registerViewCleanup === 'function') registerViewCleanup(close);

  if (dsModal) dsModal.openDsModal(overlay, { dismissible: false });
  else overlay.hidden = false;
  closeBtn.focus();

  if (blocker) return { ok: false, error: 'blocked', message: blocker.text };

  const logEl = q('.usage-analytics-log');
  const stepEl = q('.usage-analytics-refresh-step');
  const percentEl = q('.usage-analytics-refresh-percent');
  const fillEl = q('.usage-analytics-refresh-fill');
  const summaryEl = q('.usage-analytics-refresh-summary');

  function log(text) {
    const row = document.createElement('div');
    row.textContent = text;
    logEl.appendChild(row);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function setProgress(pct, label) {
    if (typeof pct === 'number' && Number.isFinite(pct)) {
      const p = Math.max(0, Math.min(100, Math.round(pct)));
      fillEl.style.width = p + '%';
      percentEl.textContent = p + '%';
    }
    if (label) stepEl.textContent = label;
  }

  return new Promise((resolve) => {
    let settled = false;
    settlePending = () => {
      if (settled) return;
      settled = true;
      finished = true;
      if (es) { try { es.close(); } catch { /* closed */ } es = null; }
      resolve({ ok: false, error: 'closed', message: 'The refresh window was closed.' });
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      finished = true;
      if (es) { try { es.close(); } catch { /* closed */ } es = null; }
      if (result.ok) {
        setProgress(100, 'Finished');
        summaryEl.innerHTML = _calloutHtml('success',
          'Done: fetched ' + (result.daysFetched ?? 0) + ' days, kept '
          + (result.eventsKept ?? 0) + ' events. For the team to see the new numbers, send the data with "Send" in the top bar.');
      } else {
        stepEl.textContent = 'Error';
        fillEl.classList.remove('ds-progress-fill--brand');
        fillEl.classList.add('ds-progress-fill--red');
        summaryEl.innerHTML = _calloutHtml(result.error === 'busy' ? 'info' : 'danger',
          result.message || 'Could not refresh the data.');
      }
      summaryEl.hidden = false;
      closeBtn.disabled = false;
      closeBtn.focus();
      resolve(result);
    };

    try {
      es = new EventSource(apiBase + '/refresh-stream');
    } catch (_err) {
      finish({ ok: false, error: 'error', message: 'Could not open the connection.' });
      return;
    }
    es.addEventListener('log', (e) => {
      let p; try { p = JSON.parse(e.data); } catch { return; }
      if (p && p.text) log(p.text);
    });
    es.addEventListener('progress', (e) => {
      let p; try { p = JSON.parse(e.data); } catch { return; }
      if (p) setProgress(p.percent, p.step ? String(p.step) : null);
    });
    es.addEventListener('done', (e) => {
      let d; try { d = JSON.parse(e.data); } catch { d = {}; }
      finish({ ...d, ok: d.ok !== false });
    });
    // 'error' is both a server frame (with data) and a dropped connection.
    es.addEventListener('error', (e) => {
      let payload = null;
      try { payload = e.data ? JSON.parse(e.data) : null; } catch { payload = null; }
      if (payload) { finish({ ...payload, ok: false }); return; }
      finish({ ok: false, error: 'disconnected',
        message: 'Connection lost - the refresh was stopped and will not restart on its own. Try again.' });
    });
  });
}
