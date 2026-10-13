'use strict';
// modules/meeting-archive/server/publish-lib.js
// Pure helpers that turn one transcript document of the meeting-transcripts
// module (user-data/transcripts/<name>.json) into the files of a meeting
// folder in the archive's shape (metadata.json,
// meeting-info.json, meeting-user-meta.json, summary.md, transcript.json,
// transcript.txt, report.html). No I/O here except what the caller passes in.

const { FOLDER_RE } = require('./paths');

// Same rule as meeting-transcripts/server/lib.js OUTPUT_NAME_RE - copied, a
// module never imports another module's code.
const TRANSCRIPT_NAME_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}-[a-z0-9-]{1,60}\.json$/;
const ID_RE = /^(cat|fld)-[A-Za-z0-9-]{1,60}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TITLE = 200;
const SLUG_MAX = 40;

/** @param {unknown} name */
function isValidTranscriptName(name) {
  return typeof name === 'string' && TRANSCRIPT_NAME_RE.test(name);
}

/**
 * ASCII slug: accented letters folded, everything else to '-'.
 * @param {string} s
 * @returns {string}
 */
function slugify(s) {
  // l-stroke has no NFKD decomposition; the other accented letters fold below.
  return String(s || '').toLowerCase()
    .replace(/\u0142/g, 'l')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX).replace(/-+$/g, '');
}

/**
 * Wall-clock parts of an instant in Europe/Warsaw.
 * @param {Date} d
 * @returns {{day: string, hm: string}} 'YYYY-MM-DD', 'HH-MM'
 */
function warsawParts(d) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { day: p.year + '-' + p.month + '-' + p.day, hm: p.hour + '-' + p.minute };
}

/** First valid instant among the candidates, else `fallback`. */
function pickDate(candidates, fallback) {
  for (const c of candidates) {
    if (!c) continue;
    const d = new Date(c);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return fallback;
}

/**
 * Folder name `YYYY-MM-DD_HH-MM_<slug>` keyed on the MEETING time (recording
 * date when known), unique against `taken`.
 * @param {object} doc transcript document
 * @param {Set<string>} taken folder names already present
 * @param {Date} now
 * @returns {string}
 */
function folderNameFor(doc, taken, now) {
  const when = pickDate([doc.recorded_at, doc.processed_at], now);
  const { day, hm } = warsawParts(when);
  const stem = String(doc.source_file || '').replace(/\.[A-Za-z0-9]{1,5}$/, '');
  const slug = slugify(doc.title) || slugify(stem) || 'meeting';
  const base = day + '_' + hm + '_' + slug;
  let name = base;
  for (let i = 2; taken.has(name); i++) name = base + '-' + i;
  if (!FOLDER_RE.test(name)) throw new Error('bad folder name: ' + name);
  return name;
}

/**
 * Meeting date (YYYY-MM-DD, Warsaw) of a transcript document.
 * @param {object} doc
 * @param {Date} now
 */
function meetingDate(doc, now) {
  return warsawParts(pickDate([doc.recorded_at, doc.processed_at], now)).day;
}

/**
 * Every file of the meeting folder, as name -> text.
 * @param {object} doc transcript document (schemaVersion 1)
 * @param {{name: string, folder: string, now: Date, reportHtml?: string|null, userMeta?: object|null}} o
 * @returns {Record<string, string>}
 */
function buildMeetingFiles(doc, o) {
  const now = o.now;
  const segments = Array.isArray(doc.segments) ? doc.segments : [];
  const summaryMd = (doc.summary && typeof doc.summary.summary_md === 'string') ? doc.summary.summary_md : '';
  const participants = (Array.isArray(doc.participants) ? doc.participants : [])
    .filter((p) => p && typeof p.name === 'string' && p.name.trim())
    .map((p) => ({
      name: p.name.trim(),
      speaker_id: String(p.speaker_id || p.name).trim(),
      member_id: typeof p.member_id === 'string' && /^tm-[A-Za-z0-9-]{1,40}$/.test(p.member_id) ? p.member_id : null,
    }));
  const metadata = {
    source_file: String(doc.source_file || ''),
    folder: o.folder,
    processed_at: String(doc.processed_at || now.toISOString()),
    published_at: now.toISOString(),
    status: 'ok',
    errorReason: null,
    has_transcript: segments.length > 0,
    duration_sec: Number(doc.duration_sec) > 0 ? Number(doc.duration_sec) : 0,
    html_status: o.reportHtml ? 'ok' : 'none',
    source: 'meeting-transcripts',
    source_transcript: o.name,
    model: String(doc.model || ''),
    warnings: Array.isArray(doc.warnings) ? doc.warnings.map(String) : [],
    chosen_template: (doc.summary && doc.summary.chosen_template) || null,
  };
  const info = {
    brief: String(doc.brief || ''),
    title: String(doc.title || '').slice(0, MAX_TITLE),
    participants,
  };
  const prevMeta = o.userMeta && typeof o.userMeta === 'object' ? o.userMeta : null;
  const userMeta = prevMeta || {
    area_id: null,
    categories: [],
    meeting_date: meetingDate(doc, now),
    virtual_folder_id: null,
  };
  const files = {
    'metadata.json': JSON.stringify(metadata, null, 2) + '\n',
    'meeting-info.json': JSON.stringify(info, null, 2) + '\n',
    'meeting-user-meta.json': JSON.stringify(userMeta, null, 2) + '\n',
    'summary.md': summaryMd.endsWith('\n') || !summaryMd ? summaryMd : summaryMd + '\n',
    'transcript.json': JSON.stringify({ segments }, null, 2) + '\n',
    'transcript.txt': String(doc.transcript_txt || ''),
  };
  if (o.reportHtml) files['report.html'] = o.reportHtml;
  return files;
}

/**
 * Validated edit of meeting-user-meta.json. Unknown keys of `prev` are kept.
 * @param {object|null} prev current meeting-user-meta.json
 * @param {object} body {title?, date?, categoryIds?, folderId?}
 * @param {{categoryIds: Set<string>, folderIds: Set<string>}} known
 * @returns {{ok: true, meta: object}|{ok: false, error: string}}
 */
function applyUserMetaEdit(prev, body, known) {
  const meta = { area_id: null, categories: [], meeting_date: null, virtual_folder_id: null, ...(prev || {}) };
  const b = body || {};
  if (b.title !== undefined) {
    if (typeof b.title !== 'string' || b.title.length > MAX_TITLE) return { ok: false, error: 'bad-title' };
    const t = b.title.trim();
    if (t) meta.custom_title = t; else delete meta.custom_title;
  }
  if (b.date !== undefined) {
    if (b.date !== null && (typeof b.date !== 'string' || !DATE_RE.test(b.date))) return { ok: false, error: 'bad-date' };
    meta.meeting_date = b.date;
  }
  if (b.categoryIds !== undefined) {
    if (!Array.isArray(b.categoryIds) || b.categoryIds.length > 50) return { ok: false, error: 'bad-categories' };
    const ids = [...new Set(b.categoryIds)];
    if (!ids.every((id) => typeof id === 'string' && ID_RE.test(id) && known.categoryIds.has(id))) {
      return { ok: false, error: 'unknown-category' };
    }
    meta.categories = ids;
  }
  if (b.folderId !== undefined) {
    if (b.folderId !== null && !(typeof b.folderId === 'string' && ID_RE.test(b.folderId) && known.folderIds.has(b.folderId))) {
      return { ok: false, error: 'unknown-folder' };
    }
    // A person chose the folder: the automatic assignment is settled.
    if (b.folderId !== meta.virtual_folder_id || meta.auto_folder) delete meta.auto_folder;
    meta.virtual_folder_id = b.folderId;
  }
  return { ok: true, meta };
}

/**
 * New id in the archive's shape: `cat-<ms>-<4 chars>` / `fld-...`.
 * @param {'cat'|'fld'} kind
 * @param {number} nowMs
 * @param {() => number} [rand]
 */
function newId(kind, nowMs, rand = Math.random) {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let tail = '';
  for (let i = 0; i < 4; i++) tail += abc[Math.floor(rand() * abc.length)];
  return kind + '-' + nowMs + '-' + tail;
}

/**
 * @param {unknown} name
 * @returns {string|null} trimmed display name or null when invalid
 */
function cleanName(name) {
  if (typeof name !== 'string') return null;
  const t = name.trim().replace(/\s+/g, ' ');
  return t && t.length <= 80 ? t : null;
}

/**
 * Folder ids of `id` and all its descendants.
 * @param {{id: string, parent_id?: string|null}[]} folders
 * @param {string} id
 * @returns {Set<string>}
 */
function subtreeIds(folders, id) {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (f.parent_id && out.has(f.parent_id) && !out.has(f.id)) { out.add(f.id); grew = true; }
    }
  }
  return out;
}

module.exports = {
  TRANSCRIPT_NAME_RE, ID_RE, isValidTranscriptName, slugify, warsawParts, folderNameFor, meetingDate,
  buildMeetingFiles, applyUserMetaEdit, newId, cleanName, subtreeIds,
};
