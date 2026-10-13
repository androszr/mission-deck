// demo/chapters/updates.mjs
// Chapter `updates`: keeping Mission Deck current and healthy. The update
// strip announces a new version; Settings > System "Check for updates"
// confirms it; the update refuses on a dirty working tree (the dirty-tree
// callout), the stash button asks the browser confirm and stashes the three
// files; the restart reloads the page with the new version and the "Stash"
// pill; then the infra strip (kind `network`, the VPN named first) - one
// "Check again" with the VPN still off answers the real warning toast,
// the VPN client (shared mock `vpn-client-screen`) connects, and the second
// "Check again" clears the strip.
// Nothing is fetched, stashed, reset or restarted.

import { narrate } from './_helpers.mjs';

export default {
  setup: [
    { type: 'show', mock: 'aktualizacja-update-banner', target: '#app-update-banner', mode: 'outer' },
    { type: 'show', mock: 'aktualizacja-version-card', target: '#settings-app-version' },
    { type: 'show', mock: 'aktualizacja-sync-card', target: '#settings-sync-section' },
    { type: 'show', mock: 'aktualizacja-theme-card', target: '#settings-theme-section' },
  ],
  steps: [
    {
      id: 'aktualizacja-baner',
      caption: 'The strip above the page announces a **new version** — I confirm it in Settings.',
      mascot: 'wave',
      camera: { target: '#app-update-banner', zoom: 1.15 },
      actions: [
        narrate('New version', 'Mission Deck checks on its own whether the app repository has a newer version, and says so in a strip above the page. The “Check for updates” button in Settings gives the same answer.'),
        { type: 'wait', ms: 700 },
        { type: 'camera', full: true },
        { type: 'navigate', view: 'settings', tab: 'system' },
        { type: 'click', target: '#settings-header-update-btn' },
        { type: 'show', mock: 'aktualizacja-result', target: '#aktualizacja-result', mode: 'outer', props: { state: 'checking' } },
        { type: 'camera', target: '#aktualizacja-version-card', zoom: 1.2 },
        { type: 'wait', ms: 600 },
        { type: 'show', mock: 'aktualizacja-result', target: '#aktualizacja-result', mode: 'outer', props: { state: 'available' } },
      ],
    },
    {
      id: 'aktualizacja-brudne-drzewo',
      caption: 'The update **stops** — I have unsaved changes in three files.',
      mascot: 'error',
      actions: [
        narrate('Unsaved changes', 'The update would overwrite files in the app folder, so Mission Deck refuses and lists what it would touch. Nothing has been changed — the decision is ours.'),
        { type: 'click', target: '#aktualizacja-update-now' },
        { type: 'show', mock: 'aktualizacja-result', target: '#aktualizacja-result', mode: 'outer', props: { state: 'downloading' } },
        { type: 'wait', ms: 900 },
        { type: 'show', mock: 'aktualizacja-result', target: '#aktualizacja-result', mode: 'outer', props: { state: 'dirty' } },
        { type: 'camera', target: '#aktualizacja-version-card', zoom: 1.2 },
      ],
    },
    {
      id: 'aktualizacja-stash',
      caption: 'I put the changes on the **stash** and update in one click.',
      mascot: 'working',
      actions: [
        narrate('Put on the stash', 'The button puts the changed files on the stash — new, unadded ones too — and only then updates. The browser asks for consent and shows the list of files. The app never restores the stash on its own.'),
        { type: 'click', target: '#aktualizacja-stash-btn' },
        { type: 'camera', full: true },
        { type: 'modal', open: 'aktualizacja-confirm' },
        { type: 'camera', target: '#aktualizacja-confirm .aktualizacja-confirm', zoom: 1.2 },
        { type: 'click', target: '#aktualizacja-confirm-ok' },
        { type: 'modal', close: '#aktualizacja-confirm' },
        { type: 'show', mock: 'aktualizacja-result', target: '#aktualizacja-result', mode: 'outer', props: { state: 'stashing' } },
        { type: 'camera', target: '#aktualizacja-version-card', zoom: 1.2 },
        { type: 'wait', ms: 1000 },
        { type: 'show', mock: 'aktualizacja-result', target: '#aktualizacja-result', mode: 'outer', props: { state: 'updated' } },
      ],
    },
    {
      id: 'aktualizacja-restart',
      caption: 'The server **comes back** with the new version, and my changes wait on the stash.',
      mascot: 'wave',
      actions: [
        narrate('Restart', 'After the update the server restarts on its own, and the page reloads once it answers twice in a row. The card shows the new version and a reminder about the stash; the “Stash” pill appears in the top bar.'),
        { type: 'camera', full: true },
        { type: 'surface', show: 'screen', mock: 'aktualizacja-reload' },
        { type: 'wait', ms: 700 },
        { type: 'show', mock: 'aktualizacja-update-banner', target: '#app-update-banner', mode: 'outer', props: { hidden: true } },
        { type: 'show', mock: 'aktualizacja-version-card', target: '#settings-app-version', props: { fresh: true, state: 'note' } },
        { type: 'show', mock: 'aktualizacja-stash-pill', target: '#topbar-stash-root' },
        { type: 'surface', show: 'cockpit' },
        { type: 'camera', target: '#aktualizacja-version-card', zoom: 1.2 },
      ],
    },
    {
      id: 'aktualizacja-stash-pigulka',
      caption: 'I look into the **Stash** pill — my three files are safe.',
      mascot: 'working',
      camera: { target: '#topbar-stash-root', zoom: 2 },
      actions: [
        narrate('The Stash pill', 'The “Stash” pill is visible only when something sits on the stash. The window shows every entry and its files, and lets you apply the changes back or copy a ready command for Claude.'),
        { type: 'click', target: '#aktualizacja-stash-pill' },
        { type: 'camera', full: true },
        { type: 'modal', open: 'aktualizacja-stash-modal' },
        { type: 'click', target: '#aktualizacja-stash-files' },
        { type: 'show', mock: 'aktualizacja-stash-files', target: '#aktualizacja-stash-slot' },
        { type: 'camera', target: '#aktualizacja-stash-modal .stash-entry', zoom: 1.4 },
      ],
    },
    {
      id: 'aktualizacja-vpn',
      caption: 'Oops — **GitLab** is not answering. The strip says: turn on the VPN.',
      mascot: 'error',
      actions: [
        narrate('The infrastructure strip', 'I hide the stash note with “Got it, hide”. When the last GitLab call got no answer, Mission Deck shows the infrastructure strip. The most common cause is a VPN that is off — which is why the sentence starts with it.'),
        { type: 'click', target: '#aktualizacja-stash-close' },
        { type: 'modal', close: '#aktualizacja-stash-modal' },
        { type: 'camera', full: true },
        { type: 'click', target: '#aktualizacja-note-dismiss' },
        { type: 'show', mock: 'aktualizacja-version-card', target: '#settings-app-version', props: { fresh: true } },
        { type: 'show', mock: 'aktualizacja-infra-banner', target: '#infra-banner', mode: 'outer' },
        { type: 'camera', target: '#infra-banner', zoom: 1.15 },
      ],
    },
    {
      id: 'aktualizacja-sprawdz',
      caption: 'I click **Check again** — the VPN is still off, and Mission Deck tells me so.',
      mascot: 'working',
      actions: [
        narrate('Check again', 'The button asks GitLab once whether it answers now. Without the VPN the answer is honest: “GitLab is still not answering” — Mission Deck does not pretend everything is fine.'),
        { type: 'click', target: '#aktualizacja-recheck' },
        { type: 'show', mock: 'aktualizacja-infra-banner', target: '#infra-banner', mode: 'outer', props: { checking: true } },
        { type: 'wait', ms: 900 },
        { type: 'show', mock: 'aktualizacja-infra-banner', target: '#infra-banner', mode: 'outer' },
        { type: 'camera', full: true },
        { type: 'toast', variant: 'warning', title: 'GitLab is still not answering', desc: 'Check that the VPN is connected and try again.' },
      ],
    },
    {
      id: 'aktualizacja-vpn-klient',
      caption: 'I open the **VPN client** and connect to the company gateway.',
      mascot: 'idle',
      camera: 'full',
      actions: [
        narrate('The VPN client', 'The strip says plainly what to do: turn on the VPN. The VPN client connects to the company gateway — from that moment GitLab answers again. Mission Deck switches nothing here itself.'),
        { type: 'surface', show: 'screen', mock: 'vpn-client-screen', props: { state: 'disconnected', filled: true } },
        { type: 'wait', ms: 500 },
        { type: 'click', target: '#onb-vpn-connect' },
        { type: 'show', mock: 'vpn-client-screen', target: '#onb-vpn-screen', mode: 'outer', props: { state: 'connecting' } },
        { type: 'progress', pct: 40, bar: '#onb-vpn-bar' },
        { type: 'wait', ms: 500 },
        { type: 'progress', pct: 100, bar: '#onb-vpn-bar' },
        { type: 'wait', ms: 400 },
        { type: 'show', mock: 'vpn-client-screen', target: '#onb-vpn-screen', mode: 'outer', props: { state: 'connected' } },
        { type: 'camera', target: '#onb-vpn-card', zoom: 1.2 },
        { type: 'wait', ms: 900 },
      ],
    },
    {
      id: 'aktualizacja-zielono',
      caption: 'I go back to Mission Deck and check once more — the strip **disappears**. Everything works!',
      mascot: 'success',
      actions: [
        { type: 'surface', show: 'cockpit' },
        { type: 'camera', target: '#infra-banner', zoom: 1.15 },
        narrate('The connection is back', 'With the VPN on, the next check gets an answer from GitLab and the strip disappears on its own. Mission Deck is up to date, the changes sit safely on the stash, the network works.'),
        { type: 'click', target: '#aktualizacja-recheck' },
        { type: 'show', mock: 'aktualizacja-infra-banner', target: '#infra-banner', mode: 'outer', props: { checking: true } },
        { type: 'wait', ms: 900 },
        { type: 'show', mock: 'aktualizacja-infra-banner', target: '#infra-banner', mode: 'outer', props: { hidden: true } },
        { type: 'camera', full: true },
      ],
    },
  ],
};
