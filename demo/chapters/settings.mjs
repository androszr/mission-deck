// demo/chapters/settings.mjs
// Chapter `settings`: Settings > System (version check), Tools (a
// missing Playwright installed by the app's own job), Keys (the vault
// opened in "Start here" stays open: six cards green, the rest gray).
// Mocks in demo/mocks/ch-settings.mjs.

import { narrate, VAULT_OPEN, DEMO_TODAY } from './_helpers.mjs';

const P = '#dm-ustawienia-';

export default {
  setup: [
    { type: 'show', mock: 'ustawienia-version', target: '#settings-app-version' },
    { type: 'show', mock: 'ustawienia-sync', target: '#settings-sync-section' },
    { type: 'show', mock: 'ustawienia-theme', target: '#settings-theme-section' },
    { type: 'show', mock: 'ustawienia-narzedzia', target: '#settings-narzedzia-section' },
    { type: 'show', mock: 'ustawienia-profile', target: '#settings-profile-card', props: { unlocked: true } },
    { type: 'show', mock: 'ustawienia-activity', target: '#settings-activity-link-card' },
    { type: 'show', mock: 'ustawienia-bw-card', target: '#settings-bitwarden-card', props: { unlocked: true } },
    { type: 'show', mock: 'ustawienia-secrets', target: '#settings-section-grid', props: { unlocked: true } },
    { type: 'show', mock: 'ustawienia-legend', target: '#settings-secret-legend' },
    { type: 'show', mock: 'ustawienia-gitlab-tokens', target: '#settings-gitlab-token-card', props: { unlocked: true } },
    VAULT_OPEN,
  ],
  steps: [
    {
      id: 'ustawienia-system',
      caption: 'I open **Settings** and check that I have the newest version.',
      mascot: 'wave',
      camera: 'full',
      actions: [
        narrate('Settings: the System tab', 'Settings is one view with eight tabs. System shows the app version, the server restart, data sync and the theme. A restart is always done with this button, never by hand in the terminal.'),
        { type: 'navigate', view: 'settings' },
        { type: 'camera', target: P + 'version-card', zoom: 1.25 },
        { type: 'click', target: P + 'check-update-btn' },
        { type: 'show', mock: 'ustawienia-version', target: '#settings-app-version', props: { result: 'checking' } },
        { type: 'wait', ms: 900 },
        { type: 'show', mock: 'ustawienia-version', target: '#settings-app-version', props: { result: 'current' } },
        { type: 'wait', ms: 600 },
        { type: 'camera', full: true },
      ],
    },
    {
      id: 'ustawienia-narzedzia',
      caption: 'I look into **Tools** — two cards are red.',
      mascot: 'error',
      actions: [
        narrate('Tools: what works and what is missing', 'The Tools tab asks every program directly: is it there, which version, does it work. A card with a problem says in plain words what is missing, and where Mission Deck can fix it by itself, it has a button — nothing needs typing in the terminal. The command on the card stays there for the curious, but the button is enough.'),
        { type: 'navigate', view: 'settings', tab: 'tools' },
        { type: 'camera', target: P + 'tools-summary', zoom: 2 },
        { type: 'wait', ms: 500 },
        { type: 'camera', full: true },
        { type: 'scroll', target: P + 'group-weryfikacja' },
        { type: 'camera', target: P + 'group-weryfikacja', zoom: 1.25 },
        { type: 'hover', target: P + 'playwright-run', ms: 900 },
      ],
    },
    {
      id: 'ustawienia-instalacja',
      caption: 'I click **Install** — Mission Deck downloads Playwright and the browser by itself.',
      mascot: 'working',
      actions: [
        narrate('One-click installation', 'The button starts a job from the server’s closed list — the browser never sends a command to run, only the name of a job. One job runs at a time, so the other buttons are greyed out.'),
        { type: 'click', target: P + 'playwright-run' },
        { type: 'show', mock: 'ustawienia-narzedzia', target: '#settings-narzedzia-section', props: { busy: true } },
        { type: 'toast', variant: 'info', title: 'Started', desc: 'This takes from a few seconds to a few minutes.' },
        { type: 'wait', ms: 2200 },
        { type: 'show', mock: 'ustawienia-narzedzia', target: '#settings-narzedzia-section', props: { installed: true, checked: DEMO_TODAY + ' 09:23' } },
        { type: 'toast', variant: 'success', title: 'Done' },
        { type: 'wait', ms: 700 },
      ],
    },
    {
      id: 'ustawienia-klucze',
      caption: 'I move to **Keys** — the vault has been open since the wizard.',
      mascot: 'idle',
      actions: [
        narrate('Keys: tokens from the vault', 'The Keys tab shows which tokens the server holds in memory. We opened the vault in the “Start here” wizard and it stays open for the rest of the day — a server restart does not lock it. The values never reach the .env file or the screen — only the variable names are visible.'),
        { type: 'navigate', view: 'settings', tab: 'keys' },
        { type: 'camera', target: P + 'bw-card', zoom: 1.6 },
        { type: 'hover', target: P + 'bw-card', ms: 900 },
        { type: 'camera', full: true },
      ],
    },
    {
      id: 'ustawienia-odblokuj',
      caption: 'Cards with keys from the **vault** are green — grey ones wait for an item.',
      mascot: 'thinking',
      actions: [
        narrate('Tokens in the server memory', 'A green card is a token loaded from the vault. The alex-morgan collection has nine items — six starter ones (COCKPIT-APP, COCKPIT-DATA, COCKPIT-MODULES and three tokens for extra sources) plus the personal Figma, Jira and Confluence tokens — and those lit up the cards. “Application” and “Jira” show 1/2, because the owner token and the Jira technical token are separate items. Grey cards are sources you do not yet have an item for in the vault.'),
        { type: 'scroll', target: '#settings-section-grid' },
        { type: 'camera', target: '#settings-section-grid', zoom: 1.2 },
        { type: 'wait', ms: 600 },
      ],
    },
    {
      id: 'ustawienia-gotowe',
      caption: 'I copy the **token name** — setup done.',
      mascot: 'success',
      actions: [
        narrate('Ready to work', 'The button next to the name copies just the variable name — handy when you ask the vault maintainer for access to a source whose card is still grey.'),
        { type: 'camera', full: true },
        { type: 'scroll', target: P + 'copy-starter-app-token' },
        { type: 'camera', target: P + 'copy-starter-app-token', zoom: 2 },
        { type: 'click', target: P + 'copy-starter-app-token' },
        { type: 'toast', variant: 'success', title: 'Key copied', desc: 'COCKPIT_APP_TOKEN' },
        { type: 'wait', ms: 600 },
        { type: 'camera', full: true },
      ],
    },
  ],
};
