'use strict';
// modules/meeting-archive/server/folder-assign.js
// Which virtual folder a freshly published meeting lands in.
//   1. series   the recording name without its date/time/ticket tail
//               ("Refinement - Atlas (Next Generation)-20260911_090003UTC-
//               Meeting Recording.mp4" -> "refinement atlas next generation")
//               is looked up in the archive; the folder that series lives in
//               (>= 2 meetings, >= 60% of them) wins. Deterministic, no AI.
//   2. claude   otherwise `claude -p` (no tools, one turn) picks one of the
//               EXISTING folders from title + brief + the folder tree with a
//               few example titles each - or none.
//   3. none     the meeting stays outside any folder.
// The choice is recorded in meeting-user-meta.json as `auto_folder`
// ({by, at, reason}) so the archive can flag it for review; an edit of the
// folder by a person drops the flag (publish-lib.applyUserMetaEdit).

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const os = require('os');

const SERIES_MIN = 2;
const SERIES_SHARE = 0.6;
const EXAMPLES_PER_FOLDER = 6;
const CLAUDE_TIMEOUT_MS = 180000;

/** Lower case, accented letters folded, single spaces of [a-z0-9]. */
function fold(s) {
  return String(s || '').toLowerCase().replace(/\u0142/g, 'l')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * The series a recording belongs to: file name without extension, the Teams
 * date/time tail ("-20260911_090003UTC-Meeting Recording",
 * "-20261005_103529-Meeting recording"), ticket ids (PROJ-4598) and lone
 * numbers. '' when nothing meaningful is left.
 * @param {string} sourceFile
 */
function seriesKey(sourceFile) {
  // Hand-written entries ("manual-<date>") are no series.
  if (/^manual-/i.test(String(sourceFile || ''))) return '';
  let s = String(sourceFile || '').replace(/\.[A-Za-z0-9]{2,5}$/, '');
  s = s.replace(/[-_ ]?\d{8}_\d{6}(UTC)?.*$/i, '');
  s = s.replace(/\b[A-Z]{2,10}-\d+\b/g, ' ');
  return fold(s).split(' ').filter((t) => t && !/^\d+$/.test(t)).join(' ');
}

/**
 * Series -> folder counts from the archive.
 * @param {{sourceFile: string, folderId: string|null}[]} meetings
 * @returns {Map<string, Map<string, number>>}
 */
function seriesIndex(meetings) {
  const idx = new Map();
  for (const m of meetings || []) {
    const key = seriesKey(m.sourceFile);
    if (!key || !m.folderId) continue;
    if (!idx.has(key)) idx.set(key, new Map());
    const c = idx.get(key);
    c.set(m.folderId, (c.get(m.folderId) || 0) + 1);
  }
  return idx;
}

/**
 * Folder of a series when the archive agrees enough, else null.
 * @returns {{folderId: string, count: number, total: number}|null}
 */
function seriesFolder(sourceFile, idx, knownFolderIds) {
  const counts = idx.get(seriesKey(sourceFile));
  if (!counts) return null;
  let total = 0; let best = null; let top = 0;
  for (const [id, n] of counts) { total += n; if (n > top && knownFolderIds.has(id)) { top = n; best = id; } }
  if (!best || top < SERIES_MIN || top / total < SERIES_SHARE) return null;
  return { folderId: best, count: top, total };
}

/** "Parent / Child" path of a folder. */
function folderPath(folders, id) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const parts = [];
  for (let f = byId.get(id), guard = 0; f && guard < 20; f = byId.get(f.parentId), guard++) parts.unshift(f.name);
  return parts.join(' / ');
}

/**
 * The prompt for Claude: the folder tree with example titles, the meeting.
 * @param {{folders: object[], examples: Map<string, string[]>, meeting: {title: string, brief: string, sourceFile: string}}} o
 */
function buildPrompt(o) {
  const lines = o.folders.map((f) => {
    const ex = (o.examples.get(f.id) || []).slice(0, EXAMPLES_PER_FOLDER);
    return '- id: ' + f.id + ' | folder: ' + folderPath(o.folders, f.id)
      + (ex.length ? ' | example meetings: ' + ex.map((t) => '"' + t + '"').join('; ') : '');
  });
  return [
    'You are the meeting archivist of a product team. Assign the new meeting to ONE existing archive folder, or to none.',
    'Pick a folder only when the meeting clearly belongs to its topic or series (compare with the example meetings). When in doubt, return null - no folder is better than the wrong one.',
    '',
    'Folders:',
    ...lines,
    '',
    'New meeting:',
    'Recording name: ' + o.meeting.sourceFile,
    'Title: ' + o.meeting.title,
    'Summary: ' + String(o.meeting.brief || '').slice(0, 1500),
    '',
    'Answer with ONLY one JSON object, no comment and no code block:',
    '{"folder_id": "<id from the list or null>", "confidence": <0..1>, "reason": "<one short sentence in English>"}',
  ].join('\n');
}

/**
 * Claude's answer -> {folderId, confidence, reason} or null. Accepts the
 * `claude -p --output-format json` envelope ({result: "..."}) or the bare
 * object; the folder must be one of the known ids.
 */
function parseAnswer(stdout, knownFolderIds) {
  let text = String(stdout || '').trim();
  try {
    const env = JSON.parse(text);
    if (env && typeof env.result === 'string') text = env.result;
    else if (env && typeof env === 'object' && 'folder_id' in env) text = JSON.stringify(env);
  } catch { /* not an envelope */ }
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  let obj;
  try { obj = JSON.parse(m[0]); } catch { return null; }
  const id = typeof obj.folder_id === 'string' ? obj.folder_id : null;
  const confidence = Number(obj.confidence);
  const reason = String(obj.reason || '').slice(0, 300);
  if (!id || !knownFolderIds.has(id)) return { folderId: null, confidence: Number.isFinite(confidence) ? confidence : 0, reason };
  return { folderId: id, confidence: Number.isFinite(confidence) ? confidence : 0, reason };
}

// -- the Claude CLI --------------------------------------------------------------

/** The `claude` binary: PATH first, then the usual per-user install places. */
function findClaude(env, platform) {
  const plat = platform || process.platform;
  const names = plat === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
  const home = (env && (env.HOME || env.USERPROFILE)) || os.homedir();
  const dirs = String((env && env.PATH) || '').split(path.delimiter).filter(Boolean)
    .concat([path.join(home, 'bin'), path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin']);
  for (const d of dirs) {
    for (const n of names) {
      const p = path.join(d, n);
      try { if (fs.statSync(p).isFile()) return { cmd: p, shell: /\.cmd$/i.test(p) }; } catch { /* next */ }
    }
  }
  return null;
}

// Whitelist only: this server's process.env carries vault tokens.
const ENV_KEYS = ['HOME', 'USER', 'LOGNAME', 'PATH', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'TERM',
  'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'COMSPEC', 'PATHEXT',
  'HOMEDRIVE', 'HOMEPATH', 'SystemDrive', 'SYSTEMDRIVE'];
const ENV_PREFIXES = ['LC_', 'ANTHROPIC_', 'CLAUDE_'];

function claudeEnv(src) {
  const env = {};
  for (const k of Object.keys(src || {})) {
    if (typeof src[k] === 'string' && (ENV_KEYS.includes(k) || ENV_PREFIXES.some((p) => k.startsWith(p)))) env[k] = src[k];
  }
  return env;
}

/**
 * One `claude -p` call: prompt on stdin, no tools, one turn. Never rejects.
 * @returns {Promise<{ok: boolean, stdout: string, reason: string|null}>}
 */
function runClaude(prompt, opts) {
  const o = opts || {};
  // `node --test` never spends a real Claude call (tests inject `run`).
  if (process.env.NODE_TEST_CONTEXT && !o.spawn) return Promise.resolve({ ok: false, stdout: '', reason: 'test-mode' });
  const cli = o.cli || findClaude(process.env);
  if (!cli) return Promise.resolve({ ok: false, stdout: '', reason: 'claude-missing' });
  const spawnFn = o.spawn || cp.spawn;
  const args = ['-p', '--output-format', 'json', '--model', o.model || 'sonnet', '--max-turns', '1', '--allowedTools', ''];
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    let child;
    try {
      child = spawnFn(cli.cmd, args, { cwd: o.cwd || os.tmpdir(), shell: cli.shell, stdio: ['pipe', 'pipe', 'pipe'], env: claudeEnv(o.env || process.env) });
    } catch {
      return done({ ok: false, stdout: '', reason: 'spawn-failed' });
    }
    let stdout = '';
    const timer = setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* gone */ } done({ ok: false, stdout: '', reason: 'timeout' }); }, o.timeoutMs || CLAUDE_TIMEOUT_MS);
    if (timer.unref) timer.unref();
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', () => { /* drained */ });
    child.stdin.on('error', () => { /* reported by close */ });
    child.on('error', () => { clearTimeout(timer); done({ ok: false, stdout: '', reason: 'spawn-failed' }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      done({ ok: code === 0 && stdout.trim() !== '', stdout, reason: code === 0 ? null : 'exit-' + code });
    });
    child.stdin.end(prompt);
  });
}

/**
 * The whole decision. Never throws.
 * @param {{meeting: {title: string, brief: string, sourceFile: string},
 *   archive: {sourceFile: string, folderId: string|null, title: string}[],
 *   folders: {id: string, name: string, parentId: string|null}[],
 *   run?: Function, now?: Date}} o
 * @returns {Promise<{folderId: string|null, auto: object|null, note: string}>}
 */
async function assignFolder(o) {
  const now = (o.now || new Date()).toISOString();
  const known = new Set(o.folders.map((f) => f.id));
  if (!known.size) return { folderId: null, auto: null, note: 'no-folders' };
  const series = seriesFolder(o.meeting.sourceFile, seriesIndex(o.archive), known);
  if (series) {
    return {
      folderId: series.folderId,
      auto: { by: 'series', at: now, reason: 'Series "' + seriesKey(o.meeting.sourceFile) + '": ' + series.count + ' of ' + series.total + ' meetings in this folder.' },
      note: 'series',
    };
  }
  const examples = new Map();
  for (const m of o.archive) {
    if (!m.folderId || !m.title) continue;
    if (!examples.has(m.folderId)) examples.set(m.folderId, []);
    const list = examples.get(m.folderId);
    if (list.length < EXAMPLES_PER_FOLDER && !list.includes(m.title)) list.push(m.title);
  }
  const r = await (o.run || runClaude)(buildPrompt({ folders: o.folders, examples, meeting: o.meeting }));
  if (!r.ok) return { folderId: null, auto: null, note: 'claude-' + (r.reason || 'failed') };
  const ans = parseAnswer(r.stdout, known);
  if (!ans) return { folderId: null, auto: null, note: 'claude-unparsable' };
  if (!ans.folderId || ans.confidence < 0.5) {
    return { folderId: null, auto: { by: 'claude', at: now, reason: 'No folder: ' + (ans.reason || 'nothing fits') }, note: 'claude-none' };
  }
  return { folderId: ans.folderId, auto: { by: 'claude', at: now, reason: ans.reason, confidence: ans.confidence }, note: 'claude' };
}

module.exports = {
  fold, seriesKey, seriesIndex, seriesFolder, folderPath, buildPrompt, parseAnswer, findClaude, claudeEnv, runClaude, assignFolder,
  SERIES_MIN, SERIES_SHARE,
};
