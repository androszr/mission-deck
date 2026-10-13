// ── Mission Deck — js/proto-deploy-helpers.mjs ────────────────────────
// Pure decisions and the copy of the prototype publish window. No document access, so
// tests/test_proto_deploy.mjs reads this file directly - the same way
// js/stash-helpers.mjs sits next to js/stash-modal.js.

import { escHtml } from './utils.js';

/**
 * The publish confirmation copy - it says what is about to happen.
 * @param {{name?: string, id: string, invitationCode?: string|null}} item
 * @returns {string}
 */
export function deployConfirmHtml(item) {
  const code = item && item.invitationCode
    ? `Access code: <code class="proto-invitation-code">${escHtml(item.invitationCode)}</code>`
    : 'An access code will be assigned automatically.';
  return `<p>You are publishing the prototype <strong>${escHtml((item && (item.name || item.id)) || '')}</strong> to the team's shared hosting.</p>
    <p>Mission Deck copies the sources into the build shell, runs ESLint and a production build, and sends the result to the shell repository. The hosting that watches that repository finishes the publish, so the new version appears at the prototype address a few minutes later.</p>
    <p class="proto-deploy-code-info">${code}</p>`;
}

/**
 * The caption under the progress bar. An empty message does NOT clear the
 * previous one - a bar without a caption looks frozen, and the server sends
 * bare percentages during the long steps (npm install, build).
 * @param {number} pct
 * @param {string} [msg]
 * @param {string} [prev]
 * @returns {string}
 */
export function progressLabel(pct, msg, prev) {
  const n = Number(pct);
  const clamped = Math.max(0, Math.min(100, Number.isFinite(n) ? Math.round(n) : 0));
  return `${clamped}% · ${msg || prev || 'Working...'}`;
}

/**
 * The end-of-run copy. `url` is optional, because a dry run
 * (PROTO_DEPLOY_DRY_RUN) ends without sending. `pushed` says whether the commit
 * really went to the remote repository - then the address may still serve the
 * PREVIOUS version, because the hosting takes a few minutes to build and
 * publish, and without this line the "Open the published version" link looked
 * broken.
 * @param {{ok: boolean, message?: string, url?: string, pushed?: boolean, unsynced?: number}} d
 * @returns {string}
 */
export function deployResultHtml(d) {
  const ok = !!(d && d.ok !== false);
  const message = (d && d.message) || (ok ? 'Publishing started.' : 'Publishing failed.');
  const link = ok && d && d.url
    ? ` <a href="${escHtml(d.url)}" target="_blank" rel="noopener">Open the published version</a>`
    : '';
  const result = `<div class="ds-callout ds-callout--${ok ? 'success' : 'danger'}"><div>${escHtml(message)}${link}</div></div>`;
  return result + (ok ? pipelineDelayHtml(d && d.pushed) + unsyncedAfterDeployHtml(d && d.unsynced) : '');
}

/**
 * A note under a successful publish that the new version is NOT at the
 * address yet: the push starts the hosting build, which takes a few minutes,
 * and meanwhile the link opens the previous version. A dry run sends nothing,
 * so there is nothing to wait for -> empty string.
 * @param {boolean|undefined} pushed whether the commit went to the remote repository
 * @returns {string}
 */
export function pipelineDelayHtml(pushed) {
  if (!pushed) return '';
  return '<div class="ds-callout ds-callout--info proto-deploy-pipeline"><div>'
    + '<strong>The new version appears in a few minutes</strong> - the hosting still has to build '
    + 'and upload it. Until then the prototype address serves the previous version; '
    + 'reload the page after a few minutes.'
    + '</div></div>';
}

/**
 * A warning under a successful publish when team data has files waiting to
 * be sent. Publishing does NOT sync data: without that step the team sees the
 * new version at the prototype address while everyone in Mission Deck has the
 * old one - and the next publish from another computer hits the
 * `stale-source` gate (or, before it existed, undid this work on the hosting).
 * Zero files -> empty string.
 * @param {number|undefined} unsynced the number of files waiting to be sent in data-tier-0
 * @returns {string}
 */
export function unsyncedAfterDeployHtml(unsynced) {
  const n = Number(unsynced);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `<div class="ds-callout ds-callout--warning proto-deploy-unsynced"><div><strong>Team data is not sent</strong> - ${n} file(s) waiting to be sent. `
    + 'The published version is on the hosting but not in the shared repository: open <strong>Sync</strong> and send <code>data-tier-0</code>, '
    + 'or the next publish from another computer will undo this work.</div></div>';
}

/**
 * The stream error message. The 'error' event arrives in two shapes: a named
 * server event with a body, and a plain dropped connection without one. The
 * second must not pose as a server message.
 * @param {*} data the raw event body (a JSON string or nothing)
 * @returns {string}
 */
export function deployErrorMessage(data) {
  return deployErrorInfo(data).message;
}

/**
 * The full 'error' event body: the message plus the error code and - for a
 * `stale-source` refusal - the lists of files that caused it. A `null` code
 * means a dropped connection, not a server answer.
 * @param {*} data the raw event body (a JSON string or nothing)
 * @returns {{message: string, error: string|null, stale: string[], unknown: string[], files: string[]}}
 */
export function deployErrorInfo(data) {
  if (typeof data === 'string' && data.trim()) {
    try {
      const parsed = JSON.parse(data);
      if (parsed && parsed.message) {
        return {
          message: String(parsed.message),
          error: parsed.error ? String(parsed.error) : 'error',
          stale: Array.isArray(parsed.stale) ? parsed.stale.map(String) : [],
          unknown: Array.isArray(parsed.unknown) ? parsed.unknown.map(String) : [],
          files: Array.isArray(parsed.files) ? parsed.files.map(String) : [],
        };
      }
    } catch { /* not JSON - treat it as a dropped connection */ }
  }
  return {
    message: 'The connection to the publish stream was interrupted. Check that the Mission Deck server is running.',
    error: null,
    stale: [],
    unknown: [],
    files: [],
  };
}

/**
 * Whether the server refusal is `unsent-source`: prototype files are waiting
 * to be sent in team data. There is no "Publish anyway" - the only way
 * forward is to send the data, because the hosting must not run ahead of the
 * shared repository.
 * @param {{error: string|null}} info
 * @returns {boolean}
 */
export function isUnsentSourceError(info) {
  return Boolean(info && info.error === 'unsent-source');
}

/**
 * The `unsent-source` refusal copy: the server message and the list of files to send.
 * @param {{message: string, files: string[]}} info
 * @returns {string}
 */
export function unsentSourceHtml(info) {
  const files = info.files || [];
  const items = files.slice(0, 40).map((f) => `<li><code>${escHtml(f)}</code></li>`).join('');
  const more = files.length > 40 ? `<li>… and ${files.length - 40} more</li>` : '';
  const list = files.length ? `<ul class="proto-deploy-stale-list">${items}${more}</ul>` : '';
  return `<div class="ds-callout ds-callout--warning"><div><strong>Send the data first.</strong> ${escHtml(info.message || '')}${list}</div></div>`;
}

/**
 * Whether the server refusal is the `stale-source` gate, which a person may
 * override with an explicit "Publish anyway" (force=1). No other refusal -
 * ESLint, build, git - has such a button.
 * @param {{error: string|null}} info
 * @returns {boolean}
 */
export function isStaleSourceError(info) {
  return Boolean(info && info.error === 'stale-source');
}

/**
 * The `stale-source` refusal copy: the server message plus the file list, so
 * the person sees WHAT they would roll back on the hosting before clicking
 * "Publish anyway".
 * @param {{message: string, stale: string[], unknown: string[]}} info
 * @returns {string}
 */
export function staleSourceHtml(info) {
  const files = [...(info.stale || []), ...(info.unknown || [])];
  const items = files.slice(0, 40).map((f) => `<li><code>${escHtml(f)}</code></li>`).join('');
  const more = files.length > 40 ? `<li>… and ${files.length - 40} more</li>` : '';
  const list = files.length ? `<ul class="proto-deploy-stale-list">${items}${more}</ul>` : '';
  return `<div class="ds-callout ds-callout--warning"><div><strong>Publishing paused.</strong> ${escHtml(info.message || '')}${list}</div></div>`;
}

/**
 * The publish stream URL. `force` appends force=1 - the only way past the
 * `stale-source` gate.
 * @param {string} id
 * @param {boolean} [force]
 * @returns {string}
 */
export function deployStreamUrl(id, force) {
  return '/api/prototypes/deploy-stream?id=' + encodeURIComponent(id) + (force ? '&force=1' : '');
}

// ── Local preview: progress modal ────────────────────────────────────────────
//
// The phases in the order POST /api/prototypes/local-preview goes through them
// (server.js _protoPreviewPhase). Each has a caption and a "why this takes
// time" sentence - the person watching the modal should know whether the wait
// is normal.
export const PREVIEW_PHASES = Object.freeze([
  {
    id: 'prepare',
    label: 'Preparing sources',
    why: 'Copying the prototype files and the shared components into the build shell. Usually a few seconds.',
  },
  {
    id: 'install',
    label: 'Installing dependencies',
    why: 'Checking that the build shell has every package.',
  },
  {
    id: 'libs',
    label: 'Prototype libraries',
    why: 'Checking the libraries the prototype imports (e.g. PDF or Excel export) and installing any that are missing.',
  },
  {
    id: 'vite',
    label: 'Starting the preview server',
    why: 'Starting the local Vite server. The first time it prepares dependencies for the browser, which takes up to half a minute.',
  },
]);

/**
 * "12 s", "2 min 05 s". Negative and non-numeric -> "0 s".
 * @param {number} ms
 * @returns {string}
 */
export function formatElapsed(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return min > 0 ? `${min} min ${String(sec).padStart(2, '0')} s` : `${sec} s`;
}

/**
 * Explains the install phase from `install` in the status response.
 * A cold install (empty node_modules) takes minutes, and that must be said
 * plainly - otherwise the modal looks frozen.
 * @param {{cold?: boolean, attempt?: number, packages?: number}|null} install
 * @returns {string}
 */
export function installWhy(install) {
  if (!install) return PREVIEW_PHASES[1].why;
  let text;
  if (install.cold) {
    text = 'First preview on this computer: downloading the whole build environment - React, Vite, TypeScript and ESLint. That is a few hundred packages, so it usually takes 2-5 minutes. Later runs take a few seconds.';
  } else {
    text = 'Installing missing packages in the build shell. Usually a few seconds.';
  }
  const n = Number(install.packages) || 0;
  return n > 0 ? `${text} Packages downloaded: ${n}.` : text;
}

/**
 * The modal step list from GET /api/prototypes/local-preview-status.
 * Before the first response (status null) the first step is active.
 * @param {{phase?: string|null, phaseStartedAt?: number|null, now?: number, install?: object|null}|null} status
 * @returns {Array<{id: string, label: string, why: string, state: 'done'|'active'|'pending', elapsed: string}>}
 */
export function previewSteps(status) {
  const phase = (status && status.phase) || 'prepare';
  let activeIdx = PREVIEW_PHASES.findIndex((p) => p.id === phase);
  if (activeIdx < 0) activeIdx = 0;
  const phaseElapsed = status && status.now && status.phaseStartedAt
    ? formatElapsed(status.now - status.phaseStartedAt) : '';
  return PREVIEW_PHASES.map((p, i) => {
    const state = i < activeIdx ? 'done' : (i === activeIdx ? 'active' : 'pending');
    const why = p.id === 'install' && state === 'active' ? installWhy(status && status.install) : p.why;
    return { id: p.id, label: p.label, why, state, elapsed: state === 'active' ? phaseElapsed : '' };
  });
}

/**
 * HTML of the preview modal step list. Only the active step shows its
 * explanation - the rest are captions, so the list is not a wall of text.
 * @param {ReturnType<typeof previewSteps>} steps
 * @returns {string}
 */
export function previewStepsHtml(steps) {
  const mark = { done: '✓', active: '', pending: '' };
  return `<ol class="proto-preview-steps">${steps.map((s) => `<li class="proto-preview-step is-${s.state}"${s.state === 'active' ? ' aria-current="step"' : ''}>
      <span class="proto-preview-step-mark" aria-hidden="true">${mark[s.state]}</span>
      <div class="proto-preview-step-body">
        <div class="proto-preview-step-label">${escHtml(s.label)}${s.elapsed ? ` <span class="proto-preview-step-time">${escHtml(s.elapsed)}</span>` : ''}</div>
        ${s.state === 'active' ? `<div class="proto-preview-step-why">${escHtml(s.why)}</div>` : ''}
      </div>
    </li>`).join('')}</ol>`;
}
