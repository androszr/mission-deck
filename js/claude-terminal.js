// js/claude-terminal.js
// Bottom-docked xterm.js terminal panel — multi-tab.
// Every tab is type 'claude' (spawns CLAUDE_CMD via the /api/claude-terminal WS).
// There is deliberately no plain-shell tab type: this cockpit is Claude-Code
// only, and a general shell over a WebSocket is a much larger thing to secure
// than the one command CLAUDE_CMD names.
// Exported API consumed by js/app.js (init + toggle).
//
// xterm.js + addon-fit are lazy-loaded from /vendor/xterm/ on first open.
// Session reconnect is also deferred to first open.

// Session persistence: sessionStorage keys survive a reload within the 30 s grace window.
// Explicit close (x) clears both keys.
const STORAGE_KEY_CLAUDE  = 'claudeTermSessionId';
const PANEL_CLOSED_KEY    = 'claudeTermPanelClosed';

let _tabs          = [];   // { id, type, num, title, term, fitAddon, ws, hostEl, tabEl, needsAction }
let _activeTabId   = null;
let _nextTabId     = 1;
let _nextClaudeNum = 1;
let _isOpen        = false;
let _isMinimized   = false;
let _initialized   = false;
let _panelHeightPx = 0;
let _resizeTimer   = null;
let _xtermReady    = null; // Promise; set on first lazy-load

const _ANSI_RE         = /\x1b\[[0-9;]*[A-Za-z]|\x1b[^[]/g;
const _NEEDS_ACTION_RE = /\[Y\/n\]|\[y\/N\]|\(y\/n\)|\(Y\/N\)|Press any key|\? /;

// ── Helpers ────────────────────────────────────────────────────────────────────

function _wsUrlForType(_type, sessionId) {
  const url = 'ws://' + location.host + '/api/claude-terminal';
  return sessionId ? url + '?sessionId=' + encodeURIComponent(sessionId) : url;
}

// ── Lazy xterm loader ──────────────────────────────────────────────────────────

function _loadXterm() {
  if (window.Terminal && window.FitAddon) return Promise.resolve();
  if (_xtermReady) return _xtermReady;
  const _load = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve; s.onerror = () => reject(new Error('xterm load failed: ' + src));
    document.head.appendChild(s);
  });
  if (!document.querySelector('link[href*="xterm.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/vendor/xterm/xterm.css';
    document.head.appendChild(link);
  }
  _xtermReady = _load('/vendor/xterm/xterm.js')
    .then(() => _load('/vendor/xterm/addon-fit.js'));
  return _xtermReady;
}

function _storageKeyForType(_type) {
  return STORAGE_KEY_CLAUDE;
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function initUnifiedTerminal() {
  if (_initialized) return;
  _initialized = true;

  const addClaudeBtn = document.getElementById('claude-terminal-add-claude');
  const minimizeBtn  = document.getElementById('claude-terminal-minimize');
  const closeBtn     = document.getElementById('claude-terminal-close');
  const handle       = document.getElementById('claude-terminal-resize-handle');

  const label = document.getElementById('claude-terminal-label');
  if (label) label.addEventListener('click', () => {
    if (!_isOpen)     { _open();    return; }
    if (_isMinimized) { _restore(); return; }
    _minimize();
  });

  if (addClaudeBtn) addClaudeBtn.addEventListener('click', () => {
    _ensureOpenThen(() => _addTab('claude'));
  });
  if (minimizeBtn) minimizeBtn.addEventListener('click', () => _isMinimized ? _restore() : _minimize());
  if (closeBtn)    closeBtn.addEventListener('click', _closePanel);
  if (handle)      _wireResizeHandle(handle);
}

export function toggleUnifiedTerminal() {
  if (!_isOpen)     { _open();    return; }
  if (_isMinimized) { _restore(); return; }
  _minimize();
}

export function isUnifiedTerminalOpen() {
  return _isOpen;
}

// ── Ensure open helper (used by both add buttons) ─────────────────────────────

// Calls fn() once the panel is open and not minimized.
// Panel is always shown (or un-minimized) first, then fn() adds the typed tab.
// Does NOT trigger the _restore() auto-add so fn() always controls which tab type spawns.
function _ensureOpenThen(fn) {
  if (!_isOpen) {
    // Open to full view via the typed path (not _open() which defaults to claude).
    _openMinimizedThen(fn);
    return;
  }
  if (_isMinimized) {
    // Un-minimize without auto-spawning a tab, then let fn() add the correct type.
    _restoreNoAutoAdd();
    fn();
    return;
  }
  fn();
}

// _restoreNoAutoAdd() — same as _restore() but never auto-spawns a tab.
// Used by _ensureOpenThen so the add-button fn() always drives tab creation.
function _restoreNoAutoAdd() {
  if (!_isOpen || !_isMinimized) return;
  _isMinimized = false;
  try { localStorage.removeItem(PANEL_CLOSED_KEY); } catch (_e) {}

  const panel = document.getElementById('claude-terminal-panel');
  if (panel) {
    panel.classList.remove('claude-terminal-panel--minimized');
    if (_panelHeightPx > 0) panel.style.height = _panelHeightPx + 'px';
  }

  _updateMinimizeBtn(false);
  _updateLabel();
  requestAnimationFrame(() => requestAnimationFrame(() => _fitActive()));
}

// _openMinimizedThen(fn): show the header bar (minimized) then call fn() to
// add the typed tab.  Does NOT auto-spawn a 'claude' tab.
function _openMinimizedThen(fn) {
  if (_isOpen) { fn(); return; }
  try { localStorage.removeItem(PANEL_CLOSED_KEY); } catch (_e) {}

  const panel = document.getElementById('claude-terminal-panel');
  if (!panel) return;

  if (_panelHeightPx > 0) {
    panel.style.height = _panelHeightPx + 'px';
  } else {
    panel.style.height = '';
  }

  panel.removeAttribute('hidden');
  panel.classList.remove('claude-terminal-panel--minimized');
  requestAnimationFrame(() => panel.classList.add('claude-terminal-panel--open'));

  _isOpen = true;
  _updateLabel();
  window.addEventListener('resize', _onWindowResize);
  fn();
}

// ── Resize handle ──────────────────────────────────────────────────────────────

function _wireResizeHandle(handle) {
  handle.addEventListener('mousedown', (startEvt) => {
    startEvt.preventDefault();
    const panel  = document.getElementById('claude-terminal-panel');
    const startY = startEvt.clientY;
    const startH = panel.getBoundingClientRect().height;

    function onMove(e) {
      const newH = Math.max(80, Math.min(window.innerHeight - 48, startH - (e.clientY - startY)));
      panel.style.height = newH + 'px';
      _panelHeightPx = newH;
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      _fitActive();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}

// ── Tab management ─────────────────────────────────────────────────────────────

// _attachWs(tab, url) wires a WebSocket onto an already-created tab object.
// Shared between _addTab() (fresh spawn) and _addReconnectTab()
// (resume, url includes ?sessionId=...).
//
// First-frame handling:
//   The server sends {"type":"session","id":"..."} as the very first WS frame.
//   We parse it, save to sessionStorage under the type-appropriate key, and do NOT
//   forward it to the terminal.  Every subsequent frame is written to the terminal.
//
// Soft-close:
//   ws.onclose does NOT send a kill frame and does NOT clear sessionStorage.
//   The server starts a 30 s grace timer; initUnifiedTerminal auto-reconnect
//   can pick the session back up on the next page load.

// _writeTerminalUnavailable(tab) — called when a WS connection closed without
// ever opening.  Probes /api/claude-terminal/status to tell "node-pty missing
// on this machine" (available === false) apart from any other failure to
// connect (available === true, or the status request itself failed), and
// writes the matching message into the tab's terminal buffer.
function _writeTerminalUnavailable(tab) {
  fetch('/api/claude-terminal/status', { credentials: 'same-origin' })
    .then((r) => r.json())
    .then((body) => {
      if (!tab || !tab.term) return;
      if (body && body.available === false) {
        tab.term.write(
          '\r\n\x1b[91mThe Claude Code terminal is not available on this computer.\x1b[0m\r\n' +
          'The component behind the terminal is not installed or does not work.\r\n' +
          'Fix it with: npm rebuild node-pty && node scripts/postinstall.js\r\n' +
          'Details: Settings > Tools.\r\n'
        );
      } else {
        tab.term.write('\r\n\x1b[90mCould not connect to the terminal. Please try again.\x1b[0m\r\n');
      }
    })
    .catch(() => {
      if (tab && tab.term) {
        tab.term.write('\r\n\x1b[90mCould not connect to the terminal. Please try again.\x1b[0m\r\n');
      }
    });
}


function _attachWs(tab, url) {
  const ws = new WebSocket(url);
  tab.ws = ws;

  // Tracks whether this WebSocket ever reached the OPEN state, so onclose can
  // tell a normal session end (was open, now closed) apart from a connection
  // that never came up at all (node-pty missing/broken, upgrade refused, ...).
  let _opened = false;
  ws.onopen = () => { _opened = true; };

  // Coalesce rapid keystrokes into a single WS frame per microtask tick.
  let _buf = '';
  let _flushPending = false;
  const _flush = () => {
    if (_buf && ws.readyState === WebSocket.OPEN) { ws.send(_buf); _buf = ''; }
    _flushPending = false;
  };
  tab.term.onData((data) => {
    _buf += data;
    if (!_flushPending) { _flushPending = true; Promise.resolve().then(_flush); }
  });

  ws.onmessage = (e) => {
    const raw = typeof e.data === 'string' ? e.data : null;

    // Peek for the session-id handshake frame; do NOT write it to the terminal.
    if (raw !== null && raw.startsWith('{"type":"session"')) {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'session' && msg.id) {
          sessionStorage.setItem(_storageKeyForType(tab.type), msg.id);
          return;
        }
      } catch (_e) { /* fall through */ }
    }

    const data = raw !== null ? raw : new Uint8Array(e.data);
    if (tab.term) tab.term.write(data);
    if (tab && tab.id !== _activeTabId && typeof data === 'string' && !tab.needsAction) {
      if (_NEEDS_ACTION_RE.test(data.replace(_ANSI_RE, ''))) {
        tab.needsAction = true;
        _updateTabEl(tab);
      }
    }
  };

  // Soft close: visual teardown only.  sessionStorage is intentionally preserved
  // so initUnifiedTerminal can reconnect after a page reload within the grace window.
  // A connection that was NEVER open (node-pty missing/broken, upgrade refused)
  // gets the longer, actionable message from _writeTerminalUnavailable instead
  // of the terse "[session ended]", which belongs to a real, finished session.
  ws.onclose = () => {
    if (tab) {
      if (_opened) {
        if (tab.term) tab.term.write('\r\n\x1b[90m[session ended]\x1b[0m\r\n');
      } else {
        _writeTerminalUnavailable(tab);
      }
      tab.ws = null;
    }
  };

  tab.term.onResize(({ cols, rows }) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  });
}

function _makeTermEl() {
  const hostEl = document.createElement('div');
  hostEl.className     = 'claude-terminal-host';
  hostEl.style.display = 'none';
  const hostsEl = document.getElementById('claude-terminal-hosts');
  if (hostsEl) hostsEl.appendChild(hostEl);

  const term = new window.Terminal({
    cursorBlink: true,
    fontSize: 11,
    fontFamily: 'ui-monospace, Consolas, "SFMono-Regular", Menlo, monospace',
    allowProposedApi: true,
    scrollback: 3000,
    overviewRulerLanes: 0,
    theme: {
      background:  '#1e1e1e',
      foreground:  '#d4d4d4',
      cursor:      '#d4d4d4',
      black:       '#1e1e1e',
      brightBlack: '#808080',
      white:       '#d4d4d4',
      brightWhite: '#ffffff',
    },
  });
  const fitAddon = new window.FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  // term.open() is deferred to _switchTab so xterm measures char sizes in a visible element
  return { term, fitAddon, hostEl };
}

// _addTab(type) — spawn a fresh PTY tab of the given type.
async function _addTab(type) {
  await _loadXterm();
  let tab; // forward-declared so ws/term closures can reference it after assignment

  const id  = _nextTabId++;
  const num = _nextClaudeNum++;
  const title = `Claude ${num}`;

  const { term, fitAddon, hostEl } = _makeTermEl();

  _wireMacShortcuts(term);
  _wireDragDrop(hostEl, () => tab);

  tab = { id, type, num, title, term, fitAddon, ws: null, hostEl, tabEl: null, needsAction: false, opened: false, ro: null };
  tab.ro = _wireResizeObserver(tab);
  _attachWs(tab, _wsUrlForType(type));

  _tabs.push(tab);
  _renderTabBar();
  _switchTab(id);
  return tab;
}

// _addReconnectTab(type, savedId) — reconnect an existing PTY as an additional tab
// (used when panel is already open but a second session needs restoring).
async function _addReconnectTab(type, savedId) {
  await _loadXterm();
  let tab;

  const id  = _nextTabId++;
  const num = _nextClaudeNum++;
  const title = `Claude ${num}`;

  const { term, fitAddon, hostEl } = _makeTermEl();

  _wireMacShortcuts(term);
  _wireDragDrop(hostEl, () => tab);

  tab = { id, type, num, title, term, fitAddon, ws: null, hostEl, tabEl: null, needsAction: false, opened: false, ro: null };
  tab.ro = _wireResizeObserver(tab);
  _attachWs(tab, _wsUrlForType(type, savedId));

  _tabs.push(tab);
  _renderTabBar();
  _switchTab(id);
  return tab;
}

// ResizeObserver that refits xterm whenever the host element's dimensions settle.
// This is the primary fix for Windows where setTimeout/rAF timing is insufficient
// to guarantee layout completion before fitAddon.fit() measures the container.
// ResizeObserver fires AFTER layout — no race condition possible.
function _wireResizeObserver(tab) {
  if (typeof ResizeObserver === 'undefined') return null;
  const ro = new ResizeObserver((entries) => {
    const entry = entries[0];
    // Skip when element is hidden (display:none → contentRect is 0×0).
    // Without this guard, switching tabs would call fit() on the outgoing
    // tab with zero dimensions, shrinking its xterm buffer to minimum size.
    if (!entry || entry.contentRect.width === 0 || entry.contentRect.height === 0) return;
    if (tab.fitAddon && _isOpen && !_isMinimized && tab.opened) {
      try { tab.fitAddon.fit(); } catch (_) {}
    }
  });
  ro.observe(tab.hostEl);
  return ro;
}

function _closeTab(id) {
  const idx = _tabs.findIndex(t => t.id === id);
  if (idx === -1) return;
  const tab = _tabs[idx];

  if (tab.ro) { try { tab.ro.disconnect(); } catch (_) {} tab.ro = null; }
  try {
    if (tab.ws)   tab.ws.close();
    // Null the reference: dispose() leaves the object in place, so a later
    // async writer (_writeTerminalUnavailable resolves after a fetch) would
    // otherwise write into a disposed xterm and log a console error.
    if (tab.term) { tab.term.dispose(); tab.term = null; }
  } catch (_) {}
  tab.hostEl.remove();
  _tabs.splice(idx, 1);

  if (_tabs.length === 0) {
    _closePanel();
    return;
  }

  if (_activeTabId === id) {
    const next = _tabs[Math.min(idx, _tabs.length - 1)];
    _renderTabBar();
    _switchTab(next.id);
  } else {
    _renderTabBar();
  }
}

function _switchTab(id) {
  const tab = _tabs.find(t => t.id === id);
  if (!tab) return;

  _tabs.forEach(t => { t.hostEl.style.display = 'none'; });
  tab.hostEl.style.display = 'block';
  _activeTabId = id;
  tab.needsAction = false;

  // Open the xterm.js terminal in the document on first activation.
  // Deferring until here (visible element) ensures char-size measurement is correct.
  if (!tab.opened) {
    // Read container dimensions BEFORE open() — this forces a synchronous reflow
    // that picks up any pending CSS changes (e.g. --minimized removal, height: 60vh).
    // We also pre-size the terminal so xterm NEVER opens at the 80×24 default,
    // which would be visually visible as a narrow flash before fit() corrects it.
    // Conservative estimates: 8px/col, 17px/row for 11px Consolas on Windows.
    const hostW = tab.hostEl.offsetWidth;
    const hostH = tab.hostEl.offsetHeight;
    if (hostW > 20 && hostH > 20) {
      try {
        tab.term.resize(
          Math.max(2,  Math.floor((hostW - 20) / 8)),
          Math.max(1,  Math.floor((hostH - 20) / 17))
        );
      } catch (_) {}
    }

    tab.term.open(tab.hostEl);
    tab.opened = true;

    // Exact fit with real font metrics (works when cell.width > 0 after open).
    try { tab.fitAddon.fit(); } catch (_) {}

    // onRender: guaranteed fit the moment xterm has measured actual cell sizes.
    // Catches Windows where cell.width may be 0 synchronously after open().
    const renderSub = tab.term.onRender(() => {
      renderSub.dispose();
      if (tab.fitAddon && _isOpen && !_isMinimized && tab.id === _activeTabId) {
        try { tab.fitAddon.fit(); tab.term.focus(); } catch (_) {}
      }
    });
  }

  _renderTabBar();

  // Belt-and-suspenders: fit after panel slide-in animation (250ms).
  setTimeout(() => {
    if (tab.fitAddon && _isOpen && !_isMinimized && tab.id === _activeTabId) {
      tab.fitAddon.fit();
    }
  }, 280);
}

function _renderTabBar() {
  const nav = document.getElementById('claude-terminal-tabs');
  if (!nav) return;
  nav.innerHTML = '';

  _tabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'claude-terminal-tab' +
      (tab.id === _activeTabId ? ' claude-terminal-tab--active'       : '') +
      (tab.needsAction         ? ' claude-terminal-tab--needs-action' : '');
    el.setAttribute('role', 'tab');
    el.setAttribute('tabindex', tab.id === _activeTabId ? '0' : '-1');
    el.setAttribute('aria-selected', String(tab.id === _activeTabId));
    el.dataset.tabId = tab.id;

    const titleEl       = document.createElement('span');
    titleEl.className   = 'claude-terminal-tab__title';
    titleEl.textContent = tab.title;

    const closeEl = document.createElement('button');
    closeEl.className = 'ds-icon-btn ds-icon-btn--sm claude-terminal-tab__close';
    closeEl.type      = 'button';
    closeEl.setAttribute('aria-label', `Close ${tab.title}`);
    closeEl.innerHTML = '&#x2715;';
    closeEl.addEventListener('click', (e) => { e.stopPropagation(); _closeTab(tab.id); });

    el.appendChild(titleEl);
    if (tab.needsAction) {
      const dot = document.createElement('span');
      dot.className = 'claude-terminal-tab__dot';
      dot.setAttribute('aria-hidden', 'true');
      el.appendChild(dot);
    }
    el.appendChild(closeEl);

    el.addEventListener('click', () => _switchTab(tab.id));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _switchTab(tab.id); }
    });

    tab.tabEl = el;
    nav.appendChild(el);
  });
}

function _updateTabEl(tab) {
  if (!tab.tabEl) { _renderTabBar(); return; }
  tab.tabEl.classList.toggle('claude-terminal-tab--needs-action', tab.needsAction);
  const existing = tab.tabEl.querySelector('.claude-terminal-tab__dot');
  if (tab.needsAction && !existing) {
    const dot = document.createElement('span');
    dot.className = 'claude-terminal-tab__dot';
    dot.setAttribute('aria-hidden', 'true');
    tab.tabEl.insertBefore(dot, tab.tabEl.querySelector('.claude-terminal-tab__close'));
  } else if (!tab.needsAction && existing) {
    existing.remove();
  }
}

// ── Panel open / close ─────────────────────────────────────────────────────────


// _open() — called from label-click when panel is closed; also from toggleUnifiedTerminal.
// On first open, probes sessionStorage for alive PTY sessions and reconnects them;
// falls back to a fresh claude tab.
function _open() {
  if (_isOpen) return;
  try { localStorage.removeItem(PANEL_CLOSED_KEY); } catch (_e) {}

  const panel = document.getElementById('claude-terminal-panel');
  if (!panel) return;

  if (_panelHeightPx > 0) {
    panel.style.height = _panelHeightPx + 'px';
  } else {
    panel.style.height = '';
  }

  panel.removeAttribute('hidden');
  panel.classList.remove('claude-terminal-panel--minimized');
  requestAnimationFrame(() => panel.classList.add('claude-terminal-panel--open'));

  _isOpen = true;
  _updateLabel();
  window.addEventListener('resize', _onWindowResize);

  // Check for a saved session to reconnect; otherwise spawn a fresh claude tab.
  let savedClaude;
  try {
    savedClaude = sessionStorage.getItem(STORAGE_KEY_CLAUDE);
  } catch (_e) { /* sessionStorage blocked -> fresh tab */ }

  if (savedClaude) {
    fetch('/api/claude-terminal/status?sessionId=' + encodeURIComponent(savedClaude), { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((body) => body && body.alive === true)
      .catch(() => false)
      .then((alive) => {
        if (alive) { _addReconnectTab('claude', savedClaude); return; }
        try { sessionStorage.removeItem(STORAGE_KEY_CLAUDE); } catch (_e) { /* ignore */ }
        _addTab('claude');
      });
  } else {
    _addTab('claude');
  }
}

function _closePanel() {
  _isOpen      = false;
  _isMinimized = false;

  // Remember that the user explicitly closed the panel so we don't auto-show on next load.
  try { localStorage.setItem(PANEL_CLOSED_KEY, '1'); } catch (_e) {}

  // Explicit close: send kill frame so the server destroys the PTY immediately
  // rather than waiting for the 30 s grace timer.  Clear sessionStorage so a subsequent
  // page reload does NOT auto-reconnect.
  _tabs.forEach(tab => {
    if (tab.ro) { try { tab.ro.disconnect(); } catch (_) {} tab.ro = null; }
    try {
      if (tab.ws && tab.ws.readyState === WebSocket.OPEN) {
        tab.ws.send(JSON.stringify({ type: 'kill' }));
      }
      if (tab.ws)   tab.ws.close();
      // Same reason as in _closeTab: a disposed term must not be writable.
      if (tab.term) { tab.term.dispose(); tab.term = null; }
    } catch (_) {}
    tab.hostEl.remove();
  });
  sessionStorage.removeItem(STORAGE_KEY_CLAUDE);
  _tabs        = [];
  _activeTabId = null;

  const nav = document.getElementById('claude-terminal-tabs');
  if (nav) nav.innerHTML = '';

  const panel = document.getElementById('claude-terminal-panel');
  if (panel) {
    panel.classList.remove('claude-terminal-panel--open', 'claude-terminal-panel--minimized');
    panel.setAttribute('hidden', '');
  }

  _updateMinimizeBtn(false);
  _updateLabel();
  window.removeEventListener('resize', _onWindowResize);
}

function _minimize() {
  if (!_isOpen || _isMinimized) return;
  _isMinimized = true;

  const panel = document.getElementById('claude-terminal-panel');
  if (panel) {
    _panelHeightPx = panel.getBoundingClientRect().height || _panelHeightPx;
    panel.classList.add('claude-terminal-panel--minimized');
  }
  _updateMinimizeBtn(true); _updateLabel();
}

function _restore() {
  if (!_isOpen || !_isMinimized) return;
  _isMinimized = false;
  try { localStorage.removeItem(PANEL_CLOSED_KEY); } catch (_e) {}

  const panel = document.getElementById('claude-terminal-panel');
  if (panel) {
    panel.classList.remove('claude-terminal-panel--minimized');
    if (_panelHeightPx > 0) panel.style.height = _panelHeightPx + 'px';
  }

  _updateMinimizeBtn(false);
  _updateLabel();

  if (_tabs.length === 0) {
    _addTab('claude'); // lazy first-tab spawn when restoring from auto-minimized header
  } else {
    requestAnimationFrame(() => requestAnimationFrame(() => _fitActive()));
  }
}

function _fitActive() {
  const tab = _tabs.find(t => t.id === _activeTabId);
  if (tab && tab.fitAddon && _isOpen && !_isMinimized) tab.fitAddon.fit();
}

function _updateMinimizeBtn(minimized) {
  const btn = document.getElementById('claude-terminal-minimize');
  if (!btn) return;
  btn.innerHTML = minimized ? '&#x25B2;' : '&#x25BC;';
  btn.setAttribute('aria-label', minimized ? 'Restore terminal' : 'Collapse terminal');
}

function _updateLabel() {
  const el = document.getElementById('claude-terminal-label-text');
  if (!el) return;
  el.textContent = (_isOpen && !_isMinimized) ? 'Hide terminal' : 'Open terminal';
}

// ── Drag-and-drop ─────────────────────────────────────────────────────────────

function _wireDragDrop(el, getTab) {
  el.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    const tab = getTab();
    if (!tab || !tab.ws || tab.ws.readyState !== WebSocket.OPEN) return;
    const uris = (e.dataTransfer.getData('text/uri-list') || '')
      .split('\n').map(u => u.trim()).filter(u => u.startsWith('file://'));
    if (!uris.length) return;
    const paths = uris.map(u => decodeURIComponent(u.replace('file://', '')));
    tab.ws.send(paths.join(' '));
  });
}

// ── Mac keyboard shortcuts ────────────────────────────────────────────────────

function _wireMacShortcuts(term) {
  const isMac = navigator.platform.toUpperCase().includes('MAC');
  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== 'keydown') return true;
    const meta = isMac ? e.metaKey : e.ctrlKey;
    const alt  = e.altKey;

    if (meta && (e.key === 'Backspace' || e.key === 'Delete')) { term.input('\x15', true); return false; }
    if (meta && e.key === 'ArrowLeft')  { term.input('\x01', true);  return false; }
    if (meta && e.key === 'ArrowRight') { term.input('\x05', true);  return false; }
    if (alt  && e.key === 'ArrowLeft')  { term.input('\x1bb', true); return false; }
    if (alt  && e.key === 'ArrowRight') { term.input('\x1bf', true); return false; }
    if (alt  && (e.key === 'Backspace' || e.key === 'Delete')) { term.input('\x17', true); return false; }
    return true;
  });
}

function _onWindowResize() {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(_fitActive, 50);
}
