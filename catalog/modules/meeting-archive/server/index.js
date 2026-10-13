'use strict';
// modules/meeting-archive/server/index.js
// Archive of ds-data/meeting-archive/ (team data, data-tier-0) under /api/m/meeting-archive/.
// Reads: GET /list, /meeting, /html, /sources, /widget (dashboard tile: newest
// N meetings + counts, memoised, participants of the newest one only).
// Writes (this module OWNS meeting-archive/ - dataRepos access write), each one
// followed at once by the core's scoped push of meeting-archive/ (team-push.js):
//   POST /publish  {name}            transcript of meeting-transcripts -> folder
//   POST /meta     {folder, ...}     meeting-user-meta.json
//   POST /delete   {folder}
//   POST /categories {action, ...}   _categories.json
//   POST /folders    {action, ...}   _folder-tree.json
//   POST /push                       retry the push alone
// A write is refused while the plaintext tree is absent (not cloned, or
// wiped by "End of day"): writing into an empty tree and pushing it would
// read as deleting the team's archive.

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const lib = require('./meetings-lib');
const pub = require('./publish-lib');
const teamPush = require('./team-push');
const folderAssign = require('./folder-assign');

const WIDGET_TTL_MS = 60 * 1000;
const WIDGET_MAX_PARTICIPANTS = 12;
const WIDGET_DEFAULT_LIMIT = 5;

const HTML_FILES = { summary: 'summary.html', report: 'report.html' };
const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_TRANSCRIPT_BYTES = 64 * 1024 * 1024;

const LOGO_TEMPLATE = path.resolve(__dirname, '..', '..', '..', 'templates', 'meeting-report.template.html');
let _logoUri = null;
function reportLogoUri() {
  if (_logoUri !== null) return _logoUri;
  try { _logoUri = lib.extractLogoDataUri(fs.readFileSync(LOGO_TEMPLATE, 'utf8')); } catch { _logoUri = ''; }
  return _logoUri;
}

/**
 * @param {string} rootDir
 * @returns {object[]} categories {id, name}
 */
function readCategories(rootDir) {
  const j = lib.readJsonSafe(path.join(paths.meetingsDir(rootDir), '_categories.json'));
  const list = j && Array.isArray(j.categories) ? j.categories : [];
  return list.filter((c) => c && c.id).map((c) => ({ id: String(c.id), name: String(c.name || c.id) }));
}

/**
 * @param {string} rootDir
 * @returns {object[]} folders {id, name, parentId, order}
 */
function readFolders(rootDir) {
  const j = lib.readJsonSafe(path.join(paths.meetingsDir(rootDir), '_folder-tree.json'));
  const list = j && Array.isArray(j.folders) ? j.folders : [];
  return list.filter((f) => f && f.id).map((f) => ({
    id: String(f.id),
    name: String(f.name || f.id),
    parentId: f.parent_id ? String(f.parent_id) : null,
    order: Number(f.order) || 0,
  }));
}

module.exports = function register(ctx) {
  const root = ctx.rootDir;

  function query(req) {
    return new URL(req.url, 'http://localhost').searchParams;
  }

  function loadItem(folder) {
    const dir = paths.meetingDir(root, folder);
    if (!dir) return null;
    const metadata = lib.readJsonSafe(path.join(dir, 'metadata.json'));
    const info = lib.readJsonSafe(path.join(dir, 'meeting-info.json'));
    const userMeta = lib.readJsonSafe(path.join(dir, 'meeting-user-meta.json'));
    if (!metadata && !info && !userMeta) return { dir, item: null };
    const item = lib.buildListItem({ folder, metadata, info, userMeta, dir });
    item.sourceTranscript = metadata && typeof metadata.source_transcript === 'string' ? metadata.source_transcript : null;
    return { dir, item, metadata, userMeta };
  }

  function listHandler(_req, res) {
    if (paths.storageState(root) !== 'ok') {
      return ctx.jsonResponse(res, 200, { storage: 'unavailable', categories: [], folders: [], meetings: [] });
    }
    let entries;
    try { entries = fs.readdirSync(paths.meetingsDir(root), { withFileTypes: true }); } catch { entries = []; }
    const meetings = [];
    for (const e of entries) {
      if (!e.isDirectory() || !paths.isValidFolder(e.name)) continue;
      const loaded = loadItem(e.name);
      if (loaded && loaded.item) meetings.push(loaded.item);
    }
    meetings.sort((a, b) => String(b.date).localeCompare(String(a.date)) || a.folder.localeCompare(b.folder));
    return ctx.jsonResponse(res, 200, {
      storage: 'ok', categories: readCategories(root), folders: readFolders(root), meetings,
    });
  }

  // -- GET /widget?limit=N -----------------------------------------------------
  // The dashboard tile: folder, title, date, status and participant COUNT of the
  // newest N meetings (clamped 1-10), participant names of the newest one only
  // (avatars), plus aggregates (total, last 30 days, status split, this month's
  // calendar). No brief, no folder tree, no categories. The scan is memoised on
  // the meetings dir mtime (a new folder moves it) plus a 60 s TTL (an edit
  // inside a folder does not). Read-only: no lock, no write, no child process.
  let widgetMemo = null;

  function mtimeOf(p) {
    try { return fs.statSync(p).mtimeMs; } catch { return 0; }
  }

  function isoDay(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function scanForWidget(now) {
    let entries;
    try { entries = fs.readdirSync(paths.meetingsDir(root), { withFileTypes: true }); } catch { entries = []; }
    const items = [];
    for (const e of entries) {
      if (!e.isDirectory() || !paths.isValidFolder(e.name)) continue;
      const loaded = loadItem(e.name);
      if (loaded && loaded.item) items.push(loaded.item);
    }
    // Newest first; on the same date the later folder (YYYY-MM-DD_HH-MM_...) wins,
    // so "the newest meeting" is the last one of the day, not the first.
    items.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.folder.localeCompare(a.folder));
    // "last 30 days" = today and the 29 days before it
    const cutoff = isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29));
    const monthKey = isoDay(now).slice(0, 7);
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const counts = Array(daysInMonth).fill(0);
    let last30 = 0;
    let failed = 0;
    for (const m of items) {
      const d = String(m.date || '');
      if (m.status === 'error') failed++;
      if (d >= cutoff && d <= isoDay(now)) last30++;
      if (d.startsWith(monthKey)) {
        const day = Number(d.slice(8, 10));
        if (day >= 1 && day <= daysInMonth) counts[day - 1]++;
      }
    }
    // days after today carry no data yet
    for (let i = now.getDate(); i < daysInMonth; i++) counts[i] = null;
    const first = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
    return {
      items,
      aggregates: {
        total: items.length,
        last30,
        statusCounts: { ok: items.length - failed, error: failed },
        month: { year: now.getFullYear(), month: now.getMonth() + 1, firstWeekday: first === 0 ? 7 : first, days: counts },
      },
    };
  }

  function widgetHandler(req, res) {
    if (paths.storageState(root) !== 'ok') {
      return ctx.jsonResponse(res, 200, { storage: 'unavailable', total: 0, meetings: [], participants: [] });
    }
    const raw = Number(query(req).get('limit'));
    const limit = Number.isFinite(raw) && raw >= 1 ? Math.min(10, Math.floor(raw)) : WIDGET_DEFAULT_LIMIT;
    const now = new Date();
    const sig = mtimeOf(paths.meetingsDir(root)) + '|' + isoDay(now);
    if (!widgetMemo || widgetMemo.sig !== sig || Date.now() - widgetMemo.at > WIDGET_TTL_MS) {
      widgetMemo = { sig, at: Date.now(), data: scanForWidget(now) };
    }
    const { items, aggregates } = widgetMemo.data;
    const newest = items[0];
    return ctx.jsonResponse(res, 200, {
      storage: 'ok',
      ...aggregates,
      limit,
      meetings: items.slice(0, limit).map((m) => ({
        folder: m.folder, title: m.title, date: m.date, status: m.status, participantCount: m.participants.length,
      })),
      participants: newest
        ? newest.participants.slice(0, WIDGET_MAX_PARTICIPANTS).map((p) => ({ name: p.name }))
        : [],
      participantsFolder: newest ? newest.folder : null,
    });
  }

  function meetingHandler(req, res) {
    const folder = query(req).get('folder') || '';
    if (!paths.isValidFolder(folder)) return ctx.jsonResponse(res, 400, { error: 'bad-folder' });
    if (paths.storageState(root) !== 'ok') return ctx.jsonResponse(res, 200, { storage: 'unavailable' });
    const dir = paths.meetingDir(root, folder);
    if (!dir || !fs.existsSync(dir)) return ctx.jsonResponse(res, 404, { error: 'not-found' });
    const loaded = loadItem(folder);
    if (!loaded || !loaded.item) return ctx.jsonResponse(res, 404, { error: 'not-found' });
    const md = loaded.metadata || {};
    let summaryRaw = '';
    try { summaryRaw = fs.readFileSync(path.join(dir, 'summary.md'), 'utf8'); } catch { summaryRaw = ''; }
    const tj = lib.readJsonSafe(path.join(dir, 'transcript.json'));
    const segments = tj && Array.isArray(tj.segments) ? tj.segments : null;
    let transcriptText = null;
    if (!segments) {
      try { transcriptText = fs.readFileSync(path.join(dir, 'transcript.txt'), 'utf8'); } catch { transcriptText = null; }
    }
    const cats = readCategories(root).filter((c) => loaded.item.categoryIds.includes(c.id));
    return ctx.jsonResponse(res, 200, {
      storage: 'ok',
      ...loaded.item,
      categories: cats,
      customTitle: (loaded.userMeta && loaded.userMeta.custom_title) || '',
      sourceFile: md.source_file || '',
      processedAt: md.processed_at || '',
      summaryMd: lib.extractSummaryMd(summaryRaw) || '',
      transcript: segments,
      transcriptText,
    });
  }

  function htmlHandler(req, res) {
    const q = query(req);
    const folder = q.get('folder') || '';
    const kind = q.get('kind') || '';
    if (!paths.isValidFolder(folder)) return ctx.jsonResponse(res, 400, { error: 'bad-folder' });
    if (!Object.prototype.hasOwnProperty.call(HTML_FILES, kind)) return ctx.jsonResponse(res, 400, { error: 'bad-kind' });
    const dir = paths.meetingDir(root, folder);
    if (!dir) return ctx.jsonResponse(res, 400, { error: 'bad-folder' });
    const file = path.join(dir, HTML_FILES[kind]);
    let st;
    try { st = fs.statSync(file); } catch { return ctx.jsonResponse(res, 404, { error: 'not-found' }); }
    if (!st.isFile()) return ctx.jsonResponse(res, 404, { error: 'not-found' });
    if (st.size > MAX_HTML_BYTES) return ctx.jsonResponse(res, 413, { error: 'too-large' });
    return ctx.jsonResponse(res, 200, { html: lib.fillLogoPlaceholder(fs.readFileSync(file, 'utf8'), reportLogoUri()) });
  }

  // -- writes ---------------------------------------------------------------
  const withWriteLock = ctx.makeLock();
  const fail = (res, status, error, message) => ctx.jsonResponse(res, status, { error, message });

  async function body(req, res) {
    let b;
    try { b = await ctx.readBody(req, 1024 * 1024); } catch (e) {
      fail(res, 400, 'bad-body', 'Could not read the request: ' + e.message);
      return null;
    }
    // A JSON `null`, array or scalar would leave the handler without an answer.
    if (!b || typeof b !== 'object' || Array.isArray(b)) {
      fail(res, 400, 'bad-body', 'Invalid request - a JSON object was expected.');
      return null;
    }
    return b;
  }

  function writeAtomic(file, text) {
    const tmp = file + '.tmp.' + process.pid;
    try {
      fs.writeFileSync(tmp, text, 'utf8');
      fs.renameSync(tmp, file);
    } catch (e) {
      // A stray tmp file inside meeting-archive/ would ride into the next scoped push.
      try { fs.rmSync(tmp, { force: true }); } catch { /* already gone */ }
      throw e;
    }
  }

  /**
   * Shared list file (_categories.json / _folder-tree.json) for a
   * read-modify-write. An existing file that does not parse is NOT treated as
   * empty: rewriting it with one entry and pushing would wipe the team's list.
   * @returns {{ok: true, json: object}|{ok: false}}
   */
  function readSharedForWrite(file) {
    if (!fs.existsSync(file)) return { ok: true, json: {} };
    const j = lib.readJsonSafe(file);
    if (!j || typeof j !== 'object' || Array.isArray(j)) return { ok: false };
    return { ok: true, json: j };
  }
  const unreadableShared = () => ({
    status: 409, error: 'shared-file-unreadable',
    message: 'A list file in the archive cannot be read - saving is paused so the team data is not overwritten. Pull changes in the Sync window.',
  });

  function storageRefusal(res) {
    if (paths.storageState(root) === 'ok') return false;
    fail(res, 409, 'storage-unavailable',
      'The meeting archive is not available on this computer (the "Team data" source is not cloned or was cleared at the end of the day). Pull it in the Sync window and try again.');
    return true;
  }

  /** Folder of an earlier publication of the same transcript, or null. */
  function folderOfTranscript(name) {
    let entries = [];
    try { entries = fs.readdirSync(paths.meetingsDir(root), { withFileTypes: true }); } catch { return null; }
    for (const e of entries) {
      if (!e.isDirectory() || !paths.isValidFolder(e.name)) continue;
      const md = lib.readJsonSafe(path.join(paths.meetingsDir(root), e.name, 'metadata.json'));
      if (md && md.source_transcript === name) return e.name;
    }
    return null;
  }

  /** Write, then push. The push outcome never undoes the local write. */
  async function writeThenPush(res, writeFn) {
    let result;
    try {
      result = await withWriteLock(async () => writeFn());
    } catch (e) {
      return fail(res, 500, 'write-failed', 'Could not save the changes: ' + (e && e.message ? e.message : e));
    }
    if (!result || result.error) return fail(res, (result && result.status) || 400, result.error, result.message || '');
    const push = await teamPush.pushModuleNow();
    if (!push.ok) ctx.log('push after write failed: ' + push.error + ' ' + (push.message || ''));
    return ctx.jsonResponse(res, 200, { ok: true, ...result, push });
  }

  function transcriptsDir() {
    return path.join(root, 'user-data', 'transcripts');
  }

  async function publishHandler(req, res) {
    const b = await body(req, res); if (!b) return;
    if (!pub.isValidTranscriptName(b.name)) return fail(res, 400, 'bad-name', 'Invalid transcript file name.');
    if (storageRefusal(res)) return;
    const file = path.join(transcriptsDir(), b.name);
    let doc;
    try {
      if (fs.statSync(file).size > MAX_TRANSCRIPT_BYTES) return fail(res, 413, 'too-large', 'The transcript file is too large.');
      doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return fail(res, 404, 'not-found', 'No such transcript in user-data/transcripts/.');
    }
    if (!doc || !Array.isArray(doc.segments) || !doc.segments.length) {
      return fail(res, 422, 'empty-transcript', 'This transcript is empty - there is nothing to publish.');
    }
    // New meetings get a folder (series from the archive, else Claude). A
    // republish keeps whatever is there - a person may have moved it since.
    let assignment = null;
    if (!folderOfTranscript(b.name)) {
      const archive = [];
      for (const e of fs.readdirSync(paths.meetingsDir(root), { withFileTypes: true })) {
        if (!e.isDirectory() || !paths.isValidFolder(e.name)) continue;
        const d = path.join(paths.meetingsDir(root), e.name);
        const md = lib.readJsonSafe(path.join(d, 'metadata.json')) || {};
        const um = lib.readJsonSafe(path.join(d, 'meeting-user-meta.json')) || {};
        const inf = lib.readJsonSafe(path.join(d, 'meeting-info.json')) || {};
        archive.push({ sourceFile: md.source_file || e.name, folderId: um.virtual_folder_id || null, title: um.custom_title || inf.title || '' });
      }
      assignment = await folderAssign.assignFolder({
        meeting: { title: String(doc.title || ''), brief: String(doc.brief || ''), sourceFile: String(doc.source_file || '') },
        archive, folders: readFolders(root),
      });
      ctx.log('folder for ' + b.name + ': ' + (assignment.folderId || '-') + ' (' + assignment.note + ')');
    }

    let reportHtml = null;
    try {
      const html = path.join(transcriptsDir(), b.name.replace(/\.json$/, '.html'));
      if (fs.statSync(html).size <= MAX_HTML_BYTES) reportHtml = fs.readFileSync(html, 'utf8');
    } catch { reportHtml = null; }

    return writeThenPush(res, () => {
      const base = paths.meetingsDir(root);
      const now = new Date();
      let folder = folderOfTranscript(b.name);
      const republished = !!folder;
      if (!folder) {
        const taken = new Set(fs.readdirSync(base));
        folder = pub.folderNameFor(doc, taken, now);
      }
      const dir = paths.meetingDir(root, folder);
      if (!dir) return { error: 'bad-folder', message: 'Invalid folder name.' };
      fs.mkdirSync(dir, { recursive: true });
      let userMeta = lib.readJsonSafe(path.join(dir, 'meeting-user-meta.json'));
      if (!userMeta && assignment && assignment.auto) {
        userMeta = {
          area_id: null, categories: [], meeting_date: pub.meetingDate(doc, now),
          virtual_folder_id: assignment.folderId, auto_folder: assignment.auto,
        };
      }
      const files = pub.buildMeetingFiles(doc, { name: b.name, folder, now, reportHtml, userMeta });
      for (const [fname, text] of Object.entries(files)) writeAtomic(path.join(dir, fname), text);
      if (!files['report.html']) { try { fs.rmSync(path.join(dir, 'report.html'), { force: true }); } catch { /* none */ } }
      return { folder, republished, folderId: userMeta ? userMeta.virtual_folder_id || null : null, autoFolder: assignment ? assignment.note : null };
    });
  }

  function knownIds() {
    return {
      categoryIds: new Set(readCategories(root).map((c) => c.id)),
      folderIds: new Set(readFolders(root).map((f) => f.id)),
    };
  }

  async function metaHandler(req, res) {
    const b = await body(req, res); if (!b) return;
    if (!paths.isValidFolder(b.folder)) return fail(res, 400, 'bad-folder', 'Invalid folder.');
    if (storageRefusal(res)) return;
    const dir = paths.meetingDir(root, b.folder);
    if (!dir || !fs.existsSync(dir)) return fail(res, 404, 'not-found', 'No such meeting.');
    return writeThenPush(res, () => {
      const file = path.join(dir, 'meeting-user-meta.json');
      const edit = pub.applyUserMetaEdit(lib.readJsonSafe(file), b, knownIds());
      if (!edit.ok) return { error: edit.error, message: 'Invalid data: ' + edit.error + '.' };
      writeAtomic(file, JSON.stringify(edit.meta, null, 2) + '\n');
      return { folder: b.folder };
    });
  }

  async function deleteHandler(req, res) {
    const b = await body(req, res); if (!b) return;
    if (!paths.isValidFolder(b.folder)) return fail(res, 400, 'bad-folder', 'Invalid folder.');
    if (storageRefusal(res)) return;
    const dir = paths.meetingDir(root, b.folder);
    if (!dir || !fs.existsSync(dir)) return fail(res, 404, 'not-found', 'No such meeting.');
    return writeThenPush(res, () => {
      fs.rmSync(dir, { recursive: true, force: true });
      return { folder: b.folder, deleted: true };
    });
  }

  function sharedFile(name) {
    return path.join(paths.meetingsDir(root), name);
  }

  async function categoriesHandler(req, res) {
    const b = await body(req, res); if (!b) return;
    if (storageRefusal(res)) return;
    return writeThenPush(res, () => {
      const file = sharedFile('_categories.json');
      const shared = readSharedForWrite(file);
      if (!shared.ok) return unreadableShared();
      const j = shared.json;
      const list = Array.isArray(j.categories) ? j.categories : [];
      if (b.action === 'add') {
        const name = pub.cleanName(b.name);
        if (!name) return { error: 'bad-name', message: 'Enter a category name (up to 80 characters).' };
        if (list.some((c) => String(c.name).toLowerCase() === name.toLowerCase())) return { error: 'duplicate', message: 'That category already exists.' };
        const id = pub.newId('cat', Date.now());
        list.push({ id, name });
        writeAtomic(file, JSON.stringify({ ...j, categories: list }, null, 2) + '\n');
        return { id };
      }
      const target = list.find((c) => c.id === b.id);
      if (!target) return { status: 404, error: 'not-found', message: 'No such category.' };
      if (b.action === 'rename') {
        const name = pub.cleanName(b.name);
        if (!name) return { error: 'bad-name', message: 'Enter a category name (up to 80 characters).' };
        target.name = name;
        writeAtomic(file, JSON.stringify({ ...j, categories: list }, null, 2) + '\n');
        return { id: target.id };
      }
      if (b.action === 'delete') {
        // Meetings keep a dangling id; the list ignores unknown ids.
        writeAtomic(file, JSON.stringify({ ...j, categories: list.filter((c) => c.id !== b.id) }, null, 2) + '\n');
        return { id: b.id, deleted: true };
      }
      return { error: 'bad-action', message: 'Unknown operation.' };
    });
  }

  async function foldersHandler(req, res) {
    const b = await body(req, res); if (!b) return;
    if (storageRefusal(res)) return;
    return writeThenPush(res, () => {
      const file = sharedFile('_folder-tree.json');
      const shared = readSharedForWrite(file);
      if (!shared.ok) return unreadableShared();
      const j = shared.json;
      const list = Array.isArray(j.folders) ? j.folders : [];
      const save = () => writeAtomic(file, JSON.stringify({ ...j, folders: list }, null, 2) + '\n');
      const parentOk = (pid) => pid === null || list.some((f) => f.id === pid);
      if (b.action === 'add') {
        const name = pub.cleanName(b.name);
        const parentId = b.parentId === undefined ? null : b.parentId;
        if (!name) return { error: 'bad-name', message: 'Enter a folder name (up to 80 characters).' };
        if (!parentOk(parentId)) return { error: 'unknown-folder', message: 'No such parent folder.' };
        const id = pub.newId('fld', Date.now());
        const order = list.filter((f) => (f.parent_id || null) === parentId).length;
        list.push({ id, name, parent_id: parentId, order });
        save();
        return { id };
      }
      const target = list.find((f) => f.id === b.id);
      if (!target) return { status: 404, error: 'not-found', message: 'No such folder.' };
      if (b.action === 'rename') {
        const name = pub.cleanName(b.name);
        if (!name) return { error: 'bad-name', message: 'Enter a folder name (up to 80 characters).' };
        target.name = name;
        save();
        return { id: target.id };
      }
      if (b.action === 'move') {
        const parentId = b.parentId === undefined ? null : b.parentId;
        if (!parentOk(parentId) || (parentId && pub.subtreeIds(list, target.id).has(parentId))) {
          return { error: 'bad-parent', message: 'A folder cannot be moved into itself.' };
        }
        target.parent_id = parentId;
        save();
        return { id: target.id };
      }
      if (b.action === 'delete') {
        // Meetings of the removed subtree go up to the deleted folder's parent.
        const gone = pub.subtreeIds(list, target.id);
        const up = target.parent_id || null;
        for (const e of fs.readdirSync(paths.meetingsDir(root), { withFileTypes: true })) {
          if (!e.isDirectory() || !paths.isValidFolder(e.name)) continue;
          const f = path.join(paths.meetingsDir(root), e.name, 'meeting-user-meta.json');
          const um = lib.readJsonSafe(f);
          if (um && um.virtual_folder_id && gone.has(um.virtual_folder_id)) {
            writeAtomic(f, JSON.stringify({ ...um, virtual_folder_id: up }, null, 2) + '\n');
          }
        }
        const kept = list.filter((f) => !gone.has(f.id));
        list.length = 0;
        list.push(...kept);
        save();
        return { id: b.id, deleted: true };
      }
      return { error: 'bad-action', message: 'Unknown operation.' };
    });
  }

  async function pushHandler(req, res) {
    const b = await body(req, res); if (!b) return;
    if (storageRefusal(res)) return;
    const push = await teamPush.pushModuleNow();
    return ctx.jsonResponse(res, 200, { ok: push.ok, push });
  }

  /**
   * For meeting-transcripts: transcript name -> folder (the "Sent" badge)
   * and the recording file names already in the archive (so its recording
   * scan never downloads a meeting that is already archived).
   */
  function sourcesHandler(_req, res) {
    const map = {};
    const sourceFiles = new Set();
    let entries = [];
    if (paths.storageState(root) === 'ok') {
      try { entries = fs.readdirSync(paths.meetingsDir(root), { withFileTypes: true }); } catch { entries = []; }
    }
    for (const e of entries) {
      if (!e.isDirectory() || !paths.isValidFolder(e.name)) continue;
      const md = lib.readJsonSafe(path.join(paths.meetingsDir(root), e.name, 'metadata.json'));
      if (!md) continue;
      if (typeof md.source_transcript === 'string') map[md.source_transcript] = { folder: e.name, publishedAt: md.published_at || null };
      if (typeof md.source_file === 'string' && md.source_file) sourceFiles.add(md.source_file);
    }
    return ctx.jsonResponse(res, 200, { storage: paths.storageState(root), sources: map, sourceFiles: [...sourceFiles] });
  }

  return {
    routes: [
      { method: 'POST', path: '/publish', handler: publishHandler },
      { method: 'POST', path: '/meta', handler: metaHandler },
      { method: 'POST', path: '/delete', handler: deleteHandler },
      { method: 'POST', path: '/categories', handler: categoriesHandler },
      { method: 'POST', path: '/folders', handler: foldersHandler },
      { method: 'POST', path: '/push', handler: pushHandler },
      { method: 'GET', path: '/sources', handler: sourcesHandler },
      { method: 'GET', path: '/list', handler: listHandler },
      { method: 'GET', path: '/widget', handler: widgetHandler },
      { method: 'GET', path: '/meeting', handler: meetingHandler },
      { method: 'GET', path: '/html', handler: htmlHandler },
    ],
  };
};
