// demo/mocks/ch-new-module.mjs
// Painters and transcripts for chapter `new-module` ("Your own module via
// /new-idea"): the person only TALKS to Claude in plain English - every script
// (new-module.js, plan-preflight.js, gates, plan-status.js) appears only as a
// tool line Claude runs. The relay strip over the VS Code editor (one chip
// per agent: persona, agent, model, live badge Waiting / Working / Done, and
// the "baton" each agent hands on), the agents' spawn banners IN FULL (the
// exact output of scripts/agent-banner.js), the plan, short excerpts of the
// module's source, and the module page in its stages (js/module-host.js
// section shape, the read-only module sync bar of js/module-sync-bar.js).
// Also the "Installed" table of Settings > Modules (js/settings-moduly.js
// renderModulySection with js/module-card.mjs cells) and dsSelect(), both
// reused by chapters `publishing`, `catalog` and `feedback`.
// Every person, team and number is invented. Ids this file creates start with
// `dm-nowy-modul-`, classes with `nowy-modul-`.

import { esc } from './common.mjs';

const P = 'dm-nowy-modul-';
const C = 'nowy-modul-';
const DS_ICONS = '/assets/icons/ds/';

const SEL_ICON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** The enhanced <select> js/ds-select.js builds: wrapper, trigger, closed drop. */
export function dsSelect({ id, text, label, options = [], open = false }) {
  const opts = options.map((o, i) => `<li class="ds-sel-opt${o.sel ? ' ds-sel-opt--sel' : ''}" role="option" aria-selected="${o.sel ? 'true' : 'false'}" id="${esc(id)}-opt-${i}"><span class="ds-sel-check"></span><span>${esc(o.label)}</span></li>`).join('');
  return `<div class="ds-sel-wrap${open ? ' ds-sel--open' : ''}" id="${esc(id)}">
      <button type="button" class="ds-sel-trigger" aria-haspopup="listbox" aria-expanded="${open}" aria-label="${esc(label)}" id="${esc(id)}-trigger"><span class="ds-sel-text">${esc(text)}</span><span class="ds-sel-icon">${SEL_ICON}</span></button>
      <div class="ds-sel-drop" id="${esc(id)}-drop"${open ? '' : ' hidden'}><ul class="ds-sel-list" role="listbox">${opts}</ul></div>
    </div>`;
}

// ── Installed modules (Settings > Modules) ─────────────────────────────

const MATURITY = {
  stable: '<span class="ds-badge ds-badge--green">stable</span>',
  beta: '<span class="ds-badge ds-badge--yellow">beta</span>',
};

/** Installed modules, sorted by name the way _byModuleName sorts them. */
const INSTALLED = [
  { id: 'demo-reports', name: 'Demo reports', version: '0.1.0', status: 'beta', area: 'Product', menu: 'Knowledge (1)', icon: '24-ic-folder', demo: true },
  { id: 'meeting-transcripts', name: 'Meeting transcripts', version: '0.3.1', status: 'beta', area: 'Product', menu: 'Knowledge (1)', icon: '24-ic-folder' },
  { id: 'sprint-planning', name: 'Sprint planning', version: '1.4.0', status: 'stable', area: 'Engineering', menu: 'Initiatives (1)', icon: '24-ic-folder' },
];

function iconBtn(tip, ico, extra = '', danger = false) {
  return `<button type="button" class="ds-icon-btn ds-icon-btn--sm${danger ? ' moduly-action--danger' : ''}" data-tip="${esc(tip)}" aria-label="${esc(tip)}"${extra}><span class="moduly-action-ico moduly-action-ico--${ico}" aria-hidden="true"></span></button>`;
}

function installedRow(m, demoStatus) {
  const status = m.demo ? demoStatus : m.status;
  const rid = m.demo ? ` id="${P}row-${m.id}"` : '';
  const btnId = (what) => (m.demo ? ` id="${P}${what}-${m.id}"` : '');
  return `
    <tr class="moduly-row"${rid}>
      <td><span class="moduly-row-name">
        <span class="moduly-row-icon" aria-hidden="true"><img src="${DS_ICONS}${m.icon}.svg" alt=""></span>
        <span class="moduly-row-name-text"><strong class="moduly-row-title">${esc(m.name)}</strong><code class="moduly-card-id">${esc(m.id)}</code></span>
      </span></td>
      <td class="moduly-cell-version">${esc(m.version)}</td>
      <td><span class="moduly-cell-badges"${m.demo ? ` id="${P}status-${m.id}"` : ''}><span class="ds-badge ds-badge--green">Enabled</span>${MATURITY[status] || ''}</span></td>
      <td><span class="moduly-cell-badges"><span class="ds-badge ds-badge--blue">${esc(m.area)}</span></span></td>
      <td><span class="moduly-cell-badges"><span class="ds-badge ds-badge--gray">${esc(m.menu)}</span></span></td>
      <td class="right"><span class="moduly-row-actions">
        ${iconBtn('Details', 'info', btnId('details'))}
        ${iconBtn('Disable', 'pause', btnId('toggle'))}
        ${iconBtn('Export', 'download', btnId('export'))}
        ${iconBtn('Publish', 'upload', btnId('publish'))}
        ${iconBtn('Remove', 'trash', btnId('remove'), true)}
      </span></td>
    </tr>`;
}

/**
 * The "Installed" section: restart callout (when a module waits for a
 * restart), head with "Upload from file", search row, table.
 * @param {{ restart?: boolean, restarting?: boolean, withDemo?: boolean, demoStatus?: string }} props
 */
function installed({ restart = false, restarting = false, withDemo = true, demoStatus = 'beta' } = {}) {
  const rows = INSTALLED.filter((m) => withDemo || !m.demo);
  const callout = restart ? `
    <div class="ds-callout ds-callout--warning moduly-restart-callout" id="${P}restart-callout">
      <div>The module change needs a server restart to take effect.</div>
      <button type="button" class="ds-btn ds-btn--danger ds-btn--sm" id="${P}restart-btn"${restarting ? ' disabled' : ''}>${restarting ? 'Restarting...' : 'Restart now'}</button>
    </div>` : '';
  return `<div class="moduly-inner">${callout}
    <div class="moduly-section-head">
      <h3 class="moduly-section-title">Installed</h3>
      <button type="button" class="ds-btn ds-btn--primary ds-btn--sm">Upload from file</button>
    </div>
    <div class="moduly-search-row">
      <input type="search" class="ds-input moduly-search" placeholder="Search modules by name, id, author or tag..." aria-label="Search the installed modules" autocomplete="off">
      <div class="moduly-area-select">${dsSelect({ id: P + 'area', text: 'All areas', label: 'Area of the installed modules' })}</div>
      <span class="moduly-search-count" aria-live="polite">${rows.length}</span>
    </div>
    <div class="ds-table-wrap moduly-table-wrap"><table class="ds-table moduly-table">
      <thead><tr><th>Module</th><th>Version</th><th>Status</th><th>Area</th><th>Place in the menu</th><th class="right">Actions</th></tr></thead>
      <tbody>${rows.map((m) => installedRow(m, demoStatus)).join('')}</tbody>
    </table></div>
  </div>`;
}

// ── The relay strip over the VS Code editor ─────────────────────────────

/**
 * The relay, in the order the baton travels. Models are the team defaults
 * (.claude/default-models.json); the verifier and the bug auditor start on
 * Haiku and are raised per run by the digest (`agent_model: sonnet`).
 */
export const AGENTS = [
  { id: 'planner', persona: 'Overwatch', agent: 'idea-planner', model: 'opus-4-6' },
  { id: 'backend', persona: 'Vex', agent: 'backend-implementer', model: 'sonnet-4-6' },
  { id: 'frontend', persona: 'Mira', agent: 'frontend-implementer', model: 'sonnet-4-6' },
  { id: 'lead', persona: 'Nyx', agent: 'engineering-lead-reviewer', model: 'opus-4-6' },
  { id: 'guardian', persona: 'Quiet', agent: 'cockpit-guardian', model: 'sonnet-4-6' },
  { id: 'verifier', persona: 'Ledger', agent: 'ac-verifier', model: 'haiku-5-5' },
  { id: 'bugauditor', persona: 'Hex', agent: 'bug-auditor', model: 'haiku-5-5' },
];

const STATES = {
  wait: ['gray', 'Waiting'],
  work: ['blue', 'Working'],
  done: ['green', 'Done'],
  fix: ['yellow', 'Fixing'],
};

/** One agent chip. @param {{ id?: string, state?: string, model?: string }} props */
function chip({ id = 'planner', state = 'wait', model } = {}) {
  const a = AGENTS.find((x) => x.id === id) || AGENTS[0];
  const [tone, text] = STATES[state] || STATES.wait;
  return `<div class="${C}chip ${C}chip--${esc(state)}" id="${P}chip-${esc(a.id)}">
      <span class="${C}chip-persona">${esc(a.persona)}</span>
      <span class="${C}chip-agent">${esc(a.agent)}</span>
      <span class="${C}chip-foot"><span class="${C}chip-model">${esc(model || a.model)}</span><span class="ds-badge ds-badge--sm ds-badge--${tone}">${esc(text)}</span></span>
    </div>`;
}

/** The baton line: who hands what to whom. */
function baton({ from = '', to = '', text = 'Waiting for an idea.' } = {}) {
  const head = from ? `<span class="${C}baton-who">${esc(from)}</span><span class="${C}baton-arrow" aria-hidden="true">→</span><span class="${C}baton-who">${esc(to)}</span>` : '';
  return `<div class="${C}baton" id="${P}baton"><span class="${C}baton-label">Baton</span>${head}<code class="${C}baton-text">${esc(text)}</code></div>`;
}

function relay() {
  return `<div class="${C}relay" id="${P}relay">
      <div class="${C}chips">${AGENTS.map((a) => chip({ id: a.id })).join(`<span class="${C}link" aria-hidden="true"></span>`)}</div>
      ${baton()}
    </div>`;
}

// ── The module page in the Knowledge hub ───────────────────────────────────

/** Fictitious weekly reports. `src` = where the stage reads them from. */
const REPORTS = [
  { id: 'r1', title: 'Weekly summary', week: 40, team: 'Planning', person: 'Alex Morgan', at: '03.10 16:20', src: 'both' },
  { id: 'r2', title: 'Stock availability', week: 40, team: 'Deliveries', person: 'Sam Rivera', at: '02.10 11:05', src: 'both' },
  { id: 'r3', title: 'Site traffic', week: 39, team: 'Analytics', person: 'Jamie Park', at: '26.09 09:40', src: 'both' },
  { id: 'r4', title: 'Returns and complaints', week: 39, team: 'Deliveries', person: 'Sage Turner', at: '25.09 14:10', src: 'both' },
  { id: 'r5', title: 'Weekly summary', week: 38, team: 'Planning', person: 'Logan Price', at: '19.09 12:00', src: 'both' },
  { id: 'r6', title: 'Promotion plan', week: 40, team: 'Analytics', person: 'Jamie Park', at: '04.10 08:15', src: 'team' },
  { id: 'r7', title: 'Stock gaps', week: 40, team: 'Deliveries', person: 'Sam Rivera', at: '03.10 18:45', src: 'team' },
];

const WEEKS = { 38: '14.09–20.09', 39: '21.09–27.09', 40: '28.09–04.10' };

const PREVIEW = {
  r1: ['Sales at the pilot sites up 4% week on week.', 'Two sites reported gaps in deliveries.', 'Next step: review the promotion plan on Thursday.'],
  r6: ['Three promotions start in week 41.', 'The biggest share: drinks and snacks.', 'Risk: a short delivery window to two sites.'],
};

/** 'DD.MM HH:MM' -> a number that sorts by date (all in one year). */
const sortKey = (at) => {
  const m = /^(\d\d)\.(\d\d) (\d\d):(\d\d)$/.exec(at);
  return m ? Number(m[2] + m[1] + m[3] + m[4]) : 0;
};

/** Stage order: what each stage adds on top of the previous one. */
const STAGES = ['v1', 'v2', 'v3', 'dane'];
const atLeast = (stage, s) => STAGES.indexOf(stage) >= STAGES.indexOf(s);

const fresh = (on) => (on ? ` ${C}fresh` : '');

/** The read-only module sync bar (js/module-sync-bar.js _paint, success, nothing pending). */
function syncBar() {
  return `<div class="ds-callout ds-callout--success msb-bar ${C}fresh" id="${P}msb" data-msb-module="demo-reports" role="status" aria-live="polite"><span class="msb-text">Data up to date - local 04.10 08:15, server 04.10 08:15.</span><div class="msb-actions"><button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-msb-act="open-sync" id="${P}msb-open">Open sync</button></div><div class="msb-details" hidden></div></div>`;
}

/**
 * js/module-host.js section body + the module's render(). Stages:
 * 'scaffold' (the bare skeleton), 'v1' (list, week filter, preview),
 * 'v2' (+ team filter, last update in the header), 'v3' (Owner,
 * newest first), 'dane' (+ sync bar, rows from the team data repo).
 * `changed` outlines what the last correction added.
 * @param {{ subtitle?: string, stage?: string, changed?: boolean }} props
 */
function page({ subtitle, stage = 'scaffold', changed = false } = {}) {
  if (stage === 'scaffold') {
    return `<div class="page-header"><div class="page-header-row"><div>
      <h1>Demo reports</h1>
      <div class="subtitle" id="${P}subtitle">${esc(subtitle || 'Fill in the subtitle.')}</div>
    </div>
    <div class="page-header-actions" id="${P}actions">
      <button type="button" class="ds-btn ds-btn--primary" id="${P}main-btn">Main action</button>
      <button type="button" class="ds-btn ds-btn--secondary">Refresh</button>
    </div></div></div>
    <div class="view-data" id="${P}root">
      <div class="ds-card"><div class="ds-card-body">
        <div class="ds-callout ds-callout--info">Demo reports - view under construction.</div>
        <div class="ds-actions"><button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" id="${P}more-btn">More</button></div>
      </div></div>
    </div>`;
  }
  const v2 = atLeast(stage, 'v2');
  const v3 = atLeast(stage, 'v3');
  const dane = stage === 'dane';
  let rows = REPORTS.filter((r) => dane || r.src === 'both');
  if (v3) rows = rows.slice().sort((a, b) => sortKey(b.at) - sortKey(a.at));
  const sel = rows[0];
  const lastAt = dane ? '04.10.2026 08:15' : '03.10.2026 16:20';
  const upd = v2 ? `<span class="ds-badge ds-badge--gray ${C}updated${fresh(changed && stage === 'v2')}" id="${P}updated">Last update: ${lastAt}</span>` : '';
  const teamSel = v2 ? `<div class="${C}filter${fresh(changed && stage === 'v2')}" id="${P}team-filter"><span class="${C}filter-label">Team</span>${dsSelect({ id: P + 'team', text: 'All teams', label: 'Team filter' })}</div>` : '';
  const personHead = v3 ? 'Owner' : 'Author';
  const hl3 = fresh(changed && stage === 'v3');
  const body = rows.map((r) => `<tr class="${C}row${r.id === sel.id ? ` ${C}row--sel` : ''}" id="${P}row-${r.id}">
        <td><button type="button" class="${C}row-btn" aria-label="Preview report ${esc(r.title)}">${esc(r.title)}</button></td>
        <td class="${C}cell-nowrap">Week ${r.week}</td>
        ${v2 ? `<td class="${C}cell-nowrap"><span class="ds-badge ds-badge--blue">${esc(r.team)}</span></td>` : ''}
        <td class="${C}cell-nowrap${hl3}">${esc(r.person)}</td>
        <td class="${C}cell-at">${esc(r.at)}</td>
      </tr>`).join('');
  const lines = PREVIEW[sel.id] || PREVIEW.r1;
  return `<div class="page-header"><div class="page-header-row"><div>
      <h1>Demo reports</h1>
      <div class="subtitle" id="${P}subtitle">The teams’ weekly reports in one place.</div>
      ${upd}
    </div>
    <div class="page-header-actions" id="${P}actions">
      <button type="button" class="ds-btn ds-btn--secondary" id="${P}main-btn">Refresh</button>
    </div></div></div>
    ${dane ? syncBar() : ''}
    <div class="view-data" id="${P}root">
      <div class="${C}layout">
        <div class="ds-card ${C}list-card"><div class="ds-card-body">
          <div class="${C}filters">
            <div class="${C}filter" id="${P}week-filter"><span class="${C}filter-label">Week</span>${dsSelect({ id: P + 'week', text: 'All weeks', label: 'Week filter' })}</div>
            ${teamSel}
            <span class="${C}count">${rows.length} reports</span>
          </div>
          <div class="ds-table-wrap"><table class="ds-table ${C}table" id="${P}table">
            <thead><tr><th>Report</th><th>Week</th>${v2 ? '<th>Team</th>' : ''}<th${hl3 ? ` class="${hl3.trim()}"` : ''} id="${P}person-head">${personHead}</th><th id="${P}at-head">Updated${v3 ? ' ↓' : ''}</th></tr></thead>
            <tbody>${body}</tbody>
          </table></div>
          ${dane ? `<p class="${C}source">Source: the team repository <code>data-tier-0</code>, folder <code>demo-reports/</code></p>` : `<p class="${C}source">Source: the module’s sample data</p>`}
        </div></div>
        <div class="ds-card ${C}preview" id="${P}preview"><div class="ds-card-body">
          <div class="${C}preview-kicker">Preview</div>
          <h3 class="${C}preview-title">${esc(sel.title)}</h3>
          <div class="${C}preview-meta">Week ${sel.week} · ${WEEKS[sel.week]} · ${esc(sel.person)}</div>
          <ul class="${C}preview-list">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
          <div class="ds-actions"><button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" id="${P}open-btn">Open the whole report</button></div>
        </div></div>
      </div>
    </div>`;
}

// ── Terminal transcripts ────────────────────────────────────────────────

/** Spawn banners, verbatim: `node scripts/agent-banner.js new-idea/<name>` on the committed agents (team default models; verifier and auditor get Agent({model: "sonnet"}) from the digest). Decorative ASCII art shipped in .claude/skills/new-idea/banners/. */
const BANNER_TEXT = {
  planner: [
    "PLANNER -- Overwatch  |  MISSION DECK  |  Phase 4  |  claude-opus-4-6 (frontmatter)",
    "",
    "  .---------------------------------------------------.",
    "  | OVERWATCH // mission planning      [_][=][X]      |",
    "  |...................................................|",
    "  |                                                   |",
    "  |  > read the brief. map the terrain.               |",
    "  |                                                   |",
    "  |  PLAN:                                            |",
    "  |  [x] acceptance criteria, numbered                |",
    "  |  [x] files to touch, files to leave               |",
    "  |  [x] risks named before they bite                 |",
    "  |                                                   |",
    "  |  > a plan nobody can misread.                     |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  '---------------------------------------------------'",
    "                        |||",
    "               _________|_|_________",
    "  Agent Overwatch - Planner",
    "    claude-opus-4-6 (frontmatter)",
  ],
  backend: [
    "BACKEND -- Vex  |  MISSION DECK  |  Phase 6a  |  claude-sonnet-4-6 (frontmatter)",
    "",
    "  .---------------------------------------------------.",
    "  | VEX // server room                 [_][=][X]      |",
    "  |...................................................|",
    "  |                                                   |",
    "  |  $ grep -n \"// -- \" server.js                     |",
    "  |                                                   |",
    "  |  [x] handler in its section                       |",
    "  |  [x] dispatch arm, chain lock                     |",
    "  |  [x] jsonResponse on every exit                   |",
    "  |                                                   |",
    "  |  > the API answers before you ask.                |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  '---------------------------------------------------'",
    "                        |||",
    "               _________|_|_________",
    "  Agent Vex - Backend",
    "    claude-sonnet-4-6 (frontmatter)",
  ],
  frontend: [
    "FRONTEND -- Mira  |  MISSION DECK  |  Phase 6b  |  claude-sonnet-4-6 (frontmatter)",
    "",
    "  .---------------------------------------------------.",
    "  | MIRA // interface studio           [_][=][X]      |",
    "  |...................................................|",
    "  |                                                   |",
    "  |  view: #view-<id>                                 |",
    "  |                                                   |",
    "  |  [x] DS classes only                              |",
    "  |  [x] skeleton first, then data                    |",
    "  |  [x] every exit paints the slot                   |",
    "  |                                                   |",
    "  |  > clean screens, honest states.                  |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  '---------------------------------------------------'",
    "                        |||",
    "               _________|_|_________",
    "  Agent Mira - Frontend",
    "    claude-sonnet-4-6 (frontmatter)",
  ],
  lead: [
    "LEAD -- Nyx  |  MISSION DECK  |  Phase 6c  |  claude-opus-4-6 (frontmatter)",
    "",
    "  .---------------------------------------------------.",
    "  | NYX // lead review                 [_][=][X]      |",
    "  |...................................................|",
    "  |                                                   |",
    "  |  > the whole change, one view.                    |",
    "  |                                                   |",
    "  |  [x] backend and frontend agree                   |",
    "  |  [x] contracts hold end to end                    |",
    "  |  [x] nothing half done                            |",
    "  |                                                   |",
    "  |  > time is the one resource we lack.              |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  '---------------------------------------------------'",
    "                        |||",
    "               _________|_|_________",
    "  Agent Nyx - Lead",
    "    claude-opus-4-6 (frontmatter)",
  ],
  guardian: [
    "GUARDIAN -- Quiet  |  MISSION DECK  |  Phase 6e  |  claude-sonnet-4-6 (frontmatter)",
    "",
    "  .---------------------------------------------------.",
    "  | QUIET // conventions watch         [_][=][X]      |",
    "  |...................................................|",
    "  |                                                   |",
    "  |  $ node scripts/check-conventions.js              |",
    "  |                                                   |",
    "  |  [x] tokens, not hex colours                      |",
    "  |  [x] ASCII identifiers                            |",
    "  |  [x] the house rules, kept                        |",
    "  |                                                   |",
    "  |  > quiet when it is right.                        |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  '---------------------------------------------------'",
    "                        |||",
    "               _________|_|_________",
    "  Agent Quiet - Guardian",
    "    claude-sonnet-4-6 (frontmatter)",
  ],
  verifier: [
    "VERIFIER -- Ledger  |  MISSION DECK  |  Phase 6f  |  sonnet (override)",
    "",
    "  .---------------------------------------------------.",
    "  | LEDGER // acceptance audit         [_][=][X]      |",
    "  |...................................................|",
    "  |                                                   |",
    "  |  ACCEPTANCE CRITERIA:                             |",
    "  |  AC1 ........ verified on disk                    |",
    "  |  AC2 ........ verified on disk                    |",
    "  |  AC3 ........ verified on disk                    |",
    "  |                                                   |",
    "  |  > blind check. no trust, only proof.             |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  '---------------------------------------------------'",
    "                        |||",
    "               _________|_|_________",
    "  Agent Ledger - Verifier",
    "    sonnet (override)",
  ],
  bugauditor: [
    "BUG AUDITOR -- Hex  |  MISSION DECK  |  Phase 6.7  |  sonnet (override)",
    "",
    "  .---------------------------------------------------.",
    "  | HEX // bug sweep                   [_][=][X]      |",
    "  |...................................................|",
    "  |                                                   |",
    "  |  $ node scripts/diff-digest.js                    |",
    "  |                                                   |",
    "  |  null paths ..... checked                         |",
    "  |  races .......... checked                         |",
    "  |  error exits .... checked                         |",
    "  |                                                   |",
    "  |  > find it before a user does.                    |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  '---------------------------------------------------'",
    "                        |||",
    "               _________|_|_________",
    "  Agent Hex - Bug auditor",
    "    sonnet (override)",
  ],
  gapfix: [
    "GAP-FIX -- Relay  |  MISSION DECK  |  retry cycles  |  claude-sonnet-4-6 (frontmatter)",
    "",
    "  .---------------------------------------------------.",
    "  | RELAY // gap fix                   [_][=][X]      |",
    "  |...................................................|",
    "  |                                                   |",
    "  |  > one finding in, one fix out.                   |",
    "  |                                                   |",
    "  |  [x] reproduce the gap                            |",
    "  |  [x] smallest change that closes it               |",
    "  |  [x] hand back for re-verify                      |",
    "  |                                                   |",
    "  |  > pass it on, clean.                             |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  |                                                   |",
    "  '---------------------------------------------------'",
    "                        |||",
    "               _________|_|_________",
    "  Agent Relay - Gap-fix",
    "    claude-sonnet-4-6 (frontmatter)",
  ],
};

const asLines = (text) => text.map((t) => ({ role: 'dim', text: t }));

/** Every spawn banner as terminal lines, verbatim (one line = one 'dim' line). */
export const BANNERS = Object.fromEntries(Object.entries(BANNER_TEXT).map(([k, v]) => [k, asLines(v)]));

export const MODULE_DIR = 'modules/demo-reports/';

export const NOWY_MODUL_FILES = [
  'modules/demo-reports/module.json',
  'modules/demo-reports/README.md',
  'modules/demo-reports/server/index.js',
  'modules/demo-reports/server/sample-reports.json',
  'modules/demo-reports/tests/test_demo_reports.mjs',
];

export const NOWY_MODUL_FILES_CLIENT = [
  'modules/demo-reports/client/index.js',
  'modules/demo-reports/client/style.css',
];

export const NOWY_MODUL_PLAN_PATH = 'plans/2026-10-04-demo-reports.md';

/** What the person types to Claude - plain English, nothing else. */
export const REQUEST = '/new-idea I want a module with weekly reports for the team: a list of reports, a filter by week and a preview';
export const ASK_TEAM = 'Add a filter by team and show the date of the last update in the header';
export const ASK_OWNER = 'Replace the Author column with Owner and sort newest first';
export const ASK_DATA = 'Hook up the data from the team repository (data-tier-0), folder demo-reports/';

/** Phase 2: AskUserQuestion, one question at a time, answered by picking or in words. */
export const INTERVIEW = [
  { role: 'assistant', text: 'Before I write the plan, four short questions.' },
  { role: 'out', text: '☐ Q1  Where should this feature live?' },
  { role: 'out', text: '  ❯ 1. A new module in modules/ (recommended — the core stays stable)' },
  { role: 'dim', text: '    2. A view in the Mission Deck core' },
  { role: 'user', text: '1' },
  { role: 'out', text: '☐ Q1b Which hub should the page appear in?' },
  { role: 'out', text: '  ❯ 1. knowledge — Knowledge (next to “Meeting transcripts”)' },
  { role: 'dim', text: '    2. team — Team' },
  { role: 'dim', text: '    3. activity — Activity' },
  { role: 'user', text: 'Knowledge, that is where we look for documents' },
  { role: 'out', text: '☐ Q1c Which business area does the module belong to?' },
  { role: 'out', text: '  ❯ 1. Product' },
  { role: 'dim', text: '    2. Engineering' },
  { role: 'dim', text: '    3. Operations' },
  { role: 'user', text: '1' },
  { role: 'out', text: '☐ Q2  Where do the reports come from?' },
  { role: 'out', text: '  ❯ 1. The team data repository (data-tier-0)' },
  { role: 'dim', text: '    2. Sample data in the module to start with' },
  { role: 'user', text: 'Sample data to start with, I will hook up the repository later' },
];

export const PLANNER_RUN = [
  { role: 'tool', verb: 'Agent', text: 'idea-planner', summary: 'reads the repo and the module patterns', body: ['modules/meeting-transcripts/ - a page in the Knowledge hub, a list with a preview', 'scripts/new-module.js - the skeleton: --hub knowledge --area "Product"', 'docs/architecture/modules.md - dataRepos[] for later'] },
  { role: 'ok', text: '✔ plan saved: ' + NOWY_MODUL_PLAN_PATH + ' (118 lines, 6 AC criteria)' },
];

export const PREFLIGHT = [
  { role: 'tool', text: 'node scripts/plan-preflight.js ' + NOWY_MODUL_PLAN_PATH, summary: '22 rules', body: ['PREFLIGHT VERDICT: PASS', 'lines: 118', 'No findings.'] },
  { role: 'tool', text: 'node scripts/plan-to-html.js ' + NOWY_MODUL_PLAN_PATH, summary: 'plans/2026-10-04-demo-reports.html' },
  { role: 'assistant', text: 'The plan is ready for review (HTML next to it). Reply: accept / iterate / stop.' },
  { role: 'user', text: 'accept' },
];

export const BACKEND_RUN = [
  { role: 'tool', text: 'git -C modules/demo-reports rev-parse --show-toplevel', summary: 'the module does not exist yet - the plan creates it with new-module.js' },
  { role: 'assistant', text: 'Path: split (7 files, server + view) — a module in modules/, no branch needed.' },
];

export const BACKEND_WORK = [
  { role: 'tool', text: 'node scripts/new-module.js demo-reports "Demo reports" --hub knowledge --area "Product"', summary: 'the module skeleton', body: ['module.json, client/index.js, client/style.css', 'server/index.js, tests/test_demo_reports.mjs, README.md', 'git init (the module’s local repo, no remote)'] },
  { role: 'tool', verb: 'Write', text: 'modules/demo-reports/server/sample-reports.json', summary: '5 sample reports (invented)' },
  { role: 'tool', verb: 'Edit', text: 'modules/demo-reports/server/index.js', summary: 'GET /reports?week=' },
];

export const BACKEND_DONE = [
  { role: 'tool', text: 'node --test modules/demo-reports/tests/', summary: '9 tests, 0 failures' },
  { role: 'ok', text: '✔ Backend contract: GET /reports?week=YYYY-Www → [{ id, title, week, author, updatedAt }]' },
];

export const FRONTEND_WORK = [
  { role: 'tool', verb: 'Read', text: 'modules/demo-reports/server/index.js', summary: 'the backend contract' },
  { role: 'tool', verb: 'Write', text: 'modules/demo-reports/client/index.js', summary: 'list, week filter, preview' },
  { role: 'tool', verb: 'Edit', text: 'modules/demo-reports/client/style.css', summary: 'list and preview layout, tokens only' },
  { role: 'tool', text: 'node scripts/gates.js --lint --unit', summary: 'lint OK · unit OK' },
  { role: 'ok', text: '✔ Frontend contract: routes match the backend: yes · ds-card, ds-table, ds-btn' },
];

export const LEAD_RUN = [
  { role: 'tool', text: 'git -C modules/demo-reports diff --stat', summary: '7 files, +486' },
  { role: 'assistant', text: 'The view calls only the route from the contract, the JSON fields match. APPROVE.' },
];

export const DIGEST_RUN = [
  { role: 'tool', text: 'node scripts/diff-digest.js --files modules/demo-reports', summary: 'size_class: large · agent_model: sonnet', body: ['changed: 7 files', 'added views: demo-reports-main', 'bug_scan_recommended: true'] },
  { role: 'tool', text: 'node scripts/check-conventions.js --modules', summary: 'VERDICT: PASS', body: ['BLOCK 0 · WARN 0 · NOTE 1', 'NOTE ds-classes: client/style.css overrides the .ds-table spacing with a compound selector'] },
  { role: 'assistant', text: 'One note needs a judgement — I call the conventions guardian.' },
];

export const GUARDIAN_RUN = [
  { role: 'tool', verb: 'Agent', text: 'cockpit-guardian', summary: 'judging the NOTE' },
  { role: 'ok', text: '✔ VERDICT: PASS — the table spacing is scoped to .demo-reports-table, the Design System is untouched' },
];

export const VERIFY_RUN = [
  { role: 'out', text: '  AC1  manifest: hub knowledge, area Product         PASS' },
  { role: 'out', text: '  AC2  list of reports from the sample data           PASS' },
  { role: 'out', text: '  AC3  the week filter narrows the list               PASS' },
  { role: 'out', text: '  AC4  preview of the selected report                 PASS' },
  { role: 'err', text: '  AC5  an empty week shows a message                  FAIL' },
  { role: 'out', text: '  AC6  core untouched, module tests green             PASS' },
  { role: 'warn', text: '  gap_report -> frontend-implementer: AC5 (client/index.js:58)' },
];

export const GAPFIX_RUN = [
  { role: 'tool', verb: 'Edit', text: 'modules/demo-reports/client/index.js', summary: 'empty state: “No reports this week.”' },
  { role: 'out', text: '  AC5  an empty week shows a message                  PASS' },
  { role: 'ok', text: '✔ AC: 6 / 6 PASS' },
];

export const BUG_RUN = [
  { role: 'out', text: '  [FUNC] scanning broken logic...    score: 0' },
  { role: 'out', text: '  [REQ]  scanning missed steps...   score: 0' },
  { role: 'out', text: '  [UX]   scanning usability gaps... score: 2  (the preview does not scroll for a long report)' },
  { role: 'ok', text: '  total: 2 / threshold: 5  >  VERDICT: SHIP' },
];

export const HANDOFF = [
  { role: 'tool', text: 'node scripts/plan-status.js ' + NOWY_MODUL_PLAN_PATH + ' --status done --ac "AC1=pass,…,AC6=pass"', summary: 'status, checkboxes, banner, HTML' },
  { role: 'ok', text: '> **[IMPLEMENTED 2026-10-04]** — status: done.' },
  { role: 'assistant', text: 'The implementation is ready in modules/demo-reports (its own repository, no remote). Restart the server in Settings > Modules.' },
];

export const FIX_TEAM_RUN = [
  { role: 'tool', verb: 'Read', text: 'modules/demo-reports/client/index.js' },
  { role: 'tool', verb: 'Edit', text: 'modules/demo-reports/server/sample-reports.json', summary: 'a team field in every report' },
  { role: 'tool', verb: 'Edit', text: 'modules/demo-reports/client/index.js', summary: 'Team filter, update date in the header' },
  { role: 'tool', text: 'node --test modules/demo-reports/tests/', summary: '11 tests, 0 failures' },
  { role: 'assistant', text: 'Done — refresh the page in Mission Deck.' },
];

export const FIX_OWNER_RUN = [
  { role: 'tool', verb: 'Edit', text: 'modules/demo-reports/client/index.js', summary: 'Owner column, sorted by date descending' },
  { role: 'tool', text: 'node --test modules/demo-reports/tests/', summary: '12 tests, 0 failures' },
  { role: 'assistant', text: 'Done: the newest reports are at the top.' },
];

export const DATA_RUN = [
  { role: 'tool', verb: 'Read', text: 'docs/architecture/modules.md', summary: 'dataRepos[]: name, description, paths' },
  { role: 'tool', verb: 'Edit', text: 'modules/demo-reports/module.json', summary: 'dataRepos: data-tier-0, demo-reports/' },
  { role: 'tool', verb: 'Edit', text: 'modules/demo-reports/client/index.js', summary: 'reads the reports from the team folder instead of the sample' },
  { role: 'tool', text: 'node scripts/check-conventions.js --modules', summary: 'VERDICT: PASS · BLOCK 0 · WARN 0' },
  { role: 'assistant', text: 'module.json is read at startup — restart the server in Settings > Modules.' },
];

// ── Editor content ──────────────────────────────────────────────────────

export const NOWY_MODUL_PLAN_TEXT = `# The “Demo reports” module in the Knowledge hub

**Status:** draft · **Surface:** view

## Business description

**Why we are doing this:** the teams’ weekly reports are scattered across several places today.

**What changes for the user:**

1. Every report of the week in one list.
2. Picking a week narrows the list.
3. Clicking a report shows its preview next to it.

**What the user will see after release:** in Knowledge, an item
“Demo reports” with a list, a week filter and a preview.

**What this does NOT change:** the rest of Mission Deck stays as it is.

## Acceptance criteria

| AC | Criterion | How we check |
|---|---|---|
| AC1 | Manifest: hub Knowledge, area Product | module test |
| AC2 | List of reports from the sample data | module test |
| AC3 | The week filter narrows the list | module test |
| AC4 | Preview of the selected report next to the list | view in the browser |
| AC5 | An empty week shows a message | module test |
| AC6 | Core untouched, module tests green | \`gates.js\` |

## Files

- \`modules/demo-reports/module.json\` — manifest, a page in the **Knowledge** hub
- \`modules/demo-reports/server/index.js\` — a route with sample reports
- \`modules/demo-reports/client/index.js\` — list, week filter, preview

## Out of scope

- Team data from the repository — a separate request after the first version.
`;


export const SERVER_CODE = `// modules/demo-reports/server/index.js (fragment)
export function register(ctx) {
  ctx.route('GET', '/reports', async (req, res) => {
    const week = ctx.query(req).week || null;
    const list = await loadReports(ctx);
    ctx.jsonResponse(res, 200, week
      ? list.filter((r) => r.week === week)
      : list);
  });
}
`;

export const CLIENT_CODE = `// modules/demo-reports/client/index.js (fragment)
export async function render(root, api) {
  const reports = await api.get('reports');
  root.innerHTML = weekFilter(reports)
    + reportTable(reports) + preview(reports[0]);
}
`;

export const CLIENT_TEAM = `
// team filter and the date of the last update
const teams = [...new Set(reports.map((r) => r.team))];
header.dataset.updated = newest(reports).updatedAt;
`;

export const CLIENT_OWNER = `
// Owner column, newest at the top
reports.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
`;

/** module.json after the data hookup: the dataRepos entry Claude wrote. */
export const NOWY_MODUL_MANIFEST = `{
  "schemaVersion": 1,
  "id": "demo-reports",
  "name": "Demo reports",
  "version": "0.1.0",
  "status": "beta",
  "area": "Product",
  "sidebar": { "label": "Demo reports", "kind": "page", "hub": "knowledge" },
  "dataRepos": [
    {
      "name": "data-tier-0",
      "description": "The teams’ weekly reports",
      "paths": ["demo-reports/"]
    }
  ]
}
`;

export const MOCKS = {
  'nowy-modul-page': (props) => page(props),
  'nowy-modul-installed': (props) => installed(props),
  'nowy-modul-relay': () => relay(),
  'nowy-modul-chip': (props) => chip(props),
  'nowy-modul-baton': (props) => baton(props),
};

/** Every visible label these painters paint (copy gate). */
export const LABELS = [
  'Demo reports', 'Fill in the subtitle.', 'Main action', 'Refresh', 'Demo reports - view under construction.', 'More',
  'Installed', 'Upload from file', 'All areas', 'Module', 'Version', 'Status', 'Area', 'Place in the menu', 'Actions',
  'Enabled', 'stable', 'beta', 'Details', 'Disable', 'Export', 'Publish', 'Remove', 'Restart now', 'Restarting...',
  'The module change needs a server restart to take effect.', ...INSTALLED.map((m) => m.name),
  'Baton', 'Waiting for an idea.', ...Object.values(STATES).map((s) => s[1]),
  'The teams’ weekly reports in one place.', 'Last update', 'Week', 'Team', 'All weeks',
  'All teams', 'Report', 'Author', 'Owner', 'Updated', 'reports', 'Preview', 'Open the whole report',
  'Source: the module’s sample data', 'Source: the team repository', 'Data up to date - local 04.10 08:15, server 04.10 08:15.',
  'Open sync', ...REPORTS.map((r) => r.title), ...Object.values(PREVIEW).flat(),
];
