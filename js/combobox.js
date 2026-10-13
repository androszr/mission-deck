// ── Mission Deck — js/combobox.js ──────────────────────────────────────
// Shared inline combobox (position:fixed, not clipped by ds-card overflow).
// Extracted from a module's picker views (KB/Meeting/VMO pickers) so
// js/discovery-tasks.js can reuse it without duplicating ~85 lines.
// Keeps the pcyb-combo-* CSS class names (styled globally in styles.css)
// to avoid CSS churn; a rename can happen when pcyb is retired.

import { escHtml, normalizeSearch } from './utils.js';

// Returns { inputEl, cleanup } — cleanup removes the floating list from body.
//
// Two modes, mutually exclusive:
//   items        — static array, filtered locally (original behaviour, unchanged)
//   fetchItems   — async (query) => Promise<item[]>, filtered remotely.
//                  Debounced by debounceMs, shows a "Searching..." row while in
//                  flight, and drops out-of-order responses via a sequence
//                  counter so a slow early request cannot overwrite a newer one.
export function makeCombobox({ container, placeholder, items, labelFn, onPick, maxResults = 20, fetchItems = null, debounceMs = 250, minChars = 1 }) {
  // container is the element where input is placed; the results list portals to body
  container.innerHTML = `<div class="ds-input-wrap pcyb-combo-wrap">
    <input type="text" class="ds-input pcyb-combo-input" placeholder="${escHtml(placeholder)}" autocomplete="off" spellcheck="false">
  </div>`;

  const inputEl = container.querySelector('.pcyb-combo-input');
  const listEl = document.createElement('div');
  listEl.className = 'pcyb-combo-list';
  listEl.hidden = true;
  document.body.appendChild(listEl);

  let _cleanup = () => { listEl.remove(); };
  let _scrollListener = null;

  function _positionList() {
    const r = inputEl.getBoundingClientRect();
    listEl.style.position = 'fixed';
    listEl.style.left = r.left + 'px';
    listEl.style.width = r.width + 'px';
    listEl.style.top = (r.bottom + 2) + 'px';
    listEl.style.right = 'auto';
    listEl.style.bottom = 'auto';
  }

  function _closeList() {
    listEl.hidden = true;
    if (_scrollListener) {
      window.removeEventListener('scroll', _scrollListener, true);
      window.removeEventListener('resize', _scrollListener);
      _scrollListener = null;
    }
  }

  function _ensureScrollListener() {
    if (!_scrollListener) {
      _scrollListener = () => { if (!listEl.hidden) _positionList(); };
      window.addEventListener('scroll', _scrollListener, true);
      window.addEventListener('resize', _scrollListener);
    }
  }

  // Paints a single non-selectable status row (async mode only).
  function _renderStatus(text) {
    listEl.innerHTML = `<div class="pcyb-combo-empty">${escHtml(text)}</div>`;
    listEl.hidden = false;
    _positionList();
    _ensureScrollListener();
  }

  function _paint(filtered) {
    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="pcyb-combo-empty">No results</div>';
    } else {
      listEl.innerHTML = filtered.map((item, i) =>
        `<div class="pcyb-combo-item" data-idx="${i}" tabindex="-1" role="option">${escHtml(labelFn(item))}</div>`,
      ).join('');
      listEl.querySelectorAll('.pcyb-combo-item').forEach((el, i) => {
        el.addEventListener('mousedown', e => {
          e.preventDefault(); // prevent input blur before pick
          onPick(filtered[i]);
          _closeList();
        });
      });
    }
    listEl.hidden = false;
    _positionList();
    _ensureScrollListener();
  }

  function _renderItems(q) {
    const norm = normalizeSearch(q);
    const filtered = (norm
      ? items.filter(item => normalizeSearch(labelFn(item)).includes(norm))
      : items
    ).slice(0, maxResults);
    _paint(filtered);
  }

  // ── async mode ──
  let _debounceTimer = null;
  let _seq = 0;

  function _renderRemote(q) {
    const query = String(q || '').trim();
    if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
    if (query.length < minChars) { _closeList(); return; }
    _renderStatus('Searching...');
    const mySeq = ++_seq;
    _debounceTimer = setTimeout(async () => {
      _debounceTimer = null;
      let results = [];
      try {
        results = await fetchItems(query);
      } catch {
        if (mySeq === _seq) _renderStatus('Search error');
        return;
      }
      if (mySeq !== _seq) return; // a newer query already went out
      _paint((Array.isArray(results) ? results : []).slice(0, maxResults));
    }, debounceMs);
  }

  const _onQuery = fetchItems ? _renderRemote : _renderItems;

  inputEl.addEventListener('input', () => _onQuery(inputEl.value));
  inputEl.addEventListener('focus', () => _onQuery(inputEl.value));
  inputEl.addEventListener('blur', () => {
    // Slight delay so mousedown on list item fires first
    setTimeout(() => _closeList(), 150);
  });

  // Click outside
  const _outsideClick = e => {
    if (!container.contains(e.target) && !listEl.contains(e.target)) _closeList();
  };
  document.addEventListener('click', _outsideClick, true);

  const origCleanup = _cleanup;
  _cleanup = () => {
    if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
    _seq++; // invalidate any in-flight async response
    _closeList();
    document.removeEventListener('click', _outsideClick, true);
    origCleanup();
  };

  return { inputEl, cleanup: _cleanup };
}
