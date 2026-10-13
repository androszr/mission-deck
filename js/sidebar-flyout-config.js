// ── Mission Deck — js/sidebar-flyout-config.js ────────────────────────────
// HUB_FLYOUT: the live map of rail hub -> flyout sub-pages.
//
// The KEYS are core property and come from js/core-hubs.mjs, which is the one
// place a hub is declared - a module can no longer create a rail item of its
// own by declaring `sidebar.kind: "hub"` with an id nobody reviewed. What a
// module DOES fill in is the `items` list: js/module-host.js reads
// GET /api/modules/manifest at boot and appends one item per view of every
// module that declares `sidebar.kind: "page"` plus a `sidebar.hub` naming one
// of these hubs. Seven of the eight ship empty on purpose and stay empty until
// somebody's module puts a page in them.
//
// A key here is a HUB, not a page: js/app.js suppresses navigation on click (it
// opens the flyout instead) and navigate()'s hub guard redirects a direct
// #<hub-key> hash to the dashboard, because no #view-<hub-key> section exists.
//
// The object is built at MODULE-EVALUATION time and mutated per key afterwards,
// never rebuilt. Both halves matter: js/app.js binds every hardcoded rail item
// in index.html as it evaluates and reads HUB_FLYOUT synchronously while doing
// so (a key written later binds the item as a plain page pointing at a section
// that does not exist), and js/module-host.js assigns into `items` in place, so
// an installed module can neither drop a hub nor replace the map.
import { CORE_HUBS } from './core-hubs.mjs';

/** @type {Record<string, { label: string, icon: string, items: Array<{label: string, view: string}> }>} */
export const HUB_FLYOUT = {};

for (const hub of CORE_HUBS) {
  HUB_FLYOUT[hub.id] = {
    label: hub.label,
    icon: hub.icon,
    // A fresh array per hub, so a module appending its pages can never write
    // into the declaration in js/core-hubs.mjs.
    items: (hub.pages || []).map((p) => ({ label: p.label, view: p.view })),
  };
}
