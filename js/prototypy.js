// ── Mission Deck — js/prototypy.js ────────────────────────────────────
// Prototypes: the registry and the details of finished screen prototypes (stage 1,
// read-only). Three views in one module, because they all read the same list
// cache - the registry (renderPrototypyView), one prototype's details
// (renderProtoDetailView) and the embedded preview (renderProtoStandaloneView,
// content only in stage 5, an empty section today).
//
// Data source: GET /api/prototypes (server.js, section "Prototypy") - the API
// paths are stable - prototypes have them baked into their source code.
// `format` arrives already computed by the server - we never guess it here
// from which file exists.
//
// Owners are resolved ONLY by js/team-directory.js (memberById +
// memberAvatarUrl). There is no second avatar resolver and no second team list
// here - that was the most common footgun of this migration.
//
// The `area` field is not rendered at all (an interview decision) - neither as
// a filter nor as a badge. A link to the discovery-task initiative is never
// rendered - Mission Deck has no source for that data.

import { escHtml, normalizeSearch, initials } from './utils.js';
import { emptyHeroHtml } from './empty-state.js';
import { showToast } from './toast.js';
import { loadTeamDirectory, getTeamMembers, memberById, memberAvatarUrl, fullName } from './team-directory.js';
import { openDsModal, closeDsModal } from './ds-modal.js';
import { onDataChanged } from './data-events.js';
import { onSecretsChanged } from './secrets-events.js';

// ── Pure helpers (no document access) - exported for tests/test_prototypes.mjs ──────────

/**
 * Whether the prototype uses the React contract (index.tsx). The server already
 * computed this field on read (server.js `_protoFormat`) - this ONLY reads one
 * flag, never re-derives it from the file system in the browser.
 * @param {{format?: string}|null} item
 * @returns {boolean}
 */
export function protoIsReact(item) {
  return !!(item && item.format === 'react');
}

/**
 * URL of the built prototype on the hosting (PROTO_PAGES_BASE_URL): baseUrl (without
 * the trailing slash) + the prototype id without the "proto-" prefix.
 * @param {string} baseUrl
 * @param {string} id
 * @returns {string}
 */
export function protoLaunchUrl(baseUrl, id) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const slug = String(id || '').replace(/^proto-/, '');
  return base + '/' + slug;
}

/**
 * Registry search filter: matches the prototype name AND the name of the
 * discovery initiative, ignoring letter case and diacritics.
 *
 * The initiative is here not because it "might come in handy", but because
 * the card SHOWS it. What is searched is what is visible: a prototype name can
 * be quite different from its initiative name (a prototype "proto-toolbox" may
 * be called "Location goals and efficiency metrics", while "Toolbox" is its
 * initiative), so typing what you read on the card must give a hit - otherwise
 * the search looks broken.
 *
 * @param {Array<{name?: string, discoveryTaskId?: string}>} items
 * @param {string} query
 * @param {string} [ownerId] owner id or an empty string
 * @param {Object<string,string>} [initiatives] map dt-* -> initiative title
 * @returns {Array<object>}
 */
export function filterPrototypes(items, query, ownerId, initiatives) {
  const list = Array.isArray(items) ? items : [];
  const owner = String(ownerId || '').trim();
  const byOwner = owner
    ? list.filter((it) => Array.isArray(it && it.owners) && it.owners.includes(owner))
    : list;
  const q = normalizeSearch(query || '').trim();
  if (!q) return byOwner;
  const map = initiatives && typeof initiatives === 'object' ? initiatives : {};
  return byOwner.filter((it) => {
    if (normalizeSearch((it && it.name) || '').includes(q)) return true;
    const title = map[(it && it.discoveryTaskId) || ''] || '';
    return normalizeSearch(title).includes(q);
  });
}

/**
 * Search in the owner picker: ids of team directory people matching the
 * query. It searches first and last name in both orders, role and team
 * (ignoring diacritics and case) - the query is split into words, each must
 * match. An empty string returns everyone.
 * @param {Array<{id: string, first_name?: string, last_name?: string, role?: string, team?: string}>} members
 * @param {string} query
 * @returns {Set<string>}
 */
export function matchOwnerMembers(members, query) {
  const list = Array.isArray(members) ? members : [];
  const words = normalizeSearch(query || '').trim().split(/\s+/).filter(Boolean);
  const hits = new Set();
  for (const m of list) {
    if (!m || !m.id) continue;
    const hay = normalizeSearch([m.first_name, m.last_name, m.role, m.team, m.id].filter(Boolean).join(' '));
    if (words.every((w) => hay.includes(w))) hits.add(m.id);
  }
  return hits;
}

/**
 * Owner ids present in the registry, without duplicates. The filter list
 * comes ONLY from data - an entry nobody is assigned to has no reason to be in
 * the dropdown, because it would always give an empty result.
 * @param {Array<object>} items
 * @returns {string[]}
 */
export function ownerIdsInUse(items) {
  const seen = new Set();
  for (const it of (Array.isArray(items) ? items : [])) {
    for (const o of (Array.isArray(it && it.owners) ? it.owners : [])) {
      const id = String(o || '').trim();
      if (id) seen.add(id);
    }
  }
  return [...seen].sort();
}

/** Server limit (server.js PROTO_NAME_MAX_LEN) - one constant shared with client validation. */
export const PROTO_NAME_MAX_LEN = 200;

/**
 * Validates the Name field BEFORE the request is sent - the same limit as the
 * server (name-required, name-too-long), so the person sees the message
 * without a network round trip.
 * @param {string} name
 * @returns {{valid: true, value: string}|{valid: false, error: string}}
 */
export function validatePrototypeName(name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return { valid: false, error: 'A prototype name is required.' };
  if (trimmed.length > PROTO_NAME_MAX_LEN) {
    return { valid: false, error: `The name is too long (limit ${PROTO_NAME_MAX_LEN} characters).` };
  }
  return { valid: true, value: trimmed };
}

/**
 * Translates an error code from the write routes (POST/PUT/DELETE /api/prototypes)
 * into a full sentence - we never show the raw code.
 * @param {string|null|undefined} code
 * @returns {string}
 */
export function protoErrorMessage(code) {
  switch (code) {
    case 'name-required': return 'A prototype name is required.';
    case 'name-too-long': return `The name is too long (limit ${PROTO_NAME_MAX_LEN} characters).`;
    case 'invalid-owners': return 'Invalid owner list.';
    case 'invalid-area': return 'Invalid area value.';
    case 'invalid-discovery-task-id': return 'Invalid discovery task id.';
    case 'invalid-proto-id': return 'Invalid prototype id.';
    case 'invalid-json': return 'Invalid request data.';
    case 'not-found': return 'Prototype not found - someone else may have removed it.';
    case 'registry-unreadable': return 'The prototype registry is damaged or unreadable. Fix the data file and try again.';
    case 'starter-copy-failed': return 'Could not prepare the React starter for the new prototype. Try again.';
    case 'write-failed': return 'Saving failed. Try again.';
    default: return 'Could not save the changes. Try again.';
  }
}

// ── Data ──────────────────────────────────────────────────────────────────────

// Prototype file (spec.json): 404 with {_missing:true} is the NORMAL state - "this
// file does not exist yet" - and only THAT may collapse to null. A transport
// failure or a code other than 404 THROWS, so the caller can tell it apart from
// emptiness: collapsing both to null and caching the result meant one failed
// attempt painted "Scope unavailable" until the end of the session, with no retry.
// The prototype list has its own path (_fetchItems) for the same reason.
async function _fetchJson(path) {
  let r;
  try {
    r = await fetch(path);
  } catch (e) {
    throw new Error('No response from the server: ' + ((e && e.message) || 'unknown error'));
  }
  if (r.status === 404) {
    // A 404 without {_missing:true} is treated as a missing file too - the route
    // exists, so the only 404 it can return is about content.
    return null;
  }
  if (!r.ok) throw new Error('The server answered with code ' + r.status);
  const d = await r.json();
  if (!d || typeof d !== 'object' || Array.isArray(d) || d.error) {
    throw new Error('Invalid server response');
  }
  return d._missing ? null : d;
}

/** @type {{items: Array<object>}|null} null until the list has loaded */
let _itemsCache = null;
let _itemsPromise = null;

// ── Cache invalidation (stage C/step 12) ─────────────────────────────────────
// Three independent caches (_itemsCache/_itemsPromise, _detailExtrasCache,
// _deployStatusPromise) and two buses, each responsible for a different fact:
//   - onDataChanged (js/data-events.js): team data (data-tier-0) has
//     changed - the registry, spec and initiatives are stale.
//   - onSecretsChanged (js/secrets-events.js): the publishing token in server
//     memory has changed - the publishing status (canBuild/enabled/cloned) is
//     stale, but the prototype data ITSELF is not.
// The subscriptions live at MODULE level (not in initPrototypy/initProtoDetail),
// so they fire on EVERY change, even when no prototype view is on screen - the
// module, once imported by VIEW_REGISTRY, lives for the whole session (the same
// as js/gitlab-activity.js does per view with onSecretsChanged in
// initGitlabActivity; here we do it once for the whole module, because three
// views share one file).
//
// _dataGeneration grows on EVERY data invalidation. Each fetch (items, spec,
// initiatives) remembers the generation from before it started and commits its
// result to the cache ONLY when that generation is still current - otherwise a
// response that arrived AFTER another invalidation would write stale data back
// into the cache (a late request never beats newer state).
let _dataGeneration = 0;
let _deployGeneration = 0;

function _invalidatePrototypeData() {
  _dataGeneration += 1;
  _itemsCache = null;
  _itemsPromise = null;
  _detailExtrasCache.clear();
  _initiatives = {};
}

function _invalidateDeployStatus() {
  _deployGeneration += 1;
  _deployStatusPromise = null;
}

// Subscribed once, at module level (the same pattern as js/module-sync-bar.js)
// - it works even when no prototype view is on screen, because the module lives
// for the whole session from its first import by VIEW_REGISTRY. Repainting the
// ACTIVE view goes a SEPARATE way - the hooks
// refreshPrototypyRegistry/refreshProtoDetail registered in
// js/view-registry.js, called synchronously by refreshActiveView()
// (js/app.js) - because listener registration order on the shared bus is not
// guaranteed relative to this module (see the note in the file header about
// the "ordering hazard").
onDataChanged(() => { _invalidatePrototypeData(); });
onSecretsChanged(() => {
  _invalidateDeployStatus();
  if (typeof location !== 'undefined' && location.hash.startsWith('#proto-detail/')) {
    renderProtoDetailView();
  }
});

// THROWS on a transport error or a non-2xx code. An empty list from the server
// (200) means "team data is not downloaded"; a dropped connection says nothing
// about the data and must never be shown as an empty registry.
async function _fetchItems() {
  const r = await fetch('/api/prototypes');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  if (!d || !Array.isArray(d.items)) throw new Error('Invalid server response');
  return { items: d.items };
}

/**
 * Memoized list fetch - shared between the registry and the details.
 * ONLY the server response goes into the cache, and only when no
 * invalidation arrived in the meantime (see _dataGeneration above);
 * a failure leaves it empty, so the next visit to the view (or the Refresh
 * button) asks again.
 * @returns {Promise<{items: Array<object>}>} rejected when the fetch fails
 */
function _ensureItems() {
  if (_itemsCache) return Promise.resolve(_itemsCache);
  if (_itemsPromise) return _itemsPromise;
  const gen = _dataGeneration;
  _itemsPromise = _fetchItems().then((data) => {
    if (gen === _dataGeneration) _itemsCache = data;
    return data;
  }).finally(() => { if (gen === _dataGeneration) _itemsPromise = null; });
  return _itemsPromise;
}

/**
 * Adds/overwrites one entry in the list cache - used after every successful
 * write (POST/PUT), so the registry and the details agree without F5. Never
 * creates an entry "optimistically" - called ONLY with a server response
 * (item from { status, item }).
 * @param {object} item
 */
function _cacheUpsertItem(item) {
  if (!item || !item.id) return;
  if (!_itemsCache) {
    _invalidatePrototypeData();
    return;
  }
  const items = (_itemsCache && Array.isArray(_itemsCache.items)) ? _itemsCache.items.slice() : [];
  const idx = items.findIndex((it) => it.id === item.id);
  if (idx === -1) items.unshift(item); else items[idx] = item;
  _invalidatePrototypeData();
  _itemsCache = { items };
}

/**
 * Removes one entry from the list cache together with its scope of work
 * (spec) after a successful DELETE.
 * @param {string} id
 */
function _cacheRemoveItem(id) {
  const items = _itemsCache && _itemsCache.items.filter((it) => it.id !== id);
  _invalidatePrototypeData();
  if (items) _itemsCache = { items };
}

// The shared skeleton of the three write routes: content-type always set (415
// is a client implementation bug, never a server one), the error code pulled
// from the JSON response and attached to the exception - protoErrorMessage()
// translates it at the caller.
async function _writeJson(method, path, payload) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {}),
    });
  } catch {
    const err = new Error('network');
    err.code = null;
    throw err;
  }
  let data = null;
  try { data = await res.json(); } catch { /* no response body - res.ok is checked below */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || 'unknown');
    err.code = (data && data.error) || null;
    throw err;
  }
  return data || {};
}

/** POST /api/prototypes - creates a new entry. Returns { status, item }. */
async function _apiCreatePrototype(payload) {
  return _writeJson('POST', '/api/prototypes', payload);
}

/** PUT /api/prototypes/<id> - merges changes over the existing entry. Returns { status, item }. */
async function _apiUpdatePrototype(id, payload) {
  return _writeJson('PUT', '/api/prototypes/' + encodeURIComponent(id), payload);
}

/** DELETE /api/prototypes/<id> - deletes the entry and its folder on disk. Returns { status, id }.
* checkOrigin() on the server requires Content-Type: application/json on EVERY
* writing request, including a DELETE with no body - hence the same _writeJson. */
async function _apiDeletePrototype(id) {
  return _writeJson('DELETE', '/api/prototypes/' + encodeURIComponent(id), {});
}

let _deployStatusPromise = null;
/**
 * Fetched once per session - the publishing status rarely changes during it -
 * and invalidated ONLY by onSecretsChanged (see below), never by a team data
 * change: canBuild/enabled/cloned depend on the publishing configuration and
 * the build shell, not on prototypes.json.
 */
function _fetchDeployStatus() {
  if (!_deployStatusPromise) {
    const gen = _deployGeneration;
    _deployStatusPromise = fetch('/api/prototypes/deploy-status')
      .then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then((data) => {
        if (!data || typeof data.enabled !== 'boolean' || typeof data.baseUrl !== 'string') {
          throw new Error('Invalid server response');
        }
        return data;
      })
      .catch(() => {
        if (gen === _deployGeneration) _deployStatusPromise = null;
        return { enabled: false, baseUrl: '', failed: true };
      });
  }
  return _deployStatusPromise;
}

/**
 * The scope of work of one prototype. Three states, not two: present, absent
 * (404) and COULD NOT CHECK. Only the first two may be cached - a failure must
 * be retryable, otherwise one network blip lies until the end of the session.
 * @type {Map<string, {spec: object|null}>}
 */
const _detailExtrasCache = new Map();

async function _loadDetailExtras(id) {
  if (_detailExtrasCache.has(id)) return _detailExtrasCache.get(id);
  const gen = _dataGeneration;
  let spec;
  try {
    spec = await _fetchJson('/api/prototypes/spec/' + encodeURIComponent(id));
  } catch {
    return { spec: null, specFailed: true };
  }
  const entry = { spec };
  if (gen === _dataGeneration) _detailExtrasCache.set(id, entry);
  return entry;
}

// ── Owner avatars - one resolver, js/team-directory.js ──────────────────────

function _ownerAvatarHtml(id) {
  const member = memberById(id);
  const name = member ? fullName(member) : '';
  const label = name || id || '';
  const url = memberAvatarUrl(member);
  const ini = escHtml(initials(label));
  if (!url) {
    return `<span class="proto-owner-avatar proto-owner-avatar--fallback" title="${escHtml(label)}">${ini}</span>`;
  }
  return `<span class="proto-owner-avatar-wrap" title="${escHtml(label)}">`
    + `<img class="proto-owner-avatar" src="${escHtml(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" `
    + `onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">`
    + `<span class="proto-owner-avatar proto-owner-avatar--fallback" style="display:none;">${ini}</span>`
    + `</span>`;
}

function _ownersRowHtml(owners) {
  const ids = Array.isArray(owners) ? owners : [];
  if (!ids.length) return '';
  return `<div class="proto-owners">${ids.map(_ownerAvatarHtml).join('')}</div>`;
}

/** Full owner row on the details page - avatar + name and role. */
function _ownersDetailHtml(owners) {
  const ids = Array.isArray(owners) ? owners : [];
  if (!ids.length) return '';
  const rows = ids.map((id) => {
    const member = memberById(id);
    const name = member ? fullName(member) : id;
    const role = member ? [member.role, member.team].filter(Boolean).join(' · ') : '';
    return `<div class="proto-detail-owner">
      ${_ownerAvatarHtml(id)}
      <div class="proto-detail-owner-info">
        <span class="proto-detail-owner-name">${escHtml(name)}</span>
        ${role ? `<span class="proto-detail-owner-role">${escHtml(role)}</span>` : ''}
      </div>
    </div>`;
  }).join('');
  return `<div class="proto-detail-owners">
    <div class="proto-detail-label">Owners</div>
    <div class="proto-detail-owners-list">${rows}</div>
  </div>`;
}

// ── Registry (list) ──────────────────────────────────────────────────────────

let _query = '';
let _ownerFilter = '';

// Map "dt-xxxx" -> initiative title. Fetched once per session with the
// registry; a failure is harmless - the cards simply do not show the initiative
// name, so this fetch never breaks loading the list.
let _initiatives = {};

function _cardHtml(item) {
  const updated = item.updated_at || item.created_at || '';
  const dateHtml = updated
    ? `<span class="proto-card-date">Updated: ${escHtml(String(updated).slice(0, 10))}</span>`
    : '';
  // Initiative name instead of the dt-* id - and as text, not a link: this
  // app has no discovery view yet, and a link to nowhere is worse than the name
  // alone. A missing map entry is a normal state (the discovery card may not
  // exist in the data) and then the row is not there at all.
  const initiative = _initiatives[item.discoveryTaskId || ''] || '';
  const initiativeHtml = initiative
    ? `<span class="proto-card-initiative" title="Discovery initiative">${escHtml(initiative)}</span>`
    : '';
  return `<a class="ds-card proto-card" href="#proto-detail/${encodeURIComponent(item.id)}" data-proto-id="${escHtml(item.id)}">
    <div class="ds-card-body proto-card-body">
      <div class="proto-card-name">${escHtml(item.name || item.id)}</div>
      ${initiativeHtml}
      <div class="proto-card-meta">
        ${dateHtml}
        ${_ownersRowHtml(item.owners)}
      </div>
    </div>
  </a>`;
}

function _toolbarHtml(total, visibleCount, items) {
  // The owner filter appears ONLY when there is something to choose from:
  // with one person in the whole registry the dropdown narrows nothing, and it
  // takes up room in the bar next to the search.
  const ownerIds = ownerIdsInUse(items);
  const ownerFilterHtml = ownerIds.length > 1 ? `
    <select class="ds-input proto-owner-filter" id="prototypy-owner" aria-label="Filter by owner">
      <option value="">All owners</option>
      ${ownerIds.map((id) => {
    const m = memberById(id);
    const label = m ? fullName(m) : id;
    return `<option value="${escHtml(id)}"${id === _ownerFilter ? ' selected' : ''}>${escHtml(label)}</option>`;
  }).join('')}
    </select>` : '';
  return `<div class="proto-toolbar">
    <div class="ds-input-wrap proto-search-wrap">
      <input type="search" class="ds-input" id="prototypy-search" placeholder="Search by name or initiative..."
        value="${escHtml(_query)}" aria-label="Search prototypes by name or initiative" autocomplete="off">
    </div>
    ${ownerFilterHtml}
    <span class="proto-toolbar-count" aria-live="polite">${visibleCount} of ${total} prototypes</span>
    <button type="button" class="ds-btn ds-btn--tertiary" data-proto-guide>How it works</button>
    <button type="button" class="ds-btn ds-btn--primary" data-proto-add>Add prototype</button>
  </div>`;
}

function _openSyncCenter() {
  import('./sync-center-modal.js')
    .then((m) => m.openSyncCenterModal())
    .catch(() => showToast('danger', 'Could not open the Sync window'));
}

function _wireSyncCta(root) {
  const btn = root.querySelector('[data-proto-open-sync]');
  if (btn) btn.addEventListener('click', _openSyncCenter);
}

function _paintRegistry(root, data) {
  const items = Array.isArray(data.items) ? data.items : [];

  if (items.length === 0) {
    root.innerHTML = emptyHeroHtml({
      title: 'No team data',
      message: 'Team data is not on this computer yet. Open the Sync window to fetch it.',
      mascot: 'working',
    }) + `<div class="proto-empty-cta"><button type="button" class="ds-btn ds-btn--secondary" data-proto-open-sync>Open Sync</button>
      <button type="button" class="ds-btn ds-btn--primary" data-proto-add>Add prototype</button></div>`;
    _wireSyncCta(root);
    const addBtn = root.querySelector('[data-proto-add]');
    if (addBtn) addBtn.addEventListener('click', () => _openProtoForm('create', null));
    return;
  }

  const visible = filterPrototypes(items, _query, _ownerFilter, _initiatives);
  const gridHtml = visible.length
    ? `<div class="proto-grid">${visible.map(_cardHtml).join('')}</div>`
    : emptyHeroHtml({
        title: 'No results',
        message: 'No prototype matches the selected criteria. Change or clear the search or filters.',
        mascot: 'thinking',
      });

  root.innerHTML = _toolbarHtml(items.length, visible.length, items) + gridHtml;

  const ownerSelect = root.querySelector('#prototypy-owner');
  if (ownerSelect) {
    ownerSelect.addEventListener('change', () => {
      _ownerFilter = ownerSelect.value || '';
      _paintRegistry(root, data);
      const el = document.getElementById('prototypy-owner');
      if (el) el.focus();
    });
  }

  const input = root.querySelector('#prototypy-search');
  if (input) {
    input.addEventListener('input', () => {
      _query = input.value || '';
      _paintRegistry(root, data);
      const el = document.getElementById('prototypy-search');
      if (el) {
        el.focus();
        const len = el.value.length;
        el.setSelectionRange(len, len);
      }
    });
  }

  const addBtn = root.querySelector('[data-proto-add]');
  if (addBtn) addBtn.addEventListener('click', () => _openProtoForm('create', null));

  // The guide opens in the same document window as the training guides
  // (js/doc-modal.js). The slug is hardcoded, not built from data - the URL is
  // made in one place and there is nothing to validate.
  const guideBtn = root.querySelector('[data-proto-guide]');
  if (guideBtn) {
    guideBtn.addEventListener('click', async () => {
      try {
        const { openDocModal } = await import('./doc-modal.js');
        openDocModal({
          title: 'Prototypes - guide',
          load: async () => {
            const url = '/docs/guides/prototypes.md';
            const res = await fetch(url, { headers: { Accept: 'text/plain' } });
            if (!res.ok) throw new Error('Could not load the guide (HTTP ' + res.status + ').');
            return { path: url.slice(1), content: await res.text() };
          },
        });
      } catch {
        showToast('danger', 'Could not open the guide');
      }
    });
  }
}

// A fetch failure - NOT emptiness. A callout with a working "Refresh", because
// an empty state pointing at Sync would be a claim the client cannot back up
// (the same pattern as js/gitlab-activity.js).
function _paintLoadError(root, err) {
  root.innerHTML = `<div class="ds-callout ds-callout--warning">
      <div>Could not load the prototype list. Check your connection and try again.</div>
    </div>
    <div class="proto-empty-cta"><button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-proto-retry>Refresh</button></div>`;
  const btn = root.querySelector('[data-proto-retry]');
  if (btn) {
    btn.addEventListener('click', () => {
      btn.disabled = true;
      btn.textContent = 'Refreshing...';
      _loadRegistry(root);
    });
  }
  showToast('danger', 'Could not load the prototype list', (err && err.message) || '');
}

let _loadingRegistry = null;
async function _loadRegistry(root) {
  const gen = _dataGeneration;
  if (_loadingRegistry === gen) return;
  _loadingRegistry = gen;
  try {
    // The team directory MUST be loaded before the first paint - owners are
    // tm-* ids that only memberById resolves. Without it the first visit to the
    // view shows initials built from the id.
    const [data] = await Promise.all([
      _ensureItems(),
      loadTeamDirectory().catch(() => { /* an empty directory is a normal state */ }),
      fetch('/api/prototypes/initiatives')
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => { if (gen === _dataGeneration && j && j.map) _initiatives = j.map; })
        .catch(() => { /* the list works the same without initiative names */ }),
    ]);
    if (gen === _dataGeneration) _paintRegistry(root, data);
  } catch (e) {
    if (gen === _dataGeneration) _paintLoadError(root, e);
  } finally {
    if (_loadingRegistry === gen) _loadingRegistry = null;
  }
}

/** Paints the registry. Called on every visit to the view. */
export function renderPrototypyView() {
  const root = document.getElementById('prototypy-root');
  if (!root) return;
  if (_itemsCache) { _paintRegistry(root, _itemsCache); return; }
  // The loader deduplicates only the current generation. A skeleton left
  // by an invalidated hidden-view request must not suppress a fresh load.
  return _loadRegistry(root);
}

/**
 * Hook called by js/app.js:refreshActiveView() (VIEW_REGISTRY['prototypy'].refresh),
 * ONLY when this view is active - invalidates the cache and fetches again
 * SYNCHRONOUSLY with the call, regardless of the listener registration order
 * on onDataChanged (see the note at onDataChanged/onSecretsChanged above in
 * this file).
 */
export function refreshPrototypyRegistry() {
  const root = document.getElementById('prototypy-root');
  if (!root) return;
  _invalidatePrototypeData();
  return _loadRegistry(root);
}

/** One-time (per session) load of the registry data (together with the team directory). */
export function initPrototypy() {
  const root = document.getElementById('prototypy-root');
  if (!root) return;
  _loadRegistry(root);
}

// ── Details of one prototype ─────────────────────────────────────────────────

const _PLAY_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const _COPY_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const _EDIT_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/></svg>';
const _TRASH_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';
const _LOCAL_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
const _DEPLOY_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><polyline points="5 12 12 5 19 12"/></svg>';

function _idFromHash(prefix) {
  const hash = location.hash || '';
  return hash.startsWith(prefix) ? decodeURIComponent(hash.slice(prefix.length)) : '';
}

function _specSectionHtml(spec, failed) {
  if (failed) {
    return `<div class="ds-callout ds-callout--warning">
        <div>Could not load the scope of work. This is a fetch failure, not a missing description.</div>
      </div>
      <div class="proto-empty-cta"><button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-proto-spec-retry>Try again</button></div>`;
  }
  if (!spec) {
    return emptyHeroHtml({
      title: 'Scope unavailable',
      message: 'This prototype has no spec.json file in team data yet.',
      mascot: 'working',
    });
  }
  const updated = spec.updated
    ? `<div class="proto-spec-updated">Spec updated: ${escHtml(spec.updated)}</div>` : '';
  const summary = spec.summary
    ? `<p class="proto-spec-summary">${escHtml(spec.summary)}</p>` : '';
  const scope = (Array.isArray(spec.scope) && spec.scope.length)
    ? `<div class="proto-spec-scope">${spec.scope.map((g) => `
        <div class="proto-spec-scope-group">
          <div class="proto-spec-scope-title">${escHtml(g.title || g.group || '')}</div>
          <ul class="proto-spec-list">${(g.items || []).map((it) => `<li>${escHtml(it)}</li>`).join('')}</ul>
        </div>`).join('')}</div>`
    : '';
  const out = (Array.isArray(spec.outOfScope) && spec.outOfScope.length)
    ? `<div class="proto-spec-section">
        <h3 class="proto-spec-h">Out of the prototype scope</h3>
        <ul class="proto-spec-list">${spec.outOfScope.map((it) => `<li>${escHtml(it)}</li>`).join('')}</ul>
      </div>`
    : '';
  return `${updated}${summary}${scope}${out}`;
}

// The compliance review (Compliance tab, compliance.json, comparison screenshots)
// was NOT carried over from the old app - a product decision. The details page
// shows the scope of work alone, so there is no tab bar: a single tab is just
// noise. A compliance.json file may sit in team data and is ignored - the
// server exposes no route for it.

function _wireCopyCode(root, item) {
  const btn = root.querySelector('[data-proto-copy-code]');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(item.invitationCode);
      showToast('success', 'Access code copied');
    } catch {
      showToast('danger', 'Could not copy - copy it by hand');
    }
  });
}

function _wireDetailActions(root, item) {
  const editBtn = root.querySelector('[data-proto-edit]');
  if (editBtn) editBtn.addEventListener('click', () => _openProtoForm('edit', item));
  const delBtn = root.querySelector('[data-proto-delete]');
  if (delBtn) delBtn.addEventListener('click', () => _openProtoDeleteModal(item));

  // Building and publishing live in a separate module loaded only here: they
  // concern React prototypes only, and an import('...') in the click handler does
  // not delay the first paint of the page. The preview tab must however be
  // opened inside the gesture, so window.open() runs before runLocalPreview, not
  // in the code after await import().
  const previewBtn = root.querySelector('[data-proto-preview]');
  if (previewBtn) {
    previewBtn.addEventListener('click', () => {
      // The tab MUST open here, synchronously: after await import() this is
      // no longer a user gesture and the browser blocks the window.
      const tab = window.open('', '_blank');
      import('./proto-deploy.js').then((m) => m.runLocalPreview(item, previewBtn, tab));
    });
  }
  const deployBtn = root.querySelector('[data-proto-deploy]');
  if (deployBtn) {
    deployBtn.addEventListener('click', () => {
      import('./proto-deploy.js').then((m) => m.openProtoDeployModal(item, () => {
        // Publishing persists invitationCode in prototypes.json (server.js
        // _protoPersistCanonicalCode) - this in-memory code is now stale.
        // Invalidate BEFORE repainting, otherwise renderProtoDetailView()
        // paints from the old _itemsCache and the page shows the
        // pre-publish code until the next F5.
        _invalidatePrototypeData('deploy-success');
        renderProtoDetailView();
      }));
    });
  }
}

// Stage C/step 4 — the start command: copyable text handed to the
// assistant (`/prototype`), so continued work lands on THE SAME id and the
// same data path this screen shows - never on an invented folder or a
// separate registry. A pure function (exported for tests): the name is
// stripped of newlines and quotes BEFORE it goes into the one-line command -
// otherwise a multi-line name would cut the command in half, and a quote in
// the name would close the quotation early.
/**
 * @param {{id?: string, name?: string}|null} item
 * @returns {string}
 */
export function protoStartCommand(item) {
  const id = (item && item.id) || '';
  if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) {
    return 'Invalid prototype id. Fix the registry entry before starting work.';
  }
  const rawName = (item && item.name) || id;
  const name = String(rawName).replace(/[\r\n]+/g, ' ').replace(/"/g, '\u201d').trim() || id;
  const dataPath = 'data-sub-repositories/ds-data/prototypes/' + id;
  return `/prototype Develop prototype ${id} ("${name}", React, ${dataPath}). Scope to deliver: <describe the scope of work>`;
}

function _startCommandHtml(item) {
  const cmd = protoStartCommand(item);
  return `<div class="proto-detail-command">
      <div class="proto-detail-command-label">Start command for the assistant</div>
      <pre class="proto-detail-command-box"><code>${escHtml(cmd)}</code></pre>
      <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-proto-copy-cmd>${_COPY_SVG}<span>Copy command</span></button>
    </div>`;
}

function _wireCopyCommand(root, item) {
  const btn = root.querySelector('[data-proto-copy-cmd]');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(protoStartCommand(item));
      showToast('success', 'Start command copied');
    } catch {
      showToast('danger', 'Could not copy - copy it by hand');
    }
  });
}

function _paintNotFound(root, id) {
  root.innerHTML = `<div class="page-header">
      <div class="page-header-row">
        <div><a class="back-to-dash" href="#prototypy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>Prototypes</a></div>
      </div>
    </div>
    <div class="ds-callout ds-callout--danger"><div>No prototype found with id <code>${escHtml(id)}</code>.</div></div>`;
}

function _paintDetail(root, item, deployStatus, extras) {
  const isReact = protoIsReact(item);
  const isMissing = item.format === 'missing';
  // 'missing': neither index.tsx (React) nor render.js (vanilla legacy) - an old
  // metadata entry without source files (server.js _protoFormat). Never the
  // result of a new POST - that always ends with a loaded starter or an error
  // BEFORE the registry is written. No button may lead to an empty
  // #proto-standalone for such an entry - runLinkHtml stays empty, and the state
  // is explained by an explicit message below.
  const runLinkHtml = isMissing || (isReact && !deployStatus.baseUrl) ? '' : `<a class="ds-btn ds-btn--primary" href="${escHtml(
    isReact ? protoLaunchUrl(deployStatus.baseUrl, item.id) : '#proto-standalone/' + encodeURIComponent(item.id),
  )}" target="_blank" rel="noopener">${_PLAY_SVG}<span>Run prototype</span></a>`;

  const missingHtml = isMissing ? `<div class="ds-callout ds-callout--warning proto-detail-missing">
      <div>This prototype has no source files yet (neither <code>index.tsx</code> nor <code>render.js</code>)
      in team data. Paste the start command below into the assistant to create them.</div>
    </div>` : '';

  const codeHtml = item.invitationCode
    ? `<div class="proto-detail-code-row">
        <span class="proto-detail-label">Access code</span>
        <code class="proto-invitation-code">${escHtml(item.invitationCode)}</code>
        <button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-proto-copy-code title="Copy access code" aria-label="Copy access code">${_COPY_SVG}</button>
      </div>`
    : '';

  const updated = item.updated_at || item.created_at || '';
  const updatedHtml = updated
    ? `<div class="proto-detail-updated">Last change: ${escHtml(String(updated).slice(0, 10))}</div>` : '';

  root.innerHTML = `<div class="page-header">
      <div class="page-header-row">
        <div>
          <a class="back-to-dash" href="#prototypy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"></polyline></svg>Prototypes</a>
          <h1>${escHtml(item.name || item.id)}</h1>
          ${_initiatives[item.discoveryTaskId || ''] ? `<div class="proto-detail-initiative">Initiative: ${escHtml(_initiatives[item.discoveryTaskId])}</div>` : ''}
          ${updatedHtml}
        </div>
        <div class="page-header-actions">
          ${runLinkHtml}
          ${isReact && deployStatus.canBuild ? `<button type="button" class="ds-btn ds-btn--secondary" data-proto-preview title="Build and run the prototype locally">${_LOCAL_SVG}<span>Local preview</span></button>` : ''}
          ${isReact && deployStatus.enabled ? `<button type="button" class="ds-btn ds-btn--secondary" data-proto-deploy title="Publish the prototype to the shared hosting">${_DEPLOY_SVG}<span>Publish</span></button>` : ''}
          <button type="button" class="ds-btn ds-btn--secondary" data-proto-edit>${_EDIT_SVG}<span>Edit</span></button>
          <button type="button" class="ds-btn ds-btn--danger" data-proto-delete>${_TRASH_SVG}<span>Remove</span></button>
        </div>
      </div>
      <div class="proto-detail-infobox">
        ${codeHtml}
        ${_ownersDetailHtml(item.owners)}
      </div>
      ${missingHtml}
      ${deployStatus.failed ? `<div class="ds-callout ds-callout--warning"><div>Could not check the preview and publishing options.</div></div>
        <button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-proto-status-retry>Try again</button>` : ''}
    </div>
    <section class="proto-detail-panels">
      <h2 class="proto-detail-section-h">Scope of work</h2>
      ${_specSectionHtml(extras.spec, extras.specFailed)}
      ${_startCommandHtml(item)}
    </section>`;

  const specRetry = root.querySelector('[data-proto-spec-retry]');
  if (specRetry) specRetry.addEventListener('click', () => { renderProtoDetailView(); });
  const statusRetry = root.querySelector('[data-proto-status-retry]');
  if (statusRetry) statusRetry.addEventListener('click', () => { renderProtoDetailView(); });
  _wireCopyCode(root, item);
  _wireCopyCommand(root, item);
  _wireDetailActions(root, item);
}

let _detailRenderGeneration = 0;

/** Paints the details page of the prototype named in #proto-detail/<id>. */
export async function renderProtoDetailView(subPath) {
  const root = document.getElementById('proto-detail-root');
  if (!root) return;
  const renderGen = ++_detailRenderGeneration;
  const dataGen = _dataGeneration;
  const deployGen = _deployGeneration;
  const hash = typeof location === 'undefined' ? '' : location.hash;
  const isCurrent = () => renderGen === _detailRenderGeneration
    && dataGen === _dataGeneration && deployGen === _deployGeneration
    && (typeof location === 'undefined' || location.hash === hash);

  // The router passes the part of the URL after '#proto-detail/' as subPath - we
  // read THAT, not location.hash, because on a refresh after a data sync render
  // is called with a remembered subPath, which need not equal the current hash.
  // Parsing the hash stays as a fallback (calls from the "Try again" button have
  // nothing to pass).
  const id = (subPath ? decodeURIComponent(String(subPath)) : '') || _idFromHash('#proto-detail/');
  if (!id) {
    root.innerHTML = '<div class="ds-callout ds-callout--danger"><div>Invalid URL - the prototype id is missing.</div></div>';
    return;
  }

  let items;
  try {
    items = (await _ensureItems()).items;
  } catch (e) {
    if (!isCurrent()) return;
    // A list fetch failure - not "no such prototype". Clear the skeleton and
    // offer a working retry, as in the registry.
    root.innerHTML = `<div class="ds-callout ds-callout--warning">
        <div>Could not load the prototype data. Check your connection and try again.</div>
      </div>
      <div class="proto-empty-cta"><button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-proto-retry>Refresh</button></div>`;
    const btn = root.querySelector('[data-proto-retry]');
    if (btn) btn.addEventListener('click', () => { renderProtoDetailView(); });
    showToast('danger', 'Could not load the prototype data', (e && e.message) || '');
    return;
  }
  if (!isCurrent()) return;
  const item = items.find((i) => i.id === id);
  if (!item) {
    _paintNotFound(root, id);
    return;
  }

  await loadTeamDirectory().catch(() => { /* an empty directory is a normal state */ });
  const [deployStatus, extras] = await Promise.all([
    _fetchDeployStatus(),
    _loadDetailExtras(id),
    fetch('/api/prototypes/initiatives')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (isCurrent() && j && j.map) _initiatives = j.map; })
      .catch(() => { /* optional initiative labels */ }),
  ]);
  if (isCurrent()) _paintDetail(root, item, deployStatus, extras);
}

/**
 * Hook for VIEW_REGISTRY['proto-detail'].refresh - called by
 * refreshActiveView() (js/app.js) as refresh(subPath, {}) only when the
 * details page is active. subPath (the prototype id from the hash) MUST be
 * passed on to renderProtoDetailView - otherwise the refresh reads the id from
 * the current location.hash, which only works by accident (see the comment in
 * renderProtoDetailView on subPath vs. hash). renderProtoDetailView() always
 * fetches again (there is no shortcut like in the registry), so invalidating
 * the cache BEFORE repainting is enough to avoid hitting a not-yet-expired
 * entry.
 * @param {string} [subPath]
 */
export function refreshProtoDetail(subPath) {
  _invalidatePrototypeData();
  _invalidateDeployStatus();
  return renderProtoDetailView(subPath);
}

/**
 * EMPTY ON PURPOSE. js/app.js calls runInit and right after it render,
 * so painting from here meant two full passes - two fetch rounds and two
 * repaints - on every first visit and on every refresh after a data sync. The
 * page sets up no timers or global listeners either, so there is nothing to
 * register for cleanup.
 */
export function initProtoDetail() {
}

// ── Stage 2: add / edit form ─────────────────────────────────────────────────
// One modal, two modes (create/edit), through js/ds-modal.js. Built once as a
// singleton appended to <body> on first open - exactly the
// js/local-changes-modal.js pattern - so the modal listeners do NOT need
// registerViewCleanup: they live as long as the app, not as long as one view,
// and do not multiply when the view is re-entered (the element is created
// once, `_formOverlay` remembers it).
//
// The `area` and `discoveryTaskId` fields are NOT in the form (out of the
// plan's scope) - the payload sends ONLY name and owners, so PUT merges them
// over the existing entry without touching those two fields.

const FORM_MODAL_ID = 'proto-form-modal';
let _formOverlay = null;
let _formMode = 'create'; // 'create' | 'edit'
let _formItemId = null;
/** @type {Set<string>} tm-* ids ticked in the form */
let _formSelectedOwners = new Set();

function _ownerPickerRowHtml(member) {
  const id = member.id;
  const name = fullName(member) || id;
  const url = memberAvatarUrl(member);
  const ini = escHtml(initials(name));
  const avatarHtml = url
    ? `<img class="proto-owner-avatar" src="${escHtml(url)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="proto-owner-avatar proto-owner-avatar--fallback">${ini}</span>`;
  return `<label class="ds-checkbox-label proto-owner-picker-row" data-proto-owner-row="${escHtml(id)}">
    <input type="checkbox" data-proto-owner-checkbox value="${escHtml(id)}">
    ${avatarHtml}
    <span>${escHtml(name)}</span>
  </label>`;
}

function _ownerPickerHtml() {
  const members = getTeamMembers();
  if (!members.length) {
    return '<p class="ds-hint">The team directory is empty - download it in the Sync window.</p>';
  }
  return `<input type="search" class="ds-input proto-owner-search" id="proto-form-owner-search"
      placeholder="Search people by first name, last name, role or team..." aria-label="Search people" autocomplete="off">
    <div class="proto-owner-picker">${members.map(_ownerPickerRowHtml).join('')}
      <p class="ds-hint proto-owner-picker-empty" hidden>Nobody matches the search.</p>
    </div>
    <span class="ds-hint" id="proto-form-owner-count"></span>`;
}

/** Ticked people always at the top of the list, then the directory order. */
function _sortOwnerPickerRows(ownersEl) {
  const picker = ownersEl.querySelector('.proto-owner-picker');
  if (!picker) return;
  const rows = Array.from(picker.querySelectorAll('[data-proto-owner-row]'));
  const selected = rows.filter((r) => _formSelectedOwners.has(r.dataset.protoOwnerRow));
  const rest = rows.filter((r) => !_formSelectedOwners.has(r.dataset.protoOwnerRow));
  const empty = picker.querySelector('.proto-owner-picker-empty');
  [...selected, ...rest].forEach((r) => picker.insertBefore(r, empty));
}

function _applyOwnerSearch(ownersEl) {
  const input = ownersEl.querySelector('#proto-form-owner-search');
  if (!input) return;
  const hits = matchOwnerMembers(getTeamMembers(), input.value);
  let visible = 0;
  ownersEl.querySelectorAll('[data-proto-owner-row]').forEach((row) => {
    const show = hits.has(row.dataset.protoOwnerRow);
    row.hidden = !show;
    if (show) visible += 1;
  });
  const empty = ownersEl.querySelector('.proto-owner-picker-empty');
  if (empty) empty.hidden = visible > 0;
}

function _updateOwnerCount(ownersEl) {
  const el = ownersEl.querySelector('#proto-form-owner-count');
  if (el) el.textContent = _formSelectedOwners.size ? `Selected people: ${_formSelectedOwners.size}` : '';
}

function _ensureFormModal() {
  if (_formOverlay) return _formOverlay;

  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.id = FORM_MODAL_ID;
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="ds-modal" role="dialog" aria-modal="true" aria-labelledby="proto-form-title">
      <div class="ds-modal-header">
        <span class="ds-modal-title" id="proto-form-title">Add prototype</span>
        <button type="button" class="ds-modal-close" id="proto-form-x" aria-label="Close">&times;</button>
      </div>
      <div class="ds-modal-body">
        <div class="ds-callout ds-callout--danger" id="proto-form-error" hidden><div></div></div>
        <div class="ds-input-wrap">
          <label class="ds-label" for="proto-form-name">Name</label>
          <input type="text" class="ds-input" id="proto-form-name" maxlength="${PROTO_NAME_MAX_LEN}" placeholder="Prototype name" autocomplete="off">
          <span class="ds-hint ds-hint--error" id="proto-form-name-error" hidden></span>
        </div>
        <div class="ds-input-wrap">
          <span class="ds-label">Owners</span>
          <div id="proto-form-owners"></div>
        </div>
      </div>
      <div class="ds-modal-footer">
        <button type="button" class="ds-btn ds-btn--tertiary" id="proto-form-cancel">Cancel</button>
        <button type="button" class="ds-btn ds-btn--primary" id="proto-form-save">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => closeDsModal(overlay);
  overlay.querySelector('#proto-form-x').addEventListener('click', close);
  overlay.querySelector('#proto-form-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#proto-form-owners').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-proto-owner-checkbox]');
    if (!cb) return;
    if (cb.checked) _formSelectedOwners.add(cb.value); else _formSelectedOwners.delete(cb.value);
    _updateOwnerCount(e.currentTarget);
  });
  overlay.querySelector('#proto-form-owners').addEventListener('input', (e) => {
    if (e.target.id === 'proto-form-owner-search') _applyOwnerSearch(e.currentTarget);
  });
  // Enter in the search box ticks the only matching person instead of doing nothing.
  overlay.querySelector('#proto-form-owners').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.id !== 'proto-form-owner-search') return;
    e.preventDefault();
    const visible = Array.from(e.currentTarget.querySelectorAll('[data-proto-owner-row]')).filter((r) => !r.hidden);
    if (visible.length !== 1) return;
    const cb = visible[0].querySelector('[data-proto-owner-checkbox]');
    cb.checked = !cb.checked;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  });
  overlay.querySelector('#proto-form-save').addEventListener('click', () => _submitProtoForm(overlay));
  _formOverlay = overlay;
  return overlay;
}

async function _submitProtoForm(overlay) {
  const nameInput = overlay.querySelector('#proto-form-name');
  const nameErr = overlay.querySelector('#proto-form-name-error');
  const errBox = overlay.querySelector('#proto-form-error');
  const saveBtn = overlay.querySelector('#proto-form-save');
  const cancelBtn = overlay.querySelector('#proto-form-cancel');

  errBox.hidden = true;
  nameErr.hidden = true;
  nameInput.classList.remove('ds-input--error');

  const check = validatePrototypeName(nameInput.value);
  if (!check.valid) {
    nameInput.classList.add('ds-input--error');
    nameErr.textContent = check.error;
    nameErr.hidden = false;
    nameInput.focus();
    return;
  }

  // area and discoveryTaskId NEVER enter the payload - PUT merges over the
  // existing entry, so leaving them out keeps the server's values unchanged.
  const payload = {
    name: check.value,
    owners: Array.from(_formSelectedOwners),
  };
  const origLabel = saveBtn.textContent;
  saveBtn.disabled = true;
  cancelBtn.disabled = true;
  saveBtn.textContent = 'Saving...';
  try {
    const data = (_formMode === 'edit' && _formItemId)
      ? await _apiUpdatePrototype(_formItemId, payload)
      : await _apiCreatePrototype(payload);
    if (data && data.item) _cacheUpsertItem(data.item);
    closeDsModal(overlay);
    showToast(
      'success',
      _formMode === 'edit' ? 'Prototype updated' : 'Prototype added',
      (data && data.item && data.item.name) || check.value,
    );
    if (_formMode === 'edit') {
      renderProtoDetailView();
    } else {
      renderPrototypyView();
    }
  } catch (e) {
    const msg = protoErrorMessage(e && e.code);
    errBox.hidden = false;
    errBox.querySelector('div').textContent = msg;
    showToast('danger', 'Could not save the prototype', msg);
  } finally {
    saveBtn.disabled = false;
    cancelBtn.disabled = false;
    saveBtn.textContent = origLabel;
  }
}

/**
 * Opens the form in create or edit mode.
 * @param {'create'|'edit'} mode
 * @param {object|null} item the entry being edited (null when creating)
 */
async function _openProtoForm(mode, item) {
  const overlay = _ensureFormModal();
  _formMode = mode;
  _formItemId = item ? item.id : null;
  _formSelectedOwners = new Set(Array.isArray(item && item.owners) ? item.owners : []);

  overlay.querySelector('#proto-form-title').textContent = mode === 'edit' ? 'Edit prototype' : 'Add prototype';
  overlay.querySelector('#proto-form-error').hidden = true;
  const nameErr = overlay.querySelector('#proto-form-name-error');
  nameErr.hidden = true;
  const nameInput = overlay.querySelector('#proto-form-name');
  nameInput.classList.remove('ds-input--error');
  nameInput.value = (item && item.name) || '';

  await loadTeamDirectory().catch(() => { /* an empty directory is a normal state */ });
  const ownersEl = overlay.querySelector('#proto-form-owners');
  ownersEl.innerHTML = _ownerPickerHtml();
  ownersEl.querySelectorAll('[data-proto-owner-checkbox]').forEach((cb) => {
    cb.checked = _formSelectedOwners.has(cb.value);
  });
  _sortOwnerPickerRows(ownersEl);
  _updateOwnerCount(ownersEl);
  openDsModal(overlay);
  requestAnimationFrame(() => nameInput.focus());
}

// ── Stage 2: removal, with confirmation ──────────────────────────────────────
// A separate modal (not a stack of two overlays) - opened directly from the
// Remove button on the details page, never from inside the edit form.

const DELETE_MODAL_ID = 'proto-delete-modal';
let _deleteOverlay = null;
let _deleteItemId = null;

function _ensureDeleteModal() {
  if (_deleteOverlay) return _deleteOverlay;

  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  overlay.id = DELETE_MODAL_ID;
  overlay.hidden = true;
  overlay.innerHTML = `
    <div class="ds-modal" role="dialog" aria-modal="true" aria-labelledby="proto-delete-title">
      <div class="ds-modal-header">
        <span class="ds-modal-title" id="proto-delete-title">Remove prototype</span>
        <button type="button" class="ds-modal-close" id="proto-delete-x" aria-label="Close">&times;</button>
      </div>
      <div class="ds-modal-body">
        <div class="ds-callout ds-callout--warning">
          <div>Removing deletes the registry entry and the prototype files on disk - this cannot be undone. The rest of the team sees the removal only after you send it through the Sync window.</div>
        </div>
        <p id="proto-delete-name"></p>
      </div>
      <div class="ds-modal-footer">
        <button type="button" class="ds-btn ds-btn--tertiary" id="proto-delete-cancel">Cancel</button>
        <button type="button" class="ds-btn ds-btn--danger" id="proto-delete-confirm">Remove prototype</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => closeDsModal(overlay);
  overlay.querySelector('#proto-delete-x').addEventListener('click', close);
  overlay.querySelector('#proto-delete-cancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#proto-delete-confirm').addEventListener('click', () => _confirmProtoDelete(overlay));

  _deleteOverlay = overlay;
  return overlay;
}

function _openProtoDeleteModal(item) {
  const overlay = _ensureDeleteModal();
  _deleteItemId = item.id;
  overlay.querySelector('#proto-delete-name').textContent = item.name || item.id;
  openDsModal(overlay);
}

async function _confirmProtoDelete(overlay) {
  const confirmBtn = overlay.querySelector('#proto-delete-confirm');
  const cancelBtn = overlay.querySelector('#proto-delete-cancel');
  const id = _deleteItemId;
  const origLabel = confirmBtn.textContent;
  confirmBtn.disabled = true;
  cancelBtn.disabled = true;
  confirmBtn.textContent = 'Removing...';
  try {
    await _apiDeletePrototype(id);
    _cacheRemoveItem(id);
    closeDsModal(overlay);
    showToast('success', 'Prototype removed', 'The entry and the prototype files were removed.');
    // The details page of this prototype no longer exists - go back to the
    // registry, which the hashchange in app.js turns into navigation.
    location.hash = '#prototypy';
  } catch (e) {
    const msg = protoErrorMessage(e && e.code);
    showToast('danger', 'Could not remove the prototype', msg);
  } finally {
    confirmBtn.disabled = false;
    cancelBtn.disabled = false;
    confirmBtn.textContent = origLabel;
  }
}

// ── Embedded preview (proto-standalone) - content only in stage 5 ────────────

/** Section empty on purpose in stage 1 - see index.html #view-proto-standalone. */
export function renderProtoStandaloneView() {
  // no-op until stage 5
}

export function initProtoStandalone() {
  // no-op until stage 5
}
