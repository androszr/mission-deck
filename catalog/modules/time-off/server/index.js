'use strict';
// time-off/server/index.js
// register(ctx) mounted under /api/m/time-off/. Routes:
//   GET  /data               -> merged calendar data (shards + index)
//   GET  /status             -> config/python/deps/session/job probe, never touches team data
//   GET  /fetch-stream       -> SSE job: spawns scripts/sharepoint_time_off.py
//   POST /session-keepalive  -> headless probe of the saved SSO session
//   POST /session-login      -> visible sign-in window, saves the session
//
// The module has no access to the core's python/kill/IS_TEST_MODE helpers
// (ctx carries only jsonResponse/readBody/checkOrigin/makeLock/dataDir/
// rootDir/log), so this file reproduces the three small pieces it needs:
// pythonCandidates(), an exec-with-own-deadline and killTree. See README.md
// for why the SSO session file lives in ctx.dataDir and never in team data.

const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');

const MODULE_SUBDIR = 'time-off';
const PERSONS_SUBDIR = 'people';
const INDEX_FILE = 'index.json';

const JOB_TIMEOUT_MS = 6 * 60 * 1000; // 5 min login window + download/convert
const SESSION_FRESH_HOURS = 168; // one week
const PYTHON_PROBE_TIMEOUT_MS = 5000;
const PYTHON_PROBE_TTL_MS = 60 * 1000;
const STDERR_TAIL_BYTES = 8 * 1024;

const IS_TEST_MODE = process.env.NODE_ENV === 'test' || process.env.COCKPIT_EMBEDDED === '1';

// -- Python detection --------------------------------------------------------
// Order mirrors the core's python lookup: Windows tries `py -3` then
// `python`, everywhere else `python3` then `python`. Kept as { cmd, baseArgs }
// rather than a ready `--version` tuple because the same base args are reused
// to run the dependency probe and to spawn the actual script.
function pythonCandidates(platform) {
  return platform === 'win32'
    ? [{ cmd: 'py', baseArgs: ['-3'] }, { cmd: 'python', baseArgs: [] }]
    : [{ cmd: 'python3', baseArgs: [] }, { cmd: 'python', baseArgs: [] }];
}

function versionFrom(text) {
  const m = /(\d+\.\d+(?:\.\d+)*)/.exec(String(text || ''));
  return m ? m[1] : null;
}

// Kill a process AND its descendants. The Python child is spawned detached
// on POSIX specifically so this can reach the Chromium grandchild it opens
// for headed login; on Windows `taskkill /T` walks the tree the same way.
function killTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ }
    return;
  }
  try { process.kill(-child.pid, 'SIGKILL'); } catch {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
}

/**
 * Keys a Python child may inherit - an ALLOWLIST, never `{ ...process.env }`.
 * Every secret the Bitwarden unlock loads is assigned into process.env after
 * boot, and `ps eww <pid>` prints a child's envp to anyone on the same
 * account, so the previous spread put every vault token into a headed
 * Playwright process that sits open for up to five minutes waiting for a
 * person to log in. The script needs no secret at all (the SharePoint
 * session is a cookie file named in argv); what it reads from its
 * environment are the TIMEOFF_* settings, and what it needs
 * to START is the interpreter lookup, a home for Playwright's browser cache,
 * temp dirs, locale, CA/proxy variables (paths and hostnames, never
 * credentials), the display on Linux and the per-user directories on
 * Windows.
 */
const CHILD_ENV_ALLOW = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy',
  'PLAYWRIGHT_BROWSERS_PATH', 'PYTHONIOENCODING', 'PYTHONUTF8',
  'TIMEOFF_SHAREPOINT_URL', 'TIMEOFF_SHAREPOINT_DOWNLOAD_URL', 'TIMEOFF_SHAREPOINT_META_URL', 'TIMEOFF_SHAREPOINT_SITE_URL',
  'TIMEOFF_SHEET', 'TIMEOFF_COL_NAME', 'TIMEOFF_COL_EMAIL', 'TIMEOFF_COL_DATE_FROM', 'TIMEOFF_COL_DATE_TO', 'TIMEOFF_COL_SUBMITTED',
  'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS',
  'SYSTEMROOT', 'SystemRoot', 'COMSPEC', 'ComSpec', 'APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'ProgramFiles', 'ProgramData',
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

// execFile's own `timeout` only signals the direct child - a hung
// grandchild holding stdio open can keep the callback from firing well past
// it, so the deadline is enforced here too.
function execWithDeadline(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let deadline = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (deadline) clearTimeout(deadline);
      resolve(result);
    };
    let child;
    try {
      child = execFile(cmd, args, { timeout: timeoutMs, encoding: 'utf8', env: childEnv(process.env) }, (err, stdout, stderr) => {
        const out = String(stdout || '').trim() || String(stderr || '').trim();
        finish({ ok: !err, out });
      });
    } catch (e) {
      finish({ ok: false, out: String((e && e.message) || '') });
      return;
    }
    deadline = setTimeout(() => {
      killTree(child);
      finish({ ok: false, out: '' });
    }, timeoutMs + 500);
    if (deadline.unref) deadline.unref();
  });
}

let pythonCache = { at: 0, data: null };
async function probePython() {
  if (pythonCache.data && Date.now() - pythonCache.at < PYTHON_PROBE_TTL_MS) return pythonCache.data;
  let found = null;
  for (const cand of pythonCandidates(process.platform)) {
    const r = await execWithDeadline(cand.cmd, [...cand.baseArgs, '--version'], PYTHON_PROBE_TIMEOUT_MS);
    if (r.ok) { found = { cmd: cand.cmd, baseArgs: cand.baseArgs, version: versionFrom(r.out) }; break; }
  }
  pythonCache = { at: Date.now(), data: found };
  return found;
}

// One combined import so a missing dependency reads from the same stderr a
// person would see running the command themselves; the message text is what
// tells playwright and openpyxl apart.
async function probeDeps(py) {
  if (!py) return { playwright: false, openpyxl: false };
  const r = await execWithDeadline(py.cmd, [...py.baseArgs, '-c', 'import playwright, openpyxl'], PYTHON_PROBE_TIMEOUT_MS);
  if (r.ok) return { playwright: true, openpyxl: true };
  const out = String(r.out || '');
  const missingPlaywright = /No module named ['"]playwright/.test(out);
  const missingOpenpyxl = /No module named ['"]openpyxl/.test(out);
  return { playwright: !missingPlaywright, openpyxl: !missingOpenpyxl };
}

// -- SSE helpers --------------------------------------------------------------

function sseOpen(req, res) {
  if (req.socket && typeof req.socket.setTimeout === 'function') req.socket.setTimeout(0);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

function sseSend(res, event, obj) {
  res.write('event: ' + event + '\ndata: ' + JSON.stringify(obj) + '\n\n');
}

/** Both SharePoint addresses are configuration; without them a fetch cannot start. */
function isConfigured(env) {
  return Boolean(env && env.TIMEOFF_SHAREPOINT_URL && env.TIMEOFF_SHAREPOINT_DOWNLOAD_URL);
}

function dataRootOf(ctx) {
  if (ctx.dataTier0Dir) return ctx.dataTier0Dir;
  if (typeof ctx.dataRepoDir === 'function') {
    const dir = ctx.dataRepoDir('data-tier-0');
    if (dir) return dir;
  }
  return path.join(ctx.rootDir, 'data-sub-repositories', 'ds-data');
}

module.exports = function register(ctx) {
  const repoDir = dataRootOf(ctx);
  const moduleDir = path.join(repoDir, MODULE_SUBDIR);
  const personsDir = path.join(moduleDir, PERSONS_SUBDIR);
  const indexFile = path.join(moduleDir, INDEX_FILE);

  const SESSION_FILE = path.join(ctx.dataDir, 'sso-session.json');
  // Shared Microsoft session of every SSO module on this machine
  // (scripts/_sso_shared.py): under the app's gitignored data/, never team data.
  const SEED_FILE = path.join(ctx.rootDir, 'data', 'sso-shared', 'microsoft-session.json');
  const DOWNLOAD_DIR = path.join(ctx.dataDir, 'downloads');
  const SCRIPT = path.join(__dirname, '..', 'scripts', 'sharepoint_time_off.py');

  const withLock = ctx.makeLock();
  let job = { running: false, startedAt: null, child: null };

  // -- Merging shards -----------------------------------------------------

  function readShard(file) {
    try {
      const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!obj || typeof obj !== 'object' || typeof obj.slug !== 'string' || !Array.isArray(obj.entries)) {
        ctx.log('time-off: shard has an unexpected shape, skipping:', file);
        return null;
      }
      return obj;
    } catch (e) {
      ctx.log('time-off: broken shard, skipping:', file, e.message);
      return null;
    }
  }

  function readIndex() {
    try {
      const obj = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
      return obj && typeof obj === 'object' ? obj : null;
    } catch {
      return null;
    }
  }

  function loadCalendarData() {
    const index = readIndex();
    let shardFiles = [];
    try {
      shardFiles = fs.readdirSync(personsDir).filter((f) => f.endsWith('.json'));
    } catch { /* no people directory yet - empty state */ }

    const entries = [];
    for (const file of shardFiles.sort()) {
      const shard = readShard(path.join(personsDir, file));
      if (!shard) continue;
      shard.entries.forEach((e, i) => {
        entries.push({
          id: shard.slug + '-' + i,
          person: shard.name,
          person_slug: shard.slug,
          dateFrom: e.dateFrom,
          dateTo: e.dateTo,
          submittedAt: e.submittedAt || null,
          submittedBy: e.submittedBy || null,
        });
      });
    }
    entries.sort((a, b) => (a.dateFrom < b.dateFrom ? -1 : a.dateFrom > b.dateFrom ? 1 : 0));

    const persons = index && index.persons && typeof index.persons === 'object'
      ? Object.keys(index.persons).sort().map((slug) => ({ slug, ...index.persons[slug] }))
      : [];

    return {
      available: true,
      storage: 'ok',
      fetched_at: index ? (index.fetched_at || null) : null,
      source_mtime: index ? (index.source_mtime || null) : null,
      persons,
      entries,
    };
  }

  // -- GET /data ------------------------------------------------------------

  function handleData(_req, res) {
    if (!fs.existsSync(repoDir)) {
      ctx.jsonResponse(res, 200, {
        available: false,
        storage: 'unavailable',
        fetched_at: null,
        source_mtime: null,
        persons: [],
        entries: [],
      });
      return;
    }
    ctx.jsonResponse(res, 200, loadCalendarData());
  }

  // -- GET /status ------------------------------------------------------------

  async function handleStatus(_req, res) {
    const py = await probePython();
    const deps = await probeDeps(py);
    let session = { exists: false, ageHours: null, fresh: false };
    try {
      const st = fs.statSync(SESSION_FILE);
      const ageHours = (Date.now() - st.mtimeMs) / (60 * 60 * 1000);
      session = { exists: true, ageHours: Math.round(ageHours * 10) / 10, fresh: ageHours < SESSION_FRESH_HOURS };
    } catch { /* no session yet - empty state */ }

    ctx.jsonResponse(res, 200, {
      platform: process.platform,
      configured: isConfigured(process.env),
      python: { found: !!py, cmd: py ? py.cmd : null, version: py ? py.version : null },
      deps,
      session,
      job: { running: job.running, startedAt: job.startedAt },
      storage: fs.existsSync(repoDir) ? 'ok' : 'unavailable',
    });
  }

  // -- GET /fetch-stream ------------------------------------------------

  async function handleFetchStream(req, res) {
    // Test mode never spawns anything, regardless of repo state - a module
    // exercised under a future test:api-style harness must not open a real
    // browser window.
    if (IS_TEST_MODE) {
      sseOpen(req, res);
      sseSend(res, 'done', { status: 'skipped', reason: 'test-mode' });
      res.end();
      return;
    }

    if (!fs.existsSync(repoDir)) {
      ctx.jsonResponse(res, 409, {
        error: 'repo-missing',
        message: 'The team data repository is not cloned - clone it in the sync panel on the top bar.',
      });
      return;
    }

    if (!isConfigured(process.env)) {
      ctx.jsonResponse(res, 409, {
        error: 'not-configured',
        message: 'Set TIMEOFF_SHAREPOINT_URL and TIMEOFF_SHAREPOINT_DOWNLOAD_URL in .env first.',
      });
      return;
    }

    // The running-flag decision has to happen inside the lock: two clicks
    // that both read job.running=false before either writes it back would
    // both start a job.
    const started = await withLock(() => {
      if (job.running) return false;
      job = { running: true, startedAt: new Date().toISOString(), child: null };
      return true;
    });
    if (!started) {
      ctx.jsonResponse(res, 409, { error: 'job-running', message: 'A download is already running.' });
      return;
    }

    const finishJob = () => { job.running = false; job.child = null; };

    sseOpen(req, res);

    const py = await probePython();
    if (!py) {
      sseSend(res, 'error', { message: 'Python 3 was not found (python3/python/py) - install Python and try again.' });
      finishJob();
      res.end();
      return;
    }

    try {
      fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
    } catch (e) {
      sseSend(res, 'error', { message: 'Could not create the download directory: ' + e.message });
      finishJob();
      res.end();
      return;
    }

    const args = [
      ...py.baseArgs,
      SCRIPT,
      '--dest', moduleDir,
      '--session', SESSION_FILE,
      '--seed', SEED_FILE,
      '--download-dir', DOWNLOAD_DIR,
      '--headed-timeout', '300',
    ];

    let child;
    try {
      child = spawn(py.cmd, args, {
        cwd: ctx.rootDir,
        detached: process.platform !== 'win32',
        env: childEnv(process.env),
      });
    } catch (e) {
      sseSend(res, 'error', { message: 'Could not start the Python script: ' + e.message });
      finishJob();
      res.end();
      return;
    }
    job.child = child;

    let stdoutBuf = '';
    let stderrTail = '';
    let result = null;
    let settled = false;

    const cleanupTimers = () => {
      clearTimeout(timeoutTimer);
      req.removeListener('close', onClientClose);
    };

    const timeoutTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killTree(child);
      finishJob();
      sseSend(res, 'error', { message: 'Timed out after 6 minutes (5 minutes to sign in + the download).' });
      res.end();
    }, JOB_TIMEOUT_MS);
    if (timeoutTimer.unref) timeoutTimer.unref();

    const onClientClose = () => {
      if (settled) return;
      settled = true;
      killTree(child);
      finishJob();
      clearTimeout(timeoutTimer);
    };
    req.on('close', onClientClose);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdoutBuf += chunk;
      let idx;
      while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, idx);
        stdoutBuf = stdoutBuf.slice(idx + 1);
        const trimmed = line.trim();
        if (!trimmed) continue;
        let obj = null;
        try { obj = JSON.parse(trimmed); } catch { /* unparsable line - log it and move on */ }
        if (!obj) { ctx.log('fetch-stream: line outside the format:', trimmed); continue; }
        if (obj.step) {
          if (!settled) sseSend(res, 'progress', obj);
        } else if (obj.status) {
          result = obj;
        } else {
          ctx.log('fetch-stream: unrecognised JSON object:', trimmed);
        }
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_BYTES);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      finishJob();
      if (code === 0 && result) {
        sseSend(res, 'done', result);
      } else {
        const lastLine = stderrTail.trim().split('\n').filter(Boolean).pop() || null;
        sseSend(res, 'error', { message: lastLine || ('The script failed (exit code ' + code + ').') });
      }
      res.end();
    });

    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      finishJob();
      sseSend(res, 'error', { message: 'Could not start the Python script: ' + e.message });
      res.end();
    });
  }

  // -- POST /session-keepalive -----------------------------------------------
  // Synchronous: spawns sharepoint_time_off.py --keepalive, awaits exit (30 s),
  // responds with the result. Guards:
  //   1. test-mode -> 409 {error: 'test-mode'} - no spawn
  //   2. job.running -> 409 {error: 'job-running'}
  //   3. no session file -> 200 {ok: true, status: 'session-missing'}
  // Cookie values never appear in any response - Python exits non-zero on
  // expiry or prints {"status":"alive"} on success.

  async function handleSessionKeepalive(_req, res) {
    if (IS_TEST_MODE) {
      ctx.jsonResponse(res, 409, { error: 'test-mode', message: 'The Python script is never started in test mode.' });
      return;
    }
    if (job.running) {
      ctx.jsonResponse(res, 409, { error: 'job-running', message: 'A download or sign-in is already running.' });
      return;
    }
    if (!fs.existsSync(SESSION_FILE)) {
      ctx.jsonResponse(res, 200, { ok: true, status: 'session-missing' });
      return;
    }

    const py = await probePython();
    if (!py) {
      ctx.jsonResponse(res, 200, { ok: false, error: 'python-missing' });
      return;
    }
    // Re-checked after the await, then the slot is taken synchronously: a
    // download or login started meanwhile must not race this probe on the
    // session file, and a second probe must not open a second browser.
    if (job.running) {
      ctx.jsonResponse(res, 409, { error: 'job-running', message: 'A download or sign-in is already running.' });
      return;
    }
    job = { running: true, startedAt: new Date().toISOString(), child: null };

    const args = [
      ...py.baseArgs,
      SCRIPT,
      '--keepalive',
      '--session', SESSION_FILE,
      '--seed', SEED_FILE,
    ];

    const KEEPALIVE_TIMEOUT_MS = 30 * 1000;
    const KEEPALIVE_STDOUT_MAX = 4096;

    let result;
    try {
      result = await new Promise((resolve) => {
        let child;
        try {
          child = spawn(py.cmd, args, {
            cwd: ctx.rootDir,
            // stdin/stderr ignored: an undrained pipe stalls the child once
            // its buffer fills.
            stdio: ['ignore', 'pipe', 'ignore'],
            detached: process.platform !== 'win32',
            env: childEnv(process.env),
          });
        } catch (_e) {
          resolve({ ok: false, error: 'spawn-failed' });
          return;
        }
        job.child = child;

        let stdout = '';
        if (child.stdout) {
          child.stdout.on('data', (chunk) => {
            stdout = (stdout + chunk.toString('utf8')).slice(-KEEPALIVE_STDOUT_MAX);
          });
        }

        const deadline = setTimeout(() => {
          killTree(child);
          resolve({ ok: false, error: 'keepalive-timeout' });
        }, KEEPALIVE_TIMEOUT_MS);
        if (deadline.unref) deadline.unref();

        child.on('error', (e) => {
          clearTimeout(deadline);
          ctx.log('time-off: keepalive-error:', e.message);
          resolve({ ok: false, error: 'spawn-failed' });
        });

        child.on('close', (code) => {
          clearTimeout(deadline);
          if (code === 4) {
            resolve({ ok: true, status: 'expired' });
            return;
          }
          if (code === 2) {
            resolve({ ok: false, error: 'unreachable' });
            return;
          }
          if (code !== 0) {
            // An uncaught exception (Playwright or its browser missing, a
            // crash) is NOT an expired session.
            resolve({ ok: false, error: 'keepalive-failed' });
            return;
          }
          // Exit 0: look for {"status":"alive"} on stdout.
          let parsed = null;
          const lines = stdout.trim().split('\n').filter(Boolean);
          const lastLine = lines[lines.length - 1] || '';
          try { parsed = JSON.parse(lastLine); } catch { /* ok */ }
          if (parsed && parsed.status === 'alive') {
            resolve({ ok: true, status: 'active' });
          } else {
            resolve({ ok: false, error: 'no-result' });
          }
        });
      });
    } finally {
      job = { running: false, startedAt: null, child: null };
    }

    ctx.jsonResponse(res, 200, result);
  }

  // -- POST /session-login ---------------------------------------------------
  // Opens a visible browser on this machine (sharepoint_time_off.py --login) so
  // the person signs in once; the script saves the session and exits. Holds
  // the same job slot as /fetch-stream for the whole login. Synchronous:
  // answers when the window is closed or the login timed out.

  async function handleSessionLogin(_req, res) {
    if (IS_TEST_MODE) {
      ctx.jsonResponse(res, 409, { error: 'test-mode', message: 'The Python script is never started in test mode.' });
      return;
    }
    if (job.running) {
      ctx.jsonResponse(res, 409, { error: 'job-running', message: 'A download or sign-in is already running.' });
      return;
    }
    const py = await probePython();
    if (!py) {
      ctx.jsonResponse(res, 200, { ok: false, error: 'python-missing' });
      return;
    }
    if (job.running) {
      ctx.jsonResponse(res, 409, { error: 'job-running', message: 'A download or sign-in is already running.' });
      return;
    }
    job = { running: true, startedAt: new Date().toISOString(), child: null };

    const LOGIN_TIMEOUT_S = 300;
    const args = [...py.baseArgs, SCRIPT, '--login', '--session', SESSION_FILE, '--seed', SEED_FILE, '--headed-timeout', String(LOGIN_TIMEOUT_S)];
    const result = await new Promise((resolve) => {
      let child;
      try {
        child = spawn(py.cmd, args, {
          cwd: ctx.rootDir,
          // Nothing reads the child's output here: ignored rather than piped,
          // so a chatty Playwright cannot stall it on a full pipe buffer.
          stdio: 'ignore',
          detached: process.platform !== 'win32',
          env: childEnv(process.env),
        });
      } catch (_e) {
        resolve({ ok: false, error: 'spawn-failed' });
        return;
      }
      job.child = child;
      const deadline = setTimeout(() => {
        killTree(child);
        resolve({ ok: false, error: 'login-timeout' });
      }, (LOGIN_TIMEOUT_S + 60) * 1000);
      if (deadline.unref) deadline.unref();
      child.on('error', (e) => {
        clearTimeout(deadline);
        ctx.log('time-off: login-error:', e.message);
        resolve({ ok: false, error: 'spawn-failed' });
      });
      child.on('close', (code) => {
        clearTimeout(deadline);
        resolve(code === 0 && fs.existsSync(SESSION_FILE)
          ? { ok: true, status: 'active' }
          : { ok: false, error: 'login-failed' });
      });
    });
    job = { running: false, startedAt: null, child: null };
    ctx.jsonResponse(res, 200, result);
  }

  return {
    routes: [
      { method: 'GET', path: '/data', handler: handleData },
      { method: 'GET', path: '/status', handler: handleStatus },
      { method: 'GET', path: '/fetch-stream', handler: handleFetchStream },
      { method: 'POST', path: '/session-keepalive', handler: handleSessionKeepalive },
      { method: 'POST', path: '/session-login', handler: handleSessionLogin },
    ],
  };
};

module.exports.childEnv = childEnv;
module.exports.CHILD_ENV_ALLOW = CHILD_ENV_ALLOW;
module.exports.isConfigured = isConfigured;
