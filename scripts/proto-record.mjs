#!/usr/bin/env node
// scripts/proto-record.mjs
// Records the pictures of a briefing prototype from the REAL clickable
// prototypes, and smoke-checks that a built briefing shows its pictures.
//
//   node scripts/proto-record.mjs --briefing <dir> --base <url> [--out <dir>] [--only id,id] [--json]
//   node scripts/proto-record.mjs --check-frames <briefing dir> --base <url> [--json]
//
// record (default)
//   Reads <briefing dir>/recording.json ({ "steps": [ { id, proto, device,
//   frames: [ { state?, cur?, act?, cam?, key?, ms } ] } ] }). For every step
//   it opens the prototype bare (`<base>/<slug>?chrome=0&state=<state>`), runs
//   each frame's action and takes a JPEG. It writes <out>/<step id>-NN.jpg and
//   <out>/<step id>.json; `scripts/proto-build-content.mjs` turns those into
//   the briefing's frames, camera, cursor and event tracks.
//
// --check-frames
//   Opens the briefing bare in its `screen` and `phone` demo states and exits
//   1 when no picture is on the page, a picture failed to load
//   (naturalWidth === 0) or the page raised an error.
//
// Locator language (visible text and aria-labels, never generated classes):
//   a=<text>    element whose aria-label contains <text>
//   b=<text>    button whose accessible name matches <text> (case-insensitive)
//   t=<text>    first VISIBLE element containing <text>
//   tab=<text>  tab by name         cb=<text>  checkbox by name
//   ph=<text>   input by placeholder   css=<sel>  CSS selector
// Actions: click:<loc> hover:<loc> key:<Key> type:<text> wheel:<dy> wait:<ms>
//
// --base is the address of a running preview: the local preview the cockpit
// started (http://localhost:<PROTO_VITE_PORT>/<slug>) or `vite preview` of a
// built shell. Only its origin is used; the slug of each prototype is its id
// without the `proto-` prefix.
//
// Playwright comes from the build shell's node_modules (--shell <dir>,
// default POC_PAGES_DATA_DIR or data-sub-repositories/data-prototypes). The
// browser: PW_CHROMIUM_PATH, else a Chromium found under the folder
// scripts/_playwright-paths.js names. Node built-ins plus that Playwright only.
//
// Exit: 0 ok, 1 a step or check failed, 2 usage error or no browser/preview.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

export const DEVICES = {
  desktop: { viewport: { width: 1536, height: 960 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 },
};

const LOCATOR_KINDS = ['a', 'b', 't', 'tab', 'cb', 'ph', 'css'];
const ACTION_KINDS = ['click', 'hover', 'key', 'type', 'wheel', 'wait'];

class UsageError extends Error {}

// ---- pure parts (tested without a browser) ---------------------------------

/** "b=Save" -> { kind: 'b', value: 'Save' }. Throws on an unknown kind. */
export function parseLocator(spec) {
  const text = String(spec ?? '');
  const i = text.indexOf('=');
  const kind = i === -1 ? '' : text.slice(0, i);
  if (!LOCATOR_KINDS.includes(kind) || i === text.length - 1) throw new Error(`unknown locator "${text}"`);
  return { kind, value: text.slice(i + 1) };
}

/** "click:b=Save" -> { kind: 'click', value: 'b=Save' }. Throws on an unknown kind. */
export function parseAction(action) {
  const text = String(action ?? '');
  const i = text.indexOf(':');
  const kind = i === -1 ? '' : text.slice(0, i);
  if (!ACTION_KINDS.includes(kind)) throw new Error(`unknown action "${text}"`);
  const value = text.slice(i + 1);
  if ((kind === 'click' || kind === 'hover') && !value) throw new Error(`action "${text}" needs a locator`);
  if (kind === 'click' || kind === 'hover') parseLocator(value);
  return { kind, value };
}

/** Problems of a recording.json object (empty list = valid). */
export function validateRecording(rec) {
  const problems = [];
  if (!rec || typeof rec !== 'object' || Array.isArray(rec) || !Array.isArray(rec.steps)) {
    return ['recording.json must be an object with a "steps" array'];
  }
  const seen = new Set();
  rec.steps.forEach((step, si) => {
    const at = `steps[${si}]`;
    if (!step || typeof step !== 'object') { problems.push(`${at} is not an object`); return; }
    if (typeof step.id !== 'string' || !/^[a-z0-9-]+$/.test(step.id)) problems.push(`${at}.id must be ASCII kebab-case`);
    else if (seen.has(step.id)) problems.push(`${at}.id "${step.id}" is used twice`);
    else seen.add(step.id);
    if (typeof step.proto !== 'string' || !/^proto-[a-z0-9]+$/.test(step.proto)) problems.push(`${at}.proto must be a prototype id (proto-...)`);
    if (!Object.prototype.hasOwnProperty.call(DEVICES, step.device)) problems.push(`${at}.device must be one of ${Object.keys(DEVICES).join(', ')}`);
    if (!Array.isArray(step.frames) || step.frames.length === 0) { problems.push(`${at}.frames must be a non-empty array`); return; }
    step.frames.forEach((f, fi) => {
      const fat = `${at}.frames[${fi}]`;
      if (!f || typeof f !== 'object') { problems.push(`${fat} is not an object`); return; }
      if (!(typeof f.ms === 'number' && f.ms > 0)) problems.push(`${fat}.ms must be a positive number`);
      if (fi === 0 && typeof f.state !== 'string') problems.push(`${fat}.state is required on the first frame`);
      if (f.state !== undefined && !(typeof f.state === 'string' && /^[a-z0-9-]+$/.test(f.state))) problems.push(`${fat}.state must be ASCII kebab-case`);
      for (const key of ['cur', 'cam']) {
        if (f[key] === undefined) continue;
        try { parseLocator(f[key]); } catch (e) { problems.push(`${fat}.${key}: ${e.message}`); }
      }
      if (f.act !== undefined) {
        try { parseAction(f.act); } catch (e) { problems.push(`${fat}.act: ${e.message}`); }
      }
    });
  });
  return problems;
}

/** The slug of a prototype id: the id without its `proto-` prefix. */
export function slugOf(protoId) {
  return String(protoId).replace(/^proto-/, '');
}

/** Origin of --base (the slug part of a local-preview address is ignored). */
export function baseOrigin(base) {
  let u;
  try { u = new URL(String(base)); } catch { throw new UsageError(`--base is not an address: ${base}`); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UsageError(`--base must be http or https: ${base}`);
  return u.origin;
}

/** The address that opens one prototype bare in one demo state. */
export function protoUrl(base, protoId, state) {
  const q = new URLSearchParams({ chrome: '0' });
  if (state) q.set('state', state);
  return `${baseOrigin(base)}/${slugOf(protoId)}?${q.toString()}`;
}

/** Shell directory that holds node_modules/playwright. */
export function defaultShellDir() {
  return process.env.POC_PAGES_DATA_DIR
    ? path.resolve(process.env.POC_PAGES_DATA_DIR)
    : path.join(ROOT, 'data-sub-repositories', 'data-prototypes');
}

// ---- browser ---------------------------------------------------------------

function findChromium() {
  if (process.env.PW_CHROMIUM_PATH) return process.env.PW_CHROMIUM_PATH;
  const { browsersRoot, installedChromium } = require(path.join(HERE, '_playwright-paths.js'));
  const root = browsersRoot();
  const dirs = installedChromium().slice().reverse(); // newest first
  const shells = dirs.filter((d) => d.startsWith('chromium_headless_shell-'));
  const full = dirs.filter((d) => /^chromium-\d+$/.test(d));
  const candidates = [];
  for (const d of shells) {
    const dir = path.join(root, d);
    for (const sub of safeList(dir)) candidates.push(path.join(dir, sub, 'chrome-headless-shell'), path.join(dir, sub, 'chrome-headless-shell.exe'));
  }
  for (const d of full) {
    const dir = path.join(root, d);
    for (const sub of safeList(dir)) {
      candidates.push(
        path.join(dir, sub, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
        path.join(dir, sub, 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        path.join(dir, sub, 'chrome'),
        path.join(dir, sub, 'chrome.exe'),
      );
    }
  }
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function safeList(dir) {
  try { return fs.readdirSync(dir); } catch { return []; }
}

async function launch(shellDir) {
  let pw;
  try {
    pw = createRequire(path.join(shellDir, 'package.json'))('playwright');
  } catch {
    throw new UsageError(`playwright is not installed in ${shellDir}. Run "npm install" in that folder (its package.json lists playwright).`);
  }
  const executablePath = findChromium();
  if (!executablePath && !process.env.PLAYWRIGHT_BROWSERS_PATH) {
    const { browsersRoot } = require(path.join(HERE, '_playwright-paths.js'));
    process.env.PLAYWRIGHT_BROWSERS_PATH = browsersRoot();
  }
  try {
    return await pw.chromium.launch(executablePath ? { executablePath } : {});
  } catch (e) {
    throw new UsageError(`no browser could be started (${String(e.message).split('\n')[0]}). Run "node scripts/bootstrap-playwright.js" or set PW_CHROMIUM_PATH.`);
  }
}

async function openPage(browser, base, protoId, state, device) {
  const ctx = await browser.newContext({ ...DEVICES[device], colorScheme: 'light', reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(protoUrl(base, protoId, state), { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  return { ctx, page, errors };
}

function locate(page, spec) {
  const { kind, value } = parseLocator(spec);
  const rx = new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  switch (kind) {
    case 'a': return page.locator(`[aria-label*="${value}"]`).first();
    case 'b': return page.getByRole('button', { name: rx }).first();
    case 't': return page.getByText(value, { exact: false }).filter({ visible: true }).first();
    case 'tab': return page.getByRole('tab', { name: rx }).first();
    case 'cb': return page.getByRole('checkbox', { name: rx }).first();
    case 'ph': return page.getByPlaceholder(rx).first();
    default: return page.locator(value).first();
  }
}

/** Centre and size of an element, normalised to the viewport (0..1). */
async function centreOf(page, spec, device) {
  const l = locate(page, spec);
  await l.waitFor({ state: 'visible', timeout: 8000 });
  // Measure where the element sits in the picture: the action scrolls it into
  // view before the screenshot, so scroll first and measure after.
  await l.scrollIntoViewIfNeeded();
  const b = await l.boundingBox();
  if (!b) throw new Error(`no box for ${spec}`);
  const { width, height } = DEVICES[device].viewport;
  return { x: (b.x + b.width / 2) / width, y: (b.y + b.height / 2) / height, w: b.width / width, h: b.height / height };
}

async function act(page, action, device) {
  if (!action) return;
  const { kind, value } = parseAction(action);
  const { width, height } = DEVICES[device].viewport;
  if (kind === 'click' || kind === 'hover') {
    const l = locate(page, value);
    await l.waitFor({ state: 'visible', timeout: 8000 });
    await l.scrollIntoViewIfNeeded().catch(() => {});
    const b = await l.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
    if (kind === 'click') await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  } else if (kind === 'key') {
    await page.keyboard.press(value);
  } else if (kind === 'type') {
    await page.keyboard.type(value, { delay: 30 });
  } else if (kind === 'wheel') {
    await page.mouse.move(width / 2, height / 2);
    await page.mouse.wheel(0, Number(value));
  } else {
    await page.waitForTimeout(Number(value));
  }
  await page.waitForTimeout(450);
}

// ---- record ----------------------------------------------------------------

async function recordStep(browser, base, step, outDir) {
  const meta = { id: step.id, proto: step.proto, device: step.device, frames: [] };
  // A run that fails halfway must not leave last run's json beside new pictures.
  const own = new RegExp(`^${step.id}(\\.json|-\\d+\\.jpg)$`);
  for (const f of fs.readdirSync(outDir)) if (own.test(f)) fs.unlinkSync(path.join(outDir, f));
  let session = null;
  let state = null;
  try {
    for (let i = 0; i < step.frames.length; i += 1) {
      const f = step.frames[i];
      if (!session || (f.state && f.state !== state)) {
        if (session) await session.ctx.close();
        state = f.state ?? state;
        session = await openPage(browser, base, step.proto, state, step.device);
      }
      const { page } = session;
      const cur = f.cur ? await centreOf(page, f.cur, step.device) : null;
      await act(page, f.act, step.device);
      const cam = f.cam ? await centreOf(page, f.cam, step.device) : null;
      const file = `${step.id}-${String(i).padStart(2, '0')}.jpg`;
      await page.screenshot({ path: path.join(outDir, file), type: 'jpeg', quality: 78 });
      meta.frames.push({
        file,
        ms: f.ms,
        cur: cur && { x: +cur.x.toFixed(4), y: +cur.y.toFixed(4) },
        click: typeof f.act === 'string' && f.act.startsWith('click:'),
        key: f.key ?? null,
        cam: cam && { x: +cam.x.toFixed(4), y: +cam.y.toFixed(4), w: +cam.w.toFixed(4), h: +cam.h.toFixed(4) },
        state,
      });
    }
    if (session && session.errors.length) meta.errors = session.errors;
  } finally {
    if (session) await session.ctx.close();
  }
  fs.writeFileSync(path.join(outDir, `${step.id}.json`), JSON.stringify(meta, null, 1));
  return meta;
}

async function probe(base) {
  try {
    const r = await fetch(baseOrigin(base));
    if (!r.ok) throw new Error(String(r.status));
  } catch {
    throw new UsageError(`no preview answers at ${baseOrigin(base)}. Start a local preview from Design > Prototypes (or "vite preview" of a built shell) and pass its address with --base.`);
  }
}

export async function runRecord({ briefing, base, out, only, shell }) {
  const recFile = path.join(briefing, 'recording.json');
  let rec;
  try { rec = JSON.parse(fs.readFileSync(recFile, 'utf8')); } catch (e) {
    throw new UsageError(`cannot read ${recFile}: ${e.code === 'ENOENT' ? 'the file is missing' : e.message}`);
  }
  const problems = validateRecording(rec);
  if (problems.length) throw new UsageError(`recording.json is not valid:\n  ${problems.join('\n  ')}`);
  if (rec.steps.length === 0) throw new UsageError('recording.json has no steps to record');
  if (only) {
    const unknown = only.filter((id) => !rec.steps.some((st) => st.id === id));
    if (unknown.length) throw new UsageError(`--only names steps that recording.json does not have: ${unknown.join(', ')}`);
  }
  await probe(base);
  const outDir = path.resolve(out || path.join(os.tmpdir(), `proto-record-${path.basename(briefing)}`));
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await launch(shell);
  const results = [];
  try {
    for (const step of rec.steps) {
      if (only && !only.includes(step.id)) continue;
      try {
        const m = await recordStep(browser, base, step, outDir);
        results.push({ id: step.id, ok: true, frames: m.frames.length, pageErrors: (m.errors || []).length });
      } catch (e) {
        results.push({ id: step.id, ok: false, error: String(e.message || e).split('\n')[0] });
      }
    }
  } finally {
    await browser.close();
  }
  return { mode: 'record', out: outDir, ok: results.length > 0 && results.every((r) => r.ok), steps: results };
}

// ---- check-frames ----------------------------------------------------------

export async function runCheckFrames({ briefing, base, shell }) {
  const protoId = path.basename(path.resolve(briefing));
  if (!/^proto-[a-z0-9]+$/.test(protoId)) throw new UsageError(`the briefing folder must be named after its prototype id (proto-...): ${briefing}`);
  await probe(base);
  const browser = await launch(shell);
  const report = { mode: 'check-frames', prototype: protoId, framesLoaded: false, images: 0, failed: [], pageErrors: [], states: [] };
  try {
    for (const [state, device] of [['screen', 'desktop'], ['phone', 'phone']]) {
      const { ctx, page, errors } = await openPage(browser, base, protoId, state, device);
      try {
        // Pictures load lazily: give them a moment to settle before judging.
        const deadline = Date.now() + 8000;
        let info = { total: 0, failed: [] };
        while (Date.now() < deadline) {
          info = await page.evaluate(() => {
            const imgs = [...document.querySelectorAll('[data-proto-canvas] img')];
            return { total: imgs.length, failed: imgs.filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src') || '(no src)') };
          });
          if (info.total > 0 && info.failed.length === 0) break;
          await page.waitForTimeout(250);
        }
        report.states.push({ state, device, images: info.total, failed: info.failed.length });
        report.images += info.total;
        report.failed.push(...info.failed);
        report.pageErrors.push(...errors);
      } finally {
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
  }
  report.framesLoaded = report.images > 0 && report.failed.length === 0 && report.pageErrors.length === 0;
  report.ok = report.framesLoaded;
  return report;
}

// ---- command line ----------------------------------------------------------

const HELP = `proto-record.mjs - record the pictures of a briefing prototype

Usage:
  node scripts/proto-record.mjs --briefing <dir> --base <url> [--out <dir>] [--only id,id] [--shell <dir>] [--json]
  node scripts/proto-record.mjs --check-frames <briefing dir> --base <url> [--shell <dir>] [--json]

  --briefing <dir>      folder of the briefing prototype (holds recording.json)
  --base <url>          running preview; only its origin is used
  --out <dir>           where the JPEGs and <step>.json go (default: a temp folder)
  --only id,id          record only these step ids
  --check-frames <dir>  smoke check: the built briefing shows its pictures
  --shell <dir>         build shell that has node_modules/playwright
  --json                machine-readable result
  --help                this text

Browser: PW_CHROMIUM_PATH, else a Chromium under the Playwright browsers folder.
Exit codes: 0 ok, 1 a step or check failed, 2 usage error or no browser/preview.
`;

export function parseCli(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new UsageError(`unexpected argument: ${a}`);
    const eq = a.indexOf('=');
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (['json', 'help'].includes(key)) { flags[key] = true; continue; }
    const value = eq === -1 ? argv[++i] : a.slice(eq + 1);
    if (value === undefined || value.startsWith('--')) throw new UsageError(`--${key} needs a value`);
    flags[key] = value;
  }
  return flags;
}

async function main() {
  const flags = parseCli(process.argv.slice(2));
  if (flags.help) { process.stdout.write(HELP); return 0; }
  if (!flags.base) throw new UsageError('--base <url> is required');
  const shell = path.resolve(flags.shell || defaultShellDir());
  let result;
  if (flags['check-frames']) {
    result = await runCheckFrames({ briefing: flags['check-frames'], base: flags.base, shell });
  } else {
    if (!flags.briefing) throw new UsageError('--briefing <dir> is required (or --check-frames <dir>)');
    result = await runRecord({
      briefing: path.resolve(flags.briefing), base: flags.base, out: flags.out, shell,
      only: flags.only ? String(flags.only).split(',') : null,
    });
  }
  if (flags.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else if (result.mode === 'record') {
    for (const s of result.steps) process.stdout.write(s.ok ? `OK   ${s.id}  ${s.frames} frames${s.pageErrors ? `  page errors: ${s.pageErrors}` : ''}\n` : `FAIL ${s.id}  ${s.error}\n`);
    process.stdout.write(`recordings in ${result.out}\n`);
  } else {
    process.stdout.write(`${result.framesLoaded ? 'OK' : 'FAIL'}  ${result.images} pictures, ${result.failed.length} not loaded, ${result.pageErrors.length} page errors\n`);
    for (const f of result.failed) process.stdout.write(`  not loaded: ${f}\n`);
    for (const e of result.pageErrors) process.stdout.write(`  page error: ${e}\n`);
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code), (e) => {
    if (e instanceof UsageError) { process.stderr.write(`${e.message}\n`); process.exit(2); }
    process.stderr.write(`proto-record internal error: ${(e && e.stack) || e}\n`);
    process.exit(2);
  });
}
