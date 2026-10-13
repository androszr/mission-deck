// ── Mission Deck — js/academy.js ──────────────────────────────
// "Academy" - a progressive training path that ends with your own plug &
// play module built from scratch. A CORE view (not a module): the
// #view-academy section and a VIEW_REGISTRY entry, but ZERO HUB_FLYOUT
// entry - it is one view, not a hub (see js/view-registry.js).
//
// The stage/step configuration lives in js/academy-stages.mjs (STAGES,
// TC_TABS, GATED_STAGES) - the server reads the same source. This file is
// only the rendering and event-wiring engine.
//
// Endpoints (server.js, section "// -- Academy --"):
//   GET  /api/cocreate/progress    -> {version, unlocks, steps, completed, unlockable, me, storage}
//   POST /api/cocreate/unlock      {etap}
//   POST /api/cocreate/verify-step {etap, step, method} -> {pass, detail}
//   GET  /api/cocreate/modules     -> {entries:[...], catalogAvailable, reason?}
//   GET  /api/cocreate/mural       -> {entries:[...], storage, me}
//   POST /api/cocreate/mural       {content} -> {ok, entry, sync}
//   POST /api/cocreate/open-file   {key} -> {ok, key, path, absPath, uri, detail}
//     Server never launches an editor process. AC7 of the plan required the
//     whole section to spawn EXACTLY one child process (the login probe);
//     that probe is gone (it could not tell a logged-in CLI from stored
//     credentials), so the section now spawns none - stricter than the AC,
//     and the client navigates to the returned vscode:// uri itself.

import { state } from './state.js';
import { showToast } from './toast.js';
import { openDsModal, closeDsModal } from './ds-modal.js';
import { openDocModal } from './doc-modal.js';
import { registerViewCleanup } from './view-lifecycle.js';
import { hasSkeleton } from './skeleton.js';
import { escHtml, initials } from './utils.js';
import { loadTeamDirectory, memberByName, memberAvatarUrl, fullName } from './team-directory.js';
import { renderMarkdown } from './md-render.js';
import { STAGES, TC_TABS } from './academy-stages.mjs';
import { muralAnswers } from './academy-mural.mjs';
import { getInfraNetwork } from './infra-banner.js';
import { onInfraChanged } from './infra-events.js';

// One more sentence under "ds-data is not cloned" when the reason is on
// screen: the strip under the top bar already knows GitLab did not answer,
// and a callout that only says "clone it" sends a person to a clone that
// will fail the same way. Empty when the network reading says nothing.
function _cloneHintHtml() {
  const net = getInfraNetwork();
  if (!net) return '';
  // Two bad readings, two sentences: nothing answered, or GitLab answered and
  // refused us. A clone fails the same way under both, but the fix differs -
  // under a refusal the token may be the real cause, so it is named too.
  if (net.state === 'unreachable') {
    return ' <strong>GitLab is not answering right now - connect to the VPN before you clone.</strong>';
  }
  if (net.state === 'refused') {
    return ' <strong>GitLab refuses connections from this computer - check the VPN and, if it is on, renew your token before you clone.</strong>';
  }
  return '';
}
// GATED_STAGES is not read here: gating itself (unlocked/unlockable) is fully
// server-derived per person in the progress payload (progress.unlocks /
// progress.unlockable) - this view only renders what the server already
// decided. It stays exported from the stages module because server.js and
// tests/test_academy.mjs both need it as the single source of truth.

const VIEW_ID = 'academy';
const TAB_STORAGE_KEY = 'tc-active-tab';

// ── Module-level state ───────────────────────────────────────────────────────

let _stateLoading = false; // _reloadState() has been entered
let _stateLoaded = false;  // _reloadState() has run at least once (pass OR fail)
let _progress = null;      // GET /api/cocreate/progress payload
let _gallery = null;       // GET /api/cocreate/modules payload
let _mural = null;         // GET /api/cocreate/mural payload
let _muralEditing = false; // the compose card is open (kept across re-renders)
let _justUnlocked = null;  // stage id that was just unlocked -> plays the reveal animation once
let _activeTab = null;

// Cleanup bookkeeping - registered once with runActiveViewCleanup via
// registerViewCleanup(), so leaving the view always tears these down even
// though the wiring functions below run again on every re-render.
let _scrollTopHandler = null;
let _confettiTimers = [];
let _notifGuideEscHandler = null;
let _muralEscHandler = null;

function _readStoredTab() {
  try {
    const v = localStorage.getItem(TAB_STORAGE_KEY);
    if (v && TC_TABS.some((t) => t.id === v)) return v;
  } catch { /* localStorage unavailable */ }
  return null;
}

// ── Small helpers ────────────────────────────────────────────────────────────

// Wrap keyboard shortcuts (Cmd/Ctrl/Option/Alt/Shift + key) in kbd chips. Runs
// on ALREADY-escaped text, so a bare "Shift" in prose is left untouched.
// Two shapes on purpose. The tight one ("Cmd+Shift+V") is how a shortcut is
// normally written; the spaced one with the key SPELLED OUT ("Cmd +
// comma") is for the keys that are punctuation, because "Cmd+," reads as
// "press +" - somebody walking the course really did press it.
const _KEY_RE = /(?:Cmd|Ctrl|Option|Alt|Shift)(?: \+ (?:comma|period))|(?:Cmd|Ctrl|Option|Alt|Shift)(?:\+(?:[A-Za-z0-9]+(?:\/[A-Za-z0-9]+)?|[,.`\\/]))+/g;
function _highlightKeys(escapedText) {
  return String(escapedText).replace(_KEY_RE, (m) => `<span class="tc-kbd">${m}</span>`);
}

function _firstName() {
  const me = (_progress && _progress.me) || state.whoami;
  const name = (me && (me.display_name || me.gitlab_username)) || '';
  if (!name) return '';
  // js/team-directory.js is the ONE resolver that knows the surname-first order
  // ("Morgan Alex" is a surname followed by a given name, not the reverse),
  // so a greeting must go through it rather than take the first token blind.
  // A fresh clone has no team/ folder and memberByName returns null - only then
  // does the first token stand in, because nothing better exists.
  const member = memberByName(name);
  if (member && member.first_name) return member.first_name;
  return name.trim().split(/\s+/)[0];
}

const _BADGE_COLOR = { green: 'green', red: 'red', yellow: 'yellow', gray: 'gray', neutral: 'gray', blue: 'blue' };
function _badgeHtml(text, color) {
  const cls = _BADGE_COLOR[color] || 'gray';
  return `<span class="ds-badge ds-badge--${cls}">${escHtml(text)}</span>`;
}

// Publication state of the LAST progress write. Every verified step publishes
// this person's own progress file on its own - the sync panel is not part of
// the loop any more - so the person has to be able to see whether it left the
// machine, and why not when it did not.
const _SYNC_LABEL = {
  'ok': 'Progress sent to the team.',
  'no-token': 'Saved locally - no token with write access, so send it by hand in the sync panel.',
  'no-key': 'Saved locally - no encryption key, so nothing was sent.',
  'repo-missing': 'Saved locally - the data repository is not cloned.',
  'locked': 'Saved locally - another sync is running, it will be sent with your next step.',
};

function _syncNote(sync) {
  if (!sync || sync.state === 'skipped' && sync.reason === 'test-mode') return '';
  if (sync.state === 'ok') return _SYNC_LABEL.ok;
  const known = _SYNC_LABEL[sync.reason];
  if (known) return known;
  return 'Saved locally - sending failed, it will be retried with your next step.';
}

function _syncNoteHtml(sync) {
  const text = _syncNote(sync);
  if (!text) return '';
  const cls = sync && sync.state === 'ok' ? 'tc-sync-note--ok' : 'tc-sync-note--warn';
  return `<span class="tc-sync-note ${cls}">${escHtml(text)}</span>`;
}

// Friendly, personalized PASS/FAIL callout. `detail` is the server message.
function _resultCallout(ok, detail, sync) {
  const fn = _firstName();
  const lead = ok
    ? (fn ? `Well done, ${escHtml(fn)}!` : 'Well done!')
    : (fn ? `Not quite yet, ${escHtml(fn)}` : 'Not quite yet');
  const icon = ok
    ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'
    : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>';
  return `
    <div class="tc-result-callout ${ok ? 'tc-result--pass' : 'tc-result--fail'}">
      <span class="tc-result-icon">${icon}</span>
      <div class="tc-result-body">
        <span class="tc-result-lead">${lead}</span>
        <span class="tc-result-detail">${escHtml(detail || '')}</span>
        ${_syncNoteHtml(sync)}
      </div>
    </div>`;
}

// ── Profile photos ───────────────────────────────────────────────────────────
// ONE order for every face in this view, the same one the top bar uses: the
// team photo from ds-data first, then whatever the server or GitLab handed us,
// then the initials. The name is resolved by js/team-directory.js and nothing
// else - it is the resolver that knows the surname-first order ("Morgan
// Alex"), the contract-code prefixes ("BS Casey Novak"), the parenthesised
// suffixes and the diacritics. A second matcher here would drift from it.

/**
 * The name as the team directory spells it ("Alex Morgan"), whatever the
 * source wrote ("BS Morgan Alex", "morgan.alex"). Falls back to the raw
 * string when the directory does not know this person.
 */
function _personLabel(name) {
  const member = name ? memberByName(name) : null;
  return (member && fullName(member)) || String(name || '');
}

/** Best known photo URL for a person, '' when only initials are left. */
function _photoUrlFor(name, fallbackUrl) {
  const member = name ? memberByName(name) : null;
  return memberAvatarUrl(member) || fallbackUrl || '';
}

/**
 * <img> plus its hidden initials twin, so a photo that 404s (a renamed file in
 * the data repo) still leaves a face behind instead of an empty circle.
 */
function _avatarInnerHtml(name, fallbackUrl, fallbackClass) {
  const url = _photoUrlFor(name, fallbackUrl);
  const ini = escHtml(initials(name));
  if (!url) return `<span class="${fallbackClass}">${ini}</span>`;
  return `<img src="${escHtml(url)}" alt="" referrerpolicy="no-referrer"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
       <span class="${fallbackClass}" style="display:none;">${ini}</span>`;
}

// Avatar circles for people who finished a stage (all its steps), padded with
// empty placeholders so the row visibly fills up as more people finish.
function _renderParticipantAvatars(stage, progress) {
  const finishers = (progress && progress.completed && progress.completed[stage.id]) || [];
  const MIN_SLOTS = 16;
  const circles = finishers.map((u) => {
    const raw = u.display_name || u.gitlab_username || '';
    const name = _personLabel(raw);
    const url = _photoUrlFor(raw, u.avatar_url);
    return url
      ? `<span class="tc-pavatar" title="${escHtml(name)}">${_avatarInnerHtml(raw, u.avatar_url, 'tc-pavatar-ini')}</span>`
      : `<span class="tc-pavatar tc-pavatar--initials" title="${escHtml(name)}">${escHtml(initials(name))}</span>`;
  });
  const total = Math.max(circles.length, MIN_SLOTS);
  for (let i = circles.length; i < total; i++) {
    circles.push('<span class="tc-pavatar tc-pavatar--empty" aria-hidden="true"></span>');
  }
  return `<div class="tc-participants-av" title="Participants who finished this stage">${circles.join('')}</div>`;
}

// ── Stage / step progress helpers (read from _progress) ─────────────────────

function _isStageUnlocked(stageId, progress) {
  const unlocks = (progress && progress.unlocks) || {};
  return !!unlocks[stageId];
}
function _stageStepStats(stage, progress) {
  const steps = stage.steps || [];
  const total = steps.length;
  const stepMap = (progress && progress.steps && progress.steps[stage.id]) || {};
  const done = steps.filter((s) => stepMap[s.id]).length;
  return { done, total };
}
function _isStageUnlockable(stageId, progress) {
  const unlockable = (progress && progress.unlockable) || [];
  return unlockable.includes(stageId);
}
function _isStageComplete(stageId, progress) {
  const stage = STAGES.find((s) => s.id === stageId);
  if (!stage) return false;
  if (stage.kind === 'tips') {
    const { done, total } = _stageStepStats(stage, progress);
    return total > 0 && done === total;
  }
  if (!_isStageUnlocked(stageId, progress)) return false;
  const { done, total } = _stageStepStats(stage, progress);
  return total > 0 && done === total;
}
function _isStepPassed(etapId, stepId, progress) {
  const steps = (progress && progress.steps) || {};
  return !!(steps[etapId] || {})[stepId];
}
function _tabStatus(tab, progress) {
  if (tab.gallery || tab.mural) return null;
  const stage = STAGES.find((s) => tab.stageIds && tab.stageIds.includes(s.id));
  if (!stage) return null;
  if (stage.kind === 'tips') return _isStageComplete(stage.id, progress) ? 'done' : 'progress';
  if (_isStageComplete(stage.id, progress)) return 'done';
  if (!_isStageUnlocked(stage.id, progress)) return 'locked';
  return 'progress';
}
// The stage the user is currently "in": first unlocked-but-incomplete stage,
// else the last unlocked stage, else the first stage (still locked).
function _activeStage(progress) {
  let last = null;
  for (const s of STAGES) {
    if (_isStageUnlocked(s.id, progress)) {
      last = s;
      const { done, total } = _stageStepStats(s, progress);
      if (done < total) return s;
    }
  }
  return last || STAGES[0] || null;
}
function _defaultTab(progress) {
  const stage = _activeStage(progress);
  if (!stage) return TC_TABS[0].id;
  const owner = TC_TABS.find((t) => Array.isArray(t.stageIds) && t.stageIds.includes(stage.id));
  return owner ? owner.id : TC_TABS[0].id;
}

// ── VS Code terminal mock (self-contained CSS mock, no Copilot) ─────────────

const _TERM_SCREENS = {
  claude: `
    <div class="tc-cli-banner">
      <div class="tc-cli-bannertext">
        <div class="tc-term-line"><strong class="tc-term-bold">Claude Code</strong></div>
        <div class="tc-term-line tc-term-dim">~/mission-deck</div>
      </div>
    </div>`,
  zsh: `
    <div class="tc-term-line tc-term-dim">Last login: today at 09:14</div>
    <div class="tc-term-line"><span class="tc-term-prompt">~/mission-deck</span> %&nbsp;<span class="tc-term-caret"></span></div>`,
  'claude-auto': `
    <div class="tc-term-line tc-term-rule"></div>
    <div class="tc-term-line"><span class="tc-term-arrow">&rsaquo;</span>&nbsp;<span class="tc-term-caret"></span></div>
    <div class="tc-term-line tc-term-rule"></div>
    <div class="tc-term-line tc-term-auto">&#9656;&#9656; auto mode on <span class="tc-term-dim">(shift+tab to cycle)</span></div>`,
};

function _renderStepVisual(visual) {
  const cfg = (typeof visual === 'string') ? { kind: visual } : (visual || {});
  if (cfg.kind === 'model-picker') return _renderModelPicker();
  if (cfg.kind !== 'vscode-terminal') return '';
  const tabs = (Array.isArray(cfg.tabs) && cfg.tabs.length) ? cfg.tabs : ['claude', 'zsh'];
  const screenKey = (t) => (cfg.mode === 'auto' && _TERM_SCREENS[t + '-auto']) ? t + '-auto' : t;

  const tabBtns = tabs.map((t, i) =>
    `<button class="ds-btn ds-btn--tertiary tc-term-tab${i === 0 ? ' tc-term-tab--active' : ''}" type="button" data-term="${escHtml(t)}">${escHtml(t)}</button>`,
  ).join('');
  const screens = tabs.map((t, i) =>
    `<div class="tc-term-screen" data-term-screen="${escHtml(t)}"${i === 0 ? '' : ' hidden'}>${_TERM_SCREENS[screenKey(t)] || ''}</div>`,
  ).join('');

  return `
    <div class="tc-visual">
      <div class="tc-vscode" role="img" aria-label="VS Code preview with the terminal in the main window">
        <div class="tc-vscode-titlebar">
          <span class="tc-vscode-dot tc-vscode-dot--r"></span>
          <span class="tc-vscode-dot tc-vscode-dot--y"></span>
          <span class="tc-vscode-dot tc-vscode-dot--g"></span>
          <span class="tc-vscode-titletext">mission-deck — Visual Studio Code</span>
        </div>
        <div class="tc-vscode-body">
          <div class="tc-vscode-activitybar">
            <span class="tc-ab-icon"></span><span class="tc-ab-icon"></span>
            <span class="tc-ab-icon"></span><span class="tc-ab-icon"></span>
          </div>
          <div class="tc-vscode-main">
            <div class="tc-term-tabs">
              ${tabBtns}
              <span class="tc-term-tabs-spacer"></span>
              <button class="ds-btn ds-btn--tertiary tc-term-ctl tc-term-ctl--hl" type="button" title="New terminal" aria-label="New terminal">+</button>
            </div>
            ${screens}
          </div>
        </div>
      </div>
      <p class="tc-visual-caption">
        With <code>terminal.integrated.defaultLocation: editor</code> set, the terminal opens
        as a regular tab in the main window. Add a new terminal with the <span class="tc-kbd">+</span> button
        (or <span class="tc-kbd">Ctrl+\`</span>), and split it vertically with: Mac <span class="tc-kbd">Cmd+\\</span>,
        Windows/Linux <span class="tc-kbd">Ctrl+Shift+5</span>.
      </p>
    </div>`;
}

const _MODEL_ROWS = [
  { key: '1', name: 'Haiku 5.5', use: 'Very basic, mechanical tasks', tag: 'fastest / cheapest', tagKind: 'fast' },
  { key: '2', name: 'Sonnet 4.6', use: 'Most work - everyday tasks', tag: 'default / recommended', tagKind: 'default', sel: true },
  { key: '3', name: 'Opus 4.8', use: 'Planning and the hardest tasks', tag: 'strongest reasoning', tagKind: 'opus' },
];
function _renderModelPicker() {
  const rows = _MODEL_ROWS.map((m) => `
            <div class="tc-model-row${m.sel ? ' tc-model-row--sel' : ''}">
              <span class="tc-model-radio" aria-hidden="true"></span>
              <span class="tc-model-key">${escHtml(m.key)}.</span>
              <span class="tc-model-info">
                <span class="tc-model-name">${escHtml(m.name)}</span>
                <span class="tc-model-use">${escHtml(m.use)}</span>
              </span>
              <span class="tc-model-tag tc-model-tag--${escHtml(m.tagKind)}">${escHtml(m.tag)}</span>
            </div>`).join('');
  return `
    <div class="tc-visual tc-visual--models">
      <div class="tc-vscode" role="img" aria-label="Preview of model selection in Claude Code (the /model command)">
        <div class="tc-vscode-titlebar">
          <span class="tc-vscode-dot tc-vscode-dot--r"></span>
          <span class="tc-vscode-dot tc-vscode-dot--y"></span>
          <span class="tc-vscode-dot tc-vscode-dot--g"></span>
          <span class="tc-vscode-titletext">mission-deck — Visual Studio Code</span>
        </div>
        <div class="tc-vscode-body">
          <div class="tc-vscode-activitybar">
            <span class="tc-ab-icon"></span><span class="tc-ab-icon"></span>
            <span class="tc-ab-icon"></span><span class="tc-ab-icon"></span>
          </div>
          <div class="tc-vscode-main">
            <div class="tc-term-tabs">
              <button class="ds-btn ds-btn--tertiary tc-term-tab tc-term-tab--active" type="button">claude</button>
              <span class="tc-term-tabs-spacer"></span>
            </div>
            <div class="tc-model-screen">
              <div class="tc-term-line"><span class="tc-term-prompt">&rsaquo;</span> <span class="tc-term-cmd">/model</span></div>
              <div class="tc-model-box">
                <div class="tc-model-box-title">Select a model for the current session</div>
                <div class="tc-model-rows">${rows}</div>
                <div class="tc-model-box-hint">&#8593;&#8595; navigate &middot; <strong>Enter</strong> select &middot; Esc cancel</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p class="tc-visual-caption">
        Switch models with the <code>/model</code> command or by starting with the <code>--model</code> flag.
        Rule of thumb: <strong>Sonnet</strong> for most work, <strong>Haiku</strong> for very simple things,
        and <strong>Opus</strong> for planning and hard tasks.
      </p>
    </div>`;
}

// ── Step / stage cards ────────────────────────────────────────────────────────

// Closed shapes for the two data-driven buttons on a step. Neither value ever
// reaches the server: the guide is a static file under docs/guides/ and the
// tab is a hash route in this same application.
const DOC_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const TAB_HASH_RE = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9-]+)*$/;

function _renderStepCard(etapId, step, progress, idx) {
  const passed = _isStepPassed(etapId, step.id, progress);
  const isSelfAttest = step.check && step.check.type === 'self-attest';
  const baseLabel = step.btnLabel || (isSelfAttest ? 'Got it / Done' : 'Check');
  const btnLabel = passed ? 'Check again' : baseLabel;
  const passedBadge = passed ? _badgeHtml('OK', 'green') : '';
  const resultSlotId = `tc-result-${escHtml(etapId)}-${escHtml(step.id)}`;

  // openVscode: an array of { key, label } - key is a closed server-side lookup,
  // never a path (see js/academy-stages.mjs / server "// -- Academy --").
  const vscodeBtns = Array.isArray(step.openVscode) ? step.openVscode.map((ov) => `
        <button class="ds-btn ds-btn--tertiary ds-btn--sm tc-open-vscode-btn" data-key="${escHtml(ov.key)}">${escHtml(ov.label || 'Open in VS Code')}</button>`).join('') : '';

  // guideDoc: a markdown guide from docs/guides/ opened in the shared doc
  // modal (js/doc-modal.js). `doc` is a SLUG, never a path - the URL is built
  // here, in one place, and the slug is checked against DOC_SLUG_RE below.
  const guideBtn = step.guideDoc && DOC_SLUG_RE.test(step.guideDoc.doc || '') ? `
        <button class="ds-btn ds-btn--tertiary ds-btn--sm tc-guide-doc-btn"
          data-doc="${escHtml(step.guideDoc.doc)}"
          data-doc-title="${escHtml(step.guideDoc.title || 'Guide')}"
          type="button">${escHtml(step.guideDoc.label || 'Open the guide')}</button>` : '';

  // openTab: an in-app route opened in a NEW browser tab, so the person keeps
  // this course open. `hash` is a route id, never a full URL.
  const openTabBtn = step.openTab && TAB_HASH_RE.test(step.openTab.hash || '') ? `
        <button class="ds-btn ds-btn--tertiary ds-btn--sm tc-open-tab-btn"
          data-hash="${escHtml(step.openTab.hash)}"
          type="button">${escHtml(step.openTab.label || 'Open in a new tab')}</button>` : '';

  const copyBlocks = Array.isArray(step.copyBlocks) ? step.copyBlocks : (step.copyBlock ? [step.copyBlock] : []);
  const promptBox = copyBlocks.map((cb) => `
      <div class="tc-prompt-box">
        <div class="tc-prompt-head">
          <span class="tc-prompt-label">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
            ${escHtml(cb.headLabel || 'To copy')}
          </span>
          <button class="ds-btn ds-btn--secondary ds-btn--sm tc-copy-btn"
            data-copy="${escHtml(cb.text)}"
            data-toast-title="${escHtml(cb.toastTitle || 'Copied')}"
            data-toast-body="${escHtml(cb.toastBody || '')}">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            ${escHtml(cb.label || 'Copy')}
          </button>
        </div>
        <pre class="tc-prompt-text">${escHtml(cb.text)}</pre>
      </div>`).join('');

  const tipBox = step.tip ? `
      <div class="tc-step-tip">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5"/></svg>
        <span>${_highlightKeys(escHtml(step.tip))}</span>
      </div>` : '';

  return `
    <div class="tc-step${passed ? ' tc-step--passed' : ''}" data-etap="${escHtml(etapId)}" data-step="${escHtml(step.id)}" style="--tc-step-i:${idx}">
      <div class="tc-step-header">
        <span class="tc-step-num${passed ? ' tc-step-num--done' : ''}">${passed ? '&#10003;' : (idx + 1)}</span>
        <span class="tc-step-title">${escHtml(step.title)}</span>
        ${passedBadge}
      </div>
      <p class="tc-step-instruction">${_highlightKeys(escHtml(step.instruction))}</p>
      ${Array.isArray(step.bullets) && step.bullets.length ? `
      <ul class="tc-step-bullets">
        ${step.bullets.map((b) => {
    const h = _highlightKeys(escHtml(b));
    const dash = h.indexOf(' — ');
    return dash > 0 ? `<li><strong>${h.slice(0, dash)}</strong>${h.slice(dash)}</li>` : `<li>${h}</li>`;
  }).join('')}
      </ul>` : ''}
      ${(step.visual && (passed || step.visualAlways)) ? _renderStepVisual(step.visual) : ''}
      ${promptBox}
      ${tipBox}
      <div class="tc-step-actions">
        ${vscodeBtns}
        ${guideBtn}
        ${openTabBtn}
        <button
          class="ds-btn ds-btn--sm tc-verify-btn ${passed ? 'ds-btn--tertiary' : 'ds-btn--secondary'}"
          data-etap="${escHtml(etapId)}"
          data-step="${escHtml(step.id)}"
          data-method="${isSelfAttest ? 'self-attest' : 'server'}"
        >${escHtml(btnLabel)}</button>
      </div>
      <div class="tc-step-result" id="${resultSlotId}" aria-live="polite"></div>
    </div>`;
}

// ── Stage 4 "Pro tips" (community, outside gating) ───────────────────────────

// Guide body is static, hand-authored markup (headings, code, links) - never
// injected from a fetch response, so it is intentionally NOT escaped here.
const _NOTIF_GUIDE_HTML = `
  <p class="tc-notif-lead">Set up a sound notification that plays every time Claude Code needs your decision or finishes its work.</p>
  <div class="tc-notif-guide">
    <nav class="ds-tabs-list ds-framed-tabs" role="tablist">
      <button type="button" class="ds-tab active" role="tab" aria-selected="true" data-notif-tab="beginner">Beginner</button>
      <button type="button" class="ds-tab" role="tab" aria-selected="false" data-notif-tab="advanced">Advanced</button>
    </nav>
    <div class="ds-tab-panel tc-notif-tabpanel" data-notif-panel="beginner">
      <h3 class="tc-notif-h">Why bother?</h3>
      <div class="ds-callout ds-callout--info">
        <div>Claude Code stops when it needs your approval - but it does so without any sound. The Notification hook solves that.</div>
      </div>
      <h3 class="tc-notif-h">What to tell Claude</h3>
      <div class="tc-prompt-box">
        <div class="tc-prompt-head"><span class="tc-prompt-label">Prompt</span></div>
        <pre class="tc-prompt-text">Set up a sound notification for me - I want to hear a sound every time you are waiting for my answer or decision. Use the Notification hook in ~/.claude/settings.json. Pick the command for my system (macOS: afplay, Windows: powershell beep). Then verify that the hook works.</pre>
      </div>
      <h3 class="tc-notif-h">How to verify</h3>
      <div class="tc-notif-steps">
        <div class="tc-notif-step"><span class="tc-step-num tc-step-num--done">1</span><span>Type the <code>/hooks</code> command - the list should show an entry in the Notification section.</span></div>
        <div class="tc-notif-step"><span class="tc-step-num tc-step-num--done">2</span><span>Ask the agent for anything that needs your approval - you should hear the sound.</span></div>
        <div class="tc-notif-step"><span class="tc-step-num tc-step-num--done">3</span><span>Silence? Check the system volume and run the command by hand in the terminal.</span></div>
      </div>
    </div>
    <div class="ds-tab-panel tc-notif-tabpanel" data-notif-panel="advanced" hidden>
      <h3 class="tc-notif-h">1. Open the settings file</h3>
      <p class="tc-notif-p">macOS / Linux: <code>~/.claude/settings.json</code>. Windows: <code>%USERPROFILE%\\.claude\\settings.json</code>.</p>
      <h3 class="tc-notif-h">2. Add the hooks.Notification block (macOS)</h3>
      <div class="tc-vscode tc-notif-term">
        <div class="tc-vscode-body"><div class="tc-term-screen">
          <div class="tc-term-line tc-term-dim">{</div>
          <div class="tc-term-line">&nbsp;&nbsp;"hooks": { "Notification": [</div>
          <div class="tc-term-line">&nbsp;&nbsp;&nbsp;&nbsp;{ "matcher": "", "hooks": [{ "type": "command", "command": "afplay /System/Library/Sounds/Glass.aiff" }] }</div>
          <div class="tc-term-line">&nbsp;&nbsp;] }</div>
          <div class="tc-term-line tc-term-dim">}</div>
        </div></div>
      </div>
      <h3 class="tc-notif-h">3. Matcher variants</h3>
      <ul class="tc-notif-list">
        <li><code>""</code> - all notifications.</li>
        <li><code>"permission_prompt"</code> - permission requests only.</li>
        <li><code>"idle_prompt"</code> - end of work only.</li>
      </ul>
      <div class="ds-callout ds-callout--warning">
        <div>Zero setup: the <code>printf '\\a'</code> command plays the terminal bell without editing settings.json - it only works in this session.</div>
      </div>
    </div>
  </div>`;

function _renderTipStep(etapId, step, idx, progress) {
  const done = _isStepPassed(etapId, step.id, progress);
  const author = step.author || {};
  const authorName = author.name || '';
  const num = done ? '&#10003;' : String(idx + 1);
  const authorAvatarInner = _avatarInnerHtml(authorName, '', 'tc-step-author-av-fallback');
  const authorBadge = authorName ? `
        <span class="tc-step-author">
          <span class="tc-step-author-av">${authorAvatarInner}</span>
          <span class="tc-step-author-name">${escHtml(_personLabel(authorName))}</span>
        </span>` : '';
  const guideBtn = step.guideModal ? `
        <button class="ds-btn ds-btn--tertiary ds-btn--sm tc-notif-guide-btn" type="button">Show guide</button>` : '';

  return `
    <div class="tc-step${done ? ' tc-step--passed' : ''}" data-etap="${escHtml(etapId)}" data-step="${escHtml(step.id)}" style="--tc-step-i:${idx}">
      <div class="tc-step-header">
        <span class="tc-step-num${done ? ' tc-step-num--done' : ''}">${num}</span>
        <span class="tc-step-title">${escHtml(step.title)}</span>
      </div>
      <p class="tc-step-instruction">${step.instruction}</p>
      <div class="tc-step-actions">
        ${guideBtn}
        ${done ? '' : `<button class="ds-btn ds-btn--sm tc-tip-attest-btn ds-btn--secondary" data-etap="${escHtml(etapId)}" data-step="${escHtml(step.id)}" type="button">${escHtml(step.btnLabel || 'Got it / Done')}</button>`}
      </div>
      ${authorBadge}
    </div>`;
}

function _renderTipsCard(stage, progress) {
  const stepsHtml = (stage.steps || []).map((s, i) => _renderTipStep(stage.id, s, i, progress)).join('');
  const { done, total } = _stageStepStats(stage, progress);
  const allDone = total > 0 && done === total;
  const doneBanner = allDone ? `
        <div class="ds-callout ds-callout--success tc-tips-done-banner">
          <div>&#10003; Great! All pro tips are checked off.</div>
        </div>` : '';
  return `
    <div class="ds-card tc-stage tc-tips-card${allDone ? ' tc-stage--complete' : ''}" id="tc-stage-${escHtml(stage.id)}">
      <div class="ds-card-header">
        <span class="tc-stage-titlewrap">
          <span class="tc-stage-eyebrow tc-tips-eyebrow">Stage 4</span>
          <span class="ds-card-title">${escHtml(stage.title)}</span>
        </span>
        ${allDone ? _badgeHtml('complete', 'green') : _badgeHtml('not scored - from the community', 'yellow')}
      </div>
      <div class="ds-card-body">
        <p class="tc-stage-intro">${escHtml(stage.intro)}</p>
        ${stepsHtml}
        ${doneBanner}
      </div>
      <div id="tc-notif-modal-overlay" class="ds-modal-overlay tc-notif-modal-overlay" hidden>
        <div class="ds-modal tc-notif-modal" role="dialog" aria-modal="true" aria-label="Notification hook - guide">
          <div class="ds-modal-header tc-notif-modal-header">
            <span class="ds-modal-title">Notification hook - guide</span>
            <button id="tc-notif-modal-close" class="ds-icon-btn ds-icon-btn--sm" type="button" aria-label="Close">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div class="ds-modal-body tc-notif-modal-body">${_NOTIF_GUIDE_HTML}</div>
        </div>
      </div>
    </div>`;
}

function _renderStageCard(stage, progress) {
  if (stage.kind === 'tips') return _renderTipsCard(stage, progress);

  const unlocked = _isStageUnlocked(stage.id, progress);
  const unlockable = _isStageUnlockable(stage.id, progress);

  let badgeHtml;
  let statusClass;
  if (unlocked) {
    badgeHtml = _badgeHtml('unlocked', 'green');
    statusClass = 'tc-stage--unlocked' + (stage.id === _justUnlocked ? ' tc-stage--just-unlocked' : '');
  } else {
    badgeHtml = _badgeHtml('locked', 'red');
    statusClass = 'tc-stage--locked';
  }

  const isFirstStage = STAGES.length > 0 && STAGES[0].id === stage.id;
  const unlockSection = !unlocked && unlockable ? `
    <div class="tc-unlock-section">
      <p class="tc-unlock-desc">${isFirstStage ? 'This is the first stage - you can start right away.' : 'Unlock this stage - you have finished the previous one.'} Your progress is saved on the server and visible to the whole team.</p>
      <div class="tc-unlock-actions">
        <button class="ds-btn ds-btn--primary ds-btn--sm tc-unlock-btn" data-etap="${escHtml(stage.id)}">Unlock</button>
      </div>
      <div class="tc-unlock-result" id="tc-unlock-result-${escHtml(stage.id)}" aria-live="polite"></div>
    </div>` : '';

  const lockedNote = !unlocked && !unlockable ? `
    <div class="ds-callout ds-callout--neutral tc-locked-note">
      <div>Unlock the previous stage to make this one available.</div>
    </div>` : '';

  const stepsHtml = unlocked ? (stage.steps || []).map((s, i) => _renderStepCard(stage.id, s, progress, i)).join('') : '';

  const stats = _stageStepStats(stage, progress);
  const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;
  const counterHtml = (unlocked && stats.total) ? `
        <span class="tc-stage-counter${stats.done === stats.total ? ' tc-stage-counter--complete' : ''}">${stats.done} / ${stats.total} done</span>` : '';
  const stageBarHtml = (unlocked && stats.total) ? `
        <div class="tc-stage-bar"><span class="tc-stage-bar-fill" style="width:${pct}%"></span></div>` : '';

  const etapNum = (stage.id.match(/etap-(\d+)/) || [])[1] || '';
  const eyebrow = etapNum ? `<span class="tc-stage-eyebrow">Stage ${etapNum}</span>` : '';

  return `
    <div class="ds-card tc-stage ${statusClass}" id="tc-stage-${escHtml(stage.id)}">
      <div class="ds-card-header">
        <span class="tc-stage-titlewrap">${eyebrow}<span class="ds-card-title">${escHtml(stage.title)}</span></span>
        ${counterHtml}
        ${badgeHtml}
      </div>
      ${stageBarHtml}
      <div class="ds-card-body">
        <p class="tc-stage-intro">${escHtml(stage.intro)}</p>
        ${lockedNote}
        ${unlockSection}
        ${stepsHtml}
        ${(unlocked && stats.total && stats.done === stats.total) ? `
        <div class="tc-participants-row tc-participants-row--done">
          <span class="tc-participants-label">&#10003; Finished this stage:</span>
          ${_renderParticipantAvatars(stage, progress)}
        </div>` : ''}
      </div>
    </div>`;
}

// ── Step 0 — one-off environment setup (informational) ──────────────────────

function _renderKrok0() {
  const items = [
    {
      icon: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M15 9h3"/><path d="M15 13h3"/><path d="M6 16h6"/>',
      title: 'Claude license',
      desc: 'The course walks you through Claude Code in the terminal, so you need an active Claude license on your work account. If you have a GitHub Copilot license you can install the Copilot CLI alongside it - the course steps, however, describe Claude Code.',
    },
    {
      icon: '<path d="M4 7h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4z"/><path d="M10 7v12" stroke-dasharray="2 2"/>',
      title: 'Installation (via IT if needed)',
      desc: 'On a managed work computer, IT may have to install Node.js and Claude Code - ask for both programs well before you sit down to Stage 1.',
    },
    {
      icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
      title: 'VPN',
      desc: 'If your team repositories sit on a GitLab reachable only over a VPN, connect to the VPN before Mission Deck fetches data or checks for an update.',
    },
    {
      icon: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
      title: 'Access keys',
      desc: 'Go to <a href="#settings/keys" class="tc-inline-link">Settings &gt; Keys</a> and unlock the Bitwarden vault - Mission Deck fetches the other tokens from there by itself.',
    },
    {
      icon: '<path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>',
      title: 'App update',
      desc: 'Check the top of the screen for a new version, and in <a href="#settings/system" class="tc-inline-link">Settings</a> click Restart server to run it.',
    },
    {
      icon: '<rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/>',
      title: 'Terminal built into Mission Deck',
      desc: 'The terminal icon in the top bar opens a working terminal without leaving the browser - you will need it in later steps.',
    },
    {
      icon: '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
      title: 'Jira and Confluence - PAT token',
      desc: 'The Atlassian API and MCP work only with a personal access token (PAT). Create one following your organisation\'s API usage policy, then add it to your Bitwarden collection.',
    },
  ];
  const rows = items.map((it) => `
        <div class="tc-krok0-item">
          <span class="tc-krok0-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${it.icon}</svg>
          </span>
          <div class="tc-krok0-text">
            <h4 class="tc-krok0-title">${escHtml(it.title)}</h4>
            <p class="tc-krok0-desc">${it.desc}</p>
          </div>
        </div>`).join('');
  return `
    <div class="ds-card tc-krok0">
      <div class="ds-card-header tc-stage-head">
        <span class="tc-step-num tc-step-num--info">0</span>
        <span class="ds-card-title">Before you start - environment setup</span>
        <span class="tc-stage-head-spacer"></span>
        <span class="ds-badge ds-badge--gray">informational</span>
      </div>
      <div class="ds-card-body">
        <p class="tc-krok0-lead">You set these up once, before you start the stages. Mission Deck already configured? Go straight to Stage 1.</p>
        <div class="tc-krok0-grid">${rows}</div>
      </div>
    </div>`;
}

// ── Module gallery ───────────────────────────────────────────────────────────

function _galleryAuthorRow(entry) {
  const name = entry.author || '';
  const avatarInner = _avatarInnerHtml(name, entry.avatar_url, 'tc-gallery-author-fallback');
  return `
      <div class="tc-gallery-author">
        <span class="tc-gallery-author-av">${avatarInner}</span>
        <span class="tc-gallery-author-name">${escHtml(_personLabel(name) || 'Unknown author')}</span>
      </div>`;
}

function _renderGalleryCard(entry) {
  const statusBadge = entry.installed
    ? _badgeHtml('installed', 'green')
    : (entry.inCatalog ? _badgeHtml('in catalog', 'blue') : '');
  return `
    <div class="ds-card tc-gallery-card">
      <div class="ds-card-header">
        <span class="ds-card-title">${escHtml(entry.name || entry.id)}</span>
        ${statusBadge}
      </div>
      <div class="ds-card-body">
        <p class="tc-gallery-desc">${escHtml(entry.description || 'No description.')}</p>
        <div class="tc-gallery-meta">
          <span class="ds-badge ds-badge--gray">v${escHtml(entry.version || '0.0.0')}</span>
        </div>
        ${_galleryAuthorRow(entry)}
        <a href="#settings/modules" class="tc-inline-link">See it in Settings &gt; Modules &rarr;</a>
      </div>
    </div>`;
}

function _renderGalleryTab() {
  const data = _gallery;
  if (!data) return '<p class="tc-gallery-empty">Loading the gallery...</p>';
  const entries = Array.isArray(data.entries) ? data.entries : [];
  const catalogNote = data.catalogAvailable === false ? `
    <div class="ds-callout ds-callout--info">
      <div>The shared catalog is unavailable (${escHtml(data.reason || 'no token')}) - the gallery shows only locally installed modules.</div>
    </div>` : '';
  if (!entries.length) {
    return `${catalogNote}<p class="tc-gallery-empty">Nobody has published a module yet. Finish Stage 3 to be the first.</p>`;
  }
  return `${catalogNote}<div class="tc-gallery-grid">${entries.map(_renderGalleryCard).join('')}</div>`;
}

// ── Mural ─────────────────────────────────────────────────────────────────────
// One entry per person. The file lives in the team data repository
// (ds-data/academy/mural/<person_slug>.md), NOT in the app repository -
// which is why leaving a mark needs no branch, commit or merge request: the
// write is encrypted right away and goes to the team, exactly like the
// progress file.

// A copy of the server's COCREATE_MURAL_MAX_CHARS - only so the field stops
// accepting characters by itself. The server always decides (400 'too-long').
const MURAL_MAX_CHARS = 8000;
const MURAL_TEMPLATE = [
  '## What I have learned',
  '',
  '- ',
  '',
  '## What I want to build in Mission Deck',
  '',
  '- ',
  '',
  '## Questions and observations',
  '',
  '- ',
].join('\n');

/** This person's own entry, or null. The slug comes from the server payload. */
function _muralMine() {
  const data = _mural;
  const slug = data && data.me && data.me.person_slug;
  if (!slug || !Array.isArray(data.entries)) return null;
  return data.entries.find((e) => e.person_slug === slug) || null;
}

/**
 * One tile. The ANSWERS lead - the questions from the template stay as small
 * print above them - because a tile listing only the questions says nothing
 * about the person. Everything interpolated here goes through escHtml: a mural
 * entry cannot inject markup into this view, on the tiles as in the modal.
 */
function _muralTile(entry, idx) {
  const raw = entry.display_name || entry.person_slug || '';
  const name = _personLabel(raw);
  const member = raw ? memberByName(raw) : null;
  const role = member && member.role ? member.role : '';
  const meta = [role, entry.date || ''].filter(Boolean).join(' · ');
  const answers = muralAnswers(entry.content);
  const body = answers.length
    ? answers.map((a) => `
        <span class="tc-mural-answer">
          ${a.label ? `<span class="tc-mural-answer-q">${escHtml(a.label)}</span>` : ''}
          <span class="tc-mural-answer-a">${escHtml(a.text)}</span>
        </span>`).join('')
    : '<span class="tc-mural-answer-empty">This entry is waiting for its first answer.</span>';
  return `
    <button type="button" class="ds-card tc-mural-tile" data-mural-idx="${idx}"
      aria-label="Read the entry: ${escHtml(name)}">
      <span class="tc-mural-tile-head">
        <span class="tc-mural-photo">${_avatarInnerHtml(raw, entry.avatar_url, 'tc-mural-photo-fallback')}</span>
        <span class="tc-mural-who">
          <span class="tc-mural-author">${escHtml(name)}</span>
          ${meta ? `<span class="tc-mural-meta">${escHtml(meta)}</span>` : ''}
        </span>
      </span>
      <span class="tc-mural-answers">${body}</span>
      <span class="tc-mural-more">Read the whole entry &rarr;</span>
    </button>`;
}

/** The compose card: closed it is a button, open it is a textarea. */
function _muralCompose() {
  const unavailable = _mural && _mural.storage === 'unavailable';
  if (unavailable) {
    return `
      <div class="ds-callout ds-callout--warning tc-mural-compose">
        <div>The team data repository (<code>ds-data</code>) is not cloned, so there is nowhere to save the entry. Clone it in the sync panel in the top bar and come back here.${_cloneHintHtml()}</div>
      </div>`;
  }
  const mine = _muralMine();
  if (!_muralEditing) {
    return `
      <div class="ds-card tc-mural-compose">
        <div class="ds-card-body tc-mural-compose-closed">
          <div class="tc-mural-compose-text">
            <strong>${mine ? 'Your entry is on the Mural.' : 'You do not have an entry yet.'}</strong>
            <span>${mine
    ? 'You can edit it at any time - every save goes straight to the team.'
    : 'Write what you have learned and what you want to build. The entry is saved in the team data repository, with no branch and no merge request.'}</span>
          </div>
          <button type="button" class="ds-btn ds-btn--primary tc-mural-edit-btn">${mine ? 'Edit your entry' : 'Add your entry'}</button>
        </div>
      </div>`;
  }
  const value = mine && mine.content ? mine.content : MURAL_TEMPLATE;
  return `
    <div class="ds-card tc-mural-compose">
      <div class="ds-card-header">
        <span class="ds-card-title">${mine ? 'Edit your entry' : 'Your entry on the Mural'}</span>
      </div>
      <div class="ds-card-body">
        <label class="tc-mural-label" for="tc-mural-input">Markdown - headings, lists and bold all work.</label>
        <textarea id="tc-mural-input" class="ds-input tc-mural-input" rows="18"
          maxlength="${MURAL_MAX_CHARS}" placeholder="Write a few sentences about yourself and what you want to build…">${escHtml(value)}</textarea>
        <div class="tc-mural-compose-actions">
          <button type="button" class="ds-btn ds-btn--primary tc-mural-save-btn">Save entry</button>
          <button type="button" class="ds-btn ds-btn--secondary tc-mural-cancel-btn">Cancel</button>
          ${mine ? '<button type="button" class="ds-btn ds-btn--tertiary tc-mural-delete-btn">Delete my entry</button>' : ''}
        </div>
      </div>
    </div>`;
}

function _renderMuralTab() {
  if (!_mural) return '<p class="tc-mural-empty">Loading the Mural...</p>';
  const entries = Array.isArray(_mural.entries) ? _mural.entries : [];
  const count = entries.length;
  const countLabel = count === 1 ? 'entry' : 'entries';
  const tiles = entries.map(_muralTile).join('');
  const grid = count
    ? `<div class="tc-mural-grid">${tiles}</div>`
    : '<p class="tc-mural-empty">The Mural is still empty - be the first.</p>';
  return `
    <div class="tc-mural-section">
      <div class="tc-mural-head">
        <h3 class="tc-mural-title">Participants' Mural</h3>
        ${count ? `<span class="ds-badge ds-badge--gray">${count} ${countLabel}</span>` : ''}
      </div>
      <p class="tc-mural-sub">Marks left by people walking this path. Entries live in the team data repository, so you see them right after a sync - with no branch and no merge request.</p>
      ${_muralCompose()}
      ${grid}
    </div>
    <div id="tc-mural-modal-overlay" class="ds-modal-overlay tc-mural-modal-overlay" hidden>
      <div class="ds-modal tc-mural-modal" role="dialog" aria-modal="true" aria-labelledby="tc-mural-modal-title">
        <div class="ds-modal-header">
          <span class="tc-mural-modal-avatar" id="tc-mural-modal-avatar"></span>
          <span class="ds-modal-title" id="tc-mural-modal-title"></span>
          <button id="tc-mural-modal-close" class="ds-icon-btn ds-icon-btn--sm" type="button" aria-label="Close">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="ds-modal-body tc-mural-modal-body" id="tc-mural-modal-body"></div>
      </div>
    </div>`;
}

// ── Welcome hero ──────────────────────────────────────────────────────────────

function _renderStorageCallout() {
  if (!_progress || _progress.storage !== 'unavailable') return '';
  return `
    <div class="ds-callout ds-callout--warning tc-storage-callout">
      <div>The team data repository (<code>ds-data</code>) is not cloned on this computer, so progress cannot be saved. Clone it from the sync panel in the top bar and come back here.${_cloneHintHtml()}</div>
    </div>`;
}

function _renderWelcomeHero() {
  const me = (_progress && _progress.me) || state.whoami;
  const rawName = (me && me.valid !== false && (me.display_name || me.gitlab_username)) || '';
  // The identity carries the git-config order ("Morgan Alex" = surname first),
  // so both the greeting and the initials go through the team directory; without
  // it the hero would welcome a person by their surname and stamp "AR" for "RA".
  const member = rawName ? memberByName(rawName) : null;
  const name = member ? `${member.first_name} ${member.last_name}`.trim() : rawName;
  const hi = _firstName();
  const greeting = hi ? `Welcome, ${escHtml(hi)}!` : 'Welcome, builder!';
  const sub = 'Unlock the stages one by one, verify each step and build your own module.';

  // The photo goes through the same order as every other face here - the team
  // photo from ds-data first, the GitLab avatar only when the directory has no
  // picture of this person (a fresh clone, or somebody hired last week).
  const photoUrl = _photoUrlFor(rawName, me && me.avatar_url);
  let avatarHtml;
  if (photoUrl) {
    avatarHtml = `<img class="tc-hero-avatar-img" src="${escHtml(photoUrl)}" alt="" referrerpolicy="no-referrer"
      onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
      <span class="tc-hero-avatar-fallback" style="display:none;">${escHtml(initials(name))}</span>`;
  } else if (name) {
    avatarHtml = `<span class="tc-hero-avatar-fallback">${escHtml(initials(name))}</span>`;
  } else {
    avatarHtml = '<span class="tc-hero-avatar-fallback tc-hero-avatar-fallback--anon">CC</span>';
  }

  const finishers = `
      <div class="tc-hero-finishers-wrap">
        ${STAGES.map((st, i) => `
        <div class="tc-hero-finishers">
          <span class="tc-hero-finishers-label">Finished Stage ${i + 1}${st.kind === 'tips' ? ' (pro tips)' : ''}</span>
          ${_renderParticipantAvatars(st, _progress)}
        </div>`).join('')}
      </div>`;

  return `
    <div class="tc-hero">
      <div class="tc-hero-top">
        <div class="tc-hero-avatar">${avatarHtml}</div>
        <div class="tc-hero-text">
          <div class="tc-hero-greeting">${greeting}</div>
          <div class="tc-hero-sub">${sub}</div>
        </div>
        ${finishers}
      </div>
      <div class="tc-hero-howto">
        <strong>How does the training path work?</strong>
        Unlock a stage with one click once you finish the previous one. Click "Check" on every step -
        your progress is saved together with the team and shown on the avatars below.
      </div>
    </div>`;
}

// Lightweight CSS confetti burst over the given element (no external lib).
function _burstConfetti(targetEl) {
  if (!targetEl) return;
  const layer = document.createElement('div');
  layer.className = 'tc-confetti';
  const COLORS = ['var(--brand-accent)', 'var(--ds-yellow-50)', 'var(--ds-red-50)', 'var(--ds-blue-50)', 'var(--ds-violet-40)'];
  const N = 18;
  for (let i = 0; i < N; i++) {
    const piece = document.createElement('span');
    piece.className = 'tc-confetti-piece';
    const angle = (360 / N) * i;
    const dist = 60 + (i % 5) * 16;
    piece.style.setProperty('--tc-dx', Math.round(Math.cos(angle * Math.PI / 180) * dist) + 'px');
    piece.style.setProperty('--tc-dy', Math.round(Math.sin(angle * Math.PI / 180) * dist) + 'px');
    piece.style.setProperty('--tc-rot', (angle * 2) + 'deg');
    piece.style.background = COLORS[i % COLORS.length];
    piece.style.animationDelay = (i % 6) * 18 + 'ms';
    layer.appendChild(piece);
  }
  targetEl.appendChild(layer);
  const timer = setTimeout(() => { layer.remove(); }, 1100);
  _confettiTimers.push(timer);
}

// ── Page-level tab strip ─────────────────────────────────────────────────────

const _TC_TAB_ICONS = {
  locked: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  progress: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  done: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
};
const _TC_TAB_STATUS_CLASS = {
  locked: 'tc-tab-status tc-tab-status--locked',
  progress: 'tc-tab-status tc-tab-status--progress',
  done: 'tc-tab-status tc-tab-status--done',
};

function _renderTabStrip(progress) {
  const activeId = _activeTab || _defaultTab(progress);
  const tabs = TC_TABS.map((tab) => {
    const status = _tabStatus(tab, progress);
    const statusHtml = status ? `<span class="${_TC_TAB_STATUS_CLASS[status]}">${_TC_TAB_ICONS[status]}</span>` : '';
    const active = tab.id === activeId;
    return `
      <button type="button" class="ds-tab${active ? ' active' : ''}" role="tab" aria-selected="${active}" data-tc-tab="${escHtml(tab.id)}">
        ${statusHtml}<span class="tc-tab-label">${escHtml(tab.label)}</span>
      </button>`;
  }).join('');
  return `<nav class="ds-tabs-list ds-framed-tabs tc-tabs" role="tablist">${tabs}</nav>`;
}

function _renderTabPanels(progress) {
  const activeId = _activeTab || _defaultTab(progress);
  const panels = TC_TABS.map((tab) => {
    let content;
    if (tab.gallery) {
      content = _renderGalleryTab();
    } else if (tab.mural) {
      content = _renderMuralTab();
    } else {
      const stagesHtml = (tab.stageIds || [])
        .map((id) => STAGES.find((s) => s.id === id))
        .filter(Boolean)
        .map((s) => _renderStageCard(s, progress))
        .join('');
      content = `${tab.includeKrok0 ? _renderKrok0() : ''}<div class="tc-stages">${stagesHtml}</div>`;
    }
    const hiddenAttr = tab.id === activeId ? '' : ' hidden';
    return `<div class="ds-tab-panel tc-tab-panel" data-tc-panel="${escHtml(tab.id)}"${hiddenAttr}>${content}</div>`;
  });
  return panels.join('');
}

function _activateTab(root, tabId) {
  _activeTab = tabId;
  try { localStorage.setItem(TAB_STORAGE_KEY, tabId); } catch { /* localStorage unavailable */ }
  root.querySelectorAll('.tc-tabs .ds-tab').forEach((btn) => {
    const active = btn.dataset.tcTab === tabId;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  root.querySelectorAll('[data-tc-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.tcPanel !== tabId;
  });
}

function _wireTabs(root) {
  const nav = root.querySelector('.tc-tabs');
  if (!nav) return;
  nav.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-tc-tab]');
    if (!btn) return;
    _activateTab(root, btn.dataset.tcTab);
  });
}

// ── Sticky bottom progress bar ───────────────────────────────────────────────

function _renderProgressBar(progress) {
  const stage = _activeStage(progress);
  if (!stage) return '';
  const unlocked = _isStageUnlocked(stage.id, progress);
  const { done, total } = _stageStepStats(stage, progress);
  const pct = (unlocked && total) ? Math.round((done / total) * 100) : 0;
  const complete = unlocked && total && done === total;
  const fn = _firstName();
  const hi = fn ? `${escHtml(fn)}, ` : '';
  let title;
  if (!unlocked) {
    title = `${hi}unlock this stage to start`;
  } else if (complete) {
    title = `&#127881; ${hi}you finished ${escHtml(stage.title)}!`;
  } else if (done === 0) {
    title = `${hi}time to start: ${escHtml(stage.title)}`;
  } else if (pct >= 50) {
    title = `${hi}already ${pct}% - you are on the home stretch of ${escHtml(stage.title)}`;
  } else {
    title = `${hi}a good start on ${escHtml(stage.title)}`;
  }
  const countText = !unlocked ? 'locked' : (total ? `${done} / ${total} steps &middot; ${pct}%` : 'unlocked');
  return `
    <div class="tc-progressbar${complete ? ' tc-progressbar--complete' : ''}" role="button" tabindex="0" data-goto="${escHtml(stage.id)}" title="Go to the stage" aria-label="Go to the stage">
      <div class="tc-progressbar-inner">
        <div class="tc-progressbar-meta">
          <span class="tc-progressbar-title">${title}</span>
          <span class="tc-progressbar-right">
            <span class="tc-progressbar-count">${countText}</span>
            <svg class="tc-progressbar-arrow" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>
          </span>
        </div>
        <div class="tc-progressbar-track"><span class="tc-progressbar-fill" style="width:${pct}%"></span></div>
      </div>
    </div>`;
}

// ── Main render ───────────────────────────────────────────────────────────────

function _rerenderKeepScroll() {
  const main = document.querySelector('.main');
  const mTop = main ? main.scrollTop : 0;
  const wTop = window.scrollY;
  renderAcademyView();
  if (main) main.scrollTop = mTop;
  window.scrollTo(0, wTop);
}

export function renderAcademyView() {
  const root = document.getElementById('academy-root');
  if (!root) return;

  // js/app.js calls the renderer WITHOUT awaiting runInit, and
  // initAcademy() suspends on the team directory plus three
  // /api/cocreate/* reads - so on a first entry this runs with _progress still
  // null. Painting then would wipe the static skeleton in index.html and put a
  // hollow hero, an empty tab strip and no steps on screen for as long as the
  // reads take. The skeleton is the better answer, so leave it standing; the
  // init awaits its data and calls this again.
  // Keyed on the load, not on _progress: a dead /api/cocreate/progress leaves
  // _progress null for good, and a skeleton that pulses forever is worse than
  // the empty state the renderer paints from a null payload. _stateLoading is
  // the other half - if initAcademy() threw before it ever asked for the
  // data, nothing is coming and the skeleton has to give way here.
  if (_stateLoading && !_stateLoaded && hasSkeleton(root)) return;

  root.innerHTML = `
    ${_renderStorageCallout()}
    ${_renderWelcomeHero()}
    ${_renderTabStrip(_progress)}
    ${_renderTabPanels(_progress)}
    ${_renderProgressBar(_progress)}
    <button class="ds-icon-btn tc-scrolltop" type="button" title="Back to top" aria-label="Scroll to top">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 15l-6-6-6 6"/></svg>
    </button>`;

  _wireButtons(root);
  _wireTabs(root);
  _wireScrollTop(root);
  _wireTipsCard(root);
  _wireMural(root);

  if (_justUnlocked) {
    const justEl = document.getElementById('tc-stage-' + _justUnlocked);
    if (justEl) _burstConfetti(justEl);
    _justUnlocked = null;
  }
}

// Floating "scroll to top" button. The scroll handler is stored module-level
// so re-renders swap it instead of stacking duplicate listeners — cleared for
// good by registerViewCleanup() below.
function _wireScrollTop(root) {
  const btn = root.querySelector('.tc-scrolltop');
  if (!btn) return;
  const main = document.querySelector('.main');
  const topOf = () => Math.max(main ? main.scrollTop : 0, window.scrollY || 0);
  btn.addEventListener('click', () => {
    if (main) main.scrollTo({ top: 0, behavior: 'smooth' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  if (_scrollTopHandler) {
    if (main) main.removeEventListener('scroll', _scrollTopHandler);
    window.removeEventListener('scroll', _scrollTopHandler);
  }
  _scrollTopHandler = () => { btn.classList.toggle('tc-scrolltop--visible', topOf() > 300); };
  if (main) main.addEventListener('scroll', _scrollTopHandler, { passive: true });
  window.addEventListener('scroll', _scrollTopHandler, { passive: true });
  _scrollTopHandler();
}

// ── Button wiring ─────────────────────────────────────────────────────────────

async function _reloadState() {
  _stateLoading = true;
  try {
    const res = await fetch('/api/cocreate/progress?t=' + Date.now(), { cache: 'no-store' });
    if (res.ok) _progress = await res.json();
  } catch { /* keep existing state */ }
  try {
    const res = await fetch('/api/cocreate/modules?t=' + Date.now(), { cache: 'no-store' });
    if (res.ok) _gallery = await res.json();
  } catch { /* keep existing state */ }
  try {
    const res = await fetch('/api/cocreate/mural?t=' + Date.now(), { cache: 'no-store' });
    if (res.ok) _mural = await res.json();
  } catch { /* keep existing state */ }
  // Set whatever the three reads answered: this flag says "the load has been
  // attempted", which is what releases the static skeleton.
  _stateLoaded = true;
}

function _wireButtons(root) {
  root.querySelectorAll('.tc-unlock-btn').forEach((btn) => {
    btn.addEventListener('click', async function onUnlock() {
      const etap = this.dataset.etap;
      const resultEl = document.getElementById(`tc-unlock-result-${etap}`);
      const originalLabel = this.textContent;
      this.disabled = true;
      this.textContent = 'Verifying...';
      if (resultEl) resultEl.innerHTML = '';
      try {
        const res = await fetch('/api/cocreate/unlock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ etap }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          const fn = _firstName();
          showToast('success', 'Stage unlocked!', fn ? `Welcome, ${fn}!` : '');
          _justUnlocked = etap;
          await _reloadState();
          _rerenderKeepScroll();
        } else {
          const msg = (data && data.message) || `HTTP error ${res.status}`;
          if (resultEl) resultEl.innerHTML = _resultCallout(false, msg);
          this.disabled = false;
          this.textContent = originalLabel;
        }
      } catch (e) {
        if (resultEl) resultEl.innerHTML = _resultCallout(false, e.message || String(e));
        this.disabled = false;
        this.textContent = originalLabel;
      }
    });
  });

  root.querySelectorAll('.tc-verify-btn').forEach((btn) => {
    btn.addEventListener('click', async function onVerify() {
      const etap = this.dataset.etap;
      const step = this.dataset.step;
      const method = this.dataset.method;
      const resultSlotId = `tc-result-${etap}-${step}`;
      const resultEl = document.getElementById(resultSlotId);
      const originalLabel = this.textContent;
      this.disabled = true;
      this.textContent = 'Checking...';
      if (resultEl) resultEl.innerHTML = '';
      try {
        const res = await fetch('/api/cocreate/verify-step', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ etap, step, method }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = (data && data.message) || `HTTP error ${res.status}`;
          if (resultEl) resultEl.innerHTML = _resultCallout(false, msg);
          this.disabled = false;
          this.textContent = originalLabel;
          return;
        }
        if (data.pass) {
          const fn = _firstName();
          showToast('success', fn ? `Well done, ${fn}!` : 'Step passed', data.detail || '');
          await _reloadState();
          _rerenderKeepScroll();
          const freshSlot = document.getElementById(resultSlotId);
          if (freshSlot) freshSlot.innerHTML = _resultCallout(true, data.detail, data.sync);
        } else {
          if (resultEl) resultEl.innerHTML = _resultCallout(false, data.detail);
          this.disabled = false;
          this.textContent = originalLabel;
        }
      } catch (e) {
        if (resultEl) resultEl.innerHTML = _resultCallout(false, e.message || String(e));
        this.disabled = false;
        this.textContent = originalLabel;
      }
    });
  });

  // "Open the guide" - a static markdown file under docs/guides/ read
  // straight from the static server and rendered in the shared document modal.
  // No endpoint fronts it: serveStatic already serves docs/ and the slug comes
  // from the stages module, not from anything a person typed.
  root.querySelectorAll('.tc-guide-doc-btn').forEach((btn) => {
    btn.addEventListener('click', function onOpenGuide() {
      const slug = this.dataset.doc;
      if (!DOC_SLUG_RE.test(slug || '')) return;
      const url = '/docs/guides/' + slug + '.md';
      openDocModal({
        title: this.dataset.docTitle || 'Guide',
        load: async () => {
          const res = await fetch(url, { headers: { Accept: 'text/plain' } });
          if (!res.ok) throw new Error('Could not load the guide (HTTP ' + res.status + ').');
          return { path: url.slice(1), content: await res.text() };
        },
      });
    });
  });

  // "Open in a new tab" - a hash route of this same application. window.open
  // needs an absolute URL; a bare '#...' would only move the current tab.
  root.querySelectorAll('.tc-open-tab-btn').forEach((btn) => {
    btn.addEventListener('click', function onOpenTab() {
      const hash = this.dataset.hash;
      if (!TAB_HASH_RE.test(hash || '')) return;
      const opened = window.open(window.location.origin + '/#' + hash, '_blank', 'noopener');
      if (!opened) showToast('warning', 'The browser blocked the new tab', 'Allow pop-ups for this page or open Settings > Modules by hand.');
    });
  });

  // "Open in VS Code" - server NEVER launches an editor process. AC7 of the
  // plan required the whole "// -- Academy --" section to spawn exactly
  // one child process (the `claude auth status` login probe); that probe is
  // gone, so the section spawns none at all.
  // POST /api/cocreate/open-file only resolves
  // the closed key -> {path, absPath, uri} and hands the vscode:// uri back;
  // navigating to it is entirely a client-side act.
  root.querySelectorAll('.tc-open-vscode-btn').forEach((btn) => {
    btn.addEventListener('click', async function onOpenVscode() {
      const key = this.dataset.key;
      const stepEl = this.closest('.tc-step');
      const resultEl = stepEl ? stepEl.querySelector('.tc-step-result') : null;
      const originalLabel = this.textContent;
      this.disabled = true;
      this.textContent = 'Opening...';
      try {
        const res = await fetch('/api/cocreate/open-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok && data.uri) {
          window.location.href = data.uri;
          const detail = (data.detail || 'Opening the file in the editor.')
            + (data.path ? ` If nothing happened (no vscode:// handler registered), open it by hand: ${data.path}` : '');
          if (resultEl) resultEl.innerHTML = `<div class="ds-callout ds-callout--info"><div>${escHtml(detail)}</div></div>`;
        } else {
          const detail = (data && (data.detail || data.message)) || `HTTP error ${res.status}`;
          if (resultEl) resultEl.innerHTML = `<div class="ds-callout ds-callout--warning"><div>${escHtml(detail)}</div></div>`;
        }
      } catch (e) {
        if (resultEl) resultEl.innerHTML = `<div class="ds-callout ds-callout--warning"><div>${escHtml('Could not open the file: ' + (e.message || e))}</div></div>`;
      } finally {
        this.disabled = false;
        this.textContent = originalLabel;
      }
    });
  });

  root.querySelectorAll('.tc-copy-btn').forEach((btn) => {
    btn.addEventListener('click', async function onCopy() {
      const text = this.dataset.copy || '';
      const originalLabel = this.textContent;
      try {
        await navigator.clipboard.writeText(text);
        this.textContent = 'Copied!';
        showToast('success', this.dataset.toastTitle || 'Copied', this.dataset.toastBody || '');
      } catch {
        this.textContent = 'Copy by hand';
        showToast('danger', 'Could not copy', 'Select the text and copy it by hand (Cmd+C on Mac, Ctrl+C on Windows and Linux).');
      } finally {
        setTimeout(() => { this.textContent = originalLabel; }, 1800);
      }
    });
  });

  const progbar = root.querySelector('.tc-progressbar[data-goto]');
  if (progbar) {
    const go = () => {
      const stageId = progbar.dataset.goto;
      const owner = TC_TABS.find((t) => Array.isArray(t.stageIds) && t.stageIds.includes(stageId));
      if (owner) _activateTab(root, owner.id);
      const el = document.getElementById('tc-stage-' + stageId);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    progbar.addEventListener('click', go);
    progbar.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  }

  root.querySelectorAll('.tc-term-tab').forEach((tab) => {
    tab.addEventListener('click', function onTermTab() {
      const term = this.dataset.term;
      const win = this.closest('.tc-vscode');
      if (!win) return;
      win.querySelectorAll('.tc-term-tab').forEach((t) => t.classList.toggle('tc-term-tab--active', t === this));
      win.querySelectorAll('[data-term-screen]').forEach((s) => { s.hidden = s.dataset.termScreen !== term; });
    });
  });
}

function _wireTipsCard(root) {
  root.querySelectorAll('.tc-tip-attest-btn').forEach((btn) => {
    btn.addEventListener('click', async function onTipAttest() {
      const etap = this.dataset.etap;
      const step = this.dataset.step;
      const originalLabel = this.textContent;
      this.disabled = true;
      this.textContent = 'Saving...';
      try {
        const res = await fetch('/api/cocreate/verify-step', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ etap, step, method: 'self-attest' }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          showToast('danger', 'Error', (data && data.message) || `HTTP ${res.status}`);
          this.disabled = false;
          this.textContent = originalLabel;
          return;
        }
        if (data.pass) {
          const fn = _firstName();
          showToast('success', fn ? `Well done, ${fn}!` : 'Checked off!', 'This tip is now marked as done.');
          await _reloadState();
          _rerenderKeepScroll();
        } else {
          this.disabled = false;
          this.textContent = originalLabel;
        }
      } catch (e) {
        showToast('danger', 'Error', e.message || String(e));
        this.disabled = false;
        this.textContent = originalLabel;
      }
    });
  });

  const overlay = root.querySelector('#tc-notif-modal-overlay');
  if (!overlay) return;
  const closeBtn = overlay.querySelector('#tc-notif-modal-close');

  function close() {
    closeDsModal(overlay);
    if (_notifGuideEscHandler) { document.removeEventListener('keydown', _notifGuideEscHandler); _notifGuideEscHandler = null; }
  }
  function open() {
    openDsModal(overlay);
    _notifGuideEscHandler = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', _notifGuideEscHandler);
  }

  root.querySelectorAll('.tc-notif-guide-btn').forEach((btn) => btn.addEventListener('click', open));
  if (closeBtn) closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });

  const tablist = overlay.querySelector('.ds-tabs-list');
  if (tablist) {
    tablist.addEventListener('click', (ev) => {
      const tab = ev.target.closest('[data-notif-tab]');
      if (!tab) return;
      const target = tab.dataset.notifTab;
      tablist.querySelectorAll('.ds-tab').forEach((t) => {
        const active = t === tab;
        t.classList.toggle('active', active);
        t.setAttribute('aria-selected', String(active));
      });
      overlay.querySelectorAll('[data-notif-panel]').forEach((p) => { p.hidden = p.dataset.notifPanel !== target; });
    });
  }
}

// ── Mural: event handling ───────────────────────────────────────────────────

/** POST the entry (an empty string removes it) and repaint from the server. */
async function _muralSubmit(content, btn, okTitle) {
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    const res = await fetch('/api/cocreate/mural', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast('danger', 'Entry not saved', (data && data.message) || `HTTP ${res.status}`);
      btn.disabled = false;
      btn.textContent = original;
      return;
    }
    const note = _syncNote(data.sync);
    showToast('success', okTitle, note || 'Entry saved in the team data repository.');
    _muralEditing = false;
    await _reloadState();
    _rerenderKeepScroll();
  } catch (e) {
    showToast('danger', 'Entry not saved', e.message || String(e));
    btn.disabled = false;
    btn.textContent = original;
  }
}

/** Yes/no modal in front of the removal. Resolves false on Cancel or Escape. */
function _confirmMuralDelete() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'ds-modal-overlay';
    overlay.innerHTML = `
      <div class="ds-modal">
        <div class="ds-modal-header">
          <span class="ds-modal-title">Delete your entry?</span>
        </div>
        <div class="ds-modal-body">
          <p>The entry disappears from the Mural for everyone on the team. You can write it again later, but this text cannot be recovered.</p>
        </div>
        <div class="ds-modal-footer">
          <button type="button" class="ds-btn ds-btn--secondary" data-mural-del-cancel>Cancel</button>
          <button type="button" class="ds-btn ds-btn--danger" data-mural-del-confirm>Delete entry</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    openDsModal(overlay);
    const finish = (result) => {
      closeDsModal(overlay);
      setTimeout(() => overlay.remove(), 200);
      resolve(result);
    };
    overlay.querySelector('[data-mural-del-cancel]').addEventListener('click', () => finish(false));
    overlay.querySelector('[data-mural-del-confirm]').addEventListener('click', () => finish(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
  });
}

function _wireMural(root) {
  const editBtn = root.querySelector('.tc-mural-edit-btn');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      _muralEditing = true;
      _rerenderKeepScroll();
      const input = document.getElementById('tc-mural-input');
      if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
    });
  }

  const cancelBtn = root.querySelector('.tc-mural-cancel-btn');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => { _muralEditing = false; _rerenderKeepScroll(); });
  }

  const saveBtn = root.querySelector('.tc-mural-save-btn');
  if (saveBtn) {
    saveBtn.addEventListener('click', function onMuralSave() {
      const input = document.getElementById('tc-mural-input');
      const content = input ? input.value.trim() : '';
      if (!content) {
        showToast('warning', 'Empty entry', 'Write at least one sentence before saving.');
        return;
      }
      _muralSubmit(content, this, 'You are on the Mural!');
    });
  }

  const deleteBtn = root.querySelector('.tc-mural-delete-btn');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async function onMuralDelete() {
      // The only destructive button in this view, and it removes something
      // everybody can see - so it asks first, like the module removal does.
      if (!await _confirmMuralDelete()) return;
      _muralSubmit('', this, 'Entry deleted');
    });
  }

  const overlay = root.querySelector('#tc-mural-modal-overlay');
  if (!overlay) return;
  const titleEl = overlay.querySelector('#tc-mural-modal-title');
  const avatarEl = overlay.querySelector('#tc-mural-modal-avatar');
  const bodyEl = overlay.querySelector('#tc-mural-modal-body');

  function close() {
    closeDsModal(overlay);
    if (_muralEscHandler) { document.removeEventListener('keydown', _muralEscHandler); _muralEscHandler = null; }
  }

  root.querySelectorAll('.tc-mural-tile').forEach((tile) => {
    tile.addEventListener('click', () => {
      const idx = Number(tile.dataset.muralIdx);
      const entry = (_mural && Array.isArray(_mural.entries) && _mural.entries[idx]) || null;
      if (!entry) return;
      const raw = entry.display_name || entry.person_slug || '';
      const name = _personLabel(raw);
      titleEl.textContent = entry.date ? `${name} · ${entry.date}` : name;
      avatarEl.innerHTML = _avatarInnerHtml(raw, entry.avatar_url, 'tc-mural-photo-fallback');
      // renderMarkdown escapes first and only re-creates a known set of tags,
      // so a mural entry cannot inject markup into this view.
      bodyEl.innerHTML = renderMarkdown(entry.content || '');
      openDsModal(overlay);
      _muralEscHandler = (e) => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', _muralEscHandler);
    });
  });

  const closeBtn = overlay.querySelector('#tc-mural-modal-close');
  if (closeBtn) closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) close(); });
}

// ── Init ─────────────────────────────────────────────────────────────────────

let _infraWired = false;

export async function initAcademy() {
  _activeTab = _readStoredTab();

  registerViewCleanup(VIEW_ID, () => {
    const main = document.querySelector('.main');
    if (_scrollTopHandler) {
      if (main) main.removeEventListener('scroll', _scrollTopHandler);
      window.removeEventListener('scroll', _scrollTopHandler);
      _scrollTopHandler = null;
    }
    _confettiTimers.forEach((t) => clearTimeout(t));
    _confettiTimers = [];
    if (_notifGuideEscHandler) {
      document.removeEventListener('keydown', _notifGuideEscHandler);
      _notifGuideEscHandler = null;
    }
    if (_muralEscHandler) {
      document.removeEventListener('keydown', _muralEscHandler);
      _muralEscHandler = null;
    }
    _muralEditing = false;
  });

  // The "ds-data is not cloned" callouts name the VPN as the reason from the
  // strip's network reading, and that reading changes while the view is on
  // screen. Wired once per session (init runs once by contract), not through
  // registerViewCleanup - the subscription is global and only repaints when
  // this view is the active one.
  if (!_infraWired) {
    _infraWired = true;
    onInfraChanged(() => {
      const view = document.getElementById('view-' + VIEW_ID);
      if (view && view.classList.contains('active')) refreshAcademyData();
    });
  }

  await Promise.all([loadTeamDirectory(), _reloadState()]);
  renderAcademyView();
}

/**
 * `refresh` hook for js/view-registry.js: the local team data changed (a pull,
 * a decrypt, discarded local changes), so re-read the three /api/cocreate/*
 * payloads and repaint. Deliberately NOT initAcademy() - init runs once
 * per session by contract and re-registering its cleanup here would leak a
 * second scroll listener on every sync.
 * @returns {Promise<void>}
 */
export async function refreshAcademyData() {
  await _reloadState();
  renderAcademyView();
}
