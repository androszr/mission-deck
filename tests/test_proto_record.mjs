// tests/test_proto_record.mjs
// The pure parts of the briefing recording tool (scripts/proto-record.mjs and
// scripts/proto-build-content.mjs): the locator language, recording.json
// validation, the preview address and the camera / cursor / event tracks.
// No browser is launched and no preview is needed.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import cp from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rec = await import(pathToFileURL(path.join(ROOT, 'scripts', 'proto-record.mjs')).href);
const build = await import(pathToFileURL(path.join(ROOT, 'scripts', 'proto-build-content.mjs')).href);

test('parseLocator: every kind of the language, the value may hold "="', () => {
  assert.deepStrictEqual(rec.parseLocator('b=Assign technician'), { kind: 'b', value: 'Assign technician' });
  assert.deepStrictEqual(rec.parseLocator('css=.dsp-panel'), { kind: 'css', value: '.dsp-panel' });
  assert.deepStrictEqual(rec.parseLocator('a=Open WO-1038'), { kind: 'a', value: 'Open WO-1038' });
  assert.deepStrictEqual(rec.parseLocator('t=a=b'), { kind: 't', value: 'a=b' });
  for (const kind of ['a', 'b', 't', 'tab', 'cb', 'ph', 'css']) assert.strictEqual(rec.parseLocator(kind + '=x').kind, kind);
  for (const bad of ['', 'x', 'link=Go', 'b=', '=b', undefined]) assert.throws(() => rec.parseLocator(bad), /unknown locator/, String(bad));
});

test('parseAction: click / hover need a locator, the rest take a value', () => {
  assert.deepStrictEqual(rec.parseAction('click:b=Save'), { kind: 'click', value: 'b=Save' });
  assert.deepStrictEqual(rec.parseAction('key:Enter'), { kind: 'key', value: 'Enter' });
  assert.deepStrictEqual(rec.parseAction('wait:300'), { kind: 'wait', value: '300' });
  assert.deepStrictEqual(rec.parseAction('wheel:-200'), { kind: 'wheel', value: '-200' });
  assert.deepStrictEqual(rec.parseAction('type:hello world'), { kind: 'type', value: 'hello world' });
  assert.throws(() => rec.parseAction('drag:b=x'), /unknown action/);
  assert.throws(() => rec.parseAction('click:'), /needs a locator/);
  assert.throws(() => rec.parseAction('click:save'), /unknown locator/);
});

const goodStep = () => ({
  id: 'console-list', proto: 'proto-7f3a91c0d2e4', device: 'desktop',
  frames: [{ state: 'list', ms: 1600 }, { cur: 't=Fault', act: 'click:t=Fault', cam: 'css=.dsp-panel', ms: 2600 }],
});

test('validateRecording: the shipped briefing and the empty starter list are valid', () => {
  const shipped = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/prototypes/proto-e15c0a7d3b96/recording.json'), 'utf8'));
  assert.deepStrictEqual(rec.validateRecording(shipped), []);
  assert.ok(shipped.steps.length >= 6);
  const starter = JSON.parse(fs.readFileSync(path.join(ROOT, 'templates/prototype/starter/briefing/recording.json'), 'utf8'));
  assert.deepStrictEqual(rec.validateRecording(starter), []);
  assert.deepStrictEqual(starter.steps, []);
  // The ids of the shipped recording are the ids of the steps in content.json.
  const content = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples/prototypes/proto-e15c0a7d3b96/content.json'), 'utf8'));
  const stepIds = new Set(content.chapters.flatMap((c) => c.steps.map((s) => s.id)));
  for (const s of shipped.steps) assert.ok(stepIds.has(s.id), s.id);
});

test('validateRecording: every way a recording can be wrong is named', () => {
  assert.deepStrictEqual(rec.validateRecording({ steps: [goodStep()] }), []);
  for (const bad of [null, [], {}, { steps: 'x' }]) assert.strictEqual(rec.validateRecording(bad).length, 1);
  const problem = (mutate) => { const s = goodStep(); mutate(s); return rec.validateRecording({ steps: [s] }).join('|'); };
  assert.match(problem((s) => { s.id = 'Bad Id'; }), /id must be ASCII kebab-case/);
  assert.match(problem((s) => { s.proto = 'x'; }), /proto must be a prototype id/);
  assert.match(problem((s) => { s.device = 'tablet'; }), /device must be one of/);
  assert.match(problem((s) => { s.frames = []; }), /frames must be a non-empty array/);
  assert.match(problem((s) => { delete s.frames[0].state; }), /state is required on the first frame/);
  assert.match(problem((s) => { s.frames[1].ms = 0; }), /ms must be a positive number/);
  assert.match(problem((s) => { s.frames[1].act = 'swipe:left'; }), /act: unknown action/);
  assert.match(problem((s) => { s.frames[1].cam = 'nope'; }), /cam: unknown locator/);
  assert.match(problem((s) => { s.frames[1].state = 'Not Kebab'; }), /state must be ASCII kebab-case/);
  assert.match(rec.validateRecording({ steps: [goodStep(), goodStep()] }).join('|'), /used twice/);
});

test('slug, origin and bare address: the slug is the id without proto-, the path of --base is ignored', () => {
  assert.strictEqual(rec.slugOf('proto-e15c0a7d3b96'), 'e15c0a7d3b96');
  assert.strictEqual(rec.baseOrigin('http://localhost:5173/e15c0a7d3b96'), 'http://localhost:5173');
  assert.strictEqual(rec.baseOrigin('https://preview.example.com/'), 'https://preview.example.com');
  assert.strictEqual(rec.protoUrl('http://localhost:5173/anything', 'proto-7f3a91c0d2e4', 'detail'), 'http://localhost:5173/7f3a91c0d2e4?chrome=0&state=detail');
  assert.strictEqual(rec.protoUrl('http://localhost:5173', 'proto-7f3a91c0d2e4'), 'http://localhost:5173/7f3a91c0d2e4?chrome=0');
  assert.throws(() => rec.baseOrigin('not an address'), /--base is not an address/);
  assert.throws(() => rec.baseOrigin('ftp://localhost/x'), /http or https/);
});

test('parseCli: flags with values, switches without, no stray arguments', () => {
  assert.deepStrictEqual(rec.parseCli(['--briefing', 'd', '--base=http://x', '--json']), { briefing: 'd', base: 'http://x', json: true });
  assert.throws(() => rec.parseCli(['stray']), /unexpected argument/);
  assert.throws(() => rec.parseCli(['--base']), /needs a value/);
  assert.throws(() => rec.parseCli(['--base', '--json']), /needs a value/);
});

test('motionFor: the cursor arrives just before each frame, a click leaves a ripple, the camera eases to the target', () => {
  const recording = {
    frames: [
      { ms: 1000, cur: null, cam: null, click: false, key: null },
      { ms: 2000, cur: { x: 0.5, y: 0.4 }, cam: { x: 0.6, y: 0.5, w: 0.4, h: 0.3 }, click: true, key: null },
      { ms: 1500, cur: { x: 0.2, y: 0.2 }, cam: null, click: false, key: 'Enter' },
    ],
  };
  const m = build.motionFor(recording);
  assert.deepStrictEqual(m.camera[0], { ms: 0, x: 0.5, y: 0.5, zoom: 1 });
  // Frame 1 starts at 1000 ms: the camera holds, then eases over 800 ms to the target.
  assert.deepStrictEqual(m.camera.slice(1), [{ ms: 1000, x: 0.5, y: 0.5, zoom: 1 }, { ms: 1800, x: 0.6, y: 0.5, zoom: 1.6 }]);
  assert.deepStrictEqual(m.events, [{ ms: 910, type: 'click' }, { ms: 3000, type: 'key', label: 'Enter' }]);
  assert.strictEqual(m.cursor[0].ms, 0, 'the cursor starts near its first target');
  assert.ok(m.cursor.some((c) => c.ms === 860 && c.x === 0.5 && c.y === 0.4), 'arrives 140 ms before the frame it shows (frame 1 starts at 1000)');
  assert.ok(m.cursor.some((c) => c.ms === 2860 && c.x === 0.2 && c.y === 0.2), 'and again for the next target (frame 2 starts at 3000)');
  for (let i = 1; i < m.cursor.length; i += 1) assert.ok(m.cursor[i].ms >= m.cursor[i - 1].ms, 'the track is in time order');
  assert.deepStrictEqual(build.motionFor({ frames: [{ ms: 500, cur: null, cam: null }] }), { camera: [{ ms: 0, x: 0.5, y: 0.5, zoom: 1 }], cursor: [], events: [] });
});

test('motionFor: short frames with camera moves keep the camera track in time order and fit each move before the next frame', () => {
  const m = build.motionFor({ frames: [
    { ms: 500, cam: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 } },
    { ms: 700, cam: { x: 0.8, y: 0.8, w: 0.3, h: 0.3 } },
    { ms: 2000, cam: { x: 0.4, y: 0.4, w: 0.3, h: 0.3 } },
  ] });
  for (let i = 1; i < m.camera.length; i += 1) assert.ok(m.camera[i].ms >= m.camera[i - 1].ms, `camera key ${i} is in time order: ${JSON.stringify(m.camera)}`);
  assert.deepStrictEqual(m.camera.map((c) => c.ms), [0, 500, 1200, 2000]);
});

test('buildContent: a recorded picture that is missing is refused before any frame of any step is deleted', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-build-content-'));
  try {
    const briefing = path.join(tmp, 'proto-brief0000a4');
    const recs = path.join(tmp, 'recs');
    fs.mkdirSync(path.join(briefing, 'assets', 'frames'), { recursive: true });
    fs.mkdirSync(recs);
    fs.writeFileSync(path.join(briefing, 'assets', 'frames', 'one-00.jpg'), 'old-one');
    fs.writeFileSync(path.join(briefing, 'content.json'), JSON.stringify({ chapters: [{ id: 'c', steps: [{ id: 'one', type: 'screen' }, { id: 'two', type: 'screen' }] }] }));
    fs.writeFileSync(path.join(recs, 'one-00.jpg'), 'new-one');
    fs.writeFileSync(path.join(recs, 'one.json'), JSON.stringify({ frames: [{ file: 'one-00.jpg', ms: 1 }] }));
    fs.writeFileSync(path.join(recs, 'two.json'), JSON.stringify({ frames: [{ file: 'two-00.jpg', ms: 1 }] }));
    const before = fs.readFileSync(path.join(briefing, 'content.json'), 'utf8');
    assert.throws(() => build.buildContent({ briefing, recDir: recs }), /two-00\.jpg is missing/);
    assert.strictEqual(fs.readFileSync(path.join(briefing, 'assets', 'frames', 'one-00.jpg'), 'utf8'), 'old-one');
    assert.strictEqual(fs.readFileSync(path.join(briefing, 'content.json'), 'utf8'), before);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('runRecord: --only with a step id the recording does not have is a usage error, before any preview is probed', async () => {
  const briefing = path.join(ROOT, 'examples', 'prototypes', 'proto-e15c0a7d3b96');
  await assert.rejects(rec.runRecord({ briefing, base: 'http://127.0.0.1:9/', only: ['no-such-step'] }), /does not have: no-such-step/);
});

test('buildContent: writes frames and motion for recorded steps, removes that step\'s old frames, keeps the rest', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-build-content-'));
  try {
    const briefing = path.join(tmp, 'proto-brief0000a1');
    const recs = path.join(tmp, 'recs');
    fs.mkdirSync(path.join(briefing, 'assets', 'frames'), { recursive: true });
    fs.mkdirSync(recs);
    fs.writeFileSync(path.join(briefing, 'assets', 'frames', 'step-a-09.jpg'), 'old');
    fs.writeFileSync(path.join(briefing, 'assets', 'frames', 'step-b-00.jpg'), 'keep');
    fs.writeFileSync(path.join(briefing, 'content.json'), JSON.stringify({ chapters: [{ id: 'c', steps: [{ id: 'step-a', type: 'screen', keyframe: 5 }, { id: 'step-b', type: 'screen', frames: [{ file: 'step-b-00.jpg', ms: 1 }] }] }] }));
    fs.writeFileSync(path.join(recs, 'step-a-00.jpg'), 'new0');
    fs.writeFileSync(path.join(recs, 'step-a-01.jpg'), 'new1');
    fs.writeFileSync(path.join(recs, 'step-a.json'), JSON.stringify({ frames: [{ file: 'step-a-00.jpg', ms: 1000 }, { file: 'step-a-01.jpg', ms: 2000, cur: { x: 0.3, y: 0.3 }, click: true }] }));
    const r = build.buildContent({ briefing, recDir: recs });
    assert.deepStrictEqual(r.updated, ['step-a']);
    const content = JSON.parse(fs.readFileSync(path.join(briefing, 'content.json'), 'utf8'));
    const a = content.chapters[0].steps[0];
    assert.deepStrictEqual(a.frames, [{ file: 'step-a-00.jpg', ms: 1000, transition: 0 }, { file: 'step-a-01.jpg', ms: 2000, transition: 160 }]);
    assert.strictEqual(a.keyframe, undefined, 'a key frame out of range is dropped');
    assert.ok(a.motion.events.some((e) => e.type === 'click'));
    assert.deepStrictEqual(fs.readdirSync(path.join(briefing, 'assets', 'frames')).sort(), ['step-a-00.jpg', 'step-a-01.jpg', 'step-b-00.jpg']);
    assert.strictEqual(fs.readFileSync(path.join(briefing, 'assets', 'frames', 'step-b-00.jpg'), 'utf8'), 'keep');
    assert.strictEqual(content.chapters[0].steps[1].frames[0].ms, 1, 'an unrecorded step is untouched');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('buildContent: a step id that prefixes another step id never deletes the other step\'s frames', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-build-content-'));
  try {
    const briefing = path.join(tmp, 'proto-brief0000a2');
    const recs = path.join(tmp, 'recs');
    fs.mkdirSync(path.join(briefing, 'assets', 'frames'), { recursive: true });
    fs.mkdirSync(recs);
    fs.writeFileSync(path.join(briefing, 'assets', 'frames', 'console-list-01.jpg'), 'keep');
    fs.writeFileSync(path.join(briefing, 'assets', 'frames', 'console-09.jpg'), 'old');
    fs.writeFileSync(path.join(briefing, 'content.json'), JSON.stringify({ chapters: [{ id: 'c', steps: [{ id: 'console', type: 'screen' }, { id: 'console-list', type: 'screen' }] }] }));
    fs.writeFileSync(path.join(recs, 'console-00.jpg'), 'new');
    fs.writeFileSync(path.join(recs, 'console.json'), JSON.stringify({ frames: [{ file: 'console-00.jpg', ms: 1000 }] }));
    build.buildContent({ briefing, recDir: recs });
    assert.deepStrictEqual(fs.readdirSync(path.join(briefing, 'assets', 'frames')).sort(), ['console-00.jpg', 'console-list-01.jpg']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('buildContent: a step id that is not kebab-case, or a frame file that is a path, is refused before anything is written', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-build-content-'));
  try {
    const briefing = path.join(tmp, 'proto-brief0000a3');
    const recs = path.join(tmp, 'recs');
    fs.mkdirSync(path.join(briefing, 'assets', 'frames'), { recursive: true });
    fs.mkdirSync(recs);
    fs.writeFileSync(path.join(tmp, 'secret.jpg'), 'secret');
    fs.writeFileSync(path.join(briefing, 'content.json'), JSON.stringify({ chapters: [{ id: 'c', steps: [{ id: '../x', type: 'screen' }] }] }));
    assert.throws(() => build.buildContent({ briefing, recDir: recs }), /kebab-case/);
    fs.writeFileSync(path.join(briefing, 'content.json'), JSON.stringify({ chapters: [{ id: 'c', steps: [{ id: 'ok', type: 'screen' }] }] }));
    fs.writeFileSync(path.join(recs, 'ok.json'), JSON.stringify({ frames: [{ file: '../secret.jpg', ms: 1 }] }));
    assert.throws(() => build.buildContent({ briefing, recDir: recs }), /plain file name/);
    assert.deepStrictEqual(fs.readdirSync(path.join(briefing, 'assets', 'frames')), []);
    for (const bad of ['.', '..', '', 'x.png', 'a b.jpg']) {
      fs.writeFileSync(path.join(recs, 'ok.json'), JSON.stringify({ frames: [{ file: bad, ms: 1 }] }));
      assert.throws(() => build.buildContent({ briefing, recDir: recs }), /plain file name/, JSON.stringify(bad));
    }
    fs.writeFileSync(path.join(recs, 'ok.json'), JSON.stringify({ frames: [{ file: '../secret.jpg', ms: 1 }] }));
    const cli = cp.spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'proto-build-content.mjs'), '--briefing', briefing, '--out', recs], { encoding: 'utf8' });
    assert.strictEqual(cli.status, 2);
    assert.match(cli.stderr, /plain file name/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the command line: --help works, a missing preview and a missing recording exit 2 with one sentence, no browser needed', () => {
  const run = (args) => cp.spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'proto-record.mjs'), ...args], { encoding: 'utf8' });
  const help = run(['--help']);
  assert.strictEqual(help.status, 0);
  assert.match(help.stdout, /--check-frames/);
  const noBase = run(['--briefing', 'x']);
  assert.strictEqual(noBase.status, 2);
  assert.match(noBase.stderr, /--base <url> is required/);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'proto-record-cli-'));
  try {
    const missing = run(['--briefing', tmp, '--base', 'http://127.0.0.1:9']);
    assert.strictEqual(missing.status, 2);
    assert.match(missing.stderr, /recording\.json: the file is missing/);
    fs.writeFileSync(path.join(tmp, 'recording.json'), JSON.stringify({ steps: [] }));
    const empty = run(['--briefing', tmp, '--base', 'http://127.0.0.1:9']);
    assert.strictEqual(empty.status, 2);
    assert.match(empty.stderr, /no steps to record/);
    fs.writeFileSync(path.join(tmp, 'recording.json'), JSON.stringify({ steps: [goodStep()] }));
    const noPreview = run(['--briefing', tmp, '--base', 'http://127.0.0.1:9']);
    assert.strictEqual(noPreview.status, 2);
    assert.match(noPreview.stderr, /no preview answers/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const buildHelp = cp.spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'proto-build-content.mjs'), '--help'], { encoding: 'utf8' });
  assert.strictEqual(buildHelp.status, 0);
  assert.match(buildHelp.stdout, /--briefing/);
});
