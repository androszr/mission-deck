'use strict';
// modules/meeting-transcripts/server/index.js
// register(ctx), mounted under /api/m/meeting-transcripts/.
//
// Three ways in, one way through:
//   upload    POST /upload-start|chunk|finish|cancel (6 MB JSON slices - the
//             host accepts only JSON bodies), then POST /enqueue
//   OneDrive  the daily cycle (or "Check now") lists the configured
//             folders through a Playwright session and downloads new
//             recordings into inbox/
//   both      land in the persistent queue (queue.js); ONE worker drains it
//             (pipeline.runJob) - leaving the page or restarting the server
//             loses nothing.
// Out: user-data/transcripts/<stamp>-<name>.json + .html (never a data repo
// from here); "send to the Meeting Archive" (POST /publish, or autoPublish in
// the cycle) hands the transcript to the meeting-archive module, which writes
// meetings/ in the team data and pushes it to the team at once.
//
//   GET  /status /queue /list /file?name= /report?name= /settings /runs
//   POST /enqueue /queue/retry|remove|cancel|redo /pause /report-build
//        /settings /onedrive/login /onedrive/keepalive /run-now /publish
//
// The scheduler (one unref'd 60 s timer) is not armed under test.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const lib = require('./lib');
const media = require('./media');
const gemini = require('./gemini');
const pipeline = require('./pipeline');
const od = require('./onedrive-lib');
const { createQueue, isValidItemId, isValidInput } = require('./queue');
const { createSsoRunner } = require('./sso-runner');
const loopback = require('./loopback');

const CHUNK_BYTES = 6 * 1024 * 1024;
const READ_BODY_LIMIT = 10 * 1024 * 1024;
const UPLOAD_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const STALE_MS = 24 * 60 * 60 * 1000;
const TICK_MS = 60 * 1000;
const RUNS_KEEP = 30;
const LOG_KEEP = 200;
// Cycle phases are shown in the UI as they are and compared by value.
const PHASE_CHECK = 'Checking OneDrive folders';
const PHASE_TRANSCRIBE = 'Transcribing queued recordings';
const PHASE_PUBLISH = 'Sending to the Meeting Archive';

function isTestMode() {
  return Boolean(process.env.NODE_TEST_CONTEXT) || process.env.NODE_ENV === 'test' || process.env.COCKPIT_EMBEDDED === '1';
}

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

module.exports = function register(ctx) {
  const uploadsDir = path.join(ctx.dataDir, 'uploads');
  const workRoot = path.join(ctx.dataDir, 'work');
  const inboxDir = path.join(ctx.dataDir, 'inbox');
  const settingsFile = path.join(ctx.dataDir, 'settings.json');
  const stateFile = path.join(ctx.dataDir, 'scheduler-state.json');
  const ledgerFile = path.join(ctx.dataDir, 'onedrive-ledger.json');
  const withUploadLock = ctx.makeLock();
  const queue = createQueue(path.join(ctx.dataDir, 'queue.json'));
  const runner = createSsoRunner(ctx);

  const fail = (res, status, error, message) => ctx.jsonResponse(res, status, { error, message });
  const partPath = (id) => path.join(uploadsDir, id + '.part');
  const metaPath = (id) => path.join(uploadsDir, id + '.json');

  // -- settings / state ----------------------------------------------------------
  function getSettings() { return od.normalizeSettings(readJsonSafe(settingsFile)); }
  function getState() {
    const s = readJsonSafe(stateFile) || {};
    return { lastSlot: s.lastSlot || null, runs: Array.isArray(s.runs) ? s.runs : [] };
  }
  function saveState(patch) { writeJsonAtomic(stateFile, { ...getState(), ...patch }); }
  function readLedger() { const l = readJsonSafe(ledgerFile); return l && l.files && typeof l.files === 'object' ? l : { files: {} }; }
  function ledgerAdd(uniqueId, rec) {
    const l = readLedger();
    l.files[uniqueId] = { ...(l.files[uniqueId] || {}), ...rec, at: new Date().toISOString() };
    writeJsonAtomic(ledgerFile, l);
  }

  // -- uploads ---------------------------------------------------------------------
  function readMeta(id) {
    if (!lib.isValidUploadId(id)) return null;
    try { return JSON.parse(fs.readFileSync(metaPath(id), 'utf8')); } catch { return null; }
  }
  function writeMeta(id, meta) {
    const tmp = metaPath(id) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(meta));
    fs.renameSync(tmp, metaPath(id));
  }
  function removeUpload(id) {
    for (const f of [partPath(id), metaPath(id)]) { try { fs.rmSync(f, { force: true }); } catch { /* gone */ } }
  }
  function sweepStale() {
    for (const dir of [uploadsDir, workRoot]) {
      let names = [];
      try { names = fs.readdirSync(dir); } catch { continue; }
      for (const n of names) {
        const p = path.join(dir, n);
        try { if (Date.now() - fs.statSync(p).mtimeMs > STALE_MS) fs.rmSync(p, { recursive: true, force: true }); } catch { /* raced */ }
      }
    }
    // inbox/: a partial download, or a recording no queue item points at any more.
    let names = [];
    try { names = fs.readdirSync(inboxDir); } catch { names = []; }
    const wanted = new Set(queue.list().map((i) => i.input));
    for (const n of names) {
      const p = path.join(inboxDir, n);
      try {
        if (!wanted.has(n) && Date.now() - fs.statSync(p).mtimeMs > STALE_MS) fs.rmSync(p, { force: true });
      } catch { /* raced */ }
    }
  }
  try { sweepStale(); } catch { /* never block register */ }

  async function body(req, res) {
    try { return await ctx.readBody(req, READ_BODY_LIMIT); } catch (e) {
      fail(res, 400, 'bad-body', 'Could not read the request: ' + e.message);
      return null;
    }
  }

  async function handleUploadStart(req, res) {
    const b = await body(req, res); if (!b) return;
    const name = typeof b.name === 'string' ? b.name.slice(0, 200) : '';
    const size = Number(b.size);
    const lastModified = Number(b.lastModified);
    if (!lib.allowedExtension(name)) {
      return fail(res, 400, 'bad-extension', 'Unsupported file format. Allowed: ' + lib.ALLOWED_EXTS.join(', ') + '.');
    }
    if (!Number.isInteger(size) || size <= 0) return fail(res, 400, 'bad-size', 'Invalid file size.');
    if (size > UPLOAD_MAX_BYTES) return fail(res, 413, 'too-large', 'The file is larger than 2 GB.');
    sweepStale();
    fs.mkdirSync(uploadsDir, { recursive: true });
    const id = crypto.randomBytes(12).toString('hex');
    fs.writeFileSync(partPath(id), '');
    const recordedAt = Number.isFinite(lastModified) && lastModified > 0 && lastModified <= Date.now() + 86400000
      ? new Date(lastModified).toISOString() : null;
    writeMeta(id, { name, size, recordedAt, received: 0, nextIndex: 0, finished: false, createdAt: Date.now() });
    ctx.jsonResponse(res, 200, { uploadId: id, chunkBytes: CHUNK_BYTES });
  }

  async function handleUploadChunk(req, res) {
    const b = await body(req, res); if (!b) return;
    const id = b.uploadId;
    const index = Number(b.index);
    if (typeof b.dataBase64 !== 'string' || !b.dataBase64) return fail(res, 400, 'bad-chunk', 'Empty file chunk.');
    const buf = Buffer.from(b.dataBase64, 'base64');
    if (!buf.length || buf.length > CHUNK_BYTES) return fail(res, 400, 'bad-chunk', 'Invalid file chunk.');
    await withUploadLock(async () => {
      const meta = readMeta(id);
      if (!meta || meta.finished) return fail(res, 404, 'not-found', 'No such upload.');
      if (index !== meta.nextIndex) return fail(res, 409, 'out-of-order', 'Chunks arrived out of order.');
      if (meta.received + buf.length > meta.size) return fail(res, 400, 'too-much', 'More data was sent than the file size.');
      fs.appendFileSync(partPath(id), buf);
      meta.received += buf.length;
      meta.nextIndex += 1;
      writeMeta(id, meta);
      ctx.jsonResponse(res, 200, { received: meta.received });
    });
  }

  async function handleUploadFinish(req, res) {
    const b = await body(req, res); if (!b) return;
    await withUploadLock(async () => {
      const meta = readMeta(b.uploadId);
      if (!meta) return fail(res, 404, 'not-found', 'No such upload.');
      let onDisk = -1;
      try { onDisk = fs.statSync(partPath(b.uploadId)).size; } catch { onDisk = -1; }
      if (meta.received !== meta.size || onDisk !== meta.size) {
        return fail(res, 409, 'incomplete', 'The file was not uploaded completely.');
      }
      meta.finished = true;
      writeMeta(b.uploadId, meta);
      ctx.jsonResponse(res, 200, { ok: true, size: meta.size });
    });
  }

  async function handleUploadCancel(req, res) {
    const b = await body(req, res); if (!b) return;
    if (!lib.isValidUploadId(b.uploadId)) return fail(res, 400, 'bad-id', 'Invalid identifier.');
    await withUploadLock(async () => { removeUpload(b.uploadId); });
    ctx.jsonResponse(res, 200, { ok: true });
  }

  /** POST /enqueue {uploadId, participants} - the finished upload joins the queue. */
  async function handleEnqueue(req, res) {
    const b = await body(req, res); if (!b) return;
    const participants = lib.parseParticipants(typeof b.participants === 'string' ? b.participants : '');
    let item = null;
    await withUploadLock(async () => {
      const meta = readMeta(b.uploadId);
      if (!meta || !meta.finished) return fail(res, 404, 'not-found', 'No uploaded file has this identifier.');
      fs.mkdirSync(inboxDir, { recursive: true });
      const input = 'u-' + b.uploadId + (lib.allowedExtension(meta.name) || '.bin');
      fs.renameSync(partPath(b.uploadId), path.join(inboxDir, input));
      removeUpload(b.uploadId);
      item = queue.add({
        origin: 'upload', sourceName: meta.name, sourceBytes: meta.size, input, recordedAt: meta.recordedAt, participants,
      });
      ctx.jsonResponse(res, 200, { ok: true, item: publicItem(item) });
    });
    if (item) drain();
  }

  // -- the worker --------------------------------------------------------------------
  let current = null; // {id, percent, step, log: [], controller}
  let draining = null;
  let blocked = null; // 'no-token' | 'no-ffmpeg' | null

  function preconditions() {
    if (getSettings().paused) return 'paused';
    if (!gemini.hasKey()) return 'no-token';
    if (!media.findTools()) return 'no-ffmpeg';
    return null;
  }

  function publicItem(i) {
    if (!i) return null;
    const { input, participants, log: _log, ...rest } = i;
    return { ...rest, participants: participants ? participants.length : 0, hasInput: !!input && fs.existsSync(path.join(inboxDir, input)) };
  }

  async function processOne(item) {
    const inputPath = path.join(inboxDir, item.input || '');
    if (!isValidInput(item.input) || !fs.existsSync(inputPath)) {
      queue.update(item.id, { status: 'failed', error: 'input-missing', message: 'The recording file is missing - add it again.', finishedAt: new Date().toISOString() });
      return;
    }
    const controller = new AbortController();
    current = { id: item.id, percent: 0, step: 'Start...', log: [], controller };
    queue.update(item.id, { status: 'processing', attempts: (item.attempts || 0) + 1, startedAt: new Date().toISOString(), error: null, message: null });
    const log = (text) => {
      if (!current) return;
      current.log.push(String(text));
      if (current.log.length > LOG_KEEP) current.log.shift();
    };
    const progress = (percent, step) => {
      if (!current) return;
      if (Number.isFinite(percent)) current.percent = Math.max(0, Math.min(100, Math.round(percent)));
      if (step) current.step = step;
    };
    let result;
    try {
      const { model } = await gemini.currentModel();
      log('Recording: ' + item.sourceName + (item.folderLabel ? ' (' + item.folderLabel + ')' : '') + '.');
      result = await pipeline.runJob({
        uploadPath: inputPath,
        workDir: path.join(workRoot, item.id),
        sourceName: item.sourceName,
        sourceBytes: item.sourceBytes,
        recordedAt: item.recordedAt || null,
        participants: item.participants || [],
        model,
        rootDir: ctx.rootDir,
        teamFile: ctx.dataTier0Dir ? path.join(ctx.dataTier0Dir, 'team', 'team-members.json') : null,
        aliases: getSettings().aliases,
        progress, log,
        signal: controller.signal,
      });
    } catch (e) {
      result = { ok: false, error: (e && e.code) || 'error', message: (e && e.message) || String(e) };
    }
    const at = new Date().toISOString();
    // The job log outlives the job: kept on the item for "Log" later.
    queue.update(item.id, { log: current ? current.log.slice(-80) : [] });
    if (result && result.ok) {
      queue.update(item.id, { status: 'done', resultName: result.name, warnings: result.warnings || [], finishedAt: at, message: result.title || null });
      try { fs.rmSync(inputPath, { force: true }); } catch { /* kept */ }
      if (item.uniqueId) ledgerAdd(item.uniqueId, { status: 'processed', resultName: result.name });
      ctx.log('transcribed ' + item.sourceName + ' -> ' + result.name);
      // autoPublish: straight to the Meeting Archive (and the team) - not only at the
      // end of a scheduled cycle, so a queue drained between cycles goes too.
      if (getSettings().autoPublish) {
        const pub = await publishTranscript(result.name);
        ctx.log('auto-publish ' + result.name + ': ' + (pub.ok ? pub.folder + (pub.push && pub.push.ok ? '' : ' (push pending)') : (pub.error || 'failed')));
      }
    } else if (result && result.error === 'no-token') {
      // The vault locked mid-job: not the recording's fault, no attempt spent.
      queue.update(item.id, { status: 'queued', attempts: item.attempts || 0, message: 'Waiting for the Gemini key (vault).' });
      blocked = 'no-token';
    } else {
      const aborted = controller.signal.aborted;
      queue.update(item.id, {
        status: 'failed',
        error: aborted ? 'aborted' : ((result && result.error) || 'error'),
        message: aborted ? 'Cancelled.' : ((result && result.message) || 'Unknown error.'),
        finishedAt: at,
      });
      ctx.log('transcription failed ' + item.sourceName + ': ' + ((result && result.message) || ''));
    }
    current = null;
  }

  /** Drain the queue one item at a time. Concurrent calls share one run. */
  function drain() {
    if (draining) return draining;
    draining = (async () => {
      try {
        for (;;) {
          blocked = preconditions();
          if (blocked) break;
          const item = queue.next();
          if (!item) break;
          try {
            await processOne(item);
          } catch (e) {
            // processOne only throws when the queue file itself cannot be
            // written: never leave `current` set (the UI would show the job
            // running forever) and never reject - drain() is fire-and-forget.
            current = null;
            ctx.log('queue worker failed on ' + item.id + ': ' + ((e && e.message) || e));
            try {
              queue.update(item.id, { status: 'failed', error: 'error', message: 'Queue write error: ' + ((e && e.message) || e), finishedAt: new Date().toISOString() });
            } catch { /* disk still failing */ }
            break;
          }
          if (blocked) break;
        }
      } catch (e) {
        ctx.log('queue drain failed: ' + ((e && e.message) || e));
      } finally {
        draining = null;
      }
    })();
    return draining;
  }

  // -- publish to the Meeting Archive ---------------------------------------------------
  // One publish per transcript at a time, shared by the button and the cycle's
  // autoPublish - two concurrent publishes of one file could create two meetings.
  const publishing = new Set();
  async function publishTranscript(name) {
    if (publishing.has(name)) return { ok: false, error: 'busy', message: 'This transcript is being sent right now.' };
    publishing.add(name);
    try {
      return await _publishTranscript(name);
    } finally {
      publishing.delete(name);
    }
  }

  async function _publishTranscript(name) {
    const r = await loopback.request('POST', '/api/m/meeting-archive/publish', { name });
    let out;
    if (r.status === 200 && r.body && r.body.ok) {
      out = { ok: true, folder: r.body.folder, republished: !!r.body.republished, push: r.body.push || { ok: false } };
    } else if (r.status === 404 && !(r.body && r.body.error)) {
      out = { ok: false, error: 'archive-missing', message: 'The Meeting Archive module is not installed or is disabled.' };
    } else {
      out = { ok: false, error: (r.body && r.body.error) || r.error || ('http-' + r.status), message: (r.body && r.body.message) || r.error || '' };
    }
    const item = queue.findBy((i) => i.resultName === name);
    if (item) {
      queue.update(item.id, out.ok
        ? { published: { folder: out.folder, at: new Date().toISOString(), pushOk: !!out.push.ok, pushError: out.push.ok ? null : (out.push.error || 'push-failed') }, publishError: null }
        : { publishError: out.message || out.error });
    }
    return out;
  }

  async function publishedMap() {
    const r = await loopback.request('GET', '/api/m/meeting-archive/sources', null, { timeoutMs: 5000 });
    if (r.status !== 200 || !r.body) return { available: false, sources: {}, sourceFiles: [] };
    return { available: true, storage: r.body.storage, sources: r.body.sources || {}, sourceFiles: r.body.sourceFiles || [] };
  }

  // -- the cycle: OneDrive -> queue -> transcripts -> (Meeting Archive) ------------------
  let cycle = null; // {id, trigger, startedAt, phase}

  async function scanOneDrive(settings, run) {
    const folders = settings.folders.filter((f) => f.enabled);
    if (!folders.length) { run.notes.push('no-folders'); return; }
    const pub = await publishedMap();
    if (!pub.available) run.notes.push('archive-unknown');
    const ledger = readLedger();
    const byId = new Map(folders.map((f) => [f.id, f]));
    run.scan = { folders: folders.length, listed: 0, downloaded: 0, archived: 0, errors: [], expired: false };
    const r = await runner.runWorker('scan', {
      folders: folders.map((f) => ({ id: f.id, siteUrl: f.siteUrl, serverRelativePath: f.serverRelativePath })),
      inboxDir,
      known: Object.keys(ledger.files),
      archivedNames: pub.sourceFiles,
      minBytes: settings.minSizeMb * 1024 * 1024,
      sinceIso: settings.sinceDate ? settings.sinceDate + 'T00:00:00Z' : null,
      maxFiles: settings.maxFilesPerRun,
    }, {
      onEvent: (ev) => {
        const f = byId.get(ev.folderId);
        if (ev.event === 'folder-listed') run.scan.listed += 1;
        if (ev.event === 'file-start' && extraScan) extraScan.phase = 'Extra download from OneDrive: ' + ev.name;
        else if (ev.event === 'file-start' && cycle) cycle.phase = 'Downloading from OneDrive: ' + ev.name;
        if (ev.event === 'file-archived') {
          ledgerAdd(ev.uniqueId, { status: 'archived', name: ev.name, folderId: ev.folderId });
          run.scan.archived += 1;
        }
        if (ev.event === 'file-downloaded' && isValidInput(ev.file)) {
          ledgerAdd(ev.uniqueId, { status: 'downloaded', name: ev.name, folderId: ev.folderId, size: ev.size });
          queue.add({
            origin: 'onedrive', sourceName: ev.name, sourceBytes: ev.size, input: ev.file,
            recordedAt: ev.created || ev.modified || null, folderId: ev.folderId, folderLabel: f ? f.label : null, uniqueId: ev.uniqueId,
          });
          run.scan.downloaded += 1;
        }
        if (ev.event === 'file-error') run.scan.errors.push({ folder: f ? f.label : ev.folderId, code: 'download', message: (ev.name || '') + ': ' + (ev.message || '') });
        if (ev.event === 'folder-error') run.scan.errors.push({ folder: f ? f.label : ev.folderId, code: ev.code, message: '' });
        if (ev.event === 'session-expired') run.scan.expired = true;
        if (ev.event === 'offline') run.scan.errors.push({ folder: null, code: 'offline', message: '' });
        if (ev.event === 'fatal') run.scan.errors.push({ folder: null, code: ev.code || 'fatal', message: ev.message || '' });
      },
    });
    if (r.busy) run.notes.push('sso-busy');
    if (r.error && !r.busy) run.scan.errors.push({ folder: null, code: r.error, message: '' });
  }

  /**
   * "Check OneDrive now" while a cycle is already transcribing: the
   * cycle's own scan is over, so one more scan may fill the queue (the next
   * batch of maxFilesPerRun recordings) without waiting hours for the drain.
   */
  let extraScan = null;
  async function runScanOnly(trigger) {
    const settings = getSettings();
    const run = { id: crypto.randomBytes(6).toString('hex'), trigger, startedAt: new Date().toISOString(), notes: ['scan-only'], scan: null, processed: 0, failed: 0, published: 0, publishErrors: [] };
    extraScan = { id: run.id, startedAt: run.startedAt, phase: 'Extra download from OneDrive' };
    try {
      await scanOneDrive(settings, run);
    } catch (e) {
      run.notes.push('error: ' + ((e && e.message) || e));
    } finally {
      run.finishedAt = new Date().toISOString();
      const st = getState();
      saveState({ runs: [run, ...st.runs].slice(0, RUNS_KEEP) });
      extraScan = null;
    }
    drain();
  }

  async function runCycle(trigger) {
    if (cycle) return { ok: false, error: 'busy' };
    const settings = getSettings();
    const run = { id: crypto.randomBytes(6).toString('hex'), trigger, startedAt: new Date().toISOString(), notes: [], scan: null, processed: 0, failed: 0, published: 0, publishErrors: [] };
    cycle = { id: run.id, trigger, startedAt: run.startedAt, phase: PHASE_CHECK };
    try {
      await scanOneDrive(settings, run);
      // Failed items get another chance each cycle, up to MAX_ATTEMPTS.
      for (const i of queue.list()) {
        if (i.status === 'failed' && i.error !== 'aborted' && i.error !== 'input-missing' && (i.attempts || 0) < od.MAX_ATTEMPTS) {
          queue.update(i.id, { status: 'queued', message: 'Retry (' + ((i.attempts || 0) + 1) + '/' + od.MAX_ATTEMPTS + ').' });
        }
      }
      cycle.phase = PHASE_TRANSCRIBE;
      const before = new Map(queue.list().map((i) => [i.id, i.status]));
      await drain();
      if (blocked) run.notes.push(blocked);
      for (const i of queue.list()) {
        if (before.get(i.id) !== i.status) {
          if (i.status === 'done') run.processed += 1;
          if (i.status === 'failed') run.failed += 1;
        }
      }
      if (settings.autoPublish) {
        cycle.phase = PHASE_PUBLISH;
        for (const i of queue.list()) {
          if (i.status !== 'done' || !i.resultName || i.published) continue;
          const r = await publishTranscript(i.resultName);
          if (r.ok) run.published += 1; else run.publishErrors.push(i.sourceName + ': ' + (r.message || r.error));
          if (!r.ok && (r.error === 'storage-unavailable' || r.error === 'archive-missing')) break;
        }
      }
    } catch (e) {
      run.notes.push('error: ' + ((e && e.message) || e));
      ctx.log('cycle failed: ' + ((e && e.message) || e));
    } finally {
      run.finishedAt = new Date().toISOString();
      const st = getState();
      saveState({ runs: [run, ...st.runs].slice(0, RUNS_KEEP) });
      cycle = null;
    }
    return { ok: true, run };
  }

  let lastKeepaliveTry = null;

  // -- scheduler ---------------------------------------------------------------------
  function tick() {
    try {
      const settings = getSettings();
      const now = new Date();
      if (!fs.existsSync(stateFile)) {
        // First start on this machine: never "catch up" a slot from before the install.
        const slot = od.todaySlot(settings.schedule.time, now);
        saveState({ lastSlot: now >= slot.at ? slot.key : null });
        return;
      }
      if (!cycle && !settings.paused && od.isDue(settings.schedule, getState().lastSlot, now)) {
        // Claim the slot BEFORE running: a crash mid-cycle must not loop.
        saveState({ lastSlot: od.todaySlot(settings.schedule.time, now).key });
        runCycle('schedule');
        return;
      }
      // A queue blocked on the vault resumes by itself once the key is there.
      if (!cycle && !draining && queue.next() && !preconditions()) drain();
      // Keep the Microsoft session of every folder's site warm between runs.
      const sess = runner.sessionInfo();
      const lastTouch = [sess.keepaliveAt, sess.loggedInAt, lastKeepaliveTry].filter(Boolean).sort().pop() || null;
      const folders = settings.folders.filter((f) => f.enabled);
      if (!cycle && !runner.isRunning() && folders.length && (sess.present || sess.seedPresent)
        && od.keepaliveDue(settings.keepaliveHours, lastTouch, now.getTime())) {
        lastKeepaliveTry = now.toISOString(); // a crashed worker must not retry every minute
        runner.keepalive(folders).then((r) => {
          if (r.expired) ctx.log('keepalive: ' + r.expired + ' site(s) need a new Microsoft login');
        }).catch(() => {});
      }
    } catch (e) {
      ctx.log('scheduler tick failed: ' + ((e && e.message) || e));
    }
  }

  if (!isTestMode()) {
    queue.resetInterrupted();
    const timer = setInterval(tick, TICK_MS);
    if (timer.unref) timer.unref();
    const first = setTimeout(tick, 15000);
    if (first.unref) first.unref();
  }

  // -- routes: status / queue -----------------------------------------------------------
  async function handleStatus(req, res) {
    const refresh = new URL(req.url, 'http://localhost').searchParams.get('refresh') === '1';
    const model = await gemini.currentModel({ refresh });
    ctx.jsonResponse(res, 200, {
      hasToken: gemini.hasKey(),
      hasFfmpeg: !!media.findTools(),
      busy: !!current,
      platform: process.platform,
      model: model.model,
      modelSource: model.source,
      extensions: lib.ALLOWED_EXTS,
      maxBytes: UPLOAD_MAX_BYTES,
    });
  }

  function handleQueue(_req, res) {
    const items = queue.list();
    const open = items.filter((i) => i.status !== 'done')
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const recent = items.filter((i) => i.status === 'done')
      .sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt))).slice(0, 10);
    const settings = getSettings();
    const st = getState();
    ctx.jsonResponse(res, 200, {
      items: [...open, ...recent].map(publicItem),
      current: current ? { id: current.id, percent: current.percent, step: current.step, log: current.log.slice(-60) } : null,
      blocked: queue.next() ? preconditions() : null,
      paused: getSettings().paused,
      cycle: cycle ? { ...cycle } : null,
      extraScan: extraScan ? { ...extraScan } : null,
      nextRunAt: od.nextRunAt(settings.schedule, st.lastSlot, new Date()),
      lastRun: st.runs[0] || null,
    });
  }

  /** GET /queue/log?id= - the saved log of a finished item. */
  function handleQueueLog(_req, res, url) {
    const id = url.searchParams.get('id') || '';
    if (!isValidItemId(id)) return fail(res, 400, 'bad-id', 'Invalid identifier.');
    const item = queue.get(id);
    if (!item) return fail(res, 404, 'not-found', 'No such item in the queue.');
    ctx.jsonResponse(res, 200, { id, log: Array.isArray(item.log) ? item.log : [] });
  }

  async function handleQueueAction(req, res, action) {
    const b = await body(req, res); if (!b) return;
    if (!isValidItemId(b.id)) return fail(res, 400, 'bad-id', 'Invalid identifier.');
    const item = queue.get(b.id);
    if (!item) return fail(res, 404, 'not-found', 'No such item in the queue.');
    if (action === 'retry') {
      if (item.status !== 'failed') return fail(res, 409, 'not-failed', 'Only a failed item can be retried.');
      queue.update(item.id, { status: 'queued', error: null, message: 'Retried by hand.', attempts: 0 });
      drain();
      return ctx.jsonResponse(res, 200, { ok: true });
    }
    if (action === 'redo') {
      // The recording was deleted after the transcription: an OneDrive item is
      // forgotten by the ledger, so the next scan downloads and queues it again.
      if (item.status !== 'done') return fail(res, 409, 'not-done', 'Only a finished item can be processed again.');
      if (item.origin !== 'onedrive' || !item.uniqueId) {
        return fail(res, 409, 'no-source', 'This recording was uploaded by hand - add the file again.');
      }
      if (item.published) {
        return fail(res, 409, 'published', 'This meeting is already in the Meeting Archive - remove it there first so no duplicate is created.');
      }
      const l = readLedger();
      delete l.files[item.uniqueId];
      writeJsonAtomic(ledgerFile, l);
      if (item.resultName && lib.isValidOutputName(item.resultName)) {
        for (const f of [item.resultName, lib.reportFileName(item.resultName)]) {
          try { fs.rmSync(path.join(pipeline.outputDir(ctx.rootDir), f), { force: true }); } catch { /* gone */ }
        }
      }
      queue.remove(item.id);
      return ctx.jsonResponse(res, 200, { ok: true });
    }
    if (action === 'cancel') {
      if (!current || current.id !== item.id) return fail(res, 409, 'not-running', 'This item is not being processed right now.');
      current.controller.abort();
      return ctx.jsonResponse(res, 200, { ok: true });
    }
    // remove
    if (current && current.id === item.id) return fail(res, 409, 'busy', 'Cancel the processing of this item first.');
    if (isValidInput(item.input)) { try { fs.rmSync(path.join(inboxDir, item.input), { force: true }); } catch { /* gone */ } }
    queue.remove(item.id);
    return ctx.jsonResponse(res, 200, { ok: true });
  }

  // -- routes: transcripts --------------------------------------------------------------
  function listOutputs() {
    const dir = pipeline.outputDir(ctx.rootDir);
    let names = [];
    try { names = fs.readdirSync(dir).filter(lib.isValidOutputName); } catch { names = []; }
    const rows = [];
    for (const name of names) {
      try {
        const doc = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        rows.push({
          name,
          title: doc.title || '',
          source_file: doc.source_file || '',
          processed_at: doc.processed_at || '',
          recorded_at: doc.recorded_at || null,
          duration_sec: doc.duration_sec || 0,
          status: doc.status || '',
          model: doc.model || '',
          participants: Array.isArray(doc.participants) ? doc.participants.length : 0,
          segments: Array.isArray(doc.segments) ? doc.segments.length : 0,
          hasReport: fs.existsSync(path.join(dir, lib.reportFileName(name))),
        });
      } catch { /* unreadable - skipped */ }
    }
    rows.sort((a, b) => (a.name < b.name ? 1 : -1));
    return rows;
  }

  async function handleList(_req, res) {
    const rows = listOutputs();
    const pub = await publishedMap();
    for (const r of rows) r.published = pub.sources[r.name] || null;
    ctx.jsonResponse(res, 200, {
      dir: 'user-data/transcripts',
      items: rows,
      archive: { available: pub.available, storage: pub.storage || null },
    });
  }

  function handleFile(_req, res, url) {
    const name = url.searchParams.get('name') || '';
    const match = listOutputs().find((r) => r.name === name);
    if (!match) return fail(res, 404, 'not-found', 'No such file.');
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(pipeline.outputDir(ctx.rootDir), match.name), 'utf8'));
      ctx.jsonResponse(res, 200, { name: match.name, doc });
    } catch {
      fail(res, 500, 'read-failed', 'Could not read the file.');
    }
  }

  function handleReport(_req, res, url) {
    const name = url.searchParams.get('name') || '';
    const match = listOutputs().find((r) => r.name === name);
    if (!match || !match.hasReport) return fail(res, 404, 'not-found', 'This file has no HTML report.');
    let html;
    try { html = fs.readFileSync(path.join(pipeline.outputDir(ctx.rootDir), lib.reportFileName(match.name)), 'utf8'); } catch {
      return fail(res, 500, 'read-failed', 'Could not read the report.');
    }
    // A static document with no script of its own: forbid scripts outright,
    // allow only the inline CSS and the embedded data: logo.
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline; filename="' + lib.reportFileName(match.name) + '"',
    });
    res.end(html);
  }

  const reportBuilds = new Set();
  async function handleReportBuild(req, res) {
    const b = await body(req, res); if (!b) return;
    const match = listOutputs().find((r) => r.name === b.name);
    if (!match) return fail(res, 404, 'not-found', 'No such file.');
    if (reportBuilds.has(match.name)) return fail(res, 409, 'busy', 'The report for this file is being built right now.');
    reportBuilds.add(match.name);
    try {
      const file = await pipeline.buildReportForFile(ctx.rootDir, match.name, { force: b.force === true });
      ctx.jsonResponse(res, 200, { ok: true, name: match.name, report: file });
    } catch (e) {
      if (e && e.code === 'no-token') return fail(res, 409, 'no-token', 'No Gemini key. Open the vault (Bitwarden) to load it.');
      fail(res, 502, (e && e.code) || 'report-failed', 'Could not build the report: ' + (e && e.message ? e.message : e));
    } finally {
      reportBuilds.delete(match.name);
    }
  }

  async function handlePublish(req, res) {
    const b = await body(req, res); if (!b) return;
    if (!lib.isValidOutputName(b.name) || !listOutputs().some((r) => r.name === b.name)) {
      return fail(res, 404, 'not-found', 'No such transcript.');
    }
    const r = await publishTranscript(b.name);
    if (!r.ok) return fail(res, r.error === 'archive-missing' ? 404 : 409, r.error, r.message || 'Could not send to the Meeting Archive.');
    ctx.jsonResponse(res, 200, r);
  }

  // -- routes: settings / OneDrive ----------------------------------------------------------
  function settingsPayload() {
    const settings = getSettings();
    const st = getState();
    return {
      settings,
      session: runner.sessionInfo(),
      nextRunAt: od.nextRunAt(settings.schedule, st.lastSlot, new Date()),
      cycle: cycle ? { ...cycle } : null,
      ledgerCount: Object.keys(readLedger().files).length,
    };
  }

  function handleSettingsGet(_req, res) {
    ctx.jsonResponse(res, 200, settingsPayload());
  }

  async function handleSettingsPost(req, res) {
    const b = await body(req, res); if (!b) return;
    const cur = getSettings();
    const next = { ...cur };
    if (b.schedule !== undefined) {
      const s = { ...cur.schedule, ...(b.schedule || {}) };
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(s.time))) return fail(res, 400, 'bad-time', 'Time in HH:MM format.');
      next.schedule = s;
    }
    for (const k of ['minSizeMb', 'sinceDate', 'maxFilesPerRun', 'autoPublish', 'keepaliveHours', 'paused', 'aliases']) if (b[k] !== undefined) next[k] = b[k];
    if (b.folders !== undefined) {
      if (!Array.isArray(b.folders)) return fail(res, 400, 'bad-folders', 'Invalid folder list.');
      const bad = b.folders.find((f) => !od.parseFolderUrl(f && f.url));
      if (bad) {
        return fail(res, 400, 'bad-folder-url',
          'Unrecognised folder address: ' + String((bad && bad.url) || '').slice(0, 120)
          + '. Open the folder in OneDrive in a browser and copy the address bar (with the id= parameter) or give the full folder path (…/personal/<user>/Documents/<folder>).');
      }
      next.folders = b.folders;
    }
    writeJsonAtomic(settingsFile, od.normalizeSettings(next));
    ctx.jsonResponse(res, 200, settingsPayload());
  }

  async function handleLogin(_req, res) {
    if (isTestMode()) return fail(res, 409, 'test-mode', 'Not available in test mode.');
    const folders = getSettings().folders.filter((f) => f.enabled);
    if (!folders.length) return fail(res, 409, 'no-folders', 'Add at least one OneDrive folder first.');
    const r = await runner.startLogin(folders);
    if (!r.ok) {
      const msg = r.error === 'busy' ? 'The browser is already in use (a sign-in or a download is running).'
        : 'Could not start the browser (Playwright): ' + (r.message || r.error);
      return fail(res, 409, r.error, msg);
    }
    ctx.jsonResponse(res, 200, { ok: true });
  }

  /** POST /pause {paused} - hold (or release) the queue and the daily cycle. */
  async function handlePause(req, res) {
    const b = await body(req, res); if (!b) return;
    if (typeof b.paused !== 'boolean') return fail(res, 400, 'bad-paused', 'Send paused: true or false.');
    writeJsonAtomic(settingsFile, od.normalizeSettings({ ...getSettings(), paused: b.paused }));
    if (!b.paused) drain();
    ctx.jsonResponse(res, 200, { ok: true, paused: b.paused });
  }

  async function handleKeepalive(_req, res) {
    if (isTestMode()) return fail(res, 409, 'test-mode', 'Not available in test mode.');
    if (cycle || runner.isRunning()) return fail(res, 409, 'busy', 'The browser is busy - try again in a moment.');
    const folders = getSettings().folders.filter((f) => f.enabled);
    if (!folders.length) return fail(res, 409, 'no-folders', 'Add at least one OneDrive folder first.');
    const r = await runner.keepalive(folders);
    ctx.jsonResponse(res, 200, { ...r, session: runner.sessionInfo() });
  }

  async function handleRunNow(_req, res) {
    if (isTestMode()) return fail(res, 409, 'test-mode', 'Not available in test mode.');
    if (extraScan || runner.isRunning()) return fail(res, 409, 'busy', 'The browser is busy - a download or a sign-in is running.');
    if (cycle) {
      if (cycle.phase !== PHASE_TRANSCRIBE && cycle.phase !== PHASE_PUBLISH) {
        return fail(res, 409, 'busy', 'The cycle is downloading recordings right now - try again once it moves on to transcription.');
      }
      runScanOnly('manual');
      return ctx.jsonResponse(res, 202, { ok: true, scanOnly: true });
    }
    runCycle('manual');
    ctx.jsonResponse(res, 202, { ok: true });
  }

  function handleRuns(_req, res) {
    ctx.jsonResponse(res, 200, { runs: getState().runs });
  }

  const u = (req) => new URL(req.url, 'http://localhost');
  return {
    routes: [
      { method: 'GET', path: '/status', handler: handleStatus },
      { method: 'POST', path: '/upload-start', handler: handleUploadStart },
      { method: 'POST', path: '/upload-chunk', handler: handleUploadChunk },
      { method: 'POST', path: '/upload-finish', handler: handleUploadFinish },
      { method: 'POST', path: '/upload-cancel', handler: handleUploadCancel },
      { method: 'POST', path: '/enqueue', handler: handleEnqueue },
      { method: 'GET', path: '/queue', handler: handleQueue },
      { method: 'GET', path: '/queue/log', handler: (req, res) => handleQueueLog(req, res, u(req)) },
      { method: 'POST', path: '/queue/retry', handler: (req, res) => handleQueueAction(req, res, 'retry') },
      { method: 'POST', path: '/queue/remove', handler: (req, res) => handleQueueAction(req, res, 'remove') },
      { method: 'POST', path: '/queue/cancel', handler: (req, res) => handleQueueAction(req, res, 'cancel') },
      { method: 'POST', path: '/queue/redo', handler: (req, res) => handleQueueAction(req, res, 'redo') },
      { method: 'POST', path: '/pause', handler: handlePause },
      { method: 'GET', path: '/list', handler: handleList },
      { method: 'GET', path: '/file', handler: (req, res) => handleFile(req, res, u(req)) },
      { method: 'GET', path: '/report', handler: (req, res) => handleReport(req, res, u(req)) },
      { method: 'POST', path: '/report-build', handler: handleReportBuild },
      { method: 'POST', path: '/publish', handler: handlePublish },
      { method: 'GET', path: '/settings', handler: handleSettingsGet },
      { method: 'POST', path: '/settings', handler: handleSettingsPost },
      { method: 'POST', path: '/onedrive/login', handler: handleLogin },
      { method: 'POST', path: '/run-now', handler: handleRunNow },
      { method: 'POST', path: '/onedrive/keepalive', handler: handleKeepalive },
      { method: 'GET', path: '/runs', handler: handleRuns },
    ],
  };
};
