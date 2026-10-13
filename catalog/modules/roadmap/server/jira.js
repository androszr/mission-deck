'use strict';
// modules/roadmap/server/jira.js
// Jira READ access for the Roadmap module.
// The reads live here; the Jira WRITES are transitionIssue() below (Table) and
// server/kanban.js (create task, board transition) - all of them refuse a technical
// token (see jiraConfig().source). Everything that decides something is a pure function so it
// can be tested with an injected `http` ({ fetchJson(url, opts) }).
// Config is read from process.env on EVERY call (the vault loads tokens into
// the server heap after boot); the token is never logged.

const JIRA_URL_DEFAULT = 'https://jira.example.com';
const KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;
const REQUEST_TIMEOUT_MS = 20000;
const WORKLOG_CONCURRENCY = 6;

// Custom fields of the epic (example ids - replace them with your Jira instance's).
const JCP_CHANGE_TYPE_FIELD = 'customfield_17308';
const JCP_WORK_TYPE_FIELD = 'customfield_29000';
const JCP_APPLIES_TO_FIELD = 'customfield_29001';

// Same labels as TASK_DEFS in client/helpers.js. A Jira issue whose summary
// contains a label is matched to that definition.
const TASK_DEFS = [
  { id: 'scope-gate-start', label: 'Scope preparation for the Discovery start gate' },
  { id: 'process-mapping', label: 'Business process mapping and documentation' },
  { id: 'research-insights', label: 'User research and insights' },
  { id: 'goals-metrics', label: 'Goals, metrics and differentiators' },
  { id: 'requirements-breakdown', label: 'Business requirements and breakdown into stages' },
  { id: 'workshops-alignment', label: 'Workshops, consultations and cross-team alignment' },
  { id: 'architecture', label: 'Solution architecture' },
  { id: 'mockups-prototypes', label: 'Mockups and prototypes' },
  { id: 'user-testing', label: 'User testing (optional)' },
  { id: 'refinements', label: 'Refinement and cross-refinement preparation' },
];

function _tokenValue(raw) {
  const v = typeof raw === 'string' ? raw.trim() : '';
  return v && !/^your_.*_here$/.test(v) ? v : '';
}

/**
 * Pure: token (personal first, technical ONLY as a fallback) and base URL.
 * THE one place in the module that reads a Jira token. `source` says which one
 * won ('personal' | 'technical' | null) so callers can refuse writes made with
 * the technical account without ever looking at the token itself.
 */
function jiraConfig(env) {
  const personal = _tokenValue(env.JIRA_TOKEN);
  const technical = personal ? '' : _tokenValue(env.JIRA_TECH_TOKEN);
  const token = personal || technical;
  const source = personal ? 'personal' : (technical ? 'technical' : null);
  const jiraUrl = (typeof env.JIRA_URL === 'string' && env.JIRA_URL.trim() ? env.JIRA_URL.trim() : JIRA_URL_DEFAULT).replace(/\/$/, '');
  return { ok: Boolean(token), token, source, jiraUrl };
}

/** Default HTTP client: global fetch with a timeout. A non-2xx answer throws
 * an Error with `.status`; a network failure throws one without it. */
function defaultHttp() {
  return {
    async fetchJson(url, { headers, timeoutMs } = {}) {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs || REQUEST_TIMEOUT_MS) });
      if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
      return r.json();
    },
    /** A write: JSON body, method POST or PUT. Returns the parsed answer ({} for an empty one);
     * a non-2xx answer throws an Error with `.status` and a short `.detail`. */
    async sendJson(url, { method, headers, body, timeoutMs } = {}) {
      const r = await fetch(url, {
        method, headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs || REQUEST_TIMEOUT_MS),
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw Object.assign(new Error('HTTP ' + r.status), { status: r.status, detail: text.slice(0, 300) });
      }
      return r.json().catch(() => ({}));
    },
  };
}

function _headers(cfg) {
  return { Authorization: 'Bearer ' + cfg.token, Accept: 'application/json' };
}

/** Strips contractor codes (e.g. "CTR Jane Doe", "Jane Doe EXT") and a trailing "(...)". */
const ROLE_CODES = /^(?:CTR|EXT|VND)\s+|\s+(?:CTR|EXT|VND)$|\s*\([^)]*\)\s*$/gi;
function normalizeName(raw) {
  return String(raw || '').replace(ROLE_CODES, '').trim();
}

function _normLabel(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
}

/** Pure: Jira worklog list -> [{ author, timeSpentSeconds, started }]. */
function mapWorklogs(body) {
  return ((body && body.worklogs) || []).map((w) => ({
    author: normalizeName(w.author && w.author.displayName) || null,
    timeSpentSeconds: w.timeSpentSeconds || 0,
    started: typeof w.started === 'string' ? w.started.slice(0, 10) : null,
  }));
}

/** Pure: totals per person and per person per day. */
function timeTotals(worklogs) {
  const timeByPerson = {};
  const timeByPersonByDay = {};
  for (const w of worklogs) {
    if (!w.author) continue;
    timeByPerson[w.author] = (timeByPerson[w.author] || 0) + w.timeSpentSeconds;
    if (w.started) {
      if (!timeByPersonByDay[w.author]) timeByPersonByDay[w.author] = {};
      timeByPersonByDay[w.author][w.started] = (timeByPersonByDay[w.author][w.started] || 0) + w.timeSpentSeconds;
    }
  }
  return { timeByPerson, timeByPersonByDay };
}

function _issueEntry(issue, worklogs, jiraBase) {
  const f = issue.fields || {};
  const t = timeTotals(worklogs);
  return {
    key: issue.key,
    summary: (f.summary || '').trim(),
    statusCategory: (f.status && f.status.statusCategory && f.status.statusCategory.key) || null,
    statusName: (f.status && f.status.name) || null,
    assignee: normalizeName(f.assignee && f.assignee.displayName) || null,
    updated: f.updated || null,
    url: jiraBase + '/browse/' + issue.key,
    timeSpentSeconds: (f.timetracking && f.timetracking.timeSpentSeconds) || 0,
    timeByPerson: t.timeByPerson,
    timeByPersonByDay: t.timeByPersonByDay,
  };
}

/**
 * Pure: reconcile epic children against the 10 task definitions by summary
 * (first definition whose label the normalised summary contains wins; the
 * first issue per definition is the match, the rest are unmatched).
 * @returns {{ tasks: object[], unmatched: object[], matched: Map<string, object> }}
 */
function reconcileIssues(issues, worklogsByKey, jiraBase) {
  const matched = new Map();
  const unmatched = [];
  for (const issue of issues) {
    const entry = _issueEntry(issue, (worklogsByKey && worklogsByKey[issue.key]) || [], jiraBase);
    const norm = _normLabel(entry.summary);
    const def = TASK_DEFS.find((d) => norm.includes(_normLabel(d.label))) || null;
    if (def && !matched.has(def.id)) matched.set(def.id, { defId: def.id, ...entry });
    else unmatched.push(entry);
  }
  const tasks = TASK_DEFS.map((d) => matched.get(d.id) || emptyTaskSlot(d.id));
  return { tasks, unmatched, matched };
}

/** Pure: epic issue -> { changeType, workType, appliesTo } or null. */
function parseEpicFields(epicIssue) {
  if (!epicIssue || !epicIssue.fields) return null;
  const rodzaj = epicIssue.fields[JCP_CHANGE_TYPE_FIELD];
  const typ = epicIssue.fields[JCP_WORK_TYPE_FIELD];
  const dot = epicIssue.fields[JCP_APPLIES_TO_FIELD];
  return {
    changeType: rodzaj && typeof rodzaj === 'object' ? { id: rodzaj.id, name: rodzaj.value } : null,
    workType: typ && typeof typ === 'object' ? { id: typ.id, name: typ.value } : null,
    appliesTo: Array.isArray(dot) && dot.length ? dot[0] : null,
  };
}

/** Pure: "is triggering" outward links of an issue -> bare delivery epics. */
function parseTriggeringLinks(issueBody, jiraBase) {
  const links = (issueBody && issueBody.fields && Array.isArray(issueBody.fields.issuelinks)) ? issueBody.fields.issuelinks : [];
  return links
    .filter((l) => l.type && l.type.outward === 'is triggering' && l.outwardIssue)
    .map((l) => {
      const oi = l.outwardIssue;
      const f = oi.fields || {};
      return {
        key: oi.key,
        summary: f.summary || '',
        statusCategory: (f.status && f.status.statusCategory && f.status.statusCategory.key) || '',
        statusName: (f.status && f.status.name) || '',
        updated: f.updated || null,
        url: jiraBase + '/browse/' + oi.key,
        source: 'jira-triggering',
      };
    });
}

/**
 * Pure: the task merge. Existing task entries are kept in their
 * order, server entries replace them by defId (new ones append); excluded
 * keys are blanked / dropped; unmatched assignments survive by key.
 */
/**
 * The full shape of one jiraTasks slot, in the key order the stored files
 * carry. Filling every slot from this template keeps the shape stable, so a
 * sync never rewrites files people have not touched into a different shape.
 */
function emptyTaskSlot(defId) {
  return {
    defId, key: null, summary: null, statusCategory: null, statusName: null, assignee: null,
    updated: null, url: null, timeSpentSeconds: 0, timeByPerson: {}, timeByPersonByDay: {},
  };
}

/** Pure: a slot in the canonical shape - template keys first, in order, then
 * any extra key the entry carries. */
function normalizeTaskSlot(t) {
  return { ...emptyTaskSlot(t.defId), ...t };
}

function mergeJiraTasks(init, serverTasks, serverUnmatched) {
  const excluded = new Set(init.jiraExcludedKeys || []);
  const map = {};
  for (const t of (Array.isArray(init.jiraTasks) ? init.jiraTasks : [])) map[t.defId] = t;
  for (const t of serverTasks) {
    if (t.key && excluded.has(t.key)) {
      map[t.defId] = { ...normalizeTaskSlot(t), ...emptyTaskSlot(t.defId) };
    } else {
      map[t.defId] = normalizeTaskSlot(t);
    }
  }
  const assignments = {};
  for (const t of (init.jiraUnmatched || [])) {
    if (t.key && t.assignedDefId) assignments[t.key] = t.assignedDefId;
  }
  const jiraUnmatched = serverUnmatched
    .map((t) => (t.key && assignments[t.key] ? { ...t, assignedDefId: assignments[t.key] } : t))
    .filter((t) => !t.key || !excluded.has(t.key));
  return { jiraTasks: Object.values(map).map(normalizeTaskSlot), jiraUnmatched };
}

/**
 * Pure: automatic delivery epics (fresh from Jira) plus the manual ones the
 * person added by hand that Jira does not report. `enrichedManual` maps a
 * manual epic key to its freshly read data (best effort).
 * `autoEpics === null` (links could not be read) keeps the stored automatic
 * epics instead of wiping them on a transient failure.
 */
function mergeDeliveryEpics(existing, autoEpics, enrichedManual) {
  const stored = Array.isArray(existing) ? existing : [];
  const auto = autoEpics === null ? stored.filter((e) => e.source !== 'manual') : autoEpics;
  const autoKeys = new Set(auto.map((e) => e.key));
  const manual = stored
    .filter((e) => e.source === 'manual' && !autoKeys.has(e.key))
    .map((e) => (enrichedManual && enrichedManual[e.key]) || e);
  return [...auto, ...manual];
}

/** Auth failures and unreachable Jira must abort the whole sync; everything
 * else in a best-effort branch is swallowed by the caller. */
function isFatal(err) {
  return !err || err.status === undefined || err.status === 401 || err.status === 403;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      try { out[i] = { ok: true, value: await fn(items[i]) }; } catch (e) { out[i] = { ok: false, error: e }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function _worklogsFor(http, cfg, key) {
  try {
    const body = await http.fetchJson(cfg.jiraUrl + '/rest/api/2/issue/' + encodeURIComponent(key) + '/worklog?maxResults=1000', { headers: _headers(cfg), timeoutMs: 10000 });
    return mapWorklogs(body);
  } catch {
    return null; // distinguishes "could not read" from "no worklogs"
  }
}

async function _subtasksWithWorklogs(http, cfg, epicKey, maxResults) {
  const jql = '("Epic Link" = ' + epicKey + ' OR parent = ' + epicKey + ') AND project = DISC ORDER BY created ASC';
  const url = cfg.jiraUrl + '/rest/api/2/search?jql=' + encodeURIComponent(jql)
    + '&fields=' + encodeURIComponent('summary,status,assignee,updated,timetracking') + '&maxResults=' + maxResults;
  const body = await http.fetchJson(url, { headers: _headers(cfg), timeoutMs: REQUEST_TIMEOUT_MS });
  const issues = (body && body.issues) || [];
  const res = await mapLimit(issues, WORKLOG_CONCURRENCY, (i) => _worklogsFor(http, cfg, i.key));
  const worklogsByKey = {};
  const failedKeys = new Set();
  issues.forEach((i, idx) => {
    const wl = res[idx].ok ? res[idx].value : null;
    if (wl === null) failedKeys.add(i.key);
    worklogsByKey[i.key] = wl || [];
  });
  return { issues, worklogsByKey, failedKeys };
}

/** Summary, status, own worklogs and DISC subtasks of a delivery epic. */
async function enrichDeliveryEpic(http, cfg, epicKey) {
  let summary = ''; let statusName = ''; let statusCategory = ''; let updated = null;
  let incomplete = false; // some read failed: the caller keeps the stored times
  try {
    const b = await http.fetchJson(cfg.jiraUrl + '/rest/api/2/issue/' + encodeURIComponent(epicKey) + '?fields=summary,status,updated', { headers: _headers(cfg), timeoutMs: 10000 });
    if (b && b.fields) {
      summary = b.fields.summary || '';
      statusName = (b.fields.status && b.fields.status.name) || '';
      statusCategory = (b.fields.status && b.fields.status.statusCategory && b.fields.status.statusCategory.key) || '';
      updated = b.fields.updated || null;
    }
  } catch { incomplete = true; }
  const ownWorklogs = await _worklogsFor(http, cfg, epicKey);
  if (ownWorklogs === null) incomplete = true;
  const worklogs = ownWorklogs || [];
  let subtasks = [];
  try {
    const { issues, worklogsByKey, failedKeys } = await _subtasksWithWorklogs(http, cfg, epicKey, 100);
    subtasks = issues.map((i) => _issueEntry(i, worklogsByKey[i.key] || [], cfg.jiraUrl));
    if (failedKeys.size > 0) incomplete = true;
  } catch { incomplete = true; }
  const t = timeTotals(worklogs);
  return {
    summary, statusCategory, statusName, updated, incomplete,
    timeSpentSeconds: worklogs.reduce((s, w) => s + w.timeSpentSeconds, 0),
    timeByPerson: t.timeByPerson, timeByPersonByDay: t.timeByPersonByDay, subtasks,
  };
}

/**
 * Everything a sync needs, read-only.
 * `existingDeliveryEpics` is only used to know which manual epics to refresh.
 * @returns {{ tasks, unmatched, epicFields: object|null|undefined, deliveryEpics: object[] }}
 * epicFields is undefined when the epic could not be read (caller keeps the stored value).
 */
async function fetchSyncData({ http, cfg, epic, existingDeliveryEpics }) {
  const { issues, worklogsByKey, failedKeys } = await _subtasksWithWorklogs(http, cfg, epic, 50);
  const { tasks, unmatched, matched } = reconcileIssues(issues, worklogsByKey, cfg.jiraUrl);

  let epicFields;
  try {
    const fieldsParam = [JCP_CHANGE_TYPE_FIELD, JCP_WORK_TYPE_FIELD, JCP_APPLIES_TO_FIELD].join(',');
    const epicIssue = await http.fetchJson(cfg.jiraUrl + '/rest/api/2/issue/' + encodeURIComponent(epic) + '?fields=' + encodeURIComponent(fieldsParam), { headers: _headers(cfg), timeoutMs: 10000 });
    const parsed = parseEpicFields(epicIssue);
    if (parsed) epicFields = parsed;
  } catch (e) { if (isFatal(e)) throw e; }

  let autoEpics = null;
  const incompleteEpics = new Set();
  const reqTask = matched.get('requirements-breakdown');
  if (!reqTask || !reqTask.key) {
    autoEpics = [];
  } else {
    try {
      const body = await http.fetchJson(cfg.jiraUrl + '/rest/api/2/issue/' + encodeURIComponent(reqTask.key) + '?fields=issuelinks', { headers: _headers(cfg), timeoutMs: 10000 });
      const raw = parseTriggeringLinks(body, cfg.jiraUrl);
      const enriched = await mapLimit(raw, 3, (ep) => enrichDeliveryEpic(http, cfg, ep.key));
      autoEpics = raw.map((ep, i) => {
        const e = enriched[i].ok ? enriched[i].value : {};
        if (!enriched[i].ok || e.incomplete) incompleteEpics.add(ep.key);
        return { ...ep, timeSpentSeconds: e.timeSpentSeconds || 0, timeByPerson: e.timeByPerson || {}, timeByPersonByDay: e.timeByPersonByDay || {}, subtasks: e.subtasks || [] };
      });
    } catch (e) { if (isFatal(e)) throw e; }
  }

  const autoKeys = new Set((autoEpics || []).map((e) => e.key));
  const bare = (Array.isArray(existingDeliveryEpics) ? existingDeliveryEpics : []).filter((e) => e.source === 'manual' && !autoKeys.has(e.key));
  const enrichedManual = {};
  const res = await mapLimit(bare, 3, (ep) => enrichDeliveryEpic(http, cfg, ep.key));
  bare.forEach((ep, i) => {
    // An epic Jira did not answer for keeps its stored data.
    if (res[i].ok && res[i].value.summary && !res[i].value.incomplete) {
      const { incomplete: _inc, ...fresh } = res[i].value;
      enrichedManual[ep.key] = { key: ep.key, ...fresh, url: cfg.jiraUrl + '/browse/' + ep.key, source: 'manual' };
    }
  });
  return { tasks, unmatched, epicFields, autoEpics, enrichedManual, worklogFailed: failedKeys, incompleteEpics };
}

/** Pure: the four fields a sync writes, from the stored initiative + fetched data. */
const TIME_KEYS = ['timeSpentSeconds', 'timeByPerson', 'timeByPersonByDay'];

/**
 * Pure: a transient worklog failure must not zero the MD column. For a task
 * (or epic) whose time could not be read this time, the stored time numbers of
 * the SAME key are kept; everything else comes fresh from Jira.
 */
function keepStoredTimes(fresh, stored, extraKeys) {
  const out = { ...fresh };
  for (const k of [...TIME_KEYS, ...extraKeys]) if (stored[k] !== undefined) out[k] = stored[k];
  return out;
}

function buildSyncPatch(init, data) {
  const failed = data.worklogFailed instanceof Set ? data.worklogFailed : new Set();
  const storedByKey = new Map();
  for (const t of [...(init.jiraTasks || []), ...(init.jiraUnmatched || [])]) if (t && t.key) storedByKey.set(t.key, t);
  const fixTime = (t) => (t.key && failed.has(t.key) && storedByKey.has(t.key) ? keepStoredTimes(t, storedByKey.get(t.key), []) : t);
  const { jiraTasks, jiraUnmatched } = mergeJiraTasks(init, data.tasks.map(fixTime), data.unmatched.map(fixTime));
  let autoEpics = data.autoEpics;
  if (Array.isArray(autoEpics) && data.incompleteEpics instanceof Set && data.incompleteEpics.size > 0) {
    const storedEpics = new Map((Array.isArray(init.deliveryEpics) ? init.deliveryEpics : []).map((e) => [e.key, e]));
    autoEpics = autoEpics.map((e) => (data.incompleteEpics.has(e.key) && storedEpics.has(e.key)
      ? keepStoredTimes(e, storedEpics.get(e.key), ['subtasks']) : e));
  }
  return {
    jiraTasks,
    jiraUnmatched,
    epicFields: data.epicFields === undefined ? (init.epicFields === undefined ? null : init.epicFields) : data.epicFields,
    deliveryEpics: mergeDeliveryEpics(init.deliveryEpics, autoEpics, data.enrichedManual),
  };
}

/**
 * Read-only: issues hierarchically under `key` ("Parent Link", "Epic Link",
 * parent) plus linked ones, deduped by key (first relation wins). A 400 for
 * a JQL (field unknown on this Jira) is skipped; auth and network failures abort.
 */
async function fetchEpicChildren({ http, cfg, key }) {
  const attempts = [
    ['parent-link', '"Parent Link" = ' + key],
    ['epic-link', '"Epic Link" = ' + key],
    ['parent', 'parent = ' + key],
    ['linked', 'issue in linkedIssues(' + key + ')'],
  ];
  const seen = new Set([key]);
  const out = [];
  for (const [relation, jql] of attempts) {
    let body;
    try {
      const url = cfg.jiraUrl + '/rest/api/2/search?jql=' + encodeURIComponent(jql + ' ORDER BY key ASC')
        + '&fields=' + encodeURIComponent('summary,status,issuetype') + '&maxResults=100';
      body = await http.fetchJson(url, { headers: _headers(cfg), timeoutMs: REQUEST_TIMEOUT_MS });
    } catch (e) {
      if (e && e.status === 400) continue;
      throw e;
    }
    for (const i of ((body && body.issues) || [])) {
      if (!i || !i.key || seen.has(i.key)) continue;
      seen.add(i.key);
      const f = i.fields || {};
      out.push({
        key: i.key,
        summary: (f.summary || '').trim(),
        status: (f.status && f.status.name) || null,
        statusCategory: (f.status && f.status.statusCategory && f.status.statusCategory.key) || null,
        issueType: (f.issuetype && f.issuetype.name) || null,
        relation,
      });
    }
  }
  return out;
}

/**
 * Read-only: the id of a Jira field by its display name (e.g. "Parent Link",
 * whose customfield_NNNNN differs per Jira instance). `null` when unknown.
 */
async function fetchFieldId({ http, cfg, name }) {
  const body = await http.fetchJson(cfg.jiraUrl + '/rest/api/2/field', { headers: _headers(cfg), timeoutMs: REQUEST_TIMEOUT_MS });
  const wanted = String(name || '').trim().toLowerCase();
  const hit = (Array.isArray(body) ? body : []).find((f) => f && String(f.name || '').trim().toLowerCase() === wanted);
  return hit ? { id: hit.id, name: hit.name, custom: !!hit.custom } : null;
}

/** Pure: the transition whose target status (or own name) matches `target`,
 * compared without case and diacritics. `null` when the workflow offers none. */
function pickTransition(transitions, target) {
  const want = _normLabel(target || '').trim();
  if (!want) return null;
  const list = Array.isArray(transitions) ? transitions : [];
  return list.find((t) => t && t.to && _normLabel(t.to.name || '').trim() === want)
    || list.find((t) => t && _normLabel(t.name || '').trim() === want)
    || null;
}

/**
 * The only Jira WRITE in this module: moves one issue through the workflow to
 * the status named `target` (e.g. "Closed"). Reads the issue's available
 * transitions first; never guesses an id. Returns { done, from?, to?, available? }.
 */
async function transitionIssue({ http, cfg, key, target, fetchImpl = fetch }) {
  const issue = await http.fetchJson(cfg.jiraUrl + '/rest/api/2/issue/' + encodeURIComponent(key) + '?fields=status',
    { headers: _headers(cfg), timeoutMs: REQUEST_TIMEOUT_MS });
  const from = (issue && issue.fields && issue.fields.status && issue.fields.status.name) || null;
  if (from && _normLabel(from).trim() === _normLabel(target).trim()) return { done: false, already: true, from };
  const body = await http.fetchJson(cfg.jiraUrl + '/rest/api/2/issue/' + encodeURIComponent(key) + '/transitions',
    { headers: _headers(cfg), timeoutMs: REQUEST_TIMEOUT_MS });
  const transitions = (body && body.transitions) || [];
  const t = pickTransition(transitions, target);
  if (!t) return { done: false, from, available: transitions.map((x) => (x.to && x.to.name) || x.name) };
  const r = await fetchImpl(cfg.jiraUrl + '/rest/api/2/issue/' + encodeURIComponent(key) + '/transitions', {
    method: 'POST',
    headers: { ..._headers(cfg), 'Content-Type': 'application/json' },
    body: JSON.stringify({ transition: { id: t.id } }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw Object.assign(new Error('HTTP ' + r.status), { status: r.status, detail: text.slice(0, 300) });
  }
  return { done: true, from, to: (t.to && t.to.name) || t.name };
}

module.exports = {
  KEY_RE, TASK_DEFS, JIRA_URL_DEFAULT, JCP_CHANGE_TYPE_FIELD, JCP_WORK_TYPE_FIELD, JCP_APPLIES_TO_FIELD, authHeaders: _headers,
  jiraConfig, defaultHttp, emptyTaskSlot, normalizeName, mapWorklogs, timeTotals, reconcileIssues,
  parseEpicFields, parseTriggeringLinks, mergeJiraTasks, mergeDeliveryEpics, buildSyncPatch,
  enrichDeliveryEpic, fetchSyncData, fetchEpicChildren, fetchFieldId, pickTransition, transitionIssue, isFatal,
};
