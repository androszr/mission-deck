// ── Mission Deck — js/feedback-modal.js ──────────────────────────────
// The "Send feedback" window behind the top-bar help button (js/topbar.js).
// Dynamic-imported on first click, same pattern as js/stash-modal.js, so
// nothing here is on the boot path. Never a view: no #view-<id> section, no
// VIEW_REGISTRY entry, no runActiveViewCleanup - the overlay lives on
// document.body for the whole session and its own paste/keydown listeners
// are attached on open and removed on close, which is what this file owns
// instead.
//
// The overlay is reused across opens (built once, kept in the document, the same
// shape as js/stash-modal.js) and openDsModal is called WITHOUT opts: every
// real caller of openDsModal in this repo does the same (module-area-modal.js,
// day-cycle-modal.js, stash-modal.js) - the opt-in Escape/overlay-click layer
// in js/ds-modal.js closes the element directly and would bypass this file's
// own teardown of the paste and keydown listeners, leaking them across every
// future click in the app. So Escape and the backdrop click are handled here,
// by the same keydown/click listeners this file already owns and already
// removes in _forceClose(), and the trigger is refocused by hand on close -
// the same outcome opts.trigger would have given, without the leak. Both of
// those, plus the X and "Cancel", go through the guarded _close() wrapper,
// which refuses outright while a submit is in flight (_busy) - see its own
// comment further down.
//
// One more path closes a modal without calling this file at all: js/app.js
// sweeps every `.ds-modal-overlay.open` through closeDsModal() directly on a
// hash change. A hashchange listener of this file's own (added on open,
// removed in _forceClose()) runs _forceClose() proactively so that sweep
// never gets to be the only thing that happened - the paste and keydown
// listeners are torn down here regardless of which of the two runs first,
// and unlike _close() this path is NEVER refused, even mid-submit: _busy
// stays true until the fetch settles, and the settle reports through a toast
// once it finds the overlay already hidden.
//
// All DOM-free logic (slug, stamp, markdown, error copy) lives in
// js/feedback-helpers.mjs, imported here statically for the "Copy
// report" fallback and for the error message table.

import { openDsModal, closeDsModal } from './ds-modal.js';
import { showToast } from './toast.js';
import { escHtml } from './utils.js';
import { state } from './state.js';
import {
  FEEDBACK_TITLE_MAX_CHARS,
  FEEDBACK_MAX_ATTACHMENTS,
  feedbackSlug,
  feedbackDirName,
  formatConsoleErrors,
  feedbackErrorMessage,
  buildFeedbackMarkdown,
} from './feedback-helpers.mjs';

const OVERLAY_ID = 'feedback-modal-overlay';
// Mirrors the server's FEEDBACK_MAX_ATTACHMENT_BYTES (server.js) - a client
// pre-check, not the enforcement; the server checks again from the decoded
// bytes and magic-byte format.
const MAX_ATTACHMENT_CLIENT_BYTES = 3 * 1024 * 1024;
// Mirrors FEEDBACK_MAX_TOTAL_BYTES (server.js). Without this SUM check four
// 3 MB screenshots pass every per-file check, inflate past
// FEEDBACK_MAX_BODY_BYTES as base64, and _readRawBody destroys the socket
// before its 413 can leave - the browser sees a thrown fetch and the person
// is told to turn on the VPN.
const MAX_TOTAL_CLIENT_BYTES = 8 * 1024 * 1024;
const IMAGE_MIME_RE = /^image\/(png|jpe?g|gif|webp)$/;
const MIME_EXT = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

/** @type {'bug'|'idea'|'question'} */
let _type = 'bug';
/** @type {Array<{dataUrl: string, base64: string, mime: string, size: number}>} */
let _attachments = [];
let _busy = false;
/** @type {{view: string, url: string, viewport: string, screen: string, userAgent: string, language: string}|null} */
let _context = null;
/** @type {Element|null} focus returns here on close, the trigger's job opts.trigger would do. */
let _trigger = null;
let _pasteHandler = null;
let _keydownHandler = null;
let _navHandler = null;

function _overlay() { return document.getElementById(OVERLAY_ID); }
function _bodyEl() { const o = _overlay(); return o ? o.querySelector('[data-fb-body]') : null; }
function _footerEl() { const o = _overlay(); return o ? o.querySelector('[data-fb-footer]') : null; }
function _statusEl() { const o = _overlay(); return o ? o.querySelector('[data-fb-status]') : null; }

// ── Context captured at open time ───────────────────────────────────────────

/** @returns {{view: string, url: string, viewport: string, screen: string, userAgent: string, language: string}} */
function _captureContext() {
  return {
    view: location.hash || '',
    url: location.href,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    screen: `${window.screen.width}x${window.screen.height}`,
    userAgent: navigator.userAgent,
    language: navigator.language || '',
  };
}

// ── Screenshots: paste + file input ─────────────────────────────────────────

/** Raw (decoded) bytes of every attachment already accepted. @returns {number} */
function _attachmentsBytes() {
  return _attachments.reduce((sum, a) => sum + (a.size || 0), 0);
}

/** @param {File} file @returns {Promise<string>} data: URL */
function _fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('read-failed'));
    reader.readAsDataURL(file);
  });
}

/**
 * Client pre-checks only (count, size, MIME) - never sent on a violation, a
 * toast explains why. The server re-checks all three from the decoded
 * bytes; this is convenience, not the enforcement.
 * @param {File} file
 */
async function _addFile(file) {
  if (_attachments.length >= FEEDBACK_MAX_ATTACHMENTS) {
    showToast('warning', 'Too many screenshots', `You can attach at most ${FEEDBACK_MAX_ATTACHMENTS} screenshots.`);
    return;
  }
  if (!file || !IMAGE_MIME_RE.test(file.type || '')) {
    showToast('warning', 'Unsupported file', 'Only PNG, JPG, GIF and WebP images are allowed.');
    return;
  }
  if (file.size > MAX_ATTACHMENT_CLIENT_BYTES) {
    showToast('warning', 'File too large', 'Each screenshot can be at most 3 MB.');
    return;
  }
  if (_attachmentsBytes() + file.size > MAX_TOTAL_CLIENT_BYTES) {
    showToast('warning', 'Attachments too large', 'All screenshots together can be at most 8 MB.');
    return;
  }
  try {
    const dataUrl = await _fileToDataUrl(file);
    // Re-checked here, not only above: a multi-file selection or a multi-item
    // paste calls _addFile once per file WITHOUT awaiting the previous call,
    // so every call reads the same pre-await count and the guard above alone
    // lets a 6-file selection through as 6 attachments - exactly the send
    // this pre-check exists to stop.
    if (_attachments.length >= FEEDBACK_MAX_ATTACHMENTS) {
      showToast('warning', 'Too many screenshots', `You can attach at most ${FEEDBACK_MAX_ATTACHMENTS} screenshots.`);
      return;
    }
    if (_attachmentsBytes() + file.size > MAX_TOTAL_CLIENT_BYTES) {
      showToast('warning', 'Attachments too large', 'All screenshots together can be at most 8 MB.');
      return;
    }
    const comma = dataUrl.indexOf(',');
    const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : '';
    _attachments.push({ dataUrl, base64, mime: file.type, size: file.size });
    _paintThumbs();
  } catch (_e) {
    showToast('warning', 'Could not read the file', 'Please try again.');
  }
}

/** Clipboard image items only; text paste into the title/description fields is left untouched. */
function _onPaste(e) {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === 'file' && IMAGE_MIME_RE.test(item.type || '')) {
      const file = item.getAsFile();
      if (file) { e.preventDefault(); _addFile(file); }
    }
  }
}

/**
 * Escape closes the modal (this file owns dismissal, see header comment);
 * Tab traps focus inside the dialog while it is open, the same pattern as
 * js/module-area-modal.js, needed here because the overlay is reused rather
 * than removed from the document on close.
 */
function _onKeydown(e) {
  if (e.key === 'Escape') { _close(); return; }
  if (e.key !== 'Tab') return;
  const overlay = _overlay();
  const dialog = overlay && overlay.querySelector('.ds-modal');
  if (!dialog) return;
  const controls = Array.from(dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled])'))
    .filter((el) => el.offsetParent !== null);
  if (!controls.length) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// ── Painting ─────────────────────────────────────────────────────────────────

/** @returns {string} */
function _bodyHtml() {
  const bugOnly = _type === 'bug';
  return `
    <div class="ds-segmented feedback-modal__type" data-fb-type-group>
      <button type="button" class="ds-segment${_type === 'bug' ? ' active' : ''}" data-fb-type="bug">Bug</button>
      <button type="button" class="ds-segment${_type === 'idea' ? ' active' : ''}" data-fb-type="idea">Idea</button>
      <button type="button" class="ds-segment${_type === 'question' ? ' active' : ''}" data-fb-type="question">Question</button>
    </div>
    <div class="feedback-modal__field-wrap">
      <div class="ds-input-wrap">
        <label class="ds-label" for="fb-title">Title</label>
        <input type="text" class="ds-input" id="fb-title" maxlength="${FEEDBACK_TITLE_MAX_CHARS}" placeholder="Briefly, what is it about" data-fb-title autofocus>
      </div>
      <div class="ds-input-wrap">
        <label class="ds-label" for="fb-desc">Description</label>
        <textarea class="ds-textarea" id="fb-desc" placeholder="Describe what is happening" data-fb-desc></textarea>
      </div>
      <div class="ds-input-wrap" data-fb-bug-only${bugOnly ? '' : ' hidden'}>
        <label class="ds-label" for="fb-steps">Steps to reproduce</label>
        <textarea class="ds-textarea" id="fb-steps" placeholder="1. ..." data-fb-steps></textarea>
      </div>
      <div class="ds-input-wrap" data-fb-bug-only${bugOnly ? '' : ' hidden'}>
        <label class="ds-label" for="fb-expected">Expected behaviour</label>
        <textarea class="ds-textarea" id="fb-expected" placeholder="What should have happened" data-fb-expected></textarea>
      </div>
      <div class="feedback-modal__shots">
        <div class="feedback-modal__shots-zone" data-fb-dropzone tabindex="0" role="group" aria-label="Screenshots">
          <p class="feedback-modal__shots-text">Paste a screenshot (Ctrl+V, Cmd+V on a Mac) or pick a file from disk.</p>
          <button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-fb-file-btn>Choose file</button>
          <input type="file" class="feedback-modal__file-input" id="fb-file-input" accept="image/*" multiple data-fb-file-input>
        </div>
        <div class="feedback-modal__thumbs" data-fb-thumbs></div>
        <p class="feedback-modal__counter" data-fb-counter>${_attachments.length} / ${FEEDBACK_MAX_ATTACHMENTS}</p>
        <p class="feedback-modal__hint">Screenshots go to the app repository, which the whole team can see.</p>
      </div>
    </div>
    <div data-fb-status></div>`;
}

function _paintThumbs() {
  const body = _bodyEl();
  if (!body) return;
  const thumbs = body.querySelector('[data-fb-thumbs]');
  const counter = body.querySelector('[data-fb-counter]');
  if (thumbs) {
    thumbs.innerHTML = _attachments.map((a, i) => `<div class="feedback-modal__thumb">
        <img src="${a.dataUrl}" alt="">
        <button type="button" class="ds-icon-btn ds-icon-btn--sm feedback-modal__thumb-remove" data-fb-remove="${i}" aria-label="Remove screenshot ${i + 1}"><img class="nav-icon" src="/assets/icons/ds/24-ic-trashcan.svg" alt="" aria-hidden="true"></button>
      </div>`).join('');
  }
  if (counter) counter.textContent = `${_attachments.length} / ${FEEDBACK_MAX_ATTACHMENTS}`;
}

/** @returns {string} */
function _footerHtml() {
  return '<button type="button" class="ds-btn ds-btn--primary" data-fb-submit>Send</button>'
    + '<button type="button" class="ds-btn ds-btn--tertiary" data-fb-cancel>Cancel</button>';
}

/** Switching type keeps whatever the person already typed - only the active pill and the bug-only fields toggle. */
function _setType(type) {
  if (type !== 'bug' && type !== 'idea' && type !== 'question') return;
  _type = type;
  const body = _bodyEl();
  if (!body) return;
  body.querySelectorAll('[data-fb-type]').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-fb-type') === type);
  });
  body.querySelectorAll('[data-fb-bug-only]').forEach((el) => { el.hidden = type !== 'bug'; });
}

/** @returns {{type: string, title: string, description: string, steps: string, expected: string}} */
function _readValues() {
  const body = _bodyEl();
  const val = (sel) => { const el = body && body.querySelector(sel); return el ? el.value : ''; };
  return {
    type: _type,
    title: val('[data-fb-title]').trim(),
    description: val('[data-fb-desc]'),
    steps: _type === 'bug' ? val('[data-fb-steps]') : '',
    expected: _type === 'bug' ? val('[data-fb-expected]') : '',
  };
}

// ── Error / success states ──────────────────────────────────────────────────

/** Modal stays open with everything already typed; the form is never rebuilt here. */
function _paintError(message, branch) {
  const statusEl = _statusEl();
  if (!statusEl) return;
  const branchLine = branch ? `<p class="feedback-modal__branch">Branch: <code>${escHtml(branch)}</code></p>` : '';
  statusEl.innerHTML = `<div class="ds-callout ds-callout--danger">
      <div>
        <p>${escHtml(message)}</p>
        ${branchLine}
        <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-fb-copy>Copy report</button>
      </div>
    </div>`;
}

/** True while the overlay is on screen - false once a hashchange forced it shut. */
function _isVisible() {
  const overlay = _overlay();
  return !!(overlay && !overlay.hidden);
}

/**
 * Disables the X and "Cancel" and paints a one-line reason while a submit is
 * in flight, then reverses both on settle. The footer is rebuilt fresh on
 * every open (_footerHtml), so nothing here needs to survive a reopen - and
 * openFeedbackModal refuses to reopen while _busy anyway.
 * @param {boolean} busy
 */
function _setBusyUi(busy) {
  const overlay = _overlay();
  if (!overlay) return;
  const closeBtn = overlay.querySelector('.ds-modal-close');
  const cancelBtn = overlay.querySelector('[data-fb-cancel]');
  if (closeBtn) { closeBtn.disabled = busy; closeBtn.setAttribute('aria-disabled', busy ? 'true' : 'false'); }
  if (cancelBtn) { cancelBtn.disabled = busy; cancelBtn.setAttribute('aria-disabled', busy ? 'true' : 'false'); }
  const footer = _footerEl();
  if (!footer) return;
  let hint = footer.querySelector('[data-fb-busy-hint]');
  if (busy) {
    if (!hint) {
      hint = document.createElement('p');
      hint.className = 'feedback-modal__busy-hint';
      hint.setAttribute('data-fb-busy-hint', '1');
      hint.textContent = 'Sending - please wait a moment.';
      footer.insertBefore(hint, footer.firstChild);
    }
  } else if (hint) {
    hint.remove();
  }
}

/**
 * Paints the error state when the modal is still on screen; once a
 * hashchange has forced it shut mid-submit, painting into an invisible
 * [data-fb-status] would swallow the outcome (and the "Copy report"
 * fallback with it) - a toast is the only way left to tell the person.
 * @param {string} message @param {string} [branch]
 */
function _reportError(message, branch) {
  if (_isVisible()) { _paintError(message, branch); return; }
  showToast('danger', 'Report not sent', branch ? `${message} (branch: ${branch})` : message);
}

/** @param {{mrUrl: string}} result */
function _reportSuccess(result) {
  if (_isVisible()) { _paintSuccess(result); return; }
  _attachments = [];
  showToast('success', 'Report sent', (result && result.mrUrl) || 'The merge request is waiting for review.');
}

/** @param {{mrUrl: string}} result */
function _paintSuccess(result) {
  const body = _bodyEl();
  const footer = _footerEl();
  if (body) {
    body.innerHTML = `<div class="ds-callout ds-callout--success">
        <div>
          <p>Report sent. The merge request is waiting for review.</p>
          <p><a href="${escHtml(result.mrUrl || '')}" target="_blank" rel="noopener">Open the merge request</a></p>
        </div>
      </div>`;
  }
  if (footer) {
    footer.innerHTML = '<button type="button" class="ds-btn ds-btn--primary" data-fb-success-close>Close</button>';
  }
  _attachments = [];
  showToast('success', 'Report sent', 'Thank you for the feedback.');
}

// ── "Copy report" fallback ──────────────────────────────────────────────────

/** Provisional names for the copied markdown - the server has not named any file yet. */
function _provisionalAttachmentNames() {
  return _attachments.map((a, i) => {
    const ext = MIME_EXT[a.mime] || '.png';
    const n = String(i + 1).padStart(2, '0');
    return `attachments/${n}-zrzut${ext}`;
  });
}

/** @param {string} text @param {string} what */
async function _copyText(text, what) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      showToast('success', 'Copied', what);
      return;
    } catch (_e) { /* fall through to the textarea */ }
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    showToast('success', 'Copied', what);
  } catch (_e) {
    showToast('warning', 'Could not copy', 'Select the text by hand and copy it.');
  }
}

/**
 * Builds the same markdown the server would have built (js/feedback-helpers.mjs
 * buildFeedbackMarkdown), from whatever this client knows: no identity beyond
 * state.whoami, no app version/commit/platform (server-only fields), the
 * screenshots by provisional name since none has been uploaded.
 */
async function _copyMarkdown() {
  const values = _readValues();
  const title = values.title || '(no title)';
  const id = feedbackDirName(Date.now(), values.type, feedbackSlug(title));
  const whoami = state.whoami;
  const data = {
    id,
    type: values.type,
    title,
    status: 'new',
    reportedBy: (whoami && whoami.valid)
      ? { slug: whoami.person_slug || null, name: whoami.display_name || null, email: null }
      : null,
    reportedAt: new Date().toISOString(),
    app_info: null,
    context: _context || _captureContext(),
    description: values.description,
    steps: values.steps,
    expected: values.expected,
    attachments: _provisionalAttachmentNames(),
    consoleErrors: formatConsoleErrors(window.__cockpitErrorLog || []),
  };
  const markdown = buildFeedbackMarkdown(data);
  await _copyText(markdown, 'The report text is on the clipboard.');
}

// ── Submit ───────────────────────────────────────────────────────────────────

async function _submit(btn) {
  if (_busy) return;
  const values = _readValues();
  if (!values.title) {
    showToast('warning', 'Enter a title', 'The report title is required.');
    return;
  }
  _busy = true;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  _setBusyUi(true);
  try {
    const payload = {
      type: values.type,
      title: values.title,
      description: values.description,
      steps: values.steps,
      expected: values.expected,
      attachments: _attachments.map((a) => ({ data: a.base64 })),
      console_errors: formatConsoleErrors(window.__cockpitErrorLog || []),
      context: {
        view: (_context && _context.view) || '',
        url: (_context && _context.url) || '',
        viewport: (_context && _context.viewport) || '',
        screen: (_context && _context.screen) || '',
        user_agent: (_context && _context.userAgent) || '',
        language: (_context && _context.language) || '',
      },
    };

    let res;
    try {
      res = await fetch('/api/feedback/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (_networkErr) {
      _reportError(feedbackErrorMessage('unreachable'));
      return;
    }

    const status = res.status;
    const body = await res.json().catch(() => ({}));

    // 415 carries no `error` code - its own branch, never fed to feedbackErrorMessage.
    if (status === 415) {
      // checkOrigin's 415 body is English ('Content-Type must be
      // application/json'), so this sentence is the one shown, never
      // a fallback behind it.
      _reportError('The request is missing the required Content-Type header.');
      return;
    }
    if (status === 413) {
      _reportError(body.message || feedbackErrorMessage('too-large'));
      return;
    }
    if (status === 400) {
      _reportError(body.message || feedbackErrorMessage(body.error));
      return;
    }
    if (body && body.ok === true) {
      _reportSuccess(body);
      return;
    }
    // 200 with ok:false (test-mode, no-token, forbidden, unreachable, mr-failed, ...)
    _reportError((body && body.message) || feedbackErrorMessage(body && body.error), body && body.branch);
  } finally {
    _busy = false;
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    _setBusyUi(false);
  }
}

// ── Wire, open, close ────────────────────────────────────────────────────────

function _wire(overlay) {
  if (overlay.dataset.fbWired === '1') return;
  overlay.dataset.fbWired = '1';

  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) { _close(); return; }
    const t = ev.target;
    if (!t || typeof t.closest !== 'function') return;
    if (t.closest('[data-fb-close], [data-fb-cancel], [data-fb-success-close]')) { _close(); return; }
    const typeBtn = t.closest('[data-fb-type]');
    if (typeBtn) { _setType(typeBtn.getAttribute('data-fb-type')); return; }
    if (t.closest('[data-fb-file-btn]')) {
      const input = overlay.querySelector('[data-fb-file-input]');
      if (input) input.click();
      return;
    }
    const removeBtn = t.closest('[data-fb-remove]');
    if (removeBtn) {
      const idx = parseInt(removeBtn.getAttribute('data-fb-remove'), 10);
      if (!Number.isNaN(idx)) { _attachments.splice(idx, 1); _paintThumbs(); }
      return;
    }
    const submitBtn = t.closest('[data-fb-submit]');
    if (submitBtn) { _submit(submitBtn); return; }
    if (t.closest('[data-fb-copy]')) { _copyMarkdown(); }
  });

  overlay.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t && t.matches && t.matches('[data-fb-file-input]')) {
      const files = Array.from(t.files || []);
      files.forEach((f) => { _addFile(f); });
      t.value = '';
    }
  });
}

function _ensureOverlay() {
  let overlay = _overlay();
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.id = OVERLAY_ID;
  overlay.hidden = true;
  overlay.innerHTML = '<div class="ds-modal ds-modal--lg feedback-modal" role="dialog" aria-modal="true" aria-labelledby="feedback-modal-title">'
    + '<div class="ds-modal-header">'
    + '<span class="ds-modal-title" id="feedback-modal-title">Send feedback</span>'
    + '<button type="button" class="ds-modal-close" data-fb-close aria-label="Close">&times;</button>'
    + '</div>'
    + '<div class="ds-modal-body" data-fb-body></div>'
    + '<div class="ds-modal-footer" data-fb-footer></div>'
    + '</div>';
  document.body.appendChild(overlay);
  return overlay;
}

/**
 * Removes this file's own listeners and closes the overlay unconditionally.
 * The listener removal happens BEFORE the "already closed" guard below, not
 * after: this function can run a second time (once from this file's own
 * hashchange handler, once more if something else already closed the
 * overlay) and the teardown must happen on every call, not only the one that
 * also gets to call closeDsModal.
 *
 * This is the ONE close path allowed to run with a submit in flight -
 * js/app.js sweeps every open overlay on a hashchange and that sweep must
 * always win, so _busy is deliberately left untouched here: _submit's own
 * finally clears it once the fetch settles, and _reportError/_reportSuccess
 * notice the overlay is hidden by then and fall back to a toast. Never call
 * this for a person-initiated close (Escape, backdrop click, the X,
 * "Cancel") - go through _close() below, which refuses while busy.
 */
function _forceClose() {
  if (_pasteHandler) { document.removeEventListener('paste', _pasteHandler); _pasteHandler = null; }
  if (_keydownHandler) { document.removeEventListener('keydown', _keydownHandler); _keydownHandler = null; }
  if (_navHandler) { window.removeEventListener('hashchange', _navHandler); _navHandler = null; }
  const overlay = _overlay();
  if (!overlay || overlay.hidden) { _trigger = null; return; }
  closeDsModal(overlay);
  if (_trigger && typeof _trigger.focus === 'function' && document.contains(_trigger)) _trigger.focus();
  _trigger = null;
}

/**
 * Person-initiated close. Refuses outright while a submit is in flight -
 * _setBusyUi already disabled the X and "Cancel" and painted the hint
 * explaining why; this is the second line of defence for Escape and the
 * backdrop click, neither of which carries a disabled state of its own.
 */
function _close() {
  if (_busy) return;
  _forceClose();
}

/**
 * Open the "Send feedback" modal. Safe to call repeatedly - the overlay and its
 * delegated click/change listeners are wired once, the form is rebuilt fresh
 * every open.
 * @param {{trigger?: Element}} [opts]
 */
export async function openFeedbackModal(opts) {
  if (_busy) {
    // A previous submit is still in flight - its own modal may already be
    // hidden by a hashchange close (_forceClose). Reopening now would hand
    // out a fresh, enabled "Send" and let a second submit race the first
    // one; _busy is cleared by _submit's own finally once the fetch settles.
    showToast('warning', 'Report in progress', 'The previous report is still being sent.');
    return;
  }
  const overlay = _ensureOverlay();
  _wire(overlay);

  _type = 'bug';
  _attachments = [];
  _context = _captureContext();
  _trigger = (opts && opts.trigger) || null;

  const body = _bodyEl();
  if (body) body.innerHTML = _bodyHtml();
  const footer = _footerEl();
  if (footer) footer.innerHTML = _footerHtml();

  openDsModal(overlay);

  _pasteHandler = _onPaste;
  _keydownHandler = _onKeydown;
  // The one close this file must never refuse, even mid-submit - see
  // _forceClose's own comment.
  _navHandler = () => { _forceClose(); };
  document.addEventListener('paste', _pasteHandler);
  document.addEventListener('keydown', _keydownHandler);
  window.addEventListener('hashchange', _navHandler);
}
