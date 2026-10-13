// demo/mocks/ch-settings.mjs
// Painters for chapter `settings`: the System, Tools and Keys tabs of
// Settings, in the markup js/settings.js and js/settings-narzedzia.js paint
// from their endpoints (renderAppVersionBlock, renderSyncSection,
// renderThemeSection, renderNarzedziaSection, _refreshBitwardenCard,
// _renderSecretCards, _renderProfileCard, _renderActivityLinkCard,
// _renderGitlabTokenCard). Same classes and labels; every value is invented.
// Ids this file creates start with `dm-ustawienia-`.

import { esc } from './common.mjs';

const P = 'dm-ustawienia-';

const ICON_VERSION = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>';
const ICON_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
const ICON_SECRET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>';
const ICON_PROFILE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
const ICON_ACTIVITY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>';
const ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

// ── System tab ──────────────────────────────────────────────────────────

/** The version card (renderAppVersionBlock), with the result slot under it. */
function versionCard({ result = '' } = {}) {
  const resultHtml = result === 'checking'
    ? `<div class="sett-version-result ds-callout ds-callout--info" id="${P}version-result">Checking for a new version...</div>`
    : result === 'current'
      ? `<div class="sett-version-result ds-callout ds-callout--success" id="${P}version-result">You have the newest version — v2.14.0 is current.</div>`
      : `<div class="sett-version-result" id="${P}version-result" hidden></div>`;
  return `
    <div class="ds-card sett-hero-card" id="${P}version-card">
      <div class="ds-card-header">
        <span class="sett-hero-card__icon">${ICON_VERSION}</span>
        <span class="ds-card-title">App version</span>
        <span class="ds-badge ds-badge--green">v2.14.0 (c0ffee1)</span>
      </div>
      <div class="ds-card-body">
        <div class="sett-version-info">
          <div class="sett-version-row"><span class="sett-version-label">Current version</span><span class="sett-version-value">v2.14.0 (c0ffee1) · 02.10.2026 16:40</span></div>
          <div class="sett-version-row"><span class="sett-version-label">Repository</span><span class="sett-version-value">https://gitlab.example.test/team/mission-deck</span></div>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:12px">
          <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="${P}check-update-btn">Check for updates</button>
        </div>
        ${resultHtml}
      </div>
    </div>`;
}

const SYNC_CARD = `
    <div class="ds-card sett-sys-card">
      <div class="ds-card-header">
        <span class="ds-card-title">Data sync</span>
      </div>
      <div class="ds-card-body">
        <p style="font-size:var(--text-sm);color:var(--body-secondary-text);margin:0 0 10px">
          The <code>data-tier-0</code> data repository. Sync is manual —
          here or with the "Sync" button in the top bar. Nothing is downloaded
          or sent in the background.
        </p>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
          <span style="font-size:12px;color:var(--text-secondary)">Status:</span><span class="ds-badge ds-badge--green">Done</span>
          <span style="font-size:12px;color:var(--text-secondary)">last: 04.10.2026 09:14</span>
        </div>
        <div style="display:flex;gap:8px">
          <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm">Pull changes</button>
          <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm">Send changes</button>
        </div>
      </div>
    </div>`;

const THEME_CARD = `
    <div class="ds-card sett-sys-card">
      <div class="ds-card-header">
        <span class="ds-card-title">Theme</span>
      </div>
      <div class="ds-card-body">
        <p style="font-size:var(--text-sm);color:var(--body-secondary-text);margin:0 0 10px">
          Choose the look of the interface: light, dark or following the system settings.
        </p>
        <div class="ds-segmented" id="${P}theme-seg">
          <button type="button" class="ds-segment">Light</button>
          <button type="button" class="ds-segment">Dark</button>
          <button type="button" class="ds-segment active">System</button>
        </div>
      </div>
    </div>`;

// ── Tools tab ───────────────────────────────────────────────────────

const GROUPS = [
  { id: 'runtime', label: 'Environment', hint: 'what everything else runs on' },
  { id: 'sejf', label: 'Vault', hint: 'the source of keys and passwords' },
  { id: 'claude', label: 'Claude Code', hint: 'the assistant and its connections' },
  { id: 'weryfikacja', label: 'Verification and code knowledge', hint: 'screenshots and the repository map' },
];

const STATE_BADGE = {
  ok: { cls: 'ds-badge--green', text: 'Ready' },
  warn: { cls: 'ds-badge--yellow', text: 'Needs attention' },
  missing: { cls: 'ds-badge--red', text: 'Missing' },
};

/**
 * The twelve probes of the tools status endpoint, in the server's order, with the
 * copy of TOOL_COPY. `fix` is the remedy row (_remedyHtml): cmd to copy and
 * the job button. Playwright and Chromium are missing before the install.
 */
function tools(installed) {
  const pw = installed ? 'ok' : 'missing';
  return [
    { id: 'node', group: 'runtime', label: 'Node.js', state: 'ok', version: 'v24.1.0 (expected: >=24 <25)', why: 'The engine the Mission Deck server and every command-line tool run on.' },
    { id: 'npm', group: 'runtime', label: 'npm', state: 'ok', version: '11.3.0', why: 'Installs dependencies and runs the tests and the linter.' },
    { id: 'git', group: 'runtime', label: 'Git', state: 'ok', version: '2.47.1', why: 'App updates and data exchange with the team go through Git.' },
    { id: 'python', group: 'runtime', label: 'Python', state: 'ok', version: '3.12.4', why: 'Helper scripts, mini apps and some Claude Code skills. On a Mac the command is python3, on Windows python or py.', detail: 'answering command: python3' },
    { id: 'bitwarden', group: 'sejf', label: 'Bitwarden CLI', state: 'warn', version: '2025.1.3', why: 'Every key and password comes from here — without an open vault the Keys tab is empty.', detail: 'vault locked — open it in the top bar (https://vault.example.test)' },
    { id: 'claude-cli', group: 'claude', label: 'Claude Code', state: 'ok', version: '2.1.4', why: 'The assistant that writes and checks code in this repository.' },
    { id: 'claude-terminal', group: 'claude', label: 'In-app terminal', state: 'ok', why: 'The assistant window built into Mission Deck. Needs the native add-ons built.', detail: 'ready to connect' },
    { id: 'mcp-config', group: 'claude', label: 'MCP connections', state: 'ok', why: 'The list of tools the assistant sees in this repository.', detail: 'connections: gitnexus, playwright' },
    {
      id: 'playwright-mcp', group: 'weryfikacja', label: 'Playwright', state: pw, version: installed ? '0.0.41' : '',
      why: 'Takes screenshots and clicks through the app for visual verification.',
      detail: installed ? 'version pinned for the team: 0.0.41' : '',
      fix: installed ? null : { cmd: 'node scripts/bootstrap-playwright.js', label: 'Install', id: `${P}playwright-run` },
    },
    {
      id: 'chromium', group: 'weryfikacja', label: 'Chromium', state: pw,
      why: 'The browser Playwright drives. About 150 MB, downloaded once.',
      detail: installed ? '1 downloaded version' : 'nothing downloaded',
      fix: installed ? null : { cmd: 'node scripts/bootstrap-playwright.js', label: 'Download the browser', id: `${P}chromium-run` },
    },
    { id: 'gitnexus-cli', group: 'weryfikacja', label: 'GitNexus', state: 'ok', version: '1.6.3', why: 'Builds the code map that tells the assistant what a change would break.' },
    {
      id: 'gitnexus-index', group: 'weryfikacja', label: 'Code map', state: 'ok',
      why: 'The map describes one specific state of the repository. An outdated one quietly stops answering “what will break”.',
      detail: 'map up to date (c0ffee1)', fix: { label: 'Update the map', id: `${P}gitnexus-run` },
    },
  ];
}

/** _remedyHtml: the command row and the job button (busy disables every one). */
function remedyHtml(t, busy) {
  if (!t.fix) return '';
  const mine = busy && t.id === 'playwright-mcp';
  return `${t.fix.cmd ? `
      <div class="sett-tool-card__fix">
        <code class="sett-tool-card__cmd">${esc(t.fix.cmd)}</code>
        <button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm sett-tool-copy" id="${t.fix.id}-copy" title="Copy command">Copy</button>
      </div>` : ''}
      <div class="sett-tool-card__actions">
        <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm sett-tool-run" id="${t.fix.id}"${busy ? ' disabled' : ''}>${mine ? 'Working…' : esc(t.fix.label)}</button>
        ${mine ? '<span class="sett-tool-card__detail">this takes a while</span>' : ''}
      </div>`;
}

function toolCard(t, busy) {
  const badge = STATE_BADGE[t.state];
  return `
    <div class="ds-card sett-tool-card sett-tool-card--${t.state}" id="${P}tool-${t.id}">
      <div class="sett-tool-card__head">
        <span class="sett-tool-card__title">${esc(t.label)}</span>
        <span class="ds-badge ${badge.cls} ds-badge--sm">${esc(badge.text)}</span>
      </div>
      ${t.version ? `<div class="sett-tool-card__version">${esc(t.version)}</div>` : ''}
      <div class="sett-tool-card__why">${esc(t.why)}</div>
      ${t.detail ? `<div class="sett-tool-card__detail">${esc(t.detail)}</div>` : ''}
      ${remedyHtml(t, busy)}
    </div>`;
}

/** renderNarzedziaSection: summary bar, then one section per group. */
function narzedzia({ installed = false, busy = false, checked = '04.10.2026 09:20' } = {}) {
  const list = tools(installed);
  const need = list.filter((t) => t.state !== 'ok').length;
  return `
    <div class="sett-tool-bar">
      <div class="sett-tool-bar__summary">
        ${need === 0 ? '<span class="ds-badge ds-badge--green">All ready</span>'
    : `<span class="ds-badge ds-badge--yellow" id="${P}tools-summary">${need} to check</span>`}
        <span class="sett-tool-bar__checked">Checked: ${esc(checked)}</span>
      </div>
      <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="${P}tools-refresh">Check again</button>
    </div>
    ${GROUPS.map((g) => `
    <section class="sett-tool-group" id="${P}group-${g.id}">
      <div class="sett-tool-group__head">
        <h3 class="sett-tool-group__title">${esc(g.label)}</h3>
        <span class="sett-tool-group__hint">${esc(g.hint)}</span>
      </div>
      <div class="sett-tool-grid">${list.filter((t) => t.group === g.id).map((t) => toolCard(t, busy)).join('')}</div>
    </section>`).join('')}`;
}

// ── Keys tab ──────────────────────────────────────────────────────────

/** Category -> card -> keys, in ENV_SCHEMA order (_groupSecrets). */
const SECRETS = [
  ['App tokens', [
    ['Application', ['COCKPIT_APP_TOKEN', 'COCKPIT_OWNER_TOKEN']],
    ['Module catalog', ['COCKPIT_MODULES_TOKEN']],
    ['Jira', ['JIRA_TOKEN', 'JIRA_TECH_TOKEN']],
    ['Confluence', ['CONFLUENCE_TOKEN']],
  ]],
  ['Data tokens', [
    ['Starter data repo', ['COCKPIT_DATA_TOKEN']],
  ]],
  ['Tools', [
    ['Figma', ['FIGMA_TOKEN']],
    ['Prototypes', ['PROTO_DEPLOY_TOKEN']],
    ['Google Gemini', ['GEMINI_PERSONAL_TOKEN']],
  ]],
  ['Analytics', [
    ['Amplitude', ['AMPLITUDE_COCKPIT_API_KEY', 'AMPLITUDE_COCKPIT_SECRET_KEY']],
  ]],

];

/**
 * The keys the vault loads: the nine items of Alex's collection
 * `alex-morgan` from the onboarding chapter ("9 keys loaded") - the
 * six COCKPIT-* items plus their personal FIGMA, Jira and Confluence tokens.
 * Every other card stays gray - this person has no vault item for it yet.
 */
const LOADED = new Set(['COCKPIT_APP_TOKEN', 'COCKPIT_DATA_TOKEN', 'COCKPIT_MODULES_TOKEN',
  'FIGMA_TOKEN', 'JIRA_TOKEN', 'CONFLUENCE_TOKEN']);

function copyChip(key) {
  return `<span class="sett-token-name">${esc(key)}<button type="button" class="sett-token-copy-btn" id="${P}copy-${key.toLowerCase().replace(/_/g, '-')}" aria-label="Copy ${esc(key)}">${ICON_COPY}</button></span>`;
}

/** _secretState (js/settings.js): green when every key is loaded, red while the vault is locked, gray otherwise. */
function secretState(card, keys, unlocked) {
  const present = unlocked ? keys.filter((k) => LOADED.has(k)).length : 0;
  const count = keys.length > 1 ? present + '/' + keys.length : '';
  if (present === keys.length) return { dot: 'green', count, label: 'token loaded' };
  if (present > 0) return { dot: 'gray', count, label: 'some tokens missing' };
  if (!unlocked) return { dot: 'red', count, label: 'vault locked' };
  return { dot: 'gray', count, label: 'no token' };
}

function secretGrid(unlocked) {
  return SECRETS.map(([cat, cards]) => `<h3 class="sett-section-category">${esc(cat)}</h3>`
    + cards.map(([name, keys]) => {
      const st = secretState(name, keys, unlocked);
      const wide = keys.length > 4 ? ' sett-secret-card--wide' : '';
      return `<div class="ds-card settings-section-card sett-secret-card${wide}" title="${esc(st.label)}">
      <span class="sett-section-card__icon">${ICON_SECRET}</span>
      <div class="sett-section-card__content">
        <div class="sett-section-card__top-row">
          <span class="sett-section-card__title">${esc(name)}</span>
          <span class="settings-section-card__dot settings-section-card__dot--${st.dot}"></span>
          <span class="settings-section-card__count">${esc(st.count)}</span>
        </div>
        <div class="sett-section-card__tokens">${keys.map(copyChip).join('')}</div>
      </div>
    </div>`;
    }).join('')).join('');
}

function bitwardenCard(unlocked) {
  return `
    <div class="settings-section-card ds-card settings-section-card--hero" id="${P}bw-card" role="button" tabindex="0" aria-label="Bitwarden — vault status">
      <span class="sett-section-card__icon">${ICON_LOCK}</span>
      <span class="sett-section-card__title">Bitwarden</span>
      <span class="sett-section-card__desc">The Bitwarden vault — fetching tokens securely through SSO, without keeping them in the .env file.</span>
      <span class="sett-section-card__summary">
        <span class="settings-section-card__dot settings-section-card__dot--${unlocked ? 'green' : 'yellow'}"></span>
        <span class="settings-section-card__count">${unlocked ? 'secrets loaded' : 'locked'}</span>
      </span>
    </div>`;
}

function profileCard(unlocked) {
  const rows = [
    ['Person', 'Alex Morgan'],
    ['Identifier', 'alex-morgan'],
    ['GitLab account', unlocked ? 'alex.morgan' : 'unknown without a token'],
  ];
  return `<div class="ds-card sett-secret-card">
    <div class="sett-secret-card__head">
      <span class="sett-secret-card__icon">${ICON_PROFILE}</span>
      <span class="sett-secret-card__title">Identity</span>
      <span class="ds-badge ds-badge--green">${unlocked ? 'from the GitLab token name' : 'from the git config'}</span>
    </div>
    <p class="sett-secret-card__hint">Recognised from the GitLab token name. Without a token, from <code>git config</code>.</p>
    <div class="sett-secret-card__rows">
      ${rows.map(([label, value]) => `<div class="sett-secret-row">
        <span class="sett-secret-row__label">${esc(label)}</span>
        <span class="sett-profile-value">${esc(value)}</span>
      </div>`).join('')}
    </div>
  </div>`;
}

const ACTIVITY_CARD = `<div class="ds-card sett-secret-card">
    <div class="sett-secret-card__head">
      <span class="sett-secret-card__icon">${ICON_ACTIVITY}</span>
      <span class="sett-secret-card__title">Team activity</span>
    </div>
    <p class="sett-secret-card__hint">Who worked on the Mission Deck repositories recently, by GitLab access token, and whose access expires soon.</p>
    <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm">Open</button>
  </div>`;

function gitlabTokenCard(unlocked) {
  const warning = unlocked ? '' : '<div class="ds-callout ds-callout--warning"><div>Unlock the vault — the owner token comes from the <code>GITLAB-PERSONAL</code> item.</div></div>';
  return warning + `<div class="ds-card sett-secret-card sett-secret-card--wide">
    <div class="sett-secret-card__head">
      <span class="sett-secret-card__icon">${ICON_SECRET}</span>
      <span class="sett-secret-card__title">GitLab project tokens</span>
      ${unlocked ? '<span class="ds-badge ds-badge--green">ready</span>' : '<span class="ds-badge ds-badge--yellow">no owner token</span>'}
    </div>
    <p class="sett-secret-card__hint">One wizard for every repository: you tick which ones need a token and they are created in one run. Each is valid for 12 months, and you see its value once.</p>
    <div class="sett-secret-card__rows">
      <div class="sett-secret-row"><span class="sett-secret-row__label">Repositories</span><span class="sett-profile-value">2 to choose from</span></div>
    </div>
    <div class="sett-section-card__tokens">${copyChip('COCKPIT_APP_TOKEN').replace(/id="[^"]+"/, '')}${copyChip('COCKPIT_DATA_TOKEN').replace(/id="[^"]+"/, '')}</div>
    <div class="sett-secret-card__actions">
      <button type="button" class="ds-btn ds-btn--primary ds-btn--sm"${unlocked ? '' : ' disabled'}>Create tokens</button>
    </div>
  </div>`;
}

const LEGEND = '<span class="sett-legend-item"><span class="settings-section-card__dot settings-section-card__dot--green"></span>token loaded</span>'
  + '<span class="sett-legend-item"><span class="settings-section-card__dot settings-section-card__dot--gray"></span>no token</span>'
  + '<span class="sett-legend-item"><span class="settings-section-card__dot settings-section-card__dot--red"></span>vault locked</span>';

export const MOCKS = {
  'ustawienia-version': (props) => versionCard(props),
  'ustawienia-sync': () => SYNC_CARD,
  'ustawienia-theme': () => THEME_CARD,
  'ustawienia-narzedzia': (props) => narzedzia(props),
  'ustawienia-bw-card': ({ unlocked = false } = {}) => bitwardenCard(unlocked),
  'ustawienia-secrets': ({ unlocked = false } = {}) => secretGrid(unlocked),
  'ustawienia-profile': ({ unlocked = false } = {}) => profileCard(unlocked),
  'ustawienia-activity': () => ACTIVITY_CARD,
  'ustawienia-gitlab-tokens': ({ unlocked = false } = {}) => gitlabTokenCard(unlocked),
  'ustawienia-legend': () => LEGEND,
};

/** Every visible label these painters paint (copy gate). */
export const LABELS = [
  'App version', 'Current version', 'Repository', 'Check for updates', 'You have the newest version — v2.14.0 is current.',
  'Data sync', 'Pull changes', 'Send changes', 'Theme', 'Light', 'Dark', 'System',
  ...GROUPS.map((g) => g.label), ...GROUPS.map((g) => g.hint), 'Ready', 'Needs attention', 'Missing', 'All ready',
  'to check', 'Check again', 'Copy', 'Install', 'Download the browser', 'Update the map', 'Working…', 'this takes a while',
  ...tools(false).map((t) => t.why), 'Bitwarden', 'locked', 'secrets loaded', 'Identity', 'Team activity',
  'GitLab project tokens', 'Create tokens', 'token loaded', 'no token', 'vault locked',
  ...SECRETS.map(([cat]) => cat), ...SECRETS.flatMap(([, cards]) => cards.map(([n]) => n)),
];
