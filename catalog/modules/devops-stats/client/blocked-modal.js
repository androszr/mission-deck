// modules/devops-stats/client/blocked-modal.js
// "Set statuses": two checkbox groups saved together through POST /config.
// - Blocked: a checkbox per non-done status. Saved ids are checked; with
//   nothing saved the proposal (proposeBlockedStatuses) is pre-checked with a
//   hint - proposed, never applied until "Save".
// - Cancelled: a checkbox per done status. Until the team saves a list the
//   view already applies the name-based proposal (effectiveCancelledIds), so
//   the modal shows exactly what is in force.
// Footer is primary first: [Save][Cancel]. Resolves with the saved config
// or null when cancelled.

import { proposeBlockedStatuses } from './flow-model.mjs';

function _esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * @param {{apiBase:string, statuses:Array<{id:string,name:string,category:string|null}>,
 *   saved:string[], cancelled:string[], dsModal:object|null, showToast?:Function}} opts
 *   cancelled - the cancelled ids in force (saved, or the proposal when nothing is saved)
 * @returns {Promise<{blocked_status_ids:string[], cancelled_status_ids:string[]}|null>}
 */
export function openBlockedModal({ apiBase, statuses, saved, cancelled, dsModal, showToast }) {
  const list = (statuses || []).filter((s) => s.category !== 'done');
  const doneList = (statuses || []).filter((s) => s.category === 'done');
  const hasSaved = Array.isArray(saved) && saved.length > 0;
  const checked = new Set((hasSaved ? saved : proposeBlockedStatuses(statuses)).map(String));
  const cancelledSet = new Set((cancelled || []).map(String));
  const box = (s, on, group) => '<label class="ds-checkbox-label"><input type="checkbox" data-group="' + group + '" value="' + _esc(s.id) + '"'
    + (on ? ' checked' : '') + '> ' + _esc(s.name) + '</label>';

  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.hidden = true;
  const rows = list.map((s) => box(s, checked.has(String(s.id)), 'blocked')).join('');
  const doneRows = doneList.map((s) => box(s, cancelledSet.has(String(s.id)), 'cancelled')).join('');
  overlay.innerHTML = `
    <div class="ds-modal ds-modal--md" role="dialog" aria-modal="true">
      <div class="ds-modal-header"><span class="ds-modal-title">Set statuses</span></div>
      <div class="ds-modal-body">
        <h3 class="devops-stats-modal-subtitle">Blocked</h3>
        <p>Time an issue spends in the checked statuses counts as blocked. Jira flags are not taken into account.</p>
        ${!hasSaved && checked.size ? '<p class="devops-stats-modal-hint">A proposal based on status names - check it before saving.</p>' : ''}
        <div class="ds-checkbox-group">${rows || '<span>No statuses - refresh the data from Jira first.</span>'}</div>
        <h3 class="devops-stats-modal-subtitle">Cancelled</h3>
        <p>Issues finished in the checked statuses are cancelled: they do not count as delivered, towards lead and cycle time, or as closed without work.</p>
        <div class="ds-checkbox-group">${doneRows || '<span>No done statuses - refresh the data from Jira first.</span>'}</div>
      </div>
      <div class="ds-modal-footer">
        <button type="button" class="ds-btn ds-btn--primary" data-blocked-save>Save</button>
        <button type="button" class="ds-btn ds-btn--tertiary" data-blocked-cancel>Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  return new Promise((resolve) => {
    const saveBtn = overlay.querySelector('[data-blocked-save]');
    let done = false;
    // ds-modal's Escape / overlay click only hides the overlay; resolve the
    // promise and drop the node on that path too.
    const onKey = (e) => { if (e.key === 'Escape') _finish(null); };
    const onOverlay = (e) => { if (e.target === overlay) _finish(null); };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', onOverlay);
    function _finish(result) {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey);
      overlay.removeEventListener('click', onOverlay);
      if (dsModal && typeof dsModal.closeDsModal === 'function') dsModal.closeDsModal(overlay);
      overlay.remove();
      resolve(result);
    }
    overlay.querySelector('[data-blocked-cancel]').addEventListener('click', () => _finish(null));
    saveBtn.addEventListener('click', async () => {
      const pick = (group) => Array.from(overlay.querySelectorAll('input[data-group="' + group + '"]:checked')).map((i) => i.value);
      const ids = pick('blocked');
      const cancelledIds = pick('cancelled');
      saveBtn.setAttribute('aria-busy', 'true');
      saveBtn.disabled = true;
      try {
        const res = await fetch(apiBase + '/config', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blocked_status_ids: ids, cancelled_status_ids: cancelledIds }),
        });
        const data = await res.json();
        if (!res.ok) {
          if (typeof showToast === 'function') showToast('danger', 'Could not save the statuses', (data && data.message) || '');
          return;
        }
        _finish(data.config || { blocked_status_ids: ids, cancelled_status_ids: cancelledIds });
      } catch (e) {
        if (typeof showToast === 'function') showToast('danger', 'Save failed', e && e.message ? e.message : String(e));
      } finally {
        saveBtn.removeAttribute('aria-busy');
        saveBtn.disabled = false;
      }
    });
    if (dsModal && typeof dsModal.openDsModal === 'function') dsModal.openDsModal(overlay, {});
    else { overlay.hidden = false; overlay.classList.add('open'); }
  });
}
