'use strict';
// modules/prod-bugs/server/refresh-job.js
// Everything GET /refresh-stream needs besides the SSE plumbing (server/sse.js):
// resolving Python, the closed argument list for the one ETL script, handing
// the Jira token to the child over stdin (never argv, never env), running the
// ETL to completion.
//
// Ported from modules/sprint-stats/server/refresh-job.js (a module cannot
// require() another module's file), without the discover stage.

const path = require('path');
const { spawn, spawnSync } = require('child_process');

const PYTHON_PROBE_TIMEOUT_MS = 5000;
const STAGE_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes - a full from-scratch fetch
const LOG_TAIL = 40;
const ETL_SCRIPT = 'sync_prod_bugs_sprint.py';

/** Read on every call, never frozen.
 * @returns {boolean} */
function _isTestMode() {
  return process.env.NODE_ENV === 'test' || process.env.COCKPIT_EMBEDDED === '1';
}

/** @param {string} platform @returns {[string, string[]][]} */
function _pythonCandidates(platform) {
  return platform === 'win32'
    ? [['py', ['-3']], ['python', []]]
    : [['python3', []], ['python', []]];
}

/**
 * Resolves a usable Python interpreter, or null. spawnSyncFn is injectable.
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

/** Personal token first, technical one as the fallback.
 * @param {NodeJS.ProcessEnv} env @returns {string} */
function pickJiraToken(env) {
  return (env && (env.JIRA_TOKEN || env.JIRA_TECH_TOKEN)) || '';
}

/** One JSON line handed to the child's stdin - the ONLY way the token
 * reaches it. Never logged.
 * @param {NodeJS.ProcessEnv} env @returns {string} */
function handoffLine(env) {
  const payload = {
    token: pickJiraToken(env),
    jira_url: (env && env.JIRA_URL) || 'https://jira.example.com',
    verify_ssl: !(env && env.VERIFY_SSL === 'false'),
  };
  return JSON.stringify(payload) + '\n';
}

/**
 * Keys a Python child may inherit. An ALLOWLIST: every secret the Bitwarden
 * unlock loads sits in process.env after boot and `ps eww <pid>` prints a
 * child's environment. JIRA_URL and VERIFY_SSL travel in the handoff line.
 */
const CHILD_ENV_ALLOW = [
  'PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR',
  'LANG', 'LC_ALL', 'LC_CTYPE',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'PYTHONIOENCODING', 'PYTHONUTF8',
];

/** @param {NodeJS.ProcessEnv} env @returns {NodeJS.ProcessEnv} */
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

/** @returns {string} */
function _scriptPath() {
  return path.join(__dirname, '..', 'scripts', ETL_SCRIPT);
}

/**
 * Closed argument list. Nothing from a request reaches argv except the
 * choice between the two flags.
 * @param {boolean} force true = every sprint again, false = only the current one
 * @param {string} dataDir module data directory the ETL writes into
 * @param {string} cacheDir
 * @returns {string[]}
 */
function etlArgs(force, dataDir, cacheDir) {
  return ['-u', _scriptPath(), 'auto', force ? '--force' : '--force-current',
    '--data-dir', String(dataDir), '--cache-dir', String(cacheDir)];
}

/**
 * Refusal order (pinned by the plan and by tests): test mode, a run in
 * flight, a missing token, a missing team data clone, a missing Python.
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

/** Splits a byte stream into lines at '\n', carrying a partial tail.
 * @param {(line: string) => void} onLine */
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

/** {step,total,pct,msg} for an "@@PROGRESS:{...}" line, null otherwise.
 * @param {string} line */
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
 * Runs the ETL to completion: closed argument list, handoff on stdin (then
 * closed), stdout and stderr both split into lines. `signal` aborts the child
 * tree (a disconnected SSE client); `timeoutMs` does the same on a timer.
 * @param {{python: {cmd: string, baseArgs: string[]}, args: string[], handoff: string,
 *   cwd: string, onLine?: (line: string) => void, signal?: AbortSignal,
 *   timeoutMs?: number, spawnFn?: typeof spawn}} opts
 * @returns {Promise<{ok: boolean, code: number|null, tail: string[]}>}
 */
function runEtl(opts) {
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
      // The child may have exited already - 'close' reports the real outcome.
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

module.exports = {
  _isTestMode,
  _pythonCandidates,
  resolvePython,
  pickJiraToken,
  handoffLine,
  childEnv,
  CHILD_ENV_ALLOW,
  etlArgs,
  refreshRefusal,
  createLineSplitter,
  parseProgressLine,
  runEtl,
  STAGE_TIMEOUT_MS,
};
