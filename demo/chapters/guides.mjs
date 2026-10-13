// demo/chapters/guides.mjs
// Chapter `guides` ("Before you start"), the first one: the real documents
// of docs/guides/ walked the way a presenter would. The folder in the VS
// Code explorer, INSTALL.html in the browser (steps 0-8 and the configuration
// wizard), ONBOARDING.md as a Markdown preview (first-day checklist ticking,
// vault entry names, "Which skill to use", key ideas, five traps, "Where
// next"), and where the guides live later inside Mission Deck: Academy >
// Stage 1 "Read the repository guide" opens repo-guide.md in VS Code (the
// step's openVscode key), and in Stage 3 "Anatomy of a module" the same
// folder's module-anatomy.md opens in the document window (guideDoc slug ->
// /docs/guides/<slug>.md).
// Mocks in demo/mocks/ch-guides.mjs; the Academy view is the shared
// `szkolenie-root` painter. Nothing is installed, cloned or started.

import { narrate } from './_helpers.mjs';
import { CHECKLIST } from '../mocks/ch-guides.mjs';

const DIR = 'docs/guides/';
const DOCS = [
  'INSTALL.html', 'ONBOARDING.md', 'WINDOWS.md', 'module-anatomy.md', 'prototypes.md',
  'repo-guide.md', 'token-security.html',
].map((f) => DIR + f);

const row = (f) => `[data-vsc-path="${DIR}${f}"]`;
const I = '#instrukcje-';

/** Tick one line of the first-day checklist: cursor clicks it, the line and the counter repaint. */
const tick = (i) => [
  { type: 'click', target: `${I}check-${i}` },
  { type: 'show', mock: 'instrukcje-check', target: `${I}check-${i}`, mode: 'outer', props: { i, done: true } },
  { type: 'show', mock: 'instrukcje-check-count', target: `${I}check-count`, mode: 'outer', props: { done: i + 1 } },
];

/** The first lines of repo-guide.md, verbatim. */
const PRZEWODNIK = [
  '# A guide to the repository - for people',
  '',
  'This document is the one place that explains what this repository is, how it is built and how',
  'work happens in it. It retells in plain language what the files written for agents',
  '(`CLAUDE.md`, `modules-template/README.md`, the agent and skill briefs) say for the machine.',
  '',
  '## 1. What it is',
  '',
  '**Mission Deck** is a light, local cockpit for a product team. It runs on your computer at',
  '`http://localhost:3001`, not in the cloud.',
  '',
  'Three sentences that put everything in order:',
  '',
  '1. **The core is shared and stable.**',
  '2. **The team\'s work goes into modules.**',
  '3. **The team\'s data lives separately and is encrypted.**',
  '',
].join('\n');

/** The first lines of module-anatomy.md, verbatim. */
const ANATOMIA = [
  '# Anatomy of a module - a guide for people',
  '',
  'This document explains, in plain words, what a module is in Mission Deck. No jargon, no rulebook.',
  'You do not need to remember it - come back when you lose the thread.',
  '',
  '## What a module is',
  '',
  'A module is **your own piece of the application**. You add it from the side and the core stays',
  'untouched. You get your own page in the left menu, your own screen and, if you want, your own data.',
  '',
  '## The four parts of a module - and when you touch them',
  '',
  '| Part | What it does |',
  '|---|---|',
  '| `module.json` | **The label.** Name, business area, icon, drawer in the menu. |',
  '| `client/index.js` | **What you see.** The code that draws your screen. |',
  '| `server/index.js` | **What you do not see.** Calculations, saving, external systems. |',
  '| `tests/` | **Quality control.** `/new-idea` writes the tests itself. |',
  '',
].join('\n');

export default {
  steps: [
    {
      id: 'instrukcje-katalog',
      caption: 'Before I run anything, I look into **docs/guides** — all the instructions live here.',
      mascot: 'wave',
      camera: 'full',
      actions: [
        narrate('Instructions in the repository', 'The Mission Deck package has a docs/guides folder: step-by-step installation, a getting-started guide, a Windows version, a repository guide, the anatomy of a module and a prototypes guide. All in plain English, for people, not for agents.'),
        { type: 'surface', show: 'vscode' },
        { type: 'explorer', add: DOCS },
        { type: 'camera', target: '#demo-vsc-tree', zoom: 1.35 },
        { type: 'hover', target: row('INSTALL.html'), ms: 700 },
        { type: 'hover', target: row('ONBOARDING.md'), ms: 700 },
      ],
    },
    {
      id: 'instrukcje-instalacja',
      caption: 'I open the **installation guide** — step 0 is the software: VS Code, Chrome, Node 24, Git and Python.',
      mascot: 'thinking',
      actions: [
        narrate('How to run Mission Deck step by step', 'INSTALL.html opens in the browser. Nine numbered steps, a quarter of an hour. Step 0: install the software once — on macOS with Homebrew, on Windows with winget.'),
        { type: 'click', target: row('INSTALL.html') },
        { type: 'camera', full: true },
        { type: 'surface', show: 'screen', mock: 'instrukcje-install' },
        { type: 'camera', target: I + 'inst-hero', zoom: 1.3 },
        { type: 'wait', ms: 700 },
        { type: 'camera', full: true },
        { type: 'hover', target: I + 'inst-before', ms: 700 },
        { type: 'scroll', target: I + 'inst-step-0' },
        { type: 'camera', target: I + 'inst-step-0', zoom: 1.25 },
        { type: 'hover', target: I + 'inst-cmds-0' },
      ],
    },
    {
      id: 'instrukcje-uruchomienie',
      caption: 'I unpack **outside OneDrive**, then npm install, npm run setup and npm start.',
      mascot: 'working',
      actions: [
        narrate('Steps 1-5', 'The ZIP lands outside OneDrive and iCloud, because the app creates lots of files. You open the folder in VS Code and type npm install, npm run setup and npm start in the terminal — Chrome opens by itself. You do not touch the .env file: the wizard sets up the rest.'),
        { type: 'camera', full: true },
        { type: 'scroll', target: I + 'inst-step-1' },
        { type: 'camera', target: I + 'inst-step-1', zoom: 1.3 },
        { type: 'hover', target: I + 'inst-cloud', ms: 800 },
        { type: 'camera', full: true },
        { type: 'scroll', target: I + 'inst-step-4' },
        { type: 'camera', target: I + 'inst-step-4', zoom: 1.3 },
        { type: 'hover', target: I + 'inst-cmds-4', ms: 900 },
        { type: 'camera', full: true },
        { type: 'scroll', target: I + 'inst-step-5' },
        { type: 'camera', target: I + 'inst-step-5', zoom: 1.3 },
        { type: 'hover', target: I + 'inst-cmds-5', ms: 700 },
      ],
    },
    {
      id: 'instrukcje-kreator',
      caption: 'After the start a **wizard** guides me: the vault, keys, team data — and I sign in to the Bitwarden CLI once.',
      mascot: 'idle',
      actions: [
        narrate('Steps 6-8', 'On the first run Mission Deck opens the wizard by itself: environment, vault, repository access, encryption key, team data, update and training. You install the Bitwarden CLI and sign in once; after that only Claude Code is left.'),
        { type: 'camera', full: true },
        { type: 'scroll', target: I + 'inst-step-6' },
        { type: 'camera', target: I + 'inst-wizard', zoom: 1.35 },
        { type: 'wait', ms: 900 },
        { type: 'camera', full: true },
        { type: 'scroll', target: I + 'inst-step-7' },
        { type: 'camera', target: I + 'inst-step-7', zoom: 1.3 },
        { type: 'hover', target: I + 'inst-cmds-7', ms: 900 },
        { type: 'camera', full: true },
        { type: 'scroll', target: I + 'inst-done' },
        { type: 'camera', target: I + 'inst-done', zoom: 1.3 },
      ],
    },
    {
      id: 'instrukcje-checklista',
      caption: 'In **ONBOARDING.md** I tick off the first-day checklist — from the starter package to the wizard.',
      mascot: 'working',
      actions: [
        narrate('The first-day checklist', 'ONBOARDING.md is the getting-started guide in short. The checklist goes in order: the package from SharePoint unpacked outside OneDrive and iCloud, npm install, npm run setup, a one-time Bitwarden CLI sign-in, npm start, the VPN and the “Start here” wizard. Nobody edits the .env file — the tokens are in the COCKPIT-KEYS note in the vault, and the encryption keys arrive in a Bitwarden Send.'),
        { type: 'camera', full: true },
        { type: 'surface', show: 'screen', mock: 'instrukcje-onboarding' },
        { type: 'scroll', target: I + 'checklist' },
        { type: 'camera', target: I + 'checklist', zoom: 1.35 },
        ...CHECKLIST.map((_, i) => i).flatMap(tick),
        { type: 'wait', ms: 500 },
        { type: 'camera', full: true },
        { type: 'scroll', target: I + 'tokens' },
        { type: 'camera', target: I + 'tokens', zoom: 1.3 },
      ],
    },
    {
      id: 'instrukcje-skille',
      caption: 'I look at the **Which skill to use** table: a new idea is /new-idea, an issue is /jira.',
      mascot: 'working',
      actions: [
        narrate('Which skill to use', 'One table answers the question “where do I start”: a view or a fix is /new-idea, a review before a commit is /pre-ship-audit, Jira and Confluence have their own skills, and documents are made from templates in user-data.'),
        { type: 'camera', full: true },
        { type: 'scroll', target: I + 'skills' },
        { type: 'camera', target: I + 'skills', zoom: 1.3 },
        { type: 'hover', target: I + 'skill-0', ms: 900 },
        { type: 'hover', target: I + 'skill-6', ms: 900 },
        { type: 'camera', full: true },
        { type: 'scroll', target: I + 'terms' },
        { type: 'camera', target: I + 'terms', zoom: 1.3 },
      ],
    },
    {
      id: 'instrukcje-pulapki',
      caption: 'I reveal the **five traps**: working on main, restarts, git reset, non-ASCII in code and DS classes.',
      mascot: 'error',
      actions: [
        narrate('Five traps', 'These five things trip everyone up at first: implementing on main, restarting the server any way other than the API, a hard reset of the repository (blocked), non-ASCII characters in code and a button without the ds-btn class. Better to read them once than to lose an afternoon.'),
        { type: 'camera', full: true },
        { type: 'scroll', target: I + 'h-pits' },
        ...[0, 1, 2, 3, 4].flatMap((i) => [
          { type: 'hide', target: `${I}pit-${i}`, hidden: false },
          { type: 'wait', ms: 450 },
        ]),
        { type: 'scroll', target: I + 'pits' },
        { type: 'camera', target: I + 'pits', zoom: 1.25 },
        { type: 'hover', target: I + 'pit-1', ms: 900 },
        { type: 'camera', full: true },
        { type: 'scroll', target: I + 'next' },
        { type: 'hover', target: I + 'next', ms: 700 },
      ],
    },
    {
      id: 'instrukcje-szkolenie',
      caption: 'A look ahead: in the **Academy** one button opens the guide straight in VS Code.',
      mascot: 'success',
      actions: [
        narrate('Instructions in Mission Deck', 'After installation you do not have to look for them: the Academy step “Read the repository guide” opens repo-guide.md in VS Code, and in Stage 3 the step “Anatomy of a module” opens module-anatomy.md in a Mission Deck window — here I peek at it in VS Code. WINDOWS.md and prototypes.md sit next to them.'),
        { type: 'camera', full: true },
        { type: 'surface', show: 'cockpit' },
        { type: 'show', mock: 'szkolenie-root', target: '#academy-root' },
        { type: 'navigate', view: 'academy' },
        { type: 'scroll', target: '#dm-szkolenie-step-etap-1-step-3' },
        { type: 'camera', target: '#dm-szkolenie-step-etap-1-step-3', zoom: 1.25 },
        { type: 'click', target: '#dm-szkolenie-step-etap-1-step-3 .tc-open-vscode-btn' },
        { type: 'camera', full: true },
        { type: 'surface', show: 'vscode' },
        { type: 'editor', file: DIR + 'repo-guide.md', text: PRZEWODNIK, mode: 'replace' },
        { type: 'wait', ms: 600 },
        { type: 'editor', file: DIR + 'module-anatomy.md', text: ANATOMIA, mode: 'replace' },
        { type: 'hover', target: row('prototypes.md'), ms: 600 },
        { type: 'hover', target: row('WINDOWS.md'), ms: 600 },
      ],
    },
  ],
};
