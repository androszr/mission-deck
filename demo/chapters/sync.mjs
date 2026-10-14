// demo/chapters/sync.mjs
// Chapter `sync` ("Encryption and data exchange"): first an animated
// diagram of how a data source travels (plaintext directory -> AES-256-GCM per
// file with a per-file key and encrypted names -> the `.enc` mirror -> GitLab
// -> a colleague pulls and decrypts with his own line of `.encryption-key`),
// then the exchange between two people: Alex pushes "Team data" from the
// sync center (js/sync-center-modal.js, in-row progress with the server's own
// log lines), Sam pulls them on his computer. Encryption, push and pull are the
// server's deterministic code - never the AI. The demo sends and pulls nothing.
// ("End of day" / "Good morning" live in chapter `day-cycle`.)

import { narrate, VAULT_OPEN } from './_helpers.mjs';

/** One in-row progress tick: the repo group repainted with its bar. */
const tick = (repo, step, counter, pct) => ({
  type: 'show', mock: 'synchronizacja-group', target: `#synchronizacja-grp-${repo}`, mode: 'outer',
  props: { repo, progress: { step, counter, pct } },
});
const pause = (ms = 450) => ({ type: 'wait', ms });
const stage = (n) => ({ type: 'show', mock: 'synchronizacja-diagram', target: '#synchronizacja-diagram', mode: 'outer', props: { stage: n } });

export default {
  setup: [
    VAULT_OPEN,
    { type: 'show', mock: 'topbar-sync', target: '#topbar-sync-root', props: { pending: true } },
  ],
  steps: [
    {
      id: 'synchronizacja-jawne',
      caption: 'On my disk the team data sits in **plaintext** — only here.',
      mascot: 'working',
      actions: [
        narrate('The plaintext folder', 'Every data source has a plaintext folder on the computer in data-sub-repositories/. Views and modules read from it. This folder is never a git repository and never reaches the server.'),
        { type: 'surface', show: 'screen', mock: 'synchronizacja-diagram', props: { stage: 1 } },
      ],
    },
    {
      id: 'synchronizacja-szyfr',
      caption: 'I **encrypt** every file separately: AES-256-GCM, its own key, a hidden name.',
      mascot: 'idle',
      actions: [
        narrate('Encryption per file', 'Before sending, the Mission Deck server encrypts every file separately with AES-256-GCM. It derives the file key from your line in .encryption-key, and the name is encrypted too — the mirror shows only .enc files. The scripts/crypto-sync.js module does this.'),
        stage(2),
        { type: 'camera', target: '#synchronizacja-diagram .synchronizacja-node--crypt', zoom: 1.4 },
        { type: 'wait', ms: 1400 },
        { type: 'camera', full: true },
      ],
    },
    {
      id: 'synchronizacja-gitlab',
      caption: 'I send only ciphertext to **GitLab** — the plaintext file never leaves the disk.',
      mascot: 'working',
      actions: [
        narrate('The mirror on GitLab', 'Only the encrypted mirror goes to GitLab. Without the key the repository is unreadable — even the file names. Without a key Mission Deck refuses to send rather than send plaintext data.'),
        stage(3),
      ],
    },
    {
      id: 'synchronizacja-kolega',
      caption: 'A colleague pulls the mirror and **decrypts** it with his own key line.',
      mascot: 'working',
      actions: [
        narrate('On the other side', 'A person with access has the same line for this source in their .encryption-key. Their Mission Deck pulls the mirror and decrypts it locally. The deterministic server code encrypts and decrypts — not the AI.'),
        stage(4),
        { type: 'camera', target: '#synchronizacja-diagram .synchronizacja-node--peer', zoom: 1.4 },
        { type: 'wait', ms: 1400 },
        { type: 'camera', full: true },
      ],
    },
    {
      id: 'synchronizacja-otworz',
      caption: 'Now in practice: I open **Sync** — I have three changed files.',
      mascot: 'thinking',
      actions: [
        narrate('Data sync', 'The sync window shows every source: its state, the number of files to send and fetch, and the change date locally and on the server. The dot on the pill says something is waiting.'),
        { type: 'surface', show: 'cockpit' },
        { type: 'camera', target: '#topbar-sync-root', zoom: 2 },
        { type: 'click', target: '#topbar-sync-root .topbar-sync-btn' },
        { type: 'camera', full: true },
        { type: 'modal', open: 'synchronizacja-scm' },
        { type: 'camera', target: '#synchronizacja-scm .ds-modal', zoom: 1.2 },
      ],
    },
    {
      id: 'synchronizacja-wyslij',
      caption: 'I send the **team data** — the server encrypts, merges and sends.',
      mascot: 'working',
      actions: [
        narrate('Send', 'The up arrow encrypts the changed files, pulls in whatever someone else sent in the meantime, and only then sends. Every stage is a line of the server log.'),
        { type: 'click', target: '#synchronizacja-push-data-tier-0' },
        tick('data-tier-0', 'Starting...', '', 0),
        { type: 'show', mock: 'synchronizacja-mods', target: '#synchronizacja-mods-data-tier-0', mode: 'outer', props: { busy: true } },
        pause(300),
        tick('data-tier-0', 'Encrypting data before sending...', '1 / 4', 25),
        pause(),
        tick('data-tier-0', 'Checking for changes on the server...', '2 / 4', 50),
        pause(),
        tick('data-tier-0', 'Recording local changes...', '3 / 4', 75),
        pause(),
        tick('data-tier-0', 'Sending to the server...', '4 / 4', 95),
        pause(),
        tick('data-tier-0', 'Synced 09:44', '4 / 4', 100),
        pause(500),
        { type: 'show', mock: 'synchronizacja-group', target: '#synchronizacja-grp-data-tier-0', mode: 'outer', props: { repo: 'data-tier-0', state: { badge: ['green', 'up to date'], send: 0, fetch: 0, local: '04.10 09:44', remote: '04.10 09:44' } } },
        { type: 'show', mock: 'synchronizacja-mods', target: '#synchronizacja-mods-data-tier-0', mode: 'outer', props: { modules: 'done' } },
        { type: 'camera', full: true },
        { type: 'toast', variant: 'success', title: 'Synced' },
        { type: 'show', mock: 'topbar-sync', target: '#topbar-sync-root', props: { pending: false } },
      ],
    },
    {
      id: 'synchronizacja-jan',
      caption: 'Meanwhile at **Sam’s**: Mission Deck sees three files to fetch.',
      mascot: 'working',
      actions: [
        narrate('The second person', 'The top bar and the window say whose computer this is: “Sam’s computer” and his initials. On Sam’s computer the same “Team data” row now shows “to fetch”. Sam gets no file from Alex by email — only the encrypted mirror travels between them, through the shared team repository.'),
        { type: 'click', target: '#synchronizacja-scm-ok' },
        { type: 'modal', close: '#synchronizacja-scm' },
        { type: 'surface', show: 'screen', mock: 'synchronizacja-switch' },
        { type: 'wait', ms: 1300 },
        { type: 'show', mock: 'synchronizacja-user-jan', target: '#topbar-user-root' },
        { type: 'show', mock: 'topbar-sync', target: '#topbar-sync-root', props: { pending: true } },
        { type: 'surface', show: 'cockpit' },
        { type: 'click', target: '#topbar-sync-root .topbar-sync-btn' },
        { type: 'modal', open: 'synchronizacja-scm', props: { viewer: 'sam' } },
        { type: 'hover', target: '#synchronizacja-machine-tag', ms: 700 },
      ],
    },
    {
      id: 'synchronizacja-pobierz',
      caption: 'Sam **fetches** — Alex’s files land on his disk decrypted.',
      mascot: 'working',
      actions: [
        narrate('Fetch', 'The down arrow secures Sam’s local changes, pulls the mirror and decrypts it with his key line. A moment later the row is “up to date”, and the “Time log” module shows Alex’s data.'),
        { type: 'click', target: '#synchronizacja-pull-data-tier-0' },
        tick('data-tier-0', 'Starting...', '', 0),
        { type: 'show', mock: 'synchronizacja-mods', target: '#synchronizacja-mods-data-tier-0', mode: 'outer', props: { modules: 'incoming', busy: true } },
        pause(300),
        tick('data-tier-0', 'Encrypting data before sending...', '1 / 3', 33),
        pause(),
        tick('data-tier-0', 'Pulling changes from the data repository...', '2 / 3', 67),
        pause(),
        tick('data-tier-0', 'Decrypting the pulled data...', '3 / 3', 95),
        pause(),
        tick('data-tier-0', 'Synced 09:51', '3 / 3', 100),
        pause(500),
        { type: 'show', mock: 'synchronizacja-group', target: '#synchronizacja-grp-data-tier-0', mode: 'outer', props: { repo: 'data-tier-0', state: { badge: ['green', 'up to date'], send: 0, fetch: 0, local: '04.10 09:51', remote: '04.10 09:44' } } },
        { type: 'show', mock: 'synchronizacja-mods', target: '#synchronizacja-mods-data-tier-0', mode: 'outer', props: { modules: 'done' } },
        { type: 'camera', full: true },
        { type: 'toast', variant: 'success', title: 'Synced' },
        { type: 'show', mock: 'topbar-sync', target: '#topbar-sync-root', props: { pending: false } },
      ],
    },
  ],
};
