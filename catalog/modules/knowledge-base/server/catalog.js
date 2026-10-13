'use strict';
// modules/knowledge-base/server/catalog.js
// Pure, synchronous scan of the knowledge base directory. READ ONLY: no write, no lock,
// no process spawn anywhere in this module's server code.

const fs = require('fs');
const path = require('path');

const MAX_FILES = 500;
const MAX_FILE_BYTES = 256 * 1024;
const SKIPPED_ROOT_DIRS = ['meetings', 'sql'];

const REL_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]*(\/[A-Za-z0-9_][A-Za-z0-9._-]*)*\.(md|html)$/;

// Directory-name aliases folded onto one category id.
const CATEGORY_MAP = {
  requirements: 'business-requirements',
  interview: 'interviews',
  meeting: 'meetings',
  note: 'notes',
  estimate: 'estimates',
  _general: 'general',
};
const CATEGORY_PASS = new Set([
  'research', 'interviews', 'ux-brief', 'notes', 'as-is', 'estimates', 'workshop',
  'data-analysis', 'general', 'other', 'business-requirements', 'meetings',
]);

function unquote(v) {
  let s = String(v).trim();
  if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
    s = s.slice(1, -1);
  }
  return s;
}

/**
 * @param {string} text
 * @returns {{ fields: Object<string, string|string[]>, body: string }}
 */
function parseFrontmatter(text) {
  const src = String(text === null || text === undefined ? '' : text).replace(/^﻿/, '');
  const lines = src.split(/\r?\n/);
  if (lines[0] !== '---') return { fields: {}, body: src };
  const end = lines.indexOf('---', 1);
  if (end < 0) return { fields: {}, body: src };
  const fields = {};
  for (const line of lines.slice(1, end)) {
    const m = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const raw = m[2].trim();
    if (raw.startsWith('[') && raw.endsWith(']')) {
      const inner = raw.slice(1, -1).trim();
      fields[m[1]] = inner ? inner.split(',').map(unquote).filter(Boolean) : [];
    } else {
      fields[m[1]] = unquote(raw);
    }
  }
  return { fields, body: lines.slice(end + 1).join('\n').replace(/^\n+/, '') };
}

/** @param {string} dirName */
function normalizeCategory(dirName) {
  const d = String(dirName || '');
  if (Object.prototype.hasOwnProperty.call(CATEGORY_MAP, d)) return CATEGORY_MAP[d];
  return CATEGORY_PASS.has(d) ? d : 'other';
}

/**
 * @param {string} relPath posix path relative to the hub dir
 * @param {Array<{slug:string, subareas?:Array<{slug:string}>}>} areas
 * @returns {{ area: string, subArea: string|null, category: string }}
 */
function classifyPath(relPath, areas) {
  const seg = String(relPath).split('/');
  const area = seg[0];
  const dirs = seg.slice(0, -1);
  if (dirs.length < 2) return { area, subArea: null, category: 'other' };
  const def = (areas || []).find((a) => a && a.slug === area);
  const isSub = !!(def && Array.isArray(def.subareas) && def.subareas.some((s) => s && s.slug === seg[1]));
  if (isSub && dirs.length >= 3) {
    return { area, subArea: seg[1], category: normalizeCategory(seg[2]) };
  }
  return { area, subArea: null, category: normalizeCategory(seg[1]) };
}

/**
 * Absolute path of an article/report, or null when the guard refuses it.
 * @param {string} hubDir
 * @param {string} rel
 * @returns {string|null}
 */
function resolveArticlePath(hubDir, rel) {
  if (typeof rel !== 'string' || !REL_RE.test(rel)) return null;
  const segs = rel.split('/');
  if (segs.some((s) => s === '..' || s.startsWith('.'))) return null;
  if (SKIPPED_ROOT_DIRS.includes(segs[0])) return null;
  if (rel.endsWith('.refresh-pending.md')) return null;
  const root = path.resolve(hubDir);
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(root + path.sep)) return null;
  try {
    if (fs.existsSync(abs)) {
      const real = fs.realpathSync(abs);
      const realRoot = fs.realpathSync(root);
      if (!real.startsWith(realRoot + path.sep)) return null;
    }
  } catch {
    return null;
  }
  return abs;
}

/** @param {string} hubDir */
function readAreas(hubDir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(hubDir, 'knowledge-base-areas.json'), 'utf8'));
    return Array.isArray(j && j.areas) ? j.areas : [];
  } catch {
    return [];
  }
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * @param {string} hubDir
 * @param {{ maxFiles?: number }} [opts]
 */
function scanCatalog(hubDir, opts) {
  const maxFiles = (opts && opts.maxFiles) || MAX_FILES;
  const areas = readAreas(hubDir);
  const skipped = { tooLarge: 0, overCap: 0, badName: 0 };
  const articles = [];
  let count = 0;

  function walk(absDir, relDir) {
    let entries;
    try { entries = fs.readdirSync(absDir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const rel = relDir ? relDir + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (!relDir && SKIPPED_ROOT_DIRS.includes(e.name)) continue;
        if (e.name === 'assets') continue;
        walk(path.join(absDir, e.name), rel);
        continue;
      }
      if (!e.isFile() || !e.name.endsWith('.md')) continue;
      if (e.name.endsWith('.refresh-pending.md')) continue;
      if (!relDir) continue; // a file at the repo root is not an article
      const abs = resolveArticlePath(hubDir, rel);
      if (!abs) { skipped.badName++; continue; }
      let st;
      try { st = fs.statSync(abs); } catch { continue; }
      if (st.size > MAX_FILE_BYTES) { skipped.tooLarge++; continue; }
      if (count >= maxFiles) { skipped.overCap++; continue; }
      let text;
      try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
      count++;
      const { fields } = parseFrontmatter(text);
      const cls = classifyPath(rel, areas);
      const pages = arr(fields.confluence_source_pages).slice();
      if (fields.confluence_page_id && !pages.includes(String(fields.confluence_page_id))) {
        pages.push(String(fields.confluence_page_id));
      }
      articles.push({
        path: rel,
        title: fields.title || e.name.replace(/\.md$/, ''),
        summary: typeof fields.summary === 'string' ? fields.summary : '',
        date: fields.date || '',
        updated: fields.updated || '',
        author: fields.author || '',
        status: fields.status || '',
        type: fields.type || '',
        area: cls.area,
        subArea: cls.subArea,
        category: cls.category,
        hasHtml: fs.existsSync(abs.replace(/\.md$/, '.html')),
        confluencePages: pages,
        confluenceVersion: fields.confluence_version || '',
        size: st.size,
      });
    }
  }

  walk(path.resolve(hubDir), '');
  articles.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
  });
  return { areas, articles, skipped };
}

module.exports = {
  MAX_FILES, MAX_FILE_BYTES, SKIPPED_ROOT_DIRS,
  parseFrontmatter, normalizeCategory, classifyPath, resolveArticlePath, scanCatalog, readAreas,
};
