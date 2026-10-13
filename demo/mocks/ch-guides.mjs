// demo/mocks/ch-guides.mjs
// Painters for chapter `guides`: the real instruction documents of
// docs/guides/, shortened but faithful, as a person sees them before the
// first `npm start`:
//   - INSTALL.html opened in the browser ("How to run Mission Deck step by
//     step", steps 0-8 and "Done!"), in the neutral window frame of
//     demo/chapters-css/onboarding.css,
//   - ONBOARDING.md as a Markdown preview: first-day checklist (lines tick),
//     vault entry names, "Which skill to use", key ideas, five traps and
//     "Where next".
// The vault address, the sign-in provider and the people are invented
// (vault.example.test, alex.morgan@example.com, "the Mission Deck maintainer
// in your team").
// Ids this file creates start with `instrukcje-`.

import { esc } from './common.mjs';

const P = 'instrukcje-';

/** One command line in the guide's code block, with an optional OS label. */
function cmd(text, os = '') {
  return `<div class="${P}cmd">${os ? `<span class="ds-badge ds-badge--sm ds-badge--gray ${P}cmd-os">${esc(os)}</span>` : ''}<code>${esc(text)}</code></div>`;
}

/** The guide's numbered step card. */
function step(n, title, lead, body = '') {
  return `<section class="ds-card ${P}step" id="${P}inst-step-${n}">
      <div class="ds-card-body">
        <div class="${P}step-head"><span class="${P}step-num">${n}</span><h3 class="${P}step-title">${esc(title)}</h3></div>
        <p class="${P}step-lead">${lead}</p>
        ${body}
      </div>
    </section>`;
}

function note(tone, title, text, id = '') {
  return `<div class="ds-callout ds-callout--${tone} ${P}note"${id ? ` id="${id}"` : ''}><div><strong>${esc(title)}</strong> ${text}</div></div>`;
}

const WIZARD = [
  ['Environment', 'checks that Node, Git, Python, the Bitwarden CLI and Claude Code are in place; whatever is missing you install with one button.'],
  ['Bitwarden', 'unlocking the vault gives the app access to the tokens without pasting them by hand.'],
  ['Access to the app repository', 'the token Mission Deck uses to recognise you and to pull updates.'],
  ['Encryption keys', 'paste the key; the data decrypts automatically.'],
  ['Team data', 'downloads the team data repository.'],
  ['Mission Deck update', 'checks for and installs the newest version with one click.'],
  ['Academy', 'unlocks once the other steps are done and leads to the Academy module.'],
];

/** INSTALL.html in the browser. */
function installGuide() {
  const steps = [
    step(0, 'Install the software you need', 'Make sure the basic tools are installed — you only need to do this <strong>once</strong>.', `
      <ul class="${P}list">
        <li><strong>Visual Studio Code</strong> — the editor you open the project in.</li>
        <li><strong>Google Chrome</strong> — the browser you run Mission Deck in.</li>
        <li><strong>Node.js 24</strong> — on macOS through Homebrew, <strong>not</strong> with the installer from nodejs.org.</li>
        <li><strong>Git</strong> — on Windows with the installer’s default options (Git Bash included).</li>
        <li><strong>Python 3</strong> — for the helper scripts and the Claude Code tools.</li>
      </ul>
      <div class="${P}cmds" id="${P}inst-cmds-0">${cmd('brew install node@24 git python', 'macOS')}${cmd('winget install OpenJS.NodeJS.LTS Git.Git Python.Python.3.12', 'Windows')}</div>
      ${note('warning', 'Note.', 'After installing, <strong>close and reopen the terminal</strong>. Check: <code>node -v</code> (starts with v24), <code>git --version</code>, <code>python3 --version</code>.')}`),
    step(1, 'Unpack the ZIP onto your disk', 'Extract the ZIP somewhere safe — <strong>outside OneDrive</strong> and <strong>outside iCloud</strong>. Windows: <code>C:\\mission-deck</code>, Mac: <code>/Users/you/mission-deck</code>.',
      note('info', 'Why does it matter?', 'Cloud folders are synced all the time, and the app creates a great many files — it would slow the computer down and could damage the data.', P + 'inst-cloud')),
    step(2, 'Open the folder in Visual Studio Code', '<strong>File → Open Folder...</strong>, point at the unpacked folder and click <strong>Yes, I trust the authors</strong>. Ideally in a new, clean window.'),
    step(3, 'Show the files in the side panel', 'Click the <strong>files icon</strong> (Explorer) in the left bar — you will see the list of project files.'),
    step(4, 'Open a terminal and install the dependencies', '<strong>Terminal → New Terminal</strong>, then one after the other:',
      `<div class="${P}cmds" id="${P}inst-cmds-4">${cmd('npm install')}${cmd('npm run setup')}</div>`),
    step(5, 'Start the app', 'The server runs in the background — <strong>do not close this terminal</strong>. Chrome opens by itself, straight on the setup wizard.',
      `<div class="${P}cmds" id="${P}inst-cmds-5">${cmd('npm start')}</div><p class="${P}step-lead">The browser did not open? Type <code>localhost:3001</code> in the address bar.</p>`),
    step(6, 'The setup wizard', 'On the first run Mission Deck walks you through the setup — no need to hunt through Settings.', `
      <ol class="${P}list ${P}wizard" id="${P}inst-wizard">${WIZARD.map(([t, d]) => `<li><strong>${esc(t)}</strong> — ${esc(d)}</li>`).join('')}</ol>
      ${note('info', 'Why an encryption key?', 'The data sits in the repositories encrypted (AES-256-GCM). The wizard saves the key only on your computer, in the <code>.encryption-key</code> file.')}
      <p class="${P}step-lead">You can come back to the wizard at any time with the <strong>Start here</strong> item in the side menu.</p>`),
    step(7, 'Set up the Bitwarden CLI', 'Mission Deck fetches the tokens from the company vault. Install the CLI and sign in <strong>once</strong>:', `
      <div class="${P}cmds" id="${P}inst-cmds-7">${cmd('npm install -g @bitwarden/cli')}${cmd('bw config server https://vault.example.test')}${cmd('bw login --sso')}</div>
      <p class="${P}step-lead">The last command asks for your organisation’s SSO identifier; sign in with your work account (e.g. <code>alex.morgan@example.com</code>). Later you unlock the vault in Mission Deck, not in the terminal.</p>`),
    step(8, 'Final steps', '<strong>Claude Code</strong> — the wizard installs it, but you have to sign in yourself; run <code>claude</code> in the VS Code terminal. <strong>Workspace</strong> — <strong>File → Save Workspace As...</strong>, and you open the project with one click.',
      `<div class="${P}cmds">${cmd('brew install --cask claude-code', 'macOS')}${cmd('npm install -g @anthropic-ai/claude-code', 'Windows')}</div>`),
  ];
  return `<div class="onb-screen ${P}screen" id="${P}install-screen">
      <div class="onb-window ${P}window">
        <div class="onb-window-bar"><span class="onb-window-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="onb-window-title">file:///Users/you/Projects/mission-deck/docs/guides/INSTALL.html</span></div>
        <div class="${P}doc">
          <header class="${P}hero" id="${P}inst-hero">
            <span class="${P}hero-badge">Installation guide</span>
            <h1 class="${P}hero-title">How to run Mission Deck step by step</h1>
            <p class="${P}hero-lead">A guide to installing the app on your computer. Go through all the steps in order — it takes about a quarter of an hour.</p>
          </header>
          <div class="${P}doc-body">
            <div class="ds-callout ds-callout--info" id="${P}inst-before"><div><strong>Before you start.</strong> You need the ZIP package with the app, Visual Studio Code and Google Chrome.
              You do not need to chase the encryption key from the Mission Deck maintainer in your team right away — the setup wizard will ask for it.</div></div>
            ${steps.join('')}
            <section class="ds-card ${P}step ${P}done" id="${P}inst-done">
              <div class="ds-card-body">
                <h2 class="${P}done-title">Done!</h2>
                <p class="${P}step-lead">Mission Deck is installed and set up. You have two environments that complement each other: <strong>Mission Deck in the browser</strong>
                  (modules, data, reports) and <strong>Visual Studio Code</strong> (documents, Claude Code, developing Mission Deck).</p>
                <p class="${P}step-lead">How do you contribute to Mission Deck? Go to the <strong>Academy</strong> module: <code>localhost:3001/#academy</code>.</p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>`;
}

/**
 * The first-day checklist, in the order a new person really goes: the starter
 * package, two install commands, the one-time vault CLI login, the server, the
 * VPN and the "Start here" wizard. Nobody edits .env: the port defaults to
 * 3001 and the wizard's unlock writes the collection name itself.
 * [text, note, isCommand] - only a command is painted as <code>.
 */
export const CHECKLIST = [
  ['cd ~/Projects/mission-deck', 'the mission-deck-starter.zip package from SharePoint, unpacked outside OneDrive and iCloud', true],
  ['npm install', 'the app’s dependencies', true],
  ['npm run setup', 'once: Chromium (Playwright) and the code graph (GitNexus)', true],
  ['bw config server https://vault.example.test && bw login --sso', 'once per computer', true],
  ['npm start', 'the server on http://localhost:3001, Chrome opens by itself', true],
  ['VPN', 'connect before the wizard reaches for the team repositories', false],
  ['Start here', 'the wizard: the vault (a first-last collection, the COCKPIT-KEYS note), encryption keys from a Bitwarden Send, team data, the Academy', false],
];

/** One line of the first-day checklist. */
function checkItem({ i = 0, done = false } = {}) {
  const [c, d, isCmd] = CHECKLIST[i] || CHECKLIST[0];
  const head = isCmd ? `<code>${esc(c)}</code>` : `<strong>${esc(c)}</strong>`;
  return `<label class="ds-checkbox-label ${P}check${done ? ' ' + P + 'check--done' : ''}" id="${P}check-${i}">
      <input type="checkbox" tabindex="-1"${done ? ' checked' : ''}><span>${head} <span class="${P}check-note">— ${esc(d)}</span></span>
    </label>`;
}

function checkCounter({ done = 0 } = {}) {
  return `<span class="ds-badge ds-badge--sm ${done === CHECKLIST.length ? 'ds-badge--green' : 'ds-badge--gray'}" id="${P}check-count">${done} of ${CHECKLIST.length}</span>`;
}

const TOKENS = [
  ['COCKPIT-APP', 'COCKPIT_APP_TOKEN', 'the app repo: updates, MRs'],
  ['COCKPIT-DATA', 'COCKPIT_DATA_TOKEN', 'the starter data repo (data-tier-0)'],
  ['GITLAB-PERSONAL', 'COCKPIT_OWNER_TOKEN', 'creating project tokens from Settings'],
  ['FIGMA', 'FIGMA_TOKEN', 'Figma: the DS catalog, specifications'],
];

const SKILLS = [
  ['Add a view, an endpoint, a fix', '/new-idea "describe the idea"'],
  ['Check changes before a commit', '/pre-ship-audit'],
  ['Review a branch with blast-radius analysis', '/review-pr'],
  ['Suggest a commit message', '/commit-message'],
  ['Clean up branches after a merge', '/sync-after-merge'],
  ['Review the tests of the whole repo', '/qa-audit'],
  ['Create a Jira issue', '/jira'],
  ['Fetch or save a Confluence page', '/confluence'],
  ['Write a document (story, brief, note, workshop)', 'copy from templates/, save in user-data/'],
];

const TERMS = [
  ['View', 'a #view-<id> section, an entry in VIEW_REGISTRY and a menu item — always the three.'],
  ['Modules', 'new things are built in modules/, not in the core; a module survives an app update.'],
  ['The data-tier-0 data repo', 'the team’s separate repository; you sync it with the button in the top bar, never with a manual git push.'],
  ['Design System', 'every button has the ds-btn class, and colours come from tokens.'],
  ['The delivery path', '/new-idea: a plan with criteria, acceptance, implementation, blind verification, a SHIP or ITERATE verdict.'],
];

const PITFALLS = [
  ['Working on main', 'The skills block implementation on main. Create a working branch: <code>git checkout -b feat/&lt;name&gt;</code>.'],
  ['Restarting the server', 'Only through the server API (in PowerShell use <code>curl.exe</code>). Never <code>npm start</code>, <code>pkill</code> or <code>kill -9</code> — you would kill the running instance.'],
  ['A hard reset of the repository is blocked', 'By a permission rule and a hook. Use <code>git stash</code>, <code>git restore</code> or <code>git reset --soft</code>.'],
  ['ASCII only in code', 'Accented or other non-ASCII characters only inside HTML and JSON strings. Never in names or comments.'],
  ['Design System classes are mandatory', 'A plain <code>&lt;button&gt;</code> without <code>ds-btn</code> is a block in the conventions review.'],
];

const NEXT = [
  ['CLAUDE.md', 'the full truth: stack, architecture, conventions, commands'],
  ['README.md', 'installation, tokens, startup'],
  ['INSTALL.html', 'step-by-step installation'],
  ['token-security.html', 'how to handle tokens'],
  ['templates/README.md', 'document templates'],
];

/** ONBOARDING.md as a Markdown preview. props: { done } - ticked checklist lines. */
function onboardingDoc({ done = 0 } = {}) {
  const items = CHECKLIST.map((_, i) => checkItem({ i, done: i < done })).join('');
  const tokens = TOKENS.map(([e, v, d]) => `<tr><td><code>${esc(e)}</code></td><td><code>${esc(v)}</code></td><td>${esc(d)}</td></tr>`).join('');
  const skills = SKILLS.map(([w, s], i) => `<tr id="${P}skill-${i}"><td>${esc(w)}</td><td><code>${esc(s)}</code></td></tr>`).join('');
  const terms = TERMS.map(([t, d]) => `<li><strong>${esc(t)}</strong> — ${esc(d)}</li>`).join('');
  const pits = PITFALLS.map(([t, d], i) => `<div class="ds-callout ds-callout--warning ${P}pit" id="${P}pit-${i}" hidden><div><strong>${i + 1}. ${esc(t)}.</strong> ${d}</div></div>`).join('');
  const next = NEXT.map(([f, d]) => `<li><code>${esc(f)}</code> — ${esc(d)}</li>`).join('');
  return `<div class="onb-screen ${P}screen" id="${P}onboarding-screen">
      <div class="onb-window ${P}window">
        <div class="onb-window-bar"><span class="onb-window-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="onb-window-title">Preview: docs/guides/ONBOARDING.md</span></div>
        <div class="${P}doc-body md-body ${P}md">
          <h1 class="${P}md-title">Mission Deck — getting started</h1>
          <p>Mission Deck: an app in the browser and a single-file Node server, with no database and no bundler.</p>
          <h2 id="${P}h-checklist">First-day checklist ${checkCounter({ done })}</h2>
          <p>Requirements: Node.js 24, Git, Python 3.10+, the Bitwarden CLI and Claude Code.</p>
          <div class="ds-checkbox-group ${P}checklist" id="${P}checklist">${items}</div>
          <p>You neither create nor edit a <code>.env</code> file — the tokens are in the vault, and you give the collection name in the wizard when you unlock.
            After <code>npm run setup</code> restart Claude Code, so it sees the MCP server with the code graph.</p>
          <h2 id="${P}h-tokens">Tokens — vault item names</h2>
          <p>You never type a token by hand. The server fetches them from the vault when it is unlocked and keeps them in memory only.</p>
          <div class="ds-table-wrap" id="${P}tokens"><table class="ds-table">
            <thead><tr><th>Vault item</th><th>Variable</th><th>What for</th></tr></thead><tbody>${tokens}</tbody></table></div>
          <p>For the first run you need only the first two rows.</p>
          <h2 id="${P}h-skills">Which skill to use</h2>
          <div class="ds-table-wrap" id="${P}skills"><table class="ds-table">
            <thead><tr><th>What you want to do</th><th>Use</th></tr></thead><tbody>${skills}</tbody></table></div>
          <h2 id="${P}h-terms">Key ideas</h2>
          <ul id="${P}terms">${terms}</ul>
          <h2 id="${P}h-pits">Five traps</h2>
          <div class="${P}pits" id="${P}pits">${pits}</div>
          <h2 id="${P}h-next">Where next</h2>
          <ul id="${P}next">${next}</ul>
        </div>
      </div>
    </div>`;
}

export const MOCKS = {
  /** INSTALL.html opened in the browser (surface 'screen'). */
  'instrukcje-install': () => installGuide(),
  /** ONBOARDING.md Markdown preview (surface 'screen'). props: { done } */
  'instrukcje-onboarding': (p = {}) => onboardingDoc(p),
  /** One checklist line, repainted ticked. props: { i, done } */
  'instrukcje-check': (p = {}) => checkItem(p),
  /** The "N of M" counter next to the checklist heading. props: { done } */
  'instrukcje-check-count': (p = {}) => checkCounter(p),
};

/** Every visible label these painters paint (copy gate). */
export const LABELS = [
  'How to run Mission Deck step by step', 'Installation guide', 'Before you start.', 'Done!',
  ...WIZARD.flat(), ...CHECKLIST.map(([, d]) => d), ...TOKENS.map(([, , d]) => d), ...SKILLS.map(([w]) => w),
  ...TERMS.flat(), ...PITFALLS.flat(), ...NEXT.map(([, d]) => d),
  ...CHECKLIST.filter(([, , isCmd]) => !isCmd).map(([c]) => c),
  'First-day checklist', 'Tokens — vault item names', 'Which skill to use', 'Key ideas', 'Five traps', 'Where next',
];
