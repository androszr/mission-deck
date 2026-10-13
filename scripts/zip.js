'use strict';
// scripts/zip.js
// Dependency-free ZIP writer/reader (STORE + DEFLATE). CommonJS, zlib only.
// Used by the module import/export routes in server.js (section "Modules plug
// & play"). Never adds a runtime dependency: `zlib.deflateRawSync` /
// `zlib.inflateRawSync` produce and consume exactly the raw stream ZIP method
// 8 expects.
//
// Exports: writeZip, readZip, crc32, isSafeEntryName.

const zlib = require('zlib');

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const EOCD_MIN_SIZE = 22;
const EOCD_SCAN_MAX = 65557; // 22 (EOCD) + 65535 (max comment length)

// ── crc32 ─────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── DOS date/time ─────────────────────────────────────────────────────────

function dosDateTime(mtime) {
  let d = mtime instanceof Date && !Number.isNaN(mtime.getTime()) ? mtime : new Date();
  let year = d.getFullYear();
  if (year < 1980) year = 1980;
  if (year > 2107) year = 2107;
  const dosDate = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  return { dosDate: dosDate & 0xFFFF, dosTime: dosTime & 0xFFFF };
}

// ── isSafeEntryName ───────────────────────────────────────────────────────

/**
 * Pure guard against zip-slip. Rejects anything that could resolve outside
 * the extraction directory once joined with it.
 * @param {string} name entry name as stored in the archive
 * @returns {boolean}
 */
function isSafeEntryName(name) {
  if (typeof name !== 'string' || name.length === 0) return false;
  if (name.includes('\\')) return false;
  if (name.startsWith('/')) return false;
  if (/^[A-Za-z]:/.test(name)) return false;
  const segments = name.split('/');
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const isTrailingDirMarker = i === segments.length - 1 && seg === '';
    if (isTrailingDirMarker) continue;
    if (seg === '' || seg === '.' || seg === '..') return false;
  }
  return true;
}

// ── writeZip ──────────────────────────────────────────────────────────────

/**
 * Build a ZIP archive from a list of file entries.
 * @param {Array<{ name: string, data: Buffer, mtime?: Date }>} entries
 * @returns {Buffer}
 */
function writeZip(entries) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const data = entry.data;
    const { dosDate, dosTime } = dosDateTime(entry.mtime);
    const crc = crc32(data);

    let method = METHOD_STORE;
    let payload = data;
    const deflated = zlib.deflateRawSync(data);
    if (deflated.length < data.length) {
      method = METHOD_DEFLATE;
      payload = deflated;
    }

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(SIG_LOCAL, 0);
    localHeader.writeUInt16LE(20, 4); // version needed to extract
    localHeader.writeUInt16LE(0, 6); // general purpose flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length

    const localOffset = offset;
    localChunks.push(localHeader, nameBuf, payload);
    offset += localHeader.length + nameBuf.length + payload.length;

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(SIG_CENTRAL, 0);
    centralHeader.writeUInt16LE(0x031E, 4); // version made by (Unix, 3.0)
    centralHeader.writeUInt16LE(20, 6); // version needed to extract
    centralHeader.writeUInt16LE(0, 8); // general purpose flag
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra field length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal file attributes
    centralHeader.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external file attributes (regular file)
    centralHeader.writeUInt32LE(localOffset, 42);

    centralChunks.push(centralHeader, nameBuf);
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const chunk of centralChunks) centralSize += chunk.length;

  const eocd = Buffer.alloc(EOCD_MIN_SIZE);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central directory
  eocd.writeUInt16LE(entries.length, 8); // entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localChunks, ...centralChunks, eocd]);
}

// ── readZip ───────────────────────────────────────────────────────────────

function _findEocd(buf) {
  const scanStart = Math.max(0, buf.length - EOCD_SCAN_MAX);
  for (let i = buf.length - EOCD_MIN_SIZE; i >= scanStart; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  return -1;
}

/**
 * Parse a ZIP archive from a Buffer, enforcing hard limits before each entry
 * is inflated. Reads the CENTRAL DIRECTORY, never the local headers, because
 * a local header may carry zeroed sizes (general purpose flag bit 3, data
 * descriptor after the payload) while the central directory always has them.
 * @param {Buffer} buf
 * @param {{ maxEntries: number, maxFileBytes: number, maxTotalBytes: number }} limits
 * @returns {Array<{ name: string, data: Buffer, externalAttributes: number, isDir: boolean }>}
 */
function readZip(buf, limits) {
  if (!limits || typeof limits.maxEntries !== 'number'
    || typeof limits.maxFileBytes !== 'number' || typeof limits.maxTotalBytes !== 'number') {
    throw new Error('readZip: limits.maxEntries, maxFileBytes and maxTotalBytes are all required');
  }

  const eocdAt = _findEocd(buf);
  if (eocdAt === -1) throw new Error('not a zip archive (EOCD not found)');

  const totalEntries = buf.readUInt16LE(eocdAt + 10);
  const centralSize = buf.readUInt32LE(eocdAt + 12);
  const centralOffset = buf.readUInt32LE(eocdAt + 16);

  if (totalEntries === 0xFFFF || centralSize === 0xFFFFFFFF || centralOffset === 0xFFFFFFFF) {
    throw new Error('zip64 not supported');
  }
  if (totalEntries > limits.maxEntries) {
    throw new Error('too many entries: ' + totalEntries + ' > ' + limits.maxEntries);
  }

  const out = [];
  let pos = centralOffset;
  let totalBytes = 0;

  for (let i = 0; i < totalEntries; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== SIG_CENTRAL) {
      throw new Error('corrupt central directory entry #' + i);
    }
    const method = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const uncompSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const externalAttributes = buf.readUInt32LE(pos + 38);
    const localHeaderOffset = buf.readUInt32LE(pos + 42);
    const name = buf.slice(pos + 46, pos + 46 + nameLen).toString('utf8');

    if (compSize === 0xFFFFFFFF || uncompSize === 0xFFFFFFFF) {
      throw new Error('zip64 not supported');
    }
    if (uncompSize > limits.maxFileBytes) {
      throw new Error('entry "' + name + '" exceeds maxFileBytes (' + uncompSize + ' > ' + limits.maxFileBytes + ')');
    }
    totalBytes += uncompSize;
    if (totalBytes > limits.maxTotalBytes) {
      throw new Error('archive exceeds maxTotalBytes (' + totalBytes + ' > ' + limits.maxTotalBytes + ')');
    }

    // Local header: fixed 30 bytes + variable name/extra, then the payload.
    if (localHeaderOffset + 30 > buf.length || buf.readUInt32LE(localHeaderOffset) !== SIG_LOCAL) {
      throw new Error('corrupt local header for entry "' + name + '"');
    }
    const localNameLen = buf.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = buf.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressed = buf.slice(dataStart, dataStart + compSize);

    let data;
    if (method === METHOD_STORE) {
      data = compressed;
    } else if (method === METHOD_DEFLATE) {
      // maxOutputLength is the ONLY barrier that stops a zip bomb, because
      // every check above trusts `uncompSize`, a number the archive declares
      // about itself. A crafted entry can claim 1 KB and inflate to gigabytes;
      // without this option the allocation happens first and the size mismatch
      // is noticed afterwards, which is too late. zlib throws
      // ERR_BUFFER_TOO_LARGE once the output passes the cap.
      try {
        data = zlib.inflateRawSync(compressed, { maxOutputLength: limits.maxFileBytes });
      } catch (e) {
        if (e && (e.code === 'ERR_BUFFER_TOO_LARGE' || /maxOutputLength|Cannot create a Buffer larger/i.test(e.message || ''))) {
          throw new Error('entry "' + name + '" exceeds maxFileBytes when decompressed');
        }
        throw new Error('entry "' + name + '" could not be decompressed: ' + (e && e.message));
      }
    } else {
      throw new Error('unsupported compression method (' + method + ') for entry "' + name + '"');
    }

    if (data.length !== uncompSize) {
      throw new Error('entry "' + name + '" size mismatch after decompression');
    }
    const actualCrc = crc32(data);
    const expectedCrc = buf.readUInt32LE(pos + 16);
    if (actualCrc !== expectedCrc) {
      throw new Error('entry "' + name + '" failed CRC32 check (corrupt archive)');
    }

    out.push({
      name,
      data,
      externalAttributes,
      isDir: name.endsWith('/'),
    });

    pos += 46 + nameLen + extraLen + commentLen;
  }

  return out;
}

module.exports = { writeZip, readZip, crc32, isSafeEntryName };
