// demo/scenario.mjs
// The whole presentation as DATA: chapters (CHAPTER_ORDER) -> steps -> typed actions
// (see ACTION_TYPES in demo/scenario-schema.mjs for every field). The engine
// replays it; tests/test_demo_scenario.mjs validates it. Every person, account
// and address here is fictitious.
//
// A chapter starts from a clean shell: `setup` runs silently on every replay,
// so a chapter never depends on what an earlier chapter painted.

import { CHAPTER_BODIES } from './chapters/index.mjs';
import { VAULT_OPEN } from './chapters/_helpers.mjs';
import { CHAPTERS } from './chapter-cards.mjs';
import { CHAPTER_ORDER } from './scenario-schema.mjs';
import { NPM_START, NPM_INSTALL, UNZIP_STARTER } from './mocks/terminal-transcripts.mjs';

/** Module pages a navigate may reach through a hub flyout (none yet in Phase A). */
const PAGES = [];


const CHAPTER_TITLES = Object.fromEntries(Object.entries(CHAPTERS).map(([id, c]) => [id, c.title]));

/** Spread into a chapter: its title-card fields. */
const card = (id) => ({ id, title: CHAPTERS[id].title, subtitle: CHAPTERS[id].subtitle, mascot: CHAPTERS[id].mascot });

const narrate = (title, body, command) => (command ? { type: 'narrate', title, body, command } : { type: 'narrate', title, body });

// ── Chapter: start ──────────────────────────────────────────────────
// Nobody clones: the starter zip (a `git archive`, no .git) is published in the
// team's document library. Download, unpack OUTSIDE OneDrive / iCloud, open in
// VS Code, npm install, npm start. The app adopts the folder as its repository
// on the first request holding the COCKPIT-APP token (git init + one
// fetch, no checkout) - see CLAUDE.md "App repository and update".
const START = (() => {
  const S = '#dm-start-';
  /** The tracked top level of the starter, as unpacked (no data/, modules/, node_modules/ yet). */
  const STARTER_TREE = [
    '.claude/', 'assets/', 'css/', 'docs/', 'js/', 'plans/', 'scripts/', 'templates/', 'tests/', 'vendor/',
    '.env.example', 'CLAUDE.md', 'README.md', 'index.html', 'package.json', 'server.js', 'styles.css',
  ];
  return {
    ...card('start'),
    steps: [
      {
        id: 'start-pobierz',
        caption: 'I download the **mission-deck-starter.zip** package from the team’s document library.',
        mascot: 'working',
        camera: 'full',
        actions: [
          narrate('The starter package from the team library', 'I need neither git clone nor my own git access. The team publishes the starter package on SharePoint: the “Mission Deck Team” site, Documents › Mission Deck. I select the file and click “Download”.'),
          { type: 'surface', show: 'screen', mock: 'start-library' },
          { type: 'hover', target: S + 'row-zip', ms: 600 },
          { type: 'click', target: S + 'row-zip' },
          { type: 'show', mock: 'start-library-row', target: S + 'row-zip', mode: 'outer', props: { selected: true } },
          { type: 'show', mock: 'start-library-actions', target: S + 'actions', mode: 'outer', props: { selected: true } },
          { type: 'click', target: S + 'download' },
          { type: 'show', mock: 'start-library-downloads', target: S + 'dl', mode: 'outer', props: { state: 'progress' } },
          { type: 'progress', bar: S + 'dl-bar', pct: 45 },
          { type: 'wait', ms: 400 },
          { type: 'progress', bar: S + 'dl-bar', pct: 100 },
          { type: 'wait', ms: 300 },
          { type: 'show', mock: 'start-library-downloads', target: S + 'dl', mode: 'outer', props: { state: 'done' } },
          { type: 'camera', target: S + 'dl', zoom: 1.4 },
          { type: 'wait', ms: 700 },
        ],
      },
      {
        id: 'start-rozpakuj',
        caption: 'I unpack the ZIP onto a **local disk** in ~/Projects — outside OneDrive and iCloud.',
        mascot: 'working',
        camera: 'full',
        actions: [
          narrate('Unpacking outside the cloud', 'The package goes into a plain ~/Projects folder, not OneDrive, iCloud Drive or a synced Desktop or Documents. Syncing locks and duplicates files, node_modules is thousands of files, and decrypted team data should not travel to the cloud.', 'unzip ~/Downloads/mission-deck-starter.zip'),
          { type: 'surface', show: 'vscode' },
          { type: 'explorer', empty: true },
          { type: 'camera', target: '#demo-vsc-terminal', zoom: 1.4 },
          { type: 'terminal', lines: UNZIP_STARTER },
          { type: 'camera', full: true },
          { type: 'toast', variant: 'warning', title: 'Outside OneDrive and iCloud', desc: 'A cloud-synced folder locks and duplicates files — unpack onto a local disk.' },
          { type: 'wait', ms: 900 },
        ],
      },
      {
        id: 'start-folder',
        caption: 'I open the **mission-deck** folder in VS Code — the whole project, no cloning.',
        mascot: 'idle',
        actions: [
          narrate('The folder in VS Code', 'File › Open Folder… and I point at ~/Projects/mission-deck. The package has no git history and does not need one: once I unlock the vault with the COCKPIT-APP token in the wizard, Mission Deck connects the folder to the app repository by itself, without overwriting files, and from then on pulls updates from it.'),
          { type: 'explorer', add: STARTER_TREE },
          { type: 'camera', target: '#demo-vsc-tree', zoom: 1.35 },
          { type: 'hover', target: '[data-vsc-path="README.md"]', ms: 600 },
          { type: 'hover', target: '[data-vsc-path="package.json"]', ms: 600 },
        ],
      },
      {
        id: 'start-instalacja',
        caption: 'I install the **dependencies** — it takes only a few seconds.',
        mascot: 'working',
        camera: { target: '#demo-vsc-terminal', zoom: 1.4 },
        actions: [
          narrate('Installing dependencies', 'In the VS Code terminal, in the ~/Projects/mission-deck folder, one command installs what the server needs. The app has no database and no heavy framework — that is why it takes a few seconds.', 'npm install'),
          { type: 'terminal', lines: NPM_INSTALL },
          { type: 'explorer', add: ['node_modules/'] },
        ],
      },
      {
        id: 'start-serwer',
        caption: 'I start the **server** — in a moment it prints the Mission Deck address.',
        mascot: 'working',
        actions: [
          narrate('Starting the server', 'I type npm start in the same terminal. The server prints the address Mission Deck runs on; a fresh package has no modules yet — they will come from the catalog.', 'npm start'),
          { type: 'terminal', lines: NPM_START },
        ],
      },
      {
        id: 'start-dashboard',
        caption: 'I open **Mission Deck** in the browser — here is the starting point.',
        mascot: 'success',
        camera: 'full',
        actions: [
          narrate('Mission Deck in the browser', 'At localhost:3001 Mission Deck opens: the rail with hubs on the left, the top bar with the vault, sync and the terminal, and the starting point in the middle.'),
          { type: 'surface', show: 'cockpit' },
          { type: 'navigate', view: 'dashboard' },
          { type: 'hover', target: '#dashboard-cards .placeholder-hub-card' },
        ],
      },
    ],
  };
})();

// ── Chapter 2: onboarding (the "Start here" wizard) ────────────────────
// Two full-screen mocks run inside this chapter (demo/mocks/onboarding.mjs):
// the neutral VPN client and the vault app where the key items are entered.
const ONBOARDING = (() => {
  /** The success toast from the previous step hides as the next step starts. */
  const onbHideToast = { type: 'hide', target: '#onb-bwv-toast' };
  // The collection the maintainer prepared and shared: named after the person
  // (first-last), ONE secure note COCKPIT-KEYS inside, its notes field one
  // KEY=VALUE line per token - the server's multi-key format (demo/mocks/onboarding.mjs).
  const ONB_COLLECTION = 'alex-morgan';
  const ONB_KEYS_NOTE = 'COCKPIT-KEYS';
  const ONB_START_LINES = [
    'COCKPIT_APP_TOKEN=glpat-DEMO••••••',
    'COCKPIT_DATA_TOKEN=glpat-DEMO••••••',
    'COCKPIT_MODULES_TOKEN=glpat-DEMO••••••',
    'COCKPIT_DATA_EXTRA_0_TOKEN=glpat-DEMO••••••',
    'COCKPIT_DATA_EXTRA_1_TOKEN=glpat-DEMO••••••',
    'COCKPIT_DATA_EXTRA_4_TOKEN=glpat-DEMO••••••',
  ];
  const ONB_PERSONAL_LINES = ['FIGMA_TOKEN=figd_DEMO••••••', 'JIRA_TOKEN=DEMO-jira••••••', 'CONFLUENCE_TOKEN=DEMO••••••'];
  /** Tokens loaded on unlock: one per line of COCKPIT-KEYS (six starters + three personal). */
  const ONB_LOADED = ONB_START_LINES.length + ONB_PERSONAL_LINES.length;
  /** The encryption key lines Alex got from the maintainer in a one-time Send. */
  const ONB_KEY_LINES = 'ds-data=DEMO…\ndata-reports=DEMO…\ndata-finance=DEMO…';
  const ONB_SEND = 'Encryption keys for Alex';

  return {
    ...card('onboarding'),
    setup: [
      { type: 'show', mock: 'onboarding-wizard', target: '#onboarding-wizard-root' },
    ],
    steps: [
      {
        id: 'onb-otworz',
        caption: 'I go into **Start here** — the wizard walks me through seven steps.',
        mascot: 'wave',
        camera: { target: '#sidebar .sidebar-item--start', zoom: 1.6 },
        actions: [
          narrate('Start here', 'The “Start here” item on the rail opens a seven-step wizard. Each step checks on its own whether it is already done — the order is a hint, not a rule.'),
          { type: 'navigate', view: 'onboarding-wizard' },
          { type: 'camera', full: true },
        ],
      },
      {
        id: 'onb-srodowisko',
        caption: 'I check the **tools** — they are all in place.',
        mascot: 'idle',
        camera: 'full',
        actions: [
          narrate('Step 1 — Environment', 'The wizard checks the tools Mission Deck cannot run without: Node.js, npm, git, the Bitwarden CLI and the Claude Code CLI. They are all in place.'),
          { type: 'click', target: '#obw-tools-refresh-btn' },
          { type: 'badge', target: '#obw-step1-chip', tone: 'blue', text: 'Checking…' },
          { type: 'camera', target: '#obw-step1-card', zoom: 1.3 },
          { type: 'wait', ms: 500 },
          { type: 'show', mock: 'obw-tools-rows', target: '#obw-tools-list', props: { ok: true } },
          { type: 'badge', target: '#obw-step1-chip', tone: 'green', text: 'Done' },
          { type: 'wait', ms: 400 },
          { type: 'camera', full: true },
        ],
      },
      {
        id: 'onb-vpn-brak',
        caption: 'Without the **VPN**, GitLab and the team data are out of reach — I click the VPN client icon.',
        mascot: 'error',
        camera: 'full',
        actions: [
          narrate('VPN first', 'GitLab and the team data repositories answer only on the company network. The VPN client sits in the macOS menu bar: a grey globe means “Not Connected”. I click it and enter the company portal address.'),
          { type: 'surface', show: 'screen', mock: 'vpn-client-screen', props: { stage: 'menubar' } },
          { type: 'camera', target: '#onb-vpn-tray', zoom: 2.2 },
          { type: 'hover', target: '#onb-vpn-tray', ms: 900 },
          { type: 'click', target: '#onb-vpn-tray' },
          { type: 'show', mock: 'vpn-client-screen', target: '#onb-vpn-screen', mode: 'outer' },
          { type: 'camera', target: '#onb-vpn-card', zoom: 1.4 },
          { type: 'type', target: '#onb-vpn-portal', text: 'vpn.example.com' },
        ],
      },
      {
        id: 'onb-vpn-laczenie',
        caption: 'I click **Connect** and sign in with my work account in the VPN Login window.',
        mascot: 'working',
        actions: [
          narrate('Signing in to the VPN', 'After “Connect” the VPN client opens a small “VPN Login” window with the company single sign-on. The account in the demo is fictitious; after signing in the window disappears and the panel shows “Connecting...”.'),
          { type: 'click', target: '#onb-vpn-connect' },
          { type: 'show', mock: 'vpn-client-screen', target: '#onb-vpn-screen', mode: 'outer', props: { state: 'connecting', sso: true } },
          { type: 'camera', target: '#onb-vpn-sso', zoom: 1.25 },
          { type: 'type', target: '#onb-vpn-sso-email', text: 'alex.morgan@example.com' },
          { type: 'type', target: '#onb-vpn-sso-password', text: 'demo-password', mask: true },
          { type: 'click', target: '#onb-vpn-sso-submit' },
          { type: 'show', mock: 'vpn-client-screen', target: '#onb-vpn-screen', mode: 'outer', props: { state: 'connecting' } },
          { type: 'camera', target: '#onb-vpn-card', zoom: 1.4 },
          { type: 'progress', bar: '#onb-vpn-bar', pct: 35 },
          { type: 'wait', ms: 300 },
          { type: 'progress', bar: '#onb-vpn-bar', pct: 70 },
          { type: 'wait', ms: 300 },
          { type: 'progress', bar: '#onb-vpn-bar', pct: 100 },
        ],
      },
      {
        id: 'onb-vpn-polaczono',
        caption: '**Connected** — a shield in the menu bar, GitLab and the data repositories are within reach.',
        mascot: 'success',
        actions: [
          narrate('VPN connected', 'The panel says “Connected”, and in the menu bar the globe turns into a shield. Mission Deck reaches GitLab and the data repositories. The next stop is the vault with the keys.'),
          { type: 'show', mock: 'vpn-client-screen', target: '#onb-vpn-screen', mode: 'outer', props: { state: 'connected' } },
          { type: 'camera', target: '#onb-vpn-card', zoom: 1.4 },
          { type: 'wait', ms: 700 },
          { type: 'show', mock: 'vpn-client-screen', target: '#onb-vpn-screen', mode: 'outer', props: { state: 'connected', stage: 'menubar' } },
          { type: 'camera', target: '#onb-vpn-tray', zoom: 2.2 },
          { type: 'hover', target: '#onb-vpn-tray', ms: 900 },
          { type: 'camera', full: true },
        ],
      },
      {
        id: 'onb-sejf-logowanie',
        caption: 'Back to the wizard: step 2 is the **Bitwarden vault**. I sign in to the vault app.',
        mascot: 'idle',
        actions: [
          narrate('Step 2 — Bitwarden', 'All the access keys live in the company vault. Signing in has two pages, as in the real Bitwarden: first the email address and “Continue”, then the master password. The address, account and password in the demo are fictitious.'),
          { type: 'surface', show: 'cockpit' },
          { type: 'scroll', target: '#obw-step2-card' },
          { type: 'camera', target: '#obw-step2-card', zoom: 1.25 },
          { type: 'wait', ms: 500 },
          { type: 'camera', full: true },
          { type: 'surface', show: 'screen', mock: 'bitwarden-vault-screen' },
          { type: 'camera', target: '#onb-bwv-login-card', zoom: 1.3 },
          { type: 'type', target: '#onb-bwv-email', text: 'alex.morgan@example.com' },
          { type: 'click', target: '#onb-bwv-continue' },
          { type: 'show', mock: 'bitwarden-vault-screen', target: '#onb-bwv-screen', mode: 'outer', props: { step: 'password' } },
          { type: 'camera', target: '#onb-bwv-login-card', zoom: 1.3 },
          { type: 'type', target: '#onb-bwv-master', text: 'demo-only-password', mask: true },
          { type: 'click', target: '#onb-bwv-login' },
          { type: 'camera', full: true },
          { type: 'show', mock: 'bitwarden-vault-screen', target: '#onb-bwv-screen', mode: 'outer', props: { view: 'vault' } },
        ],
      },
      {
        id: 'onb-sejf-kolekcja',
        caption: 'I have access to a collection with my name — **alex-morgan**.',
        mascot: 'thinking',
        actions: [
          narrate('A collection with my name', 'Nobody creates their collection alone. The Mission Deck maintainer prepares one for each person, names it first-last and shares it. Inside there is one secure note, COCKPIT-KEYS: the starter tokens, one per line as KEY=value.'),
          { type: 'hover', target: '#onb-bwv-coll' },
          { type: 'click', target: '#onb-bwv-coll' },
          { type: 'show', mock: 'bitwarden-vault-screen', target: '#onb-bwv-screen', mode: 'outer', props: { view: 'vault', collection: true, items: [ONB_KEYS_NOTE] } },
          { type: 'camera', target: '#onb-bwv-screen .onb-window', zoom: 1.15 },
        ],
      },
      {
        id: 'onb-sejf-cockpit-keys',
        caption: 'I open the **COCKPIT-KEYS** note — the starter tokens are already there.',
        mascot: 'thinking',
        actions: [
          narrate('The COCKPIT-KEYS note', 'One note, many keys: each line is a key name, an equals sign and a value. When the vault is unlocked, Mission Deck reads them all at once. The values in the demo are obvious dummies.'),
          { type: 'click', target: '[data-onb-item="' + ONB_KEYS_NOTE + '"] .onb-bwv-row-name' },
          { type: 'show', mock: 'onb-bwv-view', target: '#onb-bwv-detail', props: { name: ONB_KEYS_NOTE, lines: ONB_START_LINES } },
          { type: 'camera', target: '#onb-bwv-view', zoom: 1.15 },
          { type: 'wait', ms: 700 },
        ],
      },
      {
        id: 'onb-sejf-dopisz',
        caption: 'I add my own tokens: **Figma**, **Jira**, **Confluence** — a line for each.',
        mascot: 'working',
        actions: [
          narrate('My own tokens', 'I click “Edit” and add three of my own below the maintainer’s lines: FIGMA_TOKEN, JIRA_TOKEN and CONFLUENCE_TOKEN. No new items — everything in the same note.'),
          { type: 'click', target: '#onb-bwv-edit' },
          { type: 'show', mock: 'onb-bwv-form', target: '#onb-bwv-detail', props: { kind: 'note', name: ONB_KEYS_NOTE, lines: ONB_START_LINES } },
          { type: 'camera', target: '#onb-bwv-form', zoom: 1.1 },
          { type: 'type', target: '#onb-bwv-note', text: ONB_PERSONAL_LINES.join('\n') },
          { type: 'click', target: '#onb-bwv-save' },
          { type: 'camera', full: true },
          { type: 'show', mock: 'onb-bwv-saved', target: '#onb-bwv-detail', props: { name: ONB_KEYS_NOTE } },
        ],
      },
      {
        id: 'onb-bitwarden-okno',
        caption: 'I go back to Mission Deck and open the **Bitwarden** window.',
        mascot: 'wave',
        actions: [
          onbHideToast,
          narrate('Back in the wizard', 'The vault is ready. In step 2 of the wizard the “Open Bitwarden” button opens the unlock window — Mission Deck never writes the keys to disk, it keeps them only in the server’s memory.'),
          { type: 'camera', full: true },
          { type: 'surface', show: 'cockpit' },
          { type: 'scroll', target: '#obw-step2-card' },
          { type: 'click', target: '#obw-bw-open-btn' },
          { type: 'modal', open: 'bw-unlock-modal' },
          { type: 'camera', target: '#demo-bw-modal .ds-modal', zoom: 1.35 },
        ],
      },
      {
        id: 'onb-bitwarden-haslo',
        caption: 'I enter my collection and password, then **unlock** the vault.',
        mascot: 'idle',
        actions: [
          narrate('Unlocking the vault', 'In the “Bitwarden collection” field I enter the name of my collection, then the master password. The password is used once, to fetch the tokens: six starter ones and three of mine. The “Bitwarden” pill on the top bar turns green.'),
          { type: 'type', target: '#demo-bw-collection', text: ONB_COLLECTION },
          { type: 'type', target: '#demo-bw-password', text: 'demo-only-password', mask: true },
          { type: 'click', target: '#demo-bw-unlock-btn' },
          { type: 'modal', close: '#demo-bw-modal' },
          { type: 'camera', full: true },
          { type: 'toast', variant: 'success', title: 'Vault unlocked', desc: 'Tokens loaded into the server’s memory: ' + ONB_LOADED + ' from collection “' + ONB_COLLECTION + '”.' },
          { type: 'camera', target: '#topbar-bw-root', zoom: 1.8 },
          { type: 'show', mock: 'topbar-bw', target: '#topbar-bw-root', props: { unlocked: true } },
          { type: 'wait', ms: 500 },
          { type: 'camera', full: true },
          { type: 'show', mock: 'obw-bw-status', target: '#obw-bw-status', mode: 'outer', props: { unlocked: true } },
          { type: 'badge', target: '#obw-step2-chip', tone: 'green', text: 'Done' },
        ],
      },
      {
        id: 'onb-repozytorium',
        caption: 'I check the app repository **token** — it is already in the vault.',
        mascot: 'thinking',
        actions: [
          narrate('Step 3 — Access to the app repository', 'From the open vault Mission Deck takes the COCKPIT-APP token for its own repository — that is where it pulls updates from. COCKPIT-DATA gives access to the team data.'),
          { type: 'scroll', target: '#obw-step3-card' },
          { type: 'click', target: '#obw-tokens-refresh-btn' },
          { type: 'show', mock: 'obw-token-rows', target: '#obw-tokens-list', props: { loaded: true } },
          { type: 'show', mock: 'obw-data-token-row', target: '#obw-data-token-list', props: { loaded: true } },
          { type: 'badge', target: '#obw-step3-chip', tone: 'green', text: 'Done' },
        ],
      },
      {
        id: 'onb-klucze-wklej',
        caption: 'I paste the **encryption keys** the maintainer sent me in a Send.',
        mascot: 'working',
        actions: [
          narrate('Step 4 — Encryption keys', 'The encryption keys are not in the collection: the maintainer sent them to me separately, with a one-time Bitwarden Send link. I open the link, copy the lines and paste them into the wizard, one per row.'),
          { type: 'surface', show: 'screen', mock: 'bitwarden-send-view', props: { name: ONB_SEND, text: ONB_KEY_LINES, revealed: true } },
          { type: 'camera', target: '#onb-bwv-sv-card', zoom: 1.2 },
          { type: 'click', target: '#onb-bwv-sv-copy' },
          { type: 'camera', full: true },
          { type: 'surface', show: 'cockpit' },
          { type: 'scroll', target: '#obw-step4-card' },
          { type: 'camera', target: '#obw-step4-card', zoom: 1.25 },
          { type: 'type', target: '#obw-key-textarea', text: ONB_KEY_LINES },
          { type: 'click', target: '#obw-key-save-btn' },
          { type: 'show', mock: 'obw-key-rows', target: '#obw-key-state', props: { present: ['ds-data', 'data-reports', 'data-finance'] } },
          { type: 'camera', full: true },
          { type: 'toast', variant: 'success', title: 'Keys saved', desc: 'Three sources now have their key.' },
        ],
      },
      {
        id: 'onb-klucze-nowy',
        caption: 'I create a **new key** for an empty source.',
        mascot: 'celebrating',
        actions: [
          narrate('A new, empty source', 'For a brand-new source we create the key ourselves. The window warns that this is only for an empty source — the key goes into a file on this computer and we pass it on to the people with access.'),
          { type: 'click', target: '[data-obw-gen-key="data-new"]' },
          { type: 'modal', open: 'obw-genkey-modal' },
          { type: 'click', target: '#demo-genkey-ok' },
          { type: 'modal', close: '#demo-genkey-modal' },
          { type: 'toast', variant: 'success', title: 'Key generated and saved.' },
          { type: 'show', mock: 'obw-key-rows', target: '#obw-key-state', props: { present: ['ds-data', 'data-reports', 'data-finance', 'data-new'] } },
          { type: 'badge', target: '#obw-step4-chip', tone: 'green', text: 'Done' },
          { type: 'show', mock: 'obw-data-state', target: '#obw-data-state', mode: 'outer', props: { ready: true } },
        ],
      },
      {
        id: 'onb-dane',
        caption: 'I download and decrypt the **team data**.',
        mascot: 'working',
        camera: 'full',
        actions: [
          narrate('Step 5 — Team data', 'Mission Deck clones the encrypted data repository and decrypts it locally. The log window shows every stage in turn.'),
          { type: 'scroll', target: '#obw-step5-card' },
          { type: 'click', target: '#obw-data-clone-btn' },
          { type: 'badge', target: '#obw-step5-chip', tone: 'blue', text: 'Downloading…' },
          { type: 'show', mock: 'text', target: '#slm-title', props: { text: 'Downloading team data' } },
          { type: 'hide', target: '#slm-spinner', hidden: false },
          { type: 'modal', openEl: '#sync-log-modal' },
          { type: 'camera', target: '#sync-log-modal .ds-modal', zoom: 1.3 },
          {
            type: 'progress',
            target: '#slm-log',
            lines: [
              { time: '09:14:02', step: 'Checking the data repository token', status: 'ok' },
              { time: '09:14:05', step: 'Cloning the repository', detail: 'ds-data-encrypted', status: 'ok' },
              { time: '09:14:11', step: 'Decrypting files', detail: '412 files', status: 'ok' },
              { time: '09:14:12', step: 'Consistency check', status: 'ok' },
            ],
          },
          { type: 'hide', target: '#slm-spinner' },
          { type: 'show', mock: 'slm-banner-ok', target: '#slm-banner' },
        ],
      },
      {
        id: 'onb-dane-gotowe',
        caption: 'I close the log — the **data** is on disk.',
        mascot: 'working',
        actions: [
          narrate('Data in place', 'Once the window closes, the step 5 card shows the repository as ready. Decrypted files never leave this computer in plaintext.'),
          { type: 'click', target: '#slm-close' },
          { type: 'modal', close: '#sync-log-modal' },
          { type: 'camera', full: true },
          { type: 'show', mock: 'obw-data-state', target: '#obw-data-state', mode: 'outer', props: { done: true } },
          { type: 'badge', target: '#obw-step5-chip', tone: 'green', text: 'Done' },
          { type: 'toast', variant: 'success', title: 'Team data downloaded', desc: 'Repository ready on the main branch.' },
        ],
      },
      {
        id: 'onb-koniec',
        caption: 'Mission Deck is **ready** — time for the training!',
        mascot: 'success',
        actions: [
          narrate('Steps 6 and 7 — update and training', 'We check that Mission Deck is up to date, and the wizard unlocks the last step: going to the “Academy” training.'),
          { type: 'scroll', target: '#obw-step6-card' },
          { type: 'click', target: '#obw-update-check-btn' },
          { type: 'show', mock: 'obw-update-result', target: '#obw-update-result', mode: 'outer' },
          { type: 'badge', target: '#obw-step6-chip', tone: 'green', text: 'Done' },
          { type: 'show', mock: 'obw-step7-done', target: '#obw-step7-body' },
          { type: 'badge', target: '#obw-step7-chip', tone: 'green', text: 'Done' },
          { type: 'click', target: '#obw-step7-go' },
        ],
      },
    ],
  };
})();

/** A chapter whose steps are written in a later stage: title card + one narrated step. */
function placeholder(id) {
  return {
    ...card(id),
    steps: [{
      id: id + '-wkrotce',
      caption: 'I am still **preparing** this chapter — I will show it soon.',
      mascot: CHAPTERS[id].pose,
      actions: [
        narrate(CHAPTERS[id].title, 'This chapter of the demo is in preparation. Move on or pick another chapter from the table of contents.'),
        { type: 'surface', show: 'cockpit' },
      ],
    }],
  };
}

/** A chapter written in demo/chapters/<id>.mjs, or the placeholder while it is null. */
function fromBody(id) {
  const body = CHAPTER_BODIES[id];
  if (!body) return placeholder(id);
  // Every chapter after onboarding finds the vault unlocked (_helpers.mjs
  // VAULT_OPEN): put it into the setup here once, so a chapter file that
  // forgets it cannot paint a red "Bitwarden" pill in the top bar.
  const chapter = { ...card(id), steps: body.steps, setup: [VAULT_OPEN, ...(body.setup || [])] };
  return chapter;
}

/** Module pages declared by chapter files, merged after the ones declared here. */
const ALL_PAGES = PAGES.concat(...Object.values(CHAPTER_BODIES).map((b) => (b && b.pages) || []));

const scenario = {
  ending: {
    title: 'Thank you!',
    subtitle: 'This is what working with Mission Deck looks like — from the first start to your own modules.',
    mascot: 'celebrating',
  },
  pages: ALL_PAGES,
  // CHAPTER_ORDER is the one order; start and onboarding are written here, the rest in demo/chapters/.
  chapters: CHAPTER_ORDER.map((id) => (id === 'start' ? START : id === 'onboarding' ? ONBOARDING : fromBody(id))),
};

export default scenario;
export { CHAPTER_TITLES };
