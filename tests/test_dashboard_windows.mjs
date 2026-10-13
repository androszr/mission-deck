// Unit tests for the Windows-only dashboard card in js/dashboard.js.
// Run: node --test tests/test_dashboard_windows.mjs
//
// Only the pure predicate is exercised - js/dashboard.js touches `document`
// inside function bodies only, so importing it under plain Node is safe as long
// as no renderer runs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isWindows } from '../js/dashboard.js';

describe('isWindows', () => {
  it('is true only for the exact Node platform string', () => {
    assert.equal(isWindows({ platform: 'win32' }), true);
  });

  it('is false for every other platform', () => {
    for (const platform of ['darwin', 'linux', 'freebsd', 'aix', 'sunos']) {
      assert.equal(isWindows({ platform }), false, platform + ' is not Windows');
    }
  });

  it('is false for a near-miss spelling', () => {
    // The card is gated on the value the server actually sends. Accepting a
    // prettified label would make the gate depend on presentation.
    for (const platform of ['Windows', 'win', 'win64', 'WIN32', 'windows_nt']) {
      assert.equal(isWindows({ platform }), false, platform + ' must not pass');
    }
  });

  it('is false when the endpoint could not be read', () => {
    // Showing a Windows guide to a Mac user is worse than showing nothing, so
    // an unknown answer must fail closed.
    assert.equal(isWindows(null), false);
    assert.equal(isWindows(undefined), false);
    assert.equal(isWindows({}), false);
    assert.equal(isWindows({ platform: null }), false);
    assert.equal(isWindows({ version: 'v0.1.0' }), false);
  });
});

// -- The wiring, not just the predicate ---------------------------------------
// js/dashboard.js imports cleanly under node (every document access is inside a
// function body), so the append path can be driven against a minimal stub.
// This is a STUB, not a browser: it asserts structure (how many cards, which
// titles, whether a detached grid is left alone), never layout or styling.

/** The few document pieces renderDashboardView actually touches. */
function makeDom() {
  const mk = (tag) => {
    const el = {
      tagName: tag, className: '', innerHTML: '', children: [],
      attrs: {}, listeners: {}, isConnected: true,
      setAttribute(k, v) { this.attrs[k] = v; },
      addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
      appendChild(c) { this.children.push(c); return c; },
      replaceChildren() { this.children = []; },
    };
    return el;
  };
  const root = mk('div');
  globalThis.document = {
    getElementById: (id) => (id === 'dashboard-cards' ? root : null),
    createElement: mk,
  };
  return root;
}

/** Titles of the cards currently in the grid. */
function titles(root) {
  const grid = root.children[0];
  return grid.children.map((c) => (c.innerHTML.match(/__title">([^<]*)/) || [])[1]);
}

async function renderWith(platform) {
  const root = makeDom();
  globalThis.fetch = async () => ({
    ok: platform !== null,
    json: async () => ({ version: 'v0.1.0', platform }),
  });
  // The version reader is a sibling the cache-bust below does not reach, and
  // it remembers its first answer for the life of the process.
  const { resetAppVersionCache } = await import('../js/app-version.js');
  resetAppVersionCache();
  const mod = await import('../js/dashboard.js?' + Math.random());
  await mod.renderDashboardView();
  // The append happens in a floating promise after the first paint.
  await new Promise((r) => setTimeout(r, 0));
  return root;
}

describe('the Windows card is appended only on Windows', () => {
  it('paints the three static cards first, on every platform', async () => {
    const root = await renderWith('darwin');
    const t = titles(root);
    assert.deepEqual(t.slice(0, 3), ['Start here', 'Academy', 'Settings']);
  });

  it('adds a fourth card on win32', async () => {
    const t = titles(await renderWith('win32'));
    assert.equal(t.length, 4, 'expected a fourth card, got: ' + JSON.stringify(t));
    assert.equal(t[3], 'Windows guide');
  });

  it('adds nothing on macOS or Linux', async () => {
    for (const platform of ['darwin', 'linux']) {
      const t = titles(await renderWith(platform));
      assert.equal(t.length, 3, platform + ' must stay at three cards');
    }
  });

  it('adds nothing when the endpoint fails', async () => {
    const t = titles(await renderWith(null));
    assert.equal(t.length, 3, 'a failed probe must leave the dashboard untouched');
  });
});

// -- The widgets layer: no modules means today's dashboard ---------------------

describe('the widgets layer without modules', () => {
  it('leaves #dashboard-actions empty and #dashboard-widgets hidden and empty', async () => {
    const root = makeDom();
    const slot = (hidden) => ({ children: [{ stale: true }], hidden, innerHTML: 'stale', replaceChildren() { this.children = []; this.innerHTML = ''; } });
    const actions = slot(false);
    const widgets = slot(false);
    const base = globalThis.document.getElementById;
    globalThis.document.getElementById = (id) => {
      if (id === 'dashboard-actions') return actions;
      if (id === 'dashboard-widgets') return widgets;
      return base(id);
    };
    globalThis.fetch = async (url) => ({
      ok: true,
      json: async () => (String(url).includes('/api/dashboard/layout') ? { hasModules: false } : { version: 'v0.1.0', platform: 'darwin' }),
    });
    const mod = await import('../js/dashboard.js?' + Math.random());
    await mod.renderDashboardView();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(titles(root).length, 3, 'three entry cards, nothing else');
    assert.equal(actions.children.length, 0);
    assert.equal(widgets.hidden, true);
    assert.equal(widgets.children.length, 0);
    assert.notEqual(root.hidden, true, 'without modules the entry cards stay');
  });

  it('treats a payload without an available array as no modules', async () => {
    const root = makeDom();
    const widgets = { children: [], hidden: false, innerHTML: '', replaceChildren() { this.children = []; this.innerHTML = ''; } };
    const actions = { children: [], replaceChildren() {} };
    const base = globalThis.document.getElementById;
    globalThis.document.getElementById = (id) => (id === 'dashboard-actions' ? actions : id === 'dashboard-widgets' ? widgets : base(id));
    // The stub answers the version payload for EVERY url, the layout url included.
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ version: 'v0.1.0', platform: 'darwin' }) });
    const mod = await import('../js/dashboard.js?' + Math.random());
    await mod.renderDashboardView();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(titles(root).length, 3);
    assert.equal(widgets.hidden, true);
  });
});

describe('the entry cards with modules installed', () => {
  it('hides #dashboard-cards once the layout answers with at least one module', async () => {
    const root = makeDom();
    const widgets = { children: [], hidden: true, innerHTML: '', replaceChildren() { this.children = []; this.innerHTML = ''; } };
    const actions = { children: [], innerHTML: '', replaceChildren() { this.children = []; } };
    const base = globalThis.document.getElementById;
    globalThis.document.getElementById = (id) => (id === 'dashboard-actions' ? actions : id === 'dashboard-widgets' ? widgets : base(id));
    globalThis.fetch = async (url) => ({
      ok: true,
      json: async () => (String(url).includes('/api/dashboard/layout')
        ? { hasModules: true, available: [{ moduleId: 'm1', widgets: [] }], layout: { items: [] } }
        : { version: 'v0.1.0', platform: 'darwin' }),
    });
    const mod = await import('../js/dashboard.js?' + Math.random());
    await mod.renderDashboardView();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(root.hidden, true);
    assert.equal(widgets.hidden, false, 'the empty widget state takes the space');
  });
});
