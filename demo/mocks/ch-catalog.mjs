// demo/mocks/ch-catalog.mjs
// Painters for chapter `catalog`: the "Catalog" half of Settings > Modules
// (js/settings-moduly-katalog.js _renderHeader / _renderRow /
// _renderRestartCallout with js/module-card.mjs cells), the "You are installing
// someone else's module" warning (_confirmNoIsolation). Every catalog module comes
// with its business area already assigned, so the install asks for none.
// Module names are the team's catalog; versions and authors are invented. Ids start with `dm-katalog-`.

import { esc, modalShell } from './common.mjs';
import { dsSelect } from './ch-new-module.mjs';

const P = 'dm-katalog-';
const DS_ICONS = '/assets/icons/ds/';

const MATURITY = {
  stable: '<span class="ds-badge ds-badge--green">stable</span>',
  beta: '<span class="ds-badge ds-badge--yellow">beta</span>',
};

/** catalog.json entries as GET answers them, plus this machine's row state. */
const CATALOG = [
  { id: 'sprint-planning', name: 'Sprint planning', version: '1.4.0', status: 'stable', area: 'Engineering', menu: 'Initiatives (1)', state: 'installed' },
  { id: 'roadmap', name: 'Product roadmap', version: '2.1.0', status: 'stable', area: 'Product', menu: 'Initiatives (1)', state: 'available' },
  { id: 'time-off', name: 'Time off', version: '0.1.2', status: 'stable', area: 'Product', menu: 'Support (1)', state: 'available' },
  { id: 'time-log', name: 'Time logging', version: '0.1.3', status: 'beta', area: 'Product', menu: 'Team (1)', state: 'available', icon: '24-ic-clock' },
  { id: 'locations', name: 'Locations', version: '1.2.0', status: 'stable', area: 'Operations', menu: 'Apps (1)', state: 'available' },
  { id: 'meeting-transcripts', name: 'Meeting transcripts', version: '0.3.1', status: 'beta', area: 'Product', menu: 'Knowledge (1)', state: 'installed' },
];

function actionButton(m, state) {
  const id = m.id === 'time-log' ? ` id="${P}install-${m.id}"` : '';
  if (state === 'available') return `<button type="button" class="ds-btn ds-btn--primary ds-btn--sm"${id}>Install</button>`;
  if (state === 'update-available') return '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm">Update</button>';
  return `<button type="button" class="ds-btn ds-btn--primary ds-btn--sm"${id} disabled>Installed</button>`;
}

function row(m, installedTimeLog) {
  const state = m.id === 'time-log' && installedTimeLog ? 'installed' : m.state;
  const area = m.area
    ? `<span class="ds-badge ds-badge--blue">${esc(m.area)}</span>`
    : '<span class="ds-badge ds-badge--yellow">Area not set</span>';
  return `
    <tr class="moduly-row"${m.id === 'time-log' ? ` id="${P}row-${m.id}"` : ''}>
      <td><span class="moduly-row-name">
        <span class="moduly-row-icon" aria-hidden="true"><img src="${DS_ICONS}${m.icon || '24-ic-folder'}.svg" alt=""></span>
        <span class="moduly-row-name-text"><strong class="moduly-row-title">${esc(m.name)}</strong><code class="moduly-card-id">${esc(m.id)}</code></span>
      </span></td>
      <td class="moduly-cell-version">${esc(m.version)}</td>
      <td><span class="moduly-cell-badges">${MATURITY[m.status]}</span></td>
      <td><span class="moduly-cell-badges">${area}</span></td>
      <td><span class="moduly-cell-badges"><span class="ds-badge ds-badge--gray">${esc(m.menu)}</span></span></td>
      <td class="right"><span class="moduly-row-actions">
        <button type="button" class="ds-icon-btn ds-icon-btn--sm" data-tip="Details" aria-label="Details"><span class="moduly-action-ico moduly-action-ico--info" aria-hidden="true"></span></button>
        ${actionButton(m, state)}
      </span></td>
    </tr>`;
}

/**
 * The whole Catalog slot.
 * @param {{ query?: string, installedTimeLog?: boolean, restartCallout?: boolean, restarting?: boolean }} props
 */
function catalog({ query = '', installedTimeLog = false, restartCallout = false, restarting = false } = {}) {
  const q = query.trim().toLowerCase();
  const rows = CATALOG.filter((m) => !q || m.name.toLowerCase().includes(q) || m.id.includes(q));
  const count = q ? `${rows.length} of ${CATALOG.length}` : String(CATALOG.length);
  const callout = restartCallout ? `<div class="ds-callout ds-callout--success modules-catalog-restart" id="${P}restart-callout">
      <div>The module is on disk. The change takes effect after a server restart.</div>
      <button type="button" class="ds-btn ds-btn--primary ds-btn--sm" id="${P}restart-btn"${restarting ? ' disabled' : ''}>${restarting ? 'Restarting...' : 'Restart'}</button>
    </div>` : '';
  return `<div class="modules-catalog-head" id="${P}head">
      <div class="modules-catalog-header">
        <h3 class="modules-catalog-title">Catalog</h3>
        <button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm">Refresh catalog</button>
      </div>
      <div class="moduly-search-row">
        <input type="search" class="ds-input moduly-search" id="${P}search" value="${esc(query)}" placeholder="Search the catalog by name, id, author or tag..." aria-label="Search the module catalog" autocomplete="off">
        <div class="moduly-area-select">${dsSelect({ id: P + 'filter-area', text: 'All areas', label: 'Area of the modules in the catalog' })}</div>
        <span class="moduly-search-count" aria-live="polite" id="${P}count">${count}</span>
      </div>
    </div>${callout}
    <div class="ds-table-wrap moduly-table-wrap" id="${P}table"><table class="ds-table moduly-table">
      <thead><tr><th>Module</th><th>Version</th><th>Status</th><th>Area</th><th>Place in the menu</th><th class="right">Actions</th></tr></thead>
      <tbody>${rows.map((m) => row(m, installedTimeLog)).join('')}</tbody>
    </table></div>`;
}

export const MOCKS = {
  'katalog-catalog': (props) => catalog(props),

  /** _confirmNoIsolation: footer order as the real modal draws it. */
  'katalog-warning-modal': () => modalShell({
    id: P + 'warning-modal',
    title: 'You are installing someone else’s module',
    body: '<div class="ds-callout ds-callout--warning"><div>The <strong>time-log</strong> module runs without isolation — it runs its author’s code with full permissions, both in the browser and in the server process.</div></div>',
    footer: `<button type="button" class="ds-btn ds-btn--tertiary">Cancel</button><button type="button" class="ds-btn ds-btn--danger" id="${P}warning-ok">Install anyway</button>`,
  }),

};

/** Every visible label these painters paint (copy gate). */
export const LABELS = [
  'Catalog', 'Refresh catalog', 'Install', 'Update', 'Installed', 'Area not set', 'stable', 'beta',
  'Restart', 'The module is on disk. The change takes effect after a server restart.',
  'You are installing someone else’s module', 'Install anyway', 'Cancel', 'Area of the modules in the catalog', ...CATALOG.map((m) => m.name),
];
