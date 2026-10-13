// demo/shell-contract.mjs
// Every piece of /index.html the demo depends on, in one list. The shell
// loader lifts the entries that carry `lift`; tests/test_demo_shell_contract.mjs
// checks that EVERY selector here still exists in index.html, so renaming one
// in the app fails the suite instead of leaving the demo silently empty.
//
// `lift` says where the cloned node goes:
//   'root' - straight into the cockpit surface, in list order
//   'app'  - into the (shallow) copy of div.app
//   'main' - into the (shallow) copy of main.main
// `shallow: true` clones the element without its children.

const HUBS = ['team', 'activity', 'finance', 'initiatives', 'support', 'knowledge', 'assets', 'apps'];
const SETT_PANELS = ['system', 'keys', 'agents', 'skills', 'modules', 'users', 'tools', 'demo'];

export const SHELL_CONTRACT = [
  { selector: 'header.app-top-bar', purpose: 'the top bar with the logo and slots', lift: 'root' },
  { selector: '#topbar-rail-toggle', purpose: 'the navigation collapse button' },
  { selector: '#topbar-help-root', purpose: 'the send-feedback button' },
  { selector: '#topbar-mr-root', purpose: 'the "MR:" slot with merge request counters' },
  { selector: '#topbar-active-badge-root', purpose: 'the "Active:" slot' },
  { selector: '#topbar-terminal-root', purpose: 'the Terminal button slot' },
  { selector: '#topbar-stash-root', purpose: 'the Stash slot' },
  { selector: '#topbar-daycycle-root', purpose: 'the End of day / Good morning slot' },
  { selector: '#topbar-sync-root', purpose: 'the Sync slot' },
  { selector: '#topbar-bw-root', purpose: 'the Bitwarden slot' },
  { selector: '#topbar-user-root', purpose: 'the person avatar' },
  { selector: 'body > div.app', purpose: 'the rail and content container', lift: 'root', shallow: true },
  { selector: 'aside#sidebar', purpose: 'the navigation rail', lift: 'app' },
  { selector: 'nav.sidebar-nav', purpose: 'the list of rail items' },
  { selector: 'a.sidebar-item[data-view="dashboard"]', purpose: 'the Dashboard item' },
  ...HUBS.map((id) => ({ selector: `a.sidebar-item--hub[data-view="${id}"]`, purpose: `hub ${id} (opens a flyout)` })),
  { selector: '.sidebar-spacer', purpose: 'the spacer before the fixed items' },
  { selector: 'a.sidebar-item--start[data-view="onboarding-wizard"]', purpose: 'the Start here item' },
  { selector: 'a.sidebar-item--training[data-view="academy"]', purpose: 'the Academy item' },
  { selector: 'a.sidebar-item--settings[data-view="settings"]', purpose: 'the Settings item' },
  { selector: '#infra-banner', purpose: 'the infrastructure strip (hidden in the demo)', lift: 'app' },
  { selector: '#app-update-banner', purpose: 'the update banner (hidden in the demo)', lift: 'app' },
  { selector: 'main.main', purpose: 'the views area', lift: 'app', shallow: true },
  { selector: '#view-dashboard', purpose: 'the Dashboard view', lift: 'main' },
  { selector: '#dashboard-cards', purpose: 'the dashboard start cards' },
  { selector: '#view-onboarding-wizard', purpose: 'the Start here view', lift: 'main' },
  { selector: '#onboarding-wizard-root', purpose: 'the wizard content' },
  { selector: '#view-academy', purpose: 'the Academy view', lift: 'main' },
  { selector: '#academy-root', purpose: 'the Academy content' },
  { selector: '#view-settings', purpose: 'the Settings view', lift: 'main' },
  { selector: '#settings-tabs', purpose: 'the Settings tab bar' },
  ...SETT_PANELS.map((id) => ({ selector: `[data-sett-panel="${id}"]`, purpose: `tab panel ${id}` })),
  ...SETT_PANELS.map((id) => ({ selector: `[data-sett-tab="${id}"]`, purpose: `tab ${id}` })),
  { selector: '#view-prototypy', purpose: 'the Prototypes view', lift: 'main' },
  { selector: '#prototypy-root', purpose: 'the prototype registry content' },
  { selector: '#sync-log-modal', purpose: 'the sync log window', lift: 'root' },
  { selector: '#slm-title', purpose: 'the log window title' },
  { selector: '#slm-spinner', purpose: 'the sync-in-progress indicator' },
  { selector: '#slm-banner', purpose: 'the sync result banner' },
  { selector: '#slm-log', purpose: 'the sync log rows' },
  { selector: '#slm-close', purpose: 'the Close button of the log window' },
  { selector: '#ds-toast-region', purpose: 'the notification area', lift: 'root' },
  { selector: '#claude-terminal-panel', purpose: 'the bottom Claude Code terminal panel', lift: 'root' },
  { selector: '#claude-terminal-tabs', purpose: 'the terminal tabs' },
  { selector: '#claude-terminal-hosts', purpose: 'the terminal content' },
  { selector: '#claude-terminal-label-text', purpose: 'the terminal panel label' },
];
