// modules/meeting-archive/client/list-helpers.mjs
// Pure helpers for the list and the detail. No document access, no fetch.

/**
 * Lower-case, diacritics stripped. The l-stroke (U+0142) does not decompose
 * under NFD, so it is mapped by hand.
 * @param {unknown} s
 * @returns {string}
 */
export function normaliseSearch(s) {
  return String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0142/g, 'l').replace(/\u0141/g, 'L')
    .toLowerCase()
    .trim();
}

/**
 * @param {object[]} meetings
 * @param {{query?: string, categoryId?: string, categoriesById?: Record<string, {name: string}>}} f
 * @returns {object[]}
 */
export function filterMeetings(meetings, { query, categoryId, categoriesById } = {}) {
  const q = normaliseSearch(query);
  const byId = categoriesById || {};
  return (meetings || []).filter((m) => {
    if (categoryId && !(m.categoryIds || []).includes(categoryId)) return false;
    if (!q) return true;
    const hay = normaliseSearch([
      m.title,
      m.brief,
      ...(m.participants || []).map((p) => p.name),
      ...(m.categoryIds || []).map((id) => (byId[id] && byId[id].name) || ''),
    ].join(' '));
    return hay.includes(q);
  });
}

/**
 * Direct sub-folders of parentId (null = root), sorted by order then name.
 * @param {object[]} folders
 * @param {string|null} parentId
 * @returns {object[]}
 */
export function childrenOf(folders, parentId) {
  const pid = parentId || null;
  return (folders || [])
    .filter((f) => (f.parentId || null) === pid)
    .sort((a, b) => (a.order - b.order) || String(a.name).localeCompare(String(b.name), 'en'));
}

/**
 * Path from the root to folderId, as [{id, name}].
 * @param {object[]} folders
 * @param {string|null} folderId
 * @returns {{id: string, name: string}[]}
 */
export function breadcrumbFor(folders, folderId) {
  const byId = new Map((folders || []).map((f) => [f.id, f]));
  const out = [];
  const seen = new Set();
  let cur = folderId ? byId.get(folderId) : null;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift({ id: cur.id, name: cur.name });
    cur = cur.parentId ? byId.get(cur.parentId) : null;
  }
  return out;
}

/**
 * Meetings that sit directly in folderId (null = no folder at all).
 * A folderId that no folder in the tree knows lands at the root.
 * @param {object[]} meetings
 * @param {object[]} folders
 * @param {string|null} folderId
 * @returns {object[]}
 */
export function meetingsIn(meetings, folders, folderId) {
  const known = new Set((folders || []).map((f) => f.id));
  const want = folderId || null;
  return (meetings || []).filter((m) => {
    const own = m.folderId && known.has(m.folderId) ? m.folderId : null;
    return own === want;
  });
}

/**
 * Number of meetings in a folder including every sub-folder.
 * @param {object[]} meetings
 * @param {object[]} folders
 * @param {string} folderId
 * @returns {number}
 */
export function countDeep(meetings, folders, folderId) {
  let n = meetingsIn(meetings, folders, folderId).length;
  for (const c of childrenOf(folders, folderId)) n += countDeep(meetings, folders, c.id);
  return n;
}

/**
 * Consecutive segments of one speaker become one block. Input is not mutated.
 * @param {{speaker_id?: string, start?: number, text?: string}[]} segments
 * @returns {{speaker: string, start: number, texts: string[]}[]}
 */
export function groupTranscript(segments) {
  const sorted = [...(segments || [])].sort((a, b) => (a.start || 0) - (b.start || 0));
  const blocks = [];
  for (const s of sorted) {
    const text = String(s.text || '').trim();
    if (!text) continue;
    const speaker = String(s.speaker_id == null ? '' : s.speaker_id);
    const last = blocks[blocks.length - 1];
    if (last && last.speaker === speaker) last.texts.push(text);
    else blocks.push({ speaker, start: s.start || 0, texts: [text] });
  }
  return blocks;
}

/**
 * Real names stay; speaker_N / person N / SPEAKER_00 shapes become "Speaker N".
 * @param {string} id
 * @param {number} [index] fallback number when the id carries none
 * @returns {string}
 */
export function speakerLabel(id, index) {
  const raw = String(id == null ? '' : id).trim();
  const m = /^(?:speaker|person)[\s_-]*(\d+)$/i.exec(raw);
  if (m) return 'Speaker ' + Number(m[1]);
  if (!raw) return 'Speaker ' + ((index || 0) + 1);
  return raw;
}

/**
 * Seconds as m:ss or h:mm:ss.
 * @param {number} sec
 * @returns {string}
 */
export function tsLabel(sec) {
  const t = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? h + ':' + String(m).padStart(2, '0') + ':' + ss : m + ':' + ss;
}

/**
 * Crumb items for the shared navigation row. Root first, then the folder trail,
 * then (detail only) the meeting title as the current crumb. Exactly one item
 * is current: the title when given, otherwise the last of the trail.
 * @param {object[]} folders
 * @param {string|null} folderId
 * @param {string} [title]
 * @returns {{label: string, folderId: string, current: boolean}[]}
 */
export function buildCrumbs(folders, folderId, title) {
  const out = [{ label: 'All meetings', folderId: '', current: false }];
  for (const c of breadcrumbFor(folders, folderId)) out.push({ label: c.name, folderId: c.id, current: false });
  if (title) out.push({ label: String(title), folderId: folderId || '', current: true });
  else out[out.length - 1].current = true;
  return out;
}
