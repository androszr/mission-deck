#!/usr/bin/env node
'use strict';
// scripts/extract-transcript.js
// The deterministic half of /summarize-meeting: find a transcript, turn it into
// plain text, list the meeting templates, slugify a topic. Node built-ins only -
// a .docx is a ZIP, and zlib inflates its one interesting member.
//
//   node scripts/extract-transcript.js --list
//   node scripts/extract-transcript.js user-data/transcripts/a.docx --out /tmp/t.txt
//   node scripts/extract-transcript.js --templates
//   node scripts/extract-transcript.js --slug "Przeglad sprintu"
//
// Exit: 0 ok, 1 nothing found / unreadable input, 2 usage or internal error.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const R = require('./_report');

const HELP = `
extract-transcript.js - transcript plumbing for /summarize-meeting

Usage:
  node scripts/extract-transcript.js --list [--dir <dir>]
  node scripts/extract-transcript.js <file> [--out <path>]
  node scripts/extract-transcript.js --templates
  node scripts/extract-transcript.js --slug "<text>"

Options:
  --list       print candidate transcript files (.txt .md .json .docx), one per line
  --dir        transcript directory (default user-data/transcripts)
  --out        write the extracted text to this path instead of stdout
  --templates  print JSON [{name, path, topSection}] for templates/meeting-notes/*.template.md
  --slug       print an ASCII kebab-case slug (max 60 chars) for the given text
  --json       with --list: a JSON array instead of lines
  --help       this text

Exit codes: 0 ok, 1 nothing found or unreadable input, 2 usage or internal error.
`;

const TRANSCRIPT_DIR = path.join('user-data', 'transcripts');
const TEMPLATE_DIR = path.join('templates', 'meeting-notes');
const EXTS = ['.txt', '.md', '.json', '.docx'];

// Polish letters do not decompose under NFD, so the map is explicit.
const PL_MAP = {
  'ą': 'a', 'Ą': 'a', 'ć': 'c', 'Ć': 'c', 'ę': 'e', 'Ę': 'e',
  'ł': 'l', 'Ł': 'l', 'ń': 'n', 'Ń': 'n', 'ó': 'o', 'Ó': 'o',
  'ś': 's', 'Ś': 's', 'ż': 'z', 'Ż': 'z', 'ź': 'z', 'Ź': 'z',
};

function slugify(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  s = s.split('').map((ch) => (PL_MAP[ch] !== undefined ? PL_MAP[ch] : ch)).join('');
  s = s.toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length > 60) s = s.slice(0, 60).replace(/-+$/, '');
  return s;
}

// ---------------------------------------------------------------------------
// .docx - a ZIP whose word/document.xml holds the text
// ---------------------------------------------------------------------------

/** Read one member of a ZIP by name, using the central directory. */
function zipRead(buf, member) {
  // End of central directory: signature 0x06054b50, scanned from the tail.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('not a ZIP file (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('corrupt ZIP central directory');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    if (name === member) {
      if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('corrupt ZIP local header');
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const data = buf.subarray(start, start + compSize);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data);
      throw new Error('unsupported ZIP compression method ' + method + ' (only stored and deflate)');
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error("'" + member + "' not found inside the file - is this a .docx?");
}

function extractDocx(file) {
  const xml = zipRead(fs.readFileSync(file), 'word/document.xml').toString('utf8');
  let text = xml
    .replace(/<\/w:p>/g, '\n')
    .replace(/<w:tab[^>]*\/>/g, '\t')
    .replace(/<[^>]+>/g, ' ');
  text = text
    .replace(/&#xA;/g, '\n')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
  return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

// ---------------------------------------------------------------------------
// .json - a transcript export of some shape
// ---------------------------------------------------------------------------

const SPEAKER_KEYS = ['speaker', 'speakerName', 'displayName', 'name', 'author'];
const TEXT_KEYS = ['text', 'content', 'message', 'body', 'transcript'];
const ARRAY_KEYS = ['segments', 'transcript', 'messages', 'turns', 'entries', 'utterances', 'items'];

function segmentLine(item) {
  if (!item || typeof item !== 'object') return '';
  let speaker = '';
  for (const k of SPEAKER_KEYS) {
    if (item[k]) { speaker = item[k]; break; }
  }
  if (speaker && typeof speaker === 'object') {
    speaker = speaker.name || speaker.displayName || speaker.id || '';
  }
  let text = '';
  for (const k of TEXT_KEYS) {
    if (typeof item[k] === 'string' && item[k].trim()) { text = item[k].trim(); break; }
  }
  if (!text) return '';
  return speaker ? String(speaker) + ': ' + text : text;
}

function extractJson(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  let arr = null;
  if (Array.isArray(data)) arr = data;
  else if (data && typeof data === 'object') {
    for (const k of ARRAY_KEYS) {
      if (Array.isArray(data[k])) { arr = data[k]; break; }
    }
  }
  if (!arr) return JSON.stringify(data, null, 2);
  const lines = arr.map(segmentLine).filter(Boolean);
  return lines.length ? lines.join('\n') : JSON.stringify(data, null, 2);
}

function extract(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.docx') return extractDocx(file);
  if (ext === '.json') return extractJson(file);
  if (ext === '.txt' || ext === '.md') return fs.readFileSync(file, 'utf8').trim();
  throw new Error('unsupported extension ' + ext + ' (use .txt, .md, .json or .docx)');
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * The "Purpose" block: the blockquote under the `# Template:` H1, up to the
 * first `---` separator that follows it. It is what pass 1 of the summarizer reads.
 */
function topSection(text) {
  const lines = text.split('\n');
  let start = lines.findIndex((l) => /^#\s+Template:/i.test(l));
  if (start === -1) start = lines.findIndex((l) => /^>/.test(l));
  if (start === -1) return '';
  const out = [];
  for (let i = start; i < lines.length; i++) {
    if (i > start && /^---\s*$/.test(lines[i])) break;
    out.push(lines[i]);
  }
  return out.join('\n').trim();
}

function listTemplates() {
  const dir = path.join(R.ROOT, TEMPLATE_DIR);
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names
    .filter((n) => n.endsWith('.template.md'))
    .sort()
    .map((n) => {
      const p = path.join(dir, n);
      let text = '';
      try { text = fs.readFileSync(p, 'utf8'); } catch { /* skip unreadable */ }
      return { name: n.replace(/\.template\.md$/, ''), path: p, topSection: topSection(text) };
    });
}

function listTranscripts(dir) {
  const abs = path.isAbsolute(dir) ? dir : path.join(R.ROOT, dir);
  let names;
  try { names = fs.readdirSync(abs); } catch { return []; }
  return names
    .filter((n) => EXTS.includes(path.extname(n).toLowerCase()) && !n.startsWith('.'))
    .sort()
    .map((n) => path.join(abs, n));
}

// ---------------------------------------------------------------------------

function main() {
  const { flags, positionals } = R.parseArgs(process.argv.slice(2), { string: ['dir', 'out', 'slug'] });
  if (flags.help) R.showHelp(HELP);

  if (flags.slug !== undefined) {
    process.stdout.write(slugify(flags.slug) + '\n');
    return;
  }

  if (flags.templates) {
    process.stdout.write(JSON.stringify(listTemplates(), null, 2) + '\n');
    return;
  }

  if (flags.list) {
    const dir = flags.dir || TRANSCRIPT_DIR;
    const files = listTranscripts(dir);
    if (flags.json) process.stdout.write(JSON.stringify(files, null, 2) + '\n');
    else process.stdout.write(files.join('\n') + (files.length ? '\n' : ''));
    if (files.length === 0) {
      process.stderr.write('no transcript files in ' + dir + ' (.txt .md .json .docx)\n');
      process.exit(1);
    }
    return;
  }

  if (positionals.length === 0) R.showHelp(HELP);
  const file = path.isAbsolute(positionals[0]) ? positionals[0] : path.join(R.ROOT, positionals[0]);
  if (!fs.existsSync(file)) {
    process.stderr.write('file not found: ' + positionals[0] + '\n');
    process.exit(1);
  }
  let text;
  try { text = extract(file); } catch (e) {
    process.stderr.write('cannot extract ' + positionals[0] + ': ' + e.message + '\n');
    process.exit(1);
  }
  if (!text.trim()) {
    process.stderr.write('extracted no text from ' + positionals[0] + '\n');
    process.exit(1);
  }
  if (flags.out) {
    const out = path.isAbsolute(flags.out) ? flags.out : path.join(R.ROOT, flags.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text, 'utf8');
    process.stdout.write(out + '\n' + text.length + ' chars\n');
  } else {
    process.stdout.write(text + '\n');
  }
}

if (require.main === module) {
  try { main(); } catch (e) {
    process.stderr.write('extract-transcript internal error: ' + ((e && e.stack) || e) + '\n');
    process.exit(2);
  }
} else {
  module.exports = { slugify, extract, extractDocx, extractJson, topSection, listTemplates, listTranscripts, zipRead };
}
