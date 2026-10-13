// Custom DS Select — enhances every select.ds-input with a styled dropdown + optional search.
// Search input appears automatically when the select has >= MIN_SEARCH options.
// The native <select> stays in the document (hidden) so existing .value reads and
// addEventListener('change', …) calls continue to work without modification.

import { normalizeSearch } from './utils.js';

const MIN_SEARCH = 6;
const _disposers = new WeakMap();
// A destroyed live select stays native until an explicit initSelect call.
// Otherwise unwrapping it would make the global observer enhance it again.
const _autoSuppressed = new WeakSet();

function initSelect(native) {
  if (native._dsEnhanced) return _disposers.get(native);
  if (!native.parentNode) return;
  _autoSuppressed.delete(native);
  native._dsEnhanced = true;
  let disposed = false;
  const originalStyle = native.getAttribute('style');
  const originalTabindex = native.getAttribute('tabindex');

  const parent = native.parentNode;

  // ── Wrapper ──────────────────────────────────────────────
  const wrap = document.createElement('div');
  wrap.className = 'ds-sel-wrap';
  if (native.disabled) wrap.classList.add('ds-sel--disabled');

  // ── Trigger button ────────────────────────────────────────
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'ds-sel-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  for (const attribute of ['aria-label', 'aria-labelledby', 'aria-describedby']) {
    if (native.hasAttribute(attribute)) trigger.setAttribute(attribute, native.getAttribute(attribute));
  }
  if (native.disabled) trigger.disabled = true;

  const trigText = document.createElement('span');
  trigText.className = 'ds-sel-text';

  const trigIcon = document.createElement('span');
  trigIcon.className = 'ds-sel-icon';
  trigIcon.innerHTML =
    `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">` +
    `<path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `</svg>`;

  trigger.appendChild(trigText);
  trigger.appendChild(trigIcon);

  // ── Dropdown panel ────────────────────────────────────────
  const drop = document.createElement('div');
  drop.className = 'ds-sel-drop';
  drop.hidden = true;

  wrap.appendChild(trigger);
  wrap.appendChild(drop);

  // Place wrapper where native was, hide native inside wrapper
  parent.insertBefore(wrap, native);
  wrap.appendChild(native);
  native.tabIndex = -1;
  // border:0 and top:0 are load-bearing, not tidiness. .ds-input carries a 1px
  // border under border-box, so a 'height:0' select still lays out 2px tall, and
  // without a top it sits at its static position BELOW the trigger - 2px of
  // overflow that turned every modal holding a select into a scrolling one.
  native.style.cssText = 'position:absolute;top:0;left:0;opacity:0;width:0;height:0;border:0;padding:0;margin:0;pointer-events:none;overflow:hidden;';

  // Wire label so clicking label opens dropdown
  const label = native.labels?.[0] || null;
  const labelCursor = label?.style.getPropertyValue('cursor') || '';
  const labelCursorPriority = label?.style.getPropertyPriority('cursor') || '';
  const onLabelClick = e => { e.preventDefault(); toggle(); };
  if (label) {
    label.style.cursor = 'pointer';
    label.addEventListener('click', onLabelClick);
    if (!trigger.hasAttribute('aria-label') && !trigger.hasAttribute('aria-labelledby')) {
      trigger.setAttribute('aria-label', label.textContent.trim());
    }
  }

  let searchEl = null;

  // ── Build / rebuild dropdown options ─────────────────────
  function buildList() {
    if (disposed) return;
    drop.innerHTML = '';
    searchEl = null;
    const opts = Array.from(native.options);

    if (opts.length >= MIN_SEARCH) {
      const sw = document.createElement('div');
      sw.className = 'ds-sel-search-wrap';

      searchEl = document.createElement('input');
      searchEl.type = 'text';
      searchEl.className = 'ds-sel-search';
      searchEl.placeholder = 'Search…';
      searchEl.setAttribute('autocomplete', 'off');
      sw.appendChild(searchEl);
      drop.appendChild(sw);

      searchEl.addEventListener('input', () => {
        const q = normalizeSearch(searchEl.value);
        drop.querySelectorAll('.ds-sel-opt').forEach(el => {
          el.hidden = !el.dataset.text.includes(q);
        });
      });
      searchEl.addEventListener('keydown', e => {
        if (e.key === 'Escape') { close(); trigger.focus(); }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          const first = drop.querySelector('.ds-sel-opt:not([hidden])');
          if (first) first.focus();
        }
      });
    }

    const ul = document.createElement('ul');
    ul.className = 'ds-sel-list';
    ul.setAttribute('role', 'listbox');

    opts.forEach((opt, i) => {
      const li = document.createElement('li');
      li.className = 'ds-sel-opt';
      li.setAttribute('role', 'option');
      li.dataset.idx = i;
      li.dataset.text = normalizeSearch(opt.text);
      li.tabIndex = -1;
      if (opt.disabled) li.classList.add('ds-sel-opt--dis');
      const isSel = native.selectedIndex === i;
      li.classList.toggle('ds-sel-opt--sel', isSel);
      li.setAttribute('aria-selected', isSel ? 'true' : 'false');

      const check = document.createElement('span');
      check.className = 'ds-sel-check';
      const txt = document.createElement('span');
      txt.textContent = opt.text;
      li.appendChild(check);
      li.appendChild(txt);

      li.addEventListener('click', () => { if (!opt.disabled) pick(i); });
      li.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!opt.disabled) pick(i); }
        if (e.key === 'Escape') { close(); trigger.focus(); }
        if (e.key === 'ArrowDown') { e.preventDefault(); const nx = li.nextElementSibling; if (nx) nx.focus(); }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          const pv = li.previousElementSibling;
          if (pv) pv.focus(); else if (searchEl) searchEl.focus();
        }
      });

      ul.appendChild(li);
    });

    drop.appendChild(ul);
    syncText();
  }

  function syncText() {
    if (disposed) return;
    const sel = native.options[native.selectedIndex];
    trigText.textContent = sel ? sel.text : '';
    drop.querySelectorAll('.ds-sel-opt').forEach((el, i) => {
      const isSel = i === native.selectedIndex;
      el.classList.toggle('ds-sel-opt--sel', isSel);
      el.setAttribute('aria-selected', isSel ? 'true' : 'false');
    });
  }

  function pick(idx) {
    if (disposed) return;
    native.selectedIndex = idx;
    syncText();
    native.dispatchEvent(new Event('change', { bubbles: true }));
    close();
    trigger.focus();
  }

  function positionDrop() {
    const r = trigger.getBoundingClientRect();
    const dropH = drop.offsetHeight || 260;
    const spaceBelow = window.innerHeight - r.bottom - 4;
    const openUp = dropH > spaceBelow && r.top >= dropH;
    drop.style.position = 'fixed';
    drop.style.left = r.left + 'px';
    drop.style.width = r.width + 'px';
    drop.style.right = 'auto';
    if (openUp) {
      drop.style.top = 'auto';
      drop.style.bottom = (window.innerHeight - r.top + 4) + 'px';
    } else {
      drop.style.top = (r.bottom + 4) + 'px';
      drop.style.bottom = 'auto';
    }
  }

  let _onScrollOrResize = null;
  let _focusFrame = null;

  function open() {
    if (disposed || native.disabled || !drop.hidden) return;
    drop.hidden = false;
    positionDrop();
    trigger.setAttribute('aria-expanded', 'true');
    wrap.classList.add('ds-sel--open');
    _onScrollOrResize = () => { if (!drop.hidden) positionDrop(); };
    window.addEventListener('scroll', _onScrollOrResize, true);
    window.addEventListener('resize', _onScrollOrResize);
    if (searchEl) {
      searchEl.value = '';
      drop.querySelectorAll('.ds-sel-opt').forEach(el => { el.hidden = false; });
      _focusFrame = requestAnimationFrame(() => { _focusFrame = null; searchEl?.focus(); });
    } else {
      const selOpt = drop.querySelector('.ds-sel-opt--sel') || drop.querySelector('.ds-sel-opt');
      if (selOpt) _focusFrame = requestAnimationFrame(() => { _focusFrame = null; selOpt.focus(); });
    }
  }

  function close() {
    if (_focusFrame !== null) {
      cancelAnimationFrame(_focusFrame);
      _focusFrame = null;
    }
    drop.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    wrap.classList.remove('ds-sel--open');
    if (_onScrollOrResize) {
      window.removeEventListener('scroll', _onScrollOrResize, true);
      window.removeEventListener('resize', _onScrollOrResize);
      _onScrollOrResize = null;
    }
  }

  function toggle() { if (drop.hidden) open(); else close(); }

  trigger.addEventListener('click', toggle);
  const onTriggerKeydown = e => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); open(); }
    if (e.key === 'Escape') close();
  };
  trigger.addEventListener('keydown', onTriggerKeydown);

  // Close when clicking outside (trigger and the floating drop are siblings in coordinate space — check both).
  const onDocumentClick = e => {
    if (wrap.contains(e.target)) return;
    if (drop.contains(e.target)) return;
    close();
  };
  document.addEventListener('click', onDocumentClick, true);

  // Rebuild list when options are added/removed programmatically
  const optionsObserver = new MutationObserver(() => buildList());
  optionsObserver.observe(native, { childList: true });

  // Sync disabled state
  const disabledObserver = new MutationObserver(() => {
    if (disposed) return;
    const dis = native.disabled;
    wrap.classList.toggle('ds-sel--disabled', dis);
    trigger.disabled = dis;
  });
  disabledObserver.observe(native, { attributes: true, attributeFilter: ['disabled'] });

  // Sync visible trigger label when external code dispatches a change event
  // (e.g. modal pre-fill: select.value = '...'; select.dispatchEvent(new Event('change')))
  const onNativeChange = e => {
    if (e._dsSelectInternal) return;
    syncText();
  };
  native.addEventListener('change', onNativeChange);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    _autoSuppressed.add(native);
    close();
    optionsObserver.disconnect();
    disabledObserver.disconnect();
    document.removeEventListener('click', onDocumentClick, true);
    native.removeEventListener('change', onNativeChange);
    trigger.removeEventListener('click', toggle);
    trigger.removeEventListener('keydown', onTriggerKeydown);
    if (label) {
      label.removeEventListener('click', onLabelClick);
      if (labelCursor) label.style.setProperty('cursor', labelCursor, labelCursorPriority);
      else label.style.removeProperty('cursor');
    }
    const restoreFocus = wrap.contains(document.activeElement);
    if (native.parentNode === wrap) {
      if (wrap.parentNode) wrap.parentNode.insertBefore(native, wrap);
      else wrap.removeChild(native);
    }
    wrap.remove();
    for (const [name, value] of [['style', originalStyle], ['tabindex', originalTabindex]]) {
      if (value === null) native.removeAttribute(name);
      else native.setAttribute(name, value);
    }
    delete native._dsEnhanced;
    _disposers.delete(native);
    if (restoreFocus && native.isConnected) native.focus();
  };
  _disposers.set(native, dispose);

  buildList();
  return dispose;
}

function destroySelect(native) {
  if (!native) return;
  _autoSuppressed.add(native);
  _disposers.get(native)?.();
}

function autoInitSelect(native) {
  if (native.isConnected && !_autoSuppressed.has(native)) initSelect(native);
}

function initAll() {
  document.querySelectorAll('select.ds-input').forEach(autoInitSelect);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAll);
} else {
  initAll();
}

// Catch dynamically added selects (AI model panels, year selectors, etc.)
new MutationObserver(muts => {
  for (const m of muts) {
    for (const node of m.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches?.('select.ds-input')) autoInitSelect(node);
      node.querySelectorAll?.('select.ds-input').forEach(autoInitSelect);
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true });

export { initSelect, destroySelect };
