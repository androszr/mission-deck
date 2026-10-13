# Amplitude Browser SDK (vendored)

Vendored copy of the Amplitude Browser SDK, used by `js/analytics.js` for product analytics
of Mission Deck itself. Follows the same convention as `vendor/xterm/`: a committed
static asset, served directly by `server.js`, no `npm install` and no build step.

| | |
|---|---|
| Package | `@amplitude/analytics-browser` |
| Version | `2.44.5` |
| File | `amplitude-min.js` |
| Size | 232 108 bytes (232 150 as downloaded, minus the stripped sourcemap comment) |
| Global | `window.amplitude` |
| Vendored on | 2026-09-04 (from the upstream jsDelivr build) |

## Why this exact artifact

The cockpit is a no-bundler, native-ES-module app. `lib/scripts/amplitude-min.js` is the
**self-contained IIFE browser build**: zero bare `import` statements, zero `require()` calls,
no toolchain of any kind. It is a plain static file, so a fresh clone works identically on
Windows and macOS.

Do NOT swap it for the `lib/esm/*` tree: those are unbundled modules with cross-package imports
to `@amplitude/analytics-core` and will not resolve in the browser without a bundler. The also
published `amplitude-min.umd.js` works too but is redundant here.

## How it is loaded

`index.html` carries `<script defer src="/vendor/amplitude/amplitude-min.js"></script>` in
`<head>`, before `<script type="module" src="js/app.js">`. `defer` scripts run in document
order and before module evaluation, so `window.amplitude` is guaranteed to exist by the time
`initAnalytics()` runs — and `js/analytics.js` still retries once on `load` and otherwise
degrades to silence, because an ad blocker can remove the global at any point.

## How to update

```bash
curl -fsSL https://cdn.jsdelivr.net/npm/@amplitude/analytics-browser@<VERSION>/lib/scripts/amplitude-min.js \
  -o vendor/amplitude/amplitude-min.js
```

Then:

1. **Strip the trailing `//# sourceMappingURL=amplitude-min.js.map` line.** The `.map` file is not
   vendored, so leaving the comment makes DevTools 404 on every page load.
2. Sanity-check the result: starts with `!function(){"use strict";`, contains no bare
   `import ` / `require(`, and assigns `window.amplitude`.
3. Bump the version and size in the table above.
4. Reload the app and confirm `typeof window.amplitude === 'object'` plus a `POST` to
   `api.eu.amplitude.com` that is not blocked by CSP.

## Notes

- No key ships with the app. Set `ANALYTICS_KEY` in `.env` to an Amplitude browser key
  (write-only by design); the browser receives it from `GET /api/analytics/config`. Without
  one, analytics stays off.
- Every Mission Deck event carries `cockpit: 'starter'` (stamped by the enrichment plugin in
  `js/analytics.js`), so its traffic separates from other apps sharing a project with one filter.
- The Amplitude **secret key** is an Export-API read credential. It must never appear in this
  directory, in `js/`, or anywhere else that ships to the browser.
- `serverZone` is `EU` — pick the zone your Amplitude project lives in. The two EU hosts
  are on the `connect-src` allowlist in `server.js`'s CSP header.
- `ANALYTICS_ENABLED=0` in `.env` switches the whole thing off; the browser asks
  `GET /api/analytics/config` before initialising.
