// demo/chapters/publishing.mjs
// Chapter `publishing`: Settings > Modules, "Publish" on "Demo reports",
// the publish window (summary, status), the branch + merge request, the
// top-bar MR chip going from 0 to 1 and the merge request page it opens.
// Mocks in demo/mocks/ch-publishing.mjs and demo/mocks/ch-new-module.mjs.

import { narrate, VAULT_OPEN } from './_helpers.mjs';
import { PUBLIKACJA_BRANCH } from '../mocks/ch-publishing.mjs';

const P = '#dm-publikacja-';

export default {
  setup: [
    { type: 'show', mock: 'ustawienia-version', target: '#settings-app-version' },
    { type: 'show', mock: 'ustawienia-sync', target: '#settings-sync-section' },
    { type: 'show', mock: 'ustawienia-theme', target: '#settings-theme-section' },
    { type: 'show', mock: 'nowy-modul-installed', target: '#settings-moduly-installed' },
    { type: 'show', mock: 'katalog-catalog', target: '#settings-moduly-catalog' },
    VAULT_OPEN,
  ],
  steps: [
    {
      id: 'publikacja-wiersz',
      caption: 'I find **Demo reports** in the list of installed modules.',
      mascot: 'thinking',
      camera: 'full',
      actions: [
        narrate('Publishing starts in Settings', 'The module lives in the modules/ folder on this computer, with its own local repository and no remote. The only way to the team is the “Publish” button on the module’s row.'),
        { type: 'navigate', view: 'settings', tab: 'modules' },
        { type: 'camera', target: '#dm-nowy-modul-row-demo-reports', zoom: 1.25 },
        { type: 'hover', target: '#dm-nowy-modul-publish-demo-reports', ms: 900 },
      ],
    },
    {
      id: 'publikacja-formularz',
      caption: 'I click **Publish**, describe the module and confirm its status.',
      mascot: 'idle',
      actions: [
        narrate('Description and status', 'The window collects three things: the business area, a one-sentence description for the catalog and the maturity status. The chosen status goes into module.json, so the row shows the new badge right away.'),
        { type: 'click', target: '#dm-nowy-modul-publish-demo-reports' },
        { type: 'camera', full: true },
        { type: 'modal', open: 'publikacja-modal' },
        { type: 'camera', target: P + 'modal .ds-modal', zoom: 1.35 },
        { type: 'type', target: P + 'summary', text: 'The team’s reports in one place, with a filter by area.' },
        { type: 'click', target: P + 'status-trigger' },
        { type: 'show', mock: 'publikacja-status', target: P + 'status', mode: 'outer', props: { open: true } },
        // The list stays open long enough to read the three statuses.
        { type: 'wait', ms: 700 },
        { type: 'hover', target: P + 'status-opt-1', ms: 600 },
        { type: 'click', target: P + 'status-opt-1' },
        { type: 'show', mock: 'publikacja-status', target: P + 'status', mode: 'outer', props: { status: 'stable' } },
      ],
    },
    {
      id: 'publikacja-wysylka',
      caption: 'I send it — a **branch** and a merge request are created.',
      mascot: 'working',
      actions: [
        narrate('Branch and merge request', 'Mission Deck creates the branch ' + PUBLIKACJA_BRANCH + ' in the shared catalog repository, sends the module files together with an entry in catalog.json and opens a merge request. The catalog’s main branch is protected — nothing goes there directly.'),
        { type: 'click', target: P + 'go' },
        { type: 'show', mock: 'publikacja-go', target: P + 'go', mode: 'outer', props: { busy: true } },
        { type: 'show', mock: 'publikacja-result', target: P + 'result', mode: 'outer', props: { phase: 'sending' } },
        { type: 'wait', ms: 2200 },
        { type: 'show', mock: 'publikacja-result', target: P + 'result', mode: 'outer', props: { phase: 'done' } },
        { type: 'show', mock: 'publikacja-go', target: P + 'go', mode: 'outer' },
        // The result callout made the modal taller: frame it whole again.
        { type: 'camera', target: P + 'modal .ds-modal', zoom: 1.35 },
        { type: 'toast', variant: 'success', title: 'Published', desc: 'The merge request is waiting for review.' },
        { type: 'show', mock: 'nowy-modul-installed', target: '#settings-moduly-installed', props: { demoStatus: 'stable' } },
      ],
    },
    {
      id: 'publikacja-mr',
      caption: 'A **merge request** to review appears on the top bar.',
      mascot: 'working',
      actions: [
        narrate('The merge request counter', 'The “MR:” pill on the top bar counts the open merge requests of the module catalog. After publishing it shows one — waiting for someone on the team to review it.'),
        { type: 'click', target: P + 'cancel' },
        { type: 'modal', close: P + 'modal' },
        { type: 'camera', target: '#dm-nowy-modul-status-demo-reports', zoom: 1.8 },
        { type: 'wait', ms: 800 },
        { type: 'camera', target: '#topbar-mr-root', zoom: 2.2 },
        { type: 'show', mock: 'topbar-mr', target: '#topbar-mr-root', props: { count: 1 } },
        { type: 'hover', target: '#topbar-mr-root .app-top-bar__mr-chip', ms: 900 },
      ],
    },
    {
      id: 'publikacja-przeglad',
      caption: 'I look at the merge request — **Demo reports** is waiting for the team!',
      mascot: 'celebrating',
      actions: [
        narrate('The merge request waits for review', 'The chip opens the merge request in GitLab: the module, the branch, the description and the list of files. Once someone on the team approves it, the module appears in the Catalog of every Mission Deck — like “Time logging” in the next chapter.'),
        { type: 'click', target: '#topbar-mr-root .app-top-bar__mr-chip' },
        { type: 'camera', full: true },
        { type: 'surface', show: 'screen', mock: 'publikacja-mr-screen' },
        { type: 'hover', target: P + 'mr-state', ms: 900 },
      ],
    },
  ],
};
