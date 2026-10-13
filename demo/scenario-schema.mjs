// demo/scenario-schema.mjs
// The contract of the demo scenario: which action types exist, in which order
// the chapters run, which shell paths a `navigate` may take, and
// validateScenario() that checks a scenario against all of it.
//
// Pure and DOM-free on purpose: tests/test_demo_scenario.mjs imports it under
// node, and the engine imports the same functions in the browser, so the gate
// and the player can never disagree about what a valid step is.

import { MASCOT_HIDDEN_POSES } from './mascot-geometry.mjs';

/**
 * Every action a step may carry. The engine dispatches on `type`; a type that
 * is not in this list is a validation problem, never a silent no-op.
 * Field reference (required fields first):
 *   surface  { show: 'cockpit'|'vscode'|'split'|'screen', mock?, props? }  mock required for 'screen'; props go to that mock
 *   navigate { view, tab? }        expanded by the engine into visible clicks (navigatePath)
 *   click    { target }            cursor glides, hovers, clicks; the click itself has no effect
 *   hover    { target, ms? }       cursor glides and rests on target (demo-hover + title/data-tip bubble), no click
 *   type     { target, text, mask?, paste? }  cursor clicks the field, then types char by char; every
 *            substring in paste (string or [string]) lands at once, like Cmd+V / Ctrl+V (a copied link)
 *   show     { mock, target, mode?: 'replace'|'append'|'prepend'|'outer', props? }  'outer' replaces the target itself
 *   hide     { target, hidden?: boolean }  hidden:false reveals it again
 *   toast    { variant, title, desc? }
 *   modal    { open: mockId, props? } | { openEl: selector } | { close: selector }  openEl = an overlay already in the shell
 *   badge    { target, tone, text }
 *   progress { target?, lines?: [{ step, detail?, status?, time? }], format?: 'sync'|'log', bar?, pct?, label?, labelTarget? }
 *            pct sets --ips-pct on bar, and an inline width when bar is a fill (.ds-progress-fill, .ips-bar-fill, [data-demo-fill])
 *   terminal { lines: [{ role, text, verb?, summary?, body?, cwd? }], on?: 'vscode'|'cockpit', close? }
 *            verb (role 'tool' only) from TOOL_VERBS, default 'Ran'; cwd (role 'cmd' only) the prompt's directory;
 *            paste (roles 'user' and 'cmd') substrings of text pasted at once instead of typed
 *   editor   { file, text, lang?, mode?: 'append'|'replace' }  'replace' rewrites the tab; a .md file shows as
 *            its Markdown preview. { file, text, group: 'term' } opens that preview as a tab of the terminal
 *            group, { file, group: 'term', close: true } closes it
 *   explorer { add?: [path], open?: path, empty?: true, reset?: true }  empty = no folder open yet, reset = the freshly cloned tree
 *   wait     { ms }
 *   narrate  { title, body, command? }
 *   ask      { text, then: [action], on?: 'cockpit'|'vscode' }
 *   preview  { title, lines: [string], kind?: 'html'|'csv'|'log' } | { close: true }  on the surface on screen; dims and blurs the rest
 *   flyout   { view }              adds a declared page (scenario.pages) to its hub flyout
 *   scroll   { target }            scrolls an element into view without a click
 *   camera   { target, zoom? } | { full: true }   mid-step camera move (see also step.camera)
 *
 * Step fields: { id, caption, mascot, camera?, actions }
 *   caption  one short first-person sentence Pip says about what happens NOW;
 *            **word** is painted in the DS accent colour
 *   mascot   a pose from MASCOT_POSES, shown as <img> next to the caption - never
 *            one of MASCOT_HIDDEN_POSES (demo/mascot-geometry.mjs): the figure must stay in sight
 *   camera   'full' | { target, zoom? } - applied before the step's actions
 * Chapter fields: { id, title, subtitle, mascot?, setup?, steps } - subtitle and
 *   mascot feed the chapter's title card (mascot required there). Scenario: { ending, pages, chapters };
 *   `ending` { title, subtitle, mascot } is the closing card after the last step.
 */
/** `paste`: a string or a list of non-empty strings, each one a part of `text`. */
function _checkPaste(paste, text, where, out) {
  if (paste === undefined) return;
  const list = Array.isArray(paste) ? paste : [paste];
  if (!list.length || !list.every((p) => typeof p === 'string' && p.length > 0 && typeof text === 'string' && text.includes(p))) {
    out.push(`${where}: paste must be a fragment of text (a string or a list of strings)`);
  }
}

export const ACTION_TYPES = [
  'surface', 'navigate', 'click', 'hover', 'type', 'show', 'hide', 'toast', 'modal',
  'badge', 'progress', 'terminal', 'editor', 'explorer', 'wait', 'narrate',
  'ask', 'preview', 'flyout', 'scroll', 'camera',
];

/** The chapters, in presentation order. Settings > Demo links each of them. */
export const CHAPTER_ORDER = [
  'guides', 'start', 'onboarding', 'settings', 'team-keys', 'academy',
  'new-module', 'publishing', 'catalog', 'using-a-module', 'design', 'sync', 'meetings',
  'time-tracking', 'on-call-and-time-off', 'roadmap', 'team', 'sprints', 'jira-confluence',
  'skills-and-agents', 'updates', 'feedback', 'day-cycle', 'summary',
];

export const SURFACES = ['cockpit', 'vscode', 'split', 'screen'];
export const TOAST_VARIANTS = ['success', 'danger', 'info', 'warning', 'neutral'];
export const BADGE_TONES = ['green', 'gray', 'blue', 'red', 'yellow', 'orange'];
export const TERMINAL_ROLES = ['cmd', 'out', 'ok', 'warn', 'err', 'dim', 'claude', 'user', 'tool', 'assistant'];
/** The verbs a Claude Code tool line may carry ("▸ Read `path`"); 'Ran' is the default. */
export const TOOL_VERBS = ['Ran', 'Read', 'Edit', 'Update', 'Write', 'Search', 'Fetch', 'Agent'];
export const EDITOR_MODES = ['append', 'replace'];
/**
 * Pip poses the narrator may take: the eight files in assets/mascot/
 * (pip-<pose>.svg, rendered as <img> - they are animated SVGs).
 * Closed list; tests/test_demo_scenario.mjs checks every file exists.
 */
export const MASCOT_POSES = ['celebrating', 'error', 'idle', 'sleeping', 'success', 'thinking', 'wave', 'working'];

export const CAPTION_MAX = 120;

export const SETTINGS_TABS = ['system', 'keys', 'agents', 'skills', 'modules', 'users', 'tools', 'demo'];

/** Core views reached by their own static rail item in index.html. */
export const RAIL_VIEWS = ['dashboard', 'onboarding-wizard', 'academy', 'settings'];

/** The eight core hubs (js/core-hubs.mjs). A hub is a flyout opener, never a view. */
export const CORE_HUBS = [
  { id: 'team', label: 'Team' },
  { id: 'activity', label: 'Activity' },
  { id: 'finance', label: 'Finance' },
  { id: 'initiatives', label: 'Initiatives' },
  { id: 'support', label: 'Support' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'assets', label: 'Design' },
  { id: 'apps', label: 'Apps' },
];

/** Pages the CORE ships inside a hub (js/core-hubs.mjs `pages`). */
export const CORE_PAGES = [
  { hub: 'assets', view: 'assets-design-system', label: 'Design System', initial: true },
  { hub: 'assets', view: 'assets-icons', label: 'Icons', initial: true },
  { hub: 'assets', view: 'assets-illustrations', label: 'Illustrations', initial: true },
  { hub: 'assets', view: 'assets-mascot', label: 'Mascot', initial: true },
  { hub: 'assets', view: 'prototypy', label: 'Prototypes', initial: true },
];

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ASCII = /^[\x20-\x7e]*$/;

/** All pages a navigate may reach through a hub: core pages plus the scenario's declared module pages. */
export function allPages(scenario) {
  const declared = (scenario && Array.isArray(scenario.pages)) ? scenario.pages : [];
  return CORE_PAGES.concat(declared);
}

/**
 * The visible road to a view, as the clicks a person makes. Pure: the engine
 * skips a click whose effect is already true (same view, same tab).
 * Each op: { click: selector, effect: { kind: 'hub'|'view'|'tab', hub?, view?, tab? } }.
 * @param {{ view: string, tab?: string }} target
 * @param {Array<{hub: string, view: string}>} pages
 * @returns {Array<object>|null} null when no road exists
 */
export function navigatePath(target, pages) {
  if (!target || typeof target.view !== 'string') return null;
  const ops = [];
  if (RAIL_VIEWS.includes(target.view)) {
    ops.push({
      click: `#sidebar a.sidebar-item[data-view="${target.view}"]`,
      effect: { kind: 'view', view: target.view },
    });
  } else {
    const page = (pages || []).find((p) => p.view === target.view);
    if (!page || !CORE_HUBS.some((h) => h.id === page.hub)) return null;
    ops.push({
      click: `#sidebar a.sidebar-item--hub[data-view="${page.hub}"]`,
      effect: { kind: 'hub', hub: page.hub },
    });
    ops.push({
      click: `.sidebar-hub-flyout-item[data-flyout-view="${target.view}"]`,
      effect: { kind: 'view', view: target.view },
    });
  }
  if (target.tab !== undefined) {
    if (target.view !== 'settings' || !SETTINGS_TABS.includes(target.tab)) return null;
    ops.push({
      click: `#settings-tabs [data-sett-tab="${target.tab}"]`,
      effect: { kind: 'tab', tab: target.tab },
    });
  }
  return ops;
}

function _isStr(v) { return typeof v === 'string' && v.trim() !== ''; }
function _isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function _checkCamera(cam, where) {
  if (cam === 'full') return [];
  if (!cam || !_isStr(cam.target)) return [`${where}: camera needs 'full' or { target }`];
  if (cam.zoom !== undefined && !(typeof cam.zoom === 'number' && cam.zoom >= 1 && cam.zoom <= 3)) return [`${where}: camera.zoom outside 1..3`];
  return [];
}

function _checkCard(card, where) {
  const out = [];
  if (!card || !_isStr(card.title) || !_isStr(card.subtitle)) out.push(`${where}: card needs title and subtitle`);
  if (card && !MASCOT_POSES.includes(card.mascot)) out.push(`${where}: card without a Pip pose from MASCOT_POSES ("${card && card.mascot}")`);
  else if (card && MASCOT_HIDDEN_POSES.includes(card.mascot)) out.push(`${where}: pose "${card.mascot}" hides Pip - the card would show an empty box`);
  return out;
}

/**
 * Problems with ONE action, as strings. `where` names it in the message.
 * @param {object} a
 * @param {string} where
 * @param {{ pages: Array<object>, mocks: Set<string>|null }} ctx
 * @returns {string[]}
 */
function _checkAction(a, where, ctx) {
  const out = [];
  if (!a || typeof a !== 'object') return [`${where}: the action is not an object`];
  if (!ACTION_TYPES.includes(a.type)) return [`${where}: unknown action type "${a.type}"`];
  const needMock = (id) => {
    if (!_isStr(id)) out.push(`${where}: missing mock id`);
    else if (ctx.mocks && !ctx.mocks.has(id)) out.push(`${where}: unknown mock "${id}"`);
  };
  switch (a.type) {
    case 'surface':
      if (!SURFACES.includes(a.show)) out.push(`${where}: surface.show outside ${SURFACES.join('/')}`);
      if (a.show === 'screen') needMock(a.mock);
      if (a.props !== undefined && (!_isObj(a.props) || a.show !== 'screen')) out.push(`${where}: surface.props only as an object and only for 'screen'`);
      break;
    case 'navigate':
      if (!navigatePath(a, ctx.pages)) out.push(`${where}: navigate without a known path (${a.view}${a.tab ? '/' + a.tab : ''})`);
      break;
    case 'click':
    case 'hide':
    case 'scroll':
      if (!_isStr(a.target)) out.push(`${where}: ${a.type} without target`);
      break;
    case 'hover':
      if (!_isStr(a.target)) out.push(`${where}: hover without target`);
      if (a.ms !== undefined && !(typeof a.ms === 'number' && a.ms >= 0)) out.push(`${where}: hover.ms`);
      break;
    case 'type':
      if (!_isStr(a.target)) out.push(`${where}: type without target`);
      if (typeof a.text !== 'string') out.push(`${where}: type without text`);
      _checkPaste(a.paste, a.text, where, out);
      break;
    case 'show':
      needMock(a.mock);
      if (!_isStr(a.target)) out.push(`${where}: show without target`);
      if (a.mode !== undefined && !['replace', 'append', 'prepend', 'outer'].includes(a.mode)) out.push(`${where}: show.mode unknown`);
      break;
    case 'toast':
      if (!TOAST_VARIANTS.includes(a.variant)) out.push(`${where}: toast.variant unknown`);
      if (!_isStr(a.title)) out.push(`${where}: toast without title`);
      break;
    case 'modal':
      if ([a.open, a.openEl, a.close].filter(_isStr).length !== 1) out.push(`${where}: modal needs exactly one of open/openEl/close`);
      if (_isStr(a.open)) needMock(a.open);
      break;
    case 'badge':
      if (!_isStr(a.target)) out.push(`${where}: badge without target`);
      if (!BADGE_TONES.includes(a.tone)) out.push(`${where}: badge.tone unknown`);
      if (!_isStr(a.text)) out.push(`${where}: badge without text`);
      break;
    case 'progress':
      if (a.lines !== undefined) {
        if (!Array.isArray(a.lines) || !_isStr(a.target)) out.push(`${where}: progress.lines needs an array and a target`);
        else a.lines.forEach((l, i) => { if (!l || !_isStr(l.step)) out.push(`${where}: progress.lines[${i}] without step`); });
      }
      if (a.pct !== undefined && (typeof a.pct !== 'number' || !_isStr(a.bar))) out.push(`${where}: progress.pct needs a number and a bar`);
      if (a.label !== undefined && !_isStr(a.labelTarget)) out.push(`${where}: progress.label needs labelTarget`);
      if (a.lines === undefined && a.pct === undefined && a.label === undefined) out.push(`${where}: empty progress`);
      break;
    case 'terminal':
      if (a.close !== true) {
        if (!Array.isArray(a.lines) || a.lines.length === 0) out.push(`${where}: terminal without lines`);
        else a.lines.forEach((l, i) => {
          if (!l || !TERMINAL_ROLES.includes(l.role)) out.push(`${where}: terminal.lines[${i}] unknown role`);
          if (!l || typeof l.text !== 'string') out.push(`${where}: terminal.lines[${i}] without text`);
          if (l && l.verb !== undefined && (l.role !== 'tool' || !TOOL_VERBS.includes(l.verb))) out.push(`${where}: terminal.lines[${i}] verb only for the tool role, from TOOL_VERBS`);
          if (l && l.cwd !== undefined && (l.role !== 'cmd' || !_isStr(l.cwd))) out.push(`${where}: terminal.lines[${i}] cwd only for the cmd role`);
          if (l && l.paste !== undefined && l.role !== 'user' && l.role !== 'cmd') out.push(`${where}: terminal.lines[${i}] paste only for the user and cmd roles`);
          if (l) _checkPaste(l.paste, l.text, `${where}: terminal.lines[${i}]`, out);
        });
      }
      if (a.on !== undefined && !['vscode', 'cockpit'].includes(a.on)) out.push(`${where}: terminal.on unknown`);
      break;
    case 'editor':
      if (a.group !== undefined && a.group !== 'term') out.push(`${where}: editor.group can only be 'term'`);
      if (a.group === 'term' && !/\.md$/.test(a.file || '')) out.push(`${where}: a preview in the terminal group only for a .md file`);
      if (a.close === true ? !_isStr(a.file) : (!_isStr(a.file) || typeof a.text !== 'string')) out.push(`${where}: editor needs file and text`);
      if (a.mode !== undefined && !EDITOR_MODES.includes(a.mode)) out.push(`${where}: editor.mode outside ${EDITOR_MODES.join('/')}`);
      break;
    case 'explorer':
      if (a.add === undefined && a.open === undefined && a.empty !== true && a.reset !== true) out.push(`${where}: explorer without add/open/empty/reset`);
      if (a.add !== undefined && (!Array.isArray(a.add) || !a.add.every(_isStr))) out.push(`${where}: explorer.add must be a list of paths`);
      break;
    case 'wait':
      if (typeof a.ms !== 'number' || a.ms < 0) out.push(`${where}: wait.ms`);
      break;
    case 'narrate':
      if (!_isStr(a.title) || !_isStr(a.body)) out.push(`${where}: narrate needs title and body`);
      break;
    case 'ask':
      if (!_isStr(a.text)) out.push(`${where}: ask without text`);
      if (!Array.isArray(a.then) || a.then.length === 0) out.push(`${where}: ask without then`);
      else a.then.forEach((t, i) => {
        if (t && t.type === 'ask') out.push(`${where}.then[${i}]: nested ask`);
        out.push(..._checkAction(t, `${where}.then[${i}]`, ctx));
      });
      break;
    case 'preview':
      if (a.close !== true && (!_isStr(a.title) || !Array.isArray(a.lines) || a.lines.length === 0)) out.push(`${where}: preview needs title and lines`);
      break;
    case 'camera':
      out.push(..._checkCamera(a.full === true ? 'full' : a, where));
      break;
    case 'flyout':
      if (!ctx.pages.some((p) => p.view === a.view)) out.push(`${where}: flyout for an undeclared page "${a.view}"`);
      break;
    default:
      break;
  }
  return out;
}

/**
 * A navigate to a module page needs that page in its hub flyout first: a
 * `flyout` action in the chapter's setup or earlier in the chapter.
 * @param {object} ch
 * @param {Array<object>} pages
 * @returns {string[]}
 */
function _checkFlyoutOrder(ch, pages) {
  const out = [];
  const added = new Set(CORE_PAGES.filter((p) => p.initial !== false).map((p) => p.view));
  const visit = (a, where) => {
    if (!a || typeof a !== 'object') return;
    if (a.type === 'flyout') added.add(a.view);
    if (a.type === 'navigate' && !RAIL_VIEWS.includes(a.view) && pages.some((p) => p.view === a.view) && !added.has(a.view)) {
      out.push(`${where}: navigate to "${a.view}" without an earlier flyout in the chapter`);
    }
    if (a.type === 'ask' && Array.isArray(a.then)) a.then.forEach((t, i) => visit(t, `${where}.then[${i}]`));
  };
  (ch.setup || []).forEach((a, i) => visit(a, `${ch.id}.setup[${i}]`));
  for (const step of ch.steps || []) ((step && step.actions) || []).forEach((a, i) => visit(a, `${step && step.id}[${i}]`));
  return out;
}

/**
 * Every problem with a scenario, as English sentences. Empty list = valid.
 * @param {{ chapters: Array<object>, pages?: Array<object> }} scenario
 * @param {{ mocks?: Iterable<string> }} [opts] known mock ids; omitted = not checked
 * @returns {string[]}
 */
export function validateScenario(scenario, opts = {}) {
  const problems = [];
  if (!scenario || !Array.isArray(scenario.chapters)) return ['scenario without a chapters list'];
  const ctx = {
    pages: allPages(scenario),
    mocks: opts.mocks ? new Set(opts.mocks) : null,
  };
  const ids = scenario.chapters.map((c) => c && c.id);
  if (ids.join(',') !== CHAPTER_ORDER.join(',')) {
    problems.push(`chapter order differs from CHAPTER_ORDER: ${ids.join(', ')}`);
  }
  for (const page of scenario.pages || []) {
    if (!page || !KEBAB.test(page.view || '') || !CORE_HUBS.some((h) => h.id === page.hub) || !_isStr(page.label)) {
      problems.push(`page ${page && page.view}: needs view (kebab-case), a hub from CORE_HUBS and label`);
    }
    if (page && page.mock !== undefined && ctx.mocks && !ctx.mocks.has(page.mock)) {
      problems.push(`page ${page.view}: unknown mock "${page.mock}"`);
    }
    // A module page is in a flyout only where a chapter adds it (`flyout`);
    // an initial page would leak into every chapter's menu.
    if (page && page.initial !== false) problems.push(`page ${page.view}: a module page must have initial: false`);
  }
  problems.push(..._checkCard(scenario.ending, 'ending card'));
  const seen = new Set();
  for (const ch of scenario.chapters) {
    if (!ch) continue;
    problems.push(..._checkCard(ch, `chapter ${ch.id}`));
    (ch.setup || []).forEach((a, i) => problems.push(..._checkAction(a, `${ch.id}.setup[${i}]`, ctx)));
    if (!Array.isArray(ch.steps) || ch.steps.length === 0) {
      problems.push(`chapter ${ch.id}: no steps`);
      continue;
    }
    problems.push(..._checkFlyoutOrder(ch, ctx.pages));
    for (const step of ch.steps) {
      const sid = step && step.id;
      if (!_isStr(sid) || !KEBAB.test(sid) || !ASCII.test(sid)) problems.push(`step ${sid}: id must be ASCII kebab-case`);
      if (seen.has(sid)) problems.push(`step ${sid}: duplicate id`);
      seen.add(sid);
      const actions = (step && step.actions) || [];
      if (!Array.isArray(actions) || actions.length === 0) {
        problems.push(`step ${sid}: no actions`);
        continue;
      }
      if (!actions.some((a) => a && a.type === 'narrate')) problems.push(`step ${sid}: no narrate`);
      if (!_isStr(step.caption)) problems.push(`step ${sid}: no caption`);
      else if (step.caption.length > CAPTION_MAX) problems.push(`step ${sid}: caption longer than ${CAPTION_MAX} characters`);
      if (!MASCOT_POSES.includes(step.mascot)) problems.push(`step ${sid}: mascot outside MASCOT_POSES ("${step.mascot}")`);
      // The pill shows a pose for a whole step: one whose figure hides (none of
      // Pip's poses do today) would read as an empty frame there.
      else if (MASCOT_HIDDEN_POSES.includes(step.mascot)) problems.push(`step ${sid}: pose "${step.mascot}" hides Pip - not usable for a step caption`);
      if (step.camera !== undefined) problems.push(..._checkCamera(step.camera, `step ${sid}.camera`));
      actions.forEach((a, i) => problems.push(..._checkAction(a, `${sid}[${i}]`, ctx)));
    }
  }
  return problems;
}

/**
 * A track resolved against a scenario: the chapters it plays, in order, each
 * with the FULL-scenario indexes of its steps. `def` null = every step.
 * Unknown chapter or step ids are skipped quietly (validateTracks reports them),
 * so is a chapter left with no step.
 * @param {null|Array<{chapter: string, steps: string[]}>} def
 * @param {{ chapters: Array<object> }} scenario
 * @returns {Array<{ ci: number, id: string, steps: number[] }>}
 */
export function resolveTrack(def, scenario) {
  const chapters = (scenario && scenario.chapters) || [];
  if (def === null || def === undefined) {
    return chapters.map((ch, ci) => ({ ci, id: ch.id, steps: ch.steps.map((_s, si) => si) }));
  }
  const out = [];
  for (const entry of Array.isArray(def) ? def : []) {
    const ci = chapters.findIndex((c) => entry && c.id === entry.chapter);
    if (ci < 0 || out.some((o) => o.ci === ci)) continue;
    const ids = chapters[ci].steps.map((s) => s.id);
    const steps = [...new Set(((entry && entry.steps) || []).map((id) => ids.indexOf(id)).filter((si) => si >= 0))]
      .sort((a, b) => a - b);
    if (steps.length) out.push({ ci, id: chapters[ci].id, steps });
  }
  out.sort((a, b) => a.ci - b.ci);
  return out;
}

/**
 * Every problem with the track definitions, as English sentences (empty = valid):
 * unknown chapter or step id, a step named under the wrong chapter, chapters
 * out of CHAPTER_ORDER, steps out of the chapter's own order, duplicates, an
 * empty chapter entry. Deliberately NOT part of validateScenario: a renamed step
 * fails the track test, never the scenario test.
 * @param {Record<string, null|Array<{chapter: string, steps: string[]}>>} tracks
 * @param {{ chapters: Array<object> }} scenario
 * @returns {string[]}
 */
export function validateTracks(tracks, scenario) {
  const problems = [];
  if (!_isObj(tracks)) return ['tracks: expected an object { id: definition }'];
  const chapters = (scenario && scenario.chapters) || [];
  const stepChapter = new Map();
  chapters.forEach((ch) => (ch.steps || []).forEach((s) => stepChapter.set(s && s.id, ch.id)));
  for (const [tid, def] of Object.entries(tracks)) {
    if (!KEBAB.test(tid)) problems.push(`track "${tid}": id must be ASCII kebab-case`);
    if (def === null) continue;
    if (!Array.isArray(def) || def.length === 0) { problems.push(`track ${tid}: the definition must be null or a non-empty list of chapters`); continue; }
    const seenCh = new Set();
    const seenSteps = new Set();
    let lastOrder = -1;
    def.forEach((entry, i) => {
      const where = `track ${tid}[${i}]`;
      if (!_isObj(entry) || !_isStr(entry.chapter)) { problems.push(`${where}: an entry needs { chapter, steps }`); return; }
      const cid = entry.chapter;
      const ch = chapters.find((c) => c.id === cid);
      const order = CHAPTER_ORDER.indexOf(cid);
      if (!ch || order < 0) { problems.push(`${where}: unknown chapter "${cid}"`); return; }
      if (seenCh.has(cid)) problems.push(`${where}: chapter "${cid}" repeated`);
      seenCh.add(cid);
      if (order <= lastOrder) problems.push(`${where}: chapter "${cid}" out of CHAPTER_ORDER order`);
      lastOrder = Math.max(lastOrder, order);
      if (!Array.isArray(entry.steps) || entry.steps.length === 0) { problems.push(`${where}: chapter "${cid}" without steps`); return; }
      const ids = ch.steps.map((s) => s.id);
      let lastStep = -1;
      for (const sid of entry.steps) {
        if (seenSteps.has(sid)) { problems.push(`${where}: step "${sid}" repeated`); continue; }
        seenSteps.add(sid);
        const si = ids.indexOf(sid);
        if (si < 0) {
          const other = stepChapter.get(sid);
          problems.push(other
            ? `${where}: step "${sid}" belongs to chapter "${other}", not "${cid}"`
            : `${where}: unknown step "${sid}" in chapter "${cid}"`);
          continue;
        }
        if (si <= lastStep) problems.push(`${where}: step "${sid}" out of the step order of chapter "${cid}"`);
        lastStep = Math.max(lastStep, si);
      }
    });
  }
  return problems;
}

/**
 * Parse the demo hash; anything unknown falls back to the track's first step.
 *   `#<chapter>/<step>`          the default track (full: every step), step = index in the chapter
 *   `#<track>:<chapter>/<n>`     another track; n counts WITHIN that track's steps of the chapter
 *   `#<track>`                   the track's first step
 * The result always names FULL-scenario indexes (what the engine renders).
 * @param {string} hash
 * @param {{ chapters: Array<object> }} scenario
 * @param {Record<string, null|Array<object>>} [tracks] omitted = only the full track
 * @param {string} [defaultTrack]
 * @returns {{ chapter: number, step: number, valid: boolean, track: string }}
 */
export function parseDemoHash(hash, scenario, tracks, defaultTrack = 'full') {
  const all = tracks || { [defaultTrack]: null };
  let raw = String(hash || '').replace(/^#/, '');
  let track = defaultTrack;
  const pre = /^([a-z0-9-]+):(.*)$/.exec(raw);
  if (pre && Object.prototype.hasOwnProperty.call(all, pre[1])) { track = pre[1]; raw = pre[2]; }
  else if (Object.prototype.hasOwnProperty.call(all, raw) && raw !== '') { track = raw; raw = ''; }
  const plan = resolveTrack(all[track], scenario);
  const first = plan.length ? { chapter: plan[0].ci, step: plan[0].steps[0] } : { chapter: 0, step: 0 };
  const m = /^([a-z0-9-]+)\/(\d+)$/.exec(raw);
  if (!m) return { ...first, valid: false, track };
  const entry = plan.find((p) => scenario.chapters[p.ci].id === m[1]);
  const n = parseInt(m[2], 10);
  if (!entry || !(n >= 0 && n < entry.steps.length)) return { ...first, valid: false, track };
  return { chapter: entry.ci, step: entry.steps[n], valid: true, track };
}

/**
 * The hash of a position: full-scenario indexes in, track form out.
 * @param {string} track
 * @param {string} chapterId
 * @param {number} n index WITHIN the track's steps of that chapter
 * @param {string} [defaultTrack]
 */
export function demoHash(track, chapterId, n, defaultTrack = 'full') {
  return '#' + (track === defaultTrack ? '' : track + ':') + chapterId + '/' + n;
}
