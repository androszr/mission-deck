// ── Mission Deck — js/local-changes-modal.js ──────────────────────────
// "Local changes" modal opened from js/sync-center-modal.js. Fetches
// GET /api/data/<repoId>/local-changes (or the legacy /api/data-tier-0/local-changes
// when no repoId is given) and renders the dirty-file list (raw git porcelain
// status per file, own badge) - the endpoint returns only `{ path, status }`,
// never a diff or a modification time, so this is a list view, not a diff
// view. The footer "Discard changes" action discards every local change of THIS
// repoId via an in-modal confirmation (never window.confirm) and posts
// discard-local-changes for that same repoId - never a different row's.

import { openDsModal, closeDsModal } from './ds-modal.js';
import { escHtml } from './utils.js';
import { showToast } from './toast.js';
import { fetchLocalChanges, discardLocalChanges } from './data-tier-0-sync.js';

const MODAL_ID = 'local-changes-modal';

let _overlay = null;
let _currentRepoLabel = null;
let _currentRepoId = null;
let _currentOnDiscarded = null;

export function statusBadge(status) {
  switch (status) {
    case 'M': return { label: 'M', cls: 'ds-badge--yellow' };
    case 'A': return { label: 'A', cls: 'ds-badge--green' };
    case 'D': return { label: 'D', cls: 'ds-badge--red' };
    case '??': return { label: '??', cls: 'ds-badge--blue' };
    case 'R': return { label: 'R', cls: 'ds-badge--gray' };
    default: return { label: status, cls: 'ds-badge--gray' };
  }
}

// The listing re-encrypts the plaintext tree first, so it can fail the way a
// push fails: no key, or the destructive guard in encryptTree (a clone that was
// never decrypted). Those two carry their reason in the server message.
function _errorMessage(data) {
  const info = data || {};
  const error = typeof info === 'string' ? info : info.error;
  const message = typeof info === 'string' ? '' : (info.message || '');
  if (error === 'not-configured') return 'The repository is not configured.';
  if (error === 'git-status-failed') return 'Could not read the repository status.';
  if (error === 'encrypt-destructive') return message || 'The plaintext folder holds no decrypted team data - decrypt it first in the Sync panel.';
  if (error === 'key-missing') return message || 'No encryption key - add it in the "Start here" wizard (step 4).';
  return 'Could not fetch the list of local changes.';
}

function _ensureModal() {
  if (_overlay) return _overlay;

  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.id = MODAL_ID;
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="ds-modal" role="dialog" aria-modal="true" aria-labelledby="lcm-title">
      <div class="ds-modal-header">
        <span class="ds-modal-title" id="lcm-title">Local changes</span>
        <button type="button" class="ds-modal-close" id="lcm-x" aria-label="Close">&times;</button>
      </div>
      <div class="ds-modal-body">
        <div id="lcm-body"></div>
      </div>
      <div id="lcm-confirm" hidden style="padding:0 var(--space-16) var(--space-16)">
        <div class="ds-callout ds-callout--danger">
          <div>
            <strong>Are you sure?</strong> You will lose all local changes.
            <div style="display:flex;gap:8px;margin-top:8px">
              <button type="button" class="ds-btn ds-btn--danger ds-btn--sm" id="lcm-discard-confirm">Yes, discard</button>
              <button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" id="lcm-discard-cancel">Cancel</button>
            </div>
          </div>
        </div>
      </div>
      <div class="ds-modal-footer">
        <button type="button" class="ds-btn ds-btn--danger ds-btn--sm" id="lcm-discard" hidden>Discard changes</button>
        <button type="button" class="ds-btn ds-btn--tertiary" id="lcm-close">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => closeDsModal(overlay);
  overlay.querySelector('#lcm-x').addEventListener('click', close);
  overlay.querySelector('#lcm-close').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  overlay.querySelector('#lcm-discard').addEventListener('click', () => {
    overlay.querySelector('#lcm-confirm').hidden = false;
  });
  overlay.querySelector('#lcm-discard-cancel').addEventListener('click', () => {
    overlay.querySelector('#lcm-confirm').hidden = true;
  });
  overlay.querySelector('#lcm-discard-confirm').addEventListener('click', () => _confirmDiscard(overlay));

  _overlay = overlay;
  return overlay;
}

async function _confirmDiscard(overlay) {
  const confirmBtn = overlay.querySelector('#lcm-discard-confirm');
  const cancelBtn = overlay.querySelector('#lcm-discard-cancel');
  const origLabel = confirmBtn.textContent;
  confirmBtn.disabled = true;
  cancelBtn.disabled = true;
  confirmBtn.textContent = 'Discarding...';
  try {
    const data = await discardLocalChanges(_currentRepoId);
    if (data.ok) {
      closeDsModal(overlay);
      showToast('success', 'Changes discarded', `Local changes in ${_currentRepoLabel} were removed.`);
      try {
        await _currentOnDiscarded?.();
      } catch (refreshErr) {
        console.warn('local-changes-modal: onDiscarded refresh failed', refreshErr);
      }
    } else {
      overlay.querySelector('#lcm-confirm').hidden = true;
      overlay.querySelector('#lcm-body').insertAdjacentHTML(
        'afterbegin',
        `<div class="ds-callout ds-callout--warning"><div>${escHtml(data.message || 'Could not discard the changes.')}</div></div>`,
      );
    }
  } catch {
    overlay.querySelector('#lcm-confirm').hidden = true;
    overlay.querySelector('#lcm-body').insertAdjacentHTML(
      'afterbegin',
      '<div class="ds-callout ds-callout--warning"><div>Connection error with the server.</div></div>',
    );
  } finally {
    confirmBtn.disabled = false;
    cancelBtn.disabled = false;
    confirmBtn.textContent = origLabel;
  }
}

function _renderFiles(bodyEl, files, truncated) {
  if (!files.length) {
    bodyEl.innerHTML = '<p class="ds-hint">No local changes to show.</p>';
    return;
  }
  const rows = files.map(f => {
    const badge = statusBadge(f.status);
    return `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 0;border-bottom:1px solid var(--body-tertiary-border)">
        <span style="font-family:var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);font-size:var(--text-sm)">${escHtml(f.path)}</span>
        <span class="ds-badge ds-badge--sm ${badge.cls}">${escHtml(badge.label)}</span>
      </div>
    `;
  }).join('');
  const truncNote = truncated
    ? '<p class="ds-hint">Showing the first files - there are more.</p>'
    : '';
  bodyEl.innerHTML = rows + truncNote;
}

/**
 * @param {string} repoLabel - human label shown in the title/toast
 * @param {{onDiscarded?: () => (void|Promise<void>), repoId?: string}} [opts] -
 *   `repoId` addresses one row of the `DATA_REPOS` registry
 *   (`/api/data/<repoId>/...`); omitted, every request below falls back to
 *   the legacy `/api/data-tier-0/...` prefix, exactly as before this modal
 *   knew about more than one repo.
 */
export async function openLocalChangesModal(repoLabel, { onDiscarded, repoId } = {}) {
  const overlay = _ensureModal();
  _currentRepoLabel = repoLabel;
  _currentRepoId = repoId;
  _currentOnDiscarded = onDiscarded;

  overlay.querySelector('#lcm-title').textContent = `Local changes - ${repoLabel}`;
  overlay.querySelector('#lcm-confirm').hidden = true;
  const discardBtn = overlay.querySelector('#lcm-discard');
  discardBtn.hidden = true;
  discardBtn.disabled = true;

  const bodyEl = overlay.querySelector('#lcm-body');
  bodyEl.innerHTML = '<p class="ds-hint">Loading...</p>';
  openDsModal(overlay);

  const data = await fetchLocalChanges(repoId);

  // The modal is a singleton with listeners bound once. If the user opens
  // another row while this fetch is still in flight, `_currentRepoId` has
  // already moved on - painting this stale response would show one repo's
  // files under another repo's title, with the discard button wired to the
  // now-current repoId. Drop the stale response instead of racing it in.
  if (_currentRepoId !== repoId) return;

  if (!data.ok) {
    bodyEl.innerHTML = `<div class="ds-callout ds-callout--warning"><div>${escHtml(_errorMessage(data))}</div></div>`;
    return;
  }

  const files = Array.isArray(data.files) ? data.files : [];
  _renderFiles(bodyEl, files, data.truncated);

  if (files.length) {
    discardBtn.hidden = false;
    discardBtn.disabled = false;
  }
}
