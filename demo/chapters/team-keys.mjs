// demo/chapters/team-keys.mjs
// Chapter `team-keys`: the data owner (Alex) mints project tokens
// for a new (fictitious) person, Robin, in Settings > Keys ("New GitLab
// tokens"), creates the Bitwarden collection `robin-hart` with ONE secure
// note COCKPIT-KEYS holding the copied KEY=VALUE lines (the server's multi-key
// format) and gives Robin access. The
// encryption key already exists: Alex copies it from the wizard's Step 4 and
// hands it over in a one-time Bitwarden Send. On Robin's side: they take the
// collection over (Alex's access removed), open the Send link, paste the
// key line in "Start here" and the wizard decrypts the source. Bitwarden
// screens are the vault mocks of demo/mocks/onboarding.mjs; the Mission Deck
// ones are in demo/mocks/ch-team-keys.mjs. Nothing is minted, written,
// sent or decrypted.

import { narrate, VAULT_OPEN } from './_helpers.mjs';

const P = '#klucze-dla-zespolu-';

const row = (id, checked = true) => ({ type: 'show', mock: 'klucze-dla-zespolu-repo-row', target: `${P}row-${id}`, mode: 'outer', props: { id, checked } });
const result = (states) => ({ type: 'show', mock: 'klucze-dla-zespolu-result', target: P + 'gtc-body', props: { states } });
const footer = (mock, props) => ({ type: 'show', mock, target: P + 'gtc-footer', props });
const status = (target, props, mode = 'append') => ({ type: 'show', mock: 'klucze-dla-zespolu-status-row', target, mode, props });
const pause = (ms = 450) => ({ type: 'wait', ms });

// The Bitwarden side: fictitious people, the collection named after Robin.
const ALEX = { name: 'Alex Morgan', email: 'alex.morgan@example.com', initials: 'AM' };
const ROBIN = { name: 'Robin Hart', email: 'robin.hart@example.com', initials: 'RH' };
const COLL = 'robin-hart';
/** Alex's own collection, a slug like every collection (first-last). */
const ALEX_COLL = 'alex-morgan';
/** Only what was minted for Robin (PICKED in the mock): the lines "Copy all items" copies. */
const ROBIN_LINES = [
  'COCKPIT_APP_TOKEN=glpat-DEMO••••••',
  'COCKPIT_DATA_TOKEN=glpat-DEMO••••••',
  'COCKPIT_DATA_EXTRA_1_TOKEN=glpat-DEMO••••••',
];
/** The ONE secure note in a person's collection; one KEY=VALUE line per token. */
const KEYS_NOTE = 'COCKPIT-KEYS';
const SEND_NAME = 'Encryption keys for Robin';
const KEY_LINE = 'data-design=DEMO••••••••••••';
const SEND_LINK = 'https://vault.example.test/#/send/DEMO…';
const alexVault = (props) => ({
  view: 'vault', initials: ALEX.initials, email: ALEX.email, shared: false,
  collectionName: COLL, collections: [ALEX_COLL, COLL], ...props,
});
const bwShow = (mock, props) => ({ type: 'show', mock, target: '#onb-bwv-detail', props });
const bwToast = (text) => bwShow('onb-bwv-saved', { text });
const bwHideToast = { type: 'hide', target: '#onb-bwv-toast' };
const member = (m, you) => ({ ...m, you });
export default {
  setup: [
    { type: 'show', mock: 'ustawienia-bw-card', target: '#settings-bitwarden-card', props: { unlocked: true } },
    { type: 'show', mock: 'ustawienia-profile', target: '#settings-profile-card', props: { unlocked: true } },
    { type: 'show', mock: 'ustawienia-activity', target: '#settings-activity-link-card' },
    { type: 'show', mock: 'ustawienia-secrets', target: '#settings-section-grid', props: { unlocked: true } },
    { type: 'show', mock: 'ustawienia-legend', target: '#settings-secret-legend' },
    { type: 'show', mock: 'klucze-dla-zespolu-card', target: '#settings-gitlab-token-card' },
    VAULT_OPEN,
    { type: 'show', mock: 'klucze-dla-zespolu-wizard', target: '#onboarding-wizard-root', props: { side: 'admin' } },
  ],
  steps: [
    {
      id: 'klucze-dla-zespolu-otworz',
      caption: 'Robin joins the team. I open **Keys** in Settings to give them access.',
      mascot: 'wave',
      actions: [
        narrate('A new person on the team', 'Robin Hart starts today. Access is granted by the data maintainer: GitLab project tokens for the repositories and encryption keys for the team data. The Bitwarden vault is open — that is where the owner token comes from, the one Mission Deck uses to create new tokens.'),
        { type: 'navigate', view: 'settings', tab: 'keys' },
        { type: 'scroll', target: P + 'open-btn' },
        { type: 'camera', target: '#settings-gitlab-token-card', zoom: 1.1 },
      ],
    },
    {
      id: 'klucze-dla-zespolu-formularz',
      caption: 'I open the wizard and enter Robin’s **first and last name** — the token name is built from them.',
      mascot: 'working',
      actions: [
        narrate('New GitLab tokens', 'The wizard suggests my own details, so I overwrite them with the new person’s. Each token is created in its own project under the name first-last-SUFFIX and is valid for 12 months.'),
        { type: 'click', target: P + 'open-btn' },
        { type: 'camera', full: true },
        { type: 'modal', open: 'klucze-dla-zespolu-tokens-modal' },
        { type: 'camera', target: P + 'tokens-modal .ds-modal', zoom: 1.15 },
        { type: 'type', target: P + 'first', text: 'Robin' },
        { type: 'type', target: P + 'last', text: 'Hart' },
      ],
    },
    {
      id: 'klucze-dla-zespolu-repozytoria',
      caption: 'I tick the **repositories** Robin should have access to and check the levels.',
      mascot: 'idle',
      actions: [
        narrate('Only what is needed', 'Nothing is ticked up front: I choose the app, the team data and the design data. The leads’ data stays out of reach — that source is for POs only. The Developer level (30) is enough to pull and push.'),
        { type: 'click', target: P + 'cb-app' },
        row('app'),
        { type: 'click', target: P + 'cb-data' },
        row('data'),
        footer('klucze-dla-zespolu-form-footer', { enabled: true }),
        { type: 'scroll', target: P + 'row-data-design' },
        { type: 'click', target: P + 'cb-data-design' },
        row('data-design'),
        { type: 'click', target: P + 'level-data-design', },
        pause(400),
      ],
    },
    {
      id: 'klucze-dla-zespolu-tworzenie',
      caption: 'I click **Create** — the tokens are made one by one, each in its own project.',
      mascot: 'working',
      actions: [
        narrate('Created one by one', 'Mission Deck calls GitLab once per repository, one after the other. An error on one row does not stop the rest. GitLab shows a token’s value only once — here you see its masked beginning.'),
        { type: 'click', target: P + 'submit' },
        result(['busy']),
        footer('klucze-dla-zespolu-progress-footer', { n: 1, total: 3 }),
        pause(),
        result(['done', 'busy']),
        footer('klucze-dla-zespolu-progress-footer', { n: 2, total: 3 }),
        pause(),
        result(['done', 'done', 'busy']),
        footer('klucze-dla-zespolu-progress-footer', { n: 3, total: 3 }),
        pause(),
        result(['done', 'done', 'done']),
        footer('klucze-dla-zespolu-done-footer'),
        { type: 'toast', variant: 'success', title: 'Tokens created', desc: 'Created 3 of 3. Copy them into the vault now.' },
      ],
    },
    {
      id: 'klucze-dla-zespolu-kopiuj-wpis',
      caption: 'I copy **all items** — KEY=token lines, ready for the vault.',
      mascot: 'wave',
      actions: [
        narrate('Into the vault, not a file', '“Copy all items” puts the three KEY=token lines on the clipboard at once. They go into one COCKPIT-KEYS note in the collection I am about to create for Robin — then I clear the clipboard. Mission Deck stores the tokens neither in the vault nor in the .env file.'),
        { type: 'click', target: P + 'copy-all' },
        { type: 'toast', variant: 'success', title: 'Copied', desc: 'Paste these lines into the COCKPIT-KEYS note in Robin’s collection, then clear the clipboard.' },
        pause(600),
        { type: 'click', target: P + 'close' },
        { type: 'modal', close: P + 'tokens-modal' },
        { type: 'camera', full: true },
      ],
    },
    {
      id: 'klucze-dla-zespolu-kolekcja',
      caption: 'In Bitwarden I create a **collection** named after Robin.',
      mascot: 'working',
      actions: [
        narrate('A collection for Robin', 'Each person has their own collection in the organization, named after them: here robin-hart. Only the tokens I created for them go into it.'),
        { type: 'surface', show: 'screen', mock: 'bitwarden-vault-screen', props: alexVault({ collectionName: ALEX_COLL, collections: [ALEX_COLL] }) },
        { type: 'click', target: '#onb-bwv-new' },
        bwShow('onb-bwv-menu'),
        { type: 'click', target: '#onb-bwv-new-collection' },
        bwShow('onb-bwv-coll-form'),
        { type: 'type', target: '#onb-bwv-coll-name', text: COLL },
        { type: 'click', target: '#onb-bwv-coll-save' },
        { type: 'show', mock: 'bitwarden-vault-screen', target: '#onb-bwv-screen', mode: 'outer', props: alexVault({ collection: true, items: [], accessBtn: true }) },
        bwToast('Collection “' + COLL + '” created.'),
      ],
    },
    {
      id: 'klucze-dla-zespolu-wpisy',
      caption: 'In the collection I create one **COCKPIT-KEYS** note and paste the tokens into it.',
      mascot: 'working',
      actions: [
        bwHideToast,
        narrate('One note, many keys', '“New” › “Note”, named COCKPIT-KEYS. In the notes field I paste the copied lines, one per token — Mission Deck reads them all when the vault is unlocked. Only three lines, because only that many tokens were created.'),
        { type: 'camera', full: true },
        { type: 'click', target: '#onb-bwv-new' },
        bwShow('onb-bwv-menu'),
        { type: 'click', target: '#onb-bwv-new-note' },
        bwShow('onb-bwv-form', { kind: 'note', collection: COLL }),
        { type: 'type', target: '#onb-bwv-name', text: KEYS_NOTE },
        { type: 'type', target: '#onb-bwv-note', text: ROBIN_LINES.join('\n') },
        { type: 'click', target: '#onb-bwv-save' },
        { type: 'show', mock: 'onb-bwv-list', target: '#onb-bwv-items', props: { items: [KEYS_NOTE] } },
        bwShow('onb-bwv-saved', { name: KEYS_NOTE, collection: COLL }),
      ],
    },
    {
      id: 'klucze-dla-zespolu-dostep',
      caption: 'I give Robin **access** to the collection — with the right to manage it.',
      mascot: 'idle',
      actions: [
        bwHideToast,
        narrate('Access to the collection', 'On the “Access” tab I add Robin’s address and set “Can manage”. That way Robin takes the collection over and decides who else sees it.'),
        { type: 'click', target: '#onb-bwv-coll-access' },
        bwShow('onb-bwv-access', { collection: COLL, members: [member(ALEX, true)] }),
        { type: 'type', target: '#onb-bwv-access-input', text: ROBIN.email },
        bwShow('onb-bwv-access', { collection: COLL, members: [member(ALEX, true), member(ROBIN, false)] }),
        pause(500),
        { type: 'click', target: '#onb-bwv-access-save' },
        bwToast('Access saved: ' + ROBIN.name + ' — Can manage.'),
      ],
    },
    {
      id: 'klucze-dla-zespolu-kopiuj-klucz',
      caption: 'The encryption key already exists — I copy it in step 4 with the **Copy key** button.',
      mascot: 'thinking',
      actions: [
        narrate('The encryption key', 'No need to create a key: this source has had one for a long time. In the “Start here” wizard, in step 4, every source I have a key for shows “Copy key” — the line goes straight to the clipboard, never to the screen.'),
        { type: 'camera', full: true },
        { type: 'surface', show: 'cockpit' },
        { type: 'navigate', view: 'onboarding-wizard' },
        { type: 'scroll', target: P + 'step4-card' },
        { type: 'camera', target: P + 'key-state', zoom: 1.3 },
        { type: 'click', target: P + 'copykey-data-design' },
        { type: 'toast', variant: 'success', title: 'Key copied to the clipboard - paste it into the note in Bitwarden.' },
      ],
    },
    {
      id: 'klucze-dla-zespolu-send',
      caption: 'I hand the key to Robin in a one-time **Send** — the link expires after one opening.',
      mascot: 'working',
      actions: [
        narrate('Bitwarden Send', 'A Send is an encrypted message for one person: it is deleted after 7 days, opens only once, and the text is hidden by default. I send the link to Robin privately. The key itself never goes in plain text by email or chat — it would stay there for years.'),
        { type: 'camera', full: true },
        { type: 'surface', show: 'screen', mock: 'bitwarden-vault-screen', props: alexVault({ page: 'send' }) },
        { type: 'click', target: '#onb-bwv-send-new' },
        bwShow('onb-bwv-send-menu'),
        { type: 'click', target: '#onb-bwv-send-new-text' },
        bwShow('onb-bwv-send-form'),
        { type: 'type', target: '#onb-bwv-send-name', text: SEND_NAME },
        { type: 'type', target: '#onb-bwv-send-text', text: KEY_LINE },
        { type: 'hover', target: '#onb-bwv-send-max', ms: 700 },
        { type: 'click', target: '#onb-bwv-send-save' },
        { type: 'show', mock: 'onb-bwv-send-list', target: '#onb-bwv-sends', props: { sends: [{ name: SEND_NAME, deletion: '11.10.2026' }] } },
        bwToast('Send “' + SEND_NAME + '” created.'),
        pause(500),
        { type: 'click', target: '#onb-bwv-send-copy' },
        bwToast('Link copied: ' + SEND_LINK),
      ],
    },
    {
      id: 'klucze-dla-zespolu-ola-kolekcja',
      caption: 'Now **Robin’s** computer: they take over the robin-hart collection and remove Alex’s access.',
      mascot: 'wave',
      actions: [
        narrate('A collection for Robin only', 'Robin signs in to Bitwarden and sees the shared collection with their name, with the COCKPIT-KEYS note holding three tokens — they will add their own (Figma, Jira, Confluence) to it later. On the “Access” tab Robin removes Alex: from now on the collection is theirs alone.'),
        { type: 'camera', full: true },
        { type: 'surface', show: 'screen', mock: 'bitwarden-vault-screen', props: { view: 'vault', collection: true, collectionName: COLL, collections: [COLL], shared: true, initials: ROBIN.initials, email: ROBIN.email, items: [KEYS_NOTE], accessBtn: true } },
        pause(600),
        { type: 'click', target: '#onb-bwv-coll-access' },
        bwShow('onb-bwv-access', { collection: COLL, members: [member(ALEX, false), member(ROBIN, true)] }),
        { type: 'click', target: '#onb-bwv-access-remove-am' },
        bwShow('onb-bwv-access', { collection: COLL, members: [member(ROBIN, true)] }),
        pause(500),
        { type: 'click', target: '#onb-bwv-access-save' },
        bwToast('Access saved: collection “' + COLL + '” is now yours alone.'),
      ],
    },
    {
      id: 'klucze-dla-zespolu-ola-send',
      caption: 'Robin opens the **Send** link, reveals the text and copies the key line.',
      mascot: 'thinking',
      actions: [
        narrate('One opening', 'The link leads to the Bitwarden Send page. The text stays hidden until Robin reveals it; after that one view the link stops working.'),
        { type: 'surface', show: 'screen', mock: 'bitwarden-send-view', props: { name: SEND_NAME, text: KEY_LINE } },
        { type: 'camera', target: '#onb-bwv-sv-card', zoom: 1.25 },
        { type: 'click', target: '#onb-bwv-sv-reveal' },
        { type: 'show', mock: 'bitwarden-send-view', target: '#onb-bwv-sendview', mode: 'outer', props: { name: SEND_NAME, text: KEY_LINE, revealed: true } },
        { type: 'camera', target: '#onb-bwv-sv-card', zoom: 1.25 },
        { type: 'click', target: '#onb-bwv-sv-copy' },
        pause(500),
      ],
    },
    {
      id: 'klucze-dla-zespolu-ola-wkleja',
      caption: 'In Mission Deck Robin pastes the **key line** in step 4 of the wizard.',
      mascot: 'working',
      actions: [
        narrate('On the new person’s side', 'Robin has unlocked the vault with their collection — the tokens already work, and they downloaded the team data in the Sync window. In the wizard they see only the sources they have a token for, and paste the line from the Send: the source id, an equals sign, the key.'),
        { type: 'camera', full: true },
        { type: 'surface', show: 'cockpit' },
        { type: 'show', mock: 'klucze-dla-zespolu-user', target: '#topbar-user-root' },
        { type: 'show', mock: 'klucze-dla-zespolu-wizard', target: '#onboarding-wizard-root', props: { side: 'newcomer' } },
        { type: 'scroll', target: P + 'step4-card' },
        { type: 'camera', target: P + 'step4-card', zoom: 1.3 },
        { type: 'type', target: P + 'key-textarea', text: KEY_LINE },
      ],
    },
    {
      id: 'klucze-dla-zespolu-zapis',
      caption: 'Robin clicks **Save keys** — every line is checked and saved separately.',
      mascot: 'idle',
      actions: [
        narrate('Saving the keys', 'Every line is checked and saved separately — a bad line does not block the others. The key lands in the .encryption-key file on Robin’s computer, and the server never sends it back.'),
        { type: 'click', target: P + 'key-save-btn' },
        { type: 'camera', full: true },
        status(P + 'key-rows', { label: 'data-design', tone: 'blue', text: 'Saving...', id: 'klucze-dla-zespolu-save-1' }),
        { type: 'scroll', target: P + 'key-rows' },
        pause(350),
        status('#klucze-dla-zespolu-save-1', { label: 'data-design', tone: 'green', text: 'Saved', id: 'klucze-dla-zespolu-save-1' }, 'outer'),
        pause(500),
        // The saved row becomes the source's own row: one line per source, no duplicate.
        { type: 'hide', target: '#klucze-dla-zespolu-save-1' },
        { type: 'show', mock: 'klucze-dla-zespolu-key-rows', target: P + 'key-state', props: { side: 'newcomer', present: ['data-design'] } },
      ],
    },
    {
      id: 'klucze-dla-zespolu-odszyfrowanie',
      caption: 'The wizard **decrypts** the design data at once — the stream shows every stage.',
      mascot: 'working',
      actions: [
        narrate('Decryption', 'Right after the save the wizard decrypts the sources already on the computer — from the local encrypted copy, without downloading anything. The button in the Sync window does the same when a key arrives later.'),
        { type: 'hide', target: P + 'key-progress', hidden: false },
        { type: 'progress', bar: P + 'key-fill', pct: 0, label: 'Checking which sources are already on this computer...', labelTarget: P + 'key-phase' },
        { type: 'hide', target: P + 'stream', hidden: false },
        { type: 'scroll', target: P + 'stream' },
        { type: 'camera', target: P + 'key-progress', zoom: 1.2 },
        { type: 'progress', label: 'Decrypting 1/1 — Design data...', labelTarget: P + 'key-phase' },
        status(P + 'key-decrypt-rows', { label: 'Design data', tone: 'blue', text: 'Decrypting...', id: 'klucze-dla-zespolu-dec-1' }),
        {
          type: 'progress',
          target: P + 'stream',
          format: 'log',
          lines: [
            { step: 'Design data', detail: 'encrypted copy on disk, 214 files' },
            { step: 'Decrypting file names' },
            { step: 'Decrypting file contents', detail: '214 of 214' },
            { step: 'Done', detail: 'no file was removed' },
          ],
        },
        status('#klucze-dla-zespolu-dec-1', { label: 'Design data', tone: 'green', text: 'Done', msg: 'Decrypted 214 files.', id: 'klucze-dla-zespolu-dec-1' }, 'outer'),
        { type: 'progress', bar: P + 'key-fill', pct: 100, label: 'Data decrypted.', labelTarget: P + 'key-phase' },
      ],
    },
    {
      id: 'klucze-dla-zespolu-gotowe',
      caption: 'Robin has **access** — and no secret went through email or chat.',
      mascot: 'success',
      actions: [
        narrate('Done', 'Step 4 is green. The tokens went through the COCKPIT-KEYS note in Robin’s collection, the key through a one-time Send — both in Bitwarden. When Robin leaves the team, it is enough to delete their collection and revoke the tokens in GitLab.'),
        { type: 'camera', full: true },
        { type: 'scroll', target: P + 'step4-chip' },
        { type: 'badge', target: P + 'step4-chip', tone: 'green', text: 'Done' },
        { type: 'click', target: P + 'step4-chip' },
      ],
    },
  ],
};
