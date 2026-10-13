import { escHtml } from './utils.js';

// Shared helper for the DS modal overlay open/close contract.
// A ds-modal-overlay needs BOTH `hidden = false` AND the `.open` class to be
// visible (css/ds.css: .ds-modal-overlay { opacity: 0 } / .open { opacity: 1 }).
// Forgetting either half is a recurring bug class this helper eliminates.
//
// The WeakSet is the primary tracker (works with plain-object test stubs that
// lack `dataset`); the `dataset` stamp is a guarded best-effort mirror for
// DevTools inspectability and cross-module close sites.
//
// Three layers, all in `openDsModal(el, opts)`:
//  1. Always, even with no `opts` at all: today's visibility toggle plus a
//     baseline a11y pass - `role="dialog"` / `aria-modal="true"` on the inner
//     `.ds-modal` (or on `el` itself when there is none), `aria-labelledby`
//     wired to `.ds-modal-title` when the caller gave no `aria-label` of its
//     own, and an initial focus move (explicit `opts.initialFocus`, else the
//     first `[autofocus]`, else the first focusable control, else
//     `.ds-modal-close`). None of this closes anything.
//  2. `opts` given AND `opts.dismissible !== false`: Escape (on `document`)
//     and a click on the overlay itself (`e.target === el`) both close the
//     modal, and `opts.trigger` gets its focus back once they do. The pair of
//     listeners lives in a per-element WeakMap so a second `openDsModal` on
//     the same element never stacks a second pair, and `closeDsModal` removes
//     them - a view that opens the same overlay every render still ends up
//     with exactly one Escape handler.
//  3. `opts.dismissible === false`: no Escape, no overlay-click close. This
//     is the escape hatch progress windows need - `js/sub-repo-sync-stream.js`
//     (`_openProgressModal` / `_teardownSyncModal`, ~line 264-301) and
//     `js/update-modal.js` open a modal that tracks a running operation and
//     must not vanish out from under it on a stray Escape or a misclick on
//     the backdrop; they call `closeDsModal` themselves once the work is
//     actually done. Every existing call site in this repo calls
//     `openDsModal(overlay)` with NO second argument, so layer 2 has never
//     been active for them and this file changes nothing about their
//     behaviour - it only adds capability for a caller that opts in.

const _managedHidden = new WeakSet();

/** el -> { onKeydown, onClick, trigger } for the opt-in dismiss layer. */
const _dismissState = new WeakMap();

/**
 * overlay -> finish(dismissValue) of an open confirmDsModal. `navigate()` in
 * js/app.js sweeps every `.ds-modal-overlay.open` through `closeDsModal`
 * before it even knows whether the hash will change, so a click on the
 * already-active rail item takes a confirm off the screen with no
 * `hashchange` behind it. A plain close would leave the returned Promise
 * pending for good - and the caller's `finally` (a `_setRunning(false)`,
 * an `aria-busy` reset) with it. Any external `closeDsModal` on a confirm's
 * overlay therefore resolves it as dismissed.
 */
const _confirmFinishers = new WeakMap();

let _titleIdCounter = 0;

function _hasAttr(el, name) {
  return typeof el.hasAttribute === 'function' && el.hasAttribute(name);
}

/**
 * Baseline a11y pass, layer 1. Never touches anything already set by the
 * caller's own markup (e.g. `module-area-modal.js` already ships its own
 * `role`/`aria-modal`/`aria-labelledby`).
 * @param {*} dialogEl
 */
function _applyA11y(dialogEl) {
  if (!dialogEl || typeof dialogEl.setAttribute !== 'function') return;
  if (!_hasAttr(dialogEl, 'role')) dialogEl.setAttribute('role', 'dialog');
  if (!_hasAttr(dialogEl, 'aria-modal')) dialogEl.setAttribute('aria-modal', 'true');
  if (!_hasAttr(dialogEl, 'aria-label') && !_hasAttr(dialogEl, 'aria-labelledby')) {
    const title = dialogEl.querySelector && dialogEl.querySelector('.ds-modal-title');
    if (title) {
      if (!title.id) title.id = 'ds-modal-title-' + (_titleIdCounter += 1);
      dialogEl.setAttribute('aria-labelledby', title.id);
    }
  }
}

/** First focusable control inside the dialog, skipping the close button. */
function _firstFocusable(dialogEl) {
  if (!dialogEl.querySelectorAll) return null;
  const candidates = dialogEl.querySelectorAll('input, select, textarea, button, a[href]');
  for (const c of candidates) {
    if (c.classList && c.classList.contains && c.classList.contains('ds-modal-close')) continue;
    if (c.disabled) continue;
    if (_hasAttr(c, 'disabled')) continue;
    return c;
  }
  return null;
}

/**
 * `opts.initialFocus` may be an element, a selector string, or the literal
 * `null` (caller explicitly asks for no focus move at all). Anything else
 * falls through to `[autofocus]`, then the first focusable control, then
 * `.ds-modal-close`.
 */
function _resolveInitialFocus(dialogEl, opts) {
  if (opts && Object.prototype.hasOwnProperty.call(opts, 'initialFocus')) {
    if (opts.initialFocus === null) return null;
    const explicit = typeof opts.initialFocus === 'string'
      ? (dialogEl.querySelector && dialogEl.querySelector(opts.initialFocus))
      : opts.initialFocus;
    if (explicit) return explicit;
  }
  const autofocus = dialogEl.querySelector && dialogEl.querySelector('[autofocus]');
  if (autofocus) return autofocus;
  const focusable = _firstFocusable(dialogEl);
  if (focusable) return focusable;
  return (dialogEl.querySelector && dialogEl.querySelector('.ds-modal-close')) || null;
}

/** Layer 2: Escape + overlay-click close, wired at most once per element. */
function _wireDismiss(el, opts) {
  if (_dismissState.has(el)) return;
  const trigger = opts.trigger || null;
  const onKeydown = (e) => { if (e.key === 'Escape') closeDsModal(el); };
  const onClick = (e) => { if (e.target === el) closeDsModal(el); };
  document.addEventListener('keydown', onKeydown);
  el.addEventListener('click', onClick);
  _dismissState.set(el, { onKeydown, onClick, trigger });
}

export function openDsModal(el, opts) {
  if (!el) return;
  if (el.hidden) {
    _managedHidden.add(el);
    if (el.dataset) el.dataset.dsModalManagesHidden = '1';
  }
  el.hidden = false;
  el.classList.add('open');

  const dialogEl = (el.querySelector && el.querySelector('.ds-modal')) || el;
  _applyA11y(dialogEl);

  const focusTarget = _resolveInitialFocus(dialogEl, opts);
  if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();

  if (opts && opts.dismissible !== false) {
    _wireDismiss(el, opts);
  }
}

export function closeDsModal(el) {
  if (!el) return;
  const finisher = _confirmFinishers.get(el);
  if (finisher) {
    // finish() deletes its own entry first, then calls back into this
    // function to do the actual closing - so this branch never re-enters.
    finisher();
    return;
  }
  el.classList.remove('open');
  if (_managedHidden.has(el) || (el.dataset && el.dataset.dsModalManagesHidden === '1')) {
    el.hidden = true;
  }
  const state = _dismissState.get(el);
  if (state) {
    document.removeEventListener('keydown', state.onKeydown);
    el.removeEventListener('click', state.onClick);
    _dismissState.delete(el);
    if (state.trigger && typeof state.trigger.focus === 'function') {
      const stillConnected = typeof document !== 'undefined' && typeof document.contains === 'function'
        ? document.contains(state.trigger)
        : true;
      if (stillConnected) state.trigger.focus();
    }
  }
}

/**
 * A confirmation dialog with a fixed, predictable shape: the affirmative
 * button ([OK]/[danger]) always comes first in the footer, the dismissive
 * one ([Cancel]) second - the opposite order from the several `[Cancel][OK]`
 * footers still hand-rolled elsewhere in this repo (see cockpit-conventions
 * section 2b for that list; this helper is the way out of it, not a
 * retrofit of it).
 *
 * Builds and tears down its own overlay per call, so nothing needs to exist
 * in `index.html` up front. Resolves `true` on OK, `false` on Cancel,
 * `dismissValue` on the close button, Escape or a click on the backdrop.
 *
 * @param {object} opts
 * @param {string} [opts.title]
 * @param {string} [opts.body] plain text, escaped
 * @param {string} [opts.bodyHtml] trusted HTML from the caller, used as-is
 * @param {string} [opts.okLabel='Confirm']
 * @param {string} [opts.cancelLabel='Cancel']
 * @param {boolean} [opts.danger=false] paints the OK button `ds-btn--danger`
 * @param {*} [opts.dismissValue=false] resolved value for X / Escape / overlay
 * @param {*} [opts.trigger] element to refocus once the dialog closes
 * @returns {Promise<boolean|*>}
 */
export function confirmDsModal(opts = {}) {
  const {
    title = '',
    body,
    bodyHtml,
    okLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
    dismissValue = false,
    trigger,
  } = opts || {};

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'ds-modal-overlay';
    overlay.hidden = true;

    const okClass = 'ds-btn ' + (danger ? 'ds-btn--danger' : 'ds-btn--primary');
    const bodyContent = bodyHtml !== undefined ? bodyHtml : escHtml(body || '');
    overlay.innerHTML =
      '<div class="ds-modal">'
      + '<div class="ds-modal-header">'
      + '<span class="ds-modal-title">' + escHtml(title) + '</span>'
      + '<button type="button" class="ds-modal-close" data-confirm-x aria-label="Close">&times;</button>'
      + '</div>'
      + '<div class="ds-modal-body">' + bodyContent + '</div>'
      + '<div class="ds-modal-footer">'
      + '<button type="button" class="' + okClass + '" data-confirm-ok>' + escHtml(okLabel) + '</button>'
      + '<button type="button" class="ds-btn ds-btn--tertiary" data-confirm-cancel>' + escHtml(cancelLabel) + '</button>'
      + '</div>'
      + '</div>';

    document.body.appendChild(overlay);
    const okBtn = overlay.querySelector('[data-confirm-ok]');
    const cancelBtn = overlay.querySelector('[data-confirm-cancel]');
    const xBtn = overlay.querySelector('[data-confirm-x]');

    // Escape and the overlay-click close AND resolve - `openDsModal`'s own
    // layer 2 only closes, so confirmDsModal wires its own pair rather than
    // relying on it, and opens with `dismissible: false` to avoid a second,
    // silent pair doing nothing but closing twice.
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      _confirmFinishers.delete(overlay);
      document.removeEventListener('keydown', onKeydown);
      overlay.removeEventListener('click', onOverlayClick);
      if (win) win.removeEventListener('hashchange', onHashChange);
      closeDsModal(overlay);
      overlay.remove();
      if (trigger && typeof trigger.focus === 'function') {
        const stillConnected = typeof document !== 'undefined' && typeof document.contains === 'function'
          ? document.contains(trigger)
          : true;
        if (stillConnected) trigger.focus();
      }
      resolve(value);
    };
    const onKeydown = (e) => { if (e.key === 'Escape') finish(dismissValue); };
    const onOverlayClick = (e) => { if (e.target === overlay) finish(dismissValue); };
    // The overlay hangs off document.body, not off a view, so no view cleanup
    // can reach it: a navigation while the question is open (keyboard,
    // back button) would otherwise orphan the overlay AND its document
    // keydown listener until somebody pressed Escape. A route change is an
    // answer of "no" - resolve with dismissValue and take everything down.
    const win = typeof window !== 'undefined' && typeof window.addEventListener === 'function' ? window : null;
    const onHashChange = () => finish(dismissValue);
    document.addEventListener('keydown', onKeydown);
    overlay.addEventListener('click', onOverlayClick);
    if (win) win.addEventListener('hashchange', onHashChange);
    _confirmFinishers.set(overlay, () => finish(dismissValue));

    okBtn.addEventListener('click', () => finish(true));
    cancelBtn.addEventListener('click', () => finish(false));
    xBtn.addEventListener('click', () => finish(dismissValue));

    openDsModal(overlay, { initialFocus: okBtn, dismissible: false });
  });
}
