// ── Mission Deck — js/settings-narzedzia.js ───────────────────────────
// Renders the "Tools" tab in #view-settings: one card per tool this cockpit
// leans on, grouped by what the tool is for. Exports: renderNarzedziaSection().
// Called from js/settings.js renderSettingsView() — fire-and-forget.
//
// The server (GET /api/tools/status) returns FACTS ONLY — id, version, state,
// a small detail bag. Every user-facing word on the screen lives here: the label,
// the one line saying why the tool matters, and the command that fixes it.
// Same split as js/settings-skille.js, and for the same reason — copy can be
// rewritten without anyone touching a probe, and a probe can be retuned without
// re-translating the tab.

import { showToast } from './toast.js';
import { escHtml } from './utils.js';
import { registerViewCleanup } from './view-lifecycle.js';

// ── Display copy ──────────────────────────────────────────────────────────────
// One row per tool id the endpoint can return. `fix` is the command a person
// pastes into a terminal; it renders only when the card is not green, because
// a healthy tool needs no instruction. Each `fix` is the NARROWEST command that
// repairs what the card reports - `npm run setup` would also install gitnexus
// globally, which is not what a missing Chromium asks for. A tool with no row here still renders,
// under its bare id — the tab never hides something the server reported.

const TOOL_COPY = {
  'node': {
    label: 'Node.js',
    why: 'The engine the Mission Deck server and every command-line tool run on.',
  },
  'npm': {
    label: 'npm',
    why: 'Installs dependencies and runs the tests and the linter.',
  },
  'git': {
    label: 'Git',
    why: 'App updates and data exchange with the team go through Git.',
  },
  'python': {
    label: 'Python',
    why: 'Helper scripts, mini apps and some Claude Code skills. On a Mac the command is python3, on Windows python or py.',
  },
  'bitwarden': {
    label: 'Bitwarden CLI',
    why: 'Every key and password comes from here — without an open vault the Keys tab is empty.',
  },
  'claude-cli': {
    label: 'Claude Code',
    why: 'The assistant that writes and checks code in this repository.',
  },
  'claude-terminal': {
    label: 'In-app terminal',
    why: 'The assistant window built into Mission Deck. Needs the native add-ons built.',
  },
  'mcp-config': {
    label: 'MCP connections',
    why: 'The list of tools the assistant sees in this repository.',
  },
  'playwright-mcp': {
    label: 'Playwright',
    why: 'Takes screenshots and clicks through the app during visual verification.',
  },
  'chromium': {
    label: 'Chromium',
    why: 'The browser Playwright drives. About 150 MB, downloaded once.',
  },
  'gitnexus-cli': {
    label: 'GitNexus',
    why: 'Builds the code map that tells the assistant what a change will break.',
  },
  'gitnexus-index': {
    label: 'Code map',
    why: 'The map describes one specific state of the repository. A stale one quietly stops answering "what will break".',
  },
};

// ── Remedies ──────────────────────────────────────────────────────────────────
// What to DO about a card, chosen by the REASON it is not green - not by the
// colour. That distinction is the whole point: Bitwarden goes yellow because the
// vault is closed, and telling a person to install a CLI they already have (the
// version is printed two lines above) is worse than saying nothing.
//
// A remedy has at most two parts:
//   `cmd`    the command, always shown and always copyable - the button is a
//            convenience, never the only way to see what will run
//   `job`    an id from TOOL_JOBS in server.js, if the cockpit can run it here
//
// Opening the vault is deliberately NOT here. The top bar owns that action and
// owns it everywhere; a second unlock button on an environment check would be a
// second place for the same state to disagree.
//
// No `job` means deliberate: node, npm and git are the runtime this server runs
// ON, and replacing them underneath a live process is not a button.

// The runtime remedies differ by system - Homebrew on macOS, winget on Windows,
// the same commands docs/guides/WINDOWS.md prints - so they are keyed on
// the `platform` the status endpoint reports, never on the browser. On Windows
// `npm install -g npm` is deliberately NOT the npm remedy: it lands in
// %APPDATA%\npm, which sits BEHIND Program Files on PATH, so the old npm keeps
// answering; reinstalling Node is what actually replaces it there.
const RUNTIME_REMEDIES = {
  win32: {
    'node': { cmd: 'winget install OpenJS.NodeJS.LTS' },
    'npm': { cmd: 'winget upgrade OpenJS.NodeJS.LTS' },
    'git': { cmd: 'winget install Git.Git' },
    'python': { cmd: 'winget install Python.Python.3.12' },
  },
  default: {
    'node': { cmd: 'brew install node@24' },
    'npm': { cmd: 'npm install -g npm@latest' },
    'git': { cmd: 'brew install git' },
    'python': { cmd: 'brew install python' },
  },
};

const REMEDIES = {
  'claude-cli': { cmd: 'npm install -g @anthropic-ai/claude-code', job: 'claude-install', label: 'Install' },
  'claude-terminal': { cmd: 'npm install', job: 'deps-install', label: 'Build add-ons' },
  'mcp-config': { cmd: 'git restore .mcp.json' },
  'playwright-mcp': { cmd: 'node scripts/bootstrap-playwright.js', job: 'playwright-setup', label: 'Install' },
  'chromium': { cmd: 'node scripts/bootstrap-playwright.js', job: 'playwright-setup', label: 'Download browser' },
  'gitnexus-cli': { cmd: 'npm install -g gitnexus', job: 'gitnexus-install', label: 'Install' },
  // One command for both states on purpose. `.gitnexus/` is gitignored, so a
  // machine that never indexed this repo has no `.gitnexus/run.cjs` and the
  // runner people used to copy from here died with MODULE_NOT_FOUND - the
  // card was offering the refresh command for an index that did not exist
  // yet. The bootstrapper covers first build AND refresh, and it is what the
  // button next to it already runs: the `gitnexus-reindex` job resolves
  // through analyzeInvocation() plus ANALYZE_ENV, without which server.js is
  // silently dropped from the graph. Copyable text and button must not name
  // two different things.
  'gitnexus-index': { cmd: 'node scripts/bootstrap-gitnexus.js', job: 'gitnexus-reindex', label: 'Update map' },
};

/**
 * The remedy for one card, or null when there is nothing to do.
 *
 * Bitwarden is the case that forced this function to exist: three different
 * reasons hide behind one yellow pill, and each needs a different answer - and
 * one of them, a closed vault, is answered by the top bar rather than here.
 *
 * @param {object} tool one record from GET /api/tools/status
 * @param {string} [platform] `platform` from the same payload (process.platform)
 */
function _remedy(tool, platform) {
  // The code map is the one card that offers its action even when green. It is
  // not a repair: the map drifts from the working tree with every edit, so
  // "matches HEAD" is the moment you most often want to refresh it - hiding the
  // button there would mean waiting for the card to go yellow before you can
  // fix what it warns about. `showCmd` keeps the copyable command off a healthy
  // card, where no instruction is needed.
  if (tool.id === 'gitnexus-index') {
    // `missing` is "never indexed on this machine", not "broken" - a fresh
    // clone is in that state by design, so the button says build, not update.
    const label = tool.state === 'missing' ? 'Build map' : REMEDIES['gitnexus-index'].label;
    return { ...REMEDIES['gitnexus-index'], label, showCmd: tool.state !== 'ok' };
  }
  if (tool.state === 'ok') return null;
  if (tool.id === 'bitwarden') {
    if (tool.state === 'missing') {
      return { cmd: 'npm install -g @bitwarden/cli', job: 'bitwarden-install', label: 'Install' };
    }
    const lock = (tool.detail && tool.detail.lockState) || '';
    // Installed and present: the CLI is fine, the VAULT is what needs a person.
    // A closed vault gets no remedy row - the detail line points at the top bar,
    // which is the one place this cockpit unlocks anything.
    if (lock === 'unauthenticated') return { cmd: 'bw login' };
    return null;
  }
  const runtime = RUNTIME_REMEDIES[platform === 'win32' ? 'win32' : 'default'];
  return runtime[tool.id] || REMEDIES[tool.id] || null;
}

// ── Grouping ──────────────────────────────────────────────────────────────────
// A tool whose group is missing from this list still renders, under "Other".

const GROUPS = [
  { id: 'runtime', label: 'Runtime', hint: 'what everything else runs on' },
  { id: 'sejf', label: 'Vault', hint: 'the source of keys and passwords' },
  { id: 'claude', label: 'Claude Code', hint: 'the assistant and its connections' },
  { id: 'weryfikacja', label: 'Verification and code knowledge', hint: 'screenshots and the repository map' },
];

const STATE_BADGE = {
  ok: { cls: 'ds-badge--green', text: 'Ready' },
  warn: { cls: 'ds-badge--yellow', text: 'Needs attention' },
  missing: { cls: 'ds-badge--red', text: 'Missing' },
  unknown: { cls: 'ds-badge--gray', text: 'Not checked' },
};

// ── Detail lines ──────────────────────────────────────────────────────────────
// The second line of a card: the one extra fact that makes the state actionable.
// Keyed by tool id, because only a handful of tools have anything to add.

const BW_LOCK_LABEL = {
  unlocked: 'vault open',
  locked: 'vault locked — open it in the top bar',
  unauthenticated: 'not logged in to the vault',
  unknown: 'could not read the vault state',
};

/**
 * @param {object} tool one record from GET /api/tools/status
 * @returns {string} plain text, already safe to escape at the call site
 */
function _detailLine(tool) {
  const d = tool.detail || {};
  switch (tool.id) {
    case 'bitwarden': {
      const lock = BW_LOCK_LABEL[d.lockState] || BW_LOCK_LABEL.unknown;
      return d.serverUrl ? `${lock} (${d.serverUrl})` : lock;
    }
    case 'claude-terminal':
      if (tool.state === 'ok') return 'ready to connect';
      return `missing: ${[!d.pty && 'terminal support', !d.ws && 'live connection'].filter(Boolean).join(', ')}`;
    case 'mcp-config':
      return (d.missing && d.missing.length)
        ? `missing connections: ${d.missing.join(', ')}`
        : `connections: ${(d.servers || []).join(', ')}`;
    case 'python':
      return d.command ? `responding command: ${d.command}` : 'none of python3, python or py responds';
    case 'playwright-mcp':
      return d.pinned ? `version pinned for the team: ${d.pinned}` : '';
    case 'chromium':
      return (d.builds && d.builds.length) ? `${d.builds.length} versions downloaded` : 'nothing downloaded';
    case 'gitnexus-index':
      // No index at all is a normal state on a fresh clone (`.gitnexus/` is
      // gitignored), not damage - say so, or the red badge reads as breakage
      // and sends people looking for something to repair.
      if (!d.indexedCommit) return 'the map has not been built on this computer yet';
      return d.stale
        ? `the map describes an older state (${d.indexedCommit}), the repository is at ${d.headCommit}`
        : `map up to date (${d.indexedCommit})`;
    default:
      return '';
  }
}

/** "24.19.0 (expected: >=24 <25)" — the version line, or an em dash. */
function _versionLine(tool) {
  const parts = [];
  if (tool.version) parts.push(tool.version);
  if (tool.expected) parts.push(`expected: ${tool.expected}`);
  if (!parts.length) return '';
  return parts.length > 1 ? `${parts[0]} (${parts[1]})` : parts[0];
}


// ── Card actions ─────────────────────────────────────────────
// The half of this tab that acts. A job runs on the server (POST /api/tools/run),
// one at a time, and the tab watches it by polling the PLAIN status endpoint -
// `job` is served fresh even from the cache, so a poll costs one cheap request
// instead of eleven child processes.

const JOB_POLL_MS = 4000;
let _jobPollTimer = null;
// process.platform from the last status payload - what picks the remedy set.
let _platform = '';

function _stopJobPoll() {
  if (_jobPollTimer) {
    clearInterval(_jobPollTimer);
    _jobPollTimer = null;
  }
}

function _startJobPoll() {
  _stopJobPoll();
  // Registered per run, not once at import: runViewCleanup DELETES the
  // callbacks it runs, so a single registration is spent the first time the
  // user leaves Settings and a later poll would outlive its view.
  registerViewCleanup('settings', _stopJobPoll);
  _jobPollTimer = setInterval(async () => {
    let job;
    try {
      const res = await fetch('/api/tools/status', { cache: 'no-store' });
      if (!res.ok) return;
      job = (await res.json()).job;
    } catch (_e) {
      return; // a dropped poll is not a failure; the next one lands
    }
    if (!job || job.running) return;
    _stopJobPoll();
    if (job.ok) {
      showToast('success', 'Done', job.restartRequired
        ? 'Restart the server in the System tab for the change to take effect.'
        : '');
    } else {
      showToast('error', 'It failed', job.error || '');
    }
    // Re-probe once, now that the machine has changed.
    renderNarzedziaSection({ refresh: true })
      .catch(e => console.error('[settings] narzedzia repaint:', e));
  }, JOB_POLL_MS);
}

/**
 * Ask the server to run one job. The button carries the id; the server matches
 * it against its own closed table and never runs anything else.
 */
async function _runJob(btn, jobId) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Working…';
  try {
    const res = await fetch('/api/tools/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job: jobId }),
    });
    const data = await res.json().catch(() => ({}));
    if (data.started) {
      showToast('info', 'Started', 'This takes from a few seconds to a few minutes.');
    } else if (data.reason === 'running') {
      showToast('info', 'Another job is already running', 'Wait until it finishes.');
    } else {
      showToast('error', 'Could not start', data.error || data.reason || '');
      btn.disabled = false;
      btn.textContent = original;
      return;
    }
    _startJobPoll();
  } catch (e) {
    showToast('error', 'Could not start');
    btn.disabled = false;
    btn.textContent = original;
    console.error('[settings] narzedzia job:', e);
  }
}

/**
 * The remedy row: the command to copy, plus the button that runs it here when
 * the cockpit can. A job that is already running anywhere disables every button,
 * because the server accepts one at a time and a dead click is worse than a
 * greyed one.
 */
function _remedyHtml(tool, job) {
  const remedy = _remedy(tool, _platform);
  if (!remedy) return '';
  const busy = !!(job && job.running);
  const mine = busy && remedy.job && job.id === remedy.job;
  const actionable = !!remedy.job;
  const showCmd = remedy.cmd && remedy.showCmd !== false;
  return `
      ${showCmd ? `
      <div class="sett-tool-card__fix">
        <code class="sett-tool-card__cmd">${escHtml(remedy.cmd)}</code>
        <button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm sett-tool-copy"
                data-cmd="${escHtml(remedy.cmd)}" title="Copy command">Copy</button>
      </div>` : ''}
      ${actionable ? `
      <div class="sett-tool-card__actions">
        <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm sett-tool-run"
                data-job="${escHtml(remedy.job || '')}"
                ${busy ? 'disabled' : ''}>${mine ? 'Working…' : escHtml(remedy.label || 'Run')}</button>
        ${mine ? '<span class="sett-tool-card__detail">this takes a moment</span>' : ''}
      </div>` : ''}`;
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function _cardHtml(tool, job) {
  const copy = TOOL_COPY[tool.id] || { label: tool.id, why: '' };
  const badge = STATE_BADGE[tool.state] || STATE_BADGE.unknown;
  const version = _versionLine(tool);
  const detail = _detailLine(tool);

  return `
    <div class="ds-card sett-tool-card sett-tool-card--${escHtml(tool.state)}">
      <div class="sett-tool-card__head">
        <span class="sett-tool-card__title">${escHtml(copy.label)}</span>
        <span class="ds-badge ${badge.cls} ds-badge--sm">${escHtml(badge.text)}</span>
      </div>
      ${version ? `<div class="sett-tool-card__version">${escHtml(version)}</div>` : ''}
      ${copy.why ? `<div class="sett-tool-card__why">${escHtml(copy.why)}</div>` : ''}
      ${detail ? `<div class="sett-tool-card__detail">${escHtml(detail)}</div>` : ''}
      ${_remedyHtml(tool, job)}
    </div>`;
}

function _groupHtml(group, tools, job) {
  if (!tools.length) return '';
  return `
    <section class="sett-tool-group">
      <div class="sett-tool-group__head">
        <h3 class="sett-tool-group__title">${escHtml(group.label)}</h3>
        <span class="sett-tool-group__hint">${escHtml(group.hint)}</span>
      </div>
      <div class="sett-tool-grid">${tools.map(t => _cardHtml(t, job)).join('')}</div>
    </section>`;
}

/** "05.09.2026 18:22" in local time, or an em dash. */
function _fmtChecked(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return '—';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Group the flat list the server returns, keeping GROUPS order and dropping
 * nothing: an unknown group lands in "Other" rather than disappearing.
 */
function _byGroup(tools) {
  const known = new Set(GROUPS.map(g => g.id));
  const out = GROUPS.map(g => [g, tools.filter(t => t.group === g.id)]);
  const rest = tools.filter(t => !known.has(t.group));
  if (rest.length) out.push([{ id: 'inne', label: 'Other', hint: '' }, rest]);
  return out;
}

function _wire(root) {
  const refresh = root.querySelector('#settings-narzedzia-refresh');
  if (refresh) {
    refresh.addEventListener('click', () => {
      refresh.disabled = true;
      renderNarzedziaSection({ refresh: true })
        .catch(e => console.error('[settings] narzedzia refresh:', e));
    });
  }
  root.querySelectorAll('.sett-tool-run').forEach(btn => {
    if (btn.disabled) return;
    btn.addEventListener('click', () => {
      if (btn.dataset.job) return _runJob(btn, btn.dataset.job);
    });
  });
  root.querySelectorAll('.sett-tool-copy').forEach(btn => {
    btn.addEventListener('click', async () => {
      const cmd = btn.dataset.cmd || '';
      try {
        await navigator.clipboard.writeText(cmd);
        showToast('success', 'Command copied', cmd);
      } catch (_e) {
        // A denied clipboard permission is not a failure worth a red toast —
        // the command is on screen and can be selected by hand.
        showToast('info', 'Copy it by hand', cmd);
      }
    });
  });
}

/**
 * Render the whole tab. Never throws at the caller: a dead endpoint paints a
 * short message in the slot instead of blanking the Settings view.
 * @param {{refresh?: boolean}} [opts] refresh bypasses the server's 60 s cache
 */
export async function renderNarzedziaSection(opts = {}) {
  const root = document.getElementById('settings-narzedzia-section');
  if (!root) return;

  let data;
  try {
    const res = await fetch('/api/tools/status' + (opts.refresh ? '?refresh=1' : ''), { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch (e) {
    root.innerHTML = `
      <div class="ds-callout ds-callout--warning">
        Could not check the tools — the server did not respond.
      </div>`;
    console.error('[settings] narzedzia:', e);
    return;
  }

  const tools = Array.isArray(data.tools) ? data.tools : [];
  _platform = typeof data.platform === 'string' ? data.platform : '';
  const needAttention = tools.filter(t => t.state !== 'ok').length;

  root.innerHTML = `
    <div class="sett-tool-bar">
      <div class="sett-tool-bar__summary">
        ${needAttention === 0
    ? '<span class="ds-badge ds-badge--green">All ready</span>'
    : `<span class="ds-badge ds-badge--yellow">${needAttention} to check</span>`}
        <span class="sett-tool-bar__checked">Checked: ${escHtml(_fmtChecked(data.checked_at))}</span>
      </div>
      <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="settings-narzedzia-refresh">Check again</button>
    </div>
    ${_byGroup(tools).map(([g, list]) => _groupHtml(g, list, data.job)).join('')}`;

  _wire(root);

  // A job started before this render - a reload, or a tab reopened while the
  // analyzer runs - must still be watched to its end.
  if (data.job && data.job.running && !_jobPollTimer) _startJobPoll();
}
