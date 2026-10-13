'use strict';
// modules/onboarding/server/onboarding-store.js
// Pure functions plus small file I/O helpers used by server/index.js. Kept
// separate from the route handlers so tests/test_onboarding_store.mjs can
// exercise every one of these without a fake ctx or an HTTP layer.
//
// Data layout under ctx.dataTier0Dir/onboarding/:
//   links.json         { links: [{id,title,url,description}], generated_at }
//   template.json      { id:'default', name:'Template', rows:[...], generated_at }
//   people/<slug>.json { id, name, slug, rows:[...], created_at, generated_at }
//
// A plan row is { topic, description, who, when, done? }.
//
// Each write touches exactly one of the three files above - never a monolith
// - so two people editing two different plans never collide on one blob at
// sync time.

const fs = require('fs');
const path = require('path');

const MODULE_SUBDIR = 'onboarding';
const LINKS_FILE = 'links.json';
const TEMPLATE_FILE = 'template.json';
const PERSONS_SUBDIR = 'people';
const MAX_LINKS = 100;
const MAX_ROWS = 200;

const LINK_URL_RE = /^(https?:\/\/|view:\/\/)/i;

// -- Slugs --------------------------------------------------------------
// Same rules as modules/time-off/client/time-off-lib.js:slugify, minus the
// SharePoint "app read|write|access" suffix strip that has no meaning here.

const COMBINING_MARKS_RE = /[\u0300-\u036f]/g;

// Every slug this module hands to personFile ends up in a filesystem path,
// so it must never carry '/', '\', '..' or any other path-meaningful
// character (path traversal via a plan slug). SLUG_RE/isValidSlug is the MINT-time convention: what
// slugify (and therefore every NEW plan) is guaranteed to produce.
const SLUG_RE = /^[a-z0-9-]+$/;

function isValidSlug(slug) {
  return typeof slug === 'string' && SLUG_RE.test(slug);
}

// isPathSafeSegment is the READ-time security boundary, deliberately
// weaker than SLUG_RE: it is what personFile and readPersons enforce on a
// slug that already exists on disk, because that slug may predate this
// guard or may have been minted from a plan name slugify never sees today
// (a name with a parenthesised suffix like the team directory's
// contract codes, an apostrophe). Such a slug is unusual, not dangerous -
// it must stay readable and editable. A slug is unsafe only if it could
// ever resolve outside the single directory a bare filename lives in: no
// path separator of either kind, no NUL, and not literally '.' or '..'.
function isPathSafeSegment(slug) {
  if (typeof slug !== 'string' || !slug) return false;
  if (slug === '.' || slug === '..') return false;
  if (slug.indexOf('/') !== -1 || slug.indexOf('\\') !== -1) return false;
  if (slug.indexOf('\0') !== -1) return false;
  return true;
}

function slugify(name) {
  let s = String(name === null || name === undefined ? '' : name);
  s = s.normalize('NFD');
  s = s.replace(COMBINING_MARKS_RE, '');
  s = s.replace(/[\u0142\u0141]/g, 'l'); // l/L with stroke
  s = s.replace(/[\u0111\u0110]/g, 'd'); // d/D with stroke
  s = s.replace(/[\u00f8\u00d8]/g, 'o'); // o/O with stroke
  s = s.toLowerCase();
  s = s.replace(/[-_\s]+/g, ' ');
  s = s.trim();
  s = s.replace(/\s+/g, '-');
  // Strip everything outside [a-z0-9-] - this is what stops '/', '\' and
  // '..' from a plan name ever reaching a slug.
  // A run of stripped characters collapses to one '-', which is then
  // trimmed from both ends the same way whitespace-derived hyphens are.
  s = s.replace(/[^a-z0-9-]+/g, '-');
  s = s.replace(/-+/g, '-');
  s = s.replace(/^-+|-+$/g, '');
  // A name made entirely of characters outside [a-z0-9-] (or an empty one)
  // must still produce a safe, non-empty slug rather than an empty string
  // that uniqueSlug would have to special-case.
  return s || 'plan';
}

function uniqueSlug(base, taken) {
  const takenSet = taken instanceof Set ? taken : new Set(taken || []);
  let candidate = base || 'plan';
  if (!takenSet.has(candidate)) return candidate;
  let n = 2;
  while (takenSet.has(candidate + '-' + n)) n += 1;
  return candidate + '-' + n;
}

// -- Validation -----------------------------------------------------------

function validateLink(body, opts) {
  const partial = !!(opts && opts.partial);
  const value = {};
  if (!partial || body.title !== undefined) {
    const title = body.title === undefined || body.title === null ? '' : String(body.title).trim();
    if (!title) return { ok: false, error: 'title is required' };
    value.title = title;
  }
  if (!partial || body.url !== undefined) {
    const url = body.url === undefined || body.url === null ? '' : String(body.url).trim();
    if (!url) return { ok: false, error: 'url is required' };
    if (!LINK_URL_RE.test(url)) return { ok: false, error: 'url must start with http://, https:// or view://' };
    value.url = url;
  }
  if (body.description !== undefined) {
    value.description = body.description === null ? '' : String(body.description).trim();
  } else if (!partial) {
    value.description = '';
  }
  return { ok: true, value };
}

function validatePlanName(name) {
  const trimmed = name === undefined || name === null ? '' : String(name).trim();
  if (!trimmed) return { ok: false, error: 'name is required' };
  return { ok: true, value: trimmed };
}

function sanitizeRows(rows) {
  if (!Array.isArray(rows)) return { ok: false, error: 'rows must be an array' };
  if (rows.length > MAX_ROWS) return { ok: false, error: 'row limit exceeded (' + MAX_ROWS + ')' };
  const value = rows.map((r) => {
    const row = r && typeof r === 'object' ? r : {};
    const out = {
      topic: row.topic === undefined || row.topic === null ? '' : String(row.topic),
      description: row.description === undefined || row.description === null ? '' : String(row.description),
      who: row.who === undefined || row.who === null ? '' : String(row.who),
      when: row.when === undefined || row.when === null ? '' : String(row.when),
    };
    if (row.done !== undefined) out.done = !!row.done;
    return out;
  });
  return { ok: true, value };
}

// -- Sorting and copying ----------------------------------------------------

function sortPlans(template, persons) {
  const out = [];
  if (template) out.push(template);
  const sortedPersons = (persons || []).slice().sort((a, b) => {
    const at = a.created_at || '';
    const bt = b.created_at || '';
    if (at !== bt) return at < bt ? -1 : 1;
    return String(a.name || '').localeCompare(String(b.name || ''), 'en');
  });
  return out.concat(sortedPersons);
}

function copyTemplate(template, name, slug, nowIso) {
  const rows = template && Array.isArray(template.rows) ? JSON.parse(JSON.stringify(template.rows)) : [];
  return {
    id: 'plan-' + Date.now(),
    name,
    slug,
    rows,
    created_at: nowIso,
    generated_at: nowIso,
  };
}

// -- File I/O -----------------------------------------------------------

function readJson(file, onError) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e && e.code !== 'ENOENT' && typeof onError === 'function') onError(e);
    return null;
  }
}

function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

function moduleDirFor(dataTier0Dir) {
  return path.join(dataTier0Dir, MODULE_SUBDIR);
}

function linksFile(dataTier0Dir) {
  return path.join(moduleDirFor(dataTier0Dir), LINKS_FILE);
}

function templateFile(dataTier0Dir) {
  return path.join(moduleDirFor(dataTier0Dir), TEMPLATE_FILE);
}

function personsDir(dataTier0Dir) {
  return path.join(moduleDirFor(dataTier0Dir), PERSONS_SUBDIR);
}

// Throws rather than returning a path outside people/ - every caller (the
// route handlers in index.js) must let this
// propagate into its existing try/catch, which already answers
// write-failed. Deliberately gated on isPathSafeSegment, not the stricter
// isValidSlug: a NEW plan's slug always comes from slugify + uniqueSlug and
// already satisfies both, but an EXISTING shard's slug (existing.slug from
// readPersons, in handlePlansUpdate/handlePlansDelete) may be unusual
// without being dangerous, and this must stay the one gate that decides
// dangerous vs merely unusual. The resolve check is belt-and-braces for the
// case isPathSafeSegment's own rules are ever loosened by mistake.
function personFile(dataTier0Dir, slug) {
  return personFileIn(personsDir(dataTier0Dir), slug);
}

// The same gate keyed on the people/ directory itself rather than on the
// data-tier-0 root - for callers that already hold that directory.
// Every shard path in this module comes out of here, so the containment
// assert is the one place a future slugify change would have to get past.
function personFileIn(personsDirPath, slug) {
  if (!isPathSafeSegment(slug)) {
    throw new Error('onboarding: invalid plan slug: ' + JSON.stringify(slug));
  }
  const file = path.join(personsDirPath, slug + '.json');
  const resolvedDirWithSep = path.resolve(personsDirPath) + path.sep;
  const resolvedFile = path.resolve(file);
  if (!resolvedFile.startsWith(resolvedDirWithSep)) {
    throw new Error('onboarding: slug escapes the people directory: ' + JSON.stringify(slug));
  }
  return file;
}

// The set of slugs a NEW plan must not collide with. Read straight off the
// people/ directory listing rather than through readPersons: a shard that
// readPersons will go on to skip (a corrupted file, or historically an
// unsafe slug) still occupies a real file name on disk, and a new plan
// minting that same slug would silently overwrite it on the next write.
function listPersonFileSlugs(dataTier0Dir) {
  let files = [];
  try {
    files = fs.readdirSync(personsDir(dataTier0Dir)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return files.map((f) => f.slice(0, -'.json'.length));
}

function readLinks(dataTier0Dir, log) {
  const data = readJson(linksFile(dataTier0Dir), (e) => {
    if (typeof log === 'function') log('onboarding: corrupt links.json, treating it as empty:', e.message);
  });
  if (!data || !Array.isArray(data.links)) return { links: [], generated_at: null };
  return { links: data.links, generated_at: data.generated_at || null };
}

function readTemplate(dataTier0Dir, log) {
  const data = readJson(templateFile(dataTier0Dir), (e) => {
    if (typeof log === 'function') log('onboarding: corrupt template.json, treating it as missing:', e.message);
  });
  if (!data || typeof data !== 'object') return null;
  return data;
}

// Returns the list of person-plan shards, sorted by file name for a stable
// read order. One broken shard is logged and skipped - it must never take
// down the whole GET /plans.
function readPersons(dataTier0Dir, log) {
  let files = [];
  try {
    files = fs.readdirSync(personsDir(dataTier0Dir)).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const file of files.sort()) {
    const full = path.join(personsDir(dataTier0Dir), file);
    const data = readJson(full, (e) => {
      if (typeof log === 'function') log('onboarding: corrupt shard, skipping:', full, e.message);
    });
    // A shard whose slug fails isPathSafeSegment (a traversal payload, a
    // corrupted file, a file synced in from another machine) must never
    // reach existing.slug in PUT/DELETE - that string is what
    // handlePlansUpdate/handlePlansDelete feed straight into personFile, so
    // it is rejected here, at the one place every route reads shards
    // through. Deliberately the weaker check, not isValidSlug: a slug that
    // merely looks unusual (a parenthesised suffix, an apostrophe) must
    // stay visible and editable - only a slug that could escape people/ is
    // dropped.
    if (!data || typeof data !== 'object' || typeof data.id !== 'string' || typeof data.slug !== 'string' || !isPathSafeSegment(data.slug)) {
      if (data && typeof log === 'function') log('onboarding: shard has an unexpected shape, skipping:', full);
      continue;
    }
    out.push(data);
  }
  return out;
}

module.exports = {
  MODULE_SUBDIR,
  LINKS_FILE,
  TEMPLATE_FILE,
  PERSONS_SUBDIR,
  MAX_LINKS,
  MAX_ROWS,
  LINK_URL_RE,
  SLUG_RE,
  isValidSlug,
  isPathSafeSegment,
  listPersonFileSlugs,
  slugify,
  uniqueSlug,
  validateLink,
  validatePlanName,
  sanitizeRows,
  sortPlans,
  copyTemplate,
  readJson,
  writeJsonAtomic,
  moduleDirFor,
  linksFile,
  templateFile,
  personsDir,
  personFile,
  personFileIn,
  readLinks,
  readTemplate,
  readPersons,
};
