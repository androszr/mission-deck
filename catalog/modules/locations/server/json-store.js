'use strict';
// locations/server/json-store.js
// The ONLY server file besides index.js with `fs` - tmp+rename writer for
// the locations/ files, shared by the import route. A full
// replace (this dataset's contract - see README.md, "Import = full
// replace") still must not dirty the sync mirror on a re-import that
// changes nothing: every JSON here carries at least one timestamp field that
// moves on EVERY run, so a byte comparison would always report "changed".
// writeJsonIfChanged compares with those fields stripped instead.

const fs = require('fs');
const path = require('path');

// Every volatile field this module's own writers ever put into a
// metadata object (locations.json and locations.index.json).
const VOLATILE_METADATA_KEYS = ['updated_at', 'generated_at', 'created_at', 'source_file_modified_at'];

/**
 * @param {string} file
 * @returns {object|null} parsed JSON, or `null` on a missing/unparsable file
 *   or a non-object result - never throws.
 */
function readJsonSafe(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} file
 * @returns {number} mtimeMs, or 0 when the file does not exist / cannot be stat'd
 */
function mtimeOf(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Deep-ish copy of `payload` with every VOLATILE_METADATA_KEYS entry removed
 * from its top-level `metadata` object (every shape this module writes keeps
 * its timestamps there). Payloads with no `metadata` object pass through as
 * a shallow copy.
 * @param {object} payload
 * @returns {object}
 */
function stripVolatile(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const copy = { ...payload };
  if (copy.metadata && typeof copy.metadata === 'object') {
    const metaCopy = { ...copy.metadata };
    for (const key of VOLATILE_METADATA_KEYS) delete metaCopy[key];
    copy.metadata = metaCopy;
  }
  return copy;
}

/**
 * Writes `payload` to `file` as compact JSON (no indentation - these files
 * can run to several MB, indentation would roughly double that) through tmp+rename,
 * UNLESS the content is identical to what is already on disk once volatile
 * timestamp fields are stripped from both sides - in that case nothing is
 * touched, not even mtime.
 * @param {string} file
 * @param {object} payload
 * @returns {{status: 'written'|'unchanged', bytes: number}}
 */
function writeJsonIfChanged(file, payload) {
  const current = readJsonSafe(file);
  if (current !== null) {
    const same = JSON.stringify(stripVolatile(current)) === JSON.stringify(stripVolatile(payload));
    if (same) {
      let bytes = 0;
      try { bytes = fs.statSync(file).size; } catch { /* stat race, report 0 */ }
      return { status: 'unchanged', bytes };
    }
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = JSON.stringify(payload);
  const tmp = file + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
  return { status: 'written', bytes: Buffer.byteLength(text, 'utf8') };
}

module.exports = { readJsonSafe, mtimeOf, stripVolatile, writeJsonIfChanged };
