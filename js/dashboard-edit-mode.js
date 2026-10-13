// ── Mission Deck — js/dashboard-edit-mode.js ──────────────────────────────
// "Customize dashboard": the dashboard grid itself becomes editable. Frames are
// dragged with pointer events (a placeholder takes the dragged frame's span and
// the other frames reflow live), resized with a per-frame segmented switch,
// removed with a per-frame button; the last cell opens a picker of widgets that
// are not on the dashboard yet. Keyboard: Alt+arrows move the focused frame,
// Delete removes it, every change is announced in an aria-live region.
//
// State transitions are the pure helpers of js/dashboard-layout.mjs; this file
// is the DOM. Nothing is written until "Save" (PUT /api/dashboard/layout);
// "Cancel", Escape and leaving the view discard the draft without a request.

import { openDsModal, closeDsModal } from './ds-modal.js';
import { showToast } from './toast.js';
import { escHtml } from './utils.js';
import { buildFrame, remountBody, unmountBody, variantOf, registerWidgetTeardown, teardownWidgets } from './dashboard-widgets.js';
import { itemKey, moveTo, removeItem, addItem, setVariant, addableGroups } from './dashboard-layout.mjs';

const ICON_DIR = '/assets/icons/ds/';
const DRAG_THRESHOLD_PX = 4;
const EDGE_SCROLL_PX = 64;

function _icon(name) {
  return '<span class="dash-edit-ico" style="--ico:url(' + ICON_DIR + name + ')" aria-hidden="true"></span>';
}

function _scrollParent(el) {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const oy = window.getComputedStyle(n).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight) return n;
  }
  return document.scrollingElement;
}

/**
 * @param {object} o
 * @param {HTMLElement} o.view #view-dashboard
 * @param {HTMLElement} o.host #dashboard-widgets
 * @param {HTMLElement} o.actions #dashboard-actions
 * @param {Array} o.items layout items before editing (not modified)
 * @param {Array} o.available catalog of GET /api/dashboard/layout
 * @param {(id: string) => void} o.navigate
 * @param {boolean} [o.openPicker] open the picker straight away (empty dashboard)
 * @param {(r: {saved: boolean, items: Array}) => void} o.onDone called after Save / Cancel / Escape, NOT on view exit
 * @returns {{dispose: () => void}}
 */
export function startDashboardEdit({ view, host, actions, items, available, navigate, openPicker, onDone }) {
  let draft = items
    .filter((i) => {
      const mod = available.find((m) => m.module === i.module);
      return mod && (mod.widgets || []).some((w) => w.id === i.widget);
    })
    .map((i) => ({ module: i.module, widget: i.widget, variant: i.variant }));
  const _sig = (list) => list.map((i) => itemKey(i) + ':' + i.variant).join('|');
  const loadedSig = _sig(draft);
  let disposed = false;
  let saving = false;
  let drag = null;
  let lastMessage = '';
  let pickerOverlay = null;

  const _lookup = (module, widget) => {
    const mod = available.find((m) => m.module === module);
    const def = mod && (mod.widgets || []).find((w) => w.id === widget);
    return { mod, def };
  };
  const _keyOf = (frame) => frame.dataset.module + '/' + frame.dataset.widget;

  // ── skeleton of the edit surface ───────────────────────────────────────────
  teardownAndPrepare();
  const root = document.createElement('div');
  root.className = 'dash-edit';
  root.innerHTML = '<p class="dash-edit-hint">Drag tiles by the handle to reorder them. '
    + 'From the keyboard: Alt + arrows move, Delete removes. Nothing is saved until "Save", and "Cancel" also brings back removed tiles.</p>'
    + '<div class="dash-sr-only" aria-live="polite" aria-atomic="true" data-dash-live></div>'
    + '<div class="dash-widgets-grid dash-widgets-grid--edit"></div>';
  const live = root.querySelector('[data-dash-live]');
  const grid = root.querySelector('.dash-widgets-grid');
  const addTile = document.createElement('button');
  addTile.type = 'button';
  addTile.className = 'ds-btn ds-btn--tertiary dash-edit-add';
  addTile.textContent = '+ Add tile';
  grid.appendChild(addTile);

  function teardownAndPrepare() {
    teardownWidgets();
    registerWidgetTeardown();
    view.setAttribute('data-dash-editing', '');
    host.hidden = false;
  }

  actions.innerHTML = '<button type="button" class="ds-btn ds-btn--primary" data-dash-save>Save</button>'
    + '<button type="button" class="ds-btn ds-btn--tertiary" data-dash-cancel>Cancel</button>';

  function announce(msg) {
    lastMessage = lastMessage === msg ? msg + ' ' : msg;
    live.textContent = lastMessage;
  }

  // ── frames ─────────────────────────────────────────────────────────────────
  function _framesInDom() {
    return [...grid.querySelectorAll('.dash-widget--edit:not(.dash-dragging)')];
  }

  function _decorate(frame, mod, def, variant) {
    frame.classList.add('dash-widget--edit');
    frame.setAttribute('tabindex', '0');
    frame.setAttribute('role', 'group');
    frame.setAttribute('aria-label', 'Tile: ' + mod.name + ' - ' + def.label);
    const header = frame.querySelector('.ds-card-header');
    const openBtn = header.querySelector('.dash-widget-open');
    if (openBtn) openBtn.remove();
    // Widget content is a preview while arranging: no clicks, no focus stops inside it.
    const body = frame.querySelector('.dash-widget-body');
    if (body) body.inert = true;
    header.insertAdjacentHTML('afterbegin',
      '<button type="button" class="ds-icon-btn ds-icon-btn--sm dash-edit-handle" aria-label="Drag tile" title="Drag, or use Alt + arrows">'
      + _icon('16-ic-drag-handle.svg') + '</button>');
    header.insertAdjacentHTML('beforeend',
      '<button type="button" class="ds-icon-btn ds-icon-btn--sm dash-edit-remove" aria-label="Remove tile" title="Remove tile">'
      + _icon('16-ic-trashcan.svg') + '</button>');
    const variants = def.variants || [];
    if (variants.length > 1) {
      header.insertAdjacentHTML('beforeend',
        '<div class="ds-segmented dash-edit-sizes" role="group" aria-label="Tile size">'
        + variants.map((v) => '<button type="button" class="ds-segment' + (v.id === variant.id ? ' active' : '')
          + '" data-dash-variant="' + escHtml(v.id) + '" aria-pressed="' + (v.id === variant.id ? 'true' : 'false')
          // Compact "3×2" (columns x rows) keeps six sizes on one line; the full name stays in title and aria-label.
          + '" title="' + escHtml(v.label) + '" aria-label="' + escHtml(v.label) + '">'
          + escHtml(Number(v.cols) + '×' + Number(v.rows)) + '</button>').join('') + '</div>');
    }
  }

  function _addFrame(item, beforeNode) {
    const { mod, def } = _lookup(item.module, item.widget);
    if (!mod || !def) return null;
    const variant = variantOf(def, item.variant);
    const built = buildFrame(mod, def, variant, navigate);
    _decorate(built.frame, mod, def, variant);
    grid.insertBefore(built.frame, beforeNode || addTile);
    built.mount();
    return built.frame;
  }

  draft.forEach((it) => _addFrame(it, addTile));
  host.replaceChildren(root);

  function _label(frame) {
    const { def } = _lookup(frame.dataset.module, frame.dataset.widget);
    return def ? def.label : '';
  }

  // ── list operations (pure helpers + document sync) ──────────────────────────────
  function _commitOrderFromDom(frame) {
    const key = _keyOf(frame);
    const from = draft.findIndex((i) => itemKey(i) === key);
    const to = _framesInDom().indexOf(frame);
    if (from < 0 || to < 0 || from === to) return false;
    draft = moveTo(draft, from, to);
    announce('Moved: ' + _label(frame) + ', position ' + (to + 1) + ' of ' + draft.length);
    return true;
  }

  function moveBy(frame, delta) {
    const frames = _framesInDom();
    const from = frames.indexOf(frame);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= frames.length) return;
    if (delta > 0) frames[to].after(frame); else frames[to].before(frame);
    _commitOrderFromDom(frame);
    frame.focus();
  }

  function removeFrame(frame) {
    const frames = _framesInDom();
    const at = frames.indexOf(frame);
    const label = _label(frame);
    draft = removeItem(draft, frame.dataset.module, frame.dataset.widget);
    unmountBody(frame.querySelector('.dash-widget-body'));
    frame.remove();
    const next = _framesInDom()[Math.min(at, frames.length - 2)];
    (next || addTile).focus();
    announce('Removed: ' + label + '. Tiles on the dashboard: ' + draft.length);
  }

  function changeSize(frame, variantId, seg) {
    const { mod, def } = _lookup(frame.dataset.module, frame.dataset.widget);
    if (!mod || !def) return;
    draft = setVariant(draft, available, mod.module, def.id, variantId);
    const variant = variantOf(def, variantId);
    frame.className = frame.className.replace(/dash-widget--(cols|rows)-\d+/g, '').replace(/\s+/g, ' ').trim()
      + ' dash-widget--cols-' + (Number(variant.cols) || 2) + ' dash-widget--rows-' + (Number(variant.rows) || 1);
    frame.querySelectorAll('.dash-edit-sizes .ds-segment').forEach((b) => {
      const on = b === seg;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const body = frame.querySelector('.dash-widget-body');
    remountBody(body, mod, def, variant, navigate);
    body.inert = true;
    announce('Tile size ' + def.label + ': ' + (variant.label || variant.id));
  }

  function addWidget(module, widget) {
    const next = addItem(draft, available, module, widget);
    if (next.length === draft.length) return;
    draft = next;
    const frame = _addFrame(draft[draft.length - 1], addTile);
    if (!frame) return;
    frame.scrollIntoView({ block: 'nearest' });
    frame.focus({ preventScroll: true });
    announce('Added: ' + _label(frame) + ', position ' + draft.length + ' of ' + draft.length);
  }

  // ── pointer drag ───────────────────────────────────────────────────────────
  function _startDrag() {
    const { frame } = drag;
    const rect = frame.getBoundingClientRect();
    const ph = document.createElement('div');
    ph.className = 'dash-edit-placeholder ' + [...frame.classList].filter((c) => /^dash-widget--(cols|rows)-\d+$/.test(c)).join(' ');
    ph.setAttribute('aria-hidden', 'true');
    ph.style.minHeight = rect.height + 'px';
    frame.before(ph);
    frame.classList.add('dash-dragging');
    frame.style.width = rect.width + 'px';
    frame.style.height = rect.height + 'px';
    drag.placeholder = ph;
    drag.scroller = _scrollParent(grid);
    drag.timer = setInterval(_edgeScroll, 16);
    document.body.classList.add('dash-edit-dragging');
    announce('Dragging: ' + _label(frame));
    drag.started = true;
  }

  function _edgeScroll() {
    if (!drag || !drag.started || !drag.scroller) return;
    const sc = drag.scroller;
    const box = sc === document.scrollingElement ? { top: 0, bottom: window.innerHeight } : sc.getBoundingClientRect();
    let dy = 0;
    if (drag.y < box.top + EDGE_SCROLL_PX) dy = -12;
    else if (drag.y > box.bottom - EDGE_SCROLL_PX) dy = 12;
    if (dy) { sc.scrollTop += dy; _reflow(); }
  }

  function _reflow() {
    const { frame, placeholder, x, y } = drag;
    frame.style.left = (x - drag.offX) + 'px';
    frame.style.top = (y - drag.offY) + 'px';
    const under = document.elementFromPoint(x, y);
    const target = under && under.closest && under.closest('.dash-widget--edit:not(.dash-dragging)');
    if (!target) {
      if (under && under.closest && under.closest('.dash-edit-add')) addTile.before(placeholder);
      return;
    }
    const tr = target.getBoundingClientRect();
    const pr = placeholder.getBoundingClientRect();
    const sameRow = pr.top < tr.bottom && pr.bottom > tr.top;
    const past = sameRow ? x > tr.left + tr.width / 2 : y > tr.top + tr.height / 2;
    const placeholderFirst = !!(placeholder.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (placeholderFirst) { if (past) target.after(placeholder); }
    else if (!past) target.before(placeholder);
  }

  function _endDrag(commit) {
    if (!drag) return;
    const d = drag;
    drag = null;
    clearInterval(d.timer);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerCancel);
    try { d.captureEl.releasePointerCapture(d.pointerId); } catch { /* not captured */ }
    document.body.classList.remove('dash-edit-dragging');
    if (!d.started) return;
    d.frame.classList.remove('dash-dragging');
    d.frame.style.width = d.frame.style.height = d.frame.style.left = d.frame.style.top = '';
    if (commit) d.placeholder.replaceWith(d.frame); else d.placeholder.remove();
    if (commit && !_commitOrderFromDom(d.frame)) announce('Tile ' + _label(d.frame) + ' stays in place');
    d.frame.focus({ preventScroll: true });
  }

  function onPointerDown(e) {
    if (disposed || saving || drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const header = e.target.closest('.dash-widget--edit > .ds-card-header');
    if (!header || e.target.closest('.ds-segmented, .dash-edit-remove')) return;
    const frame = header.parentElement;
    const rect = frame.getBoundingClientRect();
    e.preventDefault();
    drag = {
      frame, pointerId: e.pointerId, captureEl: header, started: false,
      sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY,
      offX: e.clientX - rect.left, offY: e.clientY - rect.top,
    };
    try { header.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerCancel);
  }
  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!drag.started) {
      if (Math.hypot(drag.x - drag.sx, drag.y - drag.sy) < DRAG_THRESHOLD_PX) return;
      _startDrag();
    }
    _reflow();
  }
  function onPointerUp(e) { if (drag && e.pointerId === drag.pointerId) _endDrag(true); }
  function onPointerCancel(e) { if (drag && e.pointerId === drag.pointerId) _endDrag(false); }

  // ── keyboard, clicks ───────────────────────────────────────────────────────
  function onGridKeydown(e) {
    const frame = e.target.closest('.dash-widget--edit');
    if (!frame) return;
    const own = e.target === frame || e.target.classList.contains('dash-edit-handle');
    if (!own) return;
    if (e.altKey && ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      moveBy(frame, e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      removeFrame(frame);
    }
  }

  function onGridClick(e) {
    if (e.target.closest('.dash-edit-add')) { openPickerModal(addTile); return; }
    const frame = e.target.closest('.dash-widget--edit');
    if (!frame) return;
    if (e.target.closest('.dash-edit-remove')) { removeFrame(frame); return; }
    const seg = e.target.closest('[data-dash-variant]');
    if (seg && !seg.classList.contains('active')) changeSize(frame, seg.dataset.dashVariant, seg);
  }

  function onDocKeydown(e) {
    if (e.key !== 'Escape' || disposed) return;
    if (document.querySelector('.ds-modal-overlay.open')) return; // the modal owns this Escape
    if (drag) { e.preventDefault(); _endDrag(false); return; }
    // Escape belongs to whatever else has focus (inputs, menus); only the edit surface or an idle page cancels.
    const t = e.target;
    const idle = !t || t === document.body || t === document.documentElement;
    if (!idle && !grid.contains(t) && !actions.contains(t)) return;
    if (saving) return;
    if (_sig(draft) !== loadedSig && !window.confirm('Discard your dashboard changes?')) { e.preventDefault(); return; }
    finish(false);
  }

  // ── picker ─────────────────────────────────────────────────────────────────
  function openPickerModal(trigger) {
    if (pickerOverlay) return;
    const overlay = document.createElement('div');
    overlay.className = 'ds-modal-overlay';
    overlay.hidden = true;
    overlay.innerHTML = '<div class="ds-modal dash-pick-modal">'
      + '<div class="ds-modal-header"><h2 class="ds-modal-title">Add tile</h2>'
      + '<button type="button" class="ds-modal-close" aria-label="Close">&times;</button></div>'
      + '<div class="ds-modal-body dash-pick-body">'
      + '<div class="ds-input-wrap"><label class="ds-label" for="dash-pick-search">Search for a tile or tool</label>'
      + '<input id="dash-pick-search" class="ds-input" type="search" placeholder="E.g. on-call, sprint, time off" autocomplete="off" autofocus></div>'
      + '<div class="dash-pick-list" data-dash-pick-list></div></div>'
      + '<div class="ds-modal-footer"><button type="button" class="ds-btn ds-btn--tertiary" data-dash-pick-close>Close</button></div></div>';
    document.body.appendChild(overlay);
    pickerOverlay = overlay;
    const input = overlay.querySelector('input');
    const list = overlay.querySelector('[data-dash-pick-list]');

    function paint() {
      const groups = addableGroups(draft, available, input.value);
      if (!groups.length) {
        const noneLeft = addableGroups(draft, available, '').length === 0;
        list.innerHTML = '<div class="ds-empty"><div class="ds-empty-desc">'
          + (noneLeft ? 'All available tiles are already on the dashboard.' : 'Nothing matches this phrase.') + '</div></div>';
        return;
      }
      list.innerHTML = groups.map((g) => '<div class="dash-pick-group"><div class="dash-pick-mod">' + escHtml(g.moduleName) + '</div>'
        + g.widgets.map((w) => '<button type="button" class="ds-btn ds-btn--tertiary dash-pick-item" data-module="' + escHtml(g.module)
          + '" data-widget="' + escHtml(w.widget) + '"><span class="dash-pick-label">' + escHtml(w.label) + '</span>'
          + (w.description ? '<span class="dash-pick-desc">' + escHtml(w.description) + '</span>' : '')
          + '</button>').join('') + '</div>').join('');
    }

    const onInput = () => paint();
    const onClick = (e) => {
      const item = e.target.closest('.dash-pick-item');
      if (item) {
        closeDsModal(overlay);
        addWidget(item.dataset.module, item.dataset.widget);
        return;
      }
      if (e.target.closest('[data-dash-pick-close]') || e.target.closest('.ds-modal-close')) closeDsModal(overlay);
    };
    input.addEventListener('input', onInput);
    overlay.addEventListener('click', onClick);

    let observer = null;
    function disposePicker() {
      if (observer) observer.disconnect();
      input.removeEventListener('input', onInput);
      overlay.removeEventListener('click', onClick);
      overlay.remove();
      if (pickerOverlay === overlay) pickerOverlay = null;
    }
    pickerOverlay.dispose = disposePicker;
    if (typeof MutationObserver === 'function') {
      observer = new MutationObserver(() => { if (!overlay.classList.contains('open')) disposePicker(); });
      observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
    }
    paint();
    openDsModal(overlay, { trigger });
  }

  // ── save / cancel / lifecycle ──────────────────────────────────────────────
  async function save(btn) {
    saving = true;
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true;
    try {
      const res = await fetch('/api/dashboard/layout', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: draft.map((i) => ({ module: i.module, widget: i.widget, variant: i.variant })) }),
      });
      if (!res.ok) {
        let message = 'The server refused the save (HTTP ' + res.status + ').';
        try { const j = await res.json(); if (j && j.message) message = j.message; } catch { /* keep default */ }
        showToast('danger', 'Could not save the dashboard', message);
        return;
      }
      if (disposed) return;
      showToast('success', 'Dashboard saved');
      saving = false;
      finish(true);
    } catch (err) {
      showToast('danger', 'Could not save the dashboard', err && err.message ? err.message : 'No connection to the server.');
    } finally {
      saving = false;
      btn.removeAttribute('aria-busy');
      btn.disabled = false;
    }
  }

  function onActionsClick(e) {
    const saveBtn = e.target.closest('[data-dash-save]');
    if (saveBtn) { if (!saving) save(saveBtn); return; }
    if (e.target.closest('[data-dash-cancel]') && !saving) finish(false);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    _endDrag(false);
    document.removeEventListener('keydown', onDocKeydown, true);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointercancel', onPointerCancel);
    grid.removeEventListener('pointerdown', onPointerDown);
    grid.removeEventListener('keydown', onGridKeydown);
    grid.removeEventListener('click', onGridClick);
    actions.removeEventListener('click', onActionsClick);
    grid.querySelectorAll('.dash-widget-body').forEach((b) => { b.inert = false; });
    if (pickerOverlay) {
      // Release ds-modal's document keydown listener before the node goes away.
      try { closeDsModal(pickerOverlay); } catch { /* removed below anyway */ }
      if (pickerOverlay && pickerOverlay.dispose) pickerOverlay.dispose();
    }
    view.removeAttribute('data-dash-editing');
  }

  function finish(saved) {
    const result = { saved, items: draft.map((i) => ({ ...i })) };
    dispose();
    if (typeof onDone === 'function') onDone(result);
  }

  grid.addEventListener('pointerdown', onPointerDown);
  grid.addEventListener('keydown', onGridKeydown);
  grid.addEventListener('click', onGridClick);
  actions.addEventListener('click', onActionsClick);
  document.addEventListener('keydown', onDocKeydown, true);
  // No registerViewCleanup here: js/dashboard.js registers one view-exit cleanup that disposes the running session.

  if (openPicker) openPickerModal(addTile);
  else { const first = _framesInDom()[0]; if (first) first.focus({ preventScroll: true }); }

  return { dispose };
}
