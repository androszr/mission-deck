// Shared install/import prompt. No request is sent until a valid choice.
import { openDsModal, closeDsModal } from './ds-modal.js';
import { registerViewCleanup } from './view-lifecycle.js';
import { escHtml } from './utils.js';
import { areaInputError, areaSuggestions } from './module-card.mjs';

let _activeCancel = null;
let _cleanupRegistered = false;

// One cleanup registration per settings visit, not one per table repaint.
// Query the current root on disposal: loading headers may be auto-enhanced
// before the table's own change handler is wired.
export function createAreaSelectLifecycle(selector) {
  let root = null;
  let ds = null;
  let removeChange = null;
  let registered = false;
  const dispose = () => {
    if (removeChange) removeChange();
    removeChange = null;
    if (root && ds) root.querySelectorAll(selector).forEach(ds.destroySelect);
  };
  return {
    async prepare(nextRoot) {
      ds = await import('./ds-select.js');
      dispose();
      root = nextRoot;
      if (!registered) {
        registered = true;
        registerViewCleanup('settings', () => {
          dispose();
          root = null;
          registered = false;
        });
      }
      return ds;
    },
    bind(native, onChange) {
      if (removeChange) removeChange();
      native.addEventListener('change', onChange);
      removeChange = () => native.removeEventListener('change', onChange);
    },
    dispose,
  };
}

export async function requestModuleArea(suggestions = []) {
  const { initSelect, destroySelect } = await import('./ds-select.js');
  if (_activeCancel) _activeCancel();
  if (!_cleanupRegistered) {
    _cleanupRegistered = true;
    registerViewCleanup('settings', () => {
      if (_activeCancel) _activeCancel();
      _cleanupRegistered = false;
    });
  }
  return new Promise(resolve => {
    const previousFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'ds-modal-overlay';
    overlay.innerHTML = `
      <div class="ds-modal ds-modal--md" role="dialog" aria-modal="true" aria-labelledby="mod-area-title">
        <div class="ds-modal-header">
          <span class="ds-modal-title" id="mod-area-title">Assign an area</span>
          <button type="button" class="ds-btn ds-btn--tertiary" data-area-cancel aria-label="Close">×</button>
        </div>
        <div class="ds-modal-body moduly-publish-form">
          <p>The module has no business area. Pick a suggestion or type your own name.</p>
          <div class="ds-input-wrap">
            <label class="ds-label" for="mod-area-suggestion">Area suggestions</label>
            <select class="ds-input" id="mod-area-suggestion">
              <option value="">Custom area</option>
              ${areaSuggestions(suggestions).map(value => `<option value="${escHtml(value)}">${escHtml(value)}</option>`).join('')}
            </select>
          </div>
          <div class="ds-input-wrap">
            <label class="ds-label" for="mod-area-value">Area (required)</label>
            <input class="ds-input" id="mod-area-value" required aria-describedby="mod-area-error" placeholder="Type a custom area">
            <p id="mod-area-error" role="alert" hidden></p>
          </div>
        </div>
        <div class="ds-modal-footer">
          <button type="button" class="ds-btn ds-btn--tertiary" data-area-cancel>Cancel</button>
          <button type="button" class="ds-btn ds-btn--primary" data-area-confirm>Assign and continue</button>
        </div>
      </div>`;
    const finish = value => {
      closeDsModal(overlay);
      overlay.remove();
      select.removeEventListener('change', onSuggestionChange);
      destroySelect(select);
      _activeCancel = null;
      if (previousFocus?.isConnected) previousFocus.focus();
      resolve(value);
    };
    _activeCancel = () => finish(null);
    document.body.appendChild(overlay);
    const select = overlay.querySelector('select');
    const input = overlay.querySelector('#mod-area-value');
    initSelect(select);
    overlay.querySelector('.ds-sel-trigger').setAttribute('aria-label', 'Area suggestions');
    const onSuggestionChange = () => { input.value = select.value; input.focus(); };
    select.addEventListener('change', onSuggestionChange);
    overlay.querySelectorAll('[data-area-cancel]').forEach(button => button.addEventListener('click', () => finish(null)));
    overlay.addEventListener('click', event => { if (event.target === overlay) finish(null); });
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.stopPropagation(); finish(null); }
      if (event.key === 'Tab') {
        const controls = [...overlay.querySelectorAll('button:not([disabled]), input')];
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    overlay.querySelector('[data-area-confirm]').addEventListener('click', () => {
      const error = areaInputError(input.value);
      const hint = overlay.querySelector('#mod-area-error');
      hint.hidden = !error;
      hint.textContent = error;
      input.setAttribute('aria-invalid', error ? 'true' : 'false');
      if (error) { input.focus(); return; }
      finish(input.value.trim().replace(/ {2,}/g, ' '));
    });
    openDsModal(overlay);
    input.focus();
  });
}
