'use strict';
// modules/knowledge-base/server/index.js
// Read-only browser of the knowledge base (data-tier-0, knowledge-base/).
// Four GET routes under /api/m/knowledge-base/ : /list, /article?path=,
// /file?path=, /widget (the dashboard tile: newest 5 + counts, memoised, no
// bodies). Nothing here writes, locks or spawns; meetings/ belongs to the
// meeting-archive module.

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const catalog = require('./catalog');

const WIDGET_LIMIT = 5;
const WIDGET_MONTHS = 4;
const WIDGET_TTL_MS = 60 * 1000;

const UNAVAILABLE_MESSAGE = 'No knowledge base on this computer. Fetch the team data (data-tier-0) in the Sync window and add documents under knowledge-base/.';

module.exports = function register(ctx) {
  function relFrom(req) {
    const u = new URL(req.url, 'http://localhost');
    return { rel: u.searchParams.get('path') || '', download: u.searchParams.get('download') === '1' };
  }

  function handleList(_req, res) {
    if (paths.storageState(ctx.rootDir) !== 'ok') {
      return ctx.jsonResponse(res, 200, {
        storage: 'unavailable', areas: [], articles: [], message: UNAVAILABLE_MESSAGE,
      });
    }
    const scan = catalog.scanCatalog(paths.hubDir(ctx.rootDir));
    return ctx.jsonResponse(res, 200, {
      storage: 'ok', areas: scan.areas, articles: scan.articles, skipped: scan.skipped,
      scannedAt: new Date().toISOString(),
    });
  }

  // -- GET /widget -------------------------------------------------------------
  // The dashboard tile: the 5 newest articles, the total, a per-type split and
  // new documents per month. No bodies, no summaries. The scan (hundreds of files) is
  // memoised on a cheap signature (mtimes of the repo root, the areas file and
  // the area directories) plus a 60 s TTL, because a nested edit does not move
  // the root mtime. Read-only: no lock, no write, no child process.
  let widgetMemo = null;

  function mtimeOf(p) {
    try { return fs.statSync(p).mtimeMs; } catch { return 0; }
  }

  function widgetSignature(dir, monthKey) {
    const parts = [monthKey, mtimeOf(dir), mtimeOf(path.join(dir, 'knowledge-base-areas.json'))];
    try {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory() && !e.name.startsWith('.')) parts.push(e.name + ':' + mtimeOf(path.join(dir, e.name)));
      }
    } catch { /* unreadable root: the signature stays short */ }
    return parts.join('|');
  }

  function buildWidget(dir, now) {
    const scan = catalog.scanCatalog(dir);
    const arts = scan.articles;
    // Per path-derived category, the same key the module's own "Document type"
    // filter counts (client/filters.mjs docTypeOf); the client maps it to a label.
    const byCat = new Map();
    for (const a of arts) byCat.set(a.category || 'other', (byCat.get(a.category || 'other') || 0) + 1);
    const categories = Array.from(byCat.entries())
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([category, count]) => ({ category, count }));
    const months = [];
    for (let i = WIDGET_MONTHS - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), month: d.getMonth() + 1, count: 0 });
    }
    for (const a of arts) {
      const m = months.find((x) => String(a.date).startsWith(x.key));
      if (m) m.count++;
    }
    return {
      storage: 'ok',
      total: arts.length,
      newThisMonth: months[months.length - 1].count,
      articles: arts.slice(0, WIDGET_LIMIT).map((a) => ({
        path: a.path, title: a.title, area: a.area || '', type: a.type || '', date: a.date ? String(a.date) : '', author: a.author ? String(a.author) : '',
      })),
      categories,
      months: months.map((m) => ({ key: m.key, month: m.month, count: m.count })),
    };
  }

  function handleWidget(_req, res) {
    if (paths.storageState(ctx.rootDir) !== 'ok') {
      return ctx.jsonResponse(res, 200, { storage: 'unavailable', total: 0, articles: [], categories: [], months: [] });
    }
    const dir = paths.hubDir(ctx.rootDir);
    const now = new Date();
    const sig = widgetSignature(dir, now.getFullYear() + '-' + now.getMonth());
    if (!widgetMemo || widgetMemo.sig !== sig || Date.now() - widgetMemo.at > WIDGET_TTL_MS) {
      widgetMemo = { sig, at: Date.now(), body: buildWidget(dir, now) };
    }
    return ctx.jsonResponse(res, 200, widgetMemo.body);
  }

  /** Shared guard: returns { abs } or answers the error itself and returns null. */
  function guarded(req, res, allowHtml) {
    const { rel } = relFrom(req);
    const dir = paths.hubDir(ctx.rootDir);
    const abs = catalog.resolveArticlePath(dir, rel);
    if (!abs || (!allowHtml && !rel.endsWith('.md'))) {
      ctx.jsonResponse(res, 400, { error: 'bad-path' });
      return null;
    }
    let st;
    try { st = fs.statSync(abs); } catch { st = null; }
    if (!st || !st.isFile()) {
      ctx.jsonResponse(res, 404, { error: 'not-found' });
      return null;
    }
    if (st.size > catalog.MAX_FILE_BYTES) {
      ctx.jsonResponse(res, 413, { error: 'too-large' });
      return null;
    }
    return { abs, rel };
  }

  function handleArticle(req, res) {
    if (paths.storageState(ctx.rootDir) !== 'ok') {
      return ctx.jsonResponse(res, 200, { storage: 'unavailable', message: UNAVAILABLE_MESSAGE });
    }
    const g = guarded(req, res, false);
    if (!g) return undefined;
    const text = fs.readFileSync(g.abs, 'utf8');
    const { fields, body } = catalog.parseFrontmatter(text);
    const areas = catalog.readAreas(paths.hubDir(ctx.rootDir));
    const cls = catalog.classifyPath(g.rel, areas);
    const htmlRel = g.rel.replace(/\.md$/, '.html');
    const hasHtml = fs.existsSync(g.abs.replace(/\.md$/, '.html'));
    const pages = Array.isArray(fields.confluence_source_pages) ? fields.confluence_source_pages.slice() : [];
    if (fields.confluence_page_id && !pages.includes(String(fields.confluence_page_id))) {
      pages.push(String(fields.confluence_page_id));
    }
    return ctx.jsonResponse(res, 200, {
      storage: 'ok',
      path: g.rel,
      title: fields.title || path.basename(g.rel, '.md'),
      frontmatter: fields,
      body,
      hasHtml,
      htmlPath: hasHtml ? htmlRel : null,
      area: cls.area,
      subArea: cls.subArea,
      category: cls.category,
      confluencePages: pages,
      confluenceVersion: fields.confluence_version || '',
    });
  }

  function handleFile(req, res) {
    if (paths.storageState(ctx.rootDir) !== 'ok') {
      return ctx.jsonResponse(res, 200, { storage: 'unavailable', message: UNAVAILABLE_MESSAGE });
    }
    const g = guarded(req, res, true);
    if (!g) return undefined;
    const { download } = relFrom(req);
    const buf = fs.readFileSync(g.abs);
    const isHtml = g.rel.endsWith('.html');
    const headers = {
      'Content-Type': isHtml ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8',
      'Content-Length': buf.length,
      'Cache-Control': 'no-cache',
    };
    if (download) headers['Content-Disposition'] = 'attachment; filename="' + path.basename(g.rel) + '"';
    res.writeHead(200, headers);
    return res.end(buf);
  }

  return {
    routes: [
      { method: 'GET', path: '/list', handler: handleList },
      { method: 'GET', path: '/article', handler: handleArticle },
      { method: 'GET', path: '/file', handler: handleFile },
      { method: 'GET', path: '/widget', handler: handleWidget },
    ],
  };
};
