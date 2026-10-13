'use strict';
// demo-hub - server entry. Displayed as "Sync Test Hub"; the id stays
// `demo-hub` on purpose, because the id IS the API path (/api/m/demo-hub/),
// the view ids, the CSS class prefix and - most of all - the ds-data/demo-hub/
// directory whose history the History view renders. Renaming it would orphan
// that history.
//
// What the module is for: proving the sync loop end to end. The cockpit core
// exposes no data-repo helper on `ctx`, so the module reaches the PLAINTEXT
// working tree directly: <rootDir>/data-sub-repositories/ds-data/. That
// directory is never a git repository - the sync flow encrypts it into
// ds-data-encrypted/ before it is pushed - so writing a plain file here is
// exactly what the sync UI picks up as a local change.
//
// Authorship. Every commit in the mirror is authored `Mission Deck <cockpit@local>`
// and the whole tree travels under one `sync <date>` subject, so git itself
// cannot say who saved a file. The note therefore carries a server-owned YAML
// header (author / person_slug / source / date), the same shape the mural in
// the training path uses. The name in it comes from GET /api/whoami, which
// derives the person from the NAME of the GitLab project token this cockpit
// runs on - not from whoever the token belongs to in GitLab. A module has no
// access to that token (it lives in the server's heap, never on ctx), so the
// identity is fetched over loopback from this same process.
//
// The History view reads that header back out of git: for each commit that
// touched the note, `git show <sha>:<hmac>.enc` piped through
// scripts/crypto-sync.js decryptBuffer yields the file as it was synced,
// header included. That is the only place per-version authorship exists.
//
// Routes (mounted under /api/m/demo-hub/):
//   GET  /ds-data  -> { available, dir, file, text, lastSave, lastSync, files[] }
//   POST /ds-data  -> { text } saved to ds-data/demo-hub/note.md
//   GET  /history  -> { available, rows[], pending, error, files[] }

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const REPO_DIRNAME = 'ds-data';
const MIRROR_DIRNAME = REPO_DIRNAME + '-encrypted';
const KEY_ID = 'ds-data';
const MODULE_SUBDIR = 'demo-hub';
const NOTE_FILENAME = 'note.md';
// Repo-relative and posix-separated: this exact string is what the mirror name
// is an HMAC of, so it must never be built with path.join on Windows.
const NOTE_REL_PATH = MODULE_SUBDIR + '/' + NOTE_FILENAME;

const MAX_TEXT_CHARS = 20000;
const HISTORY_LIMIT = 50;
const WHOAMI_TTL_MS = 60000;
const GIT_TIMEOUT_MS = 15000;
// One unit separator between git's own fields, so a commit subject containing
// a pipe or a tab still splits correctly.
const FIELD_SEP = '\x1f';
const LOG_FORMAT = '%H%x1f%aI%x1f%s';

module.exports = function register(ctx) {
  const repoDir = path.join(ctx.rootDir, 'data-sub-repositories', REPO_DIRNAME);
  const mirrorDir = path.join(ctx.rootDir, 'data-sub-repositories', MIRROR_DIRNAME);
  const moduleDir = path.join(repoDir, MODULE_SUBDIR);
  const noteFile = path.join(moduleDir, NOTE_FILENAME);
  const withLock = ctx.makeLock();

  // Relative paths are what the UI shows; an absolute path on this disk is
  // noise to the person reading the card.
  const relFile = path.posix.join('data-sub-repositories', REPO_DIRNAME, NOTE_REL_PATH);
  const relDir = path.posix.join('data-sub-repositories', REPO_DIRNAME, MODULE_SUBDIR);

  // -- Identity ---------------------------------------------------------------

  let whoamiCache = null;

  // Loopback rather than ctx: the token whose NAME resolves to a person lives
  // in the server's heap and is deliberately unreachable from a module. The
  // port is resolved exactly the way server.js resolves it.
  async function resolveIdentity() {
    if (whoamiCache && Date.now() - whoamiCache.at < WHOAMI_TTL_MS) return whoamiCache.value;
    const port = parseInt(process.env.PORT, 10) || parseInt(process.argv[2], 10) || 3001;
    let value = { display_name: '', person_slug: '', source: 'none' };
    try {
      const res = await fetch('http://127.0.0.1:' + port + '/api/whoami', { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const body = await res.json();
        if (body && body.valid) {
          value = {
            display_name: String(body.display_name || ''),
            person_slug: String(body.person_slug || ''),
            source: String(body.source || 'none'),
          };
        }
      }
    } catch { /* identity is a nice-to-have; a save must never fail on it */ }
    // Only a real answer is worth caching - a miss here usually means a cockpit
    // with no token YET, and the next save should look again.
    if (value.source !== 'none') whoamiCache = { at: Date.now(), value };
    return value;
  }

  // -- Server-owned YAML header ----------------------------------------------

  /**
   * Split "---\nkey: value\n---\n\nbody" into { meta, body }. Never throws: a
   * file somebody edited by hand without a header is still a valid note, it
   * just carries no authorship - which is exactly the case for every version
   * saved before this header existed.
   * @param {string} text
   * @returns {{meta: Record<string,string>, body: string}}
   */
  function parseNote(text) {
    const raw = String(text || '').replace(/^\uFEFF/, '');
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
    if (!m) return { meta: {}, body: raw.replace(/\s+$/, '') };
    const meta = {};
    for (const line of m[1].split(/\r?\n/)) {
      const kv = /^([a-z_]+):\s*(.*)$/.exec(line.trim());
      if (kv) meta[kv[1]] = kv[2].trim();
    }
    return { meta, body: raw.slice(m[0].length).replace(/^\r?\n/, '').replace(/\s+$/, '') };
  }

  /** Serialize one note back to disk form. The header is server-owned. */
  function serializeNote(who, isoDate, body) {
    return [
      '---',
      'author: ' + (who.display_name || who.person_slug || 'unknown'),
      'person_slug: ' + (who.person_slug || ''),
      'source: ' + (who.source || 'none'),
      'date: ' + isoDate,
      '---',
      '',
      String(body).replace(/\s+$/, ''),
      '',
    ].join('\n');
  }

  /** The authorship a header carries, in the shape both views render. */
  function authorFromMeta(meta) {
    return {
      name: (meta && meta.author) || null,
      person_slug: (meta && meta.person_slug) || null,
      source: (meta && meta.source) || null,
      date: (meta && meta.date) || null,
    };
  }

  // -- The encrypted mirror ---------------------------------------------------

  /**
   * Everything the git-history reads need, or the reason they cannot run. The
   * `require` is lazy and guarded because the contract test registers this
   * module with a rootDir that does not exist.
   * @returns {{ok: boolean, error?: string, cs?: object, key?: Buffer, encName?: string}}
   */
  function mirrorContext() {
    if (!fs.existsSync(path.join(mirrorDir, '.git'))) {
      return { ok: false, error: 'The encrypted mirror of the repository is not cloned, so there is no history to read.' };
    }
    let cs;
    try {
      cs = require(path.join(ctx.rootDir, 'scripts', 'crypto-sync.js'));
    } catch (e) {
      ctx.log('crypto-sync unavailable:', e.message);
      return { ok: false, error: 'Could not load the encryption module of Mission Deck.' };
    }
    let key;
    try {
      key = cs.loadMasterKey(process.env, ctx.rootDir, KEY_ID);
    } catch {
      return { ok: false, error: 'There is no encryption key for ds-data, so the history cannot be decrypted. Add the key in Settings > Keys.' };
    }
    // The bare HMAC, never with `.enc` appended: the per-file salt is
    // sha256(encName), so the other form fails every GCM auth tag.
    return { ok: true, cs, key, encName: cs.encryptRelPath(NOTE_REL_PATH, key) };
  }

  async function git(args) {
    const { stdout } = await execFileAsync('git', ['-C', mirrorDir, ...args], {
      timeout: GIT_TIMEOUT_MS,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    });
    return stdout;
  }

  /** One committed version of the note, decrypted. */
  async function noteAtCommit(mc, sha) {
    const armored = await git(['show', sha + ':' + mc.encName + '.enc']);
    const { body } = mc.cs.decryptBuffer(armored, mc.encName, mc.key);
    return body.toString('utf8');
  }

  /**
   * The note's commits in the mirror, newest first, each enriched with the
   * author its own header carried at that point.
   * @param {number} limit
   * @returns {Promise<{ok: boolean, error: string|null, rows: object[], mc: object|null, newestSha: string|null}>}
   */
  async function historyRows(limit) {
    const mc = mirrorContext();
    if (!mc.ok) return { ok: false, error: mc.error, rows: [], mc: null, newestSha: null };

    let log;
    try {
      log = await git(['log', '--max-count=' + limit, '--pretty=' + LOG_FORMAT, '--', mc.encName + '.enc']);
    } catch (e) {
      ctx.log('git log failed:', e.message);
      return { ok: false, error: 'Could not read the history from the repository mirror.', rows: [], mc, newestSha: null };
    }

    const rows = [];
    let newestSha = null;
    for (const line of log.split('\n')) {
      if (!line.trim()) continue;
      const [sha, date, subject] = line.split(FIELD_SEP);
      if (!newestSha) newestSha = sha;
      const row = { commit: sha.slice(0, 8), date: date || null, subject: subject || '', author: null, chars: null };
      try {
        const version = await noteAtCommit(mc, sha);
        const { meta, body } = parseNote(version);
        row.author = authorFromMeta(meta);
        row.chars = body.length;
      } catch (e) {
        // A version saved before the header existed, or a blob written under a
        // different key. Neither is worth failing the whole table for.
        ctx.log('history row unreadable', row.commit + ':', e.message);
      }
      rows.push(row);
    }
    return { ok: true, error: null, rows, mc, newestSha };
  }

  /**
   * Is the note on disk ahead of what the mirror has already committed? This
   * is the whole point of the module: a save lands in the plaintext tree at
   * once, and only a sync carries it to the team.
   * @returns {Promise<{state: string, chars: number, author: object|null}|null>}
   */
  async function pendingState(mc, newestSha) {
    if (!fs.existsSync(noteFile)) return null;
    let local;
    try { local = fs.readFileSync(noteFile, 'utf8'); } catch { return null; }
    const parsed = parseNote(local);
    const info = { chars: parsed.body.length, author: authorFromMeta(parsed.meta) };
    if (!mc || !mc.ok) return { state: 'unknown', ...info };
    if (!newestSha) return { state: 'new', ...info };
    try {
      if ((await noteAtCommit(mc, newestSha)) === local) return null;
    } catch {
      return { state: 'unknown', ...info };
    }
    return { state: 'changed', ...info };
  }

  // -- Snapshots --------------------------------------------------------------

  function listFiles() {
    let entries;
    try {
      entries = fs.readdirSync(moduleDir, { withFileTypes: true });
    } catch {
      return [];
    }
    return entries
      .filter(e => e.isFile())
      .map((e) => {
        let size = 0;
        let mtime = null;
        try {
          const st = fs.statSync(path.join(moduleDir, e.name));
          size = st.size;
          mtime = st.mtime.toISOString();
        } catch { /* a file removed between readdir and stat is not an error */ }
        return { name: e.name, size, mtime };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * The newest SYNCED version: who signed it, when it travelled, and whether
   * the copy on this disk has since moved ahead of it.
   */
  async function lastSync() {
    const mc = mirrorContext();
    const blank = { available: false, error: mc.error || null, author: null, date: null, commit: null, subject: '', pending: null };
    if (!mc.ok) return { ...blank, pending: await pendingState(null, null) };

    let log;
    try {
      log = (await git(['log', '--max-count=1', '--pretty=' + LOG_FORMAT, '--', mc.encName + '.enc'])).trim();
    } catch (e) {
      ctx.log('git log failed:', e.message);
      return { ...blank, error: 'Could not read the history from the repository mirror.', pending: await pendingState(null, null) };
    }
    if (!log) {
      return { available: true, error: null, author: null, date: null, commit: null, subject: '', pending: await pendingState(mc, null) };
    }

    const [sha, date, subject] = log.split(FIELD_SEP);
    let author = null;
    try {
      author = authorFromMeta(parseNote(await noteAtCommit(mc, sha)).meta);
    } catch { /* pre-header version - authorless, never an error */ }
    return {
      available: true,
      error: null,
      author,
      date: date || null,
      commit: sha.slice(0, 8),
      subject: subject || '',
      pending: await pendingState(mc, sha),
    };
  }

  async function snapshot() {
    const available = fs.existsSync(repoDir);
    let text = '';
    let lastSave = null;
    let updatedAt = null;
    if (available) {
      try {
        const parsed = parseNote(fs.readFileSync(noteFile, 'utf8'));
        text = parsed.body;
        lastSave = authorFromMeta(parsed.meta);
        updatedAt = fs.statSync(noteFile).mtime.toISOString();
      } catch { /* no note yet - an empty field is the correct answer */ }
    }
    return {
      available,
      dir: relDir,
      file: relFile,
      text,
      updatedAt,
      lastSave,
      lastSync: available ? await lastSync() : null,
      files: available ? listFiles() : [],
    };
  }

  return {
    routes: [
      {
        method: 'GET',
        path: '/ds-data',
        handler: async (_req, res) => {
          ctx.jsonResponse(res, 200, await snapshot());
        },
      },
      {
        method: 'POST',
        path: '/ds-data',
        handler: async (req, res) => {
          const body = await ctx.readBody(req, 64 * 1024);
          const text = body && typeof body.text === 'string' ? body.text : null;
          if (text === null) {
            ctx.jsonResponse(res, 400, { error: 'bad-request', message: 'The "text" field is required.' });
            return;
          }
          if (text.length > MAX_TEXT_CHARS) {
            ctx.jsonResponse(res, 400, {
              error: 'too-long',
              message: 'The note is too long - the limit is ' + MAX_TEXT_CHARS + ' characters.',
            });
            return;
          }
          if (!fs.existsSync(repoDir)) {
            ctx.jsonResponse(res, 409, {
              error: 'repo-missing',
              message: 'The ds-data repository is not cloned - there is nowhere to save the file.',
            });
            return;
          }

          const who = await resolveIdentity();
          const stamped = serializeNote(who, new Date().toISOString(), text);
          try {
            await withLock(async () => {
              fs.mkdirSync(moduleDir, { recursive: true });
              const tmp = noteFile + '.tmp';
              fs.writeFileSync(tmp, stamped, 'utf8');
              fs.renameSync(tmp, noteFile);
            });
          } catch (e) {
            ctx.log('ds-data write failed:', e.message);
            ctx.jsonResponse(res, 500, { error: 'write-failed', message: 'Save failed: ' + e.message });
            return;
          }

          ctx.log('saved', relFile, text.length, 'chars, author:', who.person_slug || 'unknown');
          ctx.jsonResponse(res, 200, await snapshot());
        },
      },
      {
        method: 'GET',
        path: '/history',
        handler: async (_req, res) => {
          if (!fs.existsSync(repoDir)) {
            ctx.jsonResponse(res, 200, { available: false, file: relFile, dir: relDir, rows: [], pending: null, error: null, files: [] });
            return;
          }
          const { ok, error, rows, mc, newestSha } = await historyRows(HISTORY_LIMIT);
          ctx.jsonResponse(res, 200, {
            available: true,
            file: relFile,
            dir: relDir,
            rows,
            pending: await pendingState(ok ? mc : null, newestSha),
            error,
            files: listFiles(),
          });
        },
      },
    ],
  };
};
