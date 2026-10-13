'use strict';
// scripts/_report.js
// Shared plumbing for the cockpit automation scripts (plan-preflight,
// check-conventions, diff-digest, gates, plan-status, gen-repo-map, new-view,
// new-endpoint).
//
// Exports:
//   SEV / SIZE_*            - severity constants and the one change-size threshold
//   parseArgs               - tiny long-flag parser (--k v, --k=v, --flag)
//   Report                  - finding collector -> text or --json, exit-code mapping
//   usageError / fail       - exit 2 with a clear message
//   git / gitOk             - execFileSync wrappers that never throw
//   resolveScope            - diff scope resolution with graceful degradation
//   parseUnifiedDiff        - unified diff -> per-file added/removed lines
//   isCosmeticFile          - whitespace/comment-only change detector
//   nonAsciiFindings        - calibrated non-ASCII scanner (repo banner aware)
//   isPolishLetter          - true for a Polish diacritic letter
//   codeSpanRanges          - column ranges covered by markdown inline code
//
// ASCII-only source: any non-ASCII character this file needs is written as a
// \uXXXX escape so the file itself stays plain ASCII.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const SEV = { BLOCK: 'BLOCK', WARN: 'WARN', NOTE: 'NOTE' };
const SEV_ORDER = { BLOCK: 0, WARN: 1, NOTE: 2 };

// ---------------------------------------------------------------------------
// Change-size threshold. ONE definition. Consumed by diff-digest (size_class,
// bug_scan_recommended), by /new-idea Phase 6.7 (whether the bug scan runs) and
// by the model tiering (haiku below, sonnet above). They cannot drift.
//
// The file count is 6, not 4, deliberately: a `new-view.js` scaffold touches
// five files (index.html, the module, the registry, the flyout config, the
// test) and that is the single most common task in this repo. A threshold of 4
// would classify the canonical change as "large" and the conditional bug scan
// would never actually be conditional.
// ---------------------------------------------------------------------------
const SIZE_MAX_LINES = 150;
const SIZE_MAX_FILES = 6;

// Two vocabularies, deliberately both exported:
//   *_DASHED - .claude/default-models.json and agent frontmatter; validated by
//              AGENT_MODEL_ALLOWLIST in server.js and MODEL_ALLOWLIST in
//              js/settings-modele.js, restored by the pre-commit hook.
//   *_ALIAS  - the Agent tool's `model` parameter, whose enum is
//              sonnet | opus | haiku | fable. A dashed id there throws.
const TIER_SMALL_DASHED = 'claude-haiku-5-5';
const TIER_LARGE_DASHED = 'claude-sonnet-5-5';
const TIER_SMALL_ALIAS = 'haiku';
const TIER_LARGE_ALIAS = 'sonnet';

const CANONICAL_PORT = 3001;

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

/**
 * Minimal long-flag parser. `--k v`, `--k=v`, `--flag` (when listed in
 * `booleans`), everything else is a positional.
 * @param {string[]} argv raw argv slice (no node/script)
 * @param {{booleans?: string[]}} [spec]
 * @returns {{flags: Object, positionals: string[]}}
 */
function parseArgs(argv, spec) {
  const booleans = new Set((spec && spec.booleans) || []);
  booleans.add('json');
  booleans.add('help');
  const flags = Object.create(null);
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { positionals.push(...argv.slice(i + 1)); break; }
    if (!a.startsWith('--')) { positionals.push(a); continue; }
    const eq = a.indexOf('=');
    const key = (eq === -1 ? a.slice(2) : a.slice(2, eq));
    if (eq !== -1) { flags[key] = a.slice(eq + 1); continue; }
    if (booleans.has(key)) { flags[key] = true; continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { flags[key] = true; continue; }
    flags[key] = next;
    i++;
  }
  return { flags, positionals };
}

/** Print `msg` to stderr and exit 2 (usage / internal error). */
function usageError(msg) {
  process.stderr.write('error: ' + msg + '\n');
  process.exit(2);
}

/** Print `msg` and exit 2. Alias kept for readability at call sites. */
function fail(msg) { usageError(msg); }

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

class Report {
  /**
   * @param {string} name script name, echoed into the JSON envelope
   * @param {object} [meta] extra fields for the JSON envelope
   */
  constructor(name, meta) {
    this.name = name;
    this.meta = Object.assign({}, meta || {});
    this.findings = [];
    this.notes = [];
  }

  /** Free-form informational line (never affects the exit code). */
  info(line) { this.notes.push(String(line)); return this; }

  /**
   * @param {string} severity SEV.BLOCK | SEV.WARN | SEV.NOTE
   * @param {{rule?: string|number, file?: string, line?: number, message: string, fix?: string}} f
   */
  add(severity, f) {
    this.findings.push({
      severity,
      rule: f.rule === undefined ? null : String(f.rule),
      file: f.file || null,
      line: f.line === undefined || f.line === null ? null : Number(f.line),
      message: f.message,
      fix: f.fix || null,
    });
    return this;
  }

  block(f) { return this.add(SEV.BLOCK, f); }
  warn(f) { return this.add(SEV.WARN, f); }
  note(f) { return this.add(SEV.NOTE, f); }

  counts() {
    const c = { BLOCK: 0, WARN: 0, NOTE: 0 };
    for (const f of this.findings) c[f.severity]++;
    return c;
  }

  verdict() {
    const c = this.counts();
    if (c.BLOCK > 0) return 'BLOCK';
    if (c.WARN > 0) return 'PASS-WITH-WARNINGS';
    return 'PASS';
  }

  exitCode() { return this.counts().BLOCK > 0 ? 1 : 0; }

  sorted() {
    return this.findings.slice().sort((a, b) => {
      const s = SEV_ORDER[a.severity] - SEV_ORDER[b.severity];
      if (s !== 0) return s;
      const fa = a.file || '';
      const fb = b.file || '';
      if (fa !== fb) return fa < fb ? -1 : 1;
      return (a.line || 0) - (b.line || 0);
    });
  }

  toJSON() {
    return Object.assign({
      script: this.name,
      verdict: this.verdict(),
      counts: this.counts(),
      findings: this.sorted(),
      notes: this.notes,
    }, this.meta);
  }

  /** Human-readable report in the guardian's BLOCK/WARN/NOTE + VERDICT shape. */
  renderText(title) {
    const out = [];
    const c = this.counts();
    out.push((title || this.name.toUpperCase()) + ' VERDICT: ' + this.verdict());
    for (const [k, v] of Object.entries(this.meta)) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'object') continue;
      out.push(k + ': ' + v);
    }
    for (const n of this.notes) out.push(n);
    out.push('');
    for (const sev of [SEV.BLOCK, SEV.WARN, SEV.NOTE]) {
      const band = this.sorted().filter((f) => f.severity === sev);
      if (band.length === 0) continue;
      out.push(sev + ' (' + band.length + ')');
      for (const f of band) {
        const loc = f.file ? f.file + (f.line ? ':' + f.line : '') : (f.line ? 'line ' + f.line : '');
        const rule = f.rule ? '[' + f.rule + '] ' : '';
        out.push('- ' + rule + (loc ? loc + ' - ' : '') + f.message);
        if (f.fix) out.push('  Fix: ' + f.fix);
      }
      out.push('');
    }
    if (c.BLOCK + c.WARN + c.NOTE === 0) out.push('No findings.');
    return out.join('\n').replace(/\n*$/, '\n');
  }

  /** Print (json or text) and exit with the mapped code. */
  emit(flags, title) {
    if (flags && flags.json) process.stdout.write(JSON.stringify(this.toJSON(), null, 2) + '\n');
    else process.stdout.write(this.renderText(title));
    // exitCode, not process.exit(): with stdout on a PIPE the write is async, and an
    // immediate exit cut a 167 KB --json report at 64 KB (runner DS baseline, 2026-10-08).
    process.exitCode = this.exitCode();
  }
}

// ---------------------------------------------------------------------------
// git helpers - never throw
// ---------------------------------------------------------------------------

function git(args, opts) {
  try {
    return execFileSync('git', ['-C', (opts && opts.cwd) || ROOT].concat(args), {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (_e) {
    return null;
  }
}

function gitOk(args, opts) { return git(args, opts) !== null; }

// ---------------------------------------------------------------------------
// Diff scope resolution
// ---------------------------------------------------------------------------

/**
 * Resolve which change set the script should look at, degrading gracefully:
 *   --diff-file  -> that unified diff
 *   --files      -> those files, whole content treated as added
 *   --staged     -> git diff --staged
 *   --base <ref> -> git diff <ref>...HEAD (falls through when the ref is unknown)
 *   HEAD exists  -> git diff HEAD (working tree)
 *   otherwise    -> no-baseline: nothing to compare against
 * @param {object} flags parsed flags
 * @returns {{mode: string, diffText: string, files: object[], degraded: boolean, reason: string|null}}
 */
function resolveScope(flags, opts) {
  const root = (opts && opts.root) || ROOT;
  const emptyFiles = [];

  if (flags['diff-file']) {
    let text;
    try { text = fs.readFileSync(flags['diff-file'], 'utf8'); } catch (e) {
      usageError('cannot read --diff-file ' + flags['diff-file'] + ': ' + e.message);
    }
    return { mode: 'diff-file', diffText: text, files: parseUnifiedDiff(text), degraded: false, reason: null };
  }

  if (flags.files) {
    const list = String(flags.files).split(',').map((s) => s.trim()).filter(Boolean);
    const files = [];
    for (const rel of list) {
      const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
      let content = '';
      try { content = fs.readFileSync(abs, 'utf8'); } catch (_e) { content = ''; }
      const lines = content.split('\n');
      files.push({
        path: path.isAbsolute(rel) ? path.relative(root, abs) : rel,
        status: 'M',
        added: lines.map((text, i) => ({ line: i + 1, text })),
        removed: [],
        addedCount: lines.length,
        removedCount: 0,
      });
    }
    return { mode: 'files', diffText: '', files, degraded: false, reason: null };
  }

  const hasHead = gitOk(['rev-parse', '--verify', 'HEAD'], { cwd: root });

  if (flags.staged) {
    const text = git(['diff', '--staged'], { cwd: root });
    if (text !== null) return { mode: 'staged', diffText: text, files: parseUnifiedDiff(text), degraded: false, reason: null };
  }

  const base = flags.base;
  if (base) {
    const resolved = git(['rev-parse', '--verify', String(base)], { cwd: root });
    if (resolved && hasHead) {
      // Two-dot: base vs the WORKING TREE, in one pass. Combining
      // `<base>...HEAD` with `HEAD` would emit two diff blocks for any file
      // changed both in a commit and in the working tree, double-counting it.
      const text = git(['diff', String(base)], { cwd: root });
      if (text !== null) {
        return { mode: 'base:' + base, diffText: text, files: parseUnifiedDiff(text), degraded: false, reason: null };
      }
    }
  }

  if (hasHead) {
    const text = git(['diff', 'HEAD'], { cwd: root });
    if (text !== null) {
      return {
        mode: 'worktree',
        diffText: text,
        files: parseUnifiedDiff(text),
        degraded: Boolean(base),
        reason: base ? 'base ref "' + base + '" is not resolvable; fell back to the working tree vs HEAD' : null,
      };
    }
  }

  return {
    mode: 'no-baseline',
    diffText: '',
    files: emptyFiles,
    degraded: true,
    reason: 'this repository has no commit to diff against; pass --files a,b or --diff-file <path>',
  };
}

// ---------------------------------------------------------------------------
// Unified diff parsing
// ---------------------------------------------------------------------------

/**
 * Parse a unified diff into per-file added/removed line records.
 * Added lines carry their line number in the post-image; removed lines carry
 * their line number in the pre-image.
 * @param {string} text
 * @returns {Array<{path:string,status:string,added:object[],removed:object[],addedCount:number,removedCount:number}>}
 */
function parseUnifiedDiff(text) {
  const files = [];
  if (!text) return files;
  const lines = String(text).split('\n');
  let cur = null;
  let newNo = 0;
  let oldNo = 0;

  const byPath = new Map();
  // One record per path, even if the diff text carries the same file twice.
  const push = () => {
    if (!cur) return;
    const prev = byPath.get(cur.path);
    if (prev) {
      prev.added.push(...cur.added);
      prev.removed.push(...cur.removed);
      prev.addedCount += cur.addedCount;
      prev.removedCount += cur.removedCount;
      if (prev.status === 'M' && cur.status !== 'M') prev.status = cur.status;
      return;
    }
    byPath.set(cur.path, cur);
    files.push(cur);
  };

  for (const raw of lines) {
    if (raw.startsWith('diff --git ')) {
      push();
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw);
      cur = {
        path: m ? m[2] : raw.slice('diff --git '.length),
        status: 'M',
        added: [],
        removed: [],
        addedCount: 0,
        removedCount: 0,
      };
      newNo = 0; oldNo = 0;
      continue;
    }
    if (!cur) continue;
    if (raw.startsWith('new file mode')) { cur.status = 'A'; continue; }
    if (raw.startsWith('deleted file mode')) { cur.status = 'D'; continue; }
    if (raw.startsWith('rename to ')) { cur.status = 'R'; cur.path = raw.slice('rename to '.length); continue; }
    if (raw.startsWith('+++ ')) {
      const p = raw.slice(4).trim();
      if (p !== '/dev/null' && p.startsWith('b/')) cur.path = p.slice(2);
      continue;
    }
    if (raw.startsWith('--- ')) continue;
    if (raw.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (m) { oldNo = parseInt(m[1], 10); newNo = parseInt(m[2], 10); }
      continue;
    }
    if (raw.startsWith('+')) {
      cur.added.push({ line: newNo, text: raw.slice(1) });
      cur.addedCount++;
      newNo++;
      continue;
    }
    if (raw.startsWith('-')) {
      cur.removed.push({ line: oldNo, text: raw.slice(1) });
      cur.removedCount++;
      oldNo++;
      continue;
    }
    if (raw.startsWith(' ')) { newNo++; oldNo++; continue; }
    // "\\ No newline at end of file", index lines, binary markers: ignored.
  }
  push();
  return files;
}

const COMMENT_RE = /^\s*(\/\/|\/\*|\*|#|<!--|-->|\*\/)/;

/** True when every added and removed line is blank or a comment. */
function isCosmeticFile(file) {
  const all = file.added.concat(file.removed);
  if (all.length === 0) return true;
  return all.every((l) => l.text.trim() === '' || COMMENT_RE.test(l.text));
}

// ---------------------------------------------------------------------------
// Non-ASCII scanning, calibrated against this repo
// ---------------------------------------------------------------------------
//
// The repo's own module banners are `// ── Mission Deck — js/x.js ──`
// and the UI copy lives in string literals. A naive "non-ASCII =
// violation" rule fires on every file in the tree. So:
//   * typographic punctuation and box drawing are always legal
//   * anything inside a quoted string / HTML text node / HTML attribute value is legal
//   * everything else (identifiers, comment prose, code outside strings) is a finding

const TYPOGRAPHIC = (() => {
  const ok = new Set();
  for (let c = 0x2500; c <= 0x257f; c++) ok.add(c); // box drawing
  for (let c = 0x2010; c <= 0x2015; c++) ok.add(c); // hyphens and dashes
  for (let c = 0x2018; c <= 0x201f; c++) ok.add(c); // curly quotes
  [0x2026, 0x00b7, 0x2022, 0x2192, 0x2190, 0x00d7, 0x2713, 0x2717, 0x00ab, 0x00bb,
    0x2264, 0x2265, 0x2248, 0x00b0, 0x00a9, 0x00ae, 0x2122].forEach((c) => ok.add(c));
  return ok;
})();

/**
 * Column indexes covered by a quoted string on this line.
 * `quotes` defaults to the JS/JSON set; markdown passes only ' and " because a
 * backtick there delimits CODE, where non-ASCII is exactly what we want to flag.
 */
function _quotedRanges(text, quotes) {
  const q = quotes || '"\'`';
  const ranges = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (q.indexOf(ch) !== -1) {
      const start = i;
      i++;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === ch) break;
        i++;
      }
      ranges.push([start, Math.min(i, text.length - 1)]);
      i++;
      continue;
    }
    i++;
  }
  return ranges;
}

/** Column indexes covered by HTML text nodes or attribute values. */
function _htmlLegalRanges(text) {
  const ranges = _quotedRanges(text);
  // A text node continued from the previous line: everything before the first tag.
  const firstLt = text.indexOf('<');
  if (firstLt > 0) ranges.push([0, firstLt - 1]);
  // Text nodes: anything after `>` up to the next `<`.
  let i = 0;
  while (i < text.length) {
    const gt = text.indexOf('>', i);
    if (gt === -1) break;
    const lt = text.indexOf('<', gt + 1);
    ranges.push([gt + 1, lt === -1 ? text.length : lt - 1]);
    i = lt === -1 ? text.length : lt + 1;
  }
  // A line with no tag at all is plain text.
  if (text.indexOf('<') === -1 && text.indexOf('>') === -1) ranges.push([0, text.length]);
  return ranges;
}

function _inRanges(col, ranges) {
  for (const [a, b] of ranges) if (col >= a && col <= b) return true;
  return false;
}

/**
 * Column ranges of REGEX literals on one JS line. A pattern that matches
 * UI copy - /caf\u00e9 cr\u00e8me/ in a test - is the
 * string it asserts on, not bare code. Reuses the lexer heuristic of
 * _startsRegex; a `/` inside a quoted range is never a candidate, and a
 * comment opener ends the scan so a non-ASCII comment after the code still
 * reports.
 * @param {string} text the line
 * @param {Array<[number, number]>} quoted ranges from _quotedRanges
 * @returns {Array<[number, number]>}
 */
function _regexLiteralRanges(text, quoted) {
  const ranges = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '/' || _inRanges(i, quoted)) { i++; continue; }
    const next = text[i + 1];
    if (next === '/' || next === '*') break;
    if (!_startsRegex(text, i)) { i++; continue; }
    const start = i;
    i++;
    let inClass = false;
    let closed = false;
    while (i < text.length) {
      const c = text[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) { closed = true; break; }
      i++;
    }
    if (!closed) break;
    ranges.push([start, i]);
    i++;
  }
  return ranges;
}

/**
 * The Polish alphabet's diacritic letters, as \uXXXX escapes so this file stays
 * plain ASCII. User-visible copy MUST use them; identifiers, paths and keys
 * must not - see `.claude/agents/references/cockpit-conventions.md` section 1.
 */
const POLISH_LETTERS = new Set([
  '\u0105', '\u0107', '\u0119', '\u0142', '\u0144', '\u00f3', '\u015b', '\u017a', '\u017c',
  '\u0104', '\u0106', '\u0118', '\u0141', '\u0143', '\u00d3', '\u015a', '\u0179', '\u017b',
]);

/**
 * Strip Polish diacritics down to their ASCII skeleton, so an ASCII keyword list
 * still matches copy that is now written properly (`modul` finds `modu\u0142`).
 * Only for MATCHING - never write the folded text back to a file.
 */
const FOLD = {
  '\u0105': 'a', '\u0107': 'c', '\u0119': 'e', '\u0142': 'l', '\u0144': 'n',
  '\u00f3': 'o', '\u015b': 's', '\u017a': 'z', '\u017c': 'z',
  '\u0104': 'A', '\u0106': 'C', '\u0118': 'E', '\u0141': 'L', '\u0143': 'N',
  '\u00d3': 'O', '\u015a': 'S', '\u0179': 'Z', '\u017b': 'Z',
};
const FOLD_RE = new RegExp('[' + Object.keys(FOLD).join('') + ']', 'g');

function foldPolish(text) {
  return String(text).replace(FOLD_RE, (c) => FOLD[c]);
}

/** True when `ch` is one of the nine Polish diacritic letters (either case). */
function isPolishLetter(ch) {
  return POLISH_LETTERS.has(ch);
}

/**
 * Column ranges covered by markdown inline code (backtick spans) on this line.
 * Used to tell a proposed identifier from prose: Polish letters are legal in
 * plan prose, never inside a code span.
 */
function codeSpanRanges(text) {
  const ranges = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] === '`') {
      const start = i;
      i++;
      while (i < text.length && text[i] !== '`') i++;
      ranges.push([start, Math.min(i, text.length - 1)]);
      i++;
      continue;
    }
    i++;
  }
  return ranges;
}

/**
 * Column ranges of template-literal STRING content, per 1-based line number.
 *
 * `_quotedRanges` works one line at a time, so the middle lines of a multi-line
 * template literal look like bare code to it - and that is exactly where the
 * app's UI copy lives. This walks the whole source instead, skipping
 * comments and `${...}` expression holes (an identifier there is still code).
 *
 * @param {string} source the whole file
 * @returns {Map<number, Array<[number, number]>>} line -> zero-based col ranges
 */
// Tokens after which a `/` starts a REGEX literal rather than a division. The
// classic JS lexer ambiguity; this is the standard "previous meaningful token"
// heuristic, which is exact for everything this repo writes.
const _REGEX_PRECEDERS = new Set([
  '=', '(', ',', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%',
  '^', '~', '<', '>', '\n',
]);
const _REGEX_PRECEDING_WORDS = /\b(return|typeof|instanceof|in|of|new|delete|void|do|else|case|yield|await)$/;

/**
 * Would a `/` at `idx` open a regex literal? Looks back at the previous
 * non-whitespace character (or keyword).
 * @param {string} src @param {number} idx index of the '/'
 * @returns {boolean}
 */
function _startsRegex(src, idx) {
  let j = idx - 1;
  while (j >= 0 && /\s/.test(src[j])) j--;
  if (j < 0) return true;
  const prev = src[j];
  if (_REGEX_PRECEDERS.has(prev)) return true;
  // A keyword can precede a regex; an identifier or a closing bracket cannot.
  if (/[A-Za-z_$]/.test(prev)) return _REGEX_PRECEDING_WORDS.test(src.slice(Math.max(0, j - 12), j + 1));
  return false;
}

function templateStringRanges(source) {
  const byLine = new Map();
  let line = 1;
  let col = 0;
  let openLine = 0;
  let openCol = 0;
  let depth = 0; // nesting of `${` holes inside the current template
  const stack = []; // saved states, one per enclosing template
  const push = (l, a, b) => {
    if (b < a) return;
    if (!byLine.has(l)) byLine.set(l, []);
    byLine.get(l).push([a, b]);
  };
  const flushTo = (endLine, endCol) => {
    if (openLine === endLine) { push(endLine, openCol, endCol); return; }
    push(openLine, openCol, Number.MAX_SAFE_INTEGER);
    for (let l = openLine + 1; l < endLine; l++) push(l, 0, Number.MAX_SAFE_INTEGER);
    push(endLine, 0, endCol);
  };
  let i = 0;
  let inTemplate = false;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '\n') { line++; col = 0; i++; continue; }
    if (!inTemplate) {
      if (ch === '/' && next === '/') { while (i < source.length && source[i] !== '\n') { i++; col++; } continue; }
      if (ch === '/' && next === '*') {
        i += 2; col += 2;
        while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
          if (source[i] === '\n') { line++; col = 0; } else { col++; }
          i++;
        }
        i += 2; col += 2; continue;
      }
      // A regex literal is skipped whole. Without this, a backtick or a quote
      // inside a character class - /[,.`\\/]/ is a real one in this repo -
      // opens a phantom template literal and every LATER line is misattributed,
      // which reports UI copy inside real templates as bare code.
      if (ch === '/' && next !== '/' && next !== '*' && _startsRegex(source, i)) {
        i++; col++;
        let inClass = false;
        while (i < source.length && source[i] !== '\n') {
          const c = source[i];
          if (c === '\\') { i += 2; col += 2; continue; }
          if (c === '[') inClass = true;
          else if (c === ']') inClass = false;
          else if (c === '/' && !inClass) { i++; col++; break; }
          i++; col++;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        const q = ch; i++; col++;
        while (i < source.length && source[i] !== q && source[i] !== '\n') {
          // Never let the two-char escape skip leap OVER a newline: that would
          // swallow the line++ the outer loop owes and shift every later line.
          if (source[i] === '\\' && source[i + 1] !== '\n') { i += 2; col += 2; continue; }
          if (source[i] === '\\') break;
          i++; col++;
        }
        // A quote that never closes on its line is almost always not a string
        // at all - a regex character class like /[&<>"']/ is the common one.
        // Leaving the newline for the outer loop is load-bearing: consuming it
        // here skips the line++ and shifts every LATER line by one, which then
        // hands each line another line's template ranges and reports UI
        // copy as code. Fixed after modules/demo-hub tripped exactly that.
        if (source[i] === '\n') continue;
        i++; col++; continue;
      }
      if (ch === '`') { inTemplate = true; openLine = line; openCol = col + 1; i++; col++; continue; }
      if (ch === '}' && stack.length > 0 && depth === 0) {
        const st = stack.pop();
        inTemplate = true; openLine = line; openCol = col + 1; depth = st.depth;
        i++; col++; continue;
      }
      if (ch === '{' && stack.length > 0) depth++;
      else if (ch === '}' && stack.length > 0) depth--;
      i++; col++; continue;
    }
    // inside a template literal
    if (ch === '\\') { i += 2; col += 2; continue; }
    if (ch === '$' && next === '{') {
      flushTo(line, col - 1);
      stack.push({ depth });
      depth = 0;
      inTemplate = false;
      i += 2; col += 2; continue;
    }
    if (ch === '`') { flushTo(line, col - 1); inTemplate = false; i++; col++; continue; }
    i++; col++;
  }
  if (inTemplate) flushTo(line, col);
  return byLine;
}

/**
 * Scan one line for illegal non-ASCII characters.
 * @param {string} text the line
 * @param {string} filePath used to pick the legal-range strategy
 * @returns {Array<{char: string, code: string, col: number}>}
 */
function nonAsciiFindings(text, filePath) {
  const hits = [];
  if (/^[\x00-\x7F]*$/.test(text)) return hits;
  const ext = path.extname(filePath || '').toLowerCase();
  let ranges;
  if (ext === '.md') ranges = _quotedRanges(text, '"\'');
  else if (ext === '.html' || ext === '.htm') ranges = _htmlLegalRanges(text);
  else {
    const quoted = _quotedRanges(text);
    ranges = quoted.concat(_regexLiteralRanges(text, quoted));
  }
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i);
    if (code < 128) continue;
    if (TYPOGRAPHIC.has(code)) continue;
    if (_inRanges(i, ranges)) continue;
    hits.push({ char: text[i], code: 'U+' + code.toString(16).toUpperCase().padStart(4, '0'), col: i + 1 });
  }
  return hits;
}

/** Lines that say "do not do X" must not trip the forbidden-operation rules. */
const NEGATION_RE = /\b(never|nigdy|do not|don't|dont|forbidden|zabronione|nie uzywaj|avoid|no --|zamiast)\b/i;

function readFileSafe(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (_e) { return null; }
}

/** Standard --help printer: prints `text` and exits 0. */
function showHelp(text) {
  process.stdout.write(text.replace(/\n*$/, '\n'));
  process.exit(0);
}

module.exports = {
  ROOT,
  SEV,
  SEV_ORDER,
  SIZE_MAX_LINES,
  SIZE_MAX_FILES,
  TIER_SMALL_DASHED,
  TIER_LARGE_DASHED,
  TIER_SMALL_ALIAS,
  TIER_LARGE_ALIAS,
  CANONICAL_PORT,
  NEGATION_RE,
  parseArgs,
  usageError,
  fail,
  Report,
  git,
  gitOk,
  resolveScope,
  parseUnifiedDiff,
  isCosmeticFile,
  nonAsciiFindings,
  isPolishLetter,
  templateStringRanges,
  quotedRanges: _quotedRanges,
  foldPolish,
  codeSpanRanges,
  readFileSafe,
  showHelp,
};
