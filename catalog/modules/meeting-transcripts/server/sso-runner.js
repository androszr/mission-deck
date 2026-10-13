'use strict';
// modules/meeting-transcripts/server/sso-runner.js
// Spawns sso-worker.js (login | scan) with the Playwright library found by
// playwright-lib.js. Adapted from the locations module's sso-runner.js -
// copied, never imported (trust boundary).
//
// Everything SSO touches lives under ctx.dataDir/sso/ (gitignored, NEVER a
// team data repo: that tree is encrypted and pushed to the whole team). The
// shared Microsoft seed data/sso-shared/microsoft-session.json is the union
// of every SSO module's cookies on this machine, so one login in any module
// usually lets this one sign in silently.

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { resolveNodeModules, killTree, childEnv } = require('./playwright-lib.js');
const { availableChannels } = require('./browser-channels.js');

const TIMEOUTS_MS = Object.freeze({
  login: 10 * 60 * 1000,
  scan: 4 * 60 * 60 * 1000,
  keepalive: 10 * 60 * 1000,
  discovery: 120000,
  goto: 30000,
  rest: 20000,
  downloadStart: 120000,
});
const SESSION_STALE_AFTER_MS = 7 * 24 * 3600 * 1000;

function ssoPaths(dataDir) {
  const dir = path.join(dataDir, 'sso');
  return { dir, session: path.join(dir, 'sso-session.json'), meta: path.join(dir, 'sso-session-meta.json') };
}

function seedPath(rootDir) {
  return path.join(rootDir, 'data', 'sso-shared', 'microsoft-session.json');
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/**
 * @param {{rootDir: string, dataDir: string, log: Function}} ctx
 * @param {{spawn?: Function, resolveNodeModules?: Function}} [inject] tests
 */
function createSsoRunner(ctx, inject) {
  const spawnFn = (inject && inject.spawn) || cp.spawn;
  const resolveLib = (inject && inject.resolveNodeModules) || resolveNodeModules;
  let running = null; // 'login' | 'scan' | null
  let child = null;
  let lastLogin = null; // {at, ok, error}

  function playwrightNodeModules() {
    return resolveLib({
      rootDir: ctx.rootDir,
      dataDir: ctx.dataDir,
      platform: process.platform,
      run: ({ cmd, args, shell, env }) => new Promise((resolve, reject) => {
        const c = cp.spawn(cmd, args, { shell, env, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
          killTree(c, process.platform, cp.spawn);
          const err = new Error('npm exec playwright discovery timed out');
          err.code = 'playwright-unavailable';
          reject(err);
        }, TIMEOUTS_MS.discovery);
        if (timer.unref) timer.unref();
        c.stdout.on('data', (d) => { stdout += d; });
        c.stderr.on('data', (d) => { stderr += d; });
        c.on('close', () => { clearTimeout(timer); resolve({ stdout, stderr }); });
        c.on('error', (e) => { clearTimeout(timer); reject(e); });
      }),
    });
  }

  function sessionInfo() {
    const p = ssoPaths(ctx.dataDir);
    const present = fs.existsSync(p.session);
    const meta = readJsonSafe(p.meta) || {};
    let loggedInAt = meta.loggedInAt || null;
    if (!loggedInAt && present) { try { loggedInAt = fs.statSync(p.session).mtime.toISOString(); } catch { /* none */ } }
    const age = loggedInAt ? Date.now() - Date.parse(loggedInAt) : null;
    return {
      present,
      seedPresent: fs.existsSync(seedPath(ctx.rootDir)),
      loggedInAt,
      stale: present && age !== null && age > SESSION_STALE_AFTER_MS,
      expiredAt: meta.expiredAt || null,
      keepaliveAt: meta.keepaliveAt || null,
      sites: meta.sites && typeof meta.sites === 'object' ? meta.sites : {},
      running,
      lastLogin,
    };
  }

  function markMeta(patch) {
    const p = ssoPaths(ctx.dataDir);
    const meta = { ...(readJsonSafe(p.meta) || {}), ...patch };
    fs.mkdirSync(p.dir, { recursive: true, mode: 0o700 });
    const tmp = p.meta + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(meta), { mode: 0o600 });
    fs.renameSync(tmp, p.meta);
  }

  /**
   * One worker run. Resolves with every event; never rejects.
   * @param {'login'|'scan'} mode
   * @param {object} patch server-built config (folders, inboxDir, filters...)
   * @param {{onEvent?: Function}} [opts]
   */
  async function runWorker(mode, patch, opts) {
    const o = opts || {};
    if (running) return { events: [], busy: true, error: 'busy' };
    running = mode;
    const events = [];
    try {
      let nodeModulesDir;
      try { nodeModulesDir = await playwrightNodeModules(); } catch (e) {
        return { events, error: (e && e.code) || 'playwright-unavailable' };
      }
      const p = ssoPaths(ctx.dataDir);
      const config = {
        ...patch, mode,
        sessionPath: p.session,
        seedPath: seedPath(ctx.rootDir),
        channels: availableChannels(process.platform, process.env, fs.existsSync),
        timeouts: TIMEOUTS_MS,
      };
      const env = childEnv(process.env);
      env.NODE_PATH = nodeModulesDir;
      return await new Promise((resolve) => {
        const c = spawnFn(process.execPath, [path.join(__dirname, 'sso-worker.js')], {
          env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32',
        });
        child = c;
        let settled = false;
        const finish = (exitCode, error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          child = null;
          resolve({ events, exitCode, error: error || undefined });
        };
        const timer = setTimeout(() => { killTree(c, process.platform, spawnFn); finish(null, 'timeout'); },
          (TIMEOUTS_MS[mode] || TIMEOUTS_MS.scan) + 60000);
        if (timer.unref) timer.unref();
        c.on('error', () => finish(null, 'worker-exited'));
        c.stderr.on('data', (d) => ctx.log('[onedrive-worker]', String(d).trim().slice(0, 300)));
        c.stdin.on('error', () => { /* reported by close */ });
        c.stdin.end(JSON.stringify(config) + '\n');
        let buf = '';
        // Decode as a stream: a Polish file name split across two chunks must
        // not turn into replacement characters.
        c.stdout.setEncoding('utf8');
        c.stdout.on('data', (chunk) => {
          buf += chunk;
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines.filter(Boolean)) {
            let ev;
            try { ev = JSON.parse(line); } catch { continue; }
            events.push(ev);
            try {
              const now = new Date().toISOString();
              if (ev.event === 'login-ok') markMeta({ loggedInAt: now, expiredAt: null });
              if (ev.event === 'session-expired') markMeta({ expiredAt: now });
              if ((ev.event === 'site-ok' || ev.event === 'site-expired' || ev.event === 'session-expired') && typeof ev.site === 'string') {
                const sites = (readJsonSafe(p.meta) || {}).sites || {};
                sites[ev.site] = { ok: ev.event === 'site-ok', at: now };
                markMeta({ sites });
              }
              if (ev.event === 'keepalive-done') {
                markMeta(ev.expired ? { keepaliveAt: now, expiredAt: now } : { keepaliveAt: now, expiredAt: null });
              }
            } catch { /* best-effort */ }
            if (typeof o.onEvent === 'function') { try { o.onEvent(ev); } catch { /* listener */ } }
          }
        });
        c.on('close', (code) => finish(code));
      });
    } finally {
      running = null;
    }
  }

  /**
   * Headless keepalive of every site; resolves {ok, expired} or {busy|error}.
   * @param {object[]} folders enabled folders
   */
  async function keepalive(folders) {
    const r = await runWorker('keepalive', { folders });
    if (r.busy || r.error) return { ok: 0, expired: 0, error: r.error || 'busy' };
    const done = r.events.find((e) => e.event === 'keepalive-done') || {};
    return { ok: done.ok || 0, expired: done.expired || 0 };
  }

  /** Headed login in the background; the window stays open for minutes. */
  async function startLogin(folders) {
    if (running) return { ok: false, error: 'busy' };
    try { await playwrightNodeModules(); } catch (e) {
      return { ok: false, error: (e && e.code) || 'playwright-unavailable', message: e && e.message };
    }
    lastLogin = { at: new Date().toISOString(), ok: null, error: null };
    runWorker('login', { folders, defaultSiteUrl: folders[0] ? folders[0].siteUrl : '' }).then((r) => {
      const ok = r.events.some((e) => e.event === 'login-ok');
      const fatal = r.events.find((e) => e.event === 'fatal');
      lastLogin = { at: new Date().toISOString(), ok, error: ok ? null : ((fatal && fatal.code) || r.error || 'login-failed') };
    }).catch((e) => ctx.log('login worker failed: ' + (e && e.message)));
    return { ok: true };
  }

  function stop() {
    if (child) killTree(child, process.platform, spawnFn);
  }

  return { runWorker, startLogin, keepalive, sessionInfo, isRunning: () => running, stop, playwrightNodeModules };
}

module.exports = { createSsoRunner, TIMEOUTS_MS, ssoPaths, seedPath };
