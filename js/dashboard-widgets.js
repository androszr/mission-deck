// ── Mission Deck — js/dashboard-widgets.js ────────────────────────────────
// The widget host of the dashboard. Draws one `ds-card` frame per layout item
// (module icon, module name, widget label, "Open"), then mounts the module's
// `renderWidget(el, ctx)` into the frame body. Everything a module hands over
// (names, labels, descriptions, icon) is untrusted input and goes through
// escHtml, exactly like js/module-host.js.
//
// A widget that throws, rejects or hangs past WIDGET_TIMEOUT_MS stays inside its
// own frame; the other frames and the rest of the dashboard are unaffected.
// Modules run without isolation (documented trust model) - this file contains
// failures, it does not sandbox code.

import { escHtml } from './utils.js';
import { clearSkeleton } from './skeleton.js';
import { registerViewCleanup } from './view-lifecycle.js';
import { moduleIconPath } from './module-card.mjs';
import { kit, hydrateAvatars } from './dashboard-widget-kit.js';

export const WIDGET_TIMEOUT_MS = 10000;
export const FRAME_MEMO_KEY = 'cockpit.dashboard.frameMemo';

/** @type {AbortController[]} each may carry `.bodyEl` (the frame body it serves) */
let _controllers = [];
/** @type {Array<{fn: () => void, bodyEl: HTMLElement}>} */
let _cleanups = [];
let _generation = 0;
// registerViewCleanup accumulates; one teardown per view entry is enough.
let _teardownRegistered = false;

function _ensureTeardownRegistered() {
  if (_teardownRegistered) return;
  _teardownRegistered = true;
  registerViewCleanup('dashboard', () => {
    _teardownRegistered = false;
    teardownWidgets();
  });
}

/** Abort pending widget work and run every returned cleanup (each in its own try/catch). */
export function teardownWidgets() {
  _generation += 1;
  const controllers = _controllers;
  const cleanups = _cleanups;
  _controllers = [];
  _cleanups = [];
  for (const c of controllers) {
    try { c.abort(); } catch { /* already aborted */ }
  }
  for (const { fn } of cleanups) {
    try { fn(); } catch (e) { console.warn('[dashboard-widgets] cleanup failed', e); }
  }
}

/** Abort and clean up ONE frame body (edit mode: size change, removal). */
export function unmountBody(bodyEl) {
  _controllers = _controllers.filter((c) => {
    if (c.bodyEl !== bodyEl) return true;
    try { c.abort(); } catch { /* already aborted */ }
    return false;
  });
  _cleanups = _cleanups.filter((c) => {
    if (c.bodyEl !== bodyEl) return true;
    try { c.fn(); } catch (e) { console.warn('[dashboard-widgets] cleanup failed', e); }
    return false;
  });
}

// ── first-paint memo ─────────────────────────────────────────────────────────

function _storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Remember the sizes of the painted frames (a paint memo, never the source of truth). */
export function storeFrameMemo(items) {
  const st = _storage();
  if (!st) return;
  try {
    if (!Array.isArray(items) || items.length === 0) st.removeItem(FRAME_MEMO_KEY);
    else st.setItem(FRAME_MEMO_KEY, JSON.stringify(items.map((x) => ({ cols: x.cols, rows: x.rows }))));
  } catch { /* storage full or blocked: the memo is optional */ }
}

export function clearFrameMemo() {
  const st = _storage();
  if (!st) return;
  try { st.removeItem(FRAME_MEMO_KEY); } catch { /* optional */ }
}

function _readFrameMemo() {
  const st = _storage();
  if (!st) return [];
  try {
    const raw = JSON.parse(st.getItem(FRAME_MEMO_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((x) => x && [2, 3, 6].includes(x.cols) && [1, 2].includes(x.rows)).slice(0, 40) : [];
  } catch {
    return [];
  }
}

/** Paint empty skeleton frames of the remembered sizes so the grid reserves its real box. */
export function paintFramesFromMemo(gridEl) {
  const memo = _readFrameMemo();
  if (!gridEl || memo.length === 0) return;
  gridEl.hidden = false;
  gridEl.innerHTML = '<div class="dash-widgets-grid" aria-hidden="true">' + memo.map((m) =>
    '<div class="ds-card dash-widget dash-widget--cols-' + m.cols + ' dash-widget--rows-' + m.rows + '" data-skel="1">'
    + '<div class="ds-card-body dash-widget-body"><span class="ds-skeleton dash-widget-skel" data-skel="1"></span></div></div>').join('')
    + '</div>';
}

// ── frames ───────────────────────────────────────────────────────────────────

export function variantOf(def, id) {
  const list = Array.isArray(def.variants) ? def.variants : [];
  return list.find((v) => v.id === id) || list.find((v) => v.id === def.defaultVariant) || list[0] || { id: 's', cols: 2, rows: 1 };
}

function _frameHtml(mod, def, variant) {
  const icon = moduleIconPath({ icon: mod.icon }, mod.module);
  return '<div class="ds-card dash-widget dash-widget--cols-' + (Number(variant.cols) || 2)
    + ' dash-widget--rows-' + (Number(variant.rows) || 1) + '" data-module="' + escHtml(mod.module)
    + '" data-widget="' + escHtml(def.id) + '">'
    + '<div class="ds-card-header">'
    + '<img class="nav-icon" src="' + escHtml(icon) + '" alt="" aria-hidden="true">'
    + '<span class="ds-card-title">' + escHtml(mod.name) + '</span>'
    + '<span class="dash-widget-label">' + escHtml(def.label) + '</span>'
    + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm dash-widget-open">Open</button>'
    + '</div>'
    + '<div class="ds-card-body dash-widget-body"><span class="ds-skeleton dash-widget-skel" data-skel="1" aria-hidden="true"></span></div>'
    + '</div>';
}

function _showFailure(bodyEl, why) {
  clearSkeleton(bodyEl);
  bodyEl.innerHTML = '<div class="ds-callout ds-callout--danger"><div>The tile is not responding. Open the tool page to see the data.</div></div>';
  console.warn('[dashboard-widgets] ' + why);
}

/**
 * Import and run one module widget inside its frame body.
 * @param {HTMLElement} bodyEl @param {object} mod entry of `available`
 * @param {object} def widget definition @param {object} variant
 * @param {(id: string) => void} navigate
 */
async function _mount(bodyEl, mod, def, variant, navigate) {
  const generation = _generation;
  const controller = new AbortController();
  controller.bodyEl = bodyEl;
  _controllers.push(controller);
  let timer = null;
  try {
    // def.client was validated server-side (WIDGET_CLIENT_RE: inside client/, no %, no dot-led segment, .js); the URL
    // is built from the module id and that relative path only.
    const url = '/modules/' + encodeURIComponent(mod.module) + '/client/' + String(def.client).slice('client/'.length);
    const run = (async () => {
      const ns = await import(url);
      const fn = ns[def.export || 'renderWidget'];
      if (typeof fn !== 'function') throw new Error('export "' + (def.export || 'renderWidget') + '" is not a function');
      return fn(bodyEl, {
        moduleId: mod.module,
        widgetId: def.id,
        variant: { id: variant.id, cols: variant.cols, rows: variant.rows },
        cols: variant.cols,
        rows: variant.rows,
        apiBase: '/api/m/' + mod.module,
        navigate,
        signal: controller.signal,
        kit,
      });
    })();
    let timedOut = false;
    // A widget that answers after the failure was shown must not paint over it.
    run.then((late) => {
      if (!timedOut) return;
      const fn = typeof late === 'function' ? late : (late && typeof late.cleanup === 'function' ? late.cleanup : null);
      if (fn) { try { fn(); } catch { /* late cleanup */ } }
      if (bodyEl.isConnected && _controllers.includes(controller)) _showFailure(bodyEl, mod.module + '/' + def.id + ': late result after timeout');
    }, () => { /* the race already reported it */ });
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error('timeout after ' + WIDGET_TIMEOUT_MS + ' ms')); }, WIDGET_TIMEOUT_MS);
    });
    const result = await Promise.race([run, timeout]);
    clearTimeout(timer);
    const cleanup = typeof result === 'function' ? result : (result && typeof result.cleanup === 'function' ? result.cleanup : null);
    if (controller.signal.aborted) {
      // Torn down or re-mounted while it was loading: this result belongs to nobody.
      if (cleanup) { try { cleanup(); } catch { /* torn down already */ } }
      return;
    }
    clearSkeleton(bodyEl);
    if (cleanup) _cleanups.push({ fn: cleanup, bodyEl });
    if (generation === _generation) hydrateAvatars(bodyEl).catch(() => { /* initials stay */ });
  } catch (e) {
    clearTimeout(timer);
    if (controller.signal.aborted && (generation !== _generation || !bodyEl.isConnected || !_controllers.includes(controller))) return;
    _showFailure(bodyEl, mod.module + '/' + def.id + ': ' + (e && e.message ? e.message : String(e)));
  }
}

/**
 * Build one frame and the function that fills its body.
 * @returns {{frame: HTMLElement, bodyEl: HTMLElement, mount: () => void}}
 */
export function buildFrame(mod, def, variant, navigate) {
  const holder = document.createElement('div');
  holder.innerHTML = _frameHtml(mod, def, variant);
  const frame = holder.firstElementChild;
  const bodyEl = frame.querySelector('.dash-widget-body');
  const openBtn = frame.querySelector('.dash-widget-open');
  if (mod.entryView) {
    openBtn.addEventListener('click', () => {
      if (typeof navigate === 'function') navigate(mod.entryView);
    });
  } else {
    openBtn.remove();
  }
  return { frame, bodyEl, mount: () => mountBody(bodyEl, mod, def, variant, navigate) };
}

/** Fill a frame body (shortcut text or the module's renderWidget). */
export function mountBody(bodyEl, mod, def, variant, navigate) {
  if (def.builtin || !def.client) {
    clearSkeleton(bodyEl);
    bodyEl.innerHTML = '<div class="dash-widget-desc">' + escHtml(mod.description || def.description || '') + '</div>';
    return;
  }
  _mount(bodyEl, mod, def, variant, navigate);
}

/** Edit mode: replace the body of a frame with a fresh mount at a new size. */
export function remountBody(bodyEl, mod, def, variant, navigate) {
  unmountBody(bodyEl);
  bodyEl.innerHTML = '<span class="ds-skeleton dash-widget-skel" data-skel="1" aria-hidden="true"></span>';
  mountBody(bodyEl, mod, def, variant, navigate);
}

/** Edit mode: make sure the view-exit cleanup tears the widgets down. */
export function registerWidgetTeardown() {
  _ensureTeardownRegistered();
}

/**
 * Paint the widget grid for a layout.
 * @param {HTMLElement} gridEl #dashboard-widgets
 * @param {Array<{module: string, widget: string, variant: string}>} items
 * @param {Array<object>} available `available` of GET /api/dashboard/layout
 * @param {(id: string) => void} navigate
 */
export function paintWidgetGrid(gridEl, items, available, navigate) {
  teardownWidgets();
  // The registry is consumed on every exit of the view; register once per entry.
  _ensureTeardownRegistered();

  const painted = [];
  const wrap = document.createElement('div');
  wrap.className = 'dash-widgets-grid';
  for (const item of items) {
    const mod = (available || []).find((m) => m.module === item.module);
    const def = mod && (mod.widgets || []).find((w) => w.id === item.widget);
    if (!def) continue;
    const variant = variantOf(def, item.variant);
    const built = buildFrame(mod, def, variant, navigate);
    wrap.appendChild(built.frame);
    painted.push({ cols: variant.cols, rows: variant.rows, run: built.mount });
  }
  gridEl.hidden = false;
  gridEl.replaceChildren(wrap);
  storeFrameMemo(painted);
  painted.forEach((p) => p.run());
}
