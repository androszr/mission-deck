// ── Mission Deck — js/sync-log-modal.js ───────────────────────────────────
// Generic sync-log modal: opens in a spinner state, then populates a timestamped
// step-by-step log from a single post-completion HTTP response. Written generic
// (title + steps in, no repo/endpoint coupling) so any push/pull-style sync flow
// can reuse it. Currently wired to a data source "Send" (push) button
// only — see js/store-data-sync.js.
//
// Markup is GLOBAL in index.html (#sync-log-modal), outside any view-section, so
// it renders regardless of the active view (mirrors js/costs-refresh-modal.js).

import { openDsModal, closeDsModal } from './ds-modal.js';

let _wired = false;
let _autoCloseTimer = null;
let _lastLogText = '';

const STATUS_LABEL = { ok: 'OK', skip: 'SKIP', fail: 'FAIL' };
const STATUS_BADGE = { ok: 'ds-badge--green', skip: 'ds-badge--gray', fail: 'ds-badge--red' };

function _escHtml(s) {
  return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _clearAutoClose() {
  if (_autoCloseTimer) {
    clearTimeout(_autoCloseTimer);
    _autoCloseTimer = null;
  }
}

// ── Open / close ─────────────────────────────────────────────────────────────

export function openSyncLogModal({ title } = {}) {
  const overlay = document.getElementById('sync-log-modal');
  if (!overlay) return null;
  _wireOnce(overlay);
  _clearAutoClose();
  _lastLogText = '';

  const titleEl = document.getElementById('slm-title');
  if (titleEl) titleEl.textContent = title || 'Sync';

  const spinner = document.getElementById('slm-spinner');
  if (spinner) spinner.hidden = false;
  const bannerWrap = document.getElementById('slm-banner');
  if (bannerWrap) bannerWrap.innerHTML = '';
  const logWrap = document.getElementById('slm-log');
  if (logWrap) logWrap.innerHTML = '';
  const extraWrap = document.getElementById('slm-extra');
  if (extraWrap) { extraWrap.innerHTML = ''; extraWrap.hidden = true; }
  const copyBtn = document.getElementById('slm-copy');
  if (copyBtn) {
    copyBtn.hidden = true;
    copyBtn.textContent = 'Copy log';
  }
  const actionsWrap = document.getElementById('slm-actions');
  if (actionsWrap) { actionsWrap.innerHTML = ''; actionsWrap.hidden = true; }

  openDsModal(overlay);

  return { overlay, title: title || 'Sync' };
}

export function closeSyncLogModal(handle) {
  _clearAutoClose();
  const overlay = (handle && handle.overlay) || document.getElementById('sync-log-modal');
  if (!overlay) return;
  closeDsModal(overlay);
}

function _wireOnce(overlay) {
  if (_wired) return;
  _wired = true;
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
  on('slm-x', () => closeSyncLogModal());
  on('slm-close', () => closeSyncLogModal());
  on('slm-copy', _handleCopy);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeSyncLogModal(); });
}

// ── Extra content slot (conflict diff preview / AI merge proposal) ──────────

// Replaces the contents of #slm-extra with a single element (or clears + hides
// it when el is null/undefined). Used by js/store-conflict-resolver.js to host
// the conflict-markers diff preview and AI-merge proposal review UI.
export function setSyncLogExtra(_handle, el) {
  const extraWrap = document.getElementById('slm-extra');
  if (!extraWrap) return;
  extraWrap.innerHTML = '';
  if (el) {
    extraWrap.appendChild(el);
    extraWrap.hidden = false;
  } else {
    extraWrap.hidden = true;
  }
}

// ── Populate from response ───────────────────────────────────────────────────

export function renderSyncLogSteps(handle, res, { actions } = {}) {
  const overlay = (handle && handle.overlay) || document.getElementById('sync-log-modal');
  if (!overlay) return;
  const title = (handle && handle.title) || 'Sync';
  const data = res || {};
  const steps = Array.isArray(data.steps) ? data.steps : [];

  // New renders start clean — conflict-diff / AI-merge extras from a previous
  // response must not linger under the fresh step log.
  setSyncLogExtra(handle, null);

  const spinner = document.getElementById('slm-spinner');
  if (spinner) spinner.hidden = true;

  const logWrap = document.getElementById('slm-log');
  if (logWrap) {
    if (!steps.length) {
      logWrap.innerHTML = '<div class="sync-log-modal__row sync-log-modal__row--empty">No detailed log for this operation.</div>';
    } else {
      logWrap.innerHTML = steps.map(s => {
        const time = s.ts ? new Date(s.ts).toLocaleTimeString('en-GB') : '';
        const badgeClass = STATUS_BADGE[s.status] || 'ds-badge--gray';
        const label = STATUS_LABEL[s.status] || (s.status || '').toUpperCase();
        const rowClass = s.status === 'fail' ? ' sync-log-modal__row--fail' : '';
        return `<div class="sync-log-modal__row${rowClass}">
          <span class="sync-log-modal__row-time">${_escHtml(time)}</span>
          <span class="sync-log-modal__row-label">${_escHtml(s.step)}${s.detail ? `<span class="sync-log-modal__row-detail">${_escHtml(s.detail)}</span>` : ''}</span>
          <span class="ds-badge ds-badge--sm ${badgeClass}">${_escHtml(label)}</span>
        </div>`;
      }).join('');
    }
  }

  const bannerWrap = document.getElementById('slm-banner');
  const copyBtn = document.getElementById('slm-copy');

  if (data.ok) {
    if (bannerWrap) {
      bannerWrap.innerHTML = '<div class="ds-callout ds-callout--success sync-log-modal__banner sync-log-modal__banner--success">Sync finished successfully</div>';
    }
  } else {
    const failStep = steps.find(s => s.status === 'fail');
    const failLabel = (failStep && failStep.step) || data.error || 'Unknown step';
    const failDetail = data.message && data.message !== failLabel ? ` — ${_escHtml(data.message)}` : '';
    if (bannerWrap) {
      bannerWrap.innerHTML = `
        <div class="ds-callout ds-callout--danger sync-log-modal__banner sync-log-modal__banner--error">
          Sync error: ${_escHtml(failLabel)}${failDetail}
        </div>
        <div class="ds-callout ds-callout--warning sync-log-modal__banner sync-log-modal__banner--robert">
          If something failed, send the log to the repository admin (the "Copy log" button).
        </div>`;
    }
  }
  if (copyBtn) copyBtn.hidden = false;

  const actionsWrap = document.getElementById('slm-actions');
  if (actionsWrap) {
    if (!data.ok && Array.isArray(actions) && actions.length) {
      actionsWrap.innerHTML = '';
      for (const act of actions) {
        const btn = document.createElement('button');
        btn.className = `ds-btn ds-btn--sm ${act.danger ? 'ds-btn--danger' : 'ds-btn--secondary'}`;
        btn.textContent = act.label;
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          const orig = btn.textContent;
          btn.textContent = 'Working...';
          try {
            await act.handler();
          } finally {
            btn.disabled = false;
            btn.textContent = orig;
          }
        });
        actionsWrap.appendChild(btn);
      }
      actionsWrap.hidden = false;
    } else {
      actionsWrap.innerHTML = '';
      actionsWrap.hidden = true;
    }
  }

  _lastLogText = _buildLogText(title, data, steps);
}

// ── Copy to clipboard ────────────────────────────────────────────────────────

// Exported for unit testing (tests/test_sync_log_modal.mjs) — pure function,
// no document access.
export function _buildLogText(title, data, steps) {
  const lines = [title, ''];
  for (const s of steps) {
    const time = s.ts ? new Date(s.ts).toLocaleTimeString('en-GB') : '';
    const status = (STATUS_LABEL[s.status] || s.status || '').toUpperCase();
    lines.push(`${time} [${status}] ${s.step}${s.detail ? ' - ' + s.detail : ''}`);
    if (s.cmd) lines.push(`  $ ${s.cmd}`);
    if (s.output) {
      for (const ln of s.output.split('\n')) lines.push(`  > ${ln}`);
    }
  }
  lines.push('');
  lines.push(data.ok ? 'Result: OK' + (data.message ? ' - ' + data.message : '') : 'Result: ERROR' + (data.message || data.error ? ' - ' + (data.message || data.error) : ''));
  return lines.join('\n');
}

function _handleCopy() {
  const btn = document.getElementById('slm-copy');
  if (!btn) return;
  const origLabel = 'Copy log';
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    btn.textContent = 'Copy unavailable';
    setTimeout(() => { btn.textContent = origLabel; }, 1500);
    return;
  }
  navigator.clipboard.writeText(_lastLogText).then(() => {
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = origLabel; }, 1500);
  }).catch(() => {
    btn.textContent = 'Copy unavailable';
    setTimeout(() => { btn.textContent = origLabel; }, 1500);
  });
}
