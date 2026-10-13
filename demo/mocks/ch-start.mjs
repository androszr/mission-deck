// demo/mocks/ch-start.mjs
// Painters for chapter `start`: where the starter package comes from. Nobody
// runs `git clone` - the team publishes `mission-deck-starter.zip` in a shared
// document library, a person downloads it and unpacks it on the local disk.
//   - `start-library`: a neutral document library page (the word SharePoint is
//     plain text, no vendor logo or palette) in the window frame of
//     demo/chapters-css/onboarding.css, site "Mission Deck Team", path
//     Documents > Mission Deck, with the browser's download bubble in its corner.
// Site, address and people are invented. Ids this file creates start with
// `dm-start-`.

import { esc, icon } from './common.mjs';

const P = 'dm-start-';

export const STARTER_ZIP = 'mission-deck-starter.zip';
const STARTER_SIZE = '18.4 MB';

/** The library rows: [kind, name, modified, author, size]. The zip is the one that matters. */
const FILES = [
  ['folder', 'Archive', '12.09.2026', 'Quinn Adams', '—'],
  ['zip', STARTER_ZIP, '04.10.2026', 'Quinn Adams', STARTER_SIZE],
  ['file', 'INSTALL.html', '04.10.2026', 'Quinn Adams', '48 KB'],
  ['file', 'Rollout notes.docx', '29.09.2026', 'Finley Brooks', '112 KB'],
];

const KIND_ICON = { folder: '24-ic-folder', zip: '24-ic-package-m', file: '24-ic-file' };

/** One library row; the zip row carries its own id and a selected state. */
function row({ i = 1, selected = false } = {}) {
  const [kind, name, mod, who, size] = FILES[i] || FILES[1];
  const id = kind === 'zip' ? ` id="${P}row-zip"` : '';
  return `<tr class="${P}row${selected ? ` ${P}row--on` : ''}"${id}>
      <td class="${P}col-check"><span class="${P}check${selected ? ` ${P}check--on` : ''}" aria-hidden="true">${selected ? '✓' : ''}</span></td>
      <td><span class="${P}name">${icon(KIND_ICON[kind], P + 'ico')}<span>${esc(name)}</span></span></td>
      <td>${esc(mod)}</td>
      <td>${esc(who)}</td>
      <td class="${P}col-size">${esc(size)}</td>
    </tr>`;
}

/** The command bar: "Download" waits for a selection, like the real one. */
function actions({ selected = false } = {}) {
  return `<div class="${P}actions" id="${P}actions">
      <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" id="${P}download"${selected ? '' : ' disabled'}>Download</button>
      <button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" id="${P}share"${selected ? '' : ' disabled'}>Share</button>
      <span class="${P}actions-count">${selected ? '1 item selected' : ''}</span>
    </div>`;
}

/** The browser's download bubble: hidden, downloading, or saved in Downloads. */
function downloads({ state = 'none' } = {}) {
  if (state === 'none') return `<div class="${P}dl" id="${P}dl" hidden></div>`;
  const done = state === 'done';
  return `<div class="ds-card ${P}dl" id="${P}dl">
      <div class="ds-card-body">
        <div class="${P}dl-title">Recent downloads</div>
        <div class="${P}dl-row">
          ${icon('24-ic-download', P + 'ico')}
          <div class="${P}dl-main">
            <span class="${P}dl-name">${esc(STARTER_ZIP)}</span>
            ${done
    ? `<span class="${P}dl-meta">${esc(STARTER_SIZE)} · saved in the <strong>Downloads</strong> folder</span>`
    : `<div class="ds-progress-track ${P}dl-track"><div class="ds-progress-fill ds-progress-fill--brand ${P}dl-fill" id="${P}dl-bar"></div></div><span class="${P}dl-meta">Downloading…</span>`}
          </div>
          ${done ? '<span class="ds-badge ds-badge--sm ds-badge--green">Done</span>' : ''}
        </div>
      </div>
    </div>`;
}

/** The whole library page. */
function library({ selected = false, download = 'none' } = {}) {
  return `<div class="onb-screen ${P}screen" id="${P}screen">
      <div class="onb-window ${P}window">
        <div class="onb-window-bar"><span class="onb-window-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="onb-window-title">team.example.test/sites/mission-deck/Documents/Mission-Deck</span></div>
        <div class="${P}page">
          <header class="${P}site">
            <span class="${P}site-mark" aria-hidden="true">MD</span>
            <div class="${P}site-text">
              <span class="${P}site-name">Mission Deck Team</span>
              <span class="${P}site-kind">Team site · SharePoint</span>
            </div>
          </header>
          <nav class="${P}crumbs" aria-label="Path">Documents <span aria-hidden="true">›</span> <strong>Mission Deck</strong></nav>
          ${actions({ selected })}
          <div class="ds-table-wrap"><table class="ds-table ${P}table">
            <thead><tr><th class="${P}col-check"></th><th>Name</th><th>Modified</th><th>Modified by</th><th class="${P}col-size">Size</th></tr></thead>
            <tbody>${FILES.map((_, i) => row({ i, selected: selected && i === 1 })).join('')}</tbody>
          </table></div>
          <p class="${P}hint">The Mission Deck starter package — download it and unpack it on a local disk, outside OneDrive and iCloud.</p>
        </div>
        ${downloads({ state: download })}
      </div>
    </div>`;
}

export const MOCKS = {
  'start-library': (props) => library(props),
  'start-library-row': (props) => row({ i: 1, ...props }),
  'start-library-actions': (props) => actions(props),
  'start-library-downloads': (props) => downloads(props),
};

/** Every visible label these painters paint (copy gate). */
export const LABELS = [
  'Mission Deck Team', 'Team site · SharePoint', 'Documents', 'Mission Deck', 'Download', 'Share',
  '1 item selected', 'Name', 'Modified', 'Modified by', 'Size', 'Archive',
  'Rollout notes.docx', 'Recent downloads', 'Downloading…', 'saved in the Downloads folder', 'Done',
  'The Mission Deck starter package — download it and unpack it on a local disk, outside OneDrive and iCloud.',
];
