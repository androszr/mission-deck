// ── Mission Deck — js/module-menu-groups.mjs ──────────────────────────
// Groups the two module tables in Settings > Modules ("Installed" and
// "Katalog") by the place a module takes in the rail menu. Both tables kept
// growing as one flat list; the menu is the shape a person already knows the
// modules by, so it is the grouping both tables share.
//
// One rule, one source: the group of a module is hubPageTarget() from
// js/module-card.mjs - the same predicate the "Menu placement" badge and
// js/module-host.js read - so a row can never sit in a group whose hub the
// sidebar would not give it. Groups follow the rail order of CORE_HUBS, then
// modules that own a rail entry, then modules with no menu entry at all.
//
// Groups start COLLAPSED on every entry to the tab; a person expands what
// they need. A search or area filter expands every group that has a match,
// because a hit hidden behind a closed group reads as "no results".
//
// No document access: the unit suite imports this file directly. The renderer
// returns a string with every manifest-sourced value escaped, and
// applyMenuGroups() touches only the root element it is handed.

import { escHtml } from './utils.js';
import { CORE_HUBS, coreHubLabel } from './core-hubs.mjs';
import { hubPageTarget } from './module-card.mjs';

export const OWN_ENTRY_GROUP = '__own__';
export const NO_MENU_GROUP = '__none__';

const GROUP_ORDER = [...CORE_HUBS.map(h => h.id), OWN_ENTRY_GROUP, NO_MENU_GROUP];

/**
 * The menu group a manifest lands in.
 * @param {object} manifest
 * @returns {string} a core hub id, OWN_ENTRY_GROUP or NO_MENU_GROUP
 */
export function menuGroupKey(manifest) {
  const hub = hubPageTarget(manifest);
  if (hub) return hub;
  const kind = manifest && manifest.sidebar && manifest.sidebar.kind;
  return kind === 'item' || kind === 'hub' ? OWN_ENTRY_GROUP : NO_MENU_GROUP;
}

/** @param {string} key @returns {string} user-facing label of a group */
export function menuGroupLabel(key) {
  if (key === OWN_ENTRY_GROUP) return 'Own menu entry';
  if (key === NO_MENU_GROUP) return 'Outside the menu';
  return coreHubLabel(key) || key;
}

/**
 * Splits rows into menu groups, in rail order, keeping the row order inside a
 * group. Empty groups are left out.
 * @template T
 * @param {T[]} rows
 * @param {(row: T) => object} manifestOf
 * @returns {{ key: string, label: string, rows: T[] }[]}
 */
export function groupRowsByMenu(rows, manifestOf) {
  const byKey = new Map();
  for (const row of rows) {
    const key = menuGroupKey(manifestOf(row));
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(row);
  }
  return GROUP_ORDER.filter(key => byKey.has(key))
    .map(key => ({ key, label: menuGroupLabel(key), rows: byKey.get(key) }));
}

/**
 * The state of one group header after a filter pass.
 * @param {{ visible: number, total: number, filtering: boolean, open: boolean }} input
 * @returns {{ hidden: boolean, expanded: boolean, countText: string }}
 */
export function menuGroupState({ visible, total, filtering, open }) {
  return {
    hidden: visible === 0,
    expanded: visible > 0 && (filtering || open),
    countText: filtering ? `${visible} z ${total}` : `${total}`,
  };
}

/** The id of the tbody holding a group's rows. */
export function menuGroupBodyId(scope, key) {
  return `${scope}-group-${String(key).replace(/[^a-z0-9-]/gi, '')}`;
}

/**
 * One group as two tbodies: the header (a full-width expand button) and the
 * rows. Collapsed means the rows tbody is `hidden`, so the table keeps one set
 * of columns for every group and the header row never hides itself.
 * @param {{ key: string, label: string, rows: unknown[] }} group
 * @param {{ scope: string, colspan: number, renderRow: (row: any) => string }} opts
 */
export function renderMenuGroup(group, { scope, colspan, renderRow }) {
  const bodyId = menuGroupBodyId(scope, group.key);
  const key = escHtml(group.key);
  return `<tbody class="moduly-group-head" data-menu-group-head="${key}">
      <tr>
        <td colspan="${Number(colspan)}">
          <button type="button" class="ds-row-toggle moduly-group-toggle" aria-expanded="false" aria-controls="${escHtml(bodyId)}" data-menu-group-toggle="${key}">
            <span class="ds-row-toggle-chevron" aria-hidden="true">&#9654;</span>
            <span class="moduly-group-label">${escHtml(group.label)}</span>
            <span class="ds-badge ds-badge--gray" data-menu-group-count>${group.rows.length}</span>
          </button>
        </td>
      </tr>
    </tbody>
    <tbody class="moduly-group-body" id="${escHtml(bodyId)}" data-menu-group-body="${key}" hidden>${group.rows.map(renderRow).join('')}</tbody>`;
}

/**
 * Applies menuGroupState() to every rendered group under `root`. Reads which
 * rows the filter left visible from their `hidden` flag, so it runs AFTER the
 * table's own filter pass. Touches only the elements under `root`.
 * @param {Element} root
 * @param {{ filtering: boolean, openKeys: Set<string> }} opts
 */
export function applyMenuGroups(root, { filtering, openKeys }) {
  for (const head of root.querySelectorAll('[data-menu-group-head]')) {
    const key = head.dataset.menuGroupHead;
    const body = root.querySelector(`[data-menu-group-body="${CSS.escape(key)}"]`);
    if (!body) continue;
    const rows = [...body.children];
    const visible = rows.filter(row => !row.hidden).length;
    const state = menuGroupState({ visible, total: rows.length, filtering, open: openKeys.has(key) });
    head.hidden = state.hidden;
    body.hidden = state.hidden || !state.expanded;
    const toggle = head.querySelector('[data-menu-group-toggle]');
    if (toggle) toggle.setAttribute('aria-expanded', state.expanded ? 'true' : 'false');
    const count = head.querySelector('[data-menu-group-count]');
    if (count) count.textContent = state.countText;
  }
}
