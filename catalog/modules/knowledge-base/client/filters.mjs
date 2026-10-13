// modules/knowledge-base/client/filters.mjs
// Pure helpers for the list: document types, search normalisation, filtering,
// sorting, area options. No browser globals, importable in plain Node.

export const DOC_TYPES = [
  { id: '', label: 'All', categories: [] },
  { id: 'interviews', label: 'Interviews', categories: ['interviews'] },
  { id: 'meetings', label: 'Meetings', categories: ['meetings', 'workshop'] },
  { id: 'research', label: 'Research', categories: ['research'] },
  { id: 'data-analysis', label: 'Data analysis', categories: ['data-analysis'] },
  { id: 'ux-brief', label: 'UX brief', categories: ['ux-brief'] },
  { id: 'notes', label: 'Notes', categories: ['notes'] },
  { id: 'as-is', label: 'AS-IS', categories: ['as-is'] },
  { id: 'business-requirements', label: 'Business req.', categories: ['business-requirements'] },
  { id: 'estimates', label: 'Estimates', categories: ['estimates'] },
  { id: 'general', label: 'General', categories: ['general'] },
];

const CATEGORY_LABELS = {
  interviews: 'Interview',
  research: 'Research',
  meetings: 'Meeting',
  workshop: 'Workshop',
  'business-requirements': 'Business requirements',
  'ux-brief': 'UX brief',
  'data-analysis': 'Data analysis',
  notes: 'Notes',
  'as-is': 'AS-IS',
  estimates: 'Estimate',
  general: 'General',
  other: 'Other',
};

export function categoryLabel(category) {
  return CATEGORY_LABELS[category] || CATEGORY_LABELS.other;
}

export function docTypeOf(category) {
  const t = DOC_TYPES.find((d) => d.id && d.categories.includes(category));
  return t ? t.id : '';
}

// Case- and accent-insensitive: "resume" also finds the accented spelling. The l-stroke has no
// NFD decomposition, so it is folded by hand.
export function normalizeSearch(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/\u0142/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function filterArticles(list, filters) {
  const f = filters || {};
  const type = DOC_TYPES.find((d) => d.id === (f.docType || ''));
  const q = normalizeSearch(f.search);
  return (list || []).filter((a) => {
    if (f.area && a.area !== f.area) return false;
    if (f.subArea && a.subArea !== f.subArea) return false;
    if (type && type.id && !type.categories.includes(a.category)) return false;
    if (q && !normalizeSearch((a.title || '') + ' ' + (a.summary || '')).includes(q)) return false;
    return true;
  });
}

export function sortArticles(list, sort) {
  const out = (list || []).slice();
  if (sort === 'title-asc') {
    out.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'en'));
  } else {
    out.sort((a, b) => {
      const da = a.date || '';
      const db = b.date || '';
      if (da !== db) {
        if (!da) return 1;
        if (!db) return -1;
        return da < db ? 1 : -1;
      }
      return String(a.title || '').localeCompare(String(b.title || ''), 'en');
    });
  }
  return out;
}

export function areaOptions(areas, articles) {
  const out = [];
  const seen = new Set();
  for (const a of areas || []) {
    if (!a || !a.slug || seen.has(a.slug)) continue;
    seen.add(a.slug);
    out.push({ slug: a.slug, label: a.label || a.slug, subareas: Array.isArray(a.subareas) ? a.subareas : [] });
  }
  for (const art of articles || []) {
    if (art.area && !seen.has(art.area)) {
      seen.add(art.area);
      out.push({ slug: art.area, label: art.area, subareas: [] });
    }
  }
  return out;
}

// Display label for an area / sub-area name. A seam for label fixes; today
// every label passes through as written in knowledge-base-areas.json.
export function displayLabel(label) {
  return String(label == null ? '' : label);
}

function passSearch(a, q) {
  return !q || normalizeSearch((a.title || '') + ' ' + (a.summary || '')).includes(q);
}

function typeOk(a, docType) {
  const t = DOC_TYPES.find((d) => d.id === (docType || ''));
  return !t || !t.id || t.categories.includes(a.category);
}

// Counts: area counts respect search + type, type counts
// respect area + sub-area + search, sub-area counts respect search + type.
export function segmentCounts(articles, f) {
  const list = articles || [];
  const q = normalizeSearch(f.search);
  const area = {};
  for (const a of list) {
    if (a.area && passSearch(a, q) && typeOk(a, f.docType)) area[a.area] = (area[a.area] || 0) + 1;
  }
  const base = list.filter((a) => (!f.area || a.area === f.area) && (!f.subArea || a.subArea === f.subArea) && passSearch(a, q));
  const type = { '': base.length };
  for (const d of DOC_TYPES) {
    if (d.id) type[d.id] = base.filter((a) => d.categories.includes(a.category)).length;
  }
  const sub = {};
  let subAll = 0;
  for (const a of list) {
    if (a.area !== f.area || !passSearch(a, q) || !typeOk(a, f.docType)) continue;
    subAll += 1;
    if (a.subArea) sub[a.subArea] = (sub[a.subArea] || 0) + 1;
  }
  sub[''] = subAll;
  return { area, type, sub };
}

// True when the document has Confluence sources (drives the Confluence tab).
export function hasConfluence(detail) {
  const d = detail || {};
  if (Array.isArray(d.confluencePages) && d.confluencePages.length > 0) return true;
  const f = d.frontmatter || {};
  return (Array.isArray(f.confluence_source_pages) && f.confluence_source_pages.length > 0) || !!f.confluence_page_id;
}

// Breadcrumb model shared by list and detail. Each crumb is
// { label, area, subArea, current }. Non-current crumbs carry the filter they apply.
// `title` (detail only) becomes the current crumb; without it the deepest filter is current.
export function buildCrumbs(areas, filters, title) {
  const f = filters || {};
  const out = [{ label: 'Knowledge base', area: '', subArea: '', current: false }];
  const cur = (areas || []).find((a) => a.slug === f.area);
  if (f.area) {
    out.push({ label: displayLabel(cur ? cur.label : f.area), area: f.area, subArea: '', current: false });
    if (f.subArea) {
      const sub = cur && (cur.subareas || []).find((x) => x.slug === f.subArea);
      out.push({ label: displayLabel(sub ? sub.label : f.subArea), area: f.area, subArea: f.subArea, current: false });
    }
  }
  if (title) out.push({ label: String(title), area: f.area || '', subArea: '', current: true });
  else out[out.length - 1].current = true;
  return out;
}
