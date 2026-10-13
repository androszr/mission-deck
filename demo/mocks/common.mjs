// demo/mocks/common.mjs
// Shared helpers for the mock painters. Every mock is a pure function
// (props) => HTML string, so tests/test_demo_scenario.mjs can import the whole
// mock registry under node and check ids and labels without a DOM.

/** @param {*} s @returns {string} HTML-escaped text */
export function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** A DS icon from the catalog, rendered the way the shell renders its own. */
export function icon(slug, extraClass = '') {
  return `<img class="nav-icon${extraClass ? ' ' + extraClass : ''}" src="/assets/icons/ds/${esc(slug)}.svg" alt="" aria-hidden="true">`;
}

/** One `obw-repo-row` (label + badge + optional message), the wizard's list row. */
export function repoRow({ label, badge, tone = 'gray', msg = '', extra = '', id = '' }) {
  return `<div class="obw-repo-row"${id ? ` id="${esc(id)}"` : ''}>
      <div class="obw-repo-row-main">
        <span class="obw-repo-label">${label}</span>
        <span class="ds-badge ds-badge--${esc(tone)} obw-repo-badge">${esc(badge)}</span>
        ${extra}
      </div>
      ${msg ? `<p class="obw-repo-msg">${msg}</p>` : ''}
    </div>`;
}

/** One sync-log-modal row, the same markup js/sync-log-modal.js renders. */
export function syncLogRow({ time = '', step, detail = '', status = 'ok' }) {
  const badge = { ok: 'ds-badge--green', skip: 'ds-badge--gray', fail: 'ds-badge--red' }[status] || 'ds-badge--gray';
  const label = { ok: 'OK', skip: 'SKIP', fail: 'FAIL' }[status] || String(status).toUpperCase();
  return `<div class="sync-log-modal__row${status === 'fail' ? ' sync-log-modal__row--fail' : ''}">
      <span class="sync-log-modal__row-time">${esc(time)}</span>
      <span class="sync-log-modal__row-label">${esc(step)}${detail ? `<span class="sync-log-modal__row-detail">${esc(detail)}</span>` : ''}</span>
      <span class="ds-badge ds-badge--sm ${badge}">${esc(label)}</span>
    </div>`;
}

/**
 * A modal overlay in the shape js/ds-modal.js confirmDsModal builds: header
 * with title and close, body, footer primary-first. `id` names the overlay so
 * a later `modal: { close }` action can find it.
 */
export function modalShell({ id, title, body, footer = '', size = '' }) {
  return `<div class="ds-modal-overlay" id="${esc(id)}" hidden>
    <div class="ds-modal${size ? ' ds-modal--' + esc(size) : ''}">
      <div class="ds-modal-header">
        <span class="ds-modal-title">${esc(title)}</span>
        <button type="button" class="ds-modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="ds-modal-body">${body}</div>
      ${footer ? `<div class="ds-modal-footer">${footer}</div>` : ''}
    </div>
  </div>`;
}
