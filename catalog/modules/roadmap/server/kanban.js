'use strict';
// modules/roadmap/server/kanban.js
// Routes of the Kanban tab, under /api/m/roadmap/kanban/*.
//
// Token policy: READS use jiraCfg() (personal token, technical one only as a fallback);
// every WRITE (create task, transition) uses jiraWriteCfg(), which refuses with
// 'personal-token-required' when only the technical token exists - a technical
// account must not author changes. The token itself is never returned.
// No file is written here: the Kanban only reads the initiative files to group
// cards into swim lanes.
//
// Jira instance configuration (example values - replace them with your own):
// the task project (DISC), the epic link field, the status ids of the
// finished statuses (Done = 10100, Cancelled = 11711) and the issue type name.

const jira = require('./jira.js');

const MAX_ISSUES = 2000;
const PAGE_SIZE = 100;
const FIELDS = 'summary,status,assignee,issuetype,priority,updated,customfield_10001';
const EPIC_LINK_FIELD = 'customfield_10001';
// Status IDs in JQL, not names: names vary by locale and may answer 400.
// Done = 10100, Cancelled = 11711 (finished work is shown for 7 days).
const JQL_ACTIVE = 'project = DISC AND status NOT IN (10100, 11711) ORDER BY key ASC';
const JQL_RECENT = 'project = DISC AND status IN (10100, 11711) AND status changed AFTER -7d ORDER BY key ASC';

/** Pure: Jira search results -> board issues (no avatar URL: avatars come from the team directory). */
function mapIssues(rawIssues) {
  const seen = new Set();
  const out = [];
  for (const issue of rawIssues) {
    if (!issue || !issue.key || seen.has(issue.key)) continue;
    seen.add(issue.key);
    const f = issue.fields || {};
    out.push({
      key: issue.key,
      summary: (f.summary || '').trim(),
      statusId: f.status && f.status.id !== undefined && f.status.id !== null ? Number(f.status.id) : null,
      statusName: (f.status && f.status.name) || null,
      assignee: f.assignee ? { displayName: f.assignee.displayName || null } : null,
      issueType: (f.issuetype && f.issuetype.name) || null,
      priority: (f.priority && f.priority.name) || null,
      updated: f.updated || null,
    });
  }
  return out;
}

/**
 * Pure: issue key -> initiative id. A key is claimed by the initiative that lists it
 * (jiraTasks, jiraUnmatched, delivery epic subtasks); the rest falls back to the
 * epic link of the issue matching an initiative's `ticket`.
 */
function buildLanes(rawIssues, initiatives) {
  const list = Array.isArray(initiatives) ? initiatives : [];
  const laneMap = {};
  const epicToInit = {};
  for (const init of list) {
    if (!init || !init.id) continue;
    if (init.ticket) epicToInit[init.ticket] = init.id;
    for (const t of (init.jiraTasks || [])) if (t && t.key) laneMap[t.key] = init.id;
    for (const t of (init.jiraUnmatched || [])) if (t && t.key) laneMap[t.key] = init.id;
    for (const epic of (init.deliveryEpics || [])) {
      for (const sub of (epic.subtasks || [])) if (sub && sub.key) laneMap[sub.key] = init.id;
    }
  }
  for (const issue of rawIssues) {
    if (!issue || laneMap[issue.key]) continue;
    const link = issue.fields && issue.fields[EPIC_LINK_FIELD];
    if (typeof link === 'string' && epicToInit[link]) laneMap[issue.key] = epicToInit[link];
  }
  const lanes = list.filter((i) => i && i.id).map((i) => ({ id: i.id, title: i.title, rank: i.rank ?? 999, epicKey: i.ticket || null }));
  return { lanes, laneMap };
}

/** Pure: the whole board answer from raw Jira issues and the initiatives. */
function buildBoard(rawIssues, initiatives) {
  const seen = new Set();
  const unique = [];
  for (const i of rawIssues) if (i && i.key && !seen.has(i.key)) { seen.add(i.key); unique.push(i); }
  return { issues: mapIssues(unique), ...buildLanes(unique, initiatives) };
}

async function fetchAllByJql(http, cfg, jql) {
  const collected = [];
  let startAt = 0;
  while (startAt < MAX_ISSUES) {
    const url = cfg.jiraUrl + '/rest/api/2/search?jql=' + encodeURIComponent(jql) + '&fields=' + encodeURIComponent(FIELDS)
      + '&maxResults=' + PAGE_SIZE + '&startAt=' + startAt;
    const body = await http.fetchJson(url, { headers: jira.authHeaders(cfg), timeoutMs: 30000 });
    if (!body || !Array.isArray(body.issues)) throw Object.assign(new Error('bad-search'), { status: 502 });
    collected.push(...body.issues);
    startAt += body.issues.length;
    if (body.issues.length === 0 || startAt >= (body.total || 0)) break;
  }
  return collected;
}

/** Pure: the transition whose target status id belongs to the column (null when the workflow offers none). */
function pickColumnTransition(transitions, statusIds) {
  const list = Array.isArray(transitions) ? transitions : [];
  return list.find((t) => t && t.to && statusIds.includes(Number(t.to.id))) || null;
}

/** Pure: the JSON body of the Jira create call. PLAT epics get the Discovery label. */
function buildCreateFields(p, assigneeName) {
  const fields = {
    project: { key: 'DISC' },
    summary: p.summary,
    issuetype: { name: 'Task' },
    [jira.JCP_CHANGE_TYPE_FIELD]: { id: p.changeTypeId },
    [jira.JCP_WORK_TYPE_FIELD]: { id: p.workTypeId },
    [EPIC_LINK_FIELD]: p.epicKey,
  };
  if (p.description) fields.description = p.description;
  if (assigneeName) fields.assignee = { name: assigneeName };
  if (p.epicKey.startsWith('PLAT')) fields.labels = ['Discovery'];
  return fields;
}

function _strip(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L');
}

/** Pure: the user-picker hit for a display name (exact, reversed word order, else the first hit). */
function pickUser(users, displayName) {
  const list = Array.isArray(users) ? users : [];
  const want = _strip(displayName).toLowerCase();
  const hit = list.find((u) => {
    const dn = _strip(u && u.displayName).toLowerCase();
    return dn === want || dn.split(' ').reverse().join(' ') === want;
  }) || list[0];
  return hit && hit.name ? hit.name : null;
}

module.exports = function kanbanRoutes(h) {
  const { ctx } = h;

  function testGate(res) {
    if (h.isTestMode()) {
      ctx.jsonResponse(res, 409, { error: 'test-mode', message: 'The Kanban uses Jira, which is disabled in test mode.' });
      return false;
    }
    return true;
  }

  // Which token is in use - never the token. Cheap, no Jira call, no gate.
  async function handleStatus(_req, res) {
    const cfg = h.jiraConfig();
    const testMode = h.isTestMode();
    ctx.jsonResponse(res, 200, { token: cfg.source, canWrite: cfg.source === 'personal' && !testMode, testMode });
  }

  async function handleBoard(_req, res) {
    if (!testGate(res)) return;
    try {
      const cfg = h.jiraCfg();
      const http = h.httpClient();
      const [active, recent] = await Promise.all([fetchAllByJql(http, cfg, JQL_ACTIVE), fetchAllByJql(http, cfg, JQL_RECENT)]);
      const board = buildBoard([...active, ...recent], h.readInitiatives());
      ctx.jsonResponse(res, 200, { ok: true, ...board, jiraBase: cfg.jiraUrl + '/browse/', token: cfg.source });
    } catch (e) {
      h.sendJiraError(res, e);
    }
  }

  async function handleTransition(req, res) {
    if (!testGate(res)) return;
    let body;
    try { body = await ctx.readBody(req); } catch { body = null; }
    const K = await h.kanbanHelpers();
    const v = K.validateTransition(body);
    if (!v.ok) return ctx.jsonResponse(res, 400, { error: 'bad-request', message: v.message });
    const { key, targetColId } = v.payload;
    try {
      const cfg = h.jiraWriteCfg();
      const http = h.httpClient();
      const col = K.columnById(targetColId);
      const answer = await http.fetchJson(cfg.jiraUrl + '/rest/api/2/issue/' + encodeURIComponent(key) + '/transitions',
        { headers: jira.authHeaders(cfg), timeoutMs: 15000 });
      const match = pickColumnTransition(answer && answer.transitions, col.statusIds);
      if (!match) {
        return ctx.jsonResponse(res, 409, { error: 'no-transition', key, message: 'Jira does not allow moving ' + key + ' to the "' + col.label + '" column from its current status.' });
      }
      await http.sendJson(cfg.jiraUrl + '/rest/api/2/issue/' + encodeURIComponent(key) + '/transitions',
        { method: 'POST', headers: jira.authHeaders(cfg), body: { transition: { id: match.id } }, timeoutMs: 15000 });
      ctx.log('kanban transition ' + key + ' -> ' + targetColId);
      ctx.jsonResponse(res, 200, { ok: true, key, targetColId });
    } catch (e) {
      if (e && e.status === 404) return ctx.jsonResponse(res, 404, { error: 'issue-not-found', key, message: 'Jira does not know issue ' + key + '.' });
      if (e && e.status === 400) return ctx.jsonResponse(res, 400, { error: 'jira-rejected', key, message: 'Jira rejected the status change.', detail: e.detail || '' });
      h.sendJiraError(res, e);
    }
  }

  async function resolveAssignee(http, cfg, displayName) {
    if (!displayName) return null;
    const queries = [displayName];
    if (_strip(displayName) !== displayName) queries.push(_strip(displayName));
    for (const q of queries) {
      try {
        const r = await http.fetchJson(cfg.jiraUrl + '/rest/api/2/user/picker?query=' + encodeURIComponent(q) + '&maxResults=5',
          { headers: jira.authHeaders(cfg), timeoutMs: 10000 });
        const name = pickUser(r && r.users, displayName);
        if (name) return name;
      } catch { /* assignee resolution is best effort */ }
    }
    return null;
  }

  async function handleCreateTask(req, res) {
    if (!testGate(res)) return;
    let body;
    try { body = await ctx.readBody(req); } catch { body = null; }
    const K = await h.kanbanHelpers();
    const v = K.validateCreateTask(body);
    if (!v.ok) return ctx.jsonResponse(res, 400, { error: 'bad-request', field: v.field, message: v.message });
    const p = v.payload;
    try {
      const cfg = h.jiraWriteCfg();
      const http = h.httpClient();
      // The reporter is the token's owner; /myself also proves the token works before anything is created.
      await http.fetchJson(cfg.jiraUrl + '/rest/api/2/myself', { headers: jira.authHeaders(cfg), timeoutMs: 15000 });
      const assigneeName = await resolveAssignee(http, cfg, p.assignee);
      const created = await http.sendJson(cfg.jiraUrl + '/rest/api/2/issue',
        { method: 'POST', headers: jira.authHeaders(cfg), body: { fields: buildCreateFields(p, assigneeName) }, timeoutMs: 30000 });
      const key = created && typeof created.key === 'string' ? created.key : '';
      if (!jira.KEY_RE.test(key)) return ctx.jsonResponse(res, 502, { error: 'jira-no-key', message: 'Jira did not return the key of the new issue.' });
      // "Applies to" only exists after "Change type" is set, hence a second call; its failure keeps the task.
      let appliesToApplied = true;
      if (p.appliesTo) {
        try {
          await http.sendJson(cfg.jiraUrl + '/rest/api/2/issue/' + encodeURIComponent(key),
            { method: 'PUT', headers: jira.authHeaders(cfg), body: { fields: { [jira.JCP_APPLIES_TO_FIELD]: [p.appliesTo] } }, timeoutMs: 15000 });
        } catch { appliesToApplied = false; }
      }
      ctx.log('kanban created ' + key + ' under ' + p.epicKey);
      ctx.jsonResponse(res, 200, {
        ok: true, key, url: cfg.jiraUrl + '/browse/' + key, summary: p.summary,
        assigneeRequested: Boolean(p.assignee), assigneeResolved: Boolean(assigneeName), appliesToApplied,
      });
    } catch (e) {
      if (e && e.status === 400) return ctx.jsonResponse(res, 400, { error: 'jira-rejected', message: 'Jira rejected the new issue.', detail: e.detail || '' });
      h.sendJiraError(res, e);
    }
  }

  return [
    { method: 'GET', path: '/kanban/status', handler: handleStatus },
    { method: 'GET', path: '/kanban/board', handler: handleBoard },
    { method: 'POST', path: '/kanban/transition', handler: handleTransition },
    { method: 'POST', path: '/kanban/create-task', handler: handleCreateTask },
  ];
};

module.exports.mapIssues = mapIssues;
module.exports.buildLanes = buildLanes;
module.exports.buildBoard = buildBoard;
module.exports.pickColumnTransition = pickColumnTransition;
module.exports.buildCreateFields = buildCreateFields;
module.exports.pickUser = pickUser;
