// demo/chapters/academy.mjs
// Chapter `academy`: rail "Academy" -> Academy. Three steps of
// Stage 1 are walked for real - "Log in to Claude Code", "Set up the terminal
// in VS Code" (first a failed check, then the fix) and "Leave your mark on the Mural" -
// and the finished stage unlocks Stage 2. Mocks in demo/mocks/ch-academy.mjs.

import { narrate, VAULT_OPEN } from './_helpers.mjs';
import { SZKOLENIE_MURAL_TEXT } from '../mocks/ch-academy.mjs';

const P = '#dm-szkolenie-';
const PRE = ['step-2', 'step-2c', 'step-3', 'step-4', 'step-5'];
const AFTER_LOGIN = [...PRE, 'step-2b'];
const AFTER_TERMINAL = [...AFTER_LOGIN, 'step-1'];
const ALL = [...AFTER_TERMINAL, 'step-6'];

/** Repaint the whole view in one state (renderAcademyView does the same). */
const paint = (props = {}) => ({ type: 'show', mock: 'szkolenie-root', target: '#academy-root', props });
const step = (id) => `${P}step-etap-1-${id}`;

export default {
  setup: [paint(), VAULT_OPEN],
  steps: [
    {
      id: 'szkolenie-otworz',
      caption: 'I go into the **Academy** — three steps stand between me and Stage 2.',
      mascot: 'wave',
      camera: 'full',
      actions: [
        narrate('Academy', 'The Academy leads from an empty VS Code to a published module. Stages unlock one after another, and every step is checked by the server or confirmed by you. The whole team sees the progress.'),
        { type: 'navigate', view: 'academy' },
        { type: 'camera', target: P + 'tabs', zoom: 1.4 },
        { type: 'wait', ms: 700 },
        { type: 'camera', full: true },
        { type: 'scroll', target: P + 'stage-etap-1 .ds-card-header' },
        { type: 'camera', target: P + 'stage-etap-1 .ds-card-header', zoom: 1.25 },
      ],
    },
    {
      id: 'szkolenie-logowanie',
      caption: 'I sign in to **Claude Code** in the VS Code terminal and confirm the step in the Academy.',
      mascot: 'working',
      actions: [
        narrate('Step: Log in to Claude Code', 'We run “claude” in the terminal and sign in with the /login command. The server does not check this step — you confirm it yourself once the CLI no longer asks you to sign in.', 'claude'),
        { type: 'scroll', target: step('step-2b') },
        { type: 'camera', target: step('step-2b'), zoom: 1.3 },
        { type: 'wait', ms: 500 },
        { type: 'camera', full: true },
        { type: 'surface', show: 'vscode' },
        { type: 'camera', target: '#demo-vsc-terminal', zoom: 1.3 },
        {
          type: 'terminal',
          lines: [
            { role: 'cmd', text: 'claude' },
            { role: 'claude', text: '~/Projects/mission-deck' },
            { role: 'user', text: '/login' },
            { role: 'out', text: 'Select login method: 1. Claude account with subscription' },
            { role: 'dim', text: 'Opening browser to sign in…' },
            { role: 'ok', text: 'Login successful. Press Enter to continue…' },
          ],
        },
        { type: 'camera', full: true },
        { type: 'surface', show: 'cockpit' },
        { type: 'scroll', target: step('step-2b') + '-verify' },
        { type: 'click', target: step('step-2b') + '-verify' },
        paint({ passed: PRE, results: { 'step-2b': 'checking' } }),
        { type: 'wait', ms: 500 },
        paint({ passed: AFTER_LOGIN, results: { 'step-2b': 'pass' } }),
        { type: 'toast', variant: 'success', title: 'Well done, Alex!', desc: 'Confirmed on your word - on we go!' },
        { type: 'camera', target: step('step-2b'), zoom: 1.25 },
      ],
    },
    {
      id: 'szkolenie-terminal-blad',
      caption: 'I click **Check** next to the terminal — the server does not see the setting yet.',
      mascot: 'error',
      actions: [
        narrate('The server really checks', 'The server checks the step “Set up the terminal in VS Code”: it reads the VS Code settings file. The setting is not there yet, so the result is honest — “Not quite yet” and a hint about what to add.'),
        { type: 'camera', full: true },
        { type: 'scroll', target: step('step-1') },
        { type: 'camera', target: step('step-1'), zoom: 1.2 },
        { type: 'click', target: step('step-1') + '-verify' },
        paint({ passed: AFTER_LOGIN, results: { 'step-1': 'checking' } }),
        { type: 'wait', ms: 700 },
        paint({ passed: AFTER_LOGIN, results: { 'step-1': 'fail' } }),
      ],
    },
    {
      id: 'szkolenie-terminal-poprawka',
      caption: 'Claude fixes the setting and I click **Check** again — this time it is green.',
      mascot: 'working',
      actions: [
        narrate('A fix with Claude’s help', 'Instead of hunting for the setting by hand, we tell Claude in a plain sentence what the Academy wants — it finds the VS Code settings file itself and adds the right line. After the window reloads, the terminal opens as an editor tab, and another “Check” gives a green result.'),
        { type: 'camera', full: true },
        { type: 'surface', show: 'vscode' },
        { type: 'camera', target: '#demo-vsc-terminal', zoom: 1.3 },
        {
          type: 'terminal',
          lines: [
            { role: 'user', text: 'The Academy says the terminal should open as an editor tab. Set that up for me in VS Code.' },
            { role: 'tool', verb: 'Update', text: '~/Library/Application Support/Code/User/settings.json', summary: '1 change', body: ['"terminal.integrated.defaultLocation": "editor"'] },
            { role: 'assistant', text: 'Done. Reload the window (Cmd+Shift+P, on Windows and Linux Ctrl+Shift+P → Developer: Reload Window), and a new terminal will open as an editor tab.' },
          ],
        },
        { type: 'camera', full: true },
        { type: 'surface', show: 'cockpit' },
        { type: 'scroll', target: step('step-1') + '-verify' },
        { type: 'click', target: step('step-1') + '-verify' },
        paint({ passed: AFTER_LOGIN, results: { 'step-1': 'checking' } }),
        { type: 'wait', ms: 700 },
        paint({ passed: AFTER_TERMINAL, results: { 'step-1': 'pass' } }),
        { type: 'toast', variant: 'success', title: 'Well done, Alex!', desc: 'I found the terminal setting in the VS Code settings.json file.' },
        { type: 'scroll', target: step('step-1') },
      ],
    },
    {
      id: 'szkolenie-mural',
      caption: 'I leave **my mark on the Mural** — the entry reaches the team at once.',
      mascot: 'success',
      actions: [
        narrate('The participants’ Mural', 'The Mural holds entries from people going through the Academy. An entry is saved in the team data repository and goes straight to everyone else — no branch, commit or merge request.'),
        { type: 'camera', full: true },
        { type: 'scroll', target: P + 'tabs' },
        { type: 'click', target: P + 'tab-mural' },
        paint({ passed: AFTER_TERMINAL, tab: 'mural' }),
        { type: 'click', target: P + 'mural-edit' },
        paint({ passed: AFTER_TERMINAL, tab: 'mural', editing: true }),
        { type: 'camera', target: P + 'mural-input', zoom: 1.4 },
        { type: 'type', target: P + 'mural-input', text: SZKOLENIE_MURAL_TEXT },
        { type: 'click', target: P + 'mural-save' },
        { type: 'camera', full: true },
        paint({ passed: AFTER_TERMINAL, tab: 'mural', mine: true }),
        { type: 'toast', variant: 'success', title: 'You are on the Mural!', desc: 'Progress sent to the team.' },
        { type: 'scroll', target: P + 'mural-grid' },
        { type: 'camera', target: P + 'mural-grid', zoom: 1.3 },
      ],
    },
    {
      id: 'szkolenie-etap-2',
      caption: 'Stage 1 done — I **unlock** Stage 2!',
      mascot: 'wave',
      actions: [
        narrate('The next stage', 'The last step checks that the entry is on the Mural. When all eight steps are green, the Stage 2 tab lets you unlock the next stage — with confetti.'),
        { type: 'camera', full: true },
        { type: 'scroll', target: P + 'tabs' },
        { type: 'click', target: P + 'tab-etap-1' },
        paint({ passed: AFTER_TERMINAL, mine: true }),
        { type: 'scroll', target: step('step-6') + '-verify' },
        { type: 'click', target: step('step-6') + '-verify' },
        paint({ passed: AFTER_TERMINAL, mine: true, results: { 'step-6': 'checking' } }),
        { type: 'wait', ms: 600 },
        paint({ passed: ALL, mine: true, results: { 'step-6': 'pass' } }),
        { type: 'toast', variant: 'success', title: 'Well done, Alex!', desc: 'Your entry is on the Mural - you will see it on the "Mural" tab.' },
        { type: 'camera', target: P + 'progressbar', zoom: 1.6 },
        { type: 'wait', ms: 700 },
        { type: 'camera', full: true },
        { type: 'scroll', target: P + 'tabs' },
        { type: 'click', target: P + 'tab-etap-2' },
        paint({ passed: ALL, mine: true, tab: 'etap-2' }),
        { type: 'click', target: P + 'unlock-etap-2' },
        paint({ passed: ALL, mine: true, tab: 'etap-2', unlocked2: true, justUnlocked: true }),
        { type: 'toast', variant: 'success', title: 'Stage unlocked!', desc: 'Welcome, Alex!' },
        { type: 'camera', target: P + 'stage-etap-2', zoom: 1.2 },
      ],
    },
  ],
};
