// demo/chapters/catalog.mjs
// Chapter `catalog`: Settings > Modules > Catalog - search, "Install"
// on "Time logging", the no-isolation warning (the business area comes
// already assigned from the catalog), the restart, and the new page in the Team hub. Mocks in demo/mocks/ch-catalog.mjs;
// the module page itself is painted by demo/mocks/ch-using-a-module.mjs.

import { narrate, VAULT_OPEN } from './_helpers.mjs';

const P = '#dm-katalog-';

/** The installed module's page, shared with chapter `using-a-module`. */
export const TIME_LOG_PAGE = {
  hub: 'team',
  view: 'katalog-time-log',
  label: 'Time logging',
  mock: 'uzycie-modulu-page',
  initial: false,
};

const catalog = (props = {}) => ({ type: 'show', mock: 'katalog-catalog', target: '#settings-moduly-catalog', props });

export default {
  pages: [TIME_LOG_PAGE],
  setup: [
    { type: 'show', mock: 'ustawienia-version', target: '#settings-app-version' },
    { type: 'show', mock: 'ustawienia-sync', target: '#settings-sync-section' },
    { type: 'show', mock: 'ustawienia-theme', target: '#settings-theme-section' },
    // "Demo reports" was published in the previous chapter: it stays installed here.
    { type: 'show', mock: 'nowy-modul-installed', target: '#settings-moduly-installed', props: { demoStatus: 'stable' } },
    catalog(),
    VAULT_OPEN,
  ],
  steps: [
    {
      id: 'katalog-przeglad',
      caption: 'I browse the module **Catalog** and look for time logging.',
      mascot: 'thinking',
      camera: 'full',
      actions: [
        narrate('The team’s module catalog', 'Below the list of installed modules is the Catalog — modules other people have published. A row shows the version, maturity, area and place in the menu. The search filters by name, id, author and tags.'),
        { type: 'navigate', view: 'settings', tab: 'modules' },
        { type: 'scroll', target: P + 'head' },
        { type: 'camera', target: P + 'head', zoom: 1.4 },
        { type: 'type', target: P + 'search', text: 'time' },
        catalog({ query: 'time' }),
        { type: 'camera', target: P + 'table', zoom: 1.25 },
      ],
    },
    {
      id: 'katalog-ostrzezenie',
      caption: 'I click **Install** — Mission Deck honestly warns about someone else’s code.',
      mascot: 'idle',
      actions: [
        narrate('A module runs without isolation', 'A module runs its author’s code with full permissions — in the browser and on the server. That is why Mission Deck asks plainly before installing whether you trust this module.'),
        { type: 'click', target: P + 'install-time-log' },
        { type: 'camera', full: true },
        { type: 'modal', open: 'katalog-warning-modal' },
        { type: 'camera', target: P + 'warning-modal .ds-modal', zoom: 1.4 },
      ],
    },
    {
      id: 'katalog-instalacja',
      caption: 'I confirm the installation and the module **lands on disk**.',
      mascot: 'working',
      actions: [
        narrate('The module on disk', 'The business area comes from the catalog together with the module — I assign nothing by hand. The module goes into the modules/ folder, and a green message suggests a restart.'),
        { type: 'click', target: P + 'warning-ok' },
        { type: 'modal', close: P + 'warning-modal' },
        { type: 'camera', full: true },
        catalog({ query: 'time', installedTimeLog: true, restartCallout: true }),
        { type: 'toast', variant: 'success', title: 'Module installed', desc: 'Restart the server for it to start working.' },
        { type: 'camera', target: P + 'restart-callout', zoom: 1.25 },
      ],
    },
    {
      id: 'katalog-gotowe',
      caption: 'I restart the server and **Time logging** waits in the Team hub.',
      mascot: 'success',
      actions: [
        narrate('A new page in the menu', 'After the restart the module is loaded: the Team hub has a new item “Time logging”. An installed module lives only on this computer, and its data travels through the team data repository.'),
        { type: 'click', target: P + 'restart-btn' },
        catalog({ query: 'time', installedTimeLog: true, restartCallout: true, restarting: true }),
        { type: 'wait', ms: 1600 },
        catalog({ installedTimeLog: true }),
        { type: 'flyout', view: 'katalog-time-log' },
        { type: 'camera', full: true },
        { type: 'navigate', view: 'katalog-time-log' },
        { type: 'camera', target: '#view-katalog-time-log .page-header', zoom: 1.3 },
        { type: 'wait', ms: 600 },
        { type: 'camera', full: true },
      ],
    },
  ],
};
