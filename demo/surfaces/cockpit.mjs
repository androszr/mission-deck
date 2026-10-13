// demo/surfaces/cockpit.mjs
// The cockpit surface: a fresh clone of the real shell (demo/shell-loader.mjs)
// on every reset, the top-bar slots and the dashboard painted from mocks, and
// the effects the engine asks for - showing a view, opening a hub flyout,
// switching a Settings tab, toasts, modals, the Claude Code panel. Previews
// live in surfaces/overlay.mjs (they can open on any surface).
//
// Nothing here fires a browser event on a shell element or writes storage: the
// shell is inert, and every visible change is one of the functions below.

import { openDsModal, closeDsModal } from '/js/ds-modal.js';
import { renderMock } from '../mocks/index.mjs';
import { allPages, CORE_HUBS } from '../scenario-schema.mjs';
import { applyRailState } from '../shell-loader.mjs';
import { appendLines } from './term.mjs';

const TOAST_ICONS = {
  success: '<path d="M20 6 9 17l-5-5"/>',
  warning: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  danger: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
};
const TOAST_MS = 4000;

const TOPBAR_SLOTS = [
  ['#topbar-mr-root', 'topbar-mr'],
  ['#topbar-active-badge-root', 'topbar-active'],
  ['#topbar-terminal-root', 'topbar-terminal'],
  ['#topbar-daycycle-root', 'topbar-daycycle'],
  ['#topbar-sync-root', 'topbar-sync'],
  ['#topbar-bw-root', 'topbar-bw'],
  ['#topbar-user-root', 'topbar-user'],
];

/**
 * @param {{ root: HTMLElement, template: DocumentFragment, scenario: object }} opts
 */
export function createCockpitSurface({ root, template, scenario }) {
  const pages = allPages(scenario);
  const timers = new Set();
  let state = null;
  let flyoutEl = null;

  const $ = (sel) => root.querySelector(sel);

  function _later(fn, ms) {
    const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
    timers.add(t);
  }

  /** A module page section in the js/module-host.js shape, painted from its mock. */
  function _pageSection(page) {
    const sec = document.createElement('div');
    sec.className = 'view-section';
    sec.id = 'view-' + page.view;
    sec.innerHTML = page.mock
      ? renderMock(page.mock, page.props)
      : `<div class="page-header"><div class="page-header-row"><div><h1></h1></div></div></div><div class="view-data" id="${page.view}-root"></div>`;
    if (!page.mock) sec.querySelector('h1').textContent = page.label;
    return sec;
  }

  function _paintFlyout(hubId) {
    const hub = CORE_HUBS.find((h) => h.id === hubId);
    const items = state.flyout[hubId] || [];
    const label = document.createElement('div');
    label.className = 'sidebar-flyout-label';
    label.textContent = hub ? hub.label : hubId;
    flyoutEl.replaceChildren(label);
    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sidebar-flyout-empty';
      empty.textContent = 'Nothing here yet. Pages in this hub come from modules — see Settings > Modules.';
      flyoutEl.appendChild(empty);
    }
    for (const it of items) {
      const a = document.createElement('a');
      a.className = 'sidebar-hub-flyout-item' + (state.view === it.view ? ' active' : '');
      a.dataset.flyoutView = it.view;
      a.dataset.flyoutHub = hubId;
      a.textContent = it.label;
      flyoutEl.appendChild(a);
    }
    // offsetWidth, not getBoundingClientRect: the camera may be zoomed, and
    // the rail starts at the surface's left edge either way.
    const sidebar = $('#sidebar');
    const left = sidebar ? sidebar.offsetWidth : 300;
    flyoutEl.style.left = left + 'px';
    flyoutEl.style.display = 'block';
  }

  function _closeFlyout() {
    if (flyoutEl) flyoutEl.style.display = 'none';
    state.hub = null;
  }

  function _markRail() {
    const page = pages.find((p) => p.view === state.view);
    const railView = page ? page.hub : state.view;
    root.querySelectorAll('#sidebar .sidebar-item').forEach((a) => {
      a.classList.toggle('active', a.dataset.view === railView);
    });
  }

  function showView(viewId) {
    _closeFlyout();
    let sec = $('#view-' + viewId);
    if (!sec) {
      const page = pages.find((p) => p.view === viewId);
      if (!page) throw new Error('Demo: nieznany widok ' + viewId);
      sec = _pageSection(page);
      $('main.main').appendChild(sec);
    }
    root.querySelectorAll('.view-section.active').forEach((s) => s.classList.remove('active'));
    sec.classList.add('active');
    state.view = viewId;
    _markRail();
    const main = $('main.main');
    if (main) main.scrollTop = 0;
  }

  /** Mirror of _activateSettingsTab in js/settings.js, minus its storage write. */
  function openSettingsTab(tabId) {
    const view = $('#view-settings');
    view.querySelectorAll('.sett-tabs .ds-tab').forEach((btn) => {
      const on = btn.dataset.settTab === tabId;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', String(on));
    });
    view.querySelectorAll('[data-sett-panel]').forEach((p) => { p.hidden = p.dataset.settPanel !== tabId; });
    state.tab = tabId;
  }

  function openHub(hubId) {
    state.hub = hubId;
    _paintFlyout(hubId);
  }

  /**
   * A real DS toast. `region` defaults to the shell's #ds-toast-region; the
   * engine passes another one when a non-cockpit surface is on screen.
   */
  function _toast({ variant, title, desc }, ctx, region = $('#ds-toast-region')) {
    if (ctx.replay) return;
    const t = document.createElement('div');
    t.className = 'ds-toast ds-toast--' + variant;
    const ic = document.createElement('span');
    ic.className = 'ds-toast-icon';
    ic.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">'
      + (TOAST_ICONS[variant] || TOAST_ICONS.info) + '</svg>';
    const body = document.createElement('div');
    body.className = 'ds-toast-body';
    const tt = document.createElement('div');
    tt.className = 'ds-toast-title';
    tt.textContent = title;
    body.appendChild(tt);
    if (desc) {
      const d = document.createElement('div');
      d.className = 'ds-toast-desc';
      d.textContent = desc;
      body.appendChild(d);
    }
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ds-toast-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '✕';
    t.append(ic, body, close);
    region.appendChild(t);
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('ds-toast--visible')));
    _later(() => {
      t.classList.remove('ds-toast--visible');
      _later(() => t.remove(), 400);
    }, TOAST_MS);
  }

  async function _modal(a, ctx) {
    if (a.close) {
      const el = $(a.close);
      if (!el) throw new Error('Demo: no window ' + a.close);
      closeDsModal(el);
      if (el.dataset.demoMock === '1') {
        if (ctx.animate) _later(() => el.remove(), 220);
        else el.remove();
      }
      return;
    }
    let el;
    if (a.openEl) {
      el = $(a.openEl);
    } else {
      const holder = document.createElement('div');
      holder.innerHTML = renderMock(a.open, a.props).trim();
      el = holder.firstElementChild;
      el.dataset.demoMock = '1';
      root.appendChild(el);
    }
    if (!el) throw new Error('Demo: no window ' + (a.openEl || a.open));
    openDsModal(el);
    await ctx.sleep(260);
  }

  function _flyoutAdd(a) {
    const page = pages.find((p) => p.view === a.view);
    const list = state.flyout[page.hub] || (state.flyout[page.hub] = []);
    if (!list.some((it) => it.view === page.view)) list.push({ view: page.view, label: page.label });
    if (state.hub === page.hub) _paintFlyout(page.hub);
  }

  // ── Claude Code panel ──────────────────────────────────────────────────
  function _terminalHost() {
    const panel = $('#claude-terminal-panel');
    let host = panel.querySelector('.claude-terminal-host');
    if (!host) {
      const tabs = $('#claude-terminal-tabs');
      tabs.innerHTML = '<div class="claude-terminal-tab claude-terminal-tab--active" role="tab" aria-selected="true">'
        + '<span class="claude-terminal-tab__title">Claude 1</span></div>';
      host = document.createElement('div');
      host.className = 'claude-terminal-host demo-term';
      $('#claude-terminal-hosts').appendChild(host);
      $('#claude-terminal-label-text').textContent = 'Terminal';
    }
    return host;
  }

  async function openTerminal(ctx) {
    const panel = $('#claude-terminal-panel');
    const host = _terminalHost();
    panel.hidden = false;
    if (ctx.animate) {
      await ctx.frame();
      panel.classList.add('claude-terminal-panel--open');
      await ctx.sleep(280);
    } else {
      panel.classList.add('claude-terminal-panel--open');
    }
    state.terminalOpen = true;
    if (!host.firstChild) await appendLines(host, [{ role: 'claude', text: '~/Projects/mission-deck' }], { ...ctx, animate: false });
    return host;
  }

  async function _terminal(a, ctx) {
    const panel = $('#claude-terminal-panel');
    if (a.close) {
      panel.classList.remove('claude-terminal-panel--open');
      if (ctx.animate) await ctx.sleep(260);
      panel.hidden = true;
      state.terminalOpen = false;
      return;
    }
    const host = state.terminalOpen ? _terminalHost() : await openTerminal(ctx);
    await appendLines(host, a.lines, ctx);
  }

  return {
    id: 'cockpit',
    el: root,
    get state() { return state; },

    reset() {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      root.replaceChildren(template.cloneNode(true));
      applyRailState(root, false);
      state = { view: 'dashboard', tab: 'system', hub: null, terminalOpen: false, flyout: {} };
      for (const p of pages) {
        if (p.initial !== false) (state.flyout[p.hub] || (state.flyout[p.hub] = [])).push({ view: p.view, label: p.label });
      }
      for (const [sel, mock] of TOPBAR_SLOTS) {
        const slot = $(sel);
        if (slot) slot.innerHTML = renderMock(mock);
      }
      $('#dashboard-cards').innerHTML = renderMock('dashboard-cards');
      flyoutEl = document.createElement('div');
      flyoutEl.className = 'sidebar-group-body sidebar-hub-flyout';
      flyoutEl.style.display = 'none';
      flyoutEl.style.position = 'fixed';
      flyoutEl.style.zIndex = '200';
      root.appendChild(flyoutEl);
      showView('dashboard');
      openSettingsTab('system');
    },

    /** Apply one effect of an expanded navigate (see navigatePath). */
    applyEffect(effect) {
      if (effect.kind === 'hub') openHub(effect.hub);
      else if (effect.kind === 'view') showView(effect.view);
      else if (effect.kind === 'tab') openSettingsTab(effect.tab);
    },

    openTerminal,

    handlers: {
      toast: _toast,
      modal: _modal,
      flyout: _flyoutAdd,
      terminal: _terminal,
    },

    destroy() {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    },
  };
}
