// demo/mocks/ch-skills-and-agents.mjs
// Painters for chapter `skills-and-agents`: pure (props) => htmlString, DS classes only.
// Settings > Agents follows js/settings-agenci.js (_renderCard, groups, the
// ds-select built by js/ds-select.js), Settings > Skills follows
// js/settings-skille.js (_renderSkillCard, counters) and the skill window the
// shell's #doc-modal-overlay shape (js/doc-modal.js). Names, phases and
// agents are the real ones derived from .claude/skills/ and
// .claude/default-models.json.

import { esc } from './common.mjs';

// ── Agents ────────────────────────────────────────────────────────────────

const MODELS = [
  ['claude-opus-5-5', 'Opus 5.5'], ['claude-opus-5', 'Opus 5'], ['claude-opus-4-8', 'Opus 4.8'],
  ['claude-opus-4-6', 'Opus 4.6'], ['claude-sonnet-5-5', 'Sonnet 5.5'], ['claude-sonnet-5', 'Sonnet 5'],
  ['claude-sonnet-4-6', 'Sonnet 4.6'], ['claude-fable-5-1', 'Fable 5.1'], ['claude-haiku-5-5', 'Haiku 5.5'], ['claude-haiku-4-5', 'Haiku 4.5'],
];

/** Display copy and phase from js/settings-agenci.js; models from .claude/default-models.json. */
const AGENTS = {
  'idea-planner': { img: 'overwatch', who: 'Overwatch', model: 'claude-opus-4-6', phase: ['phase 4', '/new-idea', true],
    desc: 'The plan architect. Writes a structured implementation plan to plans/ from the repo map and the interview.' },
  'idea-implementer': { img: 'cipher', who: 'Cipher', model: 'claude-sonnet-4-6', phase: ['phase 6', '/new-idea', true],
    desc: 'The fast path: carries out a small plan end to end (index.html, js/, styles.css, server.js, tests/) in one agent.' },
  'backend-implementer': { img: 'vex', who: 'Vex', model: 'claude-sonnet-4-6', phase: ['phase 6a', '/new-idea', true],
    desc: 'The split path, backend slice: server.js, scripts/ and API tests. Hands over the endpoint contract for the frontend.' },
  'frontend-implementer': { img: 'mira', who: 'Mira', model: 'claude-sonnet-4-6', phase: ['phase 6b', '/new-idea', true],
    desc: 'The split path, frontend slice: index.html, js/, styles.css following the plan and the backend contract.' },
  'ac-verifier': { img: 'ledger', who: 'Ledger', model: 'claude-haiku-5-5', phase: ['phase 6f', '/new-idea', true],
    desc: 'The blind acceptance-criteria verifier. Reads the plan + diff and rates PASS/FAIL per criterion.' },
  'cockpit-guardian': { img: 'quiet', who: 'Quiet', model: 'claude-sonnet-4-6', phase: ['phase 6e', '/new-idea', false],
    desc: 'The Mission Deck conventions guardian. Checks the rules the linter does not know (DS, sidebar, sync).' },
  'code-quality-auditor': { img: 'canon', who: 'Canon', model: 'claude-opus-4-6', phase: ['phase 2', '/pre-ship-audit', true],
    desc: 'A code-quality review of the diff. Looks for simplifications, repetition and performance problems.' },
  'security-auditor': { img: 'forge', who: 'Forge', model: 'claude-opus-4-6', phase: ['phase 2', '/pre-ship-audit', true],
    desc: 'A security review of the diff: token leaks, path traversal, injection, XSS.' },
};

const AGENT_GROUPS = [
  { label: 'Planning', hint: '/new-idea -> a plan to review', agents: ['idea-planner'] },
  { label: 'Implementation', hint: '/new-idea -> code on a branch', agents: ['idea-implementer', 'backend-implementer', 'frontend-implementer'] },
  { label: 'Review', hint: '/new-idea + /pre-ship-audit -> a verdict', agents: ['ac-verifier', 'cockpit-guardian', 'code-quality-auditor', 'security-auditor'] },
];

const CHEVRON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function _label(model) {
  const hit = MODELS.find(([id]) => id === model);
  return hit ? hit[1] : model;
}

function _select(name, model) {
  const opts = MODELS.map(([id, label]) => '<li class="ds-sel-opt' + (id === model ? ' ds-sel-opt--sel' : '') + '" role="option" id="skille-i-agenci-opt-' + esc(name) + '-' + id + '">'
    + '<span class="ds-sel-check"></span><span>' + esc(label) + '</span></li>').join('');
  return '<div class="ds-sel-wrap" id="skille-i-agenci-sel-' + esc(name) + '">'
    + '<button type="button" class="ds-sel-trigger" id="skille-i-agenci-trigger-' + esc(name) + '" aria-label="Agent model ' + esc(name) + '">'
    + '<span class="ds-sel-text" id="skille-i-agenci-trigger-text-' + esc(name) + '">' + esc(_label(model)) + '</span><span class="ds-sel-icon">' + CHEVRON + '</span></button>'
    + '<div class="ds-sel-drop skille-i-agenci-drop" id="skille-i-agenci-drop-' + esc(name) + '" hidden>'
    + '<div class="ds-sel-search-wrap"><input type="text" class="ds-sel-search" placeholder="Search…"></div>'
    + '<ul class="ds-sel-list" role="listbox">' + opts + '</ul></div></div>';
}

function _agentCard(name) {
  const a = AGENTS[name];
  const [phaseLabel, skill, brand] = a.phase;
  return '<article class="ds-card sett-agent-card" id="skille-i-agenci-card-' + esc(name) + '">'
    + '<div class="sett-agent-head"><img class="sett-agent-avatar" src="/assets/agents/' + esc(a.img) + '.svg" alt="">'
    + '<div class="sett-agent-id"><strong class="sett-agent-name">' + esc(name) + '</strong><span class="sett-agent-character">' + esc(a.who) + '</span></div>'
    + '<span class="sett-agent-phase"><span class="ds-badge ds-badge--sm ' + (brand ? 'ds-badge--brand' : 'ds-badge--gray') + '">' + esc(phaseLabel) + '</span>'
    + '<span class="sett-agent-phase-skill">' + esc(skill) + '</span></span></div>'
    + '<p class="sett-agent-desc">' + esc(a.desc) + '</p>'
    + '<div class="sett-agent-model"><span class="ds-badge ds-badge--gray" id="skille-i-agenci-badge-' + esc(name) + '">' + esc(a.model) + '</span>'
    + '<span class="sett-agent-overridden" id="skille-i-agenci-over-' + esc(name) + '" hidden>overridden</span></div>'
    + '<label class="sett-agent-field"><span class="sett-agent-field-label">Change model</span>' + _select(name, a.model) + '</label>'
    + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm sett-agent-brief-btn">See the agent brief</button>'
    + '</article>';
}

function _agents() {
  return '<div class="sett-agenci-inner">'
    + '<div class="sett-agent-reset-bar"><button type="button" class="ds-btn ds-btn--secondary ds-btn--sm">Restore defaults</button>'
    + '<span class="sett-agent-reset-hint">Removes every override and restores the models from the repository.</span></div>'
    + AGENT_GROUPS.map((g, i) => '<section class="sett-agent-group" id="skille-i-agenci-group-' + i + '"><h3 class="sett-agent-group-heading">'
      + '<span class="sett-agent-group-name">' + esc(g.label) + '</span><span class="sett-agent-group-hint">' + esc(g.hint) + '</span>'
      + '<span class="sett-agent-group-count">' + g.agents.length + '</span></h3>'
      + '<div class="sett-agent-grid">' + g.agents.map(_agentCard).join('') + '</div></section>').join('')
    + '</div>';
}

// ── Skills ────────────────────────────────────────────────────────────────

/** Phases, agents and commands as the Skills tab derives them from .claude/skills/ (copied 2026-10-03). */
const SKILLS = {
  'new-idea': { kind: 'pipeline', out: 'plans/<date>-<slug>.md + .html + code on a branch', phases: ['0', '1', '2', '3', '4', '4.5', '4.6', '5', '6', '6a', '6b', '6c', '6d', '6e', '6f', '6g', '6.6', '6.7', '7'], agents: 11, commands: 15,
    desc: 'Plans and implements a change in the mission-deck repo - a new view, a new endpoint, a bug fix or a refactor. Runs a short interview, and the idea-planner agent writes a plan with acceptance criteria to plans/.' },
  'pre-ship-audit': { kind: 'audit', out: 'user-data/audits/pre-ship-audit-<date>.md', phases: ['1', '1.4', '1.5', '1.6', '2', '3', '4', '5'], agents: 4, commands: 6,
    desc: 'A thorough audit of changes before a commit or push in the mission-deck repo. Deterministic gates and the conventions check first, then specialist auditors.' },
  'commit-message': { kind: 'tool', out: 'a suggested commit message', phases: [], agents: 1, commands: 2,
    desc: 'Analyses the current diff and suggests a Conventional Commits message. Judges whether the diff is coherent or covers several topics.' },
  prototype: { kind: 'pipeline', out: 'a mockup in the data repo + screenshots in assets/', phases: ['0', '1', '2', '3', '4', '4.5', '4.6', '5', '6', '6g', '7', '6e+6f'], agents: 6, commands: 10,
    desc: 'Plans and builds a screen prototype in mission-deck: React, the production Design System tokens and spec.json, in the team data repo.' },
  mini: { kind: 'pipeline', out: 'a plan in plans/ + code in the mini project repo', phases: ['0', '0.5', '1', '2', '3', '4', '4.5', '5', '6', '6f', '6.7', '7'], agents: 4, commands: 3,
    desc: 'Plans and implements a change in a mini app (Vite + React 18 + TypeScript) registered in the skill’s project folder.' },
  jira: { kind: 'document', out: 'user-data/initiatives/tasks/*.md + a Jira issue', phases: [], agents: 0, commands: 0,
    desc: 'Creates and updates Jira issues through the local Mission Deck server, without direct access to the token. Saves an .md version to user-data first, then creates the issue.' },
  confluence: { kind: 'document', out: 'user-data/confluence/*.md + a Confluence page', phases: [], agents: 0, commands: 0,
    desc: 'Reads and writes Confluence pages through the local Mission Deck server, without direct access to the token. A draft in user-data first, then the page is saved.' },
  'summarize-meeting': { kind: 'document', out: 'user-data/meetings/<date>-<topic>.md', phases: [], agents: 1, commands: 2,
    desc: 'Writes a meeting summary from a transcript or notes, using the templates in templates/meeting-notes/.' },
  kudos: { kind: 'document', out: 'user-data/summaries/<date>-<slug>.html', phases: [], agents: 0, commands: 0,
    desc: 'Generates a static .html page summing up the contribution and congratulating the work on a branch or in a merge request, always on one template.' },
  'refresh-repo-map': { kind: 'skill', out: '', phases: [], agents: 0, commands: 1,
    desc: 'Refreshes the repo map the planner reads instead of searching the tree. One command, no agent and no model.' },
};

const SKILL_GROUPS = [
  { label: 'Everyday', hint: 'the path from an idea to a commit', skills: ['new-idea', 'pre-ship-audit', 'commit-message'] },
  { label: 'Building', hint: 'outside the main Mission Deck repo', skills: ['prototype', 'mini'] },
  { label: 'Documents', hint: 'what stays after the work', skills: ['jira', 'confluence', 'summarize-meeting', 'kudos'] },
  { label: 'Other', hint: 'skills outside the known groups', skills: ['refresh-repo-map'] },
];

function _counter(id, n, one, many) {
  if (!n) return '';
  return '<button type="button" class="sett-skill-counter" id="skille-i-agenci-counter-' + id + '"><strong>' + n + '</strong> ' + esc(n === 1 ? one : many) + '</button>';
}

function _skillCard(name) {
  const s = SKILLS[name];
  const counters = _counter(name + '-phases', s.phases.length, 'phase', 'phases') + _counter(name + '-agents', s.agents, 'agent', 'agents')
    + _counter(name + '-commands', s.commands, 'command', 'commands');
  const list = s.phases.length
    ? '<ul class="sett-skill-counter-list" id="skille-i-agenci-phases-' + name + '" hidden>' + s.phases.map((p) => '<li>Phase ' + esc(p) + '</li>').join('') + '</ul>'
    : '';
  return '<article class="ds-card sett-skill-card" id="skille-i-agenci-skill-' + name + '">'
    + '<div class="sett-skill-head"><code class="sett-skill-trigger">/' + esc(name) + '</code><span class="ds-badge ds-badge--sm ds-badge--gray sett-skill-kind">' + esc(s.kind) + '</span></div>'
    + '<p class="sett-skill-desc">' + esc(s.desc) + '</p>'
    + (counters ? '<div class="sett-skill-counters">' + counters + '</div>' + list : '')
    + (s.out ? '<p class="sett-skill-output"><span aria-hidden="true">-&gt;</span> ' + esc(s.out) + '</p>' : '')
    + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm sett-skill-open" id="skille-i-agenci-open-' + name + '">See instructions</button></article>';
}

function _skills() {
  return '<div class="sett-skille-inner">' + SKILL_GROUPS.map((g) => '<section class="sett-skill-group"><h3 class="sett-skill-group-heading">'
    + '<span class="sett-skill-group-name">' + esc(g.label) + '</span><span class="sett-skill-group-count">' + g.skills.length + '</span>'
    + '<span class="sett-skill-group-hint">' + esc(g.hint) + '</span></h3>'
    + '<div class="sett-skill-grid">' + g.skills.map(_skillCard).join('') + '</div></section>').join('') + '</div>';
}

// ── the skill window (doc-modal shape) ────────────────────────────────────

const DOC_TABS = ['SKILL.md', 'PHASES.md', 'PREFLIGHT-CHECKLIST.md', 'plan.md', 'questions.md'];

const PHASE_ROWS = [
  ['0', 'bootstrap', 'checking the index and the tools'],
  ['2', 'interview', 'short questions about the scope'],
  ['4', 'planner', 'idea-planner writes the plan to plans/'],
  ['4.5', 'preflight', 'scripts/plan-preflight.js, 22 rules'],
  ['5', 'review', 'the plan goes to a human for acceptance'],
  ['6', 'implementation', 'the fast or the split path (6a-6c)'],
  ['6e / 6f', 'guardian and verifier', 'conventions and acceptance criteria'],
  ['6.7', 'bug scan', 'bug-auditor, a SHIP/ITERATE verdict'],
  ['7', 'handoff', 'scripts/plan-status.js, the plan status'],
];

function _docBody(tab) {
  if (tab === 'PHASES.md') {
    return '<div class="md-body"><h1>/new-idea phases</h1><p>Every phase has one owner: a script, an agent or a human.</p>'
      + '<table><thead><tr><th>Phase</th><th>Name</th><th>What happens</th></tr></thead><tbody>'
      + PHASE_ROWS.map(([p, n, d]) => '<tr><td><strong>' + esc(p) + '</strong></td><td>' + esc(n) + '</td><td>' + esc(d) + '</td></tr>').join('')
      + '</tbody></table></div>';
  }
  return '<div class="md-body"><h1>/new-idea</h1>'
    + '<p><strong>TL;DR:</strong> An idea becomes a plan with acceptance criteria, the plan becomes code on a branch, and the code passes the gates, the conventions guardian and a blind verifier before a human commits it.</p>'
    + '<h2>When to use</h2><p>“add X”, “let’s build X”, “new view X”, or /new-idea directly.</p>'
    + '<h2>Phases</h2><p>The details of every phase are in PHASES.md - switch the tab.</p></div>';
}

function _docTabs(tab) {
  return '<div class="doc-modal-tabs" id="skille-i-agenci-doc-tabs">' + DOC_TABS.map((t, i) => '<button type="button" class="doc-modal-tab' + (t === tab ? ' active' : '')
    + '" id="skille-i-agenci-doc-tab-' + i + '">' + esc(t) + '</button>').join('') + '</div>';
}

function _docModal({ tab = 'SKILL.md' } = {}) {
  const tabs = _docTabs(tab);
  return '<div class="ds-modal-overlay" id="skille-i-agenci-doc-modal" hidden>'
    + '<div class="ds-modal ds-modal--xl doc-modal" role="dialog" aria-modal="true">'
    + '<div class="ds-modal-header"><div class="doc-modal-heading"><h2 class="ds-modal-title">/new-idea</h2>'
    + '<code class="doc-modal-path" id="skille-i-agenci-doc-path">.claude/skills/new-idea/' + esc(tab) + '</code></div>'
    + '<button type="button" class="ds-modal-close" id="skille-i-agenci-doc-close" aria-label="Close">&times;</button></div>'
    + tabs
    + '<div class="ds-modal-body doc-modal-body" id="skille-i-agenci-doc-body">' + _docBody(tab) + '</div>'
    + '<div class="ds-modal-footer"><button type="button" class="ds-btn ds-btn--secondary">Close</button></div>'
    + '</div></div>';
}

export const MOCKS = {
  /** Settings > Agents content (replaces the slot's skeleton). */
  'skille-i-agenci-agents': () => _agents(),
  /** Settings > Skills content. */
  'skille-i-agenci-skills': () => _skills(),
  /** The skill window. props: { tab } */
  'skille-i-agenci-doc-modal': (p = {}) => _docModal(p),
  /** Tab strip of the skill window. props: { tab } */
  'skille-i-agenci-doc-tabs': ({ tab = 'PHASES.md' } = {}) => _docTabs(tab),
  /** Body of the skill window for one tab. props: { tab } */
  'skille-i-agenci-doc-body': ({ tab = 'PHASES.md' } = {}) => _docBody(tab),
};

/** Every visible label these painters paint (copy gate). */
export const LABELS = [
  'Restore defaults', 'Removes every override and restores the models from the repository.', 'Change model', 'See the agent brief',
  'overridden', 'Search…', ...MODELS.map((m) => m[1]),
  ...AGENT_GROUPS.flatMap((g) => [g.label, g.hint]), ...Object.values(AGENTS).map((a) => a.desc),
  ...SKILL_GROUPS.flatMap((g) => [g.label, g.hint]), ...Object.values(SKILLS).map((s) => s.desc),
  'See instructions', 'phases', 'agents', 'commands',
  ...PHASE_ROWS.flatMap((r) => [r[1], r[2]]),
];
