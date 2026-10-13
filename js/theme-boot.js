// ── Mission Deck — js/theme-boot.js ──────────────────────────────────────
// FOUC guard: sets data-theme on <html> BEFORE any stylesheet loads.
// Loaded synchronously in <head> as a classic script, so it must stay
// dependency-free and side-effect-only (no imports, no exports).
(function () {
  try {
    const stored = localStorage.getItem('cockpit-theme');
    const mode = (stored === 'light' || stored === 'dark' || stored === 'system') ? stored : 'system';
    const resolved = mode === 'system'
      ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : mode;
    document.documentElement.setAttribute('data-theme', resolved);
  } catch (_e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();

// ── Rail state guard ────────────────────────────────────────────────────────
// Same reason as the theme block above, for the horizontal axis: the rail is
// 72px collapsed and 300px expanded, and .main's left margin tracks it. Left to
// js/topbar.js _applyRailState (which runs only once js/app.js has loaded) the
// page paints in the WRONG state first and the whole grid slides 228px sideways
// on every load. The CSS keys off this attribute alone; the .collapsed /
// .sidebar-collapsed classes stay for the JS that queries them, and
// _applyRailState keeps all three in sync. Default is collapsed - the same
// default that function applies for a person who never touched the toggle.
(function () {
  let collapsed = true;
  try {
    const stored = localStorage.getItem('cockpit.sidebarCollapsed');
    if (stored !== null) collapsed = stored === '1';
  } catch (_e) { /* private mode - keep the default */ }
  document.documentElement.setAttribute('data-rail', collapsed ? 'collapsed' : 'expanded');
})();

// ── Update banner reservation ───────────────────────────────────────────────
// The last thing on this page that still moved the whole grid on load. The
// banner is position:fixed, but .main pads itself out of its way, so the
// padding flips 68px -> 108px the moment /api/app/check-update answers and
// every view drops 40px. Nothing static can reserve that: whether there IS an
// update is exactly what the request is asking. So the LAST answer is
// remembered and the row is reserved from it, the same trade the module rail
// makes in js/rail-placeholders.js. While an update sits un-applied this is
// right on every load; it is wrong exactly once, on the reload straight after
// an update, and js/update-banner.js releases it as soon as any answer -
// including a failed one - settles.
(function () {
  try {
    if (localStorage.getItem('cockpit.updateBannerSeen') === '1') {
      document.documentElement.setAttribute('data-update-banner', 'reserved');
    }
    // The second strip, one axis over: js/infra-banner.js shows it while the
    // server holds no token, and a locked vault at boot is the common case
    // on exactly the machines where it shows. Same key discipline, same
    // release on every settled answer.
    if (localStorage.getItem('cockpit.infraBannerSeen') === '1') {
      document.documentElement.setAttribute('data-infra-banner', 'reserved');
    }
  } catch (_e) { /* private mode - reserve nothing */ }
})();

// ── Pre-module analytics buffer + low-level browser patches ─────────────────
// Runs before js/analytics.js (an ES module) has loaded, so every patch here
// pushes to a bounded queue via window.__cockpitTrack rather than talking to
// any tracking SDK directly. js/analytics.js drains the queue once it
// initializes. Every patch body below is individually try/catch-wrapped and
// returns the native result untouched -- a missing/broken tracking SDK, a
// blocked network request, or a thrown patch body must never break the app.
// Stays dependency-free and classic-script-safe (no imports/exports).

// Bounded buffer (cap 200 entries, drop-oldest). Each entry snapshots
// location.hash at enqueue time so an event fired before the first real
// navigation is never mis-attributed to a later view once drained.
window.__cockpitTrackQueue = [];
window.__cockpitTrack = function (name, props) {
  try {
    const q = window.__cockpitTrackQueue;
    if (!Array.isArray(q)) return;
    if (q.length >= 200) q.shift();
    q.push({ name: name, props: props || {}, hash: location.hash, ts: Date.now() });
  } catch (_e) { /* no-op */ }
};

// ── fetch patch ───────────────────────────────────────────────────────────
// Tracks same-origin /api/ requests only. Reads only res.status / res.ok on
// a SEPARATE then-subscription -- never duplicates the response, never reads
// the response body, never touches init.body -- so the Response object
// returned to the real caller is completely untouched (the SSE/stream call
// sites read the body themselves and must keep working unmodified).
// Cross-origin requests are never instrumented, which also keeps the tracking
// SDK's own transport POSTs out of scope and prevents an infinite
// self-tracking loop.
(function () {
  try {
    const _nativeFetch = window.fetch;
    if (typeof _nativeFetch !== 'function') return;
    window.fetch = function (input, init) {
      const _resultPromise = _nativeFetch.apply(this, arguments);
      try {
        const _urlStr = (input && typeof input === 'object' && input.url) ? input.url : String(input);
        const _resolved = new URL(_urlStr, location.origin);
        if (_resolved.origin === location.origin && _resolved.pathname.indexOf('/api/') === 0) {
          const _method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
          const _isMutating = _method === 'POST' || _method === 'PUT' || _method === 'PATCH' || _method === 'DELETE';
          const _pathForEvent = _resolved.pathname + _resolved.search;
          const _t0 = Date.now();
          _resultPromise.then(function (res) {
            try {
              const _duration = Date.now() - _t0;
              if (_isMutating) {
                if (res && res.ok) {
                  window.__cockpitTrack('Api Request Completed', { endpoint_path: _pathForEvent, method: _method, status: res.status, duration_ms: _duration });
                } else {
                  window.__cockpitTrack('Api Request Failed', { endpoint_path: _pathForEvent, method: _method, status: res ? res.status : null, failure_reason: 'http-error', duration_ms: _duration });
                }
              }
            } catch (_e3) { /* no-op */ }
          }, function () {
            try {
              if (_isMutating) {
                window.__cockpitTrack('Api Request Failed', { endpoint_path: _pathForEvent, method: _method, status: null, failure_reason: 'network', duration_ms: Date.now() - _t0 });
              }
            } catch (_e4) { /* no-op */ }
          });
        }
      } catch (_e) { /* no-op -- never break the real fetch call */ }
      return _resultPromise;
    };
  } catch (_e) { /* no-op */ }
})();

// ── URL.createObjectURL patch ─────────────────────────────────────────────────
// Emits only for Blob args (skips MediaSource) whose mime type is not an
// image/video/audio -- the download sites all build text-ish blobs. Always
// returns the native result.
(function () {
  try {
    const _nativeCreateObjectURL = URL.createObjectURL;
    if (typeof _nativeCreateObjectURL !== 'function') return;
    URL.createObjectURL = function (obj) {
      const _result = _nativeCreateObjectURL.apply(this, arguments);
      try {
        if (typeof Blob !== 'undefined' && obj instanceof Blob) {
          const mime = obj.type || '';
          if (mime.indexOf('image/') !== 0 && mime.indexOf('video/') !== 0 && mime.indexOf('audio/') !== 0) {
            window.__cockpitTrack('File Exported', { mime: mime, size_bytes: obj.size });
          }
        }
      } catch (_e) { /* no-op */ }
      return _result;
    };
  } catch (_e) { /* no-op */ }
})();

// ── navigator.clipboard.writeText patch ───────────────────────────────────────
// Content length only, never the copied content.
(function () {
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return;
    const _nativeWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = function (text) {
      try {
        const len = (text === undefined || text === null) ? 0 : String(text).length;
        window.__cockpitTrack('Content Copied', { text_length: len });
      } catch (_e) { /* no-op */ }
      return _nativeWriteText(text);
    };
  } catch (_e) { /* no-op */ }
})();

// ── Feedback error ring buffer ───────────────────────────────────────────────
// window.__cockpitErrorLog: the last FEEDBACK_LOG_MAX entries the page saw,
// { at, kind, text }. Lives on window rather than as a module export because
// this file is a classic script (no import/export) - js/feedback-modal.js is
// the only reader, through GET-like access of the global. Fed from the two
// hooks right below (window.onerror, unhandledrejection) plus a console.error
// patch added here in the SAME call-through discipline as the fetch and
// clipboard patches above: try/catch around the buffer write, always call the
// original, never preventDefault, never throw - a broken push must not kill
// logging for every module and every installed module under modules/.
// One IIFE over the whole section, the same discipline as every other
// patch in this file: the buffer's size limits and its push function are
// implementation detail, and window.__cockpitErrorLog is the ONE global
// this section deliberately owns. As bare top-level declarations in a
// classic script the other three were globals too, which both broke the
// pattern and left generic names where a module written later could
// collide with them.
(function () {
  window.__cockpitErrorLog = [];
  const FEEDBACK_LOG_MAX = 20;
  const FEEDBACK_LOG_TEXT_MAX = 300;
  function _cockpitLogPush(kind, text) {
    try {
      const log = window.__cockpitErrorLog;
      if (!Array.isArray(log)) return;
      if (log.length >= FEEDBACK_LOG_MAX) log.shift();
      log.push({
        at: new Date().toISOString(),
        kind: kind,
        text: String(text === undefined || text === null ? '' : text).slice(0, FEEDBACK_LOG_TEXT_MAX),
      });
    } catch (_e) { /* no-op - a broken buffer must never break the caller */ }
  }

  // ── Global error hooks ────────────────────────────────────────────────────────
  // Neither hook suppresses default browser logging (window.onerror returns
  // false; the rejection listener never calls preventDefault()).
  (function () {
    const _prevOnError = window.onerror;
    window.onerror = function (message, source, lineno, colno, error) {
      try {
        window.__cockpitTrack('Unhandled Error', {
          message: String(message).slice(0, 500),
          source_file: source || null,
          line: lineno || null,
          col: colno || null,
          error_name: (error && error.name) || null,
        });
      } catch (_e) { /* no-op */ }
      // Own try/catch, separate from the track() call above: `message` or
      // `source` can be an object with a throwing toString/Symbol.toPrimitive,
      // and that must not skip the original handler below.
      try {
        _cockpitLogPush('error', (source ? source + ': ' : '') + String(message));
      } catch (_e) { /* no-op */ }
      if (typeof _prevOnError === 'function') return _prevOnError.apply(this, arguments);
      return false;
    };

    window.addEventListener('unhandledrejection', function (e) {
      try {
        const reason = e && e.reason;
        const text = (reason && reason.message) ? String(reason.message) : String(reason);
        window.__cockpitTrack('Unhandled Rejection', { reason: text.slice(0, 500) });
        _cockpitLogPush('unhandledrejection', text);
      } catch (_e) { /* no-op */ }
    });
  })();

  // ── console.error patch ──────────────────────────────────────────────────────
  // Same call-through discipline as every other patch in this file: always call
  // the native console.error with the original arguments, whatever this try
  // block does.
  (function () {
    try {
      const _nativeConsoleError = console.error;
      if (typeof _nativeConsoleError !== 'function') return;
      console.error = function () {
        try {
          const parts = [];
          for (let i = 0; i < arguments.length; i++) {
            const a = arguments[i];
            parts.push(typeof a === 'string' ? a : (a && a.message) ? a.message : String(a));
          }
          _cockpitLogPush('console.error', parts.join(' '));
        } catch (_e) { /* no-op */ }
        return _nativeConsoleError.apply(this, arguments);
      };
    } catch (_e) { /* no-op */ }
  })();
})();
