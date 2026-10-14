#!/usr/bin/env node
// scripts/readme-shots.mjs
// Captures the README screenshots: boots Mission Deck on a spare port in SAMPLE
// MODE (the fictional "Northwind Product" team, see docs/architecture/sample-mode.md),
// opens every view listed in docs/images/shots.json with Playwright and writes
// docs/images/<file>.png. Re-run it whenever the UI changes: docs/images/SHOTS.md.
//
//   node scripts/readme-shots.mjs [--only id,id] [--port 3777] [--list]
//
// Safe by construction: the server runs in test mode (no browser, no update, no
// restart), every folder it writes to lives in one temp directory
// (SAMPLE_DATA_DIR, MODULES_DIR ...), and the team data is the sample copy - your
// own data/ folder, modules/ folder and team data are never read or written.
//
// Playwright is not a dependency of this repo. It is found, in this order:
//   1. $PLAYWRIGHT_MODULE  - a path to a playwright (or playwright-core) package directory
//   2. `import('playwright')` / `import('playwright-core')` resolved from the repo
// and its browser must be installed (npm run setup, or `npx playwright install chromium`).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGES = path.join(ROOT, 'docs', 'images');
const SHOTS_FILE = path.join(IMAGES, 'shots.json');

export function parseArgs(argv) {
  const args = { only: null, port: 3777, list: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only' && argv[i + 1]) { args.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean); continue; }
    if (a === '--port' && argv[i + 1]) { args.port = Number(argv[++i]); continue; }
    if (a === '--list') { args.list = true; continue; }
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    throw new Error('unknown argument: ' + a);
  }
  if (!Number.isInteger(args.port) || args.port < 1024 || args.port > 65535) throw new Error('--port must be 1024-65535');
  return args;
}

/** The shot list, validated: every entry needs an id, a file name and a hash. */
export function loadShots(file = SHOTS_FILE) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const seen = new Set();
  for (const s of doc.shots || []) {
    if (!s.id || !/^[a-z0-9-]+$/.test(s.id)) throw new Error('shots.json: bad id ' + JSON.stringify(s.id));
    if (seen.has(s.id)) throw new Error('shots.json: duplicate id ' + s.id);
    seen.add(s.id);
    if (!s.file || !/^[a-z0-9-]+\.png$/.test(s.file)) throw new Error('shots.json: ' + s.id + ' needs a file like name.png');
    if (typeof s.hash !== 'string' && typeof s.url !== 'string') throw new Error('shots.json: ' + s.id + ' needs a hash (the view id) or a url');
  }
  return doc;
}

export async function loadPlaywright() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_MODULE) candidates.push(pathToFileURL(path.join(path.resolve(process.env.PLAYWRIGHT_MODULE), 'index.mjs')).href);
  for (const spec of ['playwright', 'playwright-core']) candidates.push(spec);
  for (const c of candidates) {
    try {
      const mod = await import(c);
      const chromium = mod.chromium || (mod.default && mod.default.chromium);
      if (chromium) return chromium;
    } catch { /* try the next one */ }
  }
  throw new Error('Playwright was not found. Run `npm run setup`, or set PLAYWRIGHT_MODULE to a playwright package folder.');
}

function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    }).on('error', reject);
  });
}

function post(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: urlPath, method: 'POST', headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end('{}');
  });
}

async function waitUp(port, ms = 30000) {
  const end = Date.now() + ms;
  for (;;) {
    try { if ((await get(port, '/api/app/version')).status === 200) return; } catch { /* not yet */ }
    if (Date.now() > end) throw new Error('the server on port ' + port + ' did not start');
    await new Promise((r) => setTimeout(r, 200));
  }
}

// An allowlist, never the whole parent environment: the server needs a shell
// path, a home, temp dirs, locale and TLS/proxy settings, nothing else.
const CHILD_ENV_ALLOW = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'LC_CTYPE', 'SHELL',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
  'SystemRoot', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA',
];
function childEnv(extra) {
  const out = {};
  for (const key of CHILD_ENV_ALLOW) if (process.env[key] !== undefined) out[key] = process.env[key];
  return { ...out, ...extra };
}

function startServer(port, env) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server.js'), String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: childEnv({ PORT: String(port), NODE_ENV: 'test', TEST_DISABLE_RESTART: '1', ...env }),
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } resolve(); }, 4000);
    child.on('exit', () => { clearTimeout(t); resolve(); });
  });
}

/** Everything the server writes goes into `work`; nothing of the real install is touched. */
function sandboxEnv(work) {
  return {
    SAMPLE_DATA_DIR: path.join(work, 'data'),
    MODULES_DIR: path.join(work, 'modules'),
    MODULES_DATA_DIR: path.join(work, 'modules-data'),
    MODULES_ORIGIN_FILE: path.join(work, 'modules-origin.json'),
    MODULES_REGISTRY_FILE: path.join(work, 'modules-registry.json'),
    MODULES_CATALOG_REPO_URL: '',
    COCKPIT_MODULES_TOKEN: '',
    COCKPIT_APP_TOKEN: '',
    GITLAB_API_BASE_URL: 'http://127.0.0.1:9/api/v4',
    DASHBOARD_LAYOUT_FILE: path.join(work, 'dashboard-layout.json'),
    // The server also reads <repo>/.env; a variable already set wins over it, so a
    // shot can never show a real host from a developer's .env.
    JIRA_URL: 'https://jira.example.com',
    CONFLUENCE_BASE_URL: 'https://confluence.example.com',
    PROTO_BUILD_REPO_URL: '',
    PROTO_PAGES_BASE_URL: 'https://pages.example.com',
    DATA_TIER_0_REPO_URL: '',
    COCKPIT_DATA_TOKEN: '',
    PROTO_DEPLOY_TOKEN: '',
    DATA_TIER_0_DIR: '',
    DATA_SUB_REPOS_DIR: '',
  };
}

/**
 * Who the app greets: a sample person, never the git name of whoever runs the
 * script. GIT_CONFIG_* is git's own per-process override, above every config file.
 * @param {string|undefined} name
 */
export function identityEnv(name) {
  if (!name) return {};
  return { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: String(name) };
}

async function runAction(page, action) {
  if (action.click) { await page.click(action.click); return; }
  if (action.clickIfPresent) {
    const el = page.locator(action.clickIfPresent).first();
    if (await el.isVisible()) await el.click();
    return;
  }
  if (action.fill) { await page.fill(action.fill[0], action.fill[1]); return; }
  if (action.press) { await page.keyboard.press(action.press); return; }
  if (action.waitFor) { await page.waitForSelector(action.waitFor, { timeout: 15000 }); return; }
  if (action.waitMs) { await page.waitForTimeout(action.waitMs); return; }
  if (action.hide) {
    await page.addStyleTag({ content: action.hide + ' { visibility: hidden !important; }' });
    return;
  }
  if (action.scrollIntoView) { await page.locator(action.scrollIntoView).first().scrollIntoViewIfNeeded(); return; }
  throw new Error('unknown action ' + JSON.stringify(action));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/readme-shots.mjs [--only id,id] [--port 3777] [--list]\nWrites docs/images/<file>.png (see docs/images/SHOTS.md).');
    return;
  }
  const doc = loadShots();
  const wanted = (doc.shots || []).filter((s) => !args.only || args.only.includes(s.id));
  if (args.list) { for (const s of doc.shots) console.log(s.id.padEnd(24) + ' ' + (s.url || '#' + s.hash) + '  ->  ' + s.file); return; }
  if (!wanted.length) throw new Error('no shot matches --only');

  const chromium = await loadPlaywright();
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mission-deck-shots-'));
  const env = { ...sandboxEnv(work), ...identityEnv(doc.identity) };
  fs.mkdirSync(env.MODULES_DIR, { recursive: true });
  fs.mkdirSync(env.SAMPLE_DATA_DIR, { recursive: true });
  // the dashboard tiles of the dashboard shot (a per-machine file, here a temp one)
  if (Array.isArray(doc.dashboardLayout)) {
    fs.writeFileSync(env.DASHBOARD_LAYOUT_FILE, JSON.stringify({ version: 1, items: doc.dashboardLayout }, null, 2));
  }
  let server = null;
  let browser = null;
  try {
    // 1. enter sample mode (copies the data, installs the modules, writes the marker)
    server = startServer(args.port, env);
    await waitUp(args.port);
    const entered = await post(args.port, '/api/sample-mode/enter');
    if (entered.status !== 200) throw new Error('could not enter sample mode: ' + entered.text);
    await stopServer(server);
    // 2. boot again: the marker is read at boot
    server = startServer(args.port, env);
    await waitUp(args.port);
    const status = JSON.parse((await get(args.port, '/api/sample-mode')).text);
    if (!status.active) throw new Error('the server did not start in sample mode');

    browser = await chromium.launch();
    const viewport = doc.viewport || { width: 1280, height: 800 };
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: 'light', locale: 'en-US', timezoneId: 'UTC' });
    // The sample team's quarter ends on doc.clock: with the real date every
    // "today" (the roadmap's day strip, overdue labels) would land past the data.
    if (doc.clock) await context.clock.setFixedTime(new Date(doc.clock));
    await context.addInitScript(() => {
      try {
        localStorage.setItem('cockpit-theme', 'light');
        localStorage.setItem('cockpit.sidebarCollapsed', '0');
        localStorage.setItem('cockpit.analytics.optOut', '1');
      } catch { /* private mode */ }
    });
    const page = await context.newPage();
    const base = 'http://127.0.0.1:' + args.port;
    fs.mkdirSync(IMAGES, { recursive: true });
    let total = 0;
    for (const shot of wanted) {
      await page.setViewportSize(shot.viewport || viewport);
      await page.goto(base + (shot.url || '/#' + shot.hash), { waitUntil: 'load' });
      if (shot.waitFor) await page.waitForSelector(shot.waitFor, { timeout: 20000 });
      for (const a of (doc.everyShot || []).concat(shot.actions || [])) await runAction(page, a);
      await page.waitForTimeout(shot.settleMs === undefined ? 700 : shot.settleMs);
      const out = path.join(IMAGES, shot.file);
      const opts = { path: out, type: 'png', animations: 'disabled', caret: 'hide' };
      if (shot.selector) await page.locator(shot.selector).first().screenshot(opts);
      else await page.screenshot({ ...opts, ...(shot.clip ? { clip: shot.clip } : {}), fullPage: false });
      const size = fs.statSync(out).size;
      total += size;
      console.log(shot.id.padEnd(24) + ' ' + (size / 1024).toFixed(0).padStart(5) + ' KB  ' + path.relative(ROOT, out));
    }
    console.log('total ' + (total / 1024 / 1024).toFixed(2) + ' MB');
  } finally {
    if (browser) await browser.close().catch(() => {});
    await stopServer(server);
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
