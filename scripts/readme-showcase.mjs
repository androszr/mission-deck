#!/usr/bin/env node
// scripts/readme-showcase.mjs
// Draws the README's showcase pictures: the designed 1200x1200 posters under
// docs/images/showcase/ that frame the real screenshots (docs/images/*.png,
// taken by scripts/readme-shots.mjs) with a headline, the way Dark Army's front
// page does. Two steps, each runnable alone:
//
//   phone    serves apps/mini-deck/dist (build it first: npm run build:apps) on
//            a spare loopback port and captures docs/images/mini-deck-*.png at
//            phone size
//   compose  renders every docs/images/showcase/src/<name>.html to
//            docs/images/showcase/<name>.png
//
//   node scripts/readme-showcase.mjs [phone|compose|all] [--port 3778]
//
// The layouts are plain HTML that read the screenshots and the repo's fonts
// by relative path, so the fix for a wrong poster is a change to its layout
// and a re-run, never a change to the PNG. Nothing here starts Mission Deck.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPlaywright } from './readme-shots.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGES = path.join(ROOT, 'docs', 'images');
const SHOWCASE = path.join(IMAGES, 'showcase');
const LAYOUTS = path.join(SHOWCASE, 'src');
const MINI_DIST = path.join(ROOT, 'apps', 'mini-deck', 'dist');

export const POSTER_SIZE = { width: 1200, height: 1200 };
export const PHONE_SHOTS = [
  { file: 'mini-deck-sprints.png', hash: '#/sprints' },
  { file: 'mini-deck-bugs.png', hash: '#/bugs' },
];

export const PHONE_CLOCK = '2026-10-01T10:00:00Z';

export function parseArgs(argv) {
  const args = { step: 'all', port: 3778, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' && argv[i + 1]) { args.port = Number(argv[++i]); continue; }
    if (a === '--help' || a === '-h') { args.help = true; continue; }
    if (['phone', 'compose', 'all'].includes(a)) { args.step = a; continue; }
    throw new Error('unknown argument: ' + a);
  }
  if (!Number.isInteger(args.port) || args.port < 1024 || args.port > 65535) throw new Error('--port must be 1024-65535');
  return args;
}

/** Every poster layout, by name: docs/images/showcase/src/<name>.html -> showcase/<name>.png. */
export function listLayouts(dir = LAYOUTS) {
  return fs.readdirSync(dir).filter((f) => /^[a-z0-9-]+\.html$/.test(f)).sort().map((f) => f.replace(/\.html$/, ''));
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

/** A read-only static server over `dir`, loopback only; resolves to the server. */
function serveDir(dir, port) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(dir, rel);
    if (!file.startsWith(dir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function phone(chromium, port) {
  if (!fs.existsSync(path.join(MINI_DIST, 'index.html'))) {
    throw new Error('apps/mini-deck/dist is missing - run `npm run build:apps` first');
  }
  const server = await serveDir(MINI_DIST, port);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      colorScheme: 'light', locale: 'en-US', timezoneId: 'UTC',
    });
    await context.addInitScript(() => { try { localStorage.setItem('mini-deck.theme', 'light'); } catch { /* private mode */ } });
    const page = await context.newPage();
    // The demo data is stamped PHONE_CLOCK minus two hours: a fixed clock keeps
    // the "this data is N days old" banner out of every retake.
    await page.clock.setFixedTime(new Date(PHONE_CLOCK));
    for (const shot of PHONE_SHOTS) {
      await page.goto('http://127.0.0.1:' + port + '/' + shot.hash, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);
      const out = path.join(IMAGES, shot.file);
      await page.screenshot({ path: out, type: 'png', animations: 'disabled', caret: 'hide' });
      console.log(shot.file.padEnd(28) + ' ' + (fs.statSync(out).size / 1024).toFixed(0).padStart(5) + ' KB');
    }
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
}

async function compose(chromium) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: POSTER_SIZE, deviceScaleFactor: 1, colorScheme: 'dark' });
    const page = await context.newPage();
    for (const name of listLayouts()) {
      await page.goto(pathToFileURL(path.join(LAYOUTS, name + '.html')).href, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const missing = await page.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src')));
      if (missing.length) throw new Error(name + ': picture not found: ' + missing.join(', '));
      const out = path.join(SHOWCASE, name + '.png');
      await page.screenshot({ path: out, type: 'png', animations: 'disabled', caret: 'hide' });
      console.log(('showcase/' + name + '.png').padEnd(40) + ' ' + (fs.statSync(out).size / 1024).toFixed(0).padStart(5) + ' KB');
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/readme-showcase.mjs [phone|compose|all] [--port 3778]\nWrites docs/images/mini-deck-*.png and docs/images/showcase/*.png (see docs/images/SHOTS.md).');
    return;
  }
  const chromium = await loadPlaywright();
  if (args.step === 'phone' || args.step === 'all') await phone(chromium, args.port);
  if (args.step === 'compose' || args.step === 'all') await compose(chromium);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
