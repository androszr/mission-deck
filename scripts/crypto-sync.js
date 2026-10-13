'use strict';
// scripts/crypto-sync.js - AES-256-GCM encrypt-at-rest for the ds-data repo.
//
// The cockpit works on a PLAINTEXT directory (data-sub-repositories/ds-data/),
// which is what the app serves and what every view reads. What git tracks is a
// separate ENCRYPTED mirror (data-sub-repositories/ds-data-encrypted/), and the
// mirror is the only thing that ever reaches GitLab. Sync is therefore:
//
//   push:  encryptTree(plain -> mirror)  then git add/commit/push in the mirror
//   pull:  git pull in the mirror        then decryptTree(mirror -> plain)
//
// File layout in the mirror: one `<hmac>.enc` per plaintext file, base64-armored
// on a single line so git stores it as text.
//
// Decoded layout: 16-byte salt || 12-byte IV || ciphertext || 16-byte GCM tag,
// where the plaintext fed to the cipher is `<relative path>\0<file bytes>`.
//
// PATH NAMES ARE ENCRYPTED TOO, and for this repo that is the point rather than
// a nicety: the team directory stores one photo per person named after them, so
// a mirror of `team/avatars/taylorkim.png.enc` would publish the roster in
// clear even though every byte inside is encrypted. The file name in the mirror
// is an HMAC of the path, and the real path travels INSIDE the ciphertext.
//
// Salt and IV are DETERMINISTIC, not random per run:
//   salt = sha256(<name in the mirror>).slice(0, 16)
//   iv   = sha256(<path + plaintext>).slice(0, 12)
// so an unchanged file re-encrypts to byte-identical output and a no-op sync
// produces no git diff. This does not reintroduce the GCM nonce-reuse problem:
// the IV comes from the plaintext through SHA-256, so two DIFFERENT plaintexts
// practically never share one under the same per-file subkey. The accepted
// trade-off is the converse - identical plaintext gives identical ciphertext,
// which is exactly what "no diff when nothing changed" requires.
//
// Exit codes when run as a CLI: 0 clean, 1 blocking findings, 2 usage error.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Repo-specific context string. It differentiates this repo from any other that
// might one day share the same key file, and it is part of the key derivation:
// changing it makes every existing mirror undecryptable, so it is frozen.
const DEFAULT_HKDF_INFO = Buffer.from('cockpit-ds-data-v1');

const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;
const V2_PREFIX = 'v2:';
const ENC_NAME_LEN = 32;

// The repo ids `.encryption-key` may carry a line for: the team data repo
// ('ds-data', the key id of data-tier-0) plus one bare id per source declared
// in DATA_REPO_DEFS in server.js. An id missing from this set is silently
// dropped by _parseKeyFile, so a repo whose keyFn asks for it fails with
// `key-missing` even though the key sits in the file. Keep this set and
// DATA_REPO_DEFS in step; tests/test_crypto_sync.mjs pins the pairing.
const KNOWN_REPO_IDS = new Set([
  'ds-data',
]);

// Sources whose key is BORN in this app (DATA_REPO_DEFS keyOrigin). They must
// carry their OWN `<id>=` line: the bare fallback is never used, because a
// fresh mirror encrypted under an unrelated bare key would be undecryptable
// for every teammate holding the real one, and the encrypt-destructive guard
// cannot catch it (an empty mirror has nothing to protect). The
// DATA_ENCRYPTION_KEY env override still applies. Empty by default: add the
// id of a declared source here when its key is generated in this app.
const OWN_LINE_ONLY_IDS = new Set([]);

// Never mirrored, in EITHER direction. Dependency trees and build output are
// regenerable, .DS_Store is OS noise, and a stray .env is a credential file with
// no business travelling to a shared remote even as ciphertext.
//
// Symmetrical on purpose: encryptTree never encrypts these AND decryptTree's
// deletion walk ignores them. Without the second half every receiving clone
// would delete its own node_modules on the next sync, because those paths have
// no counterpart in the mirror. Matched on the basename, so it applies at any
// depth.
const EXCLUDED_NAMES = new Set(['node_modules', 'dist', '.DS_Store', '.env']);

// Per-tier transport exclusions: `.syncignore` at the plaintext tier root.
// The tier .gitignore is deliberately NOT used - several tiers gitignore files
// that exist ONLY to be shared through the encrypted mirror, so "ignored by
// git" and "not shared" are different decisions. `.syncignore` lists regenerable
// local state (pipeline caches, .bak copies, lock files) that must never reach
// the shared remote. The file itself IS encrypted and shared, so every clone
// gets the same policy.
//
// Syntax (gitignore subset): one pattern per line, `#` comments, blank lines
// ignored. `*` matches within a path segment, `**/` matches any directory
// depth, a trailing `/` matches a directory and everything below it, and a
// pattern without an inner `/` matches the basename at any depth.
// Applied SYMMETRICALLY like EXCLUDED_NAMES: the encrypt side never encrypts
// these (a full pass sweeps their stale `.enc` out of the mirror), and
// decryptTree neither writes them nor deletes the receiver's local copies.
const SYNCIGNORE_FILE = '.syncignore';

function _syncIgnoreToRegex(pattern) {
  let p = pattern;
  const dirOnly = p.endsWith('/');
  if (dirOnly) p = p.slice(0, -1);
  if (p.startsWith('/')) p = p.slice(1);
  const anchored = p.includes('/');
  let re = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*' && p[i + 2] === '/') { re += '(?:.*/)?'; i += 2; continue; }
    if (c === '*' && p[i + 1] === '*') { re += '.*'; i += 1; continue; }
    if (c === '*') { re += '[^/]*'; continue; }
    if (c === '?') { re += '[^/]'; continue; }
    re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  // A matched segment also covers everything below it (a pattern naming a
  // directory excludes its whole subtree, like gitignore).
  return new RegExp(`${anchored ? '^' : '(?:^|/)'}${re}${dirOnly ? '/' : '(?:$|/)'}`);
}

function _parseSyncIgnore(text) {
  const rules = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    rules.push(_syncIgnoreToRegex(line));
  }
  return rules;
}

function _readSyncIgnore(dir) {
  try { return _parseSyncIgnore(fs.readFileSync(path.join(dir, SYNCIGNORE_FILE), 'utf8')); } catch { return []; }
}

function _isSyncIgnored(relPath, rules) {
  for (const re of rules) if (re.test(relPath)) return true;
  return false;
}

const PLACEHOLDER_RE = /^your_.*_here$/;

class EncryptionError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'EncryptionError';
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Key file
// ---------------------------------------------------------------------------

/**
 * Parse `.encryption-key`: `<repo-id>=<base64>` lines plus an optional bare key.
 * Lines naming a repo this app does not know are ignored, not an error - the
 * file may be shared with other tools.
 * @param {string} content
 * @returns {{repoKeys: object, bareKey: string|null}}
 */
function _parseKeyFile(content) {
  const repoKeys = {};
  let bareKey = null;
  for (const rawLine of String(content || '').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0) {
      const prefix = line.substring(0, eqIdx);
      if (KNOWN_REPO_IDS.has(prefix)) {
        repoKeys[prefix] = line.substring(eqIdx + 1).trim();
      }
      // A `<something-else>=<key>` line belongs to another cockpit. Skipping it
      // here is what stops it from being mistaken for this repo's bare key.
      continue;
    }
    if (!bareKey) bareKey = line;
  }
  return { repoKeys, bareKey };
}

function _decodeAndValidate(raw) {
  let decoded;
  try {
    decoded = Buffer.from(raw, 'base64');
  } catch {
    throw new EncryptionError('key-invalid', 'The key is not valid base64.');
  }
  if (decoded.length !== KEY_LEN) {
    throw new EncryptionError('key-invalid', 'The key must decode to ' + KEY_LEN + ' bytes (got ' + decoded.length + ').');
  }
  return decoded;
}

/**
 * The master key for one repo: the env var wins, then the `<repoId>=` line, then
 * a bare line.
 * @param {object} env
 * @param {string} rootDir repo root holding `.encryption-key`
 * @param {string} repoId
 * @returns {Buffer}
 */
function loadMasterKey(env, rootDir, repoId) {
  let raw = ((env && env.DATA_ENCRYPTION_KEY) || '').trim();
  if ((!raw || PLACEHOLDER_RE.test(raw)) && rootDir) {
    const { repoKeys, bareKey } = readKeyMap(rootDir);
    if (repoId && repoId in repoKeys) raw = repoKeys[repoId];
    else if (bareKey && !OWN_LINE_ONLY_IDS.has(repoId)) raw = bareKey;
  }
  if (!raw || PLACEHOLDER_RE.test(raw)) {
    throw new EncryptionError('key-missing', 'No encryption key - add the line `' + (repoId || 'ds-data') + '=<key>` to the .encryption-key file.');
  }
  return _decodeAndValidate(raw);
}

/** @param {string} keyStr @returns {Buffer} throws EncryptionError when invalid. */
function validateKey(keyStr) {
  const trimmed = (keyStr || '').trim();
  if (!trimmed) throw new EncryptionError('key-missing', 'The key is empty.');
  return _decodeAndValidate(trimmed);
}

/** @param {string} rootDir @returns {{repoKeys: object, bareKey: string|null}} */
function readKeyMap(rootDir) {
  const keyFile = path.join(rootDir, '.encryption-key');
  let content;
  try { content = fs.readFileSync(keyFile, 'utf8'); } catch { return { repoKeys: {}, bareKey: null }; }
  return _parseKeyFile(content);
}

/**
 * Add or replace one `<repoId>=<key>` line, keeping every other line - including
 * the lines belonging to another cockpit - exactly as they were. Written via
 * tmp+rename with mode 0600.
 * @param {string} rootDir @param {string} repoId @param {string} keyStr
 */
function saveRepoKey(rootDir, repoId, keyStr) {
  if (!KNOWN_REPO_IDS.has(repoId)) throw new EncryptionError('key-invalid', 'Nieznane repo: ' + repoId);
  validateKey(keyStr);
  const keyFile = path.join(rootDir, '.encryption-key');
  let content = '';
  try { content = fs.readFileSync(keyFile, 'utf8'); } catch { /* new file */ }

  const wanted = repoId + '=' + String(keyStr).trim();
  const lines = content.split('\n').filter((l, i, arr) => l.trim() || i < arr.length - 1);
  let replaced = false;
  const out = lines.map(line => {
    if (line.trim().startsWith(repoId + '=')) { replaced = true; return wanted; }
    return line;
  }).filter(l => l.trim().length > 0);
  if (!replaced) out.push(wanted);

  const tmp = keyFile + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, out.join('\n') + '\n', { mode: 0o600 });
  fs.renameSync(tmp, keyFile);
}

/** A fresh 32-byte master key, base64. */
function generateKey() {
  return crypto.randomBytes(KEY_LEN).toString('base64');
}

/**
 * Create the key of a source born in this cockpit and write it straight to
 * `.encryption-key`. Returns undefined: the key never leaves this function.
 * Refuses every id outside OWN_LINE_ONLY_IDS (a regenerated shared key would
 * lock the team out of existing ciphertext) and every id that already has a
 * line (never overwrites).
 * @param {string} rootDir @param {string} repoId
 */
function generateRepoKey(rootDir, repoId) {
  if (!OWN_LINE_ONLY_IDS.has(repoId)) {
    throw new EncryptionError('key-not-generatable', 'A key cannot be generated for this source: ' + repoId);
  }
  const existing = readKeyMap(rootDir).repoKeys[repoId];
  if (existing && String(existing).trim()) {
    throw new EncryptionError('key-exists', 'A key for this source already exists.');
  }
  saveRepoKey(rootDir, repoId, generateKey());
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

// Per-file subkey: the master key never touches the cipher directly.
function _subKey(masterKey, salt, hkdfInfo) {
  return Buffer.from(crypto.hkdfSync('sha256', masterKey, salt, hkdfInfo, KEY_LEN));
}

function _deriveIv(plaintext) {
  return crypto.createHash('sha256').update(plaintext).digest().subarray(0, IV_LEN);
}

function _derivePathKey(masterKey, hkdfInfo) {
  const pathInfo = Buffer.concat([hkdfInfo, Buffer.from('-path')]);
  return Buffer.from(crypto.hkdfSync('sha256', masterKey, Buffer.alloc(0), pathInfo, KEY_LEN));
}

/**
 * The name one plaintext path takes in the mirror. An HMAC, so the mirror never
 * spells out a path - and stable, so the same file keeps the same name.
 * @param {string} relPath posix-separated, repo-relative
 * @param {Buffer} masterKey @param {Buffer} [hkdfInfo]
 * @returns {string}
 */
function encryptRelPath(relPath, masterKey, hkdfInfo = DEFAULT_HKDF_INFO) {
  const pathKey = _derivePathKey(masterKey, hkdfInfo);
  return crypto.createHmac('sha256', pathKey).update(relPath).digest('hex').slice(0, ENC_NAME_LEN);
}

// ---------------------------------------------------------------------------
// One file
// ---------------------------------------------------------------------------

/**
 * Encrypt one file. The path travels inside the ciphertext, so decryption
 * recovers where the bytes belong without the mirror ever naming it.
 * @param {Buffer} plaintext @param {string} relPath @param {string} encName
 * @param {Buffer} masterKey @param {Buffer} [hkdfInfo]
 * @returns {string} `v2:` + base64
 */
function encryptBuffer(plaintext, relPath, encName, masterKey, hkdfInfo = DEFAULT_HKDF_INFO) {
  const fullPlain = Buffer.concat([Buffer.from(relPath, 'utf8'), Buffer.from([0x00]), plaintext]);
  const salt = crypto.createHash('sha256').update(encName).digest().subarray(0, SALT_LEN);
  const iv = _deriveIv(fullPlain);
  const cipher = crypto.createCipheriv('aes-256-gcm', _subKey(masterKey, salt, hkdfInfo), iv);
  const encrypted = Buffer.concat([cipher.update(fullPlain), cipher.final()]);
  return V2_PREFIX + Buffer.concat([salt, iv, encrypted, cipher.getAuthTag()]).toString('base64');
}

/**
 * Decrypt one file back to its path and its bytes. Any failure - bad base64, a
 * salt that does not match the file name, a GCM tag mismatch - throws
 * EncryptionError('decrypt-failed') and never returns partial output.
 * @param {string} armored @param {string} encName file name without `.enc`
 * @param {Buffer} masterKey @param {Buffer} [hkdfInfo]
 * @returns {{relPath: string, body: Buffer}}
 */
/**
 * READS the legacy v1 layout: the file
 * keeps its real name with `.enc` appended (`team/x.json.enc`), the body is
 * bare base64 with no version prefix, and the salt is derived from the
 * PLAINTEXT path rather than from the file name. The path is therefore public
 * in a v1 repo - which is exactly why this app writes v2 by default - but a
 * source declared with `mirrorFormat: 'v1'` is stored this way, and refusing
 * to read it would mean refusing the data.
 *
 * The format is a property of the SOURCE, not a global switch: `encryptTree`
 * and `plaintextAheadOfMirror` take `opts.format` (`'v1'` or `'v2'`, default
 * `'v2'`), and `DATA_REPO_DEFS.mirrorFormat` in server.js picks it per row. A source
 * another tool still writes in v1 must stay v1, or a v2 push from here would
 * fight it over the whole tree on the next sync.
 * See `encryptBufferV1` below for the writer.
 *
 * @param {string} armored bare base64, no prefix
 * @param {string} relPath the mirror path minus `.enc` - the real plaintext path
 * @param {Buffer} masterKey @param {Buffer} [hkdfInfo]
 * @returns {Buffer} the plaintext body
 */
function decryptBufferV1(armored, relPath, masterKey, hkdfInfo = DEFAULT_HKDF_INFO) {
  let raw;
  try {
    raw = Buffer.from(String(armored || '').trim(), 'base64');
  } catch {
    throw new EncryptionError('decrypt-failed', 'Invalid base64 in file ' + relPath + '.');
  }
  if (raw.length < SALT_LEN + IV_LEN + TAG_LEN) {
    throw new EncryptionError('decrypt-failed', 'Encrypted block is too short: ' + relPath + '.');
  }
  const salt = raw.subarray(0, SALT_LEN);
  const expectedSalt = crypto.createHash('sha256').update(relPath).digest().subarray(0, SALT_LEN);
  if (!salt.equals(expectedSalt)) {
    throw new EncryptionError('decrypt-failed', 'Salt mismatch for path ' + relPath + ' (file moved or replaced?).');
  }
  const iv = raw.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag = raw.subarray(raw.length - TAG_LEN);
  const ciphertext = raw.subarray(SALT_LEN + IV_LEN, raw.length - TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', _subKey(masterKey, salt, hkdfInfo), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new EncryptionError('decrypt-failed', 'GCM verification failed for ' + relPath + '.');
  }
}

/**
 * WRITES the legacy v1 layout - the exact inverse of `decryptBufferV1`: salt
 * from the PLAINTEXT path (not the file name), IV from the plaintext bytes
 * themselves (`_deriveIv`, no relPath prefix, no null separator), bare base64
 * with no version marker. Deterministic, so an unchanged file re-encrypts to the
 * same bytes and a no-op sync makes no git diff.
 * @param {Buffer} plaintext @param {string} relPath repo-relative, posix
 * @param {Buffer} masterKey @param {Buffer} [hkdfInfo]
 * @returns {string} bare base64, no prefix
 */
function encryptBufferV1(plaintext, relPath, masterKey, hkdfInfo = DEFAULT_HKDF_INFO) {
  const salt = crypto.createHash('sha256').update(relPath).digest().subarray(0, SALT_LEN);
  const iv = _deriveIv(plaintext);
  const cipher = crypto.createCipheriv('aes-256-gcm', _subKey(masterKey, salt, hkdfInfo), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([salt, iv, encrypted, cipher.getAuthTag()]).toString('base64');
}

function decryptBuffer(armored, encName, masterKey, hkdfInfo = DEFAULT_HKDF_INFO) {
  if (!String(armored || '').startsWith(V2_PREFIX)) {
    throw new EncryptionError('decrypt-failed', 'File ' + encName + ' is not in v2 format.');
  }
  let raw;
  try {
    raw = Buffer.from(armored.slice(V2_PREFIX.length), 'base64');
  } catch {
    throw new EncryptionError('decrypt-failed', 'Invalid base64 in file ' + encName + '.');
  }
  if (raw.length < SALT_LEN + IV_LEN + TAG_LEN + 2) {
    throw new EncryptionError('decrypt-failed', 'Encrypted block is too short: ' + encName + '.');
  }
  const salt = raw.subarray(0, SALT_LEN);
  const expectedSalt = crypto.createHash('sha256').update(encName).digest().subarray(0, SALT_LEN);
  if (!salt.equals(expectedSalt)) {
    throw new EncryptionError('decrypt-failed', 'Salt mismatch for name ' + encName + ' (file moved or replaced?).');
  }
  const iv = raw.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag = raw.subarray(raw.length - TAG_LEN);
  const ciphertext = raw.subarray(SALT_LEN + IV_LEN, raw.length - TAG_LEN);
  const decipher = crypto.createDecipheriv('aes-256-gcm', _subKey(masterKey, salt, hkdfInfo), iv);
  decipher.setAuthTag(tag);
  let fullPlain;
  try {
    fullPlain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new EncryptionError('decrypt-failed', 'GCM verification failed for ' + encName + '.');
  }
  const nullIdx = fullPlain.indexOf(0x00);
  if (nullIdx < 0) {
    throw new EncryptionError('decrypt-failed', 'Missing path separator in file ' + encName + '.');
  }
  return {
    relPath: fullPlain.subarray(0, nullIdx).toString('utf8'),
    body: fullPlain.subarray(nullIdx + 1),
  };
}

// ---------------------------------------------------------------------------
// Whole trees
// ---------------------------------------------------------------------------

/**
 * Every file under `dir`, relative and posix-separated. `.git` and the names in
 * `skipNames` are skipped at any depth. Never throws.
 * @param {string} dir @param {Set<string>|null} skipNames
 * @param {string} [base] @param {string[]} [out]
 * @returns {string[]}
 */
function _walkFiles(dir, skipNames, base = dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (entry.name === '.git' || (skipNames && skipNames.has(entry.name))) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) _walkFiles(full, skipNames, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function _removeEmptyDirs(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === '.git' || !e.isDirectory()) continue;
    _removeEmptyDirs(path.join(dir, e.name));
    try { fs.rmdirSync(path.join(dir, e.name)); } catch { /* not empty */ }
  }
}

/**
 * Encrypt the whole plaintext tree into the mirror and drop from the mirror
 * every `.enc` whose source is gone, so deletions travel too. `srcDir` - the
 * source of truth - is never written to.
 *
 * Incremental: a mirror file newer than its source is left alone. Encryption is
 * deterministic, so it is already byte-correct.
 *
 * Guarded against a mass wipe, the mirror image of decryptTree's guard. Two
 * shapes are refused with `encrypt-destructive` BEFORE anything is written:
 * a plaintext tree that shares NO file name with a non-empty mirror (a source
 * cloned before its key existed and never decrypted - the plaintext directory
 * is empty, or holds only what a module downloaded on its own), and a run that
 * would remove more than DESTRUCTIVE_RATIO of a mirror bigger than
 * DESTRUCTIVE_MIN_FILES. Either one, pushed, deletes the team's data on the
 * remote; that is not a deletion anybody made.
 *
 * `opts.prune === false` writes new and changed files but removes nothing -
 * the shape _repoPull falls back to when the guard fires, because an ADDED
 * local file is still work worth carrying across a merge while the removals
 * are exactly what must not happen.
 *
 * `opts.format` picks the writer per source (default `'v2'`): `'v1'` names
 * every mirror file `<relPath>.enc` (no HMAC, no path obfuscation) and writes
 * it with `encryptBufferV1` (the legacy layout). The two destructive
 * guards above run unchanged in both formats - `keepEnc` just holds the v1
 * names instead of the v2 ones, so a v2 name left over from a stale mirror
 * still counts toward `toRemove`.
 * @param {string} srcDir plaintext @param {string} dstDir mirror
 * @param {Buffer} masterKey @param {Buffer} [hkdfInfo]
 * @param {{prune?: boolean, format?: 'v1'|'v2'}} [opts]
 * @returns {{files: string[], written: number, removed: number, skipped: number}}
 */
function encryptTree(srcDir, dstDir, masterKey, hkdfInfo = DEFAULT_HKDF_INFO, opts = {}) {
  const prune = opts.prune !== false;
  const format = opts.format === 'v1' ? 'v1' : 'v2';
  const syncIgnore = _readSyncIgnore(srcDir);
  const relPaths = _walkFiles(srcDir, EXCLUDED_NAMES).filter(p => !_isSyncIgnored(p, syncIgnore));
  // Deliberately unfiltered: a path that a previous run encrypted before it was
  // excluded must still be found here so it leaves the mirror. The mirror is
  // derived data - removing from it never touches plaintext. That is also how a
  // full pass sweeps the stale `.enc` of a `.syncignore`d path out of the mirror.
  const mirrorEnc = _walkFiles(dstDir, null).filter(p => p.endsWith('.enc'));
  const mirrorSet = new Set(mirrorEnc);

  // Names first, bytes second: the guard needs the whole keep set before a
  // single file is written, and a name costs one HMAC (v2) or none (v1).
  const plan = relPaths.map((relPath) => {
    const encName = format === 'v1' ? null : encryptRelPath(relPath, masterKey, hkdfInfo);
    const encRelPath = format === 'v1' ? relPath + '.enc' : encName + '.enc';
    return { relPath, encName, encRelPath };
  });
  const keepEnc = new Set(plan.map(p => p.encRelPath));
  // A v1 mirror holds `<relPath>.enc` names, so count those as overlap too: a
  // legacy source must not read as "never decrypted".
  let overlap = 0;
  for (const p of plan) {
    if (mirrorSet.has(p.encRelPath) || mirrorSet.has(p.relPath + '.enc')) overlap++;
  }
  const toRemove = mirrorEnc.filter(e => !keepEnc.has(e));
  if (prune && mirrorEnc.length > 0 && toRemove.length > 0) {
    if (overlap === 0) {
      throw new EncryptionError('encrypt-destructive',
        'The plaintext directory holds no file the mirror knows (' + relPaths.length + ' plaintext files, '
        + mirrorEnc.length + ' encrypted) - it looks like an undecrypted source. Encrypting would remove '
        + toRemove.length + ' team files from the mirror, so it was aborted. Decrypt the data first.');
    }
    const ratio = toRemove.length / mirrorEnc.length;
    if (toRemove.length > DESTRUCTIVE_MIN_FILES && ratio > DESTRUCTIVE_RATIO) {
      throw new EncryptionError('encrypt-destructive',
        'Encrypting would remove ' + toRemove.length + ' of ' + mirrorEnc.length + ' mirror files ('
        + Math.round(ratio * 100) + '%). Aborted to avoid losing team data.');
    }
  }

  let written = 0;
  let skipped = 0;
  for (const { relPath, encName, encRelPath } of plan) {
    const srcPath = path.join(srcDir, ...relPath.split('/'));
    const dstPath = path.join(dstDir, encRelPath);
    try {
      if (fs.statSync(dstPath).mtimeMs > fs.statSync(srcPath).mtimeMs) { skipped++; continue; }
    } catch { /* not in the mirror yet - encrypt it */ }
    const plaintext = fs.readFileSync(srcPath);
    const armored = format === 'v1'
      ? encryptBufferV1(plaintext, relPath, masterKey, hkdfInfo)
      : encryptBuffer(plaintext, relPath, encName, masterKey, hkdfInfo);
    fs.mkdirSync(path.dirname(dstPath), { recursive: true });
    fs.writeFileSync(dstPath, armored, 'utf8');
    written++;
  }
  let removed = 0;
  if (prune) {
    for (const encRelPath of toRemove) {
      fs.unlinkSync(path.join(dstDir, ...encRelPath.split('/')));
      removed++;
    }
    _removeEmptyDirs(dstDir);
  }
  return { files: relPaths, written, removed, skipped };
}

/**
 * Read-only: how many plaintext files have a counterpart in the mirror by NAME
 * (v2 `<hmac>.enc` or legacy `<relPath>.enc`). Zero next to a non-empty mirror
 * is the signature of a source that was cloned but never decrypted, which is
 * what the status endpoint reports as `decrypted: false`. One HMAC per file,
 * no content read, no write.
 * @param {string} srcDir plaintext @param {string} dstDir mirror
 * @param {Buffer} masterKey @param {Buffer} [hkdfInfo]
 * @returns {{plaintextFiles: number, mirrorEnc: number, overlap: number}}
 */
function mirrorOverlap(srcDir, dstDir, masterKey, hkdfInfo = DEFAULT_HKDF_INFO) {
  const syncIgnore = _readSyncIgnore(srcDir);
  const relPaths = _walkFiles(srcDir, EXCLUDED_NAMES).filter(p => !_isSyncIgnored(p, syncIgnore));
  const mirrorSet = new Set(_walkFiles(dstDir, null).filter(p => p.endsWith('.enc')));
  let overlap = 0;
  for (const relPath of relPaths) {
    if (mirrorSet.has(encryptRelPath(relPath, masterKey, hkdfInfo) + '.enc') || mirrorSet.has(relPath + '.enc')) overlap++;
  }
  return { plaintextFiles: relPaths.length, mirrorEnc: mirrorSet.size, overlap };
}

/**
 * Read-only probe: would `encryptTree(srcDir, dstDir, ...)` change the mirror
 * right now? Same incremental mtime gate as `encryptTree` (`dst` newer than
 * `src` -> already byte-correct, skip), plus a byte compare through the same
 * deterministic `encryptBuffer` for anything the gate cannot rule out on mtime
 * alone - `decryptTree` always leaves the plaintext mtime newer than the
 * mirror it just came from, so mtime alone would report "dirty" after every
 * ordinary pull.
 *
 * NEVER writes to disk: no `writeFileSync`, `renameSync`, `unlinkSync`,
 * `mkdirSync` or `utimesSync` anywhere in this function or anything it calls.
 * Callers that need this to stay cheap on a poll pass `opts.stopAtFirst` and
 * their own `opts.compareCache`.
 *
 * @param {string} srcDir plaintext @param {string} dstDir mirror
 * @param {Buffer} masterKey @param {Buffer} [hkdfInfo]
 * @param {object} [opts]
 * @param {Map} [opts.compareCache] memo across polls, caller-owned so it
 *   persists between calls. Key: `relPath|srcMtime|srcSize|dstMtime` ->
 *   boolean "identical to the mirror". Cleared here once it passes 5000
 *   entries.
 * @param {boolean} [opts.collectPaths] also return `encPaths`, the mirror
 *   `<name>.enc` paths that differ, so the caller can union them with
 *   `git status` output instead of adding two counts that may overlap. Also
 *   returns `nameMap` (`Map<encRelPath, relPath>` for EVERY plaintext file
 *   reviewed, changed or not - the classifier's cheap way to resolve a bare
 *   `.enc` name back to a path without a decrypt), `pendingPaths`
 *   (`{relPath, encRelPath, kind: 'added'|'changed'|'removed'}[]`; `relPath`
 *   of a `removed` entry is the `.enc` name minus the suffix in a v1 mirror
 *   and `null` in a v2 one, whose name is an HMAC of a path that is gone
 *   from the tree), and `mtimeByRelPath`
 *   (`Map<relPath, mtimeMs>` for EVERY plaintext file reviewed, changed or
 *   not - the "when did this last change on THIS computer" a caller needs
 *   for a "localAt" column has nowhere cheaper to come from than the walk
 *   this option already runs).
 *   Ignored together with `stopAtFirst`, which returns before the walk ends.
 * @param {boolean} [opts.stopAtFirst] return as soon as one addition or
 *   change is found. The `removed` count then stays 0 rather than exact -
 *   detecting a removal needs the full `keep` set, which this skips - so a
 *   caller that only needs the `dirty` boolean should pass this, and a caller
 *   that needs exact counts must not.
 * A file whose v2 name is absent but whose v1 name (`<relPath>.enc`) is
 * present counts as unchanged and is reported in `legacy` - but only when
 * `opts.format` is `'v2'` (the default): in `'v1'` mode the `<relPath>.enc`
 * name IS the primary layout for this source, so it goes through the normal
 * added/changed comparison via `encryptBufferV1` instead of being skipped.
 *
 * @param {object} [opts]
 * @param {'v1'|'v2'} [opts.format] default `'v2'`. See `encryptTree` for what
 *   each format names files and which writer it uses.
 * @returns {{dirty: boolean, added: number, changed: number, removed: number,
 *   checked: number, legacy?: number, plaintextEmpty?: boolean,
 *   encPaths?: string[], nameMap?: Map<string,string>,
 *   pendingPaths?: {relPath: string|null, encRelPath: string, kind: string}[],
 *   mtimeByRelPath?: Map<string,number>}}
 */
function plaintextAheadOfMirror(srcDir, dstDir, masterKey, hkdfInfo = DEFAULT_HKDF_INFO, opts = {}) {
  const compareCache = opts.compareCache || null;
  const stopAtFirst = !!opts.stopAtFirst;
  const format = opts.format === 'v1' ? 'v1' : 'v2';
  // Callers that need to UNION this result with `git status` on the same
  // mirror ask for the paths, not just the counts: both sides then speak the
  // same `<name>.enc` names, so a file that is at once uncommitted in the
  // mirror AND edited again in the plaintext tree counts once, not twice.
  // Off by default - collecting costs a full walk, which stopAtFirst exists
  // precisely to avoid.
  const encPaths = opts.collectPaths ? [] : null;
  const nameMap = opts.collectPaths ? new Map() : null;
  const pendingPaths = opts.collectPaths ? [] : null;
  const mtimeByRelPath = opts.collectPaths ? new Map() : null;
  const syncIgnore = _readSyncIgnore(srcDir);
  const relPaths = _walkFiles(srcDir, EXCLUDED_NAMES).filter(p => !_isSyncIgnored(p, syncIgnore));
  const mirrorEnc = _walkFiles(dstDir, null).filter((p) => p.endsWith('.enc'));

  // The exception: an empty plaintext tree next to a mirror that still holds
  // `.enc` files looks like "every file was removed", but the only thing a
  // push would do here is delete the team's data on the remote - encryptTree's
  // keepEnc set would be empty. Report clean rather than inviting that push.
  if (relPaths.length === 0 && mirrorEnc.length > 0) {
    return { dirty: false, plaintextEmpty: true, added: 0, changed: 0, removed: 0, checked: 0 };
  }

  const keep = new Set();
  const mirrorSet = new Set(mirrorEnc);
  let added = 0;
  let changed = 0;
  let checked = 0;
  let legacy = 0;

  for (const relPath of relPaths) {
    checked++;
    const encName = format === 'v1' ? null : encryptRelPath(relPath, masterKey, hkdfInfo);
    const encRelPath = format === 'v1' ? relPath + '.enc' : encName + '.enc';
    // The v1 layout keeps the real path and appends `.enc`, so a v1 mirror
    // holds NONE of the `<hmac>.enc` names computed above. Claiming every one
    // of them is missing would report a freshly cloned v1 source as fully
    // dirty - which is exactly what it did. Only relevant when THIS source
    // writes v2: a source whose format is 'v1' already has encRelPath equal
    // to legacyRelPath, so the branch below never triggers for it.
    const legacyRelPath = relPath + '.enc';
    // Read separately from the srcStat below (which only runs for the
    // non-legacy branch and bails out early on other conditions) so a legacy
    // (v1 mirror) file still gets an mtime - a plain metadata read, never the
    // file's content, so the extra stat costs nothing worth avoiding it for.
    if (mtimeByRelPath) {
      try { mtimeByRelPath.set(relPath, fs.statSync(path.join(srcDir, ...relPath.split('/'))).mtimeMs); }
      catch { /* vanished mid-walk - no mtime to report */ }
    }
    if (format === 'v2' && !mirrorSet.has(encRelPath) && mirrorSet.has(legacyRelPath)) {
      keep.add(legacyRelPath);
      legacy++;
      if (nameMap) nameMap.set(legacyRelPath, relPath);
      // Counted as present and unchanged on purpose, without a byte compare:
      // this source's format is 'v2' but the mirror still holds v1 names for
      // it (mid-migration), and pushing v1 from a v2-format source is not
      // this function's job. Flagging the file dirty would advertise a
      // synchronisation that cannot happen for this source.
      continue;
    }
    keep.add(encRelPath);
    if (nameMap) nameMap.set(encRelPath, relPath);
    const srcPath = path.join(srcDir, ...relPath.split('/'));
    const dstPath = path.join(dstDir, encRelPath);

    let srcStat, dstStat;
    try { srcStat = fs.statSync(srcPath); } catch { continue; } // vanished mid-walk
    try { dstStat = fs.statSync(dstPath); } catch {
      added++;
      if (encPaths) encPaths.push(encRelPath);
      if (pendingPaths) pendingPaths.push({ relPath, encRelPath, kind: 'added' });
      if (stopAtFirst) return { dirty: true, added, changed, removed: 0, checked };
      continue;
    }
    // Same incremental gate as encryptTree: a mirror newer than its source is
    // already byte-correct, because encryption is deterministic.
    if (dstStat.mtimeMs > srcStat.mtimeMs) continue;

    const cacheKey = relPath + '|' + srcStat.mtimeMs + '|' + srcStat.size + '|' + dstStat.mtimeMs;
    if (compareCache && compareCache.has(cacheKey)) {
      if (compareCache.get(cacheKey) === false) {
        changed++;
        if (encPaths) encPaths.push(encRelPath);
        if (pendingPaths) pendingPaths.push({ relPath, encRelPath, kind: 'changed' });
        if (stopAtFirst) return { dirty: true, added, changed, removed: 0, checked };
      }
      continue;
    }

    const plaintext = fs.readFileSync(srcPath);
    const armored = format === 'v1'
      ? encryptBufferV1(plaintext, relPath, masterKey, hkdfInfo)
      : encryptBuffer(plaintext, relPath, encName, masterKey, hkdfInfo);
    const dstArmored = fs.readFileSync(dstPath, 'utf8');
    const identical = armored === dstArmored;
    if (compareCache) {
      if (compareCache.size > 5000) compareCache.clear();
      compareCache.set(cacheKey, identical);
    }
    if (!identical) {
      changed++;
      if (encPaths) encPaths.push(encRelPath);
      if (pendingPaths) pendingPaths.push({ relPath, encRelPath, kind: 'changed' });
      if (stopAtFirst) return { dirty: true, added, changed, removed: 0, checked };
    }
  }

  let removed = 0;
  for (const encRelPath of mirrorEnc) {
    if (!keep.has(encRelPath)) {
      removed++;
      if (encPaths) encPaths.push(encRelPath);
      // A v1 mirror names each file `<relPath>.enc` in the clear, so a removed
      // file still has a knowable path - without it the sync window filed
      // every v1 deletion under the anonymous "Cockpit Core" row instead of
      // the scope that owns it. A v2 name is an HMAC and stays unresolved.
      const removedRelPath = format === 'v1' && encRelPath.endsWith('.enc') ? encRelPath.slice(0, -4) : null;
      if (pendingPaths) pendingPaths.push({ relPath: removedRelPath, encRelPath, kind: 'removed' });
    }
  }

  const out = { dirty: added + changed + removed > 0, added, changed, removed, checked, legacy };
  if (encPaths) out.encPaths = encPaths;
  if (nameMap) out.nameMap = nameMap;
  if (pendingPaths) out.pendingPaths = pendingPaths;
  if (mtimeByRelPath) out.mtimeByRelPath = mtimeByRelPath;
  return out;
}

// A decrypt that would wipe most of the plaintext tree is a broken or partial
// mirror, not a deletion the team made. Refuse rather than lose data. The same
// two numbers guard encryptTree in the other direction (see there). Declared
// as constants down here, read at call time - both functions run long after
// this module has loaded. Below DESTRUCTIVE_MIN_FILES the ratio guard does not
// apply - a small source (a handful of files) is protected only
// by encryptTree's overlap === 0 check, because at that size a large ratio is
// as likely to be a real reorganisation as an accident.
const DESTRUCTIVE_MIN_FILES = 50;
const DESTRUCTIVE_RATIO = 0.3;

/**
 * Decrypt the whole mirror into the plaintext tree. Every file is decrypted and
 * authenticated into a staging directory first; the plaintext tree is touched
 * only once ALL of them succeeded, so one bad auth tag leaves it untouched.
 * Deletions propagate, guarded against a mass wipe - unless `opts.prune` is
 * false, which writes every mirror file and removes nothing: the shape of the
 * FIRST decrypt of a source cloned before its key existed, where nothing in the
 * plaintext directory is a stale copy of the mirror (a module's own downloads
 * may sit there, and they stay).
 * @param {string} srcDir mirror @param {string} dstDir plaintext
 * @param {Buffer} masterKey @param {Buffer} [hkdfInfo]
 * @param {{prune?: boolean}} [opts]
 * @returns {{files: string[], written: number, removed: number}}
 */
/**
 * Decrypts one mirror blob of either layout, given its mirror-relative path.
 * Per FILE, not per repo: a source part-way through the v1 -> v2 migration
 * holds both shapes at once, and the prefix is the only reliable teller. v1
 * carries its path in the file NAME, so the relPath is the whole
 * mirror-relative path minus `.enc` - never the basename, which would compute
 * the wrong salt for anything in a subdirectory and report it as a key
 * mismatch. Also used on blobs read from git history (`git show rev:path`).
 * @param {string} armored the blob as stored in the mirror
 * @param {string} encRelPath mirror-relative path, forward slashes, ending in `.enc`
 * @returns {{relPath: string, body: Buffer}}
 */
function decryptMirrorBlob(armored, encRelPath, masterKey, hkdfInfo = DEFAULT_HKDF_INFO) {
  if (String(armored || '').startsWith(V2_PREFIX)) {
    const encName = path.basename(encRelPath).slice(0, -'.enc'.length);
    const { relPath, body } = decryptBuffer(armored, encName, masterKey, hkdfInfo);
    return { relPath, body };
  }
  const relPath = encRelPath.slice(0, -'.enc'.length);
  return { relPath, body: decryptBufferV1(armored, relPath, masterKey, hkdfInfo) };
}

function decryptTree(srcDir, dstDir, masterKey, hkdfInfo = DEFAULT_HKDF_INFO, opts = {}) {
  const prune = opts.prune !== false;
  const encRelPaths = _walkFiles(srcDir, null).filter(p => p.endsWith('.enc'));
  fs.mkdirSync(dstDir, { recursive: true });
  // Staged INSIDE dstDir so the final move is a same-filesystem rename and no
  // stray directory is ever left next to the repo.
  const staging = fs.mkdtempSync(path.join(dstDir, '.crypto-staging-'));
  try {
    // Union of the receiver's own `.syncignore` and the incoming one: a path
    // excluded by EITHER is never written from the mirror and never deleted
    // locally. The incoming policy is decrypted first (its blob name is known
    // for both layouts: v1 keeps the real name, v2 the HMAC name) so the main
    // loop can still stream file by file.
    let syncIgnore = _readSyncIgnore(dstDir);
    const policyEncNames = new Set([
      SYNCIGNORE_FILE + '.enc',
      encryptRelPath(SYNCIGNORE_FILE, masterKey, hkdfInfo) + '.enc',
    ]);
    const _decryptOne = (encRelPath) => {
      const armored = fs.readFileSync(path.join(srcDir, ...encRelPath.split('/')), 'utf8');
      return decryptMirrorBlob(armored, encRelPath, masterKey, hkdfInfo);
    };
    for (const encRelPath of encRelPaths) {
      if (!policyEncNames.has(encRelPath)) continue;
      const { relPath, body } = _decryptOne(encRelPath);
      if (relPath === SYNCIGNORE_FILE) syncIgnore = syncIgnore.concat(_parseSyncIgnore(body.toString('utf8')));
    }
    const plainRelPaths = [];
    for (const encRelPath of encRelPaths) {
      // Excluded blobs (a stale `.enc` pushed by a client without `.syncignore`
      // support) are still decrypted and authenticated, so a corrupt mirror
      // aborts exactly as before, but they never land on disk.
      const { relPath, body } = _decryptOne(encRelPath);
      if (relPath.startsWith('/') || relPath.split('/').includes('..')) {
        throw new EncryptionError('decrypt-failed', 'The path in file ' + encRelPath + ' escapes the directory.');
      }
      if (_isSyncIgnored(relPath, syncIgnore)) continue;
      const stagedPath = path.join(staging, ...relPath.split('/'));
      fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
      fs.writeFileSync(stagedPath, body);
      plainRelPaths.push(relPath);
    }

    // All authenticated. Move in, skipping files whose content already matches:
    // renaming unconditionally would bump every mtime on every sync and break
    // the incremental gate in encryptTree on the way back.
    for (const relPath of plainRelPaths) {
      const target = path.join(dstDir, ...relPath.split('/'));
      const stagedPath = path.join(staging, ...relPath.split('/'));
      try {
        if (fs.readFileSync(target).equals(fs.readFileSync(stagedPath))) continue;
      } catch { /* absent or unreadable - write it */ }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(stagedPath, target);
    }

    if (!prune) return { files: plainRelPaths, written: plainRelPaths.length, removed: 0 };
    const keep = new Set(plainRelPaths);
    const existing = _walkFiles(dstDir, new Set([path.basename(staging), ...EXCLUDED_NAMES]))
      .filter(p => !_isSyncIgnored(p, syncIgnore));
    const toRemove = existing.filter(p => !keep.has(p));
    const ratio = existing.length > 0 ? toRemove.length / existing.length : 0;
    if (toRemove.length > DESTRUCTIVE_MIN_FILES && ratio > DESTRUCTIVE_RATIO) {
      throw new EncryptionError('decrypt-destructive',
        'Decrypting would remove ' + toRemove.length + ' of ' + existing.length + ' files ('
        + Math.round(ratio * 100) + '%). Aborted to avoid losing data.');
    }
    let removed = 0;
    for (const relPath of toRemove) {
      fs.unlinkSync(path.join(dstDir, ...relPath.split('/')));
      removed++;
    }
    return { files: plainRelPaths, written: plainRelPaths.length, removed };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

module.exports = {
  DEFAULT_HKDF_INFO,
  KNOWN_REPO_IDS,
  OWN_LINE_ONLY_IDS,
  EXCLUDED_NAMES,
  SYNCIGNORE_FILE,
  _parseSyncIgnore,
  _isSyncIgnored,
  EncryptionError,
  loadMasterKey,
  validateKey,
  readKeyMap,
  saveRepoKey,
  generateKey,
  generateRepoKey,
  encryptRelPath,
  encryptBuffer,
  encryptBufferV1,
  decryptBuffer,
  decryptBufferV1,
  decryptMirrorBlob,
  encryptTree,
  mirrorOverlap,
  decryptTree,
  plaintextAheadOfMirror,
};
