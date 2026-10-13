// modules/devops-stats/scripts/_extract.mjs
// Pure extraction layer of the ETL (no I/O): Jira field/status metadata and
// one raw issue with its changelog -> a compact "fact" record. Categories
// come from Jira's statusCategory key, fields from their schema; no status
// name, issue type name or category label is compared anywhere in here.

const FIELD_ID_RE = /^customfield_\d+$/;
const KEY_RE = /^DEVOPS-\d+$/;
const EPIC_LINK_SCHEMA = 'com.pyxis.greenhopper.jira:gh-epic-link';
const EPIC_NAME_SCHEMA = 'com.pyxis.greenhopper.jira:gh-epic-label';
const FLAGGED_FIELD_NAME = 'Flagged';
const PROJECT = 'DEVOPS';
const LOOKBACK_DAYS = 365;

/** Jira timestamps ("+0100" offsets) -> UTC ISO string, or null.
 * @param {unknown} value @returns {string|null} */
export function toIso(value) {
  if (typeof value !== 'string' || !value) return null;
  const fixed = value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const t = Date.parse(fixed);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function _validId(id) {
  return typeof id === 'string' && FIELD_ID_RE.test(id) ? id : null;
}

/** @param {object[]} fields answer of GET /rest/api/2/field
 * @returns {{epic_link: string|null, epic_name: string|null, flagged: string|null}} */
export function resolveFieldIds(fields) {
  const out = { epic_link: null, epic_name: null, flagged: null };
  for (const f of Array.isArray(fields) ? fields : []) {
    if (!f || typeof f !== 'object') continue;
    const custom = f.schema && f.schema.custom;
    if (custom === EPIC_LINK_SCHEMA && !out.epic_link) out.epic_link = _validId(f.id);
    else if (custom === EPIC_NAME_SCHEMA && !out.epic_name) out.epic_name = _validId(f.id);
    else if (f.name === FLAGGED_FIELD_NAME && custom && !out.flagged) out.flagged = _validId(f.id);
  }
  return out;
}

/** @param {object[]} projectStatuses answer of GET /rest/api/2/project/<key>/statuses
 * @returns {{id: string, name: string, category: string|null}[]} */
export function statusTable(projectStatuses) {
  const seen = new Map();
  for (const entry of Array.isArray(projectStatuses) ? projectStatuses : []) {
    for (const st of (entry && Array.isArray(entry.statuses)) ? entry.statuses : []) {
      if (!st || st.id === undefined || st.id === null) continue;
      const id = String(st.id);
      if (seen.has(id)) continue;
      const cat = st.statusCategory && typeof st.statusCategory.key === 'string' ? st.statusCategory.key : null;
      seen.set(id, { id, name: String(st.name || ''), category: cat });
    }
  }
  return [...seen.values()].sort((a, b) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id));
}

/**
 * Merge the project status table (authoritative, current: true) with the global
 * GET /rest/api/2/status answer (fallback for historic ids, current: false).
 * With usedIds only global statuses in that set are added, so the payload does not
 * carry every status of the Jira instance.
 * @param {{id:string,name:string,category:string|null}[]} projectTable output of statusTable
 * @param {object[]} globalStatuses answer of GET /rest/api/2/status
 * @param {Iterable<string>} [usedIds]
 * @returns {{id:string,name:string,category:string|null,current:boolean}[]} */
export function mergeStatuses(projectTable, globalStatuses, usedIds) {
  const out = new Map();
  for (const s of Array.isArray(projectTable) ? projectTable : []) out.set(String(s.id), { ...s, id: String(s.id), current: true });
  const only = usedIds === undefined ? null : new Set([...usedIds].map(String));
  for (const st of Array.isArray(globalStatuses) ? globalStatuses : []) {
    if (!st || st.id === undefined || st.id === null) continue;
    const id = String(st.id);
    if (out.has(id) || (only && !only.has(id))) continue;
    const cat = st.statusCategory && typeof st.statusCategory.key === 'string' ? st.statusCategory.key : null;
    out.set(id, { id, name: String(st.name || ''), category: cat, current: false });
  }
  return [...out.values()].sort((a, b) => Number(a.id) - Number(b.id) || a.id.localeCompare(b.id));
}

function _categoryOf(categoryById, id) {
  if (!categoryById || id === null || id === undefined) return null;
  const cat = categoryById instanceof Map ? categoryById.get(String(id)) : categoryById[String(id)];
  return typeof cat === 'string' ? cat : null;
}

/**
 * One raw Jira issue (with expand=changelog) -> fact record.
 * @param {object} raw
 * @param {{fieldIds?: object, categoryById?: Map<string,string>|Record<string,string>}} ctx
 * @returns {object|null} null when the issue has no usable key or created date
 */
export function issueToFact(raw, ctx) {
  const fieldIds = (ctx && ctx.fieldIds) || {};
  const categoryById = ctx && ctx.categoryById;
  if (!raw || typeof raw !== 'object' || typeof raw.key !== 'string') return null;
  const f = raw.fields || {};
  const created = toIso(f.created);
  if (!created) return null;

  const histories = (raw.changelog && Array.isArray(raw.changelog.histories)) ? raw.changelog.histories : [];
  const sorted = histories
    .map((h) => ({ h, t: toIso(h && h.created) }))
    .filter((x) => x.t)
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));

  const currentStatusId = f.status && f.status.id !== undefined ? String(f.status.id) : null;
  const statusChanges = [];
  const flagEvents = [];
  for (const { h, t } of sorted) {
    for (const item of Array.isArray(h.items) ? h.items : []) {
      if (!item) continue;
      if (item.field === 'status') {
        statusChanges.push({ t, from: item.from === null || item.from === undefined ? null : String(item.from),
          to: item.to === null || item.to === undefined ? null : String(item.to) });
      } else if (item.field === FLAGGED_FIELD_NAME || (fieldIds.flagged && item.fieldId === fieldIds.flagged)) {
        flagEvents.push({ t, on: !!(item.to !== null && item.to !== undefined && String(item.to).trim() !== '') });
      }
    }
  }

  const intervals = [];
  let curStatus = statusChanges.length && statusChanges[0].from ? statusChanges[0].from : currentStatusId;
  let curFrom = created;
  for (const ch of statusChanges) {
    intervals.push({ s: curStatus, from: curFrom, to: ch.t });
    curStatus = ch.to;
    curFrom = ch.t;
  }
  intervals.push({ s: curStatus, from: curFrom, to: null });

  const flagged = [];
  let open = null;
  for (const ev of flagEvents) {
    if (ev.on && open === null) open = ev.t;
    else if (!ev.on && open !== null) { flagged.push({ from: open, to: ev.t }); open = null; }
  }
  if (open !== null) flagged.push({ from: open, to: null });

  let startedAt = null;
  for (const iv of intervals) {
    if (_categoryOf(categoryById, iv.s) === 'indeterminate') { startedAt = iv.from; break; }
  }
  let doneAt = null;
  if (_categoryOf(categoryById, intervals[intervals.length - 1].s) === 'done') {
    let i = intervals.length - 1;
    while (i > 0 && _categoryOf(categoryById, intervals[i - 1].s) === 'done') i -= 1;
    doneAt = intervals[i].from;
  }

  const issuetype = f.issuetype || {};
  const subtask = issuetype.subtask === true;
  const epicLinkVal = fieldIds.epic_link ? f[fieldIds.epic_link] : null;
  const epicNameVal = fieldIds.epic_name ? f[fieldIds.epic_name] : null;
  let epicKey = typeof epicLinkVal === 'string' && epicLinkVal ? epicLinkVal : null;
  if (!epicKey && !subtask && f.parent && typeof f.parent.key === 'string') epicKey = f.parent.key;

  const assignee = f.assignee && (f.assignee.displayName || f.assignee.name);
  // Logged work in seconds: the aggregate includes sub-tasks (sub-tasks are not
  // counted on their own), the plain field is the fallback; null when none.
  const spent = [f.aggregatetimespent, f.timespent].find((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0);
  return {
    key: raw.key,
    summary: String(f.summary || ''),
    type_id: issuetype.id !== undefined ? String(issuetype.id) : null,
    subtask,
    is_epic: typeof epicNameVal === 'string' && epicNameVal !== '',
    epic_key: epicKey,
    created,
    started_at: startedAt,
    done_at: doneAt,
    status_id: currentStatusId,
    assignee: assignee ? String(assignee) : null,
    time_spent_s: spent === undefined ? null : spent,
    // Who logged how much and when (per-person view). Absent - not [] - when
    // the answer carried no worklog field, so "unknown" never reads as "none".
    ...(f.worklog && Array.isArray(f.worklog.worklogs) ? { worklogs: worklogEntries(f.worklog.worklogs) } : {}),
    intervals,
    flagged,
  };
}

/** Flags every fact that is an epic: carries an Epic Name, or is referenced
 * as an epic by another (non sub-task) fact. Returns new objects.
 * @param {object[]} facts @returns {object[]} */
export function markEpics(facts) {
  const list = Array.isArray(facts) ? facts : [];
  const referenced = new Set();
  for (const x of list) if (x && !x.subtask && x.epic_key) referenced.add(x.epic_key);
  return list.map((x) => ({ ...x, is_epic: !!(x.is_epic || referenced.has(x.key)) }));
}

function _pad(n) { return String(n).padStart(2, '0'); }

/** @param {'full'|'incremental'} mode @param {string} [sinceIso] @returns {string} */
export function buildJql(mode, sinceIso) {
  if (mode === 'incremental') {
    const t = Date.parse(sinceIso);
    if (!Number.isFinite(t)) throw new Error('incremental JQL needs a valid since date');
    const d = new Date(t);
    const stamp = `${d.getUTCFullYear()}/${_pad(d.getUTCMonth() + 1)}/${_pad(d.getUTCDate())} ${_pad(d.getUTCHours())}:${_pad(d.getUTCMinutes())}`;
    return `project = ${PROJECT} AND updated >= "${stamp}" ORDER BY key ASC`;
  }
  // `updated` and not `created`: closing an issue updates it, so an old issue closed within the
  // lookback is fetched too (the long tail of lead time). `resolved` is not used because a
  // workflow may close without setting a resolution.
  return `project = ${PROJECT} AND (updated >= -${LOOKBACK_DAYS}d OR statusCategory != Done) ORDER BY key ASC`;
}

/**
 * Jira worklog records -> [{ author, started, seconds }]: display name (null
 * when Jira has none), UTC ISO start, logged seconds. Unusable records dropped.
 * @param {object[]} list
 */
export function worklogEntries(list) {
  const out = [];
  for (const w of Array.isArray(list) ? list : []) {
    const started = toIso(w && w.started);
    const seconds = w && w.timeSpentSeconds;
    if (!started || typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) continue;
    const a = w.author || {};
    const author = a.displayName || a.name || null;
    out.push({ author: author ? String(author) : null, started, seconds });
  }
  out.sort((x, y) => x.started.localeCompare(y.started));
  return out;
}

/** @param {object} fact @returns {string[]} error strings, empty when valid */
export function validateFact(fact) {
  const errs = [];
  if (!fact || typeof fact !== 'object') return ['fact is not an object'];
  const k = fact.key;
  if (typeof k !== 'string' || !KEY_RE.test(k)) errs.push('bad key: ' + String(k));
  const label = typeof k === 'string' ? k : '?';
  if (!toIso(fact.created)) errs.push(label + ': bad created');
  for (const f of ['started_at', 'done_at']) {
    if (fact[f] !== null && fact[f] !== undefined && !toIso(fact[f])) errs.push(label + ': bad ' + f);
  }
  if (!Array.isArray(fact.intervals) || fact.intervals.length === 0) {
    errs.push(label + ': no intervals');
  } else {
    let prevEnd = null;
    fact.intervals.forEach((iv, i) => {
      const from = iv && Date.parse(iv.from);
      const to = iv && iv.to !== null && iv.to !== undefined ? Date.parse(iv.to) : null;
      if (!Number.isFinite(from)) { errs.push(label + ': interval ' + i + ' bad from'); return; }
      if (to !== null && (!Number.isFinite(to) || to < from)) errs.push(label + ': interval ' + i + ' bad to');
      if (prevEnd !== null && from < prevEnd) errs.push(label + ': interval ' + i + ' overlaps');
      if (i < fact.intervals.length - 1 && to === null) errs.push(label + ': interval ' + i + ' open before the last');
      prevEnd = to;
    });
  }
  if (fact.worklogs !== undefined) {
    if (!Array.isArray(fact.worklogs)) errs.push(label + ': worklogs is not an array');
    else if (fact.worklogs.some((w) => !w || !toIso(w.started) || typeof w.seconds !== 'number' || !(w.seconds >= 0))) errs.push(label + ': bad worklog');
  }
  const ts = fact.time_spent_s;
  if (ts !== null && ts !== undefined && !(typeof ts === 'number' && Number.isFinite(ts) && ts >= 0)) errs.push(label + ': bad time_spent_s');
  if (!Array.isArray(fact.flagged)) {
    errs.push(label + ': flagged is not an array');
  } else {
    let prevEnd = null;
    fact.flagged.forEach((iv, i) => {
      const from = iv && Date.parse(iv.from);
      const to = iv && iv.to !== null && iv.to !== undefined ? Date.parse(iv.to) : null;
      if (!Number.isFinite(from) || (to !== null && (!Number.isFinite(to) || to < from))) errs.push(label + ': flagged ' + i + ' bad');
      else if (prevEnd !== null && from < prevEnd) errs.push(label + ': flagged ' + i + ' overlaps');
      prevEnd = to;
    });
  }
  return errs;
}

export const CONSTANTS = { PROJECT, LOOKBACK_DAYS };
