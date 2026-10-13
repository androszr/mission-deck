'use strict';
// modules/meeting-archive/server/meetings-lib.js
// Pure helpers that turn the three JSON files of a meeting folder into one list
// item.

const fs = require('fs');
const path = require('path');

/**
 * Parsed JSON or null on ANY error (missing file, bad JSON).
 * @param {string} file
 * @returns {any|null}
 */
function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Markdown out of a summary.md that may be a JSON wrapper (fenced, bare, or
 * invalid JSON with literal newlines inside the string value).
 * @param {string} raw
 * @returns {string}
 */
function extractSummaryMd(raw) {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  const candidate = fenceMatch
    ? fenceMatch[1].trim()
    : trimmed.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/, '$1').trim() || trimmed;
  if (candidate.startsWith('{')) {
    try {
      const p = JSON.parse(candidate);
      return p.summary_md || p.summary || raw;
    } catch { /* fall through to the regex */ }
    const m = candidate.match(/"summary_md"\s*:\s*"([\s\S]+)"\s*\n?\}/);
    if (m) {
      return m[1]
        .replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r')
        .replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
  }
  return raw;
}

/**
 * {brief, title} out of a brief that may be a fenced / bare JSON object.
 * @param {string} raw
 * @returns {{brief: string, title: string}}
 */
function parseBriefMeta(raw) {
  if (!raw) return { brief: '', title: '' };
  const trimmed = String(raw).trim();
  const fenced = trimmed.match(/```(?:json)?\s*\n([\s\S]+?)\n?```/);
  if (fenced) {
    try {
      const p = JSON.parse(fenced[1]);
      return { brief: String(p.brief || '').trim(), title: String(p.title || '').trim() };
    } catch { /* fall through */ }
  }
  if (trimmed.startsWith('{') || trimmed.startsWith('json{')) {
    try {
      const p = JSON.parse(trimmed.replace(/^json\s*/, ''));
      return { brief: String(p.brief || '').trim(), title: String(p.title || '').trim() };
    } catch { /* fall through */ }
  }
  const candidate = fenced ? fenced[1] : trimmed;
  const titleMatch = candidate.match(/"title"\s*:\s*"([^"\n\r]+)"/);
  const briefMatch = candidate.match(/"brief"\s*:\s*"([\s\S]+)"\s*\}/);
  const titleVal = titleMatch ? titleMatch[1].trim() : '';
  const briefVal = briefMatch ? briefMatch[1].trim() : '';
  if (titleVal || briefVal) return { brief: briefVal, title: titleVal };
  return { brief: trimmed, title: '' };
}

/**
 * First YYYY-MM-DD in a folder name, or ''.
 * @param {string} folder
 * @returns {string}
 */
function folderDate(folder) {
  const m = /\d{4}-\d{2}-\d{2}/.exec(String(folder || ''));
  return m ? m[0] : '';
}

/**
 * Readable title from a folder name: date/time prefix or "manual-" dropped.
 * @param {string} folder
 * @returns {string}
 */
function humaniseSlug(folder) {
  let s = String(folder || '');
  s = s.replace(/^manual-\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2}(?:-\d{2})?)?/, '')
    .replace(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}_?/, '');
  s = s.replace(/[-_]+/g, ' ').trim();
  return s || String(folder || '');
}

/**
 * userMeta.custom_title > metadata.custom_title > info.title > brief title > slug.
 * @param {{userMeta?: object, metadata?: object, info?: object, folder?: string}} src
 * @returns {string}
 */
function resolveTitle({ userMeta, metadata, info, folder } = {}) {
  const um = userMeta || {};
  const md = metadata || {};
  const inf = info || {};
  const pick = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');
  return pick(um.custom_title)
    || pick(md.custom_title)
    || pick(inf.title)
    || pick(parseBriefMeta(inf.brief).title)
    || humaniseSlug(folder);
}

/**
 * userMeta.meeting_date > metadata.meeting_date > folder date > processed_at.
 * @param {{userMeta?: object, metadata?: object, folder?: string}} src
 * @returns {string}
 */
function resolveDate({ userMeta, metadata, folder } = {}) {
  const um = userMeta || {};
  const md = metadata || {};
  const day = (v) => {
    const m = typeof v === 'string' ? /\d{4}-\d{2}-\d{2}/.exec(v) : null;
    return m ? m[0] : '';
  };
  return day(um.meeting_date) || day(md.meeting_date) || folderDate(folder)
    || day(md.processed_at) || day(md.created_at) || '';
}

/**
 * Which HTML renderings exist in a folder.
 * @param {string} dir
 * @returns {string[]} subset of ['summary', 'report']
 */
function htmlKinds(dir) {
  const out = [];
  if (fs.existsSync(path.join(dir, 'summary.html'))) out.push('summary');
  if (fs.existsSync(path.join(dir, 'report.html'))) out.push('report');
  return out;
}

/**
 * One list row.
 * @param {{folder: string, metadata?: object, info?: object, userMeta?: object, dir: string}} src
 * @returns {object}
 */
function buildListItem({ folder, metadata, info, userMeta, dir }) {
  const md = metadata || {};
  const inf = info || {};
  const um = userMeta || {};
  const participants = Array.isArray(inf.participants)
    ? inf.participants
      .filter((p) => p && typeof p.name === 'string' && p.name.trim())
      .map((p) => ({ name: p.name.trim(), memberId: p.member_id || null }))
    : [];
  const rawBrief = typeof inf.brief === 'string' ? inf.brief : '';
  return {
    folder,
    title: resolveTitle({ userMeta: um, metadata: md, info: inf, folder }),
    date: resolveDate({ userMeta: um, metadata: md, folder }),
    status: md.status === 'error' ? 'error' : 'ok',
    isManual: !!md.is_manual,
    errorReason: md.status === 'error' ? String(md.errorReason || '') : '',
    categoryIds: Array.isArray(um.categories) ? um.categories.filter((c) => typeof c === 'string') : [],
    folderId: typeof um.virtual_folder_id === 'string' && um.virtual_folder_id ? um.virtual_folder_id : null,
    participants,
    brief: parseBriefMeta(rawBrief).brief || rawBrief,
    durationSec: Number(md.duration_sec) > 0 ? Number(md.duration_sec) : 0,
    hasTranscript: !!md.has_transcript,
    htmlKinds: dir ? htmlKinds(dir) : [],
    autoFolder: um.auto_folder && typeof um.auto_folder === 'object'
      ? { by: String(um.auto_folder.by || ''), reason: String(um.auto_folder.reason || '') } : null,
  };
}

const LOGO_PLACEHOLDER = '__REPORT_LOGO_SRC__';

/**
 * First data:image/png URI of the report template, or '' when not found.
 * @param {string} templateHtml
 * @returns {string}
 */
function extractLogoDataUri(templateHtml) {
  const m = /src="(data:image\/png;base64,[A-Za-z0-9+/=]+)"/.exec(String(templateHtml || ''));
  return m ? m[1] : '';
}

/**
 * Replace the unfilled logo placeholder of the old generator. No logo -> unchanged.
 * @param {string} html
 * @param {string} logoUri
 * @returns {string}
 */
function fillLogoPlaceholder(html, logoUri) {
  const s = String(html === null || html === undefined ? '' : html);
  if (!logoUri || !s.includes(LOGO_PLACEHOLDER)) return s;
  return s.split(LOGO_PLACEHOLDER).join(logoUri);
}

module.exports = {
  extractLogoDataUri, fillLogoPlaceholder,
  readJsonSafe, extractSummaryMd, parseBriefMeta, folderDate, humaniseSlug,
  resolveTitle, resolveDate, htmlKinds, buildListItem,
};
