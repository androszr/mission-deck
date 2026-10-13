// demo/mocks/ch-updates.mjs
// Painters for chapter `updates`: the app update strip (#app-update-banner,
// js/update-banner.js), the version card of Settings > System with its result
// callout (js/settings.js renderAppVersionBlock + the dirty-tree and stash-note
// callouts of js/app-update-stash.mjs), the browser confirm the stash button
// raises (stashConfirmText), the top-bar "Stash" pill and its modal
// (js/topbar.js, js/stash-modal.js, js/stash-helpers.mjs) and the infra strip
// (#infra-banner, js/infra-banner.js, kind `network`). File names, hashes and
// dates are fictitious; every sentence is the real one.
// Pure (props) => htmlString, no network, no listeners.

import { esc } from './common.mjs';

const BOX_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>';

const OLD = { label: 'v2.3.1 (a1b2c3d)', date: '28.09.2026, 16:40' };
const NEW = { label: 'v2.4.0 (e5f6a7b)', date: '04.10.2026, 09:12' };

/** The three files the tree carries when the update is clicked. */
export const DIRTY = ['styles.css', 'js/weekly-report.js', 'docs/guides/my-notes.md'];
const STASH_MSG = 'mission-deck-update 2026-10-04T07:12:41.508Z v2.3.1';
const STASH_SHA = '7c1e9a0b42d8f3e5a6c1';
const STASH_WHEN = '04.10.2026, 09:12';

const DIRTY_MESSAGE = `The working tree has unsaved changes (${DIRTY.length}): ${DIRTY.join(', ')}. The update would overwrite them. `
  + 'Commit them, stash them by hand, or let the app stash them and try again.';

/** stashNoteSentences({ ref: 'stash@{0}', count: 3 }). */
const NOTE_LINES = [
  'Your local changes (3 files) sit on the stash as stash@{0}.',
  'The app never runs git stash pop — after the restart you get them back yourself, e.g. git stash show -p stash@{0} (preview) or git stash pop.',
  'Note: after the hard reset the stash base is no longer HEAD, so a pop over anything non-trivial ends in a conflict to resolve by hand.',
  'The stash also took edits nobody typed (model: lines from Settings > Agents, the GitNexus block) — they are harmless, the update overwrites them anyway, and the model preferences come back on the next start.',
  'This note is only a convenience saved in this browser — in another browser or in private mode you will not see it. The reliable record is git stash list in the Mission Deck folder.',
];

function _noteHtml(headline, { trailing = '', dismiss = false } = {}) {
  return '<div class="upd-dirty">'
    + `<p class="upd-dirty__headline">${esc(headline)}</p>`
    + NOTE_LINES.map((s) => `<p class="upd-dirty__line">${esc(s)}</p>`).join('')
    + `<p class="upd-dirty__line">Stash entry: <code>${esc(STASH_MSG)}</code></p>`
    + (trailing ? `<p class="upd-dirty__line">${esc(trailing)}</p>` : '')
    + (dismiss ? '<div class="upd-dirty__actions"><button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" id="aktualizacja-note-dismiss">Got it, hide</button></div>' : '')
    + '</div>';
}

/**
 * The result area under the version card, by `state`:
 * checking | available | downloading | dirty | stashing | updated | note.
 */
function _result(state) {
  const cls = {
    checking: 'info', available: 'warning', downloading: 'info', dirty: 'danger',
    stashing: 'info', updated: 'success', note: 'warning',
  }[state];
  if (!cls) return '<div class="sett-version-result" id="aktualizacja-result" hidden></div>';
  let inner = '';
  if (state === 'checking') inner = 'Checking...';
  else if (state === 'available') inner = 'A new version is available. <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="aktualizacja-update-now">Update now</button>';
  else if (state === 'downloading') inner = 'Downloading the update... This can take up to a minute.';
  else if (state === 'stashing') inner = 'Stashing the changes and downloading the update... This can take up to a minute.';
  else if (state === 'dirty') {
    inner = '<div class="upd-dirty">'
      + `<p class="upd-dirty__headline">${esc('Update failed: ' + DIRTY_MESSAGE)}</p>`
      + `<ul class="upd-dirty__files">${DIRTY.map((f) => `<li class="upd-dirty__file"><code>${esc(f)}</code></li>`).join('')}</ul>`
      + '<div class="upd-dirty__actions"><button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="aktualizacja-stash-btn">Stash the changes and update</button>'
      + '<span class="upd-dirty__hint">The app does not run <code>git stash pop</code> — after the restart you get them back yourself.</span></div>'
      + '</div>';
  } else if (state === 'updated') {
    inner = _noteHtml('Updated. Restarting the server — the page will reload automatically...', { trailing: 'This message stays here after the restart until you close it.' });
  } else if (state === 'note') {
    inner = _noteHtml(`Since the last update your changes are waiting on the stash (${STASH_WHEN}).`, { dismiss: true });
  }
  return `<div class="sett-version-result ds-callout ds-callout--${cls}" id="aktualizacja-result">${inner}</div>`;
}

/** renderAppVersionBlock: the hero card, `{ fresh, state }`. */
function _versionCard({ fresh = false, state = '' } = {}) {
  const v = fresh ? NEW : OLD;
  return `<div class="ds-card sett-hero-card" id="aktualizacja-version-card">
      <div class="ds-card-header">
        <span class="sett-hero-card__icon">${BOX_SVG}</span>
        <span class="ds-card-title">App version</span>
        <span class="ds-badge ds-badge--green">${esc(v.label)}</span>
      </div>
      <div class="ds-card-body">
        <div class="sett-version-info">
          <div class="sett-version-row"><span class="sett-version-label">Current version</span><span class="sett-version-value">${esc(v.label + ' · ' + v.date)}</span></div>
          <div class="sett-version-row"><span class="sett-version-label">Repository</span><span class="sett-version-value">https://gitlab.example.test/team/mission-deck</span></div>
        </div>
        <div class="aktualizacja-check-row">
          <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="aktualizacja-check-btn">Check for updates</button>
        </div>
        ${_result(state)}
      </div>
    </div>`;
}

/** The other two System cards (renderSyncSection, renderThemeSection), static here. */
function _systemCards() {
  return `<div class="ds-card sett-sys-card">
      <div class="ds-card-header"><span class="ds-card-title">Data sync</span></div>
      <div class="ds-card-body">
        <p class="aktualizacja-sys-desc">Data repository <code>data-tier-0</code>. Sync is manual — here or with the "Sync" button in the top bar. Nothing is fetched or sent in the background.</p>
        <div class="aktualizacja-sys-status"><span>Status:</span><span class="ds-badge ds-badge--green">Ready</span><span>last: 04.10.2026, 08:55</span></div>
        <div class="aktualizacja-sys-actions">
          <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm">Pull changes</button>
          <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm">Push changes</button>
        </div>
      </div>
    </div>`;
}

function _themeCard() {
  return `<div class="ds-card sett-sys-card">
      <div class="ds-card-header"><span class="ds-card-title">Theme</span></div>
      <div class="ds-card-body">
        <p class="aktualizacja-sys-desc">Choose the interface look: light, dark or following the system settings.</p>
        <div class="ds-segmented">
          <button type="button" class="ds-segment">Light</button>
          <button type="button" class="ds-segment">Dark</button>
          <button type="button" class="ds-segment active">System</button>
        </div>
      </div>
    </div>`;
}

/** The strip in its single-item state (_fillItemInto, kind 'app'). `hidden` = gone after the restart. */
function _updateBanner({ hidden = false } = {}) {
  return `<div id="app-update-banner" class="app-update-banner${hidden ? ' app-update-banner--hidden' : ''}" role="status" aria-live="polite">
    ${hidden ? '' : `<div class="app-update-banner__row">
      <span class="app-update-banner__msg">A new version of the app is available.</span>
      <button type="button" class="app-update-banner__btn">Update</button>
      <button type="button" class="app-update-banner__dismiss" aria-label="Close">✕</button>
    </div><div class="app-update-banner__list" hidden></div>`}
  </div>`;
}

/** #infra-banner, kind network; `checking` while "Check again" runs. */
function _infraBanner({ hidden = false, checking = false } = {}) {
  return `<div id="infra-banner" class="app-update-banner app-update-banner--infra${hidden ? ' app-update-banner--hidden' : ''}" role="status" aria-live="polite" data-kind="network">
    ${hidden ? '' : `<div class="app-update-banner__row">
      <span class="app-update-banner__msg">No connection to the Mission Deck infrastructure - GitLab is not answering. Turn on the VPN and check again.</span>
      <button type="button" class="app-update-banner__btn" id="aktualizacja-recheck"${checking ? ' disabled' : ''}>${checking ? 'Checking…' : 'Check again'}</button>
      <button type="button" class="app-update-banner__dismiss" aria-label="Close">✕</button>
    </div>`}
  </div>`;
}

/** The browser's own confirm() with stashConfirmText(body) - painted, never raised. */
function _confirm() {
  const text = [
    'Stash 3 files and update Mission Deck?',
    '',
    DIRTY.map((f) => '• ' + f).join('\n'),
    '',
    'The changes go to the stash (new, unadded files too), then the app downloads the new version and restarts the server.',
    'The app does not run git stash pop — after the restart you get them back from the “Stash” pill in the top bar.',
  ].join('\n');
  return `<div class="ds-modal-overlay" id="aktualizacja-confirm" hidden>
    <div class="aktualizacja-confirm" role="alertdialog" aria-modal="true">
      <div class="aktualizacja-confirm-origin">Message from localhost:3001</div>
      <pre class="aktualizacja-confirm-text">${esc(text)}</pre>
      <div class="aktualizacja-confirm-actions">
        <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm">Cancel</button>
        <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" id="aktualizacja-confirm-ok">OK</button>
      </div>
    </div>
  </div>`;
}

/** js/topbar.js _renderStashPill for one entry. */
function _stashPill() {
  const title = 'Your stashed changes: 1 stash. Click to apply, preview or remove.';
  return `<button type="button" class="sidebar-ai-toggle-btn topbar-stash-btn" id="aktualizacja-stash-pill" title="${esc(title)}" aria-label="${esc(title)}">`
    + '<img class="nav-icon" src="/assets/icons/ds/24-ic-saved-order.svg" alt="" aria-hidden="true"><span>Stash</span></button>';
}

/** js/stash-modal.js _paintList with one Mission Deck entry (stashEntryCardHtml). */
function _stashModal() {
  const intro = [
    'Here are your changes that Mission Deck stashed before an update, and anything you stashed yourself with git stash.',
    'The app never runs git stash pop — “Apply changes” uses git stash apply, so the entry stays in place and a failed merge deletes nothing.',
    'An entry from before an update is based on a commit that no longer exists, so conflicts are normal here. The easiest way: copy the command for Claude and paste it in the terminal — it moves the changes for you.',
  ];
  return `<div class="ds-modal-overlay" id="aktualizacja-stash-modal" hidden>
    <div class="ds-modal ds-modal--lg stash-modal" role="dialog" aria-modal="true">
      <div class="ds-modal-header">
        <h2 class="ds-modal-title">Stashed changes (stash)</h2>
        <button type="button" class="ds-modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="ds-modal-body">
        ${intro.map((l) => `<p class="stash-modal__intro">${esc(l)}</p>`).join('')}
        <p class="stash-modal__count">1 stash on this machine, newest first:</p>
        <div class="stash-entry">
          <div class="stash-entry__head">
            <p class="stash-entry__title">Changes stashed before a Mission Deck update</p>
            <span class="ds-badge ds-badge--sm ds-badge--blue">from Mission Deck</span>
          </div>
          <p class="stash-entry__meta">${STASH_WHEN} · <code>stash@{0}</code> · <code>${STASH_SHA.slice(0, 10)}</code></p>
          <p class="stash-entry__meta">Entry name: <code>${esc(STASH_MSG)}</code></p>
          <div class="stash-entry__actions">
            <button type="button" class="ds-btn ds-btn--primary ds-btn--sm">Apply changes</button>
            <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="aktualizacja-stash-files">Show files</button>
            <button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm">Copy name</button>
            <button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm">Copy command for Claude</button>
            <button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm stash-entry__drop">Delete entry</button>
          </div>
          <div class="stash-entry__slot" id="aktualizacja-stash-slot"></div>
        </div>
      </div>
      <div class="ds-modal-footer"><button type="button" class="ds-btn ds-btn--secondary" id="aktualizacja-stash-close">Close</button></div>
    </div>
  </div>`;
}

export const MOCKS = {
  'aktualizacja-update-banner': (p) => _updateBanner(p),
  'aktualizacja-infra-banner': (p) => _infraBanner(p),
  'aktualizacja-version-card': (p) => _versionCard(p),
  'aktualizacja-result': ({ state = '' } = {}) => _result(state),
  'aktualizacja-sync-card': () => _systemCards(),
  'aktualizacja-theme-card': () => _themeCard(),
  'aktualizacja-confirm': () => _confirm(),
  'aktualizacja-stash-pill': () => _stashPill(),
  'aktualizacja-stash-modal': () => _stashModal(),
  /** stashFilesHtml(files) under the entry after "Show files". */
  'aktualizacja-stash-files': () => `<p class="stash-entry__note">3 files in this entry:</p><ul class="stash-entry__files">${DIRTY.map((f) => `<li><code>${esc(f)}</code></li>`).join('')}</ul>`,
  /** The blank instant of location.reload() after the restart. */
  'aktualizacja-reload': () => '<div class="aktualizacja-reload" aria-hidden="true"></div>',
};

/** Every visible label these painters paint (copy gate). */
export const LABELS = [
  'A new version of the app is available.', 'Update', 'App version', 'Current version', 'Repository',
  'Check for updates', 'Checking...', 'A new version is available.', 'Update now',
  'Downloading the update... This can take up to a minute.',
  'Stashing the changes and downloading the update... This can take up to a minute.',
  'Stash the changes and update', 'Got it, hide', 'Data sync', 'Pull changes', 'Push changes',
  'Theme', 'Light', 'Dark', 'System', 'Check again', 'Checking…', 'Stashed changes (stash)',
  'Changes stashed before a Mission Deck update', 'from Mission Deck', 'Apply changes', 'Show files', 'Copy name',
  'Copy command for Claude', 'Delete entry', 'Close', 'Cancel', 'Message from localhost:3001',
  'No connection to the Mission Deck infrastructure - GitLab is not answering. Turn on the VPN and check again.',
  DIRTY_MESSAGE, ...NOTE_LINES,
];
