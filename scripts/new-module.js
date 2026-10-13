#!/usr/bin/env node
'use strict';
// scripts/new-module.js
// Scaffolds a complete plug & play module in one command. The core gets
// scripts/new-view.js and scripts/new-endpoint.js; modules are where the team
// actually builds, and until now they were the one surface with no generator -
// every author copied modules-template/ by hand and wired module.json himself.
//
//   node scripts/new-module.js orders "Orders"
//   node scripts/new-module.js raporty "Raporty" --views lista:Lista,archiwum:Archiwum
//   node scripts/new-module.js prosty "Prosty" --no-server --dry-run
//
// Writes modules/<id>/:
//   module.json        manifest (schemaVersion 1, one views[] entry per view)
//   client/index.js    ES module exporting `views` - one init/render per view
//   client/style.css   own stylesheet, DS tokens only
//   server/index.js    register(ctx) returning { routes } (unless --no-server)
//   tests/test_<id>.mjs  contract test - npm test picks it up automatically
//   README.md          what to fill in next
//
// The id and the view ids are validated with server.js's own MODULE_ID_RE and
// RESERVED_MODULE_IDS, so the scaffold can never produce a manifest that
// validateModuleManifest() would reject at load time.
//
// Idempotent: it refuses rather than overwriting an existing module directory.
//
// Exit: 0 written (or dry-run printed), 1 refused (already exists), 2 usage.

const fs = require('fs');
const path = require('path');
const R = require('./_report');
const MG = require('./_module-git.js');

const HELP = `
new-module.js - scaffold a complete plug & play module in one command

Usage:
  node scripts/new-module.js <module-id> "<Label>" --area "<Obszar>"
                             [--views <id>:<Label>[,<id>:<Label>...]]
                             [--icon <ds-icon-slug>] [--hub <hub-id>]
                             [--data "<repo>[:<paths>][:read][;<repo>...]"]
                             [--widgets "<id>:<Label>[:<presets>][;<id>:<Label>...]"]
                             [--no-server] [--no-git]
                             [--dry-run] [--root <dir>] [--json]

  <module-id>  kebab-case ASCII, matches the directory name, e.g. zamowienia
  <Label>      sidebar label and module name (English copy; any Unicode is allowed)
  --area       REQUIRED business area the module belongs to, independent of
               --hub (that is where it lives in the menu, this is what it is
               about) - e.g. "Product", "Engineering", "Operations" or any
               other open-list name, 2..40 characters. No default: an author
               names the real area, this script never guesses one.
  --views      one entry per view; the module id is prefixed automatically, so
               "lista:Lista" becomes the view id "<module-id>-lista".
               Two or more views produce sidebar.kind "hub"; the default is a
               single view "<module-id>-main" with kind "item".
  --icon       Design System icon slug (default: 24-ic-folder)
  --hub        put the module's views into a CORE hub's flyout instead of
               giving the module its own rail item - sidebar.kind "page".
               One of: team, activity, finance, initiatives, support,
               knowledge, assets, apps (js/core-hubs.mjs). This is the normal
               shape: a hub belongs to the core, so a module adds PAGES to
               one. Without it the module gets its own rail entry, which is
               for a self-contained multi-view tool.
  --data       declare the team data the module touches in module.json
               dataRepos[] - ONE value, entries separated by ";". Each entry is
               <repoId>[:<path>[,<path>...]][:read]. A repo alone means the
               module WRITES "<module-id>/" there; paths narrow it; a trailing
               ":read" makes it a read-only view (access "read": a row and a
               status bar in the sync window, but no push - and paths are
               then required). Repo ids: data-tier-0 (the team data repo,
               ds-data) plus any source added to DATA_REPO_DEFS. Examples:
                 --data "data-tier-0"
                 --data "data-tier-0:team/:read"
  --widgets    dashboard tiles for the module: manifest widgets[] plus a stub
               client/widget.js. ONE value, entries separated by ";", each
               <id>:<Label>[:<preset>[,<preset>...]]. Presets (size on the
               6-column grid): s = Small 2x1, s2 = Small, tall 2x2,
               m = Medium 3x1, m2 = Medium, tall 3x2, l = Wide 6x1,
               xl = Wide, tall 6x2. Default presets: s,m,l; the default
               variant is m when present, else the first. Without the flag the
               manifest has no widgets and the core shows a shortcut tile.
                 --widgets "overview:Overview:s,m"
  --no-server  client-only module - no server/index.js, no server entry
  --no-git     skip "git init" + the first commit - the module ships with no
               local repository at all (scripts/_module-git.js)

Exit codes: 0 ok, 1 refused (the module already exists), 2 usage error.
`;

// The id rules, mirrored from server.js rather than required from it: a
// scaffold must keep working while server.js is mid-edit, and requiring an
// 8500-line file to read two constants makes this script fail for reasons that
// have nothing to do with it. tests/test_new_module.mjs reads the literals out
// of server.js as text and fails the moment these two drift apart.
const MODULE_ID_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
// The rail's eight hubs, mirrored from js/core-hubs.mjs under the same rule as
// the two constants above - that file is ESM and run() is sync, so it cannot be
// imported here. Two jobs: --hub is checked against it, and every hub id is
// also RESERVED, because a module directory named after a hub would shadow the
// rail item and take over its hash route. tests/test_core_hubs.mjs fails the
// moment this list and the declaration drift apart.
const CORE_HUB_IDS = ['team', 'activity', 'finance', 'initiatives', 'support', 'knowledge', 'assets', 'apps'];
const RESERVED_MODULE_IDS = new Set([
  'dashboard', 'settings', 'api', 'modules', 'm', 'onboarding-wizard', 'academy',
  ...CORE_HUB_IDS,
]);

// The data repo route ids a dataRepos[].name may carry, mirrored from
// server.js (DATA_REPO_DEFS ids plus DATA_TIER_0_NAME) under the same rule as
// CORE_HUB_IDS above. tests/test_new_module.mjs reads both out of server.js as
// text and fails the moment this list drifts.
const DATA_REPO_IDS = ['data-tier-0'];

// Business-area validation, mirrored from server.js's validateModuleArea /
// MODULE_AREA_MAX rather than required from it, same reasoning as
// MODULE_ID_RE above. tests/test_new_module.mjs keeps the two in step.
const MODULE_AREA_MAX = 40;
const MODULE_AREA_CHARS_RE = /^[\p{L}\p{N} \-.&+/]+$/u;

/**
 * Mirrors server.js validateModuleArea: control character rejected on the
 * RAW value first, THEN trim/collapse, THEN length and character-set checks.
 * @param {unknown} v
 * @returns {{ok: true, value: string} | {ok: false, error: string}}
 */
function validateAreaArg(v) {
  if (typeof v !== 'string') return { ok: false, error: 'area must be a string' };
  if (/[\u0000-\u001f\u007f]/.test(v)) return { ok: false, error: 'area must not contain control characters' };
  const value = v.trim().replace(/ {2,}/g, ' ');
  if (value.length < 2 || value.length > MODULE_AREA_MAX) {
    return { ok: false, error: 'area must be 2..' + MODULE_AREA_MAX + ' characters' };
  }
  if (!MODULE_AREA_CHARS_RE.test(value)) {
    return { ok: false, error: 'area contains characters that are not letters, digits, space or - . & + /' };
  }
  return { ok: true, value };
}

// Size presets for --widgets. Ids are ASCII, labels are UI copy. The sizes are
// a closed set mirrored from server.js (WIDGET_COLS 2/3/6, WIDGET_ROWS 1/2):
// styles.css has classes for exactly these spans.
const WIDGET_VARIANT_PRESETS = {
  s: { label: 'Small', cols: 2, rows: 1 },
  s2: { label: 'Small, tall', cols: 2, rows: 2 },
  m: { label: 'Medium', cols: 3, rows: 1 },
  m2: { label: 'Medium, tall', cols: 3, rows: 2 },
  l: { label: 'Szeroki', cols: 6, rows: 1 },
  xl: { label: 'Szeroki, wysoki', cols: 6, rows: 2 },
};

/**
 * Parse --widgets into manifest widgets[] entries.
 * Format: `<id>:<Label>[:<preset>[,<preset>...]]`, entries separated by ";".
 * @param {string|true|undefined} spec
 * @returns {object[]} [] when the flag is absent
 */
function parseWidgets(spec) {
  if (spec === undefined) return [];
  if (spec === true) throw new Error('--widgets needs a value, e.g. --widgets "overview:Overview:s,m"');
  const out = [];
  for (const raw of String(spec).split(';').map((x) => x.trim()).filter(Boolean)) {
    const parts = raw.split(':').map((x) => x.trim());
    if (parts.length > 3) throw new Error('--widgets entry "' + raw + '" has too many ":" segments');
    const wid = parts[0];
    const wlabel = parts[1];
    if (!MODULE_ID_RE.test(wid)) {
      throw new Error('widget id "' + wid + '" is not a slug (expected ' + MODULE_ID_RE.source + ')');
    }
    if (!wlabel) throw new Error('--widgets entry "' + raw + '" has no label (<id>:<Label>)');
    if (out.some((w) => w.id === wid)) throw new Error('duplicate widget id "' + wid + '"');
    const presets = parts[2] ? parts[2].split(',').map((x) => x.trim()).filter(Boolean) : ['s', 'm', 'l'];
    if (presets.length === 0) throw new Error('--widgets entry "' + raw + '" has an empty preset list');
    for (const pr of presets) {
      if (!Object.prototype.hasOwnProperty.call(WIDGET_VARIANT_PRESETS, pr)) {
        throw new Error('unknown widget preset "' + pr + '" (one of: ' + Object.keys(WIDGET_VARIANT_PRESETS).join(', ') + ')');
      }
    }
    if (new Set(presets).size !== presets.length) throw new Error('--widgets entry "' + raw + '" repeats a preset');
    out.push({
      id: wid,
      label: wlabel,
      description: 'Describe the tile.',
      client: 'client/widget.js',
      export: 'renderWidget',
      variants: presets.map((pr) => ({ id: pr, ...WIDGET_VARIANT_PRESETS[pr] })),
      defaultVariant: presets.includes('m') ? 'm' : presets[0],
    });
  }
  if (out.length === 0) throw new Error('--widgets was given but parsed to nothing');
  return out;
}

/** orders-list -> OrdersList */
function pascal(id) {
  return id.split('-').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

/** Parse --views into [{ id, label }], ids already prefixed with the module id. */
function parseViews(spec, moduleId, label) {
  if (!spec) return [{ id: moduleId + '-main', label, title: label, subtitle: '' }];
  const out = [];
  for (const raw of String(spec).split(',').map((s) => s.trim()).filter(Boolean)) {
    const colon = raw.indexOf(':');
    const suffix = (colon === -1 ? raw : raw.slice(0, colon)).trim();
    const viewLabel = (colon === -1 ? raw : raw.slice(colon + 1)).trim();
    if (!suffix) throw new Error('--views entry "' + raw + '" has no id');
    const id = moduleId + '-' + suffix;
    if (!MODULE_ID_RE.test(id)) {
      throw new Error('view id "' + id + '" is not a slug (expected ' + MODULE_ID_RE.source + ')');
    }
    if (out.some((v) => v.id === id)) throw new Error('duplicate view id "' + id + '"');
    out.push({ id, label: viewLabel || suffix, title: viewLabel || suffix, subtitle: '' });
  }
  if (out.length === 0) throw new Error('--views was given but parsed to nothing');
  return out;
}

/**
 * Parse --data into dataRepos[] entries. Entries are separated by ";", each is
 * `<repo>[:<path>[,<path>...]][:read]`; a trailing "read" segment makes the
 * entry `access: 'read'` and then paths are mandatory (the validator refuses a
 * read entry without them). A repo alone writes the module's own `<id>/`.
 * @param {string|undefined} spec
 * @param {string} moduleId
 * @returns {object[]}
 */
function parseDataRepos(spec, moduleId) {
  if (spec === undefined || spec === true) {
    if (spec === true) throw new Error('--data needs a value, e.g. --data "data-tier-0"');
    return [];
  }
  const out = [];
  for (const raw of String(spec).split(';').map((x) => x.trim()).filter(Boolean)) {
    const parts = raw.split(':').map((x) => x.trim());
    const repo = parts[0];
    if (!DATA_REPO_IDS.includes(repo)) {
      throw new Error('--data names an unknown repo "' + repo + '" (one of: ' + DATA_REPO_IDS.join(', ') + ')');
    }
    const read = parts.length > 1 && parts[parts.length - 1] === 'read';
    const middle = parts.slice(1, read ? -1 : undefined);
    if (middle.length > 1) throw new Error('--data entry "' + raw + '" has too many ":" segments');
    const paths = (middle[0] || '').split(',').map((x) => x.trim()).filter(Boolean);
    if (read && paths.length === 0) {
      throw new Error('--data entry "' + raw + '" is read-only and needs explicit paths (<repo>:<path>[,<path>]:read)');
    }
    if (read) {
      out.push({ name: repo, access: 'read', description: 'Describe the data this module reads.', paths });
    } else {
      out.push({ name: repo, description: 'Describe the data.', paths: paths.length ? paths : [moduleId + '/'] });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// File builders. Displayed copy may carry any Unicode; every id,
// path and key stays ASCII.
// ---------------------------------------------------------------------------

function manifestSource(id, label, views, icon, withServer, hub, area, dataRepos = [], widgets = []) {
  const manifest = {
    schemaVersion: 1,
    id,
    name: label,
    version: '0.1.0',
    // A fresh module is "beta" until its author publishes it as something
    // else - the publish modal writes the choice back into this field.
    status: 'beta',
    // Business area (plan 2026-09-12-obszary-modulow.md) - independent of
    // --hub/sidebar placement. Always required at scaffold time, never
    // defaulted, so validateAreaArg has already accepted this value.
    area,
    description: 'Describe the module.',
    icon: icon || '24-ic-folder',
    // Every section the Settings > Modules card renders has a field here, so
    // the scaffold seeds them ALL - an empty author or tag list is a visible
    // prompt to fill it in, a missing key is a field nobody knows exists.
    author: 'Fill in the author.',
    tags: [],
    sidebar: hub
      ? { label, kind: 'page', hub }
      : { label, kind: views.length > 1 ? 'hub' : 'item' },
    views: views.map((v) => ({ id: v.id, label: v.label, title: v.title, subtitle: 'Fill in the subtitle.' })),
    client: { entry: 'client/index.js', style: 'client/style.css' },
    dataRepos,
    envKeys: [],
  };
  if (withServer) manifest.server = { entry: 'server/index.js' };
  // Only when --widgets was given: no key at all is the documented default
  // (the core derives a shortcut tile from the manifest).
  if (widgets.length > 0) manifest.widgets = widgets;
  return JSON.stringify(manifest, null, 2) + '\n';
}

/** client/widget.js stub: one renderWidget(el, ctx) switching on ctx.widgetId. */
function widgetsSource(id, widgets) {
  const cases = widgets.map((w) => [
    "    case '" + w.id + "':",
    '      el.innerHTML = ctx.kit',
    "        ? ctx.kit.blocks([{ type: 'tiles', tiles: [{ label: 'Example', value: '0', tone: 'neutral' }] }], { cols: ctx.variant.cols, rows: ctx.variant.rows })",
    '        : ' + JSON.stringify('<div class="ds-callout ds-callout--info"><div>Tile ' + w.label.replace(/[<>&"]/g, '') + ' is waiting for content.</div></div>') + ';',
    '      break;',
  ].join('\n')).join('\n');
  return [
    '// modules/' + id + '/client/widget.js',
    '// Scaffolded by scripts/new-module.js --widgets.',
    '//',
    '// Dashboard tile contract: the core draws the card frame (module icon, name,',
    '// widget label, "Open") and calls renderWidget(el, ctx) for the body only.',
    '//   ctx.moduleId, ctx.widgetId, ctx.variant ({ id, cols, rows }), ctx.kit,',
    "//   ctx.apiBase ('/api/m/" + id + "'), ctx.navigate(viewId), ctx.signal (AbortSignal)",
    '// ctx.kit = block builders from js/dashboard-widget-kit.js (tiles, donut, big,',
    '// segments, progress, bars, spark, heatmap, people, avatars, timeline, pill,',
    '// blocks(list, { cols, rows }), hydrateAvatars). Prefer it over hand-made markup;',
    '// it is absent in older hosts, hence the fallback below.',
    '// Return a cleanup function (or { cleanup }) to stop timers and listeners.',
    '// A throw stays inside this one tile. Escape every data string you paint.',
    '// Document access only inside the function, so the contract test can import this',
    '// file in plain Node.',
    '',
    'export async function renderWidget(el, ctx) {',
    '  switch (ctx.widgetId) {',
    cases,
    '    default:',
    "      el.textContent = '';",
    '  }',
    '',
    '  // Example call into this module\'s own API:',
    "  // const res = await fetch(ctx.apiBase + '/status', { signal: ctx.signal });",
    '  // const data = await res.json();',
    '',
    '  return () => {};',
    '}',
    '',
  ].join('\n');
}

function clientSource(id, views, withServer) {
  const lines = [
    '// modules/' + id + '/client/index.js',
    '// Scaffolded by scripts/new-module.js.',
    '//',
    '// Export a `views` object keyed by view id - the keys must match',
    '// module.json views[].id exactly. js/module-host.js imports this file',
    "// lazily the first time one of the views is opened, creates a",
    '// <div class="view-data" id="<view-id>-root"> for it and calls init()',
    '// once, then render() on every navigation into the view.',
    '//',
    '// Header action slot: the host also builds a sibling',
    '// <div id="<view-id>-actions"> next to .view-data (js/module-host.js',
    '// _createViewSection). Paint it in EVERY render() - not only from init() -',
    '// with document.getElementById(v.id + \'-actions\'): one ds-btn--primary',
    '// (big, 48px - the action the view exists for), the rest ds-btn--secondary',
    '// or ds-btn--tertiary. Content buttons inside the card stay ds-btn--sm.',
    '// Wire clicks on the slot AND on the root, both idempotent, both dropped in',
    '// registerViewCleanup - a data reload repaints the section from a pristine',
    '// copy, so the slot comes back as a fresh element with no listeners.',
    '//',
    '// deps (passed to init):',
    '//   navigate(viewId)            - go to another view',
    '//   registerViewCleanup(cb)     - MANDATORY for timers, listeners, EventSource',
    '//   showToast(message, kind)    - kind: success | error | info',
    "//   apiBase                     - '/api/m/" + id + "' (this module's routes)",
    '//',
    '// DS classes only (ds-btn, ds-card, ds-badge, ds-callout, ds-input,',
    '// ds-tabs, ds-segmented) and tokens from css/ds-tokens.css - never a hex.',
    '//',
    '// Confirm a destructive action with confirmDsModal (js/ds-modal.js), never',
    '// the browser confirm():',
    '//   const ok = await confirmDsModal({',
    "//     title: 'Delete the entry?', body: 'This cannot be undone.',",
    "//     okLabel: 'Delete', danger: true, trigger: e.target,",
    '//   });',
    '//   if (!ok) return;',
    '',
    '// Dynamic import - this file must stay importable in plain Node with no',
    '// document (the scaffolded contract test below does exactly that).',
    'let _dsModal = null;',
    '',
    'export const views = {',
  ];
  for (const v of views) {
    const apiExampleLines = (withServer && v === views[0]) ? [
      '',
      "      // Example call into this module's own API:",
      "      // const res = await fetch(this._deps.apiBase + '/status');",
      '      // const data = await res.json();',
    ] : [];
    lines.push(
      '',
      "  '" + v.id + "': {",
      '    _wired: false,',
      '',
      '    /** @param {{ navigate, registerViewCleanup, showToast, apiBase }} deps */',
      '    init(deps) {',
      '      this._deps = deps;',
      '      (async () => {',
      "        try { _dsModal = await import('/js/ds-modal.js'); } catch { _dsModal = null; }",
      '      })();',
      '      // No registerViewCleanup() here: init() runs ONCE per session, but',
      '      // the cleanup registry is consumed on EVERY exit from the view, so a',
      '      // callback registered here would cover the first exit and nothing',
      '      // after. Register cleanups where the resource is created (render()).',
      '    },',
      '',
      '    /**',
      '     * Called on every navigation into the view AND after a data reload -',
      '     * the header slot is a fresh element every time, so it is painted',
      '     * here, never only from init().',
      '     * @param {string} _subPath path segment after the view id',
      '     * @param {object} _opts navigation options',
      '     */',
      '    async render(_subPath, _opts) {',
      "      const root = document.getElementById('" + v.id + "-root');",
      '      if (!root) return;',
      "      const actions = document.getElementById('" + v.id + "-actions');",
      '      if (actions) {',
      '        actions.innerHTML =',
      "          '<button type=\"button\" class=\"ds-btn ds-btn--primary\" data-" + id + "-main>Main action</button>'",
      "          + '<button type=\"button\" class=\"ds-btn ds-btn--secondary\" data-" + id + "-refresh>Refresh</button>';",
      '      }',
      '      root.innerHTML =',
      "        '<div class=\"ds-card\"><div class=\"ds-card-body\">'",
      "        + '<div class=\"ds-callout ds-callout--info\">" + v.label.replace(/'/g, "\\'") + " - view under construction.</div>'",
      "        + '<div class=\"ds-actions\"><button type=\"button\" class=\"ds-btn ds-btn--tertiary ds-btn--sm\" data-" + id + "-more>More</button></div>'",
      "        + '</div></div>';",
      ...apiExampleLines,
      '',
      '      if (this._wired) return;',
      '      this._wired = true;',
      '      const onClick = (_e) => {',
      "        // Inspect _e.target.closest('[data-...]') here; call",
      '        // _dsModal && _dsModal.confirmDsModal({...}) before anything',
      '        // destructive.',
      '      };',
      "      root.addEventListener('click', onClick);",
      "      if (actions) actions.addEventListener('click', onClick);",
      '      // Registered on every entry (the registry is wiped on every exit):',
      '      // both listeners come off and _wired resets, so the next render()',
      '      // re-wires exactly once. Clear intervals, close EventSource',
      '      // instances here too.',
      '      this._deps.registerViewCleanup(() => {',
      "        root.removeEventListener('click', onClick);",
      "        if (actions) actions.removeEventListener('click', onClick);",
      '        this._wired = false;',
      '      });',
      '    },',
      '  },',
    );
  }
  lines.push('};', '');
  return lines.join('\n');
}

function styleSource(id) {
  // The module label is deliberately NOT interpolated here: a CSS comment is
  // code, so it stays ASCII, and the label may carry non-ASCII letters.
  return [
    '/* modules/' + id + '/client/style.css',
    '   Scaffolded by scripts/new-module.js.',
    '',
    '   Prefix every rule with .' + id + '- so it cannot collide with the core or',
    '   another module. Colours come from css/ds-tokens.css as var(--...) -',
    '   a hardcoded hex is a convention violation. */',
    '',
    '.' + id + '-root {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: var(--spacing-16, 16px);',
    '}',
    '',
  ].join('\n');
}

function serverSource(id) {
  return [
    "'use strict';",
    '// modules/' + id + '/server/index.js',
    '// Scaffolded by scripts/new-module.js.',
    '//',
    '// Export register(ctx) and return { routes }. Every route is mounted under',
    "// /api/m/" + id + "/ ; `path` is the part after the module id.",
    '//',
    '// ctx properties:',
    '//   moduleId                        this directory name',
    '//   jsonResponse(res, status, body) gzipped JSON with an ETag - the ONLY',
    '//                                   way to answer; never res.end(JSON.stringify)',
    '//   readBody(req, maxBytes)         reads and parses a JSON request body',
    '//   checkOrigin(req, res)           CSRF guard (the host already applies it',
    '//                                   to every non-GET route)',
    '//   makeLock()                      withLock(fn) - serialize writes, always',
    '//                                   paired with a tmp+rename write',
    '//   dataDir                         data/modules/' + id + '/ (created on load)',
    '//   rootDir                         the cockpit root',
    '//   log(...args)                    console.log prefixed [module:' + id + ']',
    '',
    'module.exports = function register(ctx) {',
    '  return {',
    '    routes: [',
    '      {',
    "        method: 'GET',",
    "        path: '/status',",
    '        handler: (_req, res) => {',
    '          ctx.jsonResponse(res, 200, { ok: true, id: ctx.moduleId });',
    '        },',
    '      },',
    '    ],',
    '  };',
    '};',
    '',
  ].join('\n');
}

function testSource(id, views, withServer, widgets = []) {
  const viewList = views.map((v) => "'" + v.id + "'").join(', ');
  return [
    '// modules/' + id + '/tests/test_' + id.replace(/-/g, '_') + '.mjs',
    '// Contract test for the ' + id + ' module. `npm test` discovers it through',
    '// scripts/test-unit-js.js, which walks modules/<id>/tests/ as well as tests/.',
    '//',
    '// Scaffolded by scripts/new-module.js - extend it with real behaviour tests.',
    '',
    "import test from 'node:test';",
    "import assert from 'node:assert';",
    "import fs from 'node:fs';",
    "import path from 'node:path';",
    "import { fileURLToPath } from 'node:url';",
    "import { createRequire } from 'node:module';",
    '',
    "const require = createRequire(import.meta.url);",
    "const { validateModuleManifest } = require('../../../server.js');",
    '',
    "const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');",
    "const MODULE_ID = '" + id + "';",
    "const VIEW_IDS = [" + viewList + '];',
    "const read = (p) => fs.readFileSync(path.join(DIR, p), 'utf8');",
    '',
    "test('" + id + ": module.json passes the host validator', () => {",
    "  const manifest = JSON.parse(read('module.json'));",
    '  const result = validateModuleManifest(manifest, MODULE_ID);',
    "  assert.strictEqual(result.valid, true, (result.errors || []).join('; '));",
    '});',
    '',
    "test('" + id + ": the manifest declares exactly the expected views', () => {",
    "  const manifest = JSON.parse(read('module.json'));",
    '  assert.deepStrictEqual(manifest.views.map((v) => v.id), VIEW_IDS);',
    '});',
    '',
    "test('" + id + ": the client exports one view per manifest entry', () => {",
    "  const src = read('client/index.js');",
    '  assert.match(src, /export const views\\s*=/);',
    '  for (const id of VIEW_IDS) {',
    "    assert.ok(src.includes(\"'\" + id + \"'\"), 'client/index.js has no view ' + id);",
    '  }',
    '});',
    '',
    "test('" + id + ": every file the manifest points at exists', () => {",
    "  const manifest = JSON.parse(read('module.json'));",
    '  for (const rel of [manifest.client && manifest.client.entry,',
    '    manifest.client && manifest.client.style,',
    '    manifest.server && manifest.server.entry]) {',
    '    if (!rel) continue;',
    "    assert.ok(fs.existsSync(path.join(DIR, rel)), 'missing file: ' + rel);",
    '  }',
    '});',
    ...(withServer ? [
      '',
      "test('" + id + ": the server entry registers at least one route', () => {",
      "  const register = require(path.join(DIR, 'server', 'index.js'));",
      "  assert.strictEqual(typeof register, 'function');",
      '  const result = register({',
      "    moduleId: MODULE_ID, dataDir: DIR, rootDir: DIR, log: () => {},",
      '    jsonResponse: () => {}, readBody: async () => ({}), checkOrigin: () => true,',
      '    makeLock: () => (fn) => fn(),',
      '  });',
      '  assert.ok(Array.isArray(result.routes) && result.routes.length > 0);',
      '  for (const r of result.routes) {',
      "    assert.match(r.path, /^\\//, 'a route path starts with /');",
      "    assert.strictEqual(typeof r.handler, 'function');",
      '  }',
      '});',
    ] : []),
    ...(widgets.length > 0 ? [
      '',
      "test('" + id + ": widgets[] ids match the dashboard widget declaration', () => {",
      "  const manifest = JSON.parse(read('module.json'));",
      "  assert.deepStrictEqual(manifest.widgets.map((w) => w.id), [" + widgets.map((w) => "'" + w.id + "'").join(', ') + ']);',
      '});',
      '',
      "test('" + id + ": client/widget.js exports renderWidget', async () => {",
      "  const ns = await import(path.join(DIR, 'client', 'widget.js'));",
      "  assert.strictEqual(typeof ns.renderWidget, 'function');",
      '});',
    ] : []),
    '',
  ].join('\n');
}

function readmeSource(id, label, views, withServer, widgets = []) {
  const rows = views.map((v) => '| `' + v.id + '` | ' + v.label + ' |').join('\n');
  return [
    '# ' + label,
    '',
    'Mission Deck module `' + id + '`. Generated by `node scripts/new-module.js`.',
    '',
    '## Views',
    '',
    '| view id | Label |',
    '|---|---|',
    rows,
    '',
    '## What to fill in',
    '',
    '1. `module.json` — the module description, view subtitles, icon (a slug from `assets/icons/ds/`).',
    '2. `client/index.js` — the real content of every view. DS classes only, tokens instead of colours.',
    '3. `client/style.css` — rules prefixed with `.' + id + '-`.',
    ...(withServer ? ['4. `server/index.js` — routes under `/api/m/' + id + '/`. Every answer goes through `ctx.jsonResponse`.'] : []),
    '',
    ...(widgets.length > 0 ? [
      '## Dashboard tiles',
      '',
      '| tile id | Label | Sizes |',
      '|---|---|---|',
      ...widgets.map((w) => '| `' + w.id + '` | ' + w.label + ' | ' + w.variants.map((v) => v.id).join(', ') + ' |'),
      '',
      'Tile content: `client/widget.js` (`renderWidget(el, ctx)`).',
      '',
    ] : []),
    '## Language rule',
    '',
    'Code is ASCII (identifiers, paths, keys, comments),',
    'and everything a person reads is written in English.',
    'The full module contract: `modules-template/README.md`.',
    '',
    '## Tests',
    '',
    '`tests/test_' + id.replace(/-/g, '_') + '.mjs` checks the module contract and runs with `npm test`.',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------

function run(flags, positionals) {
  const root = flags.root ? path.resolve(String(flags.root)) : R.ROOT;
  const id = String(positionals[0] || '').trim();
  const label = String(positionals[1] || '').trim();

  if (!MODULE_ID_RE.test(id)) {
    R.usageError('module id must be kebab-case ASCII matching ' + MODULE_ID_RE.source + ' (got "' + id + '")');
  }
  if (RESERVED_MODULE_IDS.has(id)) {
    R.usageError('module id "' + id + '" is reserved by the cockpit core');
  }
  if (!label) R.usageError('a "<Label>" argument is required');

  if (flags.area === undefined) {
    R.usageError('--area "<Obszar>" is required (business area, independent of --hub)');
  }
  const areaCheck = validateAreaArg(flags.area);
  if (!areaCheck.ok) R.usageError('--area ' + areaCheck.error);
  const area = areaCheck.value;

  const hub = flags.hub === undefined ? null : String(flags.hub).trim();
  if (hub !== null && !CORE_HUB_IDS.includes(hub)) {
    R.usageError('--hub must name a core hub (one of: ' + CORE_HUB_IDS.join(', ') + '), got "' + hub + '"');
  }

  const withServer = !flags['no-server'];
  const views = parseViews(flags.views, id, label);
  const dataRepos = parseDataRepos(flags.data, id);
  const widgets = parseWidgets(flags.widgets);
  const dir = path.join('modules', id);

  if (fs.existsSync(path.join(root, dir))) {
    return { refused: true, reason: 'already exists: ' + dir, edits: [] };
  }

  const edits = [
    { file: path.join(dir, 'module.json'), next: manifestSource(id, label, views, flags.icon, withServer, hub, area, dataRepos, widgets) },
    { file: path.join(dir, 'client', 'index.js'), next: clientSource(id, views, withServer) },
    { file: path.join(dir, 'client', 'style.css'), next: styleSource(id) },
    { file: path.join(dir, 'tests', 'test_' + id.replace(/-/g, '_') + '.mjs'), next: testSource(id, views, withServer, widgets) },
    { file: path.join(dir, 'README.md'), next: readmeSource(id, label, views, withServer, widgets) },
  ];
  if (withServer) {
    edits.splice(3, 0, { file: path.join(dir, 'server', 'index.js'), next: serverSource(id) });
  }

  if (widgets.length > 0) {
    edits.push({ file: path.join(dir, 'client', 'widget.js'), next: widgetsSource(id, widgets) });
  }

  const kind = hub ? 'page' : (views.length > 1 ? 'hub' : 'item');
  return { refused: false, reason: null, edits, id, label, views, dir, root, kind, hub, dataRepos, widgets };
}

async function main() {
  const { flags, positionals } = R.parseArgs(process.argv.slice(2), { booleans: ['dry-run', 'no-server', 'no-git'] });
  if (flags.help || positionals.length < 2) R.showHelp(HELP);

  let out;
  try { out = run(flags, positionals); } catch (e) { R.usageError(e.message); }

  if (out.refused) {
    if (flags.json) process.stdout.write(JSON.stringify({ script: 'new-module', refused: true, reason: out.reason }, null, 2) + '\n');
    else process.stdout.write('new-module: refused - ' + out.reason + '\n');
    process.exit(1);
  }

  const summary = out.edits.map((e) => ({ file: e.file, action: 'create', bytes: e.next.length }));
  const noGit = Boolean(flags['no-git']);
  const moduleDir = path.join(out.root, out.dir);

  if (flags['dry-run']) {
    const gitLine = noGit ? '  git    skipped (--no-git)' : '  git    init + first commit in ' + out.dir;
    if (flags.json) {
      process.stdout.write(JSON.stringify({ script: 'new-module', dry_run: true, id: out.id, kind: out.kind, hub: out.hub, views: out.views.map((v) => v.id), dataRepos: out.dataRepos, widgets: out.widgets.map((w) => w.id), edits: summary, git: noGit ? 'skipped' : 'init + first commit' }, null, 2) + '\n');
    } else {
      const t = ['NEW MODULE (dry run): ' + out.id + '  label: "' + out.label + '"  kind: ' + out.kind
        + (out.hub ? '  hub: ' + out.hub : ''), ''];
      for (const v of out.views) t.push('  view   ' + v.id + '  "' + v.label + '"');
      t.push('');
      for (const w of out.widgets) {
        t.push('  widget ' + w.id + ' "' + w.label + '" variants: ' + w.variants.map((v) => v.id).join(',') + ' (default ' + w.defaultVariant + ')');
      }
      if (out.widgets.length > 0) t.push('');
      for (const e of summary) t.push('  create ' + e.file + '  (' + e.bytes + ' bytes)');
      t.push(gitLine);
      t.push('', 'Nothing written. Re-run without --dry-run to apply.');
      process.stdout.write(t.join('\n') + '\n');
    }
    process.exit(0);
  }

  for (const e of out.edits) {
    const abs = path.join(out.root, e.file);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, e.next, 'utf8');
  }

  let git = { initialized: false, reason: 'skipped' };
  if (!noGit) {
    const result = await MG.moduleGitInit(moduleDir, 'initial state (scaffold)');
    git = result.ok ? { initialized: true, reason: null } : { initialized: false, reason: result.reason };
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify({ script: 'new-module', id: out.id, kind: out.kind, hub: out.hub, views: out.views.map((v) => v.id), dataRepos: out.dataRepos, widgets: out.widgets.map((w) => w.id), edits: summary, git }, null, 2) + '\n');
  } else {
    const t = ['NEW MODULE: ' + out.id + '  kind: ' + out.kind + (out.hub ? '  hub: ' + out.hub : ''), ''];
    for (const e of summary) t.push('  create ' + e.file);
    t.push('');
    if (git.reason === 'git-missing') {
      t.push('warning: git not found on PATH - module written without a repository');
    }
    t.push('Next: restart the server so the loader picks it up -');
    t.push('  curl -s -X POST http://localhost:' + R.CANONICAL_PORT + '/api/settings/restart');
    t.push('then `npm run lint` and `npm test`, and fill in ' + path.join(out.dir, 'client', 'index.js') + '.');
    process.stdout.write(t.join('\n') + '\n');
  }
  process.exit(0);
}

if (require.main === module) {
  main().catch((e) => {
    process.stderr.write('new-module internal error: ' + (e && e.stack || e) + '\n');
    process.exit(2);
  });
} else {
  module.exports = {
    run, parseViews, parseDataRepos, parseWidgets, widgetsSource, WIDGET_VARIANT_PRESETS, DATA_REPO_IDS, pascal, manifestSource, clientSource, styleSource, serverSource, testSource,
    MODULE_ID_RE, RESERVED_MODULE_IDS, CORE_HUB_IDS,
    validateAreaArg, MODULE_AREA_MAX, MODULE_AREA_CHARS_RE,
  };
}
