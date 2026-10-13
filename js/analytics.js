// ── Mission Deck — js/analytics.js ───────────────────────────────────────────────
// The ONLY module that talks to the Amplitude SDK (vendored at
// /vendor/amplitude/amplitude-min.js, loaded via a classic <script defer> tag
// in index.html before this module runs). Every export is no-op-safe: a
// missing SDK, a blocked network request, or a thrown enrichment plugin must
// degrade to silence, never to a broken view.
//
// Hard constraint: no unguarded `window` / `document` / `localStorage` access
// at module top level, and zero app imports (no `import` statements at all) --
// this keeps the module importable under plain Node so tests/test_analytics.mjs
// can exercise the pure helpers (normalizeApiPath, trackEvent-before-init)
// without a DOM.
//
// Analytics is OPT-IN and off by default. GET /api/analytics/config answers
// { enabled, apiKey }: enabled only when ANALYTICS_KEY in .env holds an
// Amplitude browser key and the ANALYTICS_ENABLED kill switch is not 0. No
// key is ever built into this file. Identity comes from GET /api/whoami.

import { fetchWhoami } from './whoami.js';
import { fetchAppVersion } from './app-version.js';

// The Amplitude browser key, handed over by GET /api/analytics/config (from
// ANALYTICS_KEY in .env). Browser-SDK keys are write-only by design. Never add
// a key, secret or not, to this file or anywhere in js/.
let _apiKey = null;

// Module-local context, merged into every tracked event by the enrichment
// plugin. Populated via setAnalyticsContext() from js/app.js (navigation) and
// from the self-contained identity/version bootstrap in initAnalytics().
let _ctx = {};

// True once amplitude.init() has actually run. trackEvent() is a silent
// no-op before this (and forever, if the SDK never loads at all).
let _ready = false;
let _initStarted = false;

// ── Pure helpers (Node-importable, no window/document) ──────────────────────

const _ID_PATTERNS = [
  /^\d+$/,
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
  /^[A-Z][A-Z0-9]+-\d+$/,
];

function _looksLikeId(segment) {
  if (segment.indexOf('.') !== -1) return true;
  if (segment.indexOf('%') !== -1) return true;
  if (segment.length > 24) return true;
  return _ID_PATTERNS.some((re) => re.test(segment));
}

// Normalizes a raw API path (optionally with querystring/hash) into a stable,
// low-cardinality shape for the `endpoint_path` event property. Without this,
// ids and cache-bust `?t=` params explode the property into thousands of
// distinct values and every chart built on it becomes useless.
//
// Rule: strip query/hash, keep 'api' + the immediate resource segment
// verbatim, then replace any segment from the 3rd position onward with ':id'
// when it looks like a numeric id, a UUID, a Jira key (PROJ-1234), a
// filename (contains '.'), is percent-encoded, or is longer than 24 chars.
// Cap the result at 6 segments.
export function normalizeApiPath(url) {
  if (!url) return '';
  let pathname;
  try {
    if (/^https?:\/\//i.test(String(url))) {
      pathname = new URL(String(url)).pathname;
    } else {
      pathname = String(url).split('?')[0].split('#')[0];
    }
  } catch (_e) {
    pathname = String(url).split('?')[0].split('#')[0];
  }
  const segments = pathname.split('/').filter(Boolean);
  const normalized = segments.map((seg, i) => (i >= 2 && _looksLikeId(seg)) ? ':id' : seg);
  const capped = normalized.slice(0, 6);
  return '/' + capped.join('/');
}

// ── Enrichment plugin ─────────────────────────────────────────────────────────
// Merges the global properties table into every tracked event, live-context
// ones AND drained buffer replays.
// Buffered events (enqueued by js/theme-boot.js before this module ever ran)
// carry their own enqueue-time `__bufferedHash` marker; when present, the
// plugin derives `view`/`base_view` from THAT snapshot instead of the
// (possibly newer) live context, so an early event is never mis-attributed
// to whatever view happens to be active at drain time.
function _createEnrichmentPlugin() {
  return {
    name: 'cockpit-context',
    type: 'enrichment',
    setup: async () => undefined,
    execute: async (event) => {
      try {
        const ep = Object.assign({}, event.event_properties || {});
        const bufferedHash = ep.__bufferedHash;
        delete ep.__bufferedHash;
        if (bufferedHash !== undefined && bufferedHash !== null) {
          const view = String(bufferedHash).replace(/^#/, '') || null;
          if (ep.view === undefined) ep.view = view;
          if (ep.base_view === undefined) ep.base_view = view ? view.split('/')[0] : null;
          if (ep.perspective === undefined) ep.perspective = _ctx.perspective ?? null;
          if (ep.view_title === undefined) ep.view_title = _ctx.view_title ?? null;
          if (ep.hub_group === undefined) ep.hub_group = _ctx.hub_group ?? null;
        } else {
          if (ep.perspective === undefined) ep.perspective = _ctx.perspective ?? null;
          if (ep.view === undefined) ep.view = _ctx.view ?? null;
          if (ep.base_view === undefined) ep.base_view = _ctx.base_view ?? null;
          if (ep.view_title === undefined) ep.view_title = _ctx.view_title ?? null;
          if (ep.hub_group === undefined) ep.hub_group = _ctx.hub_group ?? null;
        }
        // `perspective` is always null here - this app has no perspective model.
        // Sent anyway: the Amplitude project is shared with another app that does
        // set it, and a chart grouping by a property set has to receive the same
        // property set from every producer or the series silently splits.
        //
        // `cockpit` is the one property that MUST be on every event. It is the
        // only filter that separates this app's traffic from everything else in
        // that shared project.
        if (ep.cockpit === undefined) ep.cockpit = 'starter';
        if (ep.app_version === undefined) ep.app_version = _ctx.app_version ?? null;
        if (ep.app_hash === undefined) ep.app_hash = _ctx.app_hash ?? null;
        if (ep.theme === undefined) {
          try { ep.theme = document.documentElement.dataset.theme || null; } catch (_e2) { ep.theme = null; }
        }
        // Normalize at send/drain time -- js/theme-boot.js enqueues the RAW
        // path on purpose (stays dumb, no shared logic with this module).
        // This is the one place every endpoint_path-bearing event (both
        // live-tracked and drained-from-buffer) passes through, so normalizing
        // here covers all of them without touching theme-boot.js.
        if (ep.endpoint_path) ep.endpoint_path = normalizeApiPath(ep.endpoint_path);
        event.event_properties = ep;
      } catch (_e) { /* enrichment must never break tracking */ }
      return event;
    },
  };
}

// ── Buffer drain (replays events queued by js/theme-boot.js pre-init) ───────
function _drainBufferedQueue() {
  try {
    const queue = (typeof window !== 'undefined' && Array.isArray(window.__cockpitTrackQueue))
      ? window.__cockpitTrackQueue
      : [];
    queue.forEach((item) => {
      try {
        window.amplitude.track(item.name, Object.assign({}, item.props || {}, { __bufferedHash: item.hash }));
      } catch (_e) { /* no-op */ }
    });
  } catch (_e) { /* no-op */ }
  try { if (typeof window !== 'undefined') window.__cockpitTrackQueue = []; } catch (_e) { /* no-op */ }
}

function _liveTrack(name, props) {
  try { window.amplitude.track(name, props || {}); } catch (_e) { /* no-op */ }
}

// Coarse OS label for the user profile. navigator.platform is deprecated, so
// userAgentData wins where it exists and the UA string is the fallback.
function _osName() {
  try {
    const uaData = navigator.userAgentData;
    if (uaData && uaData.platform) return String(uaData.platform);
    const ua = String(navigator.userAgent || '');
    if (/Windows/i.test(ua)) return 'Windows';
    if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
    if (/Linux/i.test(ua)) return 'Linux';
    return 'unknown';
  } catch (_e) { return 'unknown'; }
}

// Fire-and-forget identity + app-version bootstrap. Reads through the two
// shared readers (js/whoami.js, js/app-version.js) rather than fetching on its
// own, so the top bar and this file cost one request each on boot, not two -
// still no coupling to js/topbar.js. Never blocks boot -- both are GET and
// cannot re-enter the mutating-fetch patch in theme-boot.js.
function _bootstrapIdentityAndVersion() {
  const _kick = () => {
    fetchWhoami()
      .then((data) => { if (data) identifyUser(data); })
      .catch(() => undefined);
    fetchAppVersion()
      .then((data) => { if (data) setAnalyticsContext({ app_version: data.semver ?? null, app_hash: data.hash ?? null }); })
      .catch(() => undefined);
  };
  try {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(_kick, { timeout: 2000 });
    else setTimeout(_kick, 1500);
  } catch (_e) { /* no-op */ }
}

function _finishInit() {
  try {
    const _initResult = window.amplitude.init(_apiKey, {
      serverZone: 'EU',
      autocapture: {
        sessions: true,
        attribution: true,
        webVitals: true,
        pageViews: false,
        elementInteractions: false,
        frustrationInteractions: false,
        formInteractions: false,
        fileDownloads: false,
        networkTracking: false,
      },
    });

    // The SDK attaches its destination (transport) plugin ASYNCHRONOUSLY.
    // init() returns { promise }; anything tracked before that promise settles
    // hits an instance with no destination and is DROPPED with a
    // "no destination plugins on the instance" warning -- it is not queued.
    // So every post-init step waits for it, and window.__cockpitTrack keeps
    // buffering until then, so no boot-time event is lost.
    const _initDone = (_initResult && typeof _initResult.promise === 'object' && _initResult.promise !== null
      && typeof _initResult.promise.then === 'function')
      ? _initResult.promise
      : Promise.resolve();

    // add() stays synchronous, in the same tick as init(): that is where it
    // already worked (every event carries enrichment), and calling add() only
    // AFTER init settles wakes the SDK's internal diagnostics reporter, which
    // POSTs to a diagnostics host that is deliberately not in our CSP allowlist.
    window.amplitude.add(_createEnrichmentPlugin());

    _initDone.then(() => {
      try {
        _drainBufferedQueue();
        window.__cockpitTrack = _liveTrack;
        _ready = true;
        _bootstrapIdentityAndVersion();
      } catch (_e) {
        _ready = false;
      }
    }, () => {
      // init() rejected -- stay permanently no-op rather than half-initialized.
      _ready = false;
    });
  } catch (_e) {
    // The SDK exists but init blew up (bad build, ad-blocker mangling the
    // global, etc). Stay permanently no-op rather than half-initialized.
    _ready = false;
  }
}

// Waits for the SDK global. The vendored <script defer> tag is guaranteed to
// run before this module, but a load failure or ad-blocker could still leave
// it missing, so retry once on the window 'load' event; if still missing,
// permanently no-op and drop the pre-init buffer so it cannot grow unbounded.
function _startSdk() {
  try {
    if (window.amplitude) {
      _finishInit();
      return;
    }
    window.addEventListener('load', () => {
      try {
        if (_ready) return;
        if (window.amplitude) {
          _finishInit();
        } else if (Array.isArray(window.__cockpitTrackQueue)) {
          window.__cockpitTrackQueue = [];
        }
      } catch (_e) { /* no-op */ }
    }, { once: true });
  } catch (_e) { /* no-op */ }
}

// Fail-CLOSED: analytics is opt-in, so an unreachable or malformed answer, or
// an answer without a key, leaves it off.
function _fetchEnabled() {
  try {
    return fetch('/api/analytics/config', { cache: 'no-store' })
      .then((r) => (r && r.ok ? r.json() : null))
      .then((d) => {
        if (!d || d.enabled !== true || typeof d.apiKey !== 'string' || !d.apiKey) return false;
        _apiKey = d.apiKey;
        return true;
      })
      .catch(() => false);
  } catch (_e) {
    return Promise.resolve(false);
  }
}

// Kill switch taken: swap the pre-init buffer for a no-op and drop whatever it
// already holds, so the queue cannot grow for the life of the page.
function _disableAnalytics() {
  try {
    window.__cockpitTrackQueue = [];
    window.__cockpitTrack = function () { /* analytics disabled */ };
  } catch (_e) { /* no-op */ }
}

// Initializes the SDK exactly once. Stays synchronous for its callers
// (js/app.js calls it in the same tick as the boot navigate()); the enabled
// probe and the SDK handshake both run behind the pre-init buffer.
export function initAnalytics() {
  if (_initStarted) return;
  _initStarted = true;
  try {
    if (typeof window === 'undefined') return;
    _fetchEnabled().then((enabled) => {
      if (enabled) _startSdk();
      else _disableAnalytics();
    }, () => _disableAnalytics());
  } catch (_e) { /* no-op -- analytics must never be able to break boot */ }
}

// The only function most call sites need. No-op (never throws, never
// rejects) when uninitialised or when the SDK never loaded.
export function trackEvent(name, props) {
  try {
    if (typeof window === 'undefined') return undefined;
    if (!_ready || !window.amplitude) {
      // Not ready yet. A direct track() here would be DROPPED, not queued: the
      // SDK attaches its destination plugin asynchronously (see _finishInit).
      // This is not an edge case -- js/app.js calls initAnalytics() and the boot
      // navigate() in the SAME synchronous tick, so the very first "View Viewed"
      // of every session lands here. Hand it to the same bounded (200, drop-oldest)
      // pre-init buffer js/theme-boot.js fills; _drainBufferedQueue() flushes it
      // once the transport is genuinely live. While _ready is false
      // window.__cockpitTrack IS that buffering function (it is only swapped for
      // _liveTrack after the drain), so there is no recursion here.
      if (typeof window.__cockpitTrack === 'function') window.__cockpitTrack(name, props || {});
      return undefined;
    }
    window.amplitude.track(name, props || {});
  } catch (_e) { /* no-op */ }
  return undefined;
}

// user_id = person_slug, derived from the GitLab token's own name. Chosen over
// an email because it needs no directory lookup and is the same string on every
// machine the person configures with that token. No slug -> stay
// device-scoped rather than inventing one.
export function identifyUser(whoami) {
  try {
    if (typeof window === 'undefined' || !window.amplitude || !whoami) return;
    // GET /api/whoami answers { valid:false, source:'none' } (no identity
    // fields at all) before any token, git config or OS account resolves.
    // Stay device-scoped in that case instead of sending an empty $identify.
    if (whoami.valid === false) return;
    const userId = whoami.person_slug || undefined;
    if (userId) window.amplitude.setUserId(userId);
    const identify = new window.amplitude.Identify();
    if (whoami.display_name) identify.set('full_name', whoami.display_name);
    if (whoami.person_slug) identify.set('person_slug', whoami.person_slug);
    if (whoami.gitlab_username) identify.set('gitlab_username', whoami.gitlab_username);
    if (whoami.source) identify.set('identity_source', whoami.source);
    identify.set('cockpit', 'starter');
    identify.set('os', _osName());
    if (_ctx.app_version) identify.set('app_version', _ctx.app_version);
    window.amplitude.identify(identify);
  } catch (_e) { /* no-op */ }
}

// Merges a patch into the module-local context read by the enrichment
// plugin. Does NOT import js/state.js -- see module header.
export function setAnalyticsContext(patch) {
  try { Object.assign(_ctx, patch || {}); } catch (_e) { /* no-op */ }
}
