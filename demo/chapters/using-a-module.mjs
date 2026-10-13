// demo/chapters/using-a-module.mjs
// Chapter `using-a-module`: everyday work with an installed module - Team >
// "Time logging", a team filter, the module sync bar saying the server has
// newer data, "Data sync" pulling the source, and the heatmap
// repainting. The page is declared in demo/chapters/catalog.mjs; mocks in
// demo/mocks/ch-using-a-module.mjs.

import { narrate, VAULT_OPEN } from './_helpers.mjs';

const P = '#dm-uzycie-modulu-';
const body = (props = {}) => ({ type: 'show', mock: 'uzycie-modulu-body', target: P + 'root', props });
const table = (props = {}) => ({ type: 'show', mock: 'uzycie-modulu-sync-table', target: P + 'scm-body', props });

export default {
  setup: [
    VAULT_OPEN,
    { type: 'flyout', view: 'katalog-time-log' },
  ],
  steps: [
    {
      id: 'uzycie-otworz',
      caption: 'I open **Time logging** from the Team hub.',
      mascot: 'wave',
      camera: 'full',
      actions: [
        narrate('The module page', 'An installed module is an ordinary page in a hub. Below the header sits the sync bar: it says whether the module’s data on this computer is up to date, and it only opens the sync window — it sends nothing by itself.'),
        { type: 'navigate', view: 'katalog-time-log' },
        { type: 'camera', target: P + 'msb', zoom: 1.25 },
        { type: 'wait', ms: 900 },
        { type: 'camera', target: P + 'grid', zoom: 1.15 },
      ],
    },
    {
      id: 'uzycie-filtr',
      caption: 'I narrow the view to one **team** and go back to all of them.',
      mascot: 'working',
      actions: [
        narrate('The team filter', 'The team switch narrows the grid to a few people, and the counter shows how many rows are left. Red cells are days with no time logged; the button next to a person prepares a Teams message.'),
        { type: 'camera', full: true },
        { type: 'click', target: P + 'team-1' },
        body({ team: 'Atlas' }),
        { type: 'camera', target: P + 'root', zoom: 1.3 },
        { type: 'wait', ms: 1100 },
        { type: 'click', target: P + 'clear' },
        body(),
        { type: 'camera', full: true },
      ],
    },
    {
      id: 'uzycie-sync',
      caption: 'The server has newer data — I open **sync**.',
      mascot: 'working',
      actions: [
        narrate('The sync window', 'The bar says three files are waiting on the server. The sync window shows the “Team data” source expanded into modules — the “Time logging” row is “To pull”.'),
        { type: 'click', target: P + 'msb-open' },
        { type: 'modal', open: 'uzycie-modulu-sync-modal' },
        { type: 'camera', target: P + 'scm .ds-modal', zoom: 1.2 },
      ],
    },
    {
      id: 'uzycie-pobierz',
      caption: 'I pull the data — Mission Deck **decrypts** it on the spot.',
      mascot: 'working',
      actions: [
        narrate('Pulling the whole source', 'The “Pull” button next to a module pulls the whole source — a partial pull could look like deleted files on the next push. The files arrive encrypted and are decrypted locally.'),
        { type: 'camera', target: P + 'scm-module-row', zoom: 1.6 },
        { type: 'click', target: P + 'scm-pull' },
        table({ progress: { step: 'Pulling changes from the server', pct: 35 } }),
        { type: 'wait', ms: 900 },
        table({ progress: { step: 'Decrypting files', pct: 75 } }),
        { type: 'wait', ms: 900 },
        table({ progress: { step: 'Synced 09:12', pct: 100 } }),
        { type: 'wait', ms: 700 },
        table({ done: true }),
        { type: 'toast', variant: 'success', title: 'Synced', desc: 'Team data: 3 files pulled.' },
        { type: 'camera', target: P + 'scm .ds-modal', zoom: 1.2 },
      ],
    },
    {
      id: 'uzycie-gotowe',
      caption: 'I close the window — the grid **refreshes** itself with the new data.',
      mascot: 'celebrating',
      actions: [
        narrate('The view after the pull', 'A successful pull notifies the open view, and the module page repaints from the new files. The sync bar is green, and Friday’s column has filled with logged time.'),
        { type: 'click', target: P + 'scm-ok' },
        { type: 'modal', close: P + 'scm' },
        { type: 'camera', full: true },
        { type: 'show', mock: 'uzycie-modulu-msb', target: P + 'msb', mode: 'outer', props: { state: 'current' } },
        body({ fresh: true }),
        { type: 'camera', target: P + 'grid', zoom: 1.2 },
        { type: 'wait', ms: 900 },
        { type: 'camera', full: true },
      ],
    },
  ],
};
