// ── Mission Deck — js/academy-stages.mjs ─────────────────────
// The ONE source of truth for the stages of the "Academy" training path. Read
// both by the client (static import in js/academy.js) and by the server
// (lazy await import() with pathToFileURL in server.js, section
// "// -- Academy --"). ZERO imports, ZERO access to `document` - that is
// what lets the same file run in the browser, in Node and under node --test.
//
// Step shape: { id, title, instruction, check: {type, step}, btnLabel?,
// bullets?, tip?, copyBlock?, copyBlocks?, visual?, visualAlways?,
// openVscode?, guideDoc?, openTab?, author? }. `check.step` ALWAYS equals the
// step `id`. `guideDoc` is {doc, title, label} - `doc` is the SLUG of a file in
// docs/guides/, never a path. `openTab` is {hash, label} - `hash` is a
// route in this app (without '#'), opened in a new browser tab.
//
// Code (id, check.step, visual.kind, openVscode keys) is ASCII. Stage and step
// ids are kept as they are on purpose: progress is keyed on them in each
// person's progress file, so renaming one would reset everybody's progress.

export const STAGES = [
  // ── Stage 1 — Environment ─────────────────────────────────────────────────
  {
    id: 'etap-1',
    title: 'Environment',
    intro: 'Set up your development environment before you start working with Claude Code.',
    steps: [
      {
        id: 'step-1',
        title: 'Set up the terminal in VS Code',
        instruction: 'Open VS Code, go to Settings (Cmd + comma on Mac / Ctrl + comma on Windows and Linux), search for "terminal.integrated.defaultLocation" and set it to "editor". The terminal then opens as a regular tab in the main window instead of a narrow panel at the bottom - more room to work with Claude Code. After the change reload the window (Cmd+Shift+P / Ctrl+Shift+P, then "Developer: Reload Window") and click Check.',
        tip: 'The setting only applies to commands that CREATE a terminal - and Cmd+` / Ctrl+` is a different command: "toggleTerminal" shows and hides the bottom panel and ignores the setting. That is why it looks as if the change did not work. Open a new terminal in an editor tab with Cmd+Shift+` / Ctrl+Shift+` (the "terminal.new" command, which respects the setting) or with the button on the terminal toolbar. Terminals that are already open stay where they were - reloading the window does not move them.',
        check: { type: 'server', step: 'step-1' },
        visual: { kind: 'vscode-terminal', tabs: ['zsh'] },
      },
      {
        id: 'step-2',
        title: 'Install the Claude Code CLI',
        instruction: 'Install Node.js and Claude Code. If your machine is managed by IT, ask them for both programs (and for a Claude license if you do not have one yet). If you can install software yourself, do it without administrator rights (never "sudo npm install -g"): "brew install --cask claude-code" (Mac) or "npm install -g @anthropic-ai/claude-code" (Mac, Windows, Linux). After installing, restart the terminal so PATH is refreshed, then click Check.',
        check: { type: 'server', step: 'step-2' },
        visual: { kind: 'vscode-terminal', tabs: ['claude', 'zsh'] },
      },
      {
        id: 'step-2b',
        title: 'Log in to Claude Code',
        instruction: 'Run "claude" in the terminal and log in with your Anthropic account (or configure an API key). You are the best judge here: if "claude" shows a login screen when it starts, log in with "/login" inside the session or "claude auth login" in the terminal. "claude auth status" prints a "loggedIn" field and the account e-mail, but it only answers whether credentials ARE stored on this machine - they may come from the desktop app or the browser and may already have expired. That is why the server does not verify this step: you confirm it yourself once the CLI no longer asks you to log in.',
        check: { type: 'self-attest', step: 'step-2b' },
        btnLabel: 'Logged in / Done',
      },
      {
        id: 'step-2c',
        title: 'Pick the right AI model',
        instruction: 'The model you pick really affects quality, speed and cost. Switch models during a session with /model, or start the tool with the --model flag. Rule of thumb: Sonnet is enough for MOST work (the default, best balance of quality and speed); pick Haiku for very basic, mechanical tasks (fastest and cheapest); reach for Opus for PLANNING and the hardest tasks (strongest reasoning). Click once the rule makes sense.',
        check: { type: 'self-attest', step: 'step-2c' },
        btnLabel: 'Got it / Done',
        visual: { kind: 'model-picker' },
        visualAlways: true,
      },
      {
        id: 'step-3',
        title: 'Read the repository guide',
        instruction: 'One file that explains this whole repository in plain words: what Mission Deck is made of, where the data lives and why it is encrypted, what a module is, which commands (skills) and roles (agents) you have, and which rules apply to everyone. It is a digest of the files written for agents (CLAUDE.md, the module contract, the agent and skill descriptions) - you do not need to read those to get started; you will come back to CLAUDE.md and README.md in stage 3, before bigger changes to a module. Click the button below and the file opens in VS Code. Click "Got it / Done" once you have read it.',
        check: { type: 'self-attest', step: 'step-3' },
        btnLabel: 'Got it / Done',
        openVscode: [
          { key: 'przewodnik-po-repo', label: 'Open the guide in VS Code' },
        ],
        tip: 'Raw Markdown is hard to read. In VS Code turn on the preview with Cmd+Shift+V (Mac) / Ctrl+Shift+V (Windows and Linux), and Cmd+K, V / Ctrl+K, V (first Cmd+K, then just V) opens it next to the text. The "Open Preview to the Side" icon in the top right corner of the editor does the same, as does right-clicking the file in the Explorer and choosing "Open Preview".',
      },
      {
        id: 'step-4',
        title: 'Turn on auto mode in Claude Code',
        instruction: 'Auto mode lets the agent take the next steps without you confirming every action by hand. QUICK (for the current session): press Shift+Tab - it cycles the approval mode (including auto-accept edits). Each further Shift+Tab moves to the next mode; the current one is shown at the bottom of the terminal ("auto mode on"). PERMANENTLY: start Claude Code with the --permission-mode acceptEdits flag (or set the mode with /permissions). Click once it is configured.',
        check: { type: 'self-attest', step: 'step-4' },
        btnLabel: 'Got it / Done',
        visual: { kind: 'vscode-terminal', tabs: ['claude'], mode: 'auto' },
      },
      {
        id: 'step-5',
        title: 'Try the terminal built into Mission Deck',
        instruction: 'Mission Deck has its own terminal inside the app (the terminal icon in the top bar) - it runs on the same mechanism (pty + WebSocket) as the VS Code terminal. Open it, type any command and check that it answers. Click Check - we will verify that the terminal service is running.',
        check: { type: 'server', step: 'step-5' },
      },
      {
        id: 'step-6',
        title: 'Leave your mark on the Mural',
        instruction: 'Go to the "Mural" tab at the top of this view and write your entry: what you have learned, what you want to build in Mission Deck and what you are curious about. The entry is saved in the team data repository (ds-data) and goes straight to the rest of the team - no branch, no commit, no merge request. Once it is saved, come back here and click Check.',
        check: { type: 'server', step: 'step-6' },
      },
    ],
  },

  // ── Stage 2 — Terminal and CLI ────────────────────────────────────────────
  {
    id: 'etap-2',
    title: 'Terminal and CLI - tricks, shortcuts, setup',
    intro: 'Learn to move around the terminal quickly and set Claude Code up for comfortable work. Practise and confirm every step.',
    steps: [
      {
        id: 'step-1',
        title: 'Turn on Shift+Enter in Claude Code',
        instruction: 'Start with comfortable multi-line prompts. Run the /terminal-setup command to enable Shift+Enter (a new line instead of sending right away). Click when done.',
        check: { type: 'self-attest', step: 'step-1' },
        btnLabel: 'Got it / Done',
      },
      {
        id: 'step-2',
        title: 'Line navigation shortcuts',
        instruction: 'First copy the long text below (the Copy button) and paste it into the terminal - that gives you something to practise on. Then practise the shortcuts (Mac): Cmd+Left/Right (start/end of line), Option+Left/Right (by word), Cmd+Backspace (whole line), Option+Backspace (word). On Windows/Linux the equivalents are: Home/End, Ctrl+Left/Right, Ctrl+U, Ctrl+W. Universal: Ctrl+A / Ctrl+E (start/end), Ctrl+U / Ctrl+K (delete to start/end), Ctrl+W (delete word), Ctrl+R (history), Ctrl+L (clear screen). Click once you have practised.',
        check: { type: 'self-attest', step: 'step-2' },
        btnLabel: 'Practised',
        copyBlock: {
          text: 'Terminal shortcut practice: paste this long line into the terminal and practise navigating it - jump to the start and end of the line (Cmd+arrow on Mac, Home/End on Windows and Linux), move by word (Option+arrow on Mac, Ctrl+arrow on Windows and Linux), delete the whole line (Cmd+Backspace on Mac, Ctrl+U on Windows and Linux), delete a word (Option+Backspace on Mac, Ctrl+W on Windows and Linux), and finally clear the screen with Ctrl+L. Good luck!',
          label: 'Copy practice text',
          toastTitle: 'Text copied',
          toastBody: 'Paste it into the terminal (Cmd+V on Mac, Ctrl+Shift+V on Windows and Linux) and practise the shortcuts on it.',
        },
      },
      {
        id: 'step-3',
        title: 'Full-screen mode (TUI) for Claude Code',
        instruction: 'Get to know the Claude Code full-screen mode - more room for the conversation and previews. Find out how to enter it and when it helps (long sessions, reading diffs). Click once you have tried it.',
        check: { type: 'self-attest', step: 'step-3' },
        btnLabel: 'Tried it',
      },
      {
        id: 'step-4',
        title: 'Other useful VS Code and terminal tricks',
        instruction: 'A handful of tricks that genuinely speed up work in VS Code and the terminal. Practise each one, then click "Practised".',
        bullets: [
          'Split terminal - split the terminal into two columns: Cmd+Backslash (Mac) or Ctrl+Shift+5. Handy when you want Claude Code in one half and git commands in the other.',
          'Several terminals and named tabs - add another terminal with the "+" button. Right-click a tab and choose "Rename" to name it (e.g. claude, git, server).',
          'Cmd+Click on a path - paths in terminal output (e.g. js/app.js:42) are clickable. Cmd+Click (Ctrl+Click on Windows/Linux) opens the file in the editor right away, at that exact line.',
          'Drag a file into the terminal - grab a file in the side panel and drop it into the terminal while holding Shift. Its full path is pasted, no typing needed.',
          'Pointing Claude at files and screenshots - in a prompt you can paste a file path or drag an image in, so the agent has the context.',
          'Clearing and history - Ctrl+L clears the terminal screen, and Ctrl+R searches the command history: start typing a fragment and cycle through the matches.',
        ],
        check: { type: 'self-attest', step: 'step-4' },
        btnLabel: 'Practised',
      },
      {
        id: 'step-5',
        title: 'The /clear command - start a clean thread',
        instruction: 'Goal: see how /clear wipes the context. 1) Copy the large text below and paste it into the CLI (it fills the conversation context). 2) Then paste the /clear command - the context disappears and the agent starts from scratch. Click once you have tried it.',
        check: { type: 'self-attest', step: 'step-5' },
        btnLabel: 'Tried it',
        copyBlocks: [
          {
            text: 'Context filler (paste this first, before you use /clear): Academy is a built-in training path that walks a participant through setting up the environment, working in the terminal and building their own plug & play module. Every stage is made of steps with a "Check" verification, and progress is saved together in the team data repository. The only purpose of this long paragraph is to take up room in the conversation context, so that after typing /clear you clearly see the difference - the agent stops remembering the text above and starts a new, clean thread.',
            label: 'Copy large text',
            headLabel: 'Step 1 - paste this first',
            toastTitle: 'Copied',
            toastBody: 'Paste it into the CLI, then use /clear.',
          },
          {
            text: '/clear',
            label: 'Copy command',
            headLabel: 'Step 2 - clear the context',
            toastTitle: 'Copied',
            toastBody: 'Paste /clear - the context disappears.',
          },
        ],
      },
      {
        id: 'step-6',
        title: 'Add a file to the prompt: @file',
        instruction: 'Goal: have the agent read a specific file before it answers. Copy the prompt below with the @CLAUDE.md reference and paste it into the CLI - the agent loads the file and answers based on it. @js/app.js or @server.js work the same way. Click once you have tried it.',
        check: { type: 'self-attest', step: 'step-6' },
        btnLabel: 'Tried it',
        copyBlock: { text: '@CLAUDE.md Summarise the most important rules for working in this repo in 3 points.', label: 'Copy prompt', toastTitle: 'Copied', toastBody: 'Paste it into the CLI - the agent will read CLAUDE.md.' },
      },
      {
        id: 'step-7',
        title: 'Save a note to memory: #',
        instruction: 'Goal: have the agent remember your decision for good (it appends it to CLAUDE.md). Copy the line starting with # and paste it into the CLI - it goes into the project memory and is respected in later sessions. Click once you have tried it.',
        check: { type: 'self-attest', step: 'step-7' },
        btnLabel: 'Tried it',
        copyBlock: { text: '# In documentation, keyboard shortcuts are given for both Mac and Windows/Linux.', label: 'Copy note', toastTitle: 'Copied', toastBody: 'Paste it into the CLI - it goes into CLAUDE.md.' },
      },
      {
        id: 'step-8',
        title: 'Compact a long conversation: /compact',
        instruction: 'Goal: when a conversation gets long, /compact summarises the context so far, so more fits without losing the thread. Copy the command and paste it into the CLI after a longer session. Click once you have tried it.',
        check: { type: 'self-attest', step: 'step-8' },
        btnLabel: 'Tried it',
        copyBlock: { text: '/compact', label: 'Copy command', toastTitle: 'Copied', toastBody: 'Paste /compact into the CLI.' },
      },
    ],
  },

  // ── Stage 3 — Build your own module ───────────────────────────────────────
  {
    id: 'etap-3',
    title: 'Build your own module',
    intro: 'The real exercise: build your own Mission Deck add-on from scratch, run it, test it, package it and submit it to the team.',
    steps: [
      {
        id: 'step-1',
        title: 'Anatomy of a module',
        instruction: 'Before you build anything, spend five minutes on the guide - what a module actually is, which four parts it is made of, which of them you really touch, and what the work loop you will spend this whole stage in looks like. Written in plain words, no jargon. Click "Open the guide", read it, then "Got it / Done".',
        check: { type: 'self-attest', step: 'step-1' },
        btnLabel: 'Got it / Done',
        guideDoc: { doc: 'module-anatomy', title: 'Anatomy of a module', label: 'Open the guide' },
      },
      {
        id: 'step-1b',
        title: 'Install a ready-made module from a file',
        instruction: 'Before you build your own module, see one working live. The team data repository holds a ready archive: data-sub-repositories/ds-data/modules/mascot-demo-1.0.0.zip. It is "Pip - sample module": it shows Pip the robot in a few moods, asks the server for the mood of the day and does NOT touch any team data, so you can install it, look around and delete it with no consequences. Click "Open Settings > Modules" - the panel opens in a new tab. In the module list section use the "Import" button, pick that zip file, then enable the module and restart the server. "Pip" appears in the sidebar. Copy the path with the button below if the file picker lets you paste it. Come back here and click once you can see Pip.',
        check: { type: 'self-attest', step: 'step-1b' },
        btnLabel: 'Got it / Done',
        openTab: { hash: 'settings/modules', label: 'Open Settings > Modules' },
        copyBlock: {
          text: 'data-sub-repositories/ds-data/modules/mascot-demo-1.0.0.zip',
          label: 'Copy path',
          toastTitle: 'Path copied',
          toastBody: 'Paste it into the file picker when importing the module.',
        },
      },
      {
        id: 'step-2',
        title: 'Generate the module skeleton',
        instruction: 'Copy the command below, replace the id, label and Product area with your own and run it in the terminal. The required --area flag names the business area of the module, independently of where it sits in the menu. The --views flag creates a hub with one view (two or more comma-separated entries turn the module into a hub with a drop-down list); --icon sets the sidebar icon; --no-server skips the server layer when the module is purely front-end. The command REFUSES to overwrite an existing module with the same id - you cannot lose anything by mistake. Click Check once the module folder exists on disk.',
        check: { type: 'server', step: 'step-2' },
        copyBlock: {
          text: 'node scripts/new-module.js my-module "My Module" --area "Product" --views list:List',
          label: 'Copy command',
          toastTitle: 'Copied',
          toastBody: 'Paste it into the terminal and replace the id, label and area with your own.',
        },
      },
      {
        id: 'step-3',
        title: 'Enable the module and restart the server',
        instruction: 'Click "Open Settings > Modules" - the panel opens in a new tab, so you keep your place in the course. Find your module in the list and switch it on, then restart the server with the "Restart server" button. The module appears in the sidebar with at least one view. The modules/ folder is in .gitignore, so it is a safe sandbox: whatever you build here cannot break the app core. Come back here and click Check once the module is visible in the sidebar.',
        check: { type: 'server', step: 'step-3' },
        openTab: { hash: 'settings/modules', label: 'Open Settings > Modules' },
      },
      {
        id: 'step-3b',
        title: 'Read all of CLAUDE.md and README.md',
        instruction: 'You have a working module, so this is the best moment for the two files that describe everything else. CLAUDE.md is the contract of this repository - the rules both people and agents follow: what the core is, what must not be touched, how team data encryption works, and why identifiers stay plain ASCII. README.md describes the app and its commands - from installation to running the tests. They were not needed in stage 1, but before bigger changes to a module it is worth reading both in full: an hour that saves a day of fixes. Click the buttons below and the files open in VS Code.',
        check: { type: 'self-attest', step: 'step-3b' },
        btnLabel: 'Read',
        openVscode: [
          { key: 'claude-md', label: 'Open CLAUDE.md in VS Code' },
          { key: 'readme', label: 'Open README.md in VS Code' },
        ],
        tip: 'Both files are Markdown - they are much easier to read in the preview: Cmd+Shift+V (Mac) / Ctrl+Shift+V (Windows and Linux).',
      },
      {
        id: 'step-4',
        title: 'Grow your module',
        instruction: 'Add your own view or logic with /new-idea - describe what should change in your module and name its id. Remember: a module NEVER touches the core VIEW_REGISTRY or HUB_FLYOUT - js/module-host.js builds them itself from module.json when the app starts. Copy the sample prompt below, replace <id> and the description, and paste it into the CLI. Click when you are done.',
        check: { type: 'self-attest', step: 'step-4' },
        btnLabel: 'Got it / Done',
        copyBlock: {
          text: '/new-idea Add a new view to the <id> module that ...',
          label: 'Copy prompt',
          toastTitle: 'Prompt copied',
          toastBody: 'Replace <id> and the description, then paste it into the CLI.',
        },
      },
      {
        id: 'step-6',
        title: 'Export the module',
        instruction: 'Click "Open Settings > Modules" - the panel opens in a new tab. Find your module and click "Export". A zip archive is created that you can send to someone - they import it through the same screen. Come back here and click once the export succeeds.',
        check: { type: 'self-attest', step: 'step-6' },
        btnLabel: 'Got it / Done',
        openTab: { hash: 'settings/modules', label: 'Open Settings > Modules' },
      },
      {
        id: 'step-7',
        title: 'Publish the module to the shared library',
        instruction: 'Click "Open Settings > Modules" - the panel opens in a new tab. Click "Publish" next to your module: a branch module/<id>-<date> is created in the modules catalog repository together with a merge request. The main branch of that repository is protected, so the catalog entry reaches everyone only AFTER a person merges the MR - that is normal, not an error. Come back here and click Check: the step passes when the branch is on the remote (the MR is waiting for review) or when the module is already in the catalog (the MR was merged and the branch deleted automatically).',
        check: { type: 'server', step: 'step-7' },
        openTab: { hash: 'settings/modules', label: 'Open Settings > Modules' },
      },
    ],
  },

  // ── Stage 4 — Pro tips (community, outside gating) ────────────────────────
  {
    id: 'etap-4',
    kind: 'tips',
    title: 'Extra tricks and good practice from the community',
    intro: 'Optional tricks from participants - they do not count towards finishing the course, but they are worth knowing.',
    steps: [
      {
        id: 'step-1',
        title: 'Your own status line',
        author: { name: 'Alex Morgan' },
        instruction: 'The status line is a configurable bar at the bottom of the Claude Code terminal - it shows e.g. the current model, the working directory, the git branch or context usage live, so you do not have to ask the agent. Configure it with /statusline (describe what it should show and Claude generates the script) or by hand in the settings.',
        check: { type: 'self-attest', step: 'step-1' },
        btnLabel: 'Got it / Done',
      },
      {
        id: 'step-2',
        title: 'Advisor',
        author: { name: 'Sam Rivera' },
        instruction: 'The advisor() tool available to the agent is a quick "second pair of eyes" - it lets you ask for an independent opinion or a sanity check on a plan, a diff or an architectural decision before you roll it out. Reach for it when a change is risky, touches many layers, or when you want to verify your assumptions before a big refactor.',
        check: { type: 'self-attest', step: 'step-2' },
        btnLabel: 'Got it / Done',
      },
      {
        id: 'step-3',
        title: 'Notification hook',
        author: { name: 'Taylor Kim' },
        instruction: 'The Notification hook in Claude Code plays a sound when the agent finishes or is waiting for your decision - no more checking the terminal every minute. Click "Show guide" to see how to set it up (a beginner and an advanced version).',
        check: { type: 'self-attest', step: 'step-3' },
        btnLabel: 'Got it / Done',
        guideModal: true,
      },
      {
        id: 'step-4',
        title: 'Loop goal - the agent loops until the goal is met',
        author: { name: 'Jordan Lee' },
        instruction: 'The /goal command lets you give the agent a concrete, measurable goal - the agent tries to reach it in a loop (gathers context, acts, verifies, repeats) until the success condition is met or the attempt limit runs out. Key rules: the goal must be verifiable, set an attempt limit, and it works best for tasks with a clear definition of done (e.g. the tests pass, lint is clean).',
        check: { type: 'self-attest', step: 'step-4' },
        btnLabel: 'Got it / Done',
      },
    ],
  },
];

// ── Tabs (page-level tab strip) ─────────────────────────────────────────────
// Every entry points at one stage (rendered in the tab panel), the mural or
// the gallery. `includeKrok0` puts the one-off "Step 0" card at the top of the panel.
export const TC_TABS = [
  { id: 'etap-1', label: 'Stage 1', stageIds: ['etap-1'], includeKrok0: true },
  { id: 'etap-2', label: 'Stage 2', stageIds: ['etap-2'] },
  { id: 'etap-3', label: 'Stage 3', stageIds: ['etap-3'] },
  { id: 'etap-4', label: 'Pro tips', stageIds: ['etap-4'] },
  { id: 'mural', label: 'Mural', mural: true },
  { id: 'galeria', label: 'Gallery', gallery: true },
];

// The three stages that gate progress (etap-4 "Pro tips" is outside gating).
export const GATED_STAGES = ['etap-1', 'etap-2', 'etap-3'];
