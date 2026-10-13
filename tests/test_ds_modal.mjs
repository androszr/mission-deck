// tests/test_ds_modal.mjs
// Unit tests for js/ds-modal.js against a hand-rolled, DOM-free stub - no
// jsdom, no browser. The stub implements just enough of the Element/Document
// surface ds-modal.js actually touches (classList, dataset, hidden,
// setAttribute/getAttribute/hasAttribute, querySelector/querySelectorAll,
// addEventListener/removeEventListener, focus) plus a tiny selector matcher
// covering the handful of selectors ds-modal.js uses ('.ds-modal',
// '.ds-modal-title', '[autofocus]', 'input, select, textarea, button,
// a[href]', '.ds-modal-close', '[data-confirm-*]').
//
// Run: node --test tests/test_ds_modal.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { openDsModal, closeDsModal, confirmDsModal } from '../js/ds-modal.js';

// ── Tiny DOM-free stub ───────────────────────────────────────────────────────

function _matchSimple(el, sel) {
  let rest = sel;
  let tag = null;
  const tagMatch = rest.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
  if (tagMatch) { tag = tagMatch[0]; rest = rest.slice(tag.length); }
  if (tag && (el.tagName || '').toLowerCase() !== tag.toLowerCase()) return false;
  const partRe = /\.[\w-]+|\[[^\]]+\]/g;
  let part;
  while ((part = partRe.exec(rest))) {
    const token = part[0];
    if (token[0] === '.') {
      const cls = token.slice(1);
      if (!el.classList || !el.classList.contains(cls)) return false;
    } else {
      const inner = token.slice(1, -1);
      const eq = inner.indexOf('=');
      if (eq === -1) {
        if (!el.hasAttribute(inner)) return false;
      } else {
        const name = inner.slice(0, eq);
        const value = inner.slice(eq + 1).replace(/^['"]|['"]$/g, '');
        if (el.getAttribute(name) !== value) return false;
      }
    }
  }
  return true;
}

function _matches(el, selector) {
  return selector.split(',').some((s) => _matchSimple(el, s.trim()));
}

function _walk(el, fn) {
  for (const child of el._children) {
    fn(child);
    _walk(child, fn);
  }
}

function _query(el, selector, single) {
  const results = [];
  _walk(el, (node) => { if (_matches(node, selector)) results.push(node); });
  return single ? (results[0] || null) : results;
}

// A real element's innerHTML parses markup; confirmDsModal builds its overlay
// from a fixed, always-well-formed template (every tag it emits is closed),
// so this needs no more than a naive open/close tag walk - no void elements,
// no self-closing tags, no text nodes to represent.
function _setInnerHtml(el, html) {
  el._children = [];
  const stack = [el];
  const tagRe = /<(\/)?([a-zA-Z0-9-]+)((?:\s+[^<>]*?)?)\s*>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const closing = m[1];
    const tagName = m[2];
    const attrPart = m[3] || '';
    if (closing) { stack.pop(); continue; }
    const node = makeElement(tagName);
    const attrRe = /([a-zA-Z0-9_-]+)(?:="([^"]*)")?/g;
    let am;
    while ((am = attrRe.exec(attrPart))) {
      const name = am[1];
      const value = am[2] !== undefined ? am[2] : '';
      if (name === 'class') node.className = value;
      else node.setAttribute(name, value);
    }
    const parent = stack[stack.length - 1];
    parent._children.push(node);
    node._parent = parent;
    stack.push(node);
  }
}

function makeElement(tag = 'div') {
  const attrs = {};
  const classes = new Set();
  const el = {
    tagName: tag,
    hidden: false,
    disabled: false,
    id: '',
    dataset: {},
    isConnected: true,
    _children: [],
    _listeners: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name); },
    removeAttribute(name) { delete attrs[name]; },
    addEventListener(type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      if (!el._listeners[type]) return;
      el._listeners[type] = el._listeners[type].filter((f) => f !== fn);
    },
    dispatch(type, evt) { (el._listeners[type] || []).slice().forEach((fn) => fn(evt)); },
    appendChild(child) { el._children.push(child); child._parent = el; return child; },
    remove() {
      if (el._parent) {
        const i = el._parent._children.indexOf(el);
        if (i > -1) el._parent._children.splice(i, 1);
      }
      el.isConnected = false;
    },
    querySelector(sel) { return _query(el, sel, true); },
    querySelectorAll(sel) { return _query(el, sel, false); },
    focus() { el._focused = true; },
    set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)); },
    get className() { return [...classes].join(' '); },
    set innerHTML(v) { _setInnerHtml(el, v); },
    get innerHTML() { return ''; },
  };
  return el;
}

function makeDocument() {
  const listeners = {};
  const doc = {
    body: makeElement('body'),
    activeElement: null,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((f) => f !== fn);
    },
    dispatch(type, evt) { (listeners[type] || []).slice().forEach((fn) => fn(evt)); },
    createElement(tag) { return makeElement(tag); },
    contains(node) { return !!(node && node.isConnected); },
    _count(type) { return (listeners[type] || []).length; },
  };
  return doc;
}

// `innerHTML =` on the stub parses a small, known subset of markup: it is
// only ever set by confirmDsModal with a fixed shape, so a real parser would
// be pure overhead here. Instead confirmDsModal's overlay is built by hand in
// the tests that exercise it, mirroring exactly what js/ds-modal.js builds.

beforeEach(() => {
  globalThis.document = makeDocument();
});

// ── openDsModal / closeDsModal ───────────────────────────────────────────────

describe('openDsModal without opts (backward compatible)', () => {
  it('sets hidden=false and adds .open, registers no document keydown', () => {
    const el = makeElement('div');
    el.hidden = true;
    openDsModal(el);
    assert.equal(el.hidden, false);
    assert.equal(el.classList.contains('open'), true);
    assert.equal(document._count('keydown'), 0);
  });

  it('closeDsModal restores hidden because it was previously hidden', () => {
    const el = makeElement('div');
    el.hidden = true;
    openDsModal(el);
    closeDsModal(el);
    assert.equal(el.classList.contains('open'), false);
    assert.equal(el.hidden, true);
  });
});

describe('openDsModal with opts - dismiss layer', () => {
  it('opts={} registers document keydown + overlay click; closeDsModal removes both', () => {
    const el = makeElement('div');
    openDsModal(el, {});
    assert.equal(document._count('keydown'), 1);
    assert.equal((el._listeners.click || []).length, 1);
    closeDsModal(el);
    assert.equal(document._count('keydown'), 0);
    assert.equal((el._listeners.click || []).length, 0);
  });

  it('dismissible:false registers nothing', () => {
    const el = makeElement('div');
    openDsModal(el, { dismissible: false });
    assert.equal(document._count('keydown'), 0);
    assert.equal((el._listeners.click || []).length, 0);
  });

  it('a second openDsModal on the same element never stacks a second listener pair', () => {
    const el = makeElement('div');
    openDsModal(el, {});
    openDsModal(el, {});
    assert.equal(document._count('keydown'), 1);
    assert.equal((el._listeners.click || []).length, 1);
  });

  it('Escape closes the modal when dismissible', () => {
    const el = makeElement('div');
    openDsModal(el, {});
    document.dispatch('keydown', { key: 'Escape' });
    assert.equal(el.classList.contains('open'), false);
  });

  it('a click on the overlay itself closes it, a click on a child does not', () => {
    const el = makeElement('div');
    const child = makeElement('button');
    el.appendChild(child);
    openDsModal(el, {});
    el.dispatch('click', { target: child });
    assert.equal(el.classList.contains('open'), true);
    el.dispatch('click', { target: el });
    assert.equal(el.classList.contains('open'), false);
  });

  it('trigger gets focus back once the modal closes', () => {
    const el = makeElement('div');
    const trigger = makeElement('button');
    openDsModal(el, { trigger });
    closeDsModal(el);
    assert.equal(trigger._focused, true);
  });

  it('trigger does not get refocused once removed from the document', () => {
    const el = makeElement('div');
    const trigger = makeElement('button');
    trigger.isConnected = false;
    openDsModal(el, { trigger });
    closeDsModal(el);
    assert.equal(trigger._focused, undefined);
  });
});

describe('openDsModal a11y baseline (always applied)', () => {
  it('sets role=dialog and aria-modal=true on the inner .ds-modal', () => {
    const overlay = makeElement('div');
    const dialog = makeElement('div');
    dialog.classList.add('ds-modal');
    overlay.appendChild(dialog);
    openDsModal(overlay);
    assert.equal(dialog.getAttribute('role'), 'dialog');
    assert.equal(dialog.getAttribute('aria-modal'), 'true');
  });

  it('wires aria-labelledby to .ds-modal-title when there is no aria-label', () => {
    const overlay = makeElement('div');
    const dialog = makeElement('div');
    dialog.classList.add('ds-modal');
    const title = makeElement('span');
    title.classList.add('ds-modal-title');
    dialog.appendChild(title);
    overlay.appendChild(dialog);
    openDsModal(overlay);
    assert.ok(dialog.getAttribute('aria-labelledby'));
    assert.equal(title.id, dialog.getAttribute('aria-labelledby'));
  });

  it('never overwrites an existing aria-label', () => {
    const overlay = makeElement('div');
    const dialog = makeElement('div');
    dialog.classList.add('ds-modal');
    dialog.setAttribute('aria-label', 'Already labelled');
    const title = makeElement('span');
    title.classList.add('ds-modal-title');
    dialog.appendChild(title);
    overlay.appendChild(dialog);
    openDsModal(overlay);
    assert.equal(dialog.getAttribute('aria-label'), 'Already labelled');
    assert.equal(dialog.hasAttribute('aria-labelledby'), false);
  });

  it('never overwrites role/aria-modal already set by the caller', () => {
    const overlay = makeElement('div');
    const dialog = makeElement('div');
    dialog.classList.add('ds-modal');
    dialog.setAttribute('role', 'alertdialog');
    overlay.appendChild(dialog);
    openDsModal(overlay);
    assert.equal(dialog.getAttribute('role'), 'alertdialog');
  });
});

describe('openDsModal initial focus', () => {
  function buildDialogWithControls() {
    const overlay = makeElement('div');
    const dialog = makeElement('div');
    dialog.classList.add('ds-modal');
    const closeBtn = makeElement('button');
    closeBtn.classList.add('ds-modal-close');
    const input = makeElement('input');
    const primaryBtn = makeElement('button');
    dialog.appendChild(closeBtn);
    dialog.appendChild(input);
    dialog.appendChild(primaryBtn);
    overlay.appendChild(dialog);
    return { overlay, dialog, closeBtn, input, primaryBtn };
  }

  it('focuses the first focusable control, skipping .ds-modal-close', () => {
    const { overlay, input } = buildDialogWithControls();
    openDsModal(overlay);
    assert.equal(input._focused, true);
  });

  it('falls back to .ds-modal-close when nothing else is focusable', () => {
    const overlay = makeElement('div');
    const dialog = makeElement('div');
    dialog.classList.add('ds-modal');
    const closeBtn = makeElement('button');
    closeBtn.classList.add('ds-modal-close');
    dialog.appendChild(closeBtn);
    overlay.appendChild(dialog);
    openDsModal(overlay);
    assert.equal(closeBtn._focused, true);
  });

  it('honours an explicit opts.initialFocus element over the default chain', () => {
    const { overlay, primaryBtn } = buildDialogWithControls();
    openDsModal(overlay, { initialFocus: primaryBtn });
    assert.equal(primaryBtn._focused, true);
  });

  it('honours an explicit opts.initialFocus selector', () => {
    const { overlay, dialog } = buildDialogWithControls();
    const named = makeElement('button');
    named.setAttribute('data-named', '1');
    dialog.appendChild(named);
    openDsModal(overlay, { initialFocus: '[data-named]' });
    assert.equal(named._focused, true);
  });

  it('opts.initialFocus === null moves no focus at all', () => {
    const { overlay, input } = buildDialogWithControls();
    openDsModal(overlay, { initialFocus: null });
    assert.equal(input._focused, undefined);
  });

  it('prefers [autofocus] over the default chain when no explicit initialFocus is given', () => {
    const { overlay, dialog, input } = buildDialogWithControls();
    const auto = makeElement('button');
    auto.setAttribute('autofocus', '');
    dialog.appendChild(auto);
    openDsModal(overlay);
    assert.equal(auto._focused, true);
    assert.equal(input._focused, undefined);
  });
});

// ── confirmDsModal ───────────────────────────────────────────────────────────

describe('confirmDsModal', () => {
  it('resolves true when OK is clicked', async () => {
    const p = confirmDsModal({ title: 'Are you sure?', body: 'Content' });
    const overlay = document.body._children[document.body._children.length - 1];
    overlay.querySelector('[data-confirm-ok]').dispatch('click', {});
    assert.equal(await p, true);
  });

  it('resolves false when Cancel is clicked', async () => {
    const p = confirmDsModal({ title: 'Are you sure?' });
    const overlay = document.body._children[document.body._children.length - 1];
    overlay.querySelector('[data-confirm-cancel]').dispatch('click', {});
    assert.equal(await p, false);
  });

  it('resolves dismissValue (default false) when the X button is clicked', async () => {
    const p = confirmDsModal({ title: 'Are you sure?' });
    const overlay = document.body._children[document.body._children.length - 1];
    overlay.querySelector('[data-confirm-x]').dispatch('click', {});
    assert.equal(await p, false);
  });

  it('resolves a custom dismissValue (e.g. null) on X, Escape and overlay click', async () => {
    const p1 = confirmDsModal({ title: 't', dismissValue: null });
    let overlay = document.body._children[document.body._children.length - 1];
    overlay.querySelector('[data-confirm-x]').dispatch('click', {});
    assert.equal(await p1, null);

    const p2 = confirmDsModal({ title: 't', dismissValue: null });
    overlay = document.body._children[document.body._children.length - 1];
    document.dispatch('keydown', { key: 'Escape' });
    assert.equal(await p2, null);

    const p3 = confirmDsModal({ title: 't', dismissValue: null });
    overlay = document.body._children[document.body._children.length - 1];
    overlay.dispatch('click', { target: overlay });
    assert.equal(await p3, null);
  });

  it('footer order is [primary/danger][tertiary] with OK first', async () => {
    const p = confirmDsModal({ title: 't', okLabel: 'Save', cancelLabel: 'Cancel' });
    const overlay = document.body._children[document.body._children.length - 1];
    const footer = overlay.querySelector('.ds-modal-footer');
    const buttons = overlay.querySelectorAll('button').filter((b) => b._parent === footer);
    assert.equal(buttons.length, 2);
    assert.equal(buttons[0].classList.contains('ds-btn--primary'), true);
    assert.equal(buttons[1].classList.contains('ds-btn--tertiary'), true);
    overlay.querySelector('[data-confirm-ok]').dispatch('click', {});
    await p;
  });

  it('danger:true paints the OK button ds-btn--danger instead of ds-btn--primary', async () => {
    const p = confirmDsModal({ title: 't', danger: true });
    const overlay = document.body._children[document.body._children.length - 1];
    const okBtn = overlay.querySelector('[data-confirm-ok]');
    assert.equal(okBtn.classList.contains('ds-btn--danger'), true);
    assert.equal(okBtn.classList.contains('ds-btn--primary'), false);
    okBtn.dispatch('click', {});
    await p;
  });

  it('removes its own listeners once resolved (no leak)', async () => {
    const p = confirmDsModal({ title: 't' });
    const overlay = document.body._children[document.body._children.length - 1];
    assert.equal(document._count('keydown'), 1);
    overlay.querySelector('[data-confirm-ok]').dispatch('click', {});
    await p;
    assert.equal(document._count('keydown'), 0);
    assert.equal((overlay._listeners.click || []).length, 0);
  });

  it('an external closeDsModal on the overlay (the navigate() sweep) resolves dismissValue', async () => {
    const p = confirmDsModal({ title: 't', dismissValue: null });
    const overlay = document.body._children[document.body._children.length - 1];
    assert.equal(document._count('keydown'), 1);
    closeDsModal(overlay);
    assert.equal(await p, null);
    assert.equal(document._count('keydown'), 0);
    assert.equal(overlay.classList.contains('open'), false);
    // Idempotent: a second sweep over the same (already removed) overlay is a no-op.
    closeDsModal(overlay);
  });

  it('a route change (hashchange) resolves dismissValue and takes the listeners down', async () => {
    const win = makeElement('window');
    const prevWindow = globalThis.window;
    globalThis.window = win;
    try {
      const p = confirmDsModal({ title: 't', dismissValue: null });
      assert.equal((win._listeners.hashchange || []).length, 1);
      assert.equal(document._count('keydown'), 1);
      win.dispatch('hashchange', {});
      assert.equal(await p, null);
      assert.equal((win._listeners.hashchange || []).length, 0);
      assert.equal(document._count('keydown'), 0);
    } finally {
      if (prevWindow === undefined) delete globalThis.window;
      else globalThis.window = prevWindow;
    }
  });

  it('refocuses the trigger after resolving', async () => {
    const trigger = makeElement('button');
    const p = confirmDsModal({ title: 't', trigger });
    const overlay = document.body._children[document.body._children.length - 1];
    overlay.querySelector('[data-confirm-cancel]').dispatch('click', {});
    await p;
    assert.equal(trigger._focused, true);
  });
});
