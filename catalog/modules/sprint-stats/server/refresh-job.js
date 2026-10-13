'use strict';
// modules/sprint-stats/server/refresh-job.js
// Everything GET /refresh-stream needs besides the SSE plumbing itself
// (server/sse.js): resolving Python, building the closed argument lists for
// the two ETL scripts and for discover_sprints.py, handing the Jira token to
// a child over stdin (never argv, never env), running one ETL stage to completion, and the 60s-cached
// discover() call that both /discover and a refresh's default scope read.
//
// Line-splitting, _isTestMode read inside the call, no fs/spawn at
// require(), Python candidate resolution and a stdin handoff for a
// long-running child.

const path = require('path');
const { spawn, spawnSync } = require('child_process');

const PYTHON_PROBE_TIMEOUT_MS = 5000;
const DISCOVER_TIMEOUT_MS = 30000;
const DISCOVER_TTL_MS = 60000;
const STAGE_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes - a full from-scratch fetch
const LOG_TAIL = 40;

const SELECT_FLAG = { main: '--sprints', platform: '--sprint-ids' };
const ETL_SCRIPT = { main: 'sprint_stats_main.py', platform: 'sprint_stats_platform.py' };

let _discoverCache = { at: 0, data: null };
let _discoverFailedAt = 0;

/** Read on every call, never frozen - a test flips COCKPIT_EMBEDDED mid-case
 * and expects the very next refresh-stream request to see it.
 * @returns {boolean}
 */
function _isTestMode() {
  return process.env.NODE_ENV === 'test' || process.env.COCKPIT_EMBEDDED === '1';
}

/** @param {string} platform process.platform
 * @returns {[string, string[]][]} */
function _pythonCandidates(platform) {
  return platform === 'win32'
    ? [['py', ['-3']], ['python', []]]
    : [['python3', []], ['python', []]];
}

/**
 * Resolves a usable Python interpreter, or `null`. `spawnSyncFn` is
 * injectable for tests - never spawns anything under test mode's own
 * refusal (that check happens one level up, in refreshRefusal/the route).
 * @param {string} platform
 * @param {typeof spawnSync} [spawnSyncFn]
 * @returns {{cmd: string, baseArgs: string[]}|null}
 */
function resolvePython(platform, spawnSyncFn) {
  const run = spawnSyncFn || spawnSync;
  for (const [cmd, baseArgs] of _pythonCandidates(platform)) {
    let r;
    try {
      r = run(cmd, [...baseArgs, '--version'], { encoding: 'utf8', timeout: PYTHON_PROBE_TIMEOUT_MS, shell: false });
    } catch {
      r = null;
    }
    if (r && !r.error && typeof r.status === 'number' && r.status === 0) return { cmd, baseArgs };
  }
  return null;
}

/** The personal token first, the technical one as the fallback.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string} */
function pickJiraToken(env) {
  return (env && (env.JIRA_TOKEN || env.JIRA_TECH_TOKEN)) || '';
}

/** One JSON line handed to the child's stdin - the ONLY way the token
 * reaches it. Never logged.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
function handoffLine(env) {
  const payload = {
    token: pickJiraToken(env),
    jira_url: (env && env.JIRA_URL) || 'https://jira.example.com',
    verify_ssl: !(env && env.VERIFY_SSL === 'false'),
  };
  return JSON.stringify(payload) + '\n';
}

/**
 * Keys a Python child may inherit. An ALLOWLIST, never `{ ...env }` minus a
 * few names: every secret the Bitwarden unlock loads is assigned into
 * process.env after boot (server.js, /api/bitwarden/unlock), and `ps eww
 * <pid>` prints a child's envp to anyone on the same account - so a spread
 * would put CONFLUENCE_TOKEN, FIGMA_TOKEN, every GITLAB_*_TOKEN and the ten
 * Amplitude keys into a process that runs for up to STAGE_TIMEOUT_MS. The
 * first version stripped only the two Jira keys, which made the stdin
 * handoff below pointless. Same shape as server.js's
 * _protoAnalyticsRunScript. What the child needs to start: the interpreter
 * lookup (PATH), the home for Python's own caches (HOME / USERPROFILE), the
 * Windows launcher's system root, temp dirs, locale, and the certificate and
 * proxy variables (paths and hostnames, never credentials) - `_common.py`
 * builds its SSL context from ssl.create_default_context(), so a corporate
 * CA reachable through SSL_CERT_FILE must keep reaching it. JIRA_URL and
 * VERIFY_SSL are deliberately absent: they travel in the handoff line.
 */
const CHILD_ENV_ALLOW = [
  'PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR',
  'LANG', 'LC_ALL', 'LC_CTYPE',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'PYTHONIOENCODING', 'PYTHONUTF8',
];

/** The environment a Python child is spawned with: the allowlisted keys of
 * `env` that are set, plus unbuffered UTF-8 output so a "@@PROGRESS:" line
 * reaches the splitter as soon as the script prints it. The Jira token never
 * appears here - it reaches the child only through the stdin handoff line.
 * @param {NodeJS.ProcessEnv} env
 * @returns {NodeJS.ProcessEnv}
 */
function childEnv(env) {
  const out = {};
  for (const key of CHILD_ENV_ALLOW) {
    if (env && typeof env[key] === 'string' && env[key] !== '') out[key] = env[key];
  }
  if (!out.LANG) out.LANG = 'C.UTF-8';
  out.PYTHONIOENCODING = 'utf-8';
  out.PYTHONUNBUFFERED = '1';
  return out;
}

/** @param {'main'|'platform'} src @returns {string} */
function _scriptPath(name) {
  return path.join(__dirname, '..', 'scripts', name);
}

/**
 * Closed argument list for one ETL stage. `selection` (sprint numbers /
 * ids) is filtered to integers only, so nothing from a request can smuggle
 * an extra flag into argv.
 * @param {'main'|'platform'} src
 * @param {number[]} selection empty = full fetch (force)
 * @param {string} outPath
 * @returns {string[]}
 */
function etlArgs(src, selection, outPath) {
  const nums = (Array.isArray(selection) ? selection : []).filter((n) => Number.isInteger(n));
  const args = ['-u', _scriptPath(ETL_SCRIPT[src]), '--out', outPath];
  if (nums.length) args.push(SELECT_FLAG[src], nums.join(','));
  return args;
}

/** @param {'main'|'platform'} src @returns {string[]} */
function discoverArgs(src) {
  return ['-u', _scriptPath('discover_sprints.py'), '--board', src];
}

/**
 * Refusal order matters (pinned by tests): a run already in
 * flight, then test mode, then a missing token, then a missing team data
 * clone, then a missing Python.
 * @param {{testMode?: boolean, running?: boolean, token?: string, storage?: string, python?: object|null}} state
 * @returns {null|'test-mode'|'busy'|'no-token'|'data-missing'|'no-python'}
 */
function refreshRefusal(state) {
  const s = state || {};
  if (s.testMode) return 'test-mode';
  if (s.running) return 'busy';
  if (!s.token) return 'no-token';
  if (s.storage !== 'ok') return 'data-missing';
  if (!s.python) return 'no-python';
  return null;
}

/** MAIN fills 0-50, PLATFORM fills 50-100 of the overall progress bar.
 * @param {'main'|'platform'} src
 * @param {number} pct 0..100 within that one stage
 * @returns {number}
 */
function scaleStageProgress(src, pct) {
  const p = Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
  return src === 'main' ? Math.round(p / 2) : Math.round(50 + p / 2);
}

/**
 * Splits a byte stream into lines at '\n', carrying a partial tail across
 * chunks - a spawned Python child can flush mid-line, so a naive per-chunk
 * split either logs half a line twice or misses a "@@PROGRESS:" prefix that
 * lands at the start of the second half.
 * @param {(line: string) => void} onLine
 * @returns {{push: (chunk: Buffer|string) => void, flush: () => void}}
 */
function createLineSplitter(onLine) {
  let buf = '';
  return {
    push(chunk) {
      buf += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        onLine(line);
      }
    },
    flush() {
      if (!buf) return;
      const line = buf.replace(/\r$/, '');
      buf = '';
      onLine(line);
    },
  };
}

/** `{step,total,pct,msg}` for a "@@PROGRESS:{...}" line, `null` otherwise -
 * including a malformed payload, which is then logged as a plain line.
 * @param {string} line
 * @returns {{step: number|null, total: number|null, pct: number|null, msg: string}|null}
 */
function parseProgressLine(line) {
  const s = String(line === undefined || line === null ? '' : line);
  if (!s.startsWith('@@PROGRESS:')) return null;
  try {
    const payload = JSON.parse(s.slice('@@PROGRESS:'.length));
    if (!payload || typeof payload !== 'object') return null;
    return {
      step: typeof payload.step === 'number' ? payload.step : null,
      total: typeof payload.total === 'number' ? payload.total : null,
      pct: typeof payload.pct === 'number' ? payload.pct : null,
      msg: typeof payload.msg === 'string' ? payload.msg : '',
    };
  } catch {
    return null;
  }
}

function _killTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', shell: false }); } catch { /* already gone */ }
    return;
  }
  try { child.kill('SIGTERM'); } catch { /* already gone */ }
}

/**
 * Runs one ETL stage to completion: spawns Python with a closed argument
 * list, writes the handoff line to stdin and closes it, splits BOTH stdout
 * and stderr into lines (a "@@PROGRESS:" line updates progress, anything
 * else is a log line) and resolves once the child closes. `signal` aborts
 * the child tree (a disconnected SSE client); `timeoutMs` does the same on
 * its own timer.
 * @param {{python: {cmd: string, baseArgs: string[]}, args: string[], handoff: string,
 *   cwd: string, onLine?: (line: string) => void, signal?: AbortSignal,
 *   timeoutMs?: number, spawnFn?: typeof spawn}} opts
 * @returns {Promise<{ok: boolean, code: number|null, tail: string[]}>}
 */
function runEtlStage(opts) {
  const { python, args, handoff, cwd, onLine, signal, spawnFn } = opts || {};
  const timeoutMs = (opts && opts.timeoutMs) || STAGE_TIMEOUT_MS;
  const doSpawn = spawnFn || spawn;

  return new Promise((resolve) => {
    let child;
    try {
      child = doSpawn(python.cmd, [...(python.baseArgs || []), ...args], { cwd, shell: false, env: childEnv(process.env) });
    } catch (e) {
      resolve({ ok: false, code: null, tail: ['spawn-error: ' + (e && e.message ? e.message : String(e))] });
      return;
    }

    const tail = [];
    function pushLine(line) {
      if (!line) return;
      if (typeof onLine === 'function') onLine(line);
      tail.push(line);
      if (tail.length > LOG_TAIL) tail.shift();
    }
    const stdoutSplit = createLineSplitter(pushLine);
    const stderrSplit = createLineSplitter(pushLine);
    if (child.stdout) child.stdout.on('data', (c) => stdoutSplit.push(c));
    if (child.stderr) child.stderr.on('data', (c) => stderrSplit.push(c));

    let settled = false;
    const timer = setTimeout(() => _killTree(child), timeoutMs);
    if (timer.unref) timer.unref();

    function onAbort() { _killTree(child); }
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort);
    }

    try {
      if (child.stdin) {
        child.stdin.write(handoff);
        child.stdin.end();
      }
    } catch {
      // The child may have already exited - the 'close' handler below
      // still runs and reports the real outcome.
    }

    function settle(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(result);
    }

    child.on('error', (e) => {
      settle({ ok: false, code: null, tail: [...tail, 'spawn-error: ' + (e && e.message ? e.message : String(e))] });
    });

    child.on('close', (code) => {
      stdoutSplit.flush();
      stderrSplit.flush();
      settle({ ok: code === 0, code, tail: tail.slice() });
    });
  });
}

/**
 * One discover_sprints.py run: JSON on stdout, log on stderr (discarded here
 * - a failed discover is reported as one reason code, not a raw log tail).
 * @returns {Promise<{ok: boolean, data: object|null}>}
 */
function _runDiscoverOne(python, args, handoff, cwd, spawnFn) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFn(python.cmd, [...(python.baseArgs || []), ...args], { cwd, shell: false, env: childEnv(process.env) });
    } catch {
      resolve({ ok: false, data: null });
      return;
    }
    let out = '';
    let settled = false;
    const timer = setTimeout(() => _killTree(child), DISCOVER_TIMEOUT_MS);
    if (timer.unref) timer.unref();
    if (child.stdout) child.stdout.on('data', (c) => { out += c.toString('utf8'); });
    if (child.stderr) child.stderr.on('data', () => { /* log discarded */ });
    try {
      if (child.stdin) { child.stdin.write(handoff); child.stdin.end(); }
    } catch {
      // already exited
    }
    function settle(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }
    child.on('error', () => settle({ ok: false, data: null }));
    child.on('close', (code) => {
      if (code !== 0) { settle({ ok: false, data: null }); return; }
      try {
        settle({ ok: true, data: JSON.parse(out) });
      } catch {
        settle({ ok: false, data: null });
      }
    });
  });
}

/**
 * The active-sprint discovery both `/discover` and a default-scope refresh
 * read, cached 60s on success and 60s on failure (never spawns twice a
 * minute for a Jira board that is simply unreachable). Never spawns in test
 * mode. `force` bypasses only the success cache, not test mode.
 * @param {{rootDir: string}} ctx
 * @param {{force?: boolean, spawnFn?: typeof spawn, spawnSyncFn?: typeof spawnSync}} [opts]
 * @returns {Promise<object>}
 */
async function loadDiscover(ctx, opts) {
  const force = !!(opts && opts.force);
  const now = Date.now();
  if (!force) {
    if (_discoverCache.data && (now - _discoverCache.at) < DISCOVER_TTL_MS) return _discoverCache.data;
    if (_discoverFailedAt && (now - _discoverFailedAt) < DISCOVER_TTL_MS) {
      return { available: false, reason: 'discover-failed' };
    }
  }
  if (_isTestMode()) return { available: false, reason: 'test-mode' };

  const token = pickJiraToken(process.env);
  if (!token) return { available: false, reason: 'no-token' };

  const python = resolvePython(process.platform, opts && opts.spawnSyncFn);
  if (!python) return { available: false, reason: 'no-python' };

  const spawnFn = (opts && opts.spawnFn) || spawn;
  const handoff = handoffLine(process.env);
  const boards = {};
  for (const src of ['main', 'platform']) {
    const result = await _runDiscoverOne(python, discoverArgs(src), handoff, ctx.rootDir, spawnFn);
    if (!result.ok) {
      _discoverFailedAt = Date.now();
      return { available: false, reason: 'discover-failed' };
    }
    boards[src] = result.data;
  }

  const data = { available: true, main: boards.main, platform: boards.platform, fetched_at: new Date().toISOString() };
  _discoverCache = { at: Date.now(), data };
  _discoverFailedAt = 0;
  return data;
}

/** Clears the module-level discover cache - called after a successful
 * refresh (the boards' active sprint may have moved) and by tests that need
 * a clean slate between cases.
 */
function invalidateDiscoverCache() {
  _discoverCache = { at: 0, data: null };
  _discoverFailedAt = 0;
}

module.exports = {
  _isTestMode,
  _pythonCandidates,
  resolvePython,
  pickJiraToken,
  handoffLine,
  childEnv,
  CHILD_ENV_ALLOW,
  etlArgs,
  discoverArgs,
  refreshRefusal,
  scaleStageProgress,
  createLineSplitter,
  parseProgressLine,
  runEtlStage,
  loadDiscover,
  invalidateDiscoverCache,
  DISCOVER_TTL_MS,
  STAGE_TIMEOUT_MS,
};
