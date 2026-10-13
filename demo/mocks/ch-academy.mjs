// demo/mocks/ch-academy.mjs
// Painters for chapter `academy`: the "Academy" view in the markup
// js/academy.js renderAcademyView() builds (hero, tab strip,
// stage cards with step cards, Mural, sticky progress bar). Stage and step
// copy is the text of js/academy-stages.mjs; people, initials and mural
// entries are fictitious. Ids this file creates start with `dm-szkolenie-`.

import { esc } from './common.mjs';

const P = 'dm-szkolenie-';

/** Stage 1 "Environment", the steps as js/academy-stages.mjs declares them. */
const ETAP1 = {
  id: 'etap-1',
  title: 'Environment',
  intro: 'Set up your development environment before you start working with Claude Code.',
  steps: [
    { id: 'step-1', title: 'Set up the terminal in VS Code', server: true, visual: ['zsh'],
      instruction: 'Open VS Code, go to Settings (Cmd + comma on Mac / Ctrl + comma on Windows and Linux), search for "terminal.integrated.defaultLocation" and set it to "editor". The terminal then opens as a regular tab in the main window instead of a narrow panel at the bottom - more room to work with Claude Code. After the change reload the window (Cmd+Shift+P / Ctrl+Shift+P, then "Developer: Reload Window") and click Check.',
      tip: 'The setting only applies to commands that CREATE a terminal - and Cmd+` / Ctrl+` is a different command: "toggleTerminal" shows and hides the bottom panel and ignores the setting. That is why it looks as if the change did not work. Open a new terminal in an editor tab with Cmd+Shift+` / Ctrl+Shift+` (the "terminal.new" command, which respects the setting) or with the button on the terminal toolbar. Terminals that are already open stay where they were - reloading the window does not move them.' },
    { id: 'step-2', title: 'Install the Claude Code CLI', server: true, visual: ['claude', 'zsh'],
      instruction: 'Install Claude Code without administrator rights (never "sudo npm install -g"): "brew install --cask claude-code" (Mac) or "npm install -g @anthropic-ai/claude-code" (Mac, Windows, Linux). After installing, restart the terminal so PATH is refreshed, then click Check.' },
    { id: 'step-2b', title: 'Log in to Claude Code', btn: 'Logged in / Done',
      instruction: 'Run "claude" in the terminal and log in with your Anthropic account (or configure an API key). You are the best judge here: if "claude" shows a login screen when it starts, log in with "/login" inside the session or "claude auth login" in the terminal. "claude auth status" prints a "loggedIn" field and the account e-mail, but it only answers whether credentials ARE stored on this machine - they may come from the desktop app or the browser and may already have expired. That is why the server does not verify this step: you confirm it yourself once the CLI no longer asks you to log in.' },
    { id: 'step-2c', title: 'Pick the right AI model', btn: 'Got it / Done', models: true,
      instruction: 'The model you pick really affects quality, speed and cost. Switch models during a session with /model, or start the tool with the --model flag. Rule of thumb: Sonnet is enough for MOST work (the default, best balance of quality and speed); pick Haiku for very basic, mechanical tasks (fastest and cheapest); reach for Opus for PLANNING and the hardest tasks (strongest reasoning). Click once the rule makes sense.' },
    { id: 'step-3', title: 'Read the repository guide', btn: 'Got it / Done', vscodeBtn: 'Open the guide in VS Code',
      instruction: 'One file that explains this whole repository in plain words: what Mission Deck is made of, where the data lives and why it is encrypted, what a module is, which commands (skills) and roles (agents) you have, and which rules apply to everyone. Click the button below and the file opens in VS Code. Click "Got it / Done" once you have read it.' },
    { id: 'step-4', title: 'Turn on auto mode in Claude Code', btn: 'Got it / Done', visual: ['claude'], auto: true,
      instruction: 'Auto mode lets the agent take the next steps without you confirming every action by hand. QUICK (for the current session): press Shift+Tab - it cycles the approval mode (including auto-accept edits). Each further Shift+Tab moves to the next mode; the current one is shown at the bottom of the terminal ("auto mode on"). PERMANENTLY: start Claude Code with the --permission-mode acceptEdits flag (or set the mode with /permissions). Click once it is configured.' },
    { id: 'step-5', title: 'Try the terminal built into Mission Deck', server: true,
      instruction: 'Mission Deck has its own terminal inside the app (the terminal icon in the top bar) - it runs on the same mechanism (pty + WebSocket) as the VS Code terminal. Open it, type any command and check that it answers. Click Check - we will verify that the terminal service is running.' },
    { id: 'step-6', title: 'Leave your mark on the Mural', server: true,
      instruction: 'Go to the "Mural" tab at the top of this view and write your entry: what you have learned, what you want to build in Mission Deck and what you are curious about. The entry is saved in the team data repository (ds-data) and goes straight to the rest of the team - no branch, no commit, no merge request. Once it is saved, come back here and click Check.' },
  ],
};

/** The first three steps of Stage 2, shown once it is unlocked. */
const ETAP2 = {
  id: 'etap-2',
  title: 'Terminal and CLI - tricks, shortcuts, setup',
  intro: 'Learn to move around the terminal quickly and set Claude Code up for comfortable work. Practise and confirm every step.',
  total: 8,
  steps: [
    { id: 'step-1', title: 'Turn on Shift+Enter in Claude Code', btn: 'Got it / Done',
      instruction: 'Start with comfortable multi-line prompts. Run the /terminal-setup command to enable Shift+Enter (a new line instead of sending right away). Click when done.' },
    { id: 'step-2', title: 'Line navigation shortcuts', btn: 'Practised',
      instruction: 'First copy the long text below (the Copy button) and paste it into the terminal - that gives you something to practise on. Then practise the shortcuts (Mac): Cmd+Left/Right (start/end of line), Option+Left/Right (by word), Cmd+Backspace (whole line), Option+Backspace (word). Click once you have practised.',
      copy: { label: 'Copy practice text', text: 'Terminal shortcut practice: paste this long line into the terminal and practise navigating it.' } },
    { id: 'step-3', title: 'Full-screen mode (TUI) for Claude Code', btn: 'Tried it',
      instruction: 'Get to know the Claude Code full-screen mode - more room for the conversation and previews. Find out how to enter it and when it helps (long sessions, reading diffs). Click once you have tried it.' },
  ],
};

const PRE_PASSED = ['step-2', 'step-2c', 'step-3', 'step-4', 'step-5'];

const TABS = [
  { id: 'etap-1', label: 'Stage 1' },
  { id: 'etap-2', label: 'Stage 2' },
  { id: 'etap-3', label: 'Stage 3' },
  { id: 'etap-4', label: 'Pro tips' },
  { id: 'mural', label: 'Mural' },
  { id: 'galeria', label: 'Gallery' },
];

/** People who finished each stage (fictitious initials and names). */
const FINISHERS = {
  'etap-1': [['JP', 'Jamie Park'], ['JW', 'Jesse Ward'], ['KW', 'Kendall West'], ['RM', 'Reese Murphy']],
  'etap-2': [['JP', 'Jamie Park'], ['JW', 'Jesse Ward']],
  'etap-3': [['JP', 'Jamie Park']],
  'etap-4': [],
};

const OTHER_MURAL = [
  { name: 'Jamie Park', meta: 'Product analyst · 01.10.2026', answers: [
    ['What I have learned', 'That a module is a folder with a module.json, not a change to the core'],
    ['What I want to build in Mission Deck', 'A board of A/B test results for my team'],
  ] },
  { name: 'Jesse Ward', meta: 'Product Owner · 29.09.2026', answers: [
    ['What I have learned', 'Shift+Tab turns on auto mode, /compact rescues long conversations'],
    ['Questions and observations', 'What is the best way to share data between two modules?'],
  ] },
];

const MY_MURAL = { name: 'Alex Morgan', meta: 'Product Designer · 04.10.2026', answers: [
  ['What I have learned', 'The terminal in an editor tab and logging in to Claude Code'],
  ['What I want to build in Mission Deck', 'A module with my team’s reports'],
] };

/** What the autopilot types into the Mural textarea. */
export const SZKOLENIE_MURAL_TEXT = '## What I have learned\n\n- The terminal in an editor tab and logging in to Claude Code\n\n## What I want to build in Mission Deck\n\n- A module with my team’s reports';

const MURAL_TEMPLATE = '## What I have learned\n\n- \n\n## What I want to build in Mission Deck\n\n- \n\n## Questions and observations\n\n- ';

const KEY_RE = /(?:Cmd|Ctrl|Option|Alt|Shift)(?: \+ (?:comma|period))|(?:Cmd|Ctrl|Option|Alt|Shift)(?:\+(?:[A-Za-z0-9]+(?:\/[A-Za-z0-9]+)?|[,.`\\/]))+/g;
const keys = (escaped) => String(escaped).replace(KEY_RE, (m) => `<span class="tc-kbd">${m}</span>`);

const SVG_CODE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>';
const SVG_COPY = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const SVG_TIP = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5"/></svg>';
const SVG_PASS = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>';
const SVG_FAIL = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>';
const TAB_ICONS = {
  locked: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  progress: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  done: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
};

const TERM_SCREENS = {
  claude: '<div class="tc-cli-banner"><div class="tc-cli-bannertext"><div class="tc-term-line"><strong class="tc-term-bold">Claude Code</strong></div><div class="tc-term-line tc-term-dim">~/Projects/mission-deck</div></div></div>',
  zsh: '<div class="tc-term-line tc-term-dim">Last login: today at 09:14</div><div class="tc-term-line"><span class="tc-term-prompt">~/Projects/mission-deck</span> %&nbsp;<span class="tc-term-caret"></span></div>',
  'claude-auto': '<div class="tc-term-line tc-term-rule"></div><div class="tc-term-line"><span class="tc-term-arrow">&rsaquo;</span>&nbsp;<span class="tc-term-caret"></span></div><div class="tc-term-line tc-term-rule"></div><div class="tc-term-line tc-term-auto">&#9656;&#9656; auto mode on <span class="tc-term-dim">(shift+tab to cycle)</span></div>',
};

function vscodeFrame(inner, label) {
  return `<div class="tc-vscode" role="img" aria-label="${esc(label)}">
        <div class="tc-vscode-titlebar">
          <span class="tc-vscode-dot tc-vscode-dot--r"></span><span class="tc-vscode-dot tc-vscode-dot--y"></span><span class="tc-vscode-dot tc-vscode-dot--g"></span>
          <span class="tc-vscode-titletext">mission-deck — Visual Studio Code</span>
        </div>
        <div class="tc-vscode-body">
          <div class="tc-vscode-activitybar"><span class="tc-ab-icon"></span><span class="tc-ab-icon"></span><span class="tc-ab-icon"></span><span class="tc-ab-icon"></span></div>
          <div class="tc-vscode-main">${inner}</div>
        </div>
      </div>`;
}

/** _renderStepVisual for kind 'vscode-terminal'. */
function terminalVisual(tabs, auto) {
  const key = (t) => (auto && TERM_SCREENS[t + '-auto'] ? t + '-auto' : t);
  const inner = `<div class="tc-term-tabs">${tabs.map((t, i) => `<button class="ds-btn ds-btn--tertiary tc-term-tab${i === 0 ? ' tc-term-tab--active' : ''}" type="button">${esc(t)}</button>`).join('')}
              <span class="tc-term-tabs-spacer"></span>
              <button class="ds-btn ds-btn--tertiary tc-term-ctl tc-term-ctl--hl" type="button" title="New terminal" aria-label="New terminal">+</button>
            </div>
            ${tabs.map((t, i) => `<div class="tc-term-screen"${i === 0 ? '' : ' hidden'}>${TERM_SCREENS[key(t)] || ''}</div>`).join('')}`;
  return `<div class="tc-visual">${vscodeFrame(inner, 'VS Code preview with the terminal in the main window')}
      <p class="tc-visual-caption">With <code>terminal.integrated.defaultLocation: editor</code> set, the terminal opens
        as a regular tab in the main window. Add a new terminal with the <span class="tc-kbd">+</span> button
        (or <span class="tc-kbd">Ctrl+\`</span>), and split it vertically: Mac <span class="tc-kbd">Cmd+\\</span>,
        Windows/Linux <span class="tc-kbd">Ctrl+Shift+5</span>.</p>
    </div>`;
}

/** _renderModelPicker. */
function modelVisual() {
  const rows = [
    ['1', 'Haiku 5.5', 'Very basic, mechanical tasks', 'fastest / cheapest', 'fast', false],
    ['2', 'Sonnet 4.6', 'Most operations — everyday work', 'default / recommended', 'default', true],
    ['3', 'Opus 4.8', 'Planning and the hardest tasks', 'strongest reasoning', 'opus', false],
  ].map(([k, name, use, tag, kind, sel]) => `<div class="tc-model-row${sel ? ' tc-model-row--sel' : ''}">
              <span class="tc-model-radio" aria-hidden="true"></span><span class="tc-model-key">${k}.</span>
              <span class="tc-model-info"><span class="tc-model-name">${esc(name)}</span><span class="tc-model-use">${esc(use)}</span></span>
              <span class="tc-model-tag tc-model-tag--${kind}">${esc(tag)}</span>
            </div>`).join('');
  const inner = `<div class="tc-term-tabs"><button class="ds-btn ds-btn--tertiary tc-term-tab tc-term-tab--active" type="button">claude</button><span class="tc-term-tabs-spacer"></span></div>
            <div class="tc-model-screen">
              <div class="tc-term-line"><span class="tc-term-prompt">&rsaquo;</span> <span class="tc-term-cmd">/model</span></div>
              <div class="tc-model-box">
                <div class="tc-model-box-title">Choose a model for the current session</div>
                <div class="tc-model-rows">${rows}</div>
                <div class="tc-model-box-hint">&#8593;&#8595; navigate &middot; <strong>Enter</strong> select &middot; Esc cancel</div>
              </div>
            </div>`;
  return `<div class="tc-visual tc-visual--models">${vscodeFrame(inner, 'Preview of the model picker in Claude Code (the /model command)')}
      <p class="tc-visual-caption">Switch models with the <code>/model</code> command or by starting with the <code>--model</code> flag.
        Rule of thumb: <strong>Sonnet</strong> for most work, <strong>Haiku</strong> for very simple things,
        and <strong>Opus</strong> for planning and hard tasks.</p>
    </div>`;
}

/** _resultCallout. */
function resultCallout(ok, detail) {
  return `<div class="tc-result-callout ${ok ? 'tc-result--pass' : 'tc-result--fail'}">
      <span class="tc-result-icon">${ok ? SVG_PASS : SVG_FAIL}</span>
      <div class="tc-result-body">
        <span class="tc-result-lead">${ok ? 'Well done, Alex!' : 'Not quite yet, Alex'}</span>
        <span class="tc-result-detail">${esc(detail)}</span>
        ${ok ? '<span class="tc-sync-note tc-sync-note--ok">Progress sent to the team.</span>' : ''}
      </div>
    </div>`;
}

const DETAILS = {
  'step-1': { pass: 'I found the terminal setting in the VS Code settings.json file.', fail: 'I did not find the terminal setting in settings.json - add e.g. "terminal.integrated.defaultLocation": "editor".' },
  'step-2b': { pass: 'Confirmed on your word - on we go!' },
  'step-6': { pass: 'Your entry is on the Mural - you will see it on the "Mural" tab.' },
};

/** _renderStepCard. `result` is 'pass' | 'fail' | 'checking' | undefined. */
function stepCard(etapId, step, idx, passed, result) {
  const base = step.btn || 'Check';
  const label = result === 'checking' ? 'Checking...' : (passed ? 'Check again' : base);
  const visual = step.models ? modelVisual() : (step.visual && passed ? terminalVisual(step.visual, step.auto) : '');
  const copy = step.copy ? `<div class="tc-prompt-box">
        <div class="tc-prompt-head">
          <span class="tc-prompt-label">${SVG_CODE} To copy</span>
          <button class="ds-btn ds-btn--secondary ds-btn--sm tc-copy-btn">${SVG_COPY} ${esc(step.copy.label)}</button>
        </div>
        <pre class="tc-prompt-text">${esc(step.copy.text)}</pre>
      </div>` : '';
  const detail = DETAILS[step.id] || {};
  const resultHtml = result === 'pass' ? resultCallout(true, detail.pass || '') : result === 'fail' ? resultCallout(false, detail.fail || '') : '';
  const sid = `${P}step-${etapId}-${step.id}`;
  return `
    <div class="tc-step${passed ? ' tc-step--passed' : ''}" id="${sid}" style="--tc-step-i:${idx}">
      <div class="tc-step-header">
        <span class="tc-step-num${passed ? ' tc-step-num--done' : ''}">${passed ? '&#10003;' : (idx + 1)}</span>
        <span class="tc-step-title">${esc(step.title)}</span>
        ${passed ? '<span class="ds-badge ds-badge--green">OK</span>' : ''}
      </div>
      <p class="tc-step-instruction">${keys(esc(step.instruction))}</p>
      ${visual}
      ${copy}
      ${step.tip ? `<div class="tc-step-tip">${SVG_TIP}<span>${keys(esc(step.tip))}</span></div>` : ''}
      <div class="tc-step-actions">
        ${step.vscodeBtn ? `<button class="ds-btn ds-btn--tertiary ds-btn--sm tc-open-vscode-btn">${esc(step.vscodeBtn)}</button>` : ''}
        <button class="ds-btn ds-btn--sm tc-verify-btn ${passed ? 'ds-btn--tertiary' : 'ds-btn--secondary'}" id="${sid}-verify"${result === 'checking' ? ' disabled' : ''}>${esc(label)}</button>
      </div>
      <div class="tc-step-result" aria-live="polite">${resultHtml}</div>
    </div>`;
}

function avatars(stageId) {
  const list = FINISHERS[stageId] || [];
  const circles = list.map(([ini, name]) => `<span class="tc-pavatar tc-pavatar--initials" title="${esc(name)}">${esc(ini)}</span>`);
  for (let i = circles.length; i < 16; i += 1) circles.push('<span class="tc-pavatar tc-pavatar--empty" aria-hidden="true"></span>');
  return `<div class="tc-participants-av" title="Participants who finished this stage">${circles.join('')}</div>`;
}

function confetti() {
  const colors = ['var(--brand-accent)', 'var(--ds-yellow-50)', 'var(--ds-red-50)', 'var(--ds-blue-50)', 'var(--ds-violet-40)'];
  const pieces = [];
  for (let i = 0; i < 18; i += 1) {
    const angle = (360 / 18) * i;
    const dist = 60 + (i % 5) * 16;
    const dx = Math.round(Math.cos(angle * Math.PI / 180) * dist);
    const dy = Math.round(Math.sin(angle * Math.PI / 180) * dist);
    pieces.push(`<span class="tc-confetti-piece" style="--tc-dx:${dx}px;--tc-dy:${dy}px;--tc-rot:${angle * 2}deg;background:${colors[i % colors.length]};animation-delay:${(i % 6) * 18}ms"></span>`);
  }
  return `<div class="tc-confetti">${pieces.join('')}</div>`;
}

/** _renderStageCard for a gated stage. */
function stageCard(stage, { unlocked, unlockable, passed, results, justUnlocked }) {
  const done = unlocked ? stage.steps.filter((s) => passed.includes(s.id)).length : 0;
  const total = stage.total || stage.steps.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const num = stage.id.split('-')[1];
  const complete = unlocked && done === total;
  return `
    <div class="ds-card tc-stage ${unlocked ? 'tc-stage--unlocked' + (justUnlocked ? ' tc-stage--just-unlocked' : '') : 'tc-stage--locked'}" id="${P}stage-${stage.id}">
      <div class="ds-card-header">
        <span class="tc-stage-titlewrap"><span class="tc-stage-eyebrow">Stage ${num}</span><span class="ds-card-title">${esc(stage.title)}</span></span>
        ${unlocked ? `<span class="tc-stage-counter${complete ? ' tc-stage-counter--complete' : ''}" id="${P}counter-${stage.id}">${done} / ${total} done</span>` : ''}
        ${unlocked ? '<span class="ds-badge ds-badge--green">unlocked</span>' : '<span class="ds-badge ds-badge--red">locked</span>'}
      </div>
      ${unlocked ? `<div class="tc-stage-bar"><span class="tc-stage-bar-fill" style="width:${pct}%"></span></div>` : ''}
      <div class="ds-card-body">
        <p class="tc-stage-intro">${esc(stage.intro)}</p>
        ${!unlocked && !unlockable ? '<div class="ds-callout ds-callout--neutral tc-locked-note"><div>Unlock the previous stage to make this one available.</div></div>' : ''}
        ${!unlocked && unlockable ? `<div class="tc-unlock-section">
          <p class="tc-unlock-desc">Unlock this stage - you have finished the previous one. Your progress is saved on the server and visible to the whole team.</p>
          <div class="tc-unlock-actions"><button class="ds-btn ds-btn--primary ds-btn--sm tc-unlock-btn" id="${P}unlock-${stage.id}">Unlock</button></div>
          <div class="tc-unlock-result" aria-live="polite"></div>
        </div>` : ''}
        ${unlocked ? stage.steps.map((s, i) => stepCard(stage.id, s, i, passed.includes(s.id), results[s.id])).join('') : ''}
        ${complete ? `<div class="tc-participants-row tc-participants-row--done"><span class="tc-participants-label">&#10003; Finished this stage:</span>${avatars(stage.id)}</div>` : ''}
      </div>
      ${justUnlocked ? confetti() : ''}
    </div>`;
}

const KROK0 = (() => {
  const items = [
    ['<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>', 'Access keys', 'Go to <span class="tc-inline-link">Settings &gt; Keys</span> and unlock the Bitwarden vault — Mission Deck fetches the other tokens from there by itself.'],
    ['<path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>', 'App update', 'Check for a new version at the top of the screen, and in <span class="tc-inline-link">Settings</span> click Restart server to run it.'],
    ['<rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/>', 'The terminal built into Mission Deck', 'The terminal icon in the top bar opens a working terminal without leaving the browser — handy in the next steps.'],
  ];
  return `<div class="ds-card tc-krok0">
      <div class="ds-card-header tc-stage-head">
        <span class="tc-step-num tc-step-num--info">0</span>
        <span class="ds-card-title">Before you start — setting up the environment</span>
        <span class="tc-stage-head-spacer"></span>
        <span class="ds-badge ds-badge--gray">info</span>
      </div>
      <div class="ds-card-body">
        <p class="tc-krok0-lead">You set these up once, before you start the stages. Is your Mission Deck already set up? Go straight to Stage 1.</p>
        <div class="tc-krok0-grid">${items.map(([ic, t, d]) => `<div class="tc-krok0-item">
          <span class="tc-krok0-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ic}</svg></span>
          <div class="tc-krok0-text"><h4 class="tc-krok0-title">${esc(t)}</h4><p class="tc-krok0-desc">${d}</p></div>
        </div>`).join('')}</div>
      </div>
    </div>`;
})();

function muralTile(entry, idx, fresh) {
  const ini = entry.name.split(' ').map((w) => w[0]).join('');
  return `<button type="button" class="ds-card tc-mural-tile${fresh ? ` ${P}fresh` : ''}" id="${P}mural-tile-${idx}" aria-label="Read the entry: ${esc(entry.name)}">
      <span class="tc-mural-tile-head">
        <span class="tc-mural-photo"><span class="tc-mural-photo-fallback">${esc(ini)}</span></span>
        <span class="tc-mural-who"><span class="tc-mural-author">${esc(entry.name)}</span><span class="tc-mural-meta">${esc(entry.meta)}</span></span>
      </span>
      <span class="tc-mural-answers">${entry.answers.map(([q, a]) => `<span class="tc-mural-answer"><span class="tc-mural-answer-q">${esc(q)}</span><span class="tc-mural-answer-a">${esc(a)}</span></span>`).join('')}</span>
      <span class="tc-mural-more">Read the whole entry &rarr;</span>
    </button>`;
}

/** _renderMuralTab: compose card (closed or open) plus the tiles. */
function mural({ mine, editing }) {
  const entries = mine ? [MY_MURAL, ...OTHER_MURAL] : OTHER_MURAL;
  const count = entries.length;
  const compose = editing ? `<div class="ds-card tc-mural-compose">
        <div class="ds-card-header"><span class="ds-card-title">Your entry on the Mural</span></div>
        <div class="ds-card-body">
          <label class="tc-mural-label" for="${P}mural-input">Markdown — headings, lists and bold all work.</label>
          <textarea id="${P}mural-input" class="ds-input tc-mural-input" rows="12" placeholder="Write a few sentences about yourself and what you want to build…">${esc(MURAL_TEMPLATE)}</textarea>
          <div class="tc-mural-compose-actions">
            <button type="button" class="ds-btn ds-btn--primary tc-mural-save-btn" id="${P}mural-save">Save entry</button>
            <button type="button" class="ds-btn ds-btn--secondary tc-mural-cancel-btn">Cancel</button>
          </div>
        </div>
      </div>` : `<div class="ds-card tc-mural-compose">
        <div class="ds-card-body tc-mural-compose-closed">
          <div class="tc-mural-compose-text">
            <strong>${mine ? 'Your entry is on the Mural.' : 'You do not have an entry yet.'}</strong>
            <span>${mine ? 'You can edit it at any time — the save goes straight to the team.'
    : 'Write what you have learned and what you want to build. The entry is saved in the team data repository, with no branch and no merge request.'}</span>
          </div>
          <button type="button" class="ds-btn ds-btn--primary tc-mural-edit-btn" id="${P}mural-edit">${mine ? 'Edit your entry' : 'Add your entry'}</button>
        </div>
      </div>`;
  return `<div class="tc-mural-section">
      <div class="tc-mural-head"><h3 class="tc-mural-title">The participants’ Mural</h3><span class="ds-badge ds-badge--gray">${count} ${count === 1 ? 'entry' : 'entries'}</span></div>
      <p class="tc-mural-sub">Marks left by people going through this path. The entries live in the team data repository, so you see them right after a sync — no branch and no merge request.</p>
      ${compose}
      <div class="tc-mural-grid" id="${P}mural-grid">${entries.map((e, i) => muralTile(e, i, mine && i === 0)).join('')}</div>
    </div>`;
}

function hero() {
  const stages = ['etap-1', 'etap-2', 'etap-3', 'etap-4'];
  return `<div class="tc-hero">
      <div class="tc-hero-top">
        <div class="tc-hero-avatar"><span class="tc-hero-avatar-fallback">AM</span></div>
        <div class="tc-hero-text">
          <div class="tc-hero-greeting">Welcome, Alex!</div>
          <div class="tc-hero-sub">Unlock the stages one by one, verify the steps and build your own module.</div>
        </div>
        <div class="tc-hero-finishers-wrap">${stages.map((id, i) => `<div class="tc-hero-finishers">
          <span class="tc-hero-finishers-label">Finished Stage ${i + 1}${id === 'etap-4' ? ' (pro tips)' : ''}</span>${avatars(id)}</div>`).join('')}</div>
      </div>
      <div class="tc-hero-howto">
        <strong>How does the training path work?</strong>
        Unlock a stage with one click once you finish the previous one. Click "Check" next to every step —
        your progress is saved together with the team and visible on the avatars below.
      </div>
    </div>`;
}

function progressBar(passed, unlocked2) {
  const done = ETAP1.steps.filter((s) => passed.includes(s.id)).length;
  let title;
  let count;
  let pct;
  let complete = false;
  if (unlocked2) {
    title = `Alex, time to start: ${esc(ETAP2.title)}`; count = '0 / 8 steps &middot; 0%'; pct = 0;
  } else if (done === 8) {
    title = `&#x1F389; Alex, you finished ${esc(ETAP1.title)}!`; count = '8 / 8 steps &middot; 100%'; pct = 100; complete = true;
  } else {
    pct = Math.round((done / 8) * 100);
    title = pct >= 50 ? `Alex, already ${pct}% — you are on the home stretch of ${esc(ETAP1.title)}` : `Alex, a good start in ${esc(ETAP1.title)}`;
    count = `${done} / 8 steps &middot; ${pct}%`;
  }
  return `<div class="tc-progressbar${complete ? ' tc-progressbar--complete' : ''}" role="button" tabindex="0" title="Go to the stage" aria-label="Go to the stage" id="${P}progressbar">
      <div class="tc-progressbar-inner">
        <div class="tc-progressbar-meta">
          <span class="tc-progressbar-title">${title}</span>
          <span class="tc-progressbar-right"><span class="tc-progressbar-count">${count}</span>
            <svg class="tc-progressbar-arrow" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg></span>
        </div>
        <div class="tc-progressbar-track"><span class="tc-progressbar-fill" style="width:${pct}%"></span></div>
      </div>
    </div>`;
}

/**
 * The whole view (academy-root).
 * @param {{ passed?: string[], results?: object, tab?: string, unlocked2?: boolean,
 *   justUnlocked?: boolean, mine?: boolean, editing?: boolean }} props
 */
function root({ passed = PRE_PASSED, results = {}, tab = 'etap-1', unlocked2 = false, justUnlocked = false, mine = false, editing = false } = {}) {
  const etap1Done = ETAP1.steps.every((s) => passed.includes(s.id));
  const status = {
    'etap-1': etap1Done ? 'done' : 'progress',
    'etap-2': unlocked2 ? 'progress' : 'locked',
    'etap-3': 'locked',
    'etap-4': 'progress',
  };
  const strip = `<nav class="ds-tabs-list ds-framed-tabs tc-tabs" role="tablist" id="${P}tabs">${TABS.map((t) => `
      <button type="button" class="ds-tab${t.id === tab ? ' active' : ''}" role="tab" aria-selected="${t.id === tab}" id="${P}tab-${t.id}">
        ${status[t.id] ? `<span class="tc-tab-status tc-tab-status--${status[t.id]}">${TAB_ICONS[status[t.id]]}</span>` : ''}<span class="tc-tab-label">${esc(t.label)}</span>
      </button>`).join('')}</nav>`;
  const panel = (id, html) => `<div class="ds-tab-panel tc-tab-panel"${id === tab ? '' : ' hidden'}>${html}</div>`;
  return `${hero()}${strip}
    ${panel('etap-1', `${KROK0}<div class="tc-stages">${stageCard(ETAP1, { unlocked: true, passed, results })}</div>`)}
    ${panel('etap-2', `<div class="tc-stages">${stageCard(ETAP2, { unlocked: unlocked2, unlockable: etap1Done, passed: [], results: {}, justUnlocked })}</div>`)}
    ${panel('etap-3', '')}
    ${panel('etap-4', '')}
    ${panel('mural', mural({ mine, editing }))}
    ${panel('galeria', '')}
    ${progressBar(passed, unlocked2)}`;
}

export const MOCKS = {
  'szkolenie-root': (props) => root(props),
};

/** Every visible label these painters paint (copy gate). */
export const LABELS = [
  'Academy', ...TABS.map((t) => t.label), ETAP1.title, ETAP1.intro, ETAP2.title, ETAP2.intro,
  ...ETAP1.steps.map((s) => s.title), ...ETAP2.steps.map((s) => s.title), 'Check', 'Check again', 'Checking...',
  'Logged in / Done', 'Got it / Done', 'unlocked', 'locked', 'Unlock', 'The participants’ Mural',
  'Add your entry', 'Edit your entry', 'Save entry', 'Cancel', 'Read the whole entry', 'Welcome, Alex!', 'Well done, Alex!',
  'Not quite yet, Alex', 'Progress sent to the team.', ...Object.values(DETAILS).flatMap((d) => Object.values(d)),
];
