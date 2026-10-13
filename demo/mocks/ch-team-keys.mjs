// demo/mocks/ch-team-keys.mjs
// Painters for chapter `team-keys`: the "GitLab project tokens"
// card and its "New GitLab tokens" modal (js/settings.js
// _renderGitlabTokenCard / _openGitlabTokensModal / _runGitlabTokenBatch),
// and the wizard's "Step 4 - Encryption keys" card (js/onboarding-wizard.js
// _paintStep4 / _runKeySaveFlow / _runDecryptFlow). The Bitwarden side (new
// collection, its access list, Send) reuses the vault mocks of
// demo/mocks/onboarding.mjs through their registry ids.
// Real classes (gtc-*, obw-*, sett-*), invented data. No secret is ever shown:
// a token is a masked preview, a key never leaves the clipboard in the real
// app and appears here only as an obvious DEMO placeholder.
// Ids this file creates start with `klucze-dla-zespolu-`.

import { esc, modalShell } from './common.mjs';

const P = 'klucze-dla-zespolu-';

const KEY_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>';

/** GITLAB_TOKEN_TARGETS rows (server.js), with invented project paths. */
export const TARGETS = [
  { id: 'app', label: 'App repository', purpose: 'The Mission Deck code: pulling app updates, pushing working branches and opening merge requests.', path: 'team/mission-deck', envVar: 'COCKPIT_APP_TOKEN', bwItem: 'COCKPIT-APP', level: '30' },
  { id: 'data', label: 'Starter data repository', purpose: 'This Mission Deck’s team data — the people directory, prototypes, Academy progress. Without it, sync can neither pull nor push anything.', path: 'team/ds-data-tier-0', envVar: 'COCKPIT_DATA_TOKEN', bwItem: 'COCKPIT-DATA', level: '40' },
  { id: 'modules', label: 'Module catalog repository', purpose: 'The shared module catalog: installing the team’s modules and publishing your own through a merge request.', path: 'team/mission-deck-modules', envVar: 'COCKPIT_MODULES_TOKEN', bwItem: 'COCKPIT-MODULES', level: '30' },
  { id: 'data-finance', label: 'Data repository - Team finance', purpose: 'The team’s financial data - pulling and pushing this source in the Sync window. Access for POs only.', path: 'team/data-finance', envVar: 'COCKPIT_DATA_EXTRA_0_TOKEN', bwItem: 'COCKPIT-DATA-EXTRA-0', level: '30' },
  { id: 'data-design', label: 'Data repository - Design data', purpose: 'The whole team’s design data - pulling and pushing this source in the Sync window.', path: 'team/data-design', envVar: 'COCKPIT_DATA_EXTRA_1_TOKEN', bwItem: 'COCKPIT-DATA-EXTRA-1', level: '30' },
];

const LEVELS = [
  { value: '10', label: 'Guest (10)' },
  { value: '20', label: 'Reporter (20)' },
  { value: '30', label: 'Developer (30)' },
  { value: '40', label: 'Maintainer (40)' },
  { value: '50', label: 'Owner (50)' },
];

/** The ticked rows of the demo run: who gets what. */
export const PICKED = ['app', 'data', 'data-design'];

function card() {
  return `<div class="ds-card sett-secret-card sett-secret-card--wide">
    <div class="sett-secret-card__head">
      <span class="sett-secret-card__icon">${KEY_SVG}</span>
      <span class="sett-secret-card__title">GitLab project tokens</span>
      <span class="ds-badge ds-badge--green">ready</span>
    </div>
    <p class="sett-secret-card__hint">One wizard for every repository: you tick which ones need a token and they are created in one run. Each is valid for 12 months, and you see its value once.</p>
    <div class="sett-secret-card__rows">
      <div class="sett-secret-row"><span class="sett-secret-row__label">Repositories</span><span class="sett-profile-value">${TARGETS.length} to choose from</span></div>
    </div>
    <div class="sett-section-card__tokens">${TARGETS.map((t) => `<span class="sett-token-name">${esc(t.envVar)}</span>`).join('')}</div>
    <div class="sett-secret-card__actions">
      <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" id="${P}open-btn">Create tokens</button>
    </div>
  </div>`;
}

function repoRow(t, checked) {
  return `<div class="gtc-repo-row" id="${P}row-${esc(t.id)}">
    <label class="gtc-repo-check">
      <input type="checkbox" class="gtc-repo-cb" id="${P}cb-${esc(t.id)}"${checked ? ' checked' : ''} tabindex="-1">
      <span class="gtc-repo-text" title="Key ${esc(t.envVar)}, Bitwarden item: ${esc(t.bwItem)}.">
        <span class="gtc-repo-name">${esc(t.label)}</span>
        <span class="gtc-repo-purpose">${esc(t.purpose)}</span>
        <span class="gtc-repo-path">${esc(t.path)}</span>
      </span>
    </label>
    <div class="gtc-role-wrap">
      <select class="ds-input gtc-role-sel" id="${P}level-${esc(t.id)}" aria-label="Access level — ${esc(t.label)}" tabindex="-1">
        ${LEVELS.map((l) => `<option value="${l.value}"${l.value === t.level ? ' selected' : ''}>${esc(l.label)}</option>`).join('')}
      </select>
    </div>
  </div>`;
}

function formPanel(checked) {
  return `<div data-gtc-panel="form">
    <p class="sett-field-hint">Each token is created in its own project, named
      <code>first-last-&lt;SUFFIX&gt;</code>, valid for 12 months. The server sets the scopes
      separately for each repository.</p>
    <div class="gtc-name-grid">
      <div class="sett-field-row sett-field-row--stacked">
        <label for="${P}first">First name</label>
        <input type="text" class="ds-input" id="${P}first" autocomplete="off" value="Alex" tabindex="-1">
      </div>
      <div class="sett-field-row sett-field-row--stacked">
        <label for="${P}last">Last name</label>
        <input type="text" class="ds-input" id="${P}last" autocomplete="off" value="Morgan" tabindex="-1">
      </div>
    </div>
    <div class="gtc-repos">
      <div class="gtc-repos-head">
        <span class="gtc-repos-title">Repositories — tick at least one</span>
        <label class="gtc-repos-all"><input type="checkbox" tabindex="-1"> Select all</label>
      </div>
      <div class="gtc-repo-list">${TARGETS.map((t) => repoRow(t, checked.includes(t.id))).join('')}</div>
    </div>
  </div>`;
}

function formFooter(enabled) {
  return `<button type="button" class="ds-btn ds-btn--primary" id="${P}submit"${enabled ? '' : ' disabled'}>Create</button>
    <button type="button" class="ds-btn ds-btn--secondary">Cancel</button>`;
}

/** One result row; `state` is queue | busy | done. */
function resultRow(t, state) {
  let status = '<span class="ds-badge ds-badge--gray">queued</span>';
  if (state === 'busy') status = '<span class="ds-badge ds-badge--blue">creating…</span>';
  if (state === 'done') {
    status = '<span class="ds-badge ds-badge--green">ready</span>'
      + `<code class="gtc-result-preview" title="valid until 04.10.2027">glpat-DEMO••••••••</code>`
      + `<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" id="${P}copy-${esc(t.id)}">Copy item</button>`;
  }
  return `<div class="gtc-result-row" id="${P}result-${esc(t.id)}">
    <div class="gtc-result-info">
      <span class="gtc-result-repo">${esc(t.label)}</span>
      <span class="gtc-result-keys"><code>${esc(t.envVar)}</code> &rarr; <code>${esc(t.bwItem)}</code></span>
    </div>
    <div class="gtc-result-status">${status}</div>
  </div>`;
}

function resultPanel(states) {
  const rows = TARGETS.filter((t) => PICKED.includes(t.id));
  return `<div data-gtc-panel="result">
    <div class="ds-callout ds-callout--success">
      <div>
        <strong>The tokens are being created. Copy them now — GitLab will not show these values a second time.</strong>
        <ol class="sett-steps">
          <li>On each row click <strong>Copy item</strong>. The whole line
              <code>KEY=&lt;token&gt;</code> goes to the clipboard, ready to paste.</li>
          <li>Open the Bitwarden item named on the row and paste the line into the
              <strong>notes</strong> field. If a line with that key is already there — replace it.</li>
          <li>Clear the clipboard.</li>
        </ol>
        This app does not store tokens: neither in the vault nor in the <code>.env</code> file.
      </div>
    </div>
    <div class="gtc-result-list">${rows.map((t, i) => resultRow(t, states[i] || 'queue')).join('')}</div>
  </div>`;
}

// ── Wizard, step 4 ─────────────────────────────────────────────────────

/** Rows of the key list (_paintStep4): id, label, present, action. */
const KEY_ROWS = {
  admin: [
    { id: 'ds-data', label: 'Team data', present: true, action: 'copy' },
    { id: 'data-design', label: 'Design data', present: true, action: 'copy' },
    { id: 'data-finance', label: 'Team finance', present: true, action: 'copy' },
  ],
  newcomer: [
    { id: 'ds-data', label: 'Team data', present: true, action: '' },
    { id: 'data-design', label: 'Design data', present: false, action: '' },
  ],
};

function keyRow(r) {
  let btn = '';
  if (r.action === 'copy') btn = `<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="${P}copykey-${esc(r.id)}" data-obw-copy-key="${esc(r.id)}">Copy key</button>`;
  return `<div class="obw-repo-row">
      <div class="obw-repo-row-main">
        <span class="obw-repo-label">${esc(r.label)} <code>${esc(r.id)}</code></span>
        <span class="ds-badge ${r.present ? 'ds-badge--green' : 'ds-badge--gray'} obw-repo-badge">${r.present ? 'Key present' : 'No key'}</span>
        ${btn}
      </div>
      ${r.present ? '' : `<p class="obw-repo-msg">Paste a <code>${esc(r.id)}=key</code> line above and save.</p>`}
    </div>`;
}

function keyRows({ side = 'admin', present = [] } = {}) {
  return (KEY_ROWS[side] || KEY_ROWS.admin).map((r) => keyRow({ ...r, present: r.present || present.includes(r.id) })).join('');
}

/** A status row of the save / decrypt lists (_addRepoRow + _setRepoRow). */
function statusRow({ label = '', tone = 'gray', text = '', msg = '', id = '' } = {}) {
  return `<div class="obw-repo-row"${id ? ` id="${esc(id)}"` : ''}>
      <div class="obw-repo-row-main">
        <span class="obw-repo-label">${esc(label)}</span>
        <span class="ds-badge ds-badge--${esc(tone)} obw-repo-badge">${esc(text)}</span>
      </div>
      ${msg ? `<p class="obw-repo-msg">${esc(msg)}</p>` : ''}
    </div>`;
}

function wizard({ side = 'admin' } = {}) {
  const ids = side === 'newcomer' ? 'ds-data, data-design' : 'ds-data, data-design, data-finance';
  return `<div class="obw-wrap">
      <div class="page-header obw-header">
        <div class="page-header-row">
          <div>
            <h1>Welcome to the Mission Deck community</h1>
            <div class="subtitle">Let’s set up your Mission Deck in seven steps. The order is a hint, not a rule — every step checks on its own whether it is already done.</div>
          </div>
        </div>
      </div>
      ${['Step 1 — Environment', 'Step 2 — Bitwarden', 'Step 3 — Access to the app repository'].map((t) => `<div class="ds-card obw-step-card">
        <div class="ds-card-header"><span class="ds-card-title">${esc(t)}</span><span class="ds-badge ds-badge--green">Done</span></div>
      </div>`).join('')}
      <div class="ds-card obw-step-card" id="${P}step4-card">
        <div class="ds-card-header">
          <span class="ds-card-title">Step 4 — Encryption keys</span>
          <span class="ds-badge ${side === 'newcomer' ? 'ds-badge--gray' : 'ds-badge--green'}" id="${P}step4-chip">${side === 'newcomer' ? 'Missing' : 'Done'}</span>
        </div>
        <div class="ds-card-body">
          <p class="obw-step-desc">Team data travels encrypted. Paste the keys as <code>repoId=key</code>, one per line.</p>
          <p class="obw-step-hint">You get the keys from the team data maintainer. The ids of your sources: ${esc(ids)}.</p>
          <textarea class="ds-textarea obw-textarea" id="${P}key-textarea" spellcheck="false" autocomplete="off" placeholder="ds-data=base64_key" tabindex="-1"></textarea>
          <div class="obw-step-actions">
            <button type="button" class="ds-btn ds-btn--primary" id="${P}key-save-btn">Save keys</button>
          </div>
          <div class="obw-repo-rows" id="${P}key-state">${keyRows({ side })}</div>
          <div class="obw-repo-rows" id="${P}key-rows"></div>
          <div class="obw-progress" id="${P}key-progress" hidden>
            <div class="ips-phase-label" id="${P}key-phase">Initialising...</div>
            <div class="ips-bar"><div class="ips-bar-fill" id="${P}key-fill"></div></div>
          </div>
          <div class="obw-repo-rows" id="${P}key-decrypt-rows"></div>
          <div class="${P}stream" id="${P}stream" hidden></div>
        </div>
      </div>
      <div class="ds-card obw-step-card">
        <div class="ds-card-header"><span class="ds-card-title">Step 5 — Team data</span><span class="ds-badge ds-badge--green">Done</span></div>
      </div>
    </div>`;
}

export const MOCKS = {
  'klucze-dla-zespolu-card': () => card(),

  'klucze-dla-zespolu-tokens-modal': () => modalShell({
    id: P + 'tokens-modal',
    title: 'New GitLab tokens',
    size: 'xl',
    body: `<div id="${P}gtc-body">${formPanel([])}</div>`,
    footer: `<div class="${P}footer" id="${P}gtc-footer">${formFooter(false)}</div>`,
  }),
  'klucze-dla-zespolu-repo-row': ({ id = 'app', checked = true } = {}) => repoRow(TARGETS.find((t) => t.id === id) || TARGETS[0], checked),
  'klucze-dla-zespolu-form-footer': ({ enabled = true } = {}) => formFooter(enabled),
  'klucze-dla-zespolu-result': ({ states = [] } = {}) => resultPanel(states),
  'klucze-dla-zespolu-progress-footer': ({ n = 1, total = 3 } = {}) => `<span class="gtc-progress">Creating tokens… (${esc(n)} of ${esc(total)})</span>`,
  'klucze-dla-zespolu-done-footer': () => `<button type="button" class="ds-btn ds-btn--primary" id="${P}copy-all">Copy all items</button>
    <button type="button" class="ds-btn ds-btn--secondary" id="${P}close">Close</button>`,

  'klucze-dla-zespolu-wizard': ({ side = 'admin' } = {}) => wizard({ side }),
  'klucze-dla-zespolu-key-rows': ({ side = 'admin', present = [] } = {}) => keyRows({ side, present }),
  'klucze-dla-zespolu-status-row': (props = {}) => statusRow(props),
  'klucze-dla-zespolu-user': () => '<button type="button" class="app-top-bar__user-btn" title="Robin Hart" aria-label="Robin Hart"><span class="app-top-bar__user-initials">RH</span></button>',
  'klucze-dla-zespolu-whoami': ({ who = 'Alex Morgan', role = 'data maintainer' } = {}) => `<span class="ds-badge ds-badge--blue ${P}whoami" id="${P}whoami">${esc(who)} · ${esc(role)}</span>`,
};

/** Every visible label these painters paint (copy gate). */
export const LABELS = [
  'GitLab project tokens', 'Create tokens', 'New GitLab tokens', 'First name', 'Last name', 'Create', 'Cancel',
  'Repositories — tick at least one', 'Select all', 'queued', 'creating…', 'ready', 'Copy item',
  'Copy all items', 'Close', 'Step 4 — Encryption keys', 'Save keys', 'Key present', 'No key',
  'Copy key', ...TARGETS.map((t) => t.label), ...TARGETS.map((t) => t.purpose),
];
