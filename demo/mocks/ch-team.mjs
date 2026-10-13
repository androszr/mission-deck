// demo/mocks/ch-team.mjs
// Painters for chapter `team`: the "Team directory" module page
// (modules/team-directory/client/index.js - toolbar, one card per team with a
// crest logo column and a grid of person tiles, the "Person profile" modal)
// and the core Settings > Users grid and add/edit modal
// (js/settings-uzytkownicy.js). Pure (props) => htmlString, DS classes only.
// Team labels and every person are invented. No photo is
// loaded from team data: initials stand in for every avatar.

import { esc, modalShell } from './common.mjs';
import { modulePage, syncBar } from './ch-time-tracking.mjs';

const VIEW = 'zespol-sklad';

/** Invented roster, grouped by team in display order. */
const ROSTER = [
  { team: 'Atlas', people: [
    ['Alex', 'Morgan', 'Product Owner'], ['Sam', 'Rivera', 'Business analyst'], ['Jordan', 'Lee', 'UX designer'],
    ['Parker', 'Lane', 'Architect'], ['Hayden', 'Cole', 'Developer'],
  ] },
  { team: 'Borealis', people: [
    ['Taylor', 'Kim', 'Product Owner'], ['Morgan', 'Blake', 'Analyst'], ['Casey', 'Novak', 'Developer'],
    ['Rowan', 'Ellis', 'Tester'],
  ] },
  { team: 'Delta', people: [
    ['Avery', 'Quinn', 'Product Owner'], ['Riley', 'Chen', 'Developer'], ['Emerson', 'Gray', 'UX designer'],
    ['Drew', 'Patel', 'Data analyst'],
  ] },
  { team: 'Comet', people: [
    ['Dakota', 'Hale', 'Product Owner'], ['Skyler', 'Reed', 'Analyst'], ['Cameron', 'Shaw', 'Developer'],
  ] },
];

const NEW_PERSON = ['Jules', 'Bennett', 'UX designer', 'Atlas'];
const NEW_EMAIL = 'jules.bennett@example.com';

const _slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '.');
const _mail = (f, l) => _slug(f) + '.' + _slug(l) + '@example.com';
const _ini = (f, l) => (f.charAt(0) + l.charAt(0)).toUpperCase();
const _total = (extra) => ROSTER.reduce((n, t) => n + t.people.length, 0) + (extra ? 1 : 0);

function _tile([first, last, role], team) {
  const name = first + ' ' + last;
  return '<div class="zespol-person-tile" role="button" tabindex="0" aria-label="' + esc(name) + '" data-zespol-person="' + esc(_slug(name)) + '" title="' + esc(name + ' · ' + role + ' · ' + _mail(first, last)) + '">'
    + '<span class="zespol-person-avatar">' + esc(_ini(first, last)) + '</span>'
    + '<span class="zespol-person-caption">' + esc(first + ' ' + last.charAt(0) + '.') + '</span>'
    + '<span class="zespol-person-role">' + esc(role) + '</span>'
    + '<span class="zespol-team-hidden">' + esc(team) + '</span></div>';
}

/**
 * Team crest in the logo column. The real page shows each team's mountain
 * crest from the team data repo (team/logos/<slug>_light.png); the demo has
 * no team data, so it draws the same shape - a shield with a peak and the
 * team name on a ribbon - from DS tokens only.
 */
function _crest(team) {
  return '<svg class="zespol-crest" viewBox="0 0 80 96" role="img" aria-label="' + esc(team) + '">'
    + '<path class="zespol-crest-shield" d="M40 4 L74 20 V52 C74 72 58 86 40 92 C22 86 6 72 6 52 V20 Z"/>'
    + '<path class="zespol-crest-sky" d="M40 10 L68 23 V50 H12 V23 Z"/>'
    + '<path class="zespol-crest-peak" d="M12 50 L32 24 L40 34 L48 22 L68 50 Z"/>'
    + '<path class="zespol-crest-snow" d="M32 24 L37 31 L33 30 L29 33 Z M48 22 L54 31 L49 29 L45 31 Z"/>'
    + '<rect class="zespol-crest-ribbon" x="2" y="52" width="76" height="18" rx="3"/>'
    + '<text class="zespol-crest-label" x="40" y="65" text-anchor="middle">' + esc(team.toUpperCase()) + '</text>'
    + '</svg>';
}

function _teamCard(team, people) {
  return '<div class="ds-card zespol-team-card" data-zespol-team="' + esc(team) + '">'
    + '<div class="zespol-logo-col">' + _crest(team) + '</div>'
    + '<div class="zespol-team-body"><div class="zespol-team-header"><span class="zespol-team-name">' + esc(team) + '</span>'
    + '<span class="ds-badge zespol-team-badge">' + people.length + '</span></div>'
    + '<div class="zespol-people-grid">' + people.map((p) => _tile(p, team)).join('') + '</div></div></div>';
}

/** Toolbar + grid; `query` filters by first name, `joined` adds the new person to Atlas. */
function skladBody({ query = '', joined = false } = {}) {
  const q = query.toLowerCase();
  let shown = 0;
  const cards = ROSTER.map(({ team, people }) => {
    const list = people.concat(joined && team === NEW_PERSON[3] ? [NEW_PERSON] : []);
    const hit = q ? list.filter((p) => (p[0] + ' ' + p[1] + ' ' + p[2]).toLowerCase().includes(q)) : list;
    shown += hit.length;
    return hit.length ? _teamCard(team, hit) : '';
  }).join('');
  return '<div class="zespol-toolbar">'
    + '<input type="text" class="ds-input zespol-search" id="zespol-search" placeholder="Search for a person: first name, last name, role or email" aria-label="Search for a person: first name, last name, role or email" value="' + esc(query) + '">'
    + '<span class="zespol-count" id="zespol-count">Visible people: ' + shown + ' of ' + _total(joined) + '</span></div>'
    + '<div class="zespol-grid" id="zespol-grid">' + cards + '</div>';
}

/** One Settings > Users card, js/settings-uzytkownicy.js _cardHtml. */
function _uzyCard([first, last, role], team, id) {
  const email = _mail(first, last);
  return '<div class="ds-card uzy-card" data-uzy-id="' + esc(id) + '"><div class="uzy-card__top">'
    + '<span class="uzy-card__avatar uzy-card__avatar--initials" aria-hidden="true">' + esc(_ini(first, last)) + '</span>'
    + '<div class="uzy-card__body"><span class="uzy-card__name">' + esc(first + ' ' + last) + '</span>'
    + '<span class="uzy-card__role">' + esc(role) + '</span>'
    + '<div class="uzy-card__meta"><span class="ds-badge ds-badge--gray">' + esc(team) + '</span></div></div>'
    + '<div class="uzy-card__actions"><button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-uzy-edit="' + esc(id) + '">Edit</button></div></div>'
    + '<div class="uzy-card__mail-row"><a class="uzy-card__mail">' + esc(email) + '</a></div></div>';
}

function _field(id, label, value, type = 'text') {
  return '<div class="sett-field-row sett-field-row--stacked"><label for="' + esc(id) + '">' + esc(label) + '</label>'
    + '<input type="' + type + '" class="ds-input" id="' + esc(id) + '" autocomplete="off" value="' + esc(value) + '"></div>';
}

/** Add (`editing` false) or edit modal - one form, as in the core. */
function personModal({ editing = false } = {}) {
  const [f, l, r, t] = editing ? NEW_PERSON : ['', '', '', ''];
  const avatar = editing
    ? '<span class="uzy-card__avatar uzy-card__avatar--initials" aria-hidden="true">' + esc(_ini(f, l)) + '</span>'
    : '<span class="uzy-card__avatar uzy-card__avatar--initials" aria-hidden="true">?</span>';
  return modalShell({
    id: editing ? 'zespol-edit-modal' : 'zespol-add-modal',
    title: editing ? 'Edit person' : 'New person',
    size: 'md zespol-modal-photo',
    body: '<div class="uzy-form-photo"><span class="uzy-form-photo__preview" id="zespol-photo-preview">' + avatar + '</span>'
      + '<div class="uzy-form-photo__actions"><button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" id="zespol-photo-btn"' + (editing ? '' : ' disabled') + '>Upload photo</button>'
      + '<p class="sett-field-hint" id="zespol-photo-hint">' + (editing ? 'PNG, JPG or WEBP, up to 3 MB. The server names the file.' : 'Save the person first — you upload the photo once the entry exists.') + '</p></div></div>'
      + _field(editing ? 'zespol-e-first' : 'zespol-first', 'First name', f)
      + _field(editing ? 'zespol-e-last' : 'zespol-last', 'Last name', l)
      + _field(editing ? 'zespol-e-role' : 'zespol-role', 'Job title', r)
      + _field(editing ? 'zespol-e-team' : 'zespol-team', 'Team', t)
      + _field(editing ? 'zespol-e-email' : 'zespol-email', 'Email', editing ? NEW_EMAIL : '', 'email'),
    footer: '<button type="button" class="ds-btn ds-btn--primary" id="' + (editing ? 'zespol-edit-save' : 'zespol-add-save') + '">Save</button>'
      + '<button type="button" class="ds-btn ds-btn--secondary">Cancel</button>'
      + (editing ? '<span class="uzy-modal-spacer"></span><button type="button" class="ds-btn ds-btn--danger ds-btn--sm">Remove person</button>' : ''),
  });
}

export const MOCKS = {
  'zespol-page': () => modulePage({
    view: VIEW,
    title: 'Team directory',
    subtitle: 'Who belongs to which team and how to reach them',
    bar: syncBar({ view: VIEW, variant: 'success', text: 'Data up to date - local 04.10 08:55, server 04.10 08:40.' }),
    body: skladBody({}),
  }),

  'zespol-sklad-body': (p) => skladBody(p),

  /** "Person profile" - the module's person modal. */
  'zespol-profile-modal': () => modalShell({
    id: 'zespol-profile-modal',
    title: 'Person profile',
    size: 'md',
    body: '<div class="zespol-modal-hero"><span class="zespol-modal-avatar">AM</span>'
      + '<h2 class="zespol-modal-name">Alex Morgan</h2><span class="ds-badge zespol-team-badge">Atlas</span></div>'
      + '<div class="zespol-modal-rows">'
      + '<div class="zespol-modal-row"><span class="zespol-modal-label">Role</span><span>Product Owner</span></div>'
      + '<div class="zespol-modal-row"><span class="zespol-modal-label">Email</span><span class="zespol-modal-mail">alex.morgan@example.com</span></div></div>'
      + '<div class="ds-callout ds-callout--info">A person’s details are changed in Settings > Users.</div>',
    footer: '<a class="ds-btn ds-btn--primary" id="zespol-profile-teams">Message on Teams</a>'
      + '<button type="button" class="ds-btn ds-btn--tertiary" id="zespol-profile-close">Close</button>',
  }),

  /** Settings > Users grid; `added` puts the new person first. */
  'zespol-uzy-grid': ({ added = false } = {}) => {
    const cards = [];
    if (added) cards.push(_uzyCard(NEW_PERSON, NEW_PERSON[3], 'zespol-new'));
    ROSTER.forEach(({ team, people }) => people.forEach((p, i) => cards.push(_uzyCard(p, team, _slug(team) + '-' + i))));
    return cards.join('');
  },

  'zespol-uzy-count': ({ added = false } = {}) => esc(_total(added) + ' people'),

  'zespol-add-modal': () => personModal({ editing: false }),
  'zespol-edit-modal': () => personModal({ editing: true }),

  /** The photo slot after an upload: the server named the file, the demo shows the stamp. */
  'zespol-photo-done': () => '<span class="uzy-card__avatar uzy-card__avatar--initials zespol-photo-new" aria-hidden="true">JB</span>',
  'zespol-photo-hint': () => 'Saved as <code>team/avatars/jules-bennett.png</code> — the server named the file.',
};

export const LABELS = [
  'Team directory', 'Who belongs to which team and how to reach them',
  'Search for a person: first name, last name, role or email', 'Visible people:', 'Person profile', 'Role', 'Email',
  'A person’s details are changed in Settings > Users.', 'Message on Teams', 'Close', 'Edit', 'New person',
  'Edit person', 'Upload photo', 'First name', 'Last name', 'Job title', 'Team', 'Save', 'Cancel', 'Remove person',
  'PNG, JPG or WEBP, up to 3 MB. The server names the file.', 'Save the person first — you upload the photo once the entry exists.',
];
