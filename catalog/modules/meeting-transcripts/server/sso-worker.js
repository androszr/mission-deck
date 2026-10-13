'use strict';
// modules/meeting-transcripts/server/sso-worker.js
// The ONE file of this module that requires 'playwright' (reached through
// npm exec, see playwright-lib.js; never a repo dependency). Adapted from the
// locations module's sso-worker.js - copied, never imported (trust
// boundary, modules-template/README.md).
//
// Reads ONE line of JSON config from stdin (built by sso-runner.js from the
// validated settings - nothing here comes straight from an HTTP request) and
// writes newline-delimited JSON events to stdout. Cookie values never reach
// a pipe or a log. Two modes:
//   login - headed; a silent attempt from the session / shared seed first.
//           After the person signs in, every configured personal site is
//           visited once: each personal OneDrive site (`/personal/<u>`)
//           is its own site collection with its own FedAuth cookie.
//   scan  - headless. Per folder: open the site (SSO mints the cookie),
//           list the folder over SharePoint REST, pick new recordings
//           (onedrive-lib.pickNewFiles) and download each through
//           _layouts/15/download.aspx straight to disk (Playwright streams a
//           download to a file - a 1 GB recording never sits in memory).
//   keepalive - headless. Opens every configured site once and probes it
//           over REST, so SSO re-issues each site's cookie while the
//           Microsoft sign-in is still valid; saves the refreshed jar.
//           Nothing is listed or downloaded.

const fs = require('fs');
const path = require('path');
const lib = require('./onedrive-lib.js');

function emit(name, fields) {
  process.stdout.write(JSON.stringify({ event: name, ...(fields || {}) }) + '\n');
}

function readConfigFromStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => { data += c; });
    process.stdin.on('end', () => { try { resolve(JSON.parse(data.split('\n')[0])); } catch (e) { reject(e); } });
    process.stdin.on('error', reject);
  });
}

function isLoginUrl(url) {
  let host;
  try { host = new URL(url).host; } catch { return false; }
  return lib.LOGIN_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}

function fileExists(p) {
  try { return Boolean(p) && fs.statSync(p).isFile(); } catch { return false; }
}

function sleep(ms) { return new Promise((r) => { setTimeout(r, ms); }); }

let currentBrowser = null;

async function launchBrowser(chromium, channels, headless) {
  for (const channel of channels || []) {
    try {
      currentBrowser = await chromium.launch({ channel, headless });
      emit('browser-try', { channel, ok: true });
      return currentBrowser;
    } catch (e) {
      emit('browser-try', { channel, ok: false, reason: String((e && e.message) || e).slice(0, 200) });
    }
  }
  try {
    currentBrowser = await chromium.launch({ headless });
    emit('browser-try', { channel: 'chromium', ok: true });
    return currentBrowser;
  } catch (e) {
    emit('browser-try', { channel: 'chromium', ok: false, reason: String((e && e.message) || e).slice(0, 200) });
  }
  return null;
}

async function closeBrowser() {
  if (currentBrowser) await currentBrowser.close().catch(() => {});
  currentBrowser = null;
}

/** Union of cookies of two storage states, expired ones dropped. */
function mergeStorageStates(base, add, nowSec) {
  const merged = new Map();
  for (const state of [base || {}, add || {}]) {
    for (const c of state.cookies || []) {
      if (!c || typeof c.name !== 'string' || typeof c.domain !== 'string') continue;
      if (typeof c.expires === 'number' && c.expires > 0 && c.expires < nowSec) continue;
      merged.set(c.name + '\u0000' + c.domain + '\u0000' + (c.path || '/'), c);
    }
  }
  return { cookies: [...merged.values()], origins: [] };
}

function writeSecret(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
  try { fs.chmodSync(tmp, 0o600); } catch { /* win32 */ }
  fs.renameSync(tmp, file);
}

async function saveState(context, config) {
  const state = await context.storageState();
  writeSecret(config.sessionPath, state);
  if (config.seedPath) {
    try {
      let base = {};
      try { base = JSON.parse(fs.readFileSync(config.seedPath, 'utf8')); } catch { base = {}; }
      writeSecret(config.seedPath, mergeStorageStates(base, state, Date.now() / 1000));
    } catch { /* the seed is best-effort */ }
  }
}

function storageFor(config) {
  if (fileExists(config.sessionPath)) {
    // Our own jar plus whatever other SSO modules learned since.
    try {
      const own = JSON.parse(fs.readFileSync(config.sessionPath, 'utf8'));
      const seed = fileExists(config.seedPath) ? JSON.parse(fs.readFileSync(config.seedPath, 'utf8')) : {};
      return mergeStorageStates(seed, own, Date.now() / 1000);
    } catch { /* fall through */ }
  }
  if (fileExists(config.seedPath)) {
    try { return JSON.parse(fs.readFileSync(config.seedPath, 'utf8')); } catch { return undefined; }
  }
  return undefined;
}

const NETWORK_ERROR_RE = /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|net::ERR_|getaddrinfo|socket hang up/i;

/**
 * Open the personal site so SSO sets its FedAuth cookie.
 * @returns {Promise<'ok'|'login'|'offline'>}
 */
async function warmSite(page, siteUrl, timeouts) {
  try {
    await page.goto(siteUrl + '/_layouts/15/onedrive.aspx', { waitUntil: 'domcontentloaded', timeout: timeouts.goto });
  } catch (e) {
    if (NETWORK_ERROR_RE.test(String(e && e.message))) return 'offline';
  }
  // SSO may bounce through login.microsoftonline.com and come back on its own.
  for (let i = 0; i < 10 && isLoginUrl(page.url()); i++) await sleep(1000);
  if (isLoginUrl(page.url())) {
    // "Pick an account" with an already signed-in tile: one click continues
    // silently. A password or MFA prompt stays a real login.
    const tile = page.locator('#tilesHolder [role="button"], [data-test-id="accountTile"], .table[role="button"]').first();
    if (await tile.isVisible({ timeout: 2000 }).catch(() => false)) {
      await tile.click({ timeout: 3000 }).catch(() => {});
      for (let i = 0; i < 15 && isLoginUrl(page.url()); i++) await sleep(1000);
    }
  }
  return isLoginUrl(page.url()) ? 'login' : 'ok';
}

async function restJson(context, url, timeout) {
  const resp = await context.request.get(url, { headers: { Accept: 'application/json;odata=nometadata' }, timeout, maxRedirects: 0 });
  const status = resp.status();
  if (status === 401 || status === 403 || (status >= 300 && status < 400)) return { kind: 'denied', status };
  if (status === 404) return { kind: 'missing', status };
  if (!resp.ok()) return { kind: 'error', status };
  try { return { kind: 'ok', body: await resp.json() }; } catch { return { kind: 'denied', status }; }
}

function odataPath(p) {
  return encodeURIComponent(String(p).replace(/'/g, "''"));
}

// -- login -----------------------------------------------------------------------

async function runLogin(chromium, config) {
  const t = config.timeouts;
  const sites = [...new Set(config.folders.map((f) => f.siteUrl))];
  const first = sites[0] || config.defaultSiteUrl;
  const storage = storageFor(config);

  // Silent: the saved session or the seed of another SSO module may suffice.
  if (storage) {
    emit('login-silent-try', {});
    const browser = await launchBrowser(chromium, config.channels, true);
    if (browser) {
      try {
        const context = await browser.newContext({ storageState: storage });
        const page = await context.newPage();
        let ok = true;
        for (const site of sites.length ? sites : [first]) {
          if (await warmSite(page, site, t) !== 'ok') { ok = false; break; }
        }
        if (ok) {
          await saveState(context, config);
          for (const site of sites) emit('site-ok', { site });
          emit('login-ok', { silent: true, sites: sites.length });
          await closeBrowser();
          return 0;
        }
      } catch { /* go headed */ }
      await closeBrowser();
    }
  }

  const browser = await launchBrowser(chromium, config.channels, false);
  if (!browser) { emit('fatal', { code: 'browser-missing' }); return 1; }
  const context = await browser.newContext(storage ? { storageState: storage } : {});
  const page = await context.newPage();
  const deadline = Date.now() + t.login;
  await page.goto(first + '/_layouts/15/onedrive.aspx', { waitUntil: 'domcontentloaded', timeout: t.goto }).catch(() => {});
  emit('login-waiting', {});
  for (;;) {
    if (Date.now() > deadline) { emit('fatal', { code: 'login-timeout' }); await closeBrowser(); return 1; }
    if (page.isClosed()) { emit('fatal', { code: 'login-closed' }); await closeBrowser(); return 1; }
    if (!isLoginUrl(page.url())) {
      const probe = await restJson(context, first + '/_api/web?$select=Title', t.rest).catch(() => null);
      if (probe && probe.kind === 'ok') break;
    }
    await sleep(2000);
  }
  emit('site-ok', { site: first });
  // One visit per personal site: each needs its own cookie.
  for (const site of sites.slice(1)) {
    const r = await warmSite(page, site, t);
    emit(r === 'ok' ? 'site-ok' : 'site-expired', { site });
  }
  await saveState(context, config);
  emit('login-ok', { silent: false, sites: sites.length });
  await closeBrowser();
  return 0;
}

// -- scan ------------------------------------------------------------------------

async function downloadOne(context, folder, file, config) {
  const page = await context.newPage();
  const dest = path.join(config.inboxDir, file.uniqueId + lib.extOf(file.name));
  const part = dest + '.part';
  try {
    const url = folder.siteUrl + '/_layouts/15/download.aspx?UniqueId=' + encodeURIComponent(file.uniqueId);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: config.timeouts.downloadStart }),
      page.goto(url, { timeout: config.timeouts.goto }).catch(() => null), // "Download is starting" rejects goto
    ]);
    await download.saveAs(part);
    const failure = await download.failure();
    if (failure) throw new Error(failure);
    const size = fs.statSync(part).size;
    if (file.size && size !== file.size) throw new Error('size mismatch ' + size + ' != ' + file.size);
    fs.renameSync(part, dest);
    return { ok: true, file: path.basename(dest), size };
  } catch (e) {
    try { fs.rmSync(part, { force: true }); } catch { /* none */ }
    if (isLoginUrl(page.url())) return { ok: false, error: 'session-expired' };
    return { ok: false, error: String((e && e.message) || e).slice(0, 200) };
  } finally {
    await page.close().catch(() => {});
  }
}

async function runScan(chromium, config) {
  const t = config.timeouts;
  const storage = storageFor(config);
  if (!storage) { emit('session-expired', { reason: 'no-session' }); return 0; }
  const browser = await launchBrowser(chromium, config.channels, true);
  if (!browser) { emit('fatal', { code: 'browser-missing' }); return 1; }
  const context = await browser.newContext({ storageState: storage, acceptDownloads: true });
  const page = await context.newPage();
  fs.mkdirSync(config.inboxDir, { recursive: true });
  const known = new Set(config.known || []);
  const archivedNames = new Set(config.archivedNames || []);
  let budget = config.maxFiles;
  let expired = false;

  for (const folder of config.folders) {
    if (expired) break;
    const warm = await warmSite(page, folder.siteUrl, t);
    if (warm === 'offline') { emit('offline', {}); break; }
    if (warm === 'login') { emit('session-expired', { folderId: folder.id, site: folder.siteUrl }); expired = true; break; }
    emit('site-ok', { site: folder.siteUrl });
    const base = folder.siteUrl + "/_api/web/GetFolderByServerRelativeUrl('" + odataPath(folder.serverRelativePath) + "')/Files";
    let listed = await restJson(context, base + '?$select=Name,Length,TimeLastModified,TimeCreated,UniqueId&$top=5000', t.rest).catch((e) => ({ kind: 'error', message: e.message }));
    if (listed.kind === 'error') listed = await restJson(context, base + '?$top=5000', t.rest).catch((e) => ({ kind: 'error', message: e.message }));
    if (listed.kind !== 'ok') {
      emit('folder-error', { folderId: folder.id, code: listed.kind === 'denied' ? 'no-access' : listed.kind === 'missing' ? 'missing' : 'error', status: listed.status || 0 });
      continue;
    }
    const files = (listed.body && (listed.body.value || (listed.body.d && listed.body.d.results))) || [];
    const picked = lib.pickNewFiles(files, {
      minBytes: config.minBytes, sinceIso: config.sinceIso, known, archivedNames, nowMs: Date.now(),
    });
    emit('folder-listed', { folderId: folder.id, files: files.length, fresh: picked.take.length, skipped: picked.skipped.length });
    for (const s of picked.skipped) {
      if (s.reason === 'archived') emit('file-archived', { folderId: folder.id, uniqueId: s.uniqueId, name: s.name });
    }
    for (const file of picked.take) {
      if (budget <= 0) { emit('budget-reached', { folderId: folder.id }); break; }
      emit('file-start', { folderId: folder.id, name: file.name, size: file.size });
      let r = await downloadOne(context, folder, file, config);
      if (!r.ok && r.error !== 'session-expired') r = await downloadOne(context, folder, file, config); // one retry
      if (!r.ok) {
        if (r.error === 'session-expired') { emit('session-expired', { folderId: folder.id }); expired = true; break; }
        emit('file-error', { folderId: folder.id, uniqueId: file.uniqueId, name: file.name, message: r.error });
        continue;
      }
      budget -= 1;
      known.add(file.uniqueId);
      emit('file-downloaded', {
        folderId: folder.id, uniqueId: file.uniqueId, name: file.name, size: r.size,
        created: file.created, modified: file.modified, file: r.file,
      });
    }
  }
  if (!expired) await saveState(context, config).catch(() => {});
  await closeBrowser();
  emit('scan-done', { expired });
  return 0;
}

// -- keepalive -------------------------------------------------------------------

async function runKeepalive(chromium, config) {
  const t = config.timeouts;
  const storage = storageFor(config);
  if (!storage) { emit('keepalive-done', { ok: 0, expired: 0, reason: 'no-session' }); return 0; }
  const browser = await launchBrowser(chromium, config.channels, true);
  if (!browser) { emit('fatal', { code: 'browser-missing' }); return 1; }
  const context = await browser.newContext({ storageState: storage });
  const page = await context.newPage();
  let ok = 0;
  let expired = 0;
  for (const site of [...new Set(config.folders.map((f) => f.siteUrl))]) {
    const warm = await warmSite(page, site, t);
    if (warm === 'offline') { emit('offline', {}); break; }
    let alive = warm === 'ok';
    if (alive) {
      const probe = await restJson(context, site + '/_api/web?$select=Title', t.rest).catch(() => null);
      alive = !!probe && probe.kind === 'ok';
    }
    emit(alive ? 'site-ok' : 'site-expired', { site });
    if (alive) ok++; else expired++;
  }
  if (ok) await saveState(context, config).catch(() => {});
  await closeBrowser();
  emit('keepalive-done', { ok, expired });
  return 0;
}

async function main() {
  let config;
  try { config = await readConfigFromStdin(); } catch { emit('fatal', { code: 'bad-config' }); return 2; }
  let chromium;
  try { ({ chromium } = require('playwright')); } catch { emit('fatal', { code: 'playwright-unavailable' }); return 1; }
  if (config.mode === 'login') return runLogin(chromium, config);
  if (config.mode === 'scan') return runScan(chromium, config);
  if (config.mode === 'keepalive') return runKeepalive(chromium, config);
  emit('fatal', { code: 'bad-mode' });
  return 2;
}

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { closeBrowser().finally(() => process.exit(1)); });
}

main().then((code) => process.exit(code), (e) => {
  emit('fatal', { code: 'worker-crashed', message: String((e && e.message) || e).slice(0, 200) });
  closeBrowser().finally(() => process.exit(1));
});
