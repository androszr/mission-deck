#!/usr/bin/env node
// scripts/proto-build-content.mjs
// Writes recorded frames into a briefing prototype.
//
//   node scripts/proto-build-content.mjs --briefing <dir> --out <recordings dir> [--json]
//
// For every step of <briefing>/content.json whose id has a recording in the
// recordings folder (made by scripts/proto-record.mjs):
//   - copies the frames into <briefing>/assets/frames/ (old frames of that
//     step are removed first, other steps are untouched);
//   - writes `frames` [{file, ms, transition}] and `motion`:
//       cursor: glides to each action's target and arrives just before the
//               frame that shows the result;
//       events: a click ripple / key label at that moment;
//       camera: eases towards the frame's `cam` rectangle (zoom 1..1.6) as
//               the frame appears, and stays there;
//   - keeps a hand-set `keyframe` when it is still in range.
// Re-run after every new recording; never edit frames or motion by hand.
//
// Node built-ins only. Exit: 0 ok, 2 usage error.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r4 = (v) => Math.round(v * 10000) / 10000;

/** Cursor, click/key events and camera for one recorded step. Pure. */
export function motionFor(rec) {
  const starts = [];
  let acc = 0;
  for (const f of rec.frames) {
    starts.push(acc);
    acc += f.ms;
  }
  const cursor = [];
  const events = [];
  const camera = [{ ms: 0, x: 0.5, y: 0.5, zoom: 1 }];
  let last = null;
  rec.frames.forEach((f, i) => {
    const t = starts[i];
    if (f.cur) {
      if (!last) {
        const from = { x: clamp(f.cur.x + 0.1, 0.05, 0.95), y: clamp(f.cur.y + 0.12, 0.05, 0.95) };
        cursor.push({ ms: 0, ...from });
        last = from;
      }
      const arrive = i === 0 ? 0 : Math.max(cursor[cursor.length - 1].ms + 100, t - 140);
      const depart = i === 0 ? 0 : Math.max(cursor[cursor.length - 1].ms, arrive - 650);
      if (depart > cursor[cursor.length - 1].ms) cursor.push({ ms: depart, x: last.x, y: last.y });
      cursor.push({ ms: arrive, x: r4(f.cur.x), y: r4(f.cur.y) });
      last = f.cur;
      if (f.click) events.push({ ms: Math.max(0, t - 90), type: 'click' });
    }
    if (f.key) events.push({ ms: t, type: 'key', label: f.key });
    if (f.cam) {
      const zoom = clamp(Math.min(0.85 / Math.max(f.cam.w, 0.01), 0.85 / Math.max(f.cam.h, 0.01)), 1, 1.6);
      // Keyframe times must only grow: a move starts no earlier than the last
      // keyframe (where the camera then rests) and ends before the next frame.
      const prev = camera[camera.length - 1];
      const start = Math.max(t, prev.ms);
      const next = i + 1 < starts.length ? starts[i + 1] : start + 800;
      const end = start + Math.min(800, Math.max(100, next - start));
      if (start > prev.ms) camera.push({ ms: start, x: prev.x, y: prev.y, zoom: prev.zoom });
      camera.push({ ms: end, x: r4(f.cam.x), y: r4(f.cam.y), zoom: r4(zoom) });
    }
  });
  return { camera, cursor, events };
}

/**
 * Applies the recordings in `recDir` to the briefing in `briefing`.
 * @returns {{updated: string[], contentFile: string}}
 */
export function buildContent({ briefing, recDir }) {
  const contentFile = path.join(briefing, 'content.json');
  const framesDir = path.join(briefing, 'assets', 'frames');
  const content = JSON.parse(fs.readFileSync(contentFile, 'utf8'));
  fs.mkdirSync(framesDir, { recursive: true });
  const updated = [];
  // Pass 1 checks every step and every source picture before anything is
  // deleted, so a bad recording leaves the briefing exactly as it was.
  const work = [];
  for (const chapter of content.chapters) {
    for (const step of chapter.steps) {
      if (typeof step.id !== 'string' || !/^[a-z0-9-]+$/.test(step.id)) throw new Error(`step id "${String(step.id)}" must be ASCII kebab-case (a-z, 0-9, -)`);
      const recFile = path.join(recDir, `${step.id}.json`);
      if (!fs.existsSync(recFile)) continue;
      const rec = JSON.parse(fs.readFileSync(recFile, 'utf8'));
      if (!Array.isArray(rec.frames)) throw new Error(`step ${step.id}: the recording has no frames list`);
      for (const f of rec.frames) {
        if (!f || typeof f.file !== 'string' || path.basename(f.file) !== f.file || !/^[A-Za-z0-9_.-]+\.jpg$/.test(f.file) || f.file === '.' || f.file === '..') throw new Error(`step ${step.id}: a frame file must be a plain file name ending in .jpg, not a path`);
        if (!fs.existsSync(path.join(recDir, f.file))) throw new Error(`step ${step.id}: the recorded picture ${f.file} is missing`);
      }
      work.push({ step, rec });
    }
  }
  for (const { step, rec } of work) {
    // Only this step's own frames: `console` must not take `console-list-01.jpg`.
    const ownFrame = new RegExp(`^${step.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+\\.jpg$`);
    for (const old of fs.readdirSync(framesDir)) if (ownFrame.test(old)) fs.unlinkSync(path.join(framesDir, old));
    for (const f of rec.frames) fs.copyFileSync(path.join(recDir, f.file), path.join(framesDir, f.file));
    step.frames = rec.frames.map((f, i) => ({ file: f.file, ms: f.ms, transition: i === 0 ? 0 : 160 }));
    step.motion = motionFor(rec);
    if (typeof step.keyframe === 'number' && step.keyframe >= rec.frames.length) delete step.keyframe;
    updated.push(step.id);
  }
  fs.writeFileSync(contentFile, `${JSON.stringify(content, null, 2)}\n`);
  return { updated, contentFile };
}

const HELP = `proto-build-content.mjs - write recorded frames into a briefing

Usage:
  node scripts/proto-build-content.mjs --briefing <dir> --out <recordings dir> [--json]

  --briefing <dir>   folder of the briefing prototype (holds content.json)
  --out <dir>        the folder scripts/proto-record.mjs wrote its JPEGs and <step>.json to
  --json             machine-readable result
  --help             this text

Exit codes: 0 ok, 2 usage error.
`;

function main() {
  const argv = process.argv.slice(2);
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json' || a === '--help') flags[a.slice(2)] = true;
    else if (a === '--briefing' || a === '--out') flags[a.slice(2)] = argv[++i];
    else { process.stderr.write(`unexpected argument: ${a}\n`); return 2; }
  }
  if (flags.help) { process.stdout.write(HELP); return 0; }
  if (!flags.briefing || !flags.out) { process.stderr.write('--briefing <dir> and --out <recordings dir> are required\n'); return 2; }
  const briefing = path.resolve(flags.briefing);
  const recDir = path.resolve(flags.out);
  if (!fs.existsSync(path.join(briefing, 'content.json'))) { process.stderr.write(`no content.json in ${briefing}\n`); return 2; }
  if (!fs.existsSync(recDir)) { process.stderr.write(`no recordings folder: ${recDir}\n`); return 2; }
  let r;
  try { r = buildContent({ briefing, recDir }); } catch (e) { process.stderr.write(`${e.message}\n`); return 2; }
  if (flags.json) process.stdout.write(`${JSON.stringify({ updated: r.updated, contentFile: r.contentFile }, null, 2)}\n`);
  else {
    for (const id of r.updated) process.stdout.write(`step ${id}: updated\n`);
    process.stdout.write(`${r.updated.length} step(s) updated in ${r.contentFile}\n`);
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(main());
