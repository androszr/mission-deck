// demo/mocks/ch-sync.mjs
// Painters for chapter `sync` ("Encryption and data exchange"): an
// animated diagram of how a data source travels encrypted, and the sync center modal of
// js/sync-center-modal.js (table head, repo rows with the lowercase badges of
// repoStateBadge, module rows with the capitalised ones of moduleStateBadge,
// the four icon actions, the in-row ds-progress while a pull or push runs) on
// two computers. Repository labels, dates, counts and the module are
// fictitious; the sentences are the real ones of js/sync-center-modal.js.
// Pure (props) => htmlString, no network, no listeners.

import { esc } from './common.mjs';
import { fruitFaceFor } from '../../assets/avatars/fruit-avatars.mjs';

const SYNC_TITLE = 'The server state comes from the last fetch, not from a network query right now.';
const PULL_TIP = 'Fetch (syncs the whole source)';

/** Repo rows: fictitious labels and state. `push` = pushEnabled on that source. */
const REPOS = {
  'data-tier-0': { label: 'Team data', push: true },
  'data-reports': { label: 'Team reports', push: true },
  'data-leads': { label: 'Lead data', push: true },
  'data-docs': { label: 'Team knowledge base', push: false },
  'data-rollouts': { label: 'Rollouts', push: false },
};

/** Sam's computer after Alex's push: the same source, three files waiting. */
const JAN = {
  'data-tier-0': { badge: ['yellow', 'to fetch'], send: 0, fetch: 3, local: '03.10 17:40', remote: '04.10 09:44' },
  'data-reports': { badge: ['green', 'up to date'], send: 0, fetch: 0, local: '04.10 07:58', remote: '04.10 07:58' },
  'data-leads': { badge: ['green', 'up to date'], send: 0, fetch: 0, local: '02.10 11:20', remote: '02.10 11:20' },
};

/** Each repo's state at the start of the chapter. */
const START = {
  'data-tier-0': { badge: ['yellow', 'local changes'], send: 3, fetch: 0, local: '04.10 08:12', remote: '03.10 17:40' },
  'data-reports': { badge: ['yellow', 'to fetch'], send: 0, fetch: 4, local: '03.10 16:05', remote: '04.10 07:58' },
  'data-leads': { badge: ['yellow', 'local changes'], send: 1, fetch: 0, local: '04.10 08:30', remote: '02.10 11:20' },
  'data-docs': { badge: ['green', 'up to date'], send: 0, fetch: 0, local: '01.10 10:02', remote: '01.10 10:02' },
  'data-rollouts': { badge: ['yellow', 'not downloaded'], send: null, fetch: null, local: '', remote: '' },
};

const MODULES = {
  start: [
    { id: 'time-log', label: 'Time log', badge: ['yellow', 'To send'], send: 2, fetch: 0, local: '04.10 08:12', remote: '03.10 17:40' },
    { id: '_core', label: 'Cockpit Core', badge: ['yellow', 'To send'], send: 1, fetch: 0, local: '04.10 07:55', remote: '03.10 17:12' },
  ],
  incoming: [
    { id: 'time-log', label: 'Time log', badge: ['yellow', 'To fetch'], send: 0, fetch: 2, local: '03.10 17:40', remote: '04.10 09:44' },
    { id: '_core', label: 'Cockpit Core', badge: ['yellow', 'To fetch'], send: 0, fetch: 1, local: '03.10 17:12', remote: '04.10 09:44' },
  ],
  done: [
    { id: 'time-log', label: 'Time log', badge: ['green', 'Up to date'], send: 0, fetch: 0, local: '04.10 09:44', remote: '04.10 09:44' },
    { id: '_core', label: 'Cockpit Core', badge: ['green', 'Up to date'], send: 0, fetch: 0, local: '04.10 09:44', remote: '04.10 09:44' },
  ],
};

function _syncCell(local, remote) {
  return `<td class="scm-sync-cell" title="${SYNC_TITLE}">`
    + `<div class="scm-sync-line"><span class="scm-sync-ico scm-sync-ico--local" role="img" aria-label="Local" title="Local"></span>${esc(local || '-')}</div>`
    + `<div class="scm-sync-line"><span class="scm-sync-ico scm-sync-ico--remote" role="img" aria-label="Server" title="Server"></span>${esc(remote || '-')}</div></td>`;
}

function _iconBtn(ico, label, disabled, tip, id) {
  return `<button type="button" class="ds-icon-btn ds-icon-btn--sm"${id ? ` id="${esc(id)}"` : ''}${disabled ? ' disabled' : ''} data-tip="${esc(tip)}" aria-label="${esc(label)}">
        <span class="scm-action-ico scm-action-ico--${ico}" aria-hidden="true"></span>
      </button>`;
}

function _repoActions(repo, busy, exists) {
  const r = REPOS[repo];
  const pullLabel = exists ? 'Fetch' : 'Download repository';
  const pushTip = !r.push ? 'Sending this source is not available yet' : !exists ? 'Download this source first' : 'Send';
  return `<div class="scm-actions">
      ${_iconBtn('download', `${pullLabel} ${r.label}`, busy, pullLabel, `synchronizacja-pull-${repo}`)}
      ${_iconBtn('upload', `Send ${r.label}`, busy || !exists || !r.push, pushTip, `synchronizacja-push-${repo}`)}
      ${_iconBtn('changes', `Local changes ${r.label}`, busy || !exists || repo !== 'data-tier-0', exists ? 'Local changes' : 'Download this source first')}
      ${_iconBtn('copy', `Copy log ${r.label}`, false, 'Copy log')}
    </div>`;
}

function _progressCells(p) {
  return `<td colspan="3">
      <div class="ds-progress scm-prog">
        <div class="ds-progress-labels"><span class="scm-prog-step">${esc(p.step || 'Starting...')}</span><span>${esc(p.counter || '')}</span></div>
        <div class="ds-progress-track"><div class="ds-progress-fill ds-progress-fill--brand" style="width:${Number(p.pct) || 0}%"></div></div>
      </div>
    </td>`;
}

function _moduleRow(repo, m, busy) {
  const hasFiles = m.send > 0 || m.fetch > 0;
  const badge = hasFiles
    ? `<button type="button" class="ds-badge ds-badge--sm ds-badge--${m.badge[0]} scm-badge-btn" aria-expanded="false">${esc(m.badge[1])}</button>`
    : `<span class="ds-badge ds-badge--sm ds-badge--${m.badge[0]}">${esc(m.badge[1])}</span>`;
  const pushDisabled = busy || !m.send;
  const pushTip = busy ? 'Another operation is running on this source' : (!m.send ? 'Nothing to send' : 'Send');
  return `<tr class="scm-row--module${m.id === '_core' ? ' scm-row--core' : ''}">
      <td>${esc(m.label)}</td><td>${badge}</td><td>${m.send} / ${m.fetch}</td>${_syncCell(m.local, m.remote)}
      <td><div class="scm-actions">
        ${_iconBtn('download', `Fetch ${m.label}`, busy, PULL_TIP)}
        ${_iconBtn('upload', `Send ${m.label}`, pushDisabled, pushTip)}
        ${_iconBtn('changes', `Files ${m.label}`, !hasFiles, hasFiles ? 'Files to sync' : 'No files to show')}
        ${_iconBtn('copy', `Copy log ${m.label}`, false, 'Copy log')}
      </div></td>
    </tr>`;
}

/**
 * One repo group (_repoGroupMarkup): its own row, plus - for "Team data" -
 * the expanded module rows (`withModules`, first paint only - later repaints
 * replace the module tbody on its own). `state` overrides START; `progress`
 * swaps cells 2-4 for the in-row progress bar.
 */
function _group(repo, { state, progress, modules } = {}, withModules = false) {
  const r = REPOS[repo];
  const s = { ...START[repo], ...(state || {}) };
  const exists = s.send !== null;
  const hasModules = repo === 'data-tier-0';
  const chevron = hasModules
    ? `<button type="button" class="ds-icon-btn ds-icon-btn--sm scm-toggle scm-toggle--open" aria-expanded="true" aria-label="Collapse modules"><span class="scm-action-ico scm-action-ico--chevron" aria-hidden="true"></span></button>`
    : '<span class="scm-toggle-slot" aria-hidden="true"></span>';
  const label = hasModules
    ? `<span class="scm-repo-label scm-repo-label--toggle" role="button" tabindex="0" aria-expanded="true">${esc(r.label)}</span>`
    : `<span class="scm-repo-label">${esc(r.label)}</span>`;
  const badge = s.send > 0
    ? `<button type="button" class="ds-badge ds-badge--sm ds-badge--${s.badge[0]} scm-badge-btn" aria-expanded="false">${esc(s.badge[1])} (${s.send})</button>`
    : `<span class="ds-badge ds-badge--sm ds-badge--${s.badge[0]}">${esc(s.badge[1])}</span>`;
  const cells = progress
    ? `${_progressCells(progress)}<td>${_repoActions(repo, true, exists)}</td>`
    : `<td>${badge}</td><td>${exists ? `${s.send} / ${s.fetch}` : '—'}</td>${_syncCell(s.local, s.remote)}<td>${_repoActions(repo, false, exists)}</td>`;
  const mods = hasModules && withModules
    ? `<tbody class="scm-modules-group" id="synchronizacja-mods-${repo}">${(MODULES[modules] || MODULES.start).map((m) => _moduleRow(repo, m, !!progress)).join('')}</tbody>`
    : '';
  return `<tbody class="scm-repo-body" id="synchronizacja-grp-${repo}"><tr class="scm-row">
      <td>${chevron}${label}</td>
      ${cells}
    </tr></tbody>${mods}`;
}

function _scmModal({ viewer = 'alex' } = {}) {
  const jan = viewer === 'sam';
  return `<div class="ds-modal-overlay" id="synchronizacja-scm" hidden>
    <div class="ds-modal ds-modal--xl">
      <div class="ds-modal-header">
        <span class="ds-modal-title">Data sync</span>
        ${jan ? '<span class="ds-badge ds-badge--blue synchronizacja-machine-tag" id="synchronizacja-machine-tag">Sam’s computer</span>' : ''}
        <button type="button" class="ds-modal-close" aria-label="Close">&times;</button>
      </div>
      <div class="ds-modal-body" id="scm-body">
        <div class="scm-table-wrap">
        <table class="ds-table scm-table">
          <thead><tr><th>Repository</th><th>State</th><th>Send/fetch</th><th>Sync</th><th>Actions</th></tr></thead>
          ${Object.keys(REPOS).map((id) => _group(id, { state: jan ? JAN[id] : null, modules: jan ? 'incoming' : 'start' }, true)).join('')}
        </table>
        </div>
      </div>
      <div class="ds-modal-footer">
        <button type="button" class="ds-btn ds-btn--tertiary">Check server</button>
        <button type="button" class="ds-btn ds-btn--tertiary">Copy sync log</button>
        <button type="button" class="ds-btn ds-btn--secondary" id="synchronizacja-scm-ok">Close</button>
      </div>
    </div>
  </div>`;
}

// ── The encryption diagram (scripts/crypto-sync.js, as a picture) ──────

const PLAIN = ['team/team-members.json', 'academy/progress/person-a.json', 'prototypes/prototypes.json'];
const SEALED = ['v2:Qm9i…Xk2a.enc', 'v2:Z3Jl…p0Rt.enc', 'v2:dGVh…7uYw.enc'];

const DIAGRAM_LABELS = [
  'Your computer', 'Plaintext folder', 'Encryption', 'AES-256-GCM, every file separately',
  'File key derived from your line in .encryption-key (HKDF)', 'File names are encrypted too',
  'Mirror to send', 'Only .enc files', 'GitLab', 'The repository sees only ciphertext',
  'A colleague’s computer', 'Pulls the mirror and decrypts it with its own key line', 'Plaintext folder at the colleague’s',
  'The Mission Deck server encrypts and decrypts — deterministic code, not AI.',
  'How team data travels between computers', 'One data source, from the plaintext folder on your disk to a colleague’s computer.',
  'Sam’s computer',
];

function _files(list, sealed) {
  return `<ul class="synchronizacja-files${sealed ? ' synchronizacja-files--sealed' : ''}">${list.map((f) => `<li><code>${esc(f)}</code></li>`).join('')}</ul>`;
}

function _node(cls, title, sub, body, on, fresh) {
  return `<div class="ds-card synchronizacja-node ${cls}${on ? ' synchronizacja-node--on' : ''}${fresh ? ' synchronizacja-node--fresh' : ''}">
      <div class="ds-card-body"><div class="synchronizacja-node-title">${esc(title)}</div>
      <div class="synchronizacja-node-sub">${sub}</div>${body}</div></div>`;
}

function _arrow(on, fresh, label) {
  return `<div class="synchronizacja-arrow${on ? ' synchronizacja-arrow--on' : ''}${fresh ? ' synchronizacja-arrow--fresh' : ''}" aria-hidden="true">
      <span class="synchronizacja-arrow-line"><i></i><i></i><i></i></span>${label ? `<span class="synchronizacja-arrow-label">${esc(label)}</span>` : ''}</div>`;
}

/** Four stages: plaintext -> sealed per file -> GitLab -> a colleague decrypts. */
function _diagram({ stage = 1 } = {}) {
  const n = Number(stage) || 1;
  return `<div class="synchronizacja-diagram" id="synchronizacja-diagram" data-stage="${n}">
    <div class="synchronizacja-diagram-head">
      <h2 class="synchronizacja-diagram-title">How team data travels between computers</h2>
      <p class="synchronizacja-diagram-lead">One data source, from the plaintext folder on your disk to a colleague’s computer.</p>
    </div>
    <div class="synchronizacja-diagram-row">
      ${_node('synchronizacja-node--plain', 'Your computer', 'Plaintext folder <code>data-sub-repositories/ds-data/</code>', _files(PLAIN, false), n >= 1, n === 1)}
      ${_arrow(n >= 2, n === 2, '')}
      ${_node('synchronizacja-node--crypt', 'Encryption', 'AES-256-GCM, every file separately', `<ul class="synchronizacja-points">
          <li>File key derived from your line in <code>.encryption-key</code> (HKDF)</li>
          <li>File names are encrypted too</li></ul>`, n >= 2, n === 2)}
      ${_arrow(n >= 2, n === 2, '')}
      ${_node('synchronizacja-node--mirror', 'Mirror to send', 'Only .enc files — <code>ds-data-encrypted/</code>', _files(SEALED, true), n >= 2, n === 2)}
      ${_arrow(n >= 3, n === 3, 'git push')}
      ${_node('synchronizacja-node--gitlab', 'GitLab', 'The repository sees only ciphertext', _files(SEALED, true), n >= 3, n === 3)}
      ${_arrow(n >= 4, n === 4, 'git pull')}
      ${_node('synchronizacja-node--peer', 'A colleague’s computer', 'Pulls the mirror and decrypts it with its own key line', `${_files(PLAIN, false)}<div class="synchronizacja-key"><code>ds-data=••••••••••••</code></div>`, n >= 4, n === 4)}
    </div>
    <p class="synchronizacja-diagram-note">The Mission Deck server encrypts and decrypts — deterministic code, not AI.</p>
  </div>`;
}

export const MOCKS = {
  /** `{ viewer: 'alex'|'sam' }` - the same table on two computers. */
  'synchronizacja-scm': (p) => _scmModal(p),
  /** One repo group, `{ repo, state?, progress? }`, painted with mode 'outer' over the old one. */
  'synchronizacja-group': ({ repo = 'data-reports', state, progress } = {}) => _group(repo, { state, progress }),
  /** Module rows of "Team data", `{ modules: 'start'|'done'|'incoming', busy }`. */
  'synchronizacja-mods': ({ modules = 'start', busy = false } = {}) => `<tbody class="scm-modules-group" id="synchronizacja-mods-data-tier-0">${(MODULES[modules] || MODULES.start).map((m) => _moduleRow('data-tier-0', m, busy)).join('')}</tbody>`,
  /** The encryption diagram, `{ stage: 1..4 }`. */
  'synchronizacja-diagram': (p) => _diagram(p),
  /** A full-screen cut card: "on the other computer". */
  'synchronizacja-switch': () => `<div class="synchronizacja-switch"><div class="ds-card synchronizacja-switch-card"><div class="ds-card-body">
      <span class="synchronizacja-switch-avatar demo-fruit">${fruitFaceFor('Sam Rivera')}</span>
      <div><div class="synchronizacja-switch-title">Meanwhile, on Sam Rivera’s computer</div>
      <div class="synchronizacja-switch-sub">The same Mission Deck, its own key line in the .encryption-key file</div></div>
    </div></div></div>`,
  /** Top-bar avatar of the colleague (js/topbar.js user slot). */
  'synchronizacja-user-jan': () => '<span class="ds-badge ds-badge--blue synchronizacja-machine" id="synchronizacja-machine">Sam’s computer</span><button type="button" class="app-top-bar__user-btn" title="Sam Rivera" aria-label="Sam Rivera"><span class="app-top-bar__user-initials demo-fruit">' + fruitFaceFor('Sam Rivera') + '</span></button>',
};

/** Every visible label these painters paint (copy gate). */
export const LABELS = [
  'Data sync', 'Repository', 'State', 'Send/fetch', 'Sync', 'Actions', 'Check server',
  'Copy sync log', 'Close', 'Local', 'Server', 'Meanwhile, on Sam Rivera’s computer',
  'The same Mission Deck, its own key line in the .encryption-key file', ...DIAGRAM_LABELS,
  ...Object.values(REPOS).map((r) => r.label),
];
