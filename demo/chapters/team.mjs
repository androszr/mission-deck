// demo/chapters/team.mjs
// Chapter `team`: "show the team roster" in the Claude panel, the road
// Team > Team directory (team cards, search, the person modal), then the
// core Settings > Users: a new invented person is added, a photo is
// "uploaded" (the server names the file - the demo only shows the result)
// and the person shows up in the team card. Nothing is written anywhere.

import { narrate } from './_helpers.mjs';

const VIEW = 'zespol-sklad';
const ROOT = '#' + VIEW + '-root';

const say = (text) => ({ type: 'terminal', on: 'cockpit', lines: [{ role: 'assistant', text }] });
const closePanel = { type: 'terminal', on: 'cockpit', close: true };

export default {
  pages: [
    { hub: 'team', view: VIEW, label: 'Team directory', mock: 'zespol-page', initial: false },
  ],
  setup: [
    { type: 'flyout', view: VIEW },
    { type: 'flyout', view: 'czas-pracy-logowanie' },
    { type: 'show', mock: 'zespol-uzy-grid', target: '#settings-uzytkownicy-grid' },
    { type: 'show', mock: 'zespol-uzy-count', target: '#settings-uzytkownicy-count' },
  ],
  steps: [
    {
      id: 'zespol-polecenie',
      caption: 'I ask Claude about the **team roster** and open the module in the Team hub.',
      mascot: 'working',
      actions: [
        narrate('Who is on which team', 'I write in the Claude Code terminal what I am looking for. The answer leads to the “Team directory” module — one card per team, with people, roles and addresses.'),
        {
          type: 'ask',
          text: 'show the team roster',
          then: [
            { type: 'camera', target: '#claude-terminal-panel', zoom: 1.3 },
            say('The team roster is shown by the “Team directory” module in the Team hub — it reads the people directory from the data repository. I do not read that personal data; I am opening the module.'),
            { type: 'wait', ms: 500 },
            { type: 'camera', full: true },
            closePanel,
          ],
        },
        { type: 'navigate', view: VIEW },
      ],
    },
    {
      id: 'zespol-szukaj',
      caption: 'I look for **Alex** — the search narrows the cards at once.',
      mascot: 'thinking',
      actions: [
        narrate('Finding a person', 'The search field looks through the first name, last name, role and email. Only the team cards with a matching person remain, and the counter shows how many people are visible.'),
        { type: 'camera', target: '.zespol-toolbar', zoom: 1.6 },
        { type: 'type', target: '#zespol-search', text: 'Alex' },
        { type: 'show', mock: 'zespol-sklad-body', target: ROOT, props: { query: 'Alex' } },
        { type: 'camera', target: '#zespol-grid', zoom: 1.2 },
        { type: 'wait', ms: 900 },
      ],
    },
    {
      id: 'zespol-profil',
      caption: 'The profile shows the **role and email**; changes are made in Settings.',
      mascot: 'working',
      actions: [
        narrate('The person’s profile', 'The profile window has the role, the address and a button to chat on Teams. The hint at the bottom says it plainly: a person’s details are changed in Settings > Users — that is where I am going next.'),
        { type: 'click', target: '[data-zespol-person="alex.morgan"]' },
        { type: 'modal', open: 'zespol-profile-modal' },
        { type: 'camera', target: '#zespol-profile-modal .ds-modal', zoom: 1.2 },
        { type: 'wait', ms: 900 },
      ],
    },
    {
      id: 'zespol-dodaj',
      caption: 'In Settings > Users I add a **new person** to the team directory.',
      mascot: 'working',
      actions: [
        narrate('A new person in the directory', 'I close the profile and go to Settings > Users. The form has a first name, last name, job title, team and email. The photo is uploaded only after the entry is saved, because the server names the file after the person.'),
        { type: 'click', target: '#zespol-profile-close' },
        { type: 'modal', close: '#zespol-profile-modal' },
        { type: 'camera', full: true },
        { type: 'navigate', view: 'settings', tab: 'users' },
        { type: 'camera', target: '#settings-uzytkownicy-section', zoom: 1.2 },
        { type: 'wait', ms: 600 },
        { type: 'click', target: '#settings-uzytkownicy-add' },
        { type: 'camera', full: true },
        { type: 'modal', open: 'zespol-add-modal' },
        { type: 'camera', target: '#zespol-add-modal .ds-modal', zoom: 1.15 },
        { type: 'type', target: '#zespol-first', text: 'Jules' },
        { type: 'type', target: '#zespol-last', text: 'Bennett' },
        { type: 'type', target: '#zespol-role', text: 'UX designer' },
        { type: 'type', target: '#zespol-team', text: 'Atlas' },
        { type: 'type', target: '#zespol-email', text: 'jules.bennett@example.com' },
        { type: 'camera', target: '#zespol-add-modal .ds-modal-footer', zoom: 1.4 },
        { type: 'click', target: '#zespol-add-save' },
        { type: 'modal', close: '#zespol-add-modal' },
        { type: 'camera', full: true },
        { type: 'toast', variant: 'success', title: 'Saved', desc: 'The changes reach the team on the next sync.' },
        { type: 'show', mock: 'zespol-uzy-grid', target: '#settings-uzytkownicy-grid', props: { added: true } },
        { type: 'show', mock: 'zespol-uzy-count', target: '#settings-uzytkownicy-count', props: { added: true } },
      ],
    },
    {
      id: 'zespol-zdjecie',
      caption: 'I upload a **photo** — the server names the file, not me.',
      mascot: 'idle',
      actions: [
        narrate('The person’s photo', 'Only when an existing entry is edited is the “Upload photo” button active. The server names the file itself and recognises the format from the content — the browser never decides the path.'),
        { type: 'camera', target: '[data-uzy-id="zespol-new"]', zoom: 1.6 },
        { type: 'click', target: '[data-uzy-edit="zespol-new"]' },
        { type: 'camera', full: true },
        { type: 'modal', open: 'zespol-edit-modal' },
        { type: 'camera', target: '#zespol-edit-modal .uzy-form-photo', zoom: 1.8 },
        { type: 'click', target: '#zespol-photo-btn' },
        { type: 'wait', ms: 500 },
        { type: 'show', mock: 'zespol-photo-done', target: '#zespol-photo-preview' },
        { type: 'show', mock: 'zespol-photo-hint', target: '#zespol-photo-hint' },
        { type: 'toast', variant: 'success', title: 'Photo saved', desc: 'Jules Bennett' },
        { type: 'wait', ms: 900 },
      ],
    },
    {
      id: 'zespol-gotowe',
      caption: 'Jules is now on the **Atlas** card — after a sync the whole team will see them.',
      mascot: 'success',
      actions: [
        narrate('The directory goes back to the team', 'I close the window and go back to the “Team directory”: the new person is on their team’s card. Others get it once the changes are pushed in the Sync window.'),
        { type: 'camera', full: true },
        { type: 'click', target: '#zespol-edit-save' },
        { type: 'modal', close: '#zespol-edit-modal' },
        { type: 'navigate', view: VIEW },
        { type: 'show', mock: 'zespol-sklad-body', target: ROOT, props: { joined: true } },
        { type: 'camera', target: '[data-zespol-team="Atlas"]', zoom: 1.6 },
        { type: 'wait', ms: 1000 },
        { type: 'camera', full: true },
      ],
    },
  ],
};
