// ── Mission Deck — js/sub-repo-sync-stream.js ─────────────────────────
// Shared SSE progress runner for streamed data-repo sync operations
// (currently data-tier-0's pull-stream / clone-stream / push-stream /
// pull-overwrite-stream). Drives a generic progress modal built on
// js/ds-modal.js while the stream is open, then swaps to the shared
// js/sync-log-modal.js for the result and, on failure, a set of recovery
// actions matched to the server's error taxonomy in classifyGitError.
//
// No AI merge assistant here by design (interview decision, see the plan's
// "Out of scope"): every action below either merges, overwrites, discards or
// aborts - none of them call a chat model.

import { showToast } from './toast.js';
import { openSyncLogModal, renderSyncLogSteps, closeSyncLogModal, setSyncLogExtra } from './sync-log-modal.js';
import { renderConflictDiff } from './store-conflict-resolver.js';
import { trackEvent } from './analytics.js';
import { openDsModal, closeDsModal } from './ds-modal.js';
import { startLoadingAnimation } from './loading-animations.js';
import { emitDataChanged } from './data-events.js';
import { connectionLostOutcome, streamErrorPayload } from './sync-stream-helpers.mjs';

// ── Error-category -> user-facing message map ────────────────────────────────────
// Every category the streamed endpoints (and classifyGitError / the five
// encryption error codes) can emit is listed here with a safe fallback -
// a server category with no entry below still degrades to a generic sentence
// instead of throwing.
function _formatLockRemaining(data) {
  const ageMs = data.lockAgeMs || 0;
  const maxMs = data.lockMaxMs || 600000;
  const remainMs = Math.max(0, maxMs - ageMs);
  const remainMin = Math.ceil(remainMs / 60000);
  if (remainMin <= 1) return 'Sync in progress - it should finish any moment.';
  return `Sync in progress - the lock expires automatically in ${remainMin} min.`;
}

export function formatSyncStreamError(data) {
  const info = data || {};
  const map = {
    'not-configured': 'The repository is not configured.',
    'no-access': 'No access to the repository.',
    'auth-expired': 'The token expired or was revoked - update it in Settings.',
    'network': 'Network error - check your connection.',
    'timeout': info.message || 'The git operation timed out - try again.',
    'conflict': info.message || 'Change conflict - resolve it by hand.',
    'autostash-conflict': info.message || 'Your local changes collided with the team changes - nothing was sent or overwritten. Choose which version to keep.',
    'stash-missing': info.message || 'No copy of your changes was found in the repository stash - nothing was changed.',
    'conflict-markers': info.message || 'The files contain git conflict markers. Resolve the conflicts by hand.',
    'locked': _formatLockRemaining(info),
    'no-write-token': info.message || 'No token with write permission.',
    'aborted': info.message || 'Operation cancelled.',
    'abort-would-lose': info.message || 'Cancelling would delete local commits - use the safe merge.',
    'detached-head': info.message || 'HEAD is detached - click "Repair branch".',
    'rejected': info.message || 'The server refused the push - someone else pushed changes first. Merge the remote changes and try again.',
    'no-repo-url': info.message || 'No repository URL in the configuration.',
    'ssh-url': info.message || 'The repository URL uses SSH, which this app does not support.',
    'fs-error': info.message || 'File system error during an operation on the data folder.',
    // Five encryption categories from stage C (fail-closed - none of them
    // left anything written to disk).
    'key-missing': info.message || 'No encryption key (DATA_ENCRYPTION_KEY) - sync paused.',
    'key-invalid': info.message || 'The encryption key (DATA_ENCRYPTION_KEY) is invalid - sync paused.',
    'decrypt-failed': info.message || 'Could not decrypt the data - the local files were left unchanged.',
    'decrypt-destructive': info.message || 'Decrypting would delete most files - operation paused. Check that the encrypted repository is complete.',
    'encrypt-failed': info.message || 'Could not encrypt the data - nothing was sent.',
    'encrypt-destructive': info.message || 'Encrypting would delete team data from the mirror - operation paused. Decrypt the downloaded data first.',
    'error': info.message || 'Git error - check the server logs.',
  };
  return map[info.error] || (info.message || 'Unknown error.');
}

// ── Recovery actions rendered in the sync-log modal footer on failure ───────
// ctx: { repoBase, modalHandle, loadData, refreshStatus, render, repairDetachedHeadUrl }
export function buildSyncErrorActions(data, ctx) {
  if (!data || data.ok) return [];
  const { repoBase, modalHandle, loadData, refreshStatus, render, repairDetachedHeadUrl } = ctx || {};
  const actions = [];

  const _afterAction = async (variant, title, desc) => {
    closeSyncLogModal(modalHandle);
    if (typeof refreshStatus === 'function') { try { await refreshStatus(); } catch { /* ignore */ } }
    if (typeof render === 'function') render();
    showToast(variant, title, desc || '');
  };

  if (data.error === 'conflict' || data.error === 'rejected') {
    actions.push({
      label: 'Merge remote changes',
      handler: async () => {
        const r = await fetch(`/api/${repoBase}/pull`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        const d = await r.json().catch(() => ({}));
        if (d.ok) {
          if (typeof loadData === 'function') await loadData(true);
          await _afterAction('success', 'Merged', 'Try sending again.');
        } else {
          showToast('error', 'Merge failed', formatSyncStreamError(d));
        }
      },
    });
    actions.push({
      label: 'Overwrite my changes',
      danger: true,
      handler: async () => {
        const r = await fetch(`/api/${repoBase}/pull-overwrite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const d = await r.json().catch(() => ({}));
        if (d.ok) {
          if (typeof loadData === 'function') await loadData(true);
          await _afterAction('success', 'Overwritten', 'Local changes were replaced with the remote version.');
        } else {
          showToast('error', 'Overwrite failed', formatSyncStreamError(d));
        }
      },
    });
  }

  if (data.error === 'conflict-markers') {
    actions.push({
      label: 'Accept remote',
      danger: true,
      handler: async () => {
        const r = await fetch(`/api/${repoBase}/resolve-conflicts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ strategy: 'theirs' }),
        });
        const d = await r.json().catch(() => ({}));
        if (d.ok) {
          if (typeof loadData === 'function') await loadData(true);
          await _afterAction('success', 'Conflicts resolved', d.message || '');
        } else {
          showToast('error', 'Resolution failed', d.message || formatSyncStreamError(d));
        }
      },
    });
    actions.push({
      label: 'Cancel merge',
      handler: async () => {
        const r = await fetch(`/api/${repoBase}/rebase-abort`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const d = await r.json().catch(() => ({}));
        if (d.ok) {
          await _afterAction('success', 'Merge cancelled', d.message || '');
        } else if (d.error === 'abort-would-lose') {
          const r2 = await fetch(`/api/${repoBase}/recover-rebase`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
          const d2 = await r2.json().catch(() => ({}));
          if (d2.ok) {
            if (typeof loadData === 'function') await loadData(true);
            await _afterAction('success', 'Repaired', d2.message || '');
          } else {
            showToast('error', 'Repair failed', d2.message || formatSyncStreamError(d2));
          }
        } else {
          showToast('error', 'Cancelling failed', d.message || formatSyncStreamError(d));
        }
      },
    });
  }

  // An autostash conflict (server.js _repoAutostashConflict) blocks every
  // pull and push of the source until one side is chosen for the conflicted
  // files. Neither choice is the default and neither is "danger": the other
  // version stays in the mirror's stash either way.
  if (data.error === 'autostash-conflict') {
    const resolve = (keep, okTitle) => async () => {
      const r = await fetch(`/api/${repoBase}/resolve-autostash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep }),
      });
      const d = await r.json().catch(() => ({}));
      if (d.ok) {
        // The plaintext was just decrypted: every view showing this source
        // repaints, the same as after a successful pull.
        emitDataChanged({ repo: String(repoBase || '').replace(/^data\//, ''), op: 'resolve-autostash' });
        if (typeof loadData === 'function') await loadData(true);
        await _afterAction('success', okTitle, d.message || '');
      } else {
        showToast('error', 'Could not resolve the conflict', formatSyncStreamError(d));
      }
    };
    actions.push({ label: 'Keep my versions', handler: resolve('mine', 'Your versions were kept') });
    actions.push({ label: 'Take the team versions', handler: resolve('team', 'The team versions were accepted') });
  }

  // Detached HEAD - the action only renders when the caller supplies a
  // repair URL (today only data-tier-0 has this server-side route).
  if (data.error === 'detached-head' && repairDetachedHeadUrl) {
    actions.push({
      label: 'Repair branch',
      handler: async () => {
        const r = await fetch(repairDetachedHeadUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const d = await r.json().catch(() => ({}));
        if (d.ok) {
          await _afterAction('success', 'Repaired', d.message || 'Try again.');
        } else {
          showToast('error', 'Repair failed', d.message || 'Repairing the branch failed.');
        }
      },
    });
  }

  if (data.error === 'error' || data.error === 'network') {
    actions.push({
      label: 'Merge remote changes',
      handler: async () => {
        const r = await fetch(`/api/${repoBase}/pull`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
        const d = await r.json().catch(() => ({}));
        if (d.ok) {
          if (typeof loadData === 'function') await loadData(true);
          await _afterAction('success', 'Merged', 'Try sending again.');
        } else {
          showToast('error', 'Merge failed', formatSyncStreamError(d));
        }
      },
    });
  }

  return actions;
}

// ── Live progress modal (during the SSE operation) ──────────────────────────
// Built entirely on js/ds-modal.js: ds-modal-overlay / ds-modal / header /
// body / footer. The `ips-*` classes below style ONLY the progress bar and
// the step list inside the body - never the overlay/header/footer shell.

function _buildProgressModal({ op, encrypted, onCancel }) {
  const title = op === 'push' ? 'Sending data...' : 'Fetching data...';

  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.hidden = true;

  const modal = document.createElement('div');
  modal.className = 'ds-modal';

  const header = document.createElement('div');
  header.className = 'ds-modal-header';
  const titleSpan = document.createElement('span');
  titleSpan.className = 'ds-modal-title';
  titleSpan.textContent = title;
  header.appendChild(titleSpan);

  const body = document.createElement('div');
  body.className = 'ds-modal-body';

  let animEl = null;
  if (encrypted) {
    animEl = document.createElement('div');
    animEl.className = 'ips-anim';
    body.appendChild(animEl);

    const stepsEl = document.createElement('div');
    stepsEl.className = 'ips-steps';
    body.appendChild(stepsEl);
  }

  const phaseLabel = document.createElement('div');
  phaseLabel.className = 'ips-phase-label';
  phaseLabel.textContent = 'Initializing';

  const bar = document.createElement('div');
  bar.className = 'ips-bar';
  const barFill = document.createElement('div');
  barFill.className = 'ips-bar-fill';
  bar.appendChild(barFill);

  const counter = document.createElement('div');
  counter.className = 'ips-counter';

  body.appendChild(phaseLabel);
  body.appendChild(bar);
  body.appendChild(counter);

  const footer = document.createElement('div');
  footer.className = 'ds-modal-footer';

  const footerNote = document.createElement('span');
  footerNote.className = 'ds-hint';
  footerNote.textContent = 'Sync in progress - do not close the window.';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'ds-btn ds-btn--secondary ds-btn--sm';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => onCancel());

  footer.appendChild(footerNote);
  footer.appendChild(cancelBtn);

  modal.appendChild(header);
  modal.appendChild(body);
  modal.appendChild(footer);
  overlay.appendChild(modal);

  document.body.appendChild(overlay);
  openDsModal(overlay);
  // Start the canvas only after the overlay is attached and visible -
  // resizeScene() reads clientWidth/clientHeight, which are 0 on a hidden
  // node (js/update-modal.js does the same after openDsModal).
  if (animEl) overlay._ipsStopAnim = startLoadingAnimation(animEl, { minimal: true });
  return overlay;
}

function _updateProgressModal(overlay, payload) {
  if (!overlay) return;
  const phaseLabel = overlay.querySelector('.ips-phase-label');
  const counter = overlay.querySelector('.ips-counter');
  const barFill = overlay.querySelector('.ips-bar-fill');

  if (phaseLabel && payload.phase) phaseLabel.textContent = payload.phase;
  if (counter) {
    if (typeof payload.current === 'number' && typeof payload.total === 'number' && payload.total > 0) {
      counter.textContent = `${payload.current} / ${payload.total}`;
    } else if (typeof payload.current === 'number') {
      counter.textContent = String(payload.current);
    }
  }
  if (barFill && typeof payload.pct === 'number') {
    barFill.style.setProperty('--ips-pct', payload.pct + '%');
  }
}

// Single teardown path - called on completion, on a server error AND on
// "Cancel", so the EventSource and the loading animation never outlive the
// modal on any of the three routes.
function _teardownSyncModal(overlay, es) {
  if (es) { try { es.close(); } catch { /* already closed */ } }
  if (!overlay) return;
  if (typeof overlay._ipsStopAnim === 'function') {
    try { overlay._ipsStopAnim(); } catch { /* ignore */ }
  }
  closeDsModal(overlay);
  overlay.remove();
}

// ── Live step-log rows (encrypted repos only) ────────────────────────────────
// Each server `log` event marks the START of a stage, so the previous row is
// downgraded to --done the moment the next one arrives; the last row is
// resolved to --done/--fail by _finishSyncSteps() once the stream terminates.
const _IPS_CHECK_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>';
const _IPS_FAIL_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" width="12" height="12" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';

export function _appendSyncStepRow(overlay, text) {
  if (!overlay) return;
  const stepsEl = overlay.querySelector('.ips-steps');
  if (!stepsEl) return; // non-encrypted modal has no step list - no-op

  const prev = overlay._ipsActiveRow;
  if (prev) {
    prev.className = 'ips-step ips-step--done';
    const prevIcon = prev.querySelector('.ips-step-icon');
    if (prevIcon) prevIcon.innerHTML = _IPS_CHECK_SVG;
  }

  const row = document.createElement('div');
  row.className = 'ips-step ips-step--active';
  const icon = document.createElement('span');
  icon.className = 'ips-step-icon';
  const label = document.createElement('span');
  label.className = 'ips-step-label';
  label.textContent = text; // server-provided text - never innerHTML
  row.appendChild(icon);
  row.appendChild(label);
  stepsEl.appendChild(row);
  overlay._ipsActiveRow = row;
}

export function _finishSyncSteps(overlay, ok) {
  if (!overlay) return;
  const row = overlay._ipsActiveRow;
  if (!row) return;
  row.className = ok ? 'ips-step ips-step--done' : 'ips-step ips-step--fail';
  const icon = row.querySelector('.ips-step-icon');
  if (icon) icon.innerHTML = ok ? _IPS_CHECK_SVG : _IPS_FAIL_SVG;
  overlay._ipsActiveRow = null;
}

// `repoBase` is a URL-path prefix (e.g. `data/data-tier-0`), not an id - it
// carries whatever prefix the caller builds its recovery-action URLs from
// (see js/sync-center-modal.js). Analytics and renderConflictDiff() need the
// bare registry id (`data-tier-0`), so every consumer of that id goes
// through this helper instead of assuming `repoBase` has no prefix.
function _repoIdFromBase(repoBase) {
  const s = String(repoBase || '');
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}

// Shows an "Open MR" link (or a warning when MR creation failed) in the
// sync-log modal's extra slot. data-tier-0 does not emit mrUrl/mrError today -
// this is a no-op for it and only activates if a future repo does.
export function _applyMrLink(modalHandle, data) {
  if (data.mrUrl && /^https:\/\//i.test(String(data.mrUrl))) {
    const wrap = document.createElement('div');
    const link = document.createElement('a');
    link.href = String(data.mrUrl);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.className = 'ds-btn ds-btn--secondary ds-btn--sm';
    link.addEventListener('click', e => e.stopPropagation());
    const labelText = data.mrIsNew ? 'Open new MR' : 'Open MR';
    const iidNum = Number(data.mrIid);
    link.textContent = Number.isFinite(iidNum) ? `${labelText} !${iidNum}` : labelText;
    wrap.appendChild(link);
    setSyncLogExtra(modalHandle, wrap);
  } else if (data.mrError) {
    const code = String(data.mrError);
    const msg = code === 'http-403'
      ? 'The MR was not created (the token lacks the api scope).'
      : `The MR was not created: ${code.replace(/[^A-Za-z0-9._-]/g, '')}`;
    const wrap = document.createElement('div');
    wrap.className = 'ds-callout ds-callout--warning';
    wrap.innerHTML = `<div>${msg}</div>`;
    setSyncLogExtra(modalHandle, wrap);
  }
}

// ── Main entry point ─────────────────────────────────────────────────────────
// Runs one streamed pull/push against `streamUrl`: opens the live progress
// modal, then on completion (done or error) swaps to the shared sync-log
// modal for the result and recovery actions.
//
// hooks:
//   title                 - sync-log modal title
//   repoBase              - URL-path prefix, e.g. 'data/data-tier-0', used to
//                           build recovery-action URLs (`/api/${repoBase}/pull`
//                           etc.) - use _repoIdFromBase() to get the bare id
//   setBusy(bool)         - flips the caller's busy flag
//   render()              - re-renders the caller's row/section
//   refreshStatus()       - re-fetches repo status, awaited
//   loadData              - optional, reloads view data after a successful sync
//   repairDetachedHeadUrl - optional repair-detached-head URL
//   encrypted             - true to show the live step log + illustration
//   inline                - optional { onLog(text, count), onProgress(p),
//                           onFinish(data) }. onProgress receives git's own
//                           clone progress (see _parseGitProgressLine in
//                           server.js) and is the ONLY way a caller sees it in
//                           inline mode; feed it through gitPhaseProgress().
//                           When present, no progress modal is built at all
//                           (so no "Cancel" either - the server op cannot be
//                           interrupted anyway); every `log` event calls
//                           onLog with the running count instead of a modal
//                           row, and a SUCCESSFUL finish skips the sync-log
//                           modal (toast only) - a failure still opens it,
//                           because that is the only path to the conflict
//                           diff and the recovery actions. The no-`inline`
//                           path below MUST stay byte-identical in behaviour:
//                           js/settings.js and js/onboarding-wizard.js call
//                           this function without it.
export function runSyncWithProgress(streamUrl, hooks) {
  const {
    title, repoBase, setBusy, render, refreshStatus, loadData, repairDetachedHeadUrl, encrypted, inline,
  } = hooks || {};

  const _startedAt = Date.now();
  const _operation = streamUrl.includes('push') ? 'push' : 'pull';
  const _repoId = _repoIdFromBase(repoBase);
  trackEvent('Data Repo Sync Started', { repo: _repoId, operation: _operation });

  if (typeof setBusy === 'function') setBusy(true);
  if (typeof render === 'function') render();

  return new Promise((resolveStream) => {
    let es;
    try {
      es = new EventSource(streamUrl);
    } catch (_e) {
      if (typeof setBusy === 'function') setBusy(false);
      const data = { ok: false, error: 'error', message: 'Could not open the connection.' };
      showToast('error', 'Sync failed', data.message);
      resolveStream(data);
      return;
    }

    const logSteps = [];
    const overlay = inline ? null : _buildProgressModal({
      op: _operation,
      encrypted,
      onCancel: () => {
        _teardownSyncModal(overlay, es);
        if (typeof setBusy === 'function') setBusy(false);
        if (typeof render === 'function') render();
        resolveStream({ ok: false, cancelled: true });
      },
    });

    es.addEventListener('progress', (e) => {
      let p;
      try { p = JSON.parse(e.data); } catch { return; }
      // Inline mode builds no overlay, so _updateProgressModal is a no-op
      // there and every git progress frame used to be dropped - which is
      // exactly where a clone is watched from (the sync table), and exactly
      // why a clone looked frozen for minutes.
      if (inline) {
        if (typeof inline.onProgress === 'function') {
          try { inline.onProgress(p); } catch { /* caller error must not break the stream */ }
        }
        return;
      }
      _updateProgressModal(overlay, p);
    });

    es.addEventListener('log', (e) => {
      let p;
      try { p = JSON.parse(e.data); } catch { return; }
      if (p && p.text) {
        const entry = { ts: new Date().toISOString(), step: p.text, status: p.status || 'ok' };
        if (p.detail) entry.detail = p.detail;
        logSteps.push(entry);
        _appendSyncStepRow(overlay, p.text);
        if (inline && typeof inline.onLog === 'function') {
          try { inline.onLog(p.text, logSteps.length); } catch { /* caller error must not break the stream */ }
        }
      }
    });

    let _finished = false;
    const _finish = async (data) => {
      if (_finished) return;
      _finished = true;
      trackEvent('Data Repo Sync Finished', {
        repo: _repoId,
        operation: _operation,
        outcome: data.ok ? 'success' : 'error',
        failure_reason: data.ok ? null : (data.error || 'error'),
        duration_ms: Date.now() - _startedAt,
      });
      if (typeof setBusy === 'function') setBusy(false);
      if (data.ok && typeof loadData === 'function') { try { await loadData(true); } catch { /* ignore */ } }
      if (typeof refreshStatus === 'function') { try { await refreshStatus(); } catch { /* ignore */ } }
      if (typeof render === 'function') render();
      // The plaintext tree on this disk may have just changed (a pull rewrites
      // it, a clone creates it, a push carries the pre-push pull's merge into
      // it). Announced ONCE here rather than at each call site, because this
      // is the single finish path of every streamed sync in the app - the sync
      // center, Settings and the wizard all land here. Only on success: a
      // failed run changed nothing worth repainting.
      if (data.ok) emitDataChanged({ repo: _repoId, op: _operation });
      _finishSyncSteps(overlay, data.ok);
      _teardownSyncModal(overlay, es);

      const _fireInlineFinish = () => {
        if (inline && typeof inline.onFinish === 'function') {
          try { inline.onFinish(data); } catch { /* caller error must not break the stream */ }
        }
      };

      const _quiet = Boolean(inline && inline.quiet);

      if (data.error === 'locked') {
        if (!_quiet) showToast('warning', 'Sync busy', _formatLockRemaining(data));
        _fireInlineFinish();
        resolveStream(data);
        return;
      }

      if (!data.ok && logSteps.length) {
        logSteps[logSteps.length - 1].status = 'fail';
      }

      // Inline mode swallows the sync-log modal only on SUCCESS - a toast is
      // enough there. A failure still needs the modal: it is the only path
      // to buildSyncErrorActions, the conflict diff and the MR link.
      //
      // `inline.quiet` is the exception, and it exists for a caller that is
      // ALREADY a modal and reports failures itself: "End of day" walks
      // eight sources in a row, so the failure path here would throw a second
      // modal (with pull / pull-overwrite / resolve-conflicts buttons) on top
      // of the running one while the loop keeps clearing underneath, and the
      // final summary would paint behind it. A quiet caller owns the report -
      // it gets the resolved `data` and puts the reason on its own row - and
      // that includes the SUCCESS toast: a chain of five pulls used to raise
      // five "Synced" toasts for one click,
      // each restating a row the caller had already painted.
      if (inline && (data.ok || _quiet)) {
        if (data.ok && !_quiet) showToast('success', 'Synced', data.message || '');
        _fireInlineFinish();
        resolveStream(data);
        return;
      }

      const modalHandle = openSyncLogModal({ title });
      const fullData = { ...data, steps: logSteps };
      const actions = buildSyncErrorActions(fullData, { repoBase, modalHandle, loadData, refreshStatus, render, repairDetachedHeadUrl });
      renderSyncLogSteps(modalHandle, fullData, { actions });
      if (data.error === 'conflict-markers') await renderConflictDiff(modalHandle, _repoId);
      _applyMrLink(modalHandle, data);

      if (data.ok) showToast('success', 'Synced', data.message || '');
      else showToast('error', 'Sync failed', formatSyncStreamError(data));
      _fireInlineFinish();
      resolveStream(data);
    };

    es.addEventListener('done', (e) => {
      let d;
      try { d = JSON.parse(e.data); } catch { d = {}; }
      _finish({ ok: true, ...d });
    });

    // 'open' fires once the server has answered; a transport error before it
    // means the run never started, after it the run is in flight without us.
    let _opened = false;
    es.addEventListener('open', () => { _opened = true; });

    es.addEventListener('error', (e) => {
      const payload = streamErrorPayload(e);

      if (payload) {
        _finish({ ok: false, ...payload });
      } else {
        // No payload = the transport died (VPN blip, laptop sleep, a server
        // restart mid-push). With readyState CONNECTING the browser is about
        // to re-issue the GET on its own, and for a mutating stream (push,
        // pull, clone) that queues a SECOND full operation behind the source's
        // lock - a push "from beyond" with nobody at the screen. The server
        // finishes the first run either way, so close here and say so - the
        // sentence lives in js/sync-stream-helpers.mjs, where the suite pins it.
        es.close();
        _finish(connectionLostOutcome(_opened));
      }
    });
  });
}
