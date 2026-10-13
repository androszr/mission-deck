'use strict';
// modules/qa-tests/server/refresh-job.js
// Everything GET /refresh-stream needs besides the SSE plumbing itself:
// resolving Python, building the closed argument list for qa_automation.py,
// handing the Jira token to the child over stdin (never argv, never env),
// running the ETL stage to completion, and the refusal order guard.
//
// Pattern ported from modules/sprint-stats/server/refresh-job.js.
// QA has a single ETL stage (no discover stage, no per-project split).

const path = require('path');
const { spawn, spawnSync } = require('child_process');

const PYTHON_PROBE_TIMEOUT_MS = 5000;
const STAGE_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes - a full from-scratch fetch
const LOG_TAIL = 40;

/** Read on every call, never frozen - a test flips COCKPIT_EMBEDDED mid-case. */
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
 * Resolves a usable Python interpreter, or `null`.
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

/** Personal token first, technical as fallback.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string} */
function pickJiraToken(env) {
  return (env && (env.JIRA_TOKEN || env.JIRA_TECH_TOKEN)) || '';
}

/** One JSON line handed to the child's stdin - the ONLY way the token reaches it.
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
function handoffLine(env) {
  const payload = {
    token: pickJiraToken(env),
    jira_url: (env && env.JIRA_URL) || 'https://jira.example.com',
    project: (env && env.QA_JIRA_PROJECT) || 'QA',
    verify_ssl: !(env && env.VERIFY_SSL === 'false'),
  };
  return JSON.stringify(payload) + '\n';
}

/**
 * Keys a Python child may inherit. An ALLOWLIST, never `{ ...env }` minus a
 * few names: Bitwarden unlock assigns secrets into process.env after boot, and
 * `ps eww` prints a child's envp to anyone on the same account.
 */
const CHILD_ENV_ALLOW = [
  'PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR',
  'LANG', 'LC_ALL', 'LC_CTYPE',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'PYTHONIOENCODING', 'PYTHONUTF8',
];

/** The environment a Python child is spawned with: the allowlisted keys only.
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

/** @param {string} name
 * @returns {string} */
function _scriptPath(name) {
  return path.join(__dirname, '..', 'scripts', name);
}

/**
 * Closed argument list for the QA ETL stage. `outPath` is the shard
 * DIRECTORY (jira/qa-automation/ inside the team data plaintext tree): the
 * script writes module-<key>.json shards and index.json there itself.
 * @param {string} outPath
 * @returns {string[]}
 */
function etlArgs(outPath) {
  return ['-u', _scriptPath('qa_automation.py'), '--out', outPath];
}

/**
 * Refusal order (pinned by the plan and by tests):
 * test-mode, busy, no-token, data-missing, no-python.
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

/**
 * Splits a byte stream into lines at '\n', carrying a partial tail across
 * chunks.
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

/** `{step,total,pct,msg}` for a "@@PROGRESS:{...}" line, `null` otherwise.
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
  // The child is spawned detached on POSIX (own process group), so signal the
  // whole group; fall back to the child alone when the group is already gone.
  try { process.kill(-child.pid, 'SIGTERM'); return; } catch { /* fall through */ }
  try { child.kill('SIGTERM'); } catch { /* already gone */ }
}

/**
 * Runs the QA ETL stage to completion: spawns Python with a closed argument
 * list, writes the handoff line to stdin and closes it, splits stdout and
 * stderr into lines.
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
      child = doSpawn(python.cmd, [...(python.baseArgs || []), ...args], {
        cwd,
        shell: false,
        env: childEnv(process.env),
        detached: process.platform !== 'win32',
      });
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

    // A child that exits before reading stdin turns the write into an EPIPE
    // 'error' on the stream; unhandled, that event would crash the server.
    if (child.stdin && typeof child.stdin.on === 'function') child.stdin.on('error', () => {});
    try {
      if (child.stdin) {
        child.stdin.write(handoff);
        child.stdin.end();
      }
    } catch {
      // The child may have already exited.
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
  runEtlStage,
  STAGE_TIMEOUT_MS,
};
