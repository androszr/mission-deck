// ── Mission Deck — js/core-hubs.mjs ─────────────────────────────────────────
// The rail's hubs, and the ONE place they are declared.
//
// A hub belongs to the CORE, not to a module. Before this file every installed
// module that declared `sidebar.kind: "hub"` grew its own top-level rail item,
// so the menu was a list of whoever had shipped a module - and two modules
// covering the same area (leave calendar, on-call roster) could never share one
// flyout, because a hub was owned by exactly one module directory. The eight
// rows below are the fixed shape of the menu instead: a module declares WHICH
// hub its pages land in (`sidebar.kind: "page"` plus `sidebar.hub`), and the
// hub itself is not something a module can create. Somebody who needs a new
// hub asks for it here - or builds a multi-view module, which still gets its
// own flyout under `kind: "hub"`.
//
// DOM-free on purpose: the unit suite imports this file directly, and it is the
// source `js/sidebar-flyout-config.js` builds HUB_FLYOUT from at
// module-evaluation time. That timing is load-bearing - js/app.js binds every
// hardcoded rail item synchronously as it evaluates and reads HUB_FLYOUT while
// doing so, so a hub that appeared later would be bound as a plain page and
// navigate to a section that does not exist.
//
// `id` is ASCII (it is a hash route, a HUB_FLYOUT key and a reserved module id),
// `label` is English copy. `pages` are the views the CORE itself ships in that
// hub; everything else arrives from a module manifest at boot.
//
// Two rules for anyone adding a row:
//   1. A hub has NO `#view-<id>` section. js/app.js treats a HUB_FLYOUT key
//      that has a section as a page, so the rail item would open the section
//      instead of the flyout.
//   2. The id must also be reserved in RESERVED_MODULE_IDS - server.js and
//      scripts/new-module.js - or a module could claim it. `CORE_HUB_IDS` in
//      server.js is the second copy of this list; tests/test_core_hubs.mjs is
//      the gate that keeps the two identical, the same way the two copies of
//      RESERVED_MODULE_IDS have always been kept.

/**
 * @typedef {{ label: string, view: string }} HubPage
 * @typedef {{ id: string, label: string, icon: string, pages?: HubPage[] }} CoreHub
 */

/** @type {CoreHub[]} - rail order, top to bottom. */
export const CORE_HUBS = [
  { id: 'team', label: 'Team', icon: '24-ic-user' },
  { id: 'activity', label: 'Activity', icon: '24-ic-sales-report' },
  { id: 'finance', label: 'Finance', icon: '24-ic-calendar-with-money' },
  { id: 'initiatives', label: 'Initiatives', icon: '24-ic-flag' },
  { id: 'support', label: 'Support', icon: '24-ic-help' },
  { id: 'knowledge', label: 'Knowledge', icon: '24-ic-e-learning' },
  {
    // The id stays 'assets' while the label reads "Design": the four views,
    // their #view-assets-* sections and the /api/assets/mascot route were all
    // named before the hub was, and renaming them would move a hash route
    // people already have open for the sake of one word in the rail.
    id: 'assets',
    label: 'Design',
    icon: '24-ic-star-simple',
    pages: [
      { label: 'Design System', view: 'assets-design-system' },
      { label: 'Icons', view: 'assets-icons' },
      { label: 'Illustrations', view: 'assets-illustrations' },
      { label: 'Mascot', view: 'assets-mascot' },
      { label: 'Prototypes', view: 'prototypy' },
    ],
  },
  { id: 'apps', label: 'Apps', icon: '24-ic-phone' },
];

/** @type {string[]} */
export const CORE_HUB_IDS = CORE_HUBS.map((h) => h.id);

/**
 * Whether `id` names a core hub - the check a module manifest's `sidebar.hub`
 * has to pass before its pages reach a flyout.
 * @param {*} id
 * @returns {boolean}
 */
export function isCoreHub(id) {
  return typeof id === 'string' && CORE_HUB_IDS.includes(id);
}

/**
 * The hub row, or null.
 * @param {*} id
 * @returns {CoreHub|null}
 */
export function coreHub(id) {
  return CORE_HUBS.find((h) => h.id === id) || null;
}

/**
 * A hub's label, for copy that names it ("Page in the Design hub"). Falls back
 * to the id so an unknown hub still reads as something.
 * @param {*} id
 * @returns {string}
 */
export function coreHubLabel(id) {
  const hub = coreHub(id);
  return hub ? hub.label : String(id || '');
}
