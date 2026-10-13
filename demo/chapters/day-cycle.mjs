// demo/chapters/day-cycle.mjs
// Chapter `day-cycle`: the evening pill "End of day" opens
// "Done for today?" (js/day-cycle-modal.js); the run pushes the one source
// with pending files, clears the plaintext of every source whose encrypted
// mirror is complete and skips the rest; the summary offers "Shut down
// Mission Deck" (played - nothing stops). Next morning the first start of the day
// opens "Good morning! Let's decrypt the data" by itself, the sources decrypt one by
// one and the pill turns back into "End of day". Mocks in
// demo/mocks/ch-day-cycle.mjs.

import { narrate } from './_helpers.mjs';

const P = '#koniec-i-start-dnia-';
const rowAt = (repo, tone, text, sub = '') => ({
  type: 'show', mock: 'koniec-i-start-dnia-row', target: `${P}row-${repo}`, mode: 'outer', props: { repo, tone, text, sub },
});
const pause = (ms = 450) => ({ type: 'wait', ms });

export default {
  setup: [
    { type: 'show', mock: 'topbar-bw', target: '#topbar-bw-root', props: { unlocked: true } },
    { type: 'show', mock: 'topbar-sync', target: '#topbar-sync-root', props: { pending: true } },
    { type: 'show', mock: 'topbar-daycycle', target: '#topbar-daycycle-root', props: { mode: 'wrapup' } },
  ],
  steps: [
    {
      id: 'koniec-i-start-dnia-wieczor',
      caption: 'Evening. I click **End of day** and check what Mission Deck will do with each source.',
      mascot: 'idle',
      camera: { target: '#topbar-daycycle-root', zoom: 2.2 },
      actions: [
        narrate('End of day', 'At the end of the work day one pill sends whatever is still waiting and removes the plaintext data from the disk. Before anything happens, the window shows the plan for every source.'),
        { type: 'click', target: '#topbar-daycycle-root .topbar-daycycle-btn' },
        { type: 'camera', full: true },
        { type: 'modal', open: 'koniec-i-start-dnia-wrapup' },
        { type: 'camera', target: P + 'wrapup .ds-modal', zoom: 1.05 },
      ],
    },
    {
      id: 'koniec-i-start-dnia-wyslij',
      caption: 'First I **send** the team data — the stream encrypts and pushes the changes.',
      mascot: 'working',
      actions: [
        narrate('Sending', '“Send and clear” goes through the sources one by one. The team data has unsent files, so sending comes first: encryption, pulling in other people’s changes, push. The stream’s progress shows in the row.'),
        { type: 'click', target: P + 'go' },
        { type: 'show', mock: 'koniec-i-start-dnia-wrapup-footer', target: P + 'wrapup-footer', props: { busy: true } },
        rowAt('data-tier-0', 'yellow', 'sending...', 'Starting...'),
        pause(350),
        rowAt('data-tier-0', 'yellow', 'sending...', 'Encrypting data before sending... 1 / 4'),
        pause(),
        rowAt('data-tier-0', 'yellow', 'sending...', 'Checking for changes on the server... 2 / 4'),
        pause(),
        rowAt('data-tier-0', 'yellow', 'sending...', 'Recording local changes... 3 / 4'),
        pause(),
        rowAt('data-tier-0', 'yellow', 'sending...', 'Sending to the server... 4 / 4'),
        pause(),
        rowAt('data-tier-0', 'yellow', 'clearing...', 'Sent 3 files.'),
        pause(),
        rowAt('data-tier-0', 'green', 'sent and cleared', 'Sent 3 files.'),
      ],
    },
    {
      id: 'koniec-i-start-dnia-sprzatanie',
      caption: 'I **clean up** the plaintext files wherever everything already sits in the encrypted copy.',
      mascot: 'working',
      actions: [
        narrate('Clearing only when allowed', 'The server deletes a source’s plaintext files only after checking three things under one lock: every file is already in the encrypted copy, the copy is on the disk, and there is a key. Without a key there is no clearing and no workaround — otherwise there would be nothing to decrypt with in the morning.'),
        rowAt('data-reports', 'yellow', 'clearing...'),
        pause(),
        rowAt('data-reports', 'green', 'cleared'),
        rowAt('data-leads', 'yellow', 'clearing...'),
        pause(),
        rowAt('data-leads', 'green', 'cleared'),
        rowAt('data-design', 'gray', 'skipped: no key', 'Without a key on this computer I do not touch the plaintext files.'),
        pause(350),
        rowAt('data-rollouts', 'gray', 'skipped: not cloned'),
      ],
    },
    {
      id: 'koniec-i-start-dnia-podsumowanie',
      caption: 'Summary: three sources clean, one **sent** — the pill turns into “Good morning”.',
      mascot: 'sleeping',
      actions: [
        narrate('The evening summary', 'The window says what happened to every source. Until the morning the app is empty on purpose: a laptop left on a train holds only encrypted files. The pill in the top bar turns into “Good morning”.'),
        { type: 'show', mock: 'koniec-i-start-dnia-summary', target: P + 'wrapup-body' },
        { type: 'show', mock: 'koniec-i-start-dnia-summary-footer', target: P + 'wrapup-footer' },
        { type: 'show', mock: 'topbar-daycycle', target: '#topbar-daycycle-root', props: { mode: 'morning' } },
        pause(600),
      ],
    },
    {
      id: 'koniec-i-start-dnia-zamknij',
      caption: 'I click **Shut down Mission Deck** — the server stops, and I go home.',
      mascot: 'wave',
      actions: [
        narrate('Shut down Mission Deck', 'The button stops the server just like a restart, only without starting again, and locks the vault. In the demo nothing really stops.'),
        { type: 'click', target: P + 'shutdown' },
        { type: 'show', mock: 'koniec-i-start-dnia-farewell', target: P + 'wrapup-body' },
        { type: 'show', mock: 'empty', target: P + 'wrapup-footer' },
        pause(900),
      ],
    },
    {
      id: 'koniec-i-start-dnia-noc',
      caption: 'Night: only **encrypted** files are left on the disk.',
      mascot: 'sleeping',
      actions: [
        narrate('What stays overnight', 'The plaintext folders are empty, the encrypted mirrors full, the server stopped. Whoever takes this disk sees only .enc files with encrypted names.'),
        { type: 'modal', close: P + 'wrapup' },
        { type: 'surface', show: 'screen', mock: 'koniec-i-start-dnia-night' },
        pause(1200),
      ],
    },
    {
      id: 'koniec-i-start-dnia-rano',
      caption: 'In the morning I start the server — Mission Deck **greets** me with the “Good morning” window on its own.',
      mascot: 'wave',
      actions: [
        narrate('The first start of the day', 'In the morning Mission Deck starts just as after installation — a person types this command — neither Claude nor any script starts the server. The first visit of the day opens the welcome window by itself, with the sources cleared in the evening; the “Good morning” pill opens the same window.', 'npm start'),
        { type: 'surface', show: 'vscode' },
        { type: 'terminal', lines: [
          { role: 'cmd', cwd: '~/Projects/mission-deck', text: 'npm start' },
          { role: 'dim', text: '> mission-deck@1.0.0 start' },
          { role: 'out', text: '[modules] loaded: time-log' },
          { role: 'ok', text: 'Mission Deck -> http://localhost:3001' },
        ] },
        { type: 'surface', show: 'cockpit' },
        { type: 'show', mock: 'topbar-daycycle', target: '#topbar-daycycle-root', props: { mode: 'morning' } },
        { type: 'modal', open: 'koniec-i-start-dnia-morning' },
        { type: 'camera', full: true },
      ],
    },
    {
      id: 'koniec-i-start-dnia-odszyfruj',
      caption: 'I **decrypt** the sources one by one — from the local copy, without the network.',
      mascot: 'working',
      actions: [
        narrate('Decrypt', 'Decryption goes source by source, from the encrypted copy on the disk — without fetching anything. I will fetch the team’s news later in the Sync window.'),
        { type: 'click', target: P + 'decrypt' },
        { type: 'show', mock: 'koniec-i-start-dnia-decrypt-btn', target: P + 'decrypt', mode: 'outer', props: { busy: true } },
        pause(500),
        rowAt('data-tier-0', 'green', 'decrypted'),
        pause(400),
        rowAt('data-reports', 'green', 'decrypted'),
        pause(400),
        rowAt('data-leads', 'green', 'decrypted'),
        { type: 'show', mock: 'koniec-i-start-dnia-decrypt-btn', target: P + 'decrypt', mode: 'outer', props: { busy: false, done: true } },
        { type: 'show', mock: 'koniec-i-start-dnia-mascot', target: P + 'morning-mascot', mode: 'outer', props: { pose: 'success' } },
        { type: 'camera', full: true },
        { type: 'toast', variant: 'success', title: 'Data decrypted', desc: 'Team photos and progress are coming back on screen.' },
        { type: 'show', mock: 'topbar-daycycle', target: '#topbar-daycycle-root', props: { mode: 'wrapup' } },
      ],
    },
    {
      id: 'koniec-i-start-dnia-praca',
      caption: 'Everything is back on screen — **back to work**!',
      mascot: 'success',
      actions: [
        narrate('Back at work', 'The pill says “End of day” again, the data is in place. The whole cycle is two clicks a day: send and clear in the evening, decrypt in the morning.'),
        { type: 'click', target: P + 'morning-close' },
        { type: 'modal', close: P + 'morning' },
        { type: 'navigate', view: 'dashboard' },
        { type: 'hover', target: '#dashboard-cards .placeholder-hub-card' },
      ],
    },
  ],
};
