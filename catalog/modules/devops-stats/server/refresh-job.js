'use strict';
// modules/devops-stats/server/refresh-job.js
// Everything GET /refresh-stream needs besides the SSE plumbing (sse.js):
// the closed argument list of the Node ETL child (scripts/devops_etl.mjs,
// spawned with process.execPath), the stdin token handoff (never argv, never
// env), the refusal order and the stage runner. Ported from
// modules/sprint-stats/server/refresh-job.js minus the interpreter lookup.
// Nothing here touches fs or spawns at require() time.

const path = require('path');
const { spawn } = require('child_process');

const STAGE_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes - a full from-scratch fetch
const LOG_TAIL = 40;
const ETL_SCRIPT = path.join(__dirname, '..', 'scripts', 'devops_etl.mjs');

/** Read on every call, never frozen.
 * @returns {boolean} */
function _isTestMode() {
  return process.env.NODE_ENV === 'test' || process.env.COCKPIT_EMBEDDED === '1';
}

/** Personal token first, technical one as the fallback.
 * @param {NodeJS.ProcessEnv} env @returns {string} */
function pickJiraToken(env) {
  return (env && (env.JIRA_TOKEN || env.JIRA_TECH_TOKEN)) || '';
}

/** One JSON line for the child's stdin - the ONLY way the token reaches it.
 * Never logged.
 * @param {NodeJS.ProcessEnv} env @returns {string} */
function handoffLine(env) {
  const payload = {
    token: pickJiraToken(env),
    jira_url: (env && env.JIRA_URL) || 'https://jira.example.com',
  };
  return JSON.stringify(payload) + '\n';
}

/**
 * Keys the child may inherit. An ALLOWLIST, never `{ ...env }` minus a few
 * names: the vault unlock assigns every secret into process.env after boot
 * and `ps eww <pid>` prints a child's environment. Only what a Node process
 * needs to start plus certificate variables (paths, never credentials).
 * The Jira URL and the token travel in the handoff line.
 */
const CHILD_ENV_ALLOW = [
  'PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR',
  'LANG', 'LC_ALL', 'LC_CTYPE',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
];

/** @param {NodeJS.ProcessEnv} env @returns {NodeJS.ProcessEnv} */
function childEnv(env) {
  const out = {};
  for (const key of CHILD_ENV_ALLOW) {
    if (env && typeof env[key] === 'string' && env[key] !== '') out[key] = env[key];
  }
  if (!out.LANG) out.LANG = 'C.UTF-8';
  return out;
}

/**
 * Closed argument list: `--since` only for incremental mode and only when
 * `sinceIso` parses as a date, so nothing from a request can add a flag.
 * @param {'full'|'incremental'} mode
 * @param {string|null|undefined} sinceIso
 * @param {string} outPath
 * @returns {string[]}
 */
function etlArgs(mode, sinceIso, outPath) {
  const m = mode === 'incremental' ? 'incremental' : 'full';
  const args = [ETL_SCRIPT, '--out', outPath, '--mode', m];
  if (m === 'incremental' && typeof sinceIso === 'string' && Number.isFinite(Date.parse(sinceIso))) {
    args.push('--since', new Date(Date.parse(sinceIso)).toISOString());
  }
  return args;
}

/**
 * Refusal order (pinned by tests): test mode, a run in flight, a missing
 * token, a missing team data clone.
 * @param {{testMode?: boolean, running?: boolean, token?: string, storage?: string}} state
 * @returns {null|'test-mode'|'busy'|'no-token'|'data-missing'}
 */
function refreshRefusal(state) {
  const s = state || {};
  if (s.testMode) return 'test-mode';
  if (s.running) return 'busy';
  if (!s.token) return 'no-token';
  if (s.storage !== 'ok') return 'data-missing';
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

/** `{step,total,pct,msg}` for a "@@PROGRESS:{...}" line, `null` otherwise.
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
 * Runs the ETL child to completion: spawns process.execPath with the closed
 * argument list, writes the handoff line to stdin and closes it, splits
 * stdout and stderr into lines and resolves once the child closes. `signal`
 * aborts the child tree (a disconnected SSE client).
 * @param {{args: string[], handoff: string, cwd: string, onLine?: (line: string) => void,
 *   signal?: AbortSignal, timeoutMs?: number, spawnFn?: typeof spawn}} opts
 * @returns {Promise<{ok: boolean, code: number|null, tail: string[]}>}
 */
function runEtlStage(opts) {
  const { args, handoff, cwd, onLine, signal, spawnFn } = opts || {};
  const timeoutMs = (opts && opts.timeoutMs) || STAGE_TIMEOUT_MS;
  const doSpawn = spawnFn || spawn;

  return new Promise((resolve) => {
    let child;
    try {
      child = doSpawn(process.execPath, args, { cwd, shell: false, env: childEnv(process.env) });
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
      // The child may have already exited - 'close' reports the real outcome.
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
