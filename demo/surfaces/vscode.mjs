// demo/surfaces/vscode.mjs
// A Visual Studio Code (Dark+) mock: title bar, activity bar, explorer tree,
// editor tabs with a small tokenizer, and the integrated terminal where the
// Claude Code CLI runs. The terminal is an EDITOR TAB, the way the team works
// (`terminal.integrated.defaultLocation: "editor"`): a full-height editor
// group on the right, next to the file editor group, and no bottom panel.
// While no file is open the terminal group fills the whole editor area. On a
// split stage (half the width) only the group last written to is shown -
// `data-focus` on .vsc-groups. This surface mocks a FOREIGN UI, so it deliberately
// does not use DS components; its palette lives only as --vsc-* custom
// properties in demo/vscode.css.

import { appendLines } from './term.mjs';
import { markdownToHtml, previewLabel } from './markdown.mjs';

const ROOT_NAME = 'mission-deck';

/** The repository as a person sees it right after cloning. */
const INITIAL_TREE = [
  '.claude/', 'css/', 'data/', 'demo/', 'docs/', 'js/', 'modules/', 'plans/', 'scripts/',
  'templates/', 'tests/', 'user-data/',
  'CLAUDE.md', 'README.md', 'index.html', 'package.json', 'server.js', 'styles.css',
];

const KEYWORDS = new Set([
  'import', 'export', 'from', 'const', 'let', 'var', 'function', 'return', 'async', 'await',
  'if', 'else', 'for', 'of', 'in', 'new', 'default', 'true', 'false', 'null', 'undefined',
  'class', 'extends', 'type', 'interface', 'try', 'catch', 'finally', 'throw',
]);

const ICONS = {
  files: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  git: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="9" r="2"/><path d="M6 7v10M18 11c0 4-6 3-12 6"/></svg>',
  branch: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="7" r="2"/><path d="M6 7v10M18 9c0 5-12 3-12 8"/></svg>',
  term: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M12 15h5"/></svg>',
  preview: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="M8 9v6l2-2.5L12 15V9M16 9v6m-2-2 2 2 2-2"/></svg>',
  ext: '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="8" height="8"/><rect x="13" y="13" width="8" height="8"/><rect x="3" y="13" width="8" height="8"/><path d="M15 3h6v6h-6z"/></svg>',
};

function _esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Minimal tokenizer: comments, strings, numbers, keywords, punctuation. */
export function highlight(text, lang) {
  if (lang === 'md' || lang === 'txt') return _esc(text);
  const re = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|([{}()[\];,.:=<>+\-*/!?&|])/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    out += _esc(text.slice(last, m.index));
    const [tok, com, str, num, word, punc] = m;
    if (com && com.startsWith('#') && lang !== 'sh') {
      // '#' starts a comment only in shell; elsewhere it is one plain character.
      out += _esc('#');
      last = m.index + 1;
      re.lastIndex = last;
      continue;
    }
    if (com) out += `<span class="vsc-tok-com">${_esc(tok)}</span>`;
    else if (str) out += `<span class="vsc-tok-str">${_esc(tok)}</span>`;
    else if (num) out += `<span class="vsc-tok-num">${_esc(tok)}</span>`;
    else if (word) out += KEYWORDS.has(word) ? `<span class="vsc-tok-kw">${_esc(tok)}</span>` : _esc(tok);
    else if (punc) out += `<span class="vsc-tok-punc">${_esc(tok)}</span>`;
    last = m.index + tok.length;
  }
  return out + _esc(text.slice(last));
}

/** The language name VS Code prints in its status bar. */
const LANG_LABEL = { js: 'JavaScript', json: 'JSON', md: 'Markdown', sh: 'Shell Script', txt: 'Plain Text' };

function _langOf(file) {
  const ext = (file.split('.').pop() || '').toLowerCase();
  if (['js', 'mjs', 'ts', 'tsx', 'jsx'].includes(ext)) return 'js';
  if (ext === 'json') return 'json';
  if (ext === 'md') return 'md';
  if (ext === 'sh') return 'sh';
  return 'txt';
}

/**
 * @param {{ root: HTMLElement }} opts the #demo-vscode element
 */
export function createVscodeSurface({ root }) {
  let paths = null;
  let expanded = null;
  let fresh = null;
  let tabs = null;
  let active = null;
  let claudeOn = false;

  const $ = (sel) => root.querySelector(sel);

  function _build() {
    root.innerHTML = `
      <div class="vsc-titlebar"><span class="vsc-lights" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="vsc-title">${ROOT_NAME} — Visual Studio Code</span></div>
      <div class="vsc-body">
        <nav class="vsc-activity" aria-hidden="true">
          <span class="vsc-act vsc-act--on">${ICONS.files}</span><span class="vsc-act">${ICONS.search}</span>
          <span class="vsc-act">${ICONS.git}</span><span class="vsc-act">${ICONS.ext}</span>
        </nav>
        <aside class="vsc-explorer">
          <div class="vsc-pane-title">EKSPLORATOR</div>
          <div class="vsc-root-title">${ROOT_NAME.toUpperCase()}</div>
          <div class="vsc-tree" id="demo-vsc-tree"></div>
        </aside>
        <section class="vsc-main">
          <div class="vsc-groups" id="demo-vsc-groups" data-files="0" data-focus="term">
            <div class="vsc-group vsc-group--files">
              <div class="vsc-tabs" id="demo-vsc-tabs"></div>
              <div class="vsc-editor" id="demo-vsc-editor"><div class="vsc-welcome">Open a file in the explorer to edit it.</div></div>
            </div>
            <div class="vsc-group vsc-group--term" id="demo-vsc-term-group">
              <div class="vsc-tabs vsc-tabs--term"><div class="vsc-tab vsc-tab--on vsc-tab--term">${ICONS.term}<span id="demo-vsc-term-label">zsh</span></div></div>
              <div class="vsc-terminal demo-term" id="demo-vsc-terminal"></div>
            </div>
          </div>
        </section>
      </div>
      <footer class="vsc-statusbar"><span class="vsc-branch">${ICONS.branch}<span>main</span></span><span id="demo-vsc-status-file"></span></footer>`;
  }

  /** Status bar: encoding, line ends and language only while a file is open (VS Code shows nothing else). */
  function _renderStatus() {
    const slot = $('#demo-vsc-status-file');
    if (!slot) return;
    // A Markdown preview tab has no encoding or language in VS Code's status bar.
    slot.innerHTML = active && _langOf(active) !== 'md' ? `<span>UTF-8</span><span>LF</span><span>${_esc(LANG_LABEL[_langOf(active)])}</span>` : '';
  }

  function _isDir(p) { return p.endsWith('/'); }
  function _parent(p) {
    const trimmed = _isDir(p) ? p.slice(0, -1) : p;
    const i = trimmed.lastIndexOf('/');
    return i < 0 ? '' : trimmed.slice(0, i + 1);
  }
  function _name(p) {
    const trimmed = _isDir(p) ? p.slice(0, -1) : p;
    return trimmed.slice(trimmed.lastIndexOf('/') + 1);
  }

  function _addPath(p) {
    let cur = p;
    while (cur) {
      paths.add(cur);
      const parent = _parent(cur);
      if (parent) expanded.add(parent);
      cur = parent;
    }
  }

  function _renderTree() {
    const tree = $('#demo-vsc-tree');
    // No folder open yet (before `git clone`): VS Code's empty explorer.
    $('.vsc-root-title').hidden = paths.size === 0;
    $('.vsc-title').textContent = paths.size === 0 ? 'Visual Studio Code' : ROOT_NAME + ' — Visual Studio Code';
    if (paths.size === 0) {
      tree.innerHTML = '<div class="vsc-empty">You have not yet opened a folder.</div>';
      return;
    }
    const kids = (dir) => [...paths].filter((p) => _parent(p) === dir)
      .sort((a, b) => (_isDir(b) - _isDir(a)) || _name(a).localeCompare(_name(b)));
    const rows = [];
    const walk = (dir, depth) => {
      for (const p of kids(dir)) {
        const dirRow = _isDir(p);
        const open = expanded.has(p);
        rows.push(`<div class="vsc-node${dirRow ? ' vsc-node--dir' : ''}${p === active ? ' vsc-node--active' : ''}${fresh.has(p) ? ' vsc-node--new' : ''}" data-vsc-path="${_esc(p)}" style="--vsc-depth:${depth}">`
          + `<span class="vsc-twisty">${dirRow ? (open ? '▾' : '▸') : ''}</span><span class="vsc-name">${_esc(_name(p))}</span></div>`);
        if (dirRow && open) walk(p, depth + 1);
      }
    };
    walk('', 0);
    tree.innerHTML = rows.join('');
  }

  function _renderTabs() {
    // Two tabs with the same file name get their folder as a dim hint, like VS Code.
    const count = (n) => tabs.filter((t) => _name(t.file) === n).length;
    $('#demo-vsc-tabs').innerHTML = tabs.map((t) => {
      const n = _name(t.file);
      const hint = count(n) > 1 ? `<span class="vsc-tab-hint">${_esc(_name(_parent(t.file)))}</span>` : '';
      // A Markdown file is always shown as its rendered preview ("Open Preview").
      const md = _langOf(t.file) === 'md';
      const label = md ? `${ICONS.preview}<span>${_esc(previewLabel(t.file))}</span>` : _esc(n);
      return `<div class="vsc-tab${md ? ' vsc-tab--md' : ''}${t.file === active ? ' vsc-tab--on' : ''}" data-vsc-tab="${_esc(t.file)}">${label}${hint}</div>`;
    }).join('');
    // No file open: the file group closes and the terminal group fills the editor area.
    const groups = $('#demo-vsc-groups');
    const files = tabs.length ? '1' : '0';
    if (groups.dataset.files !== files) {
      groups.dataset.files = files;
      // The terminal just got narrower or wider: its lines re-wrap, so pin
      // the newest one to the bottom again.
      const term = $('#demo-vsc-terminal');
      term.scrollTop = term.scrollHeight;
    }
    _renderStatus();
  }

  function _renderEditor(text, file, live) {
    if (_langOf(file) === 'md') {
      // VS Code's Markdown preview: the document rendered, never raw markdown.
      const editor = $('#demo-vsc-editor');
      const prev = editor.querySelector('.vsc-md-scroll');
      const top = prev ? prev.scrollTop : 0;
      editor.innerHTML = `<div class="vsc-md-scroll" id="demo-vsc-md-files"><article class="vsc-md-body" id="demo-vsc-md-files-body">${markdownToHtml(text)}<span class="vsc-caret vsc-md-end" aria-hidden="true"></span></article></div>`;
      const box = editor.firstElementChild;
      // While Claude writes the file the newest lines stay in sight.
      box.scrollTop = live ? box.scrollHeight : top;
      return;
    }
    const lines = text.split('\n');
    const gutter = lines.map((_, i) => i + 1).join('\n');
    const body = live ? _esc(text) : highlight(text, _langOf(file));
    $('#demo-vsc-editor').innerHTML = `<pre class="vsc-gutter" aria-hidden="true">${gutter}</pre><pre class="vsc-code">${body}<span class="vsc-caret"></span></pre>`;
  }

  /**
   * "Open Preview" in the terminal group: a second, active tab and the
   * rendered document in the group's body row (the terminal tab stays,
   * hidden behind it). In flow, not an overlay: it cannot drift off the group.
   */
  function _openTermPreview(file, text) {
    _closeTermPreview();
    const group = $('#demo-vsc-term-group');
    const bar = group.querySelector('.vsc-tabs--term');
    bar.querySelector('.vsc-tab--term').classList.remove('vsc-tab--on');
    bar.insertAdjacentHTML('beforeend', `<div class="vsc-tab vsc-tab--on vsc-tab--md" id="demo-vsc-md-term-tab">${ICONS.preview}<span>${_esc(previewLabel(file))}</span></div>`);
    group.insertAdjacentHTML('beforeend', `<div class="vsc-md-scroll vsc-md-pane" id="demo-vsc-md-term"><article class="vsc-md-body" id="demo-vsc-md-term-body">${markdownToHtml(text)}</article></div>`);
    group.dataset.preview = '1';
  }

  function _closeTermPreview() {
    const group = $('#demo-vsc-term-group');
    if (!group || group.dataset.preview !== '1') return;
    group.querySelector('#demo-vsc-md-term-tab')?.remove();
    group.querySelector('#demo-vsc-md-term')?.remove();
    group.querySelector('.vsc-tab--term').classList.add('vsc-tab--on');
    delete group.dataset.preview;
    const term = $('#demo-vsc-terminal');
    term.scrollTop = term.scrollHeight;
  }

  /** Which group was written to last: the only one shown on a split stage. */
  function _focus(group) { $('#demo-vsc-groups').dataset.focus = group; }

  /** The terminal tab names the process in it, like VS Code: the shell, then Claude Code. */
  function _renderTermLabel(lines) {
    if (lines && lines.some((l) => l.role === 'claude' || l.role === 'user')) claudeOn = true;
    const label = $('#demo-vsc-term-label');
    if (label) label.textContent = (claudeOn ? 'claude' : 'zsh') + (paths.size ? ' — ' + ROOT_NAME : '');
  }

  return {
    id: 'vscode',
    el: root,

    reset() {
      _build();
      paths = new Set(INITIAL_TREE);
      expanded = new Set();
      fresh = new Set();
      tabs = [];
      active = null;
      claudeOn = false;
      _renderTree();
      _renderTabs();
      _renderTermLabel(null);
    },

    /** Selector for a tree row, for cursor moves. */
    nodeSelector(p) { return `[data-vsc-path="${p}"]`; },

    terminalEl() {
      _focus('term');
      return $('#demo-vsc-terminal');
    },

    handlers: {
      /**
     * { add?: [path], open?: path, empty?: true, reset?: true } - new rows
     * appear with a short highlight; `empty` shows the explorer with no folder
     * open (before a clone), `reset` brings back the freshly cloned tree.
     */
      async explorer(a, ctx) {
        if (a.empty) {
          paths = new Set();
          expanded = new Set();
          _renderTree();
          _renderTermLabel(null);
        }
        if (a.reset) {
          paths = new Set(INITIAL_TREE);
          fresh = new Set(INITIAL_TREE);
          _renderTree();
          _renderTermLabel(null);
          await ctx.sleep(450);
        }
        if (a.add) {
          fresh = new Set(a.add);
          for (const p of a.add) _addPath(p);
          _renderTree();
          await ctx.sleep(450);
        }
        if (a.open) {
          _addPath(a.open);
          _renderTree();
          const row = $(`[data-vsc-path="${a.open}"]`);
          await ctx.point(row);
          active = a.open;
          _focus('files');
          if (!tabs.some((t) => t.file === a.open)) tabs.push({ file: a.open, text: '' });
          _renderTree();
          _renderTabs();
          _renderEditor(tabs.find((t) => t.file === a.open).text, a.open, false);
        }
      },

      /**
       * { file, text, mode? } - opens the tab (clicking the tree row) and types
       * the content. mode 'append' (default) adds to what the tab holds,
       * 'replace' rewrites the whole tab (a file regenerated or overwritten).
       * A .md file shows as its Markdown preview. { file, text, group: 'term' }
       * opens that preview as a tab of the terminal group; { group: 'term',
       * close: true } closes it and the terminal tab is active again.
       */
      async editor(a, ctx) {
        if (a.group === 'term') {
          _focus('term');
          if (a.close) _closeTermPreview();
          else _openTermPreview(a.file, a.text);
          await ctx.sleep(a.close ? 120 : 300);
          return;
        }
        _addPath(a.file);
        _renderTree();
        _focus('files');
        if (active !== a.file) {
          const row = $(`[data-vsc-path="${a.file}"]`);
          await ctx.point(row);
          active = a.file;
          if (!tabs.some((t) => t.file === a.file)) tabs.push({ file: a.file, text: '' });
          _renderTree();
          _renderTabs();
        }
        const tab = tabs.find((t) => t.file === a.file);
        const base = a.mode === 'replace' ? '' : tab.text;
        if (ctx.animate) {
          const step = Math.max(1, Math.ceil(a.text.length / 220));
          for (let i = 0; i < a.text.length; i += step) {
            _renderEditor(base + a.text.slice(0, i + step), a.file, true);
            await ctx.sleep(16);
          }
        }
        tab.text = base + a.text;
        _renderEditor(tab.text, a.file, false);
      },

      /** { lines } - appended to the terminal editor tab, typed roles typed. */
      async terminal(a, ctx) {
        _focus('term');
        _renderTermLabel(a.lines);
        const term = $('#demo-vsc-terminal');
        await ctx.point(term, { hover: false });
        await appendLines(term, a.lines, ctx);
      },
    },
  };
}
