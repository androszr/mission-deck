// modules/roadmap/client/kanban-helpers.js
// Pure helpers of the Kanban tab. No document,
// no fetch: the view (kanban.js) and the server (server/kanban.js, which imports this
// file dynamically) share ONE definition of the columns, the whitelisted Jira field
// values and the payload validation. Values sent to Jira stay ASCII (they are compared
// by Jira).
//
// Jira instance configuration (example values - replace them with your own): the
// status ids of each column, the task project key (DISC), the epic project keys
// (PROD, PLAT) and the option ids of the change type and work type fields.

// ---- Columns (bucketed by Jira status ID - names vary by locale) ---------------

export const KANBAN_COLUMNS = [
  { id: 'preparation', label: 'Preparation', statusIds: [1, 11100] },
  { id: 'todo', label: 'To do', statusIds: [10804] },
  { id: 'in-progress', label: 'In progress', statusIds: [3] },
  { id: 'blocked', label: 'Blocked', statusIds: [10401] },
  { id: 'done', label: 'Done', statusIds: [10100] },
];

// Columns whose cell collapses to COLLAPSE_MAX cards until expanded.
export const COLLAPSE_COLS = ['preparation', 'todo'];
export const COLLAPSE_MAX = 2;
export const UNMATCHED_LANE = '__other__';
export const UNMATCHED_LANE_TITLE = 'Other (not assigned to an initiative)';

export const ISSUE_KEY_RE = /^DISC-\d+$/;
export const EPIC_KEY_RE = /^(PROD|PLAT)-\d+$/;
export const SUMMARY_MAX = 255;
export const DESCRIPTION_MAX = 256 * 1024;
export const ASSIGNEE_MAX = 120;

export function colForStatus(statusId) {
  const n = Number(statusId);
  return KANBAN_COLUMNS.find((c) => c.statusIds.includes(n)) || null;
}

export function columnById(id) {
  return KANBAN_COLUMNS.find((c) => c.id === id) || null;
}

// ---- Whitelisted Jira values of the "Add task" form ------------------------------

export const CHANGE_TYPE_OPTIONS = [
  { value: '40222', label: 'Project work' },
  { value: '20736', label: 'Strategic project' },
  { value: '20737', label: 'Operational project' },
  { value: '20738', label: 'Business as usual change [BAU]' },
];
export const WORK_TYPE_OPTIONS = [
  { value: '40215', label: 'Technical development analysis (CAPEX)' },
  { value: '40216', label: 'Business implementation analysis ["to be"] (CAPEX)' },
  { value: '40500', label: 'Current state analysis ["as is"] (OPEX)' },
  { value: '40217', label: 'Environment setup (CAPEX)' },
  { value: '40218', label: 'Development work (CAPEX)' },
  { value: '40219', label: 'Testing [all] (CAPEX)' },
  { value: '40220', label: 'Project delivery meetings' },
  { value: '40221', label: 'Training / data migration (OPEX)' },
];
// `value` is what Jira stores; `label` is shown.
export const APPLIES_TO_OPTIONS = [
  { value: 'Platform', label: 'Platform' },
  { value: 'Ordering', label: 'Ordering' },
  { value: 'Marketplace', label: 'Marketplace' },
];
export const DEFAULT_CHANGE_TYPE = '40222';
export const DEFAULT_WORK_TYPE = '40216';
export const DEFAULT_APPLIES_TO = 'Platform';

// ---- Names -----------------------------------------------------------------------

const ROLE_CODES_RE = /^(?:CTR|EXT|VND)\s+|\s+(?:CTR|EXT|VND)$|\s*\([^)]*\)\s*$/gi;

/** Drops contractor codes (and a trailing "(...)") from a Jira display name. */
export function stripRoleCodes(name) {
  return String(name || '').replace(ROLE_CODES_RE, '').trim();
}

export function normSearch(text) {
  return String(text === null || text === undefined ? '' : text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0142/g, 'l');
}

/** "Jane Doe" label of a Jira display name; swaps a two-word "Doe Jane" when no directory name is known. */
export function personLabel(displayName, canonical = () => '') {
  const known = canonical(displayName);
  if (known) return known;
  const clean = stripRoleCodes(displayName);
  const parts = clean.split(/\s+/);
  return parts.length === 2 ? parts[1] + ' ' + parts[0] : clean;
}

export function initialsOf(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase() || '?';
}

// ---- Board shaping -----------------------------------------------------------------

/** Defensive normalisation of the GET /kanban/board answer. */
export function normalizeBoard(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    issues: Array.isArray(r.issues) ? r.issues.filter((i) => i && typeof i.key === 'string') : [],
    lanes: Array.isArray(r.lanes) ? r.lanes.filter((l) => l && l.id) : [],
    laneMap: r.laneMap && typeof r.laneMap === 'object' && !Array.isArray(r.laneMap) ? r.laneMap : {},
    jiraBase: typeof r.jiraBase === 'string' ? r.jiraBase : '',
  };
}

export const EMPTY_FILTERS = { search: '', unassigned: false, persons: null };

/** Pure: does the issue pass the filters? `persons` is null (everybody) or an array / Set of Jira display names. */
export function issueMatches(issue, filters) {
  const f = { ...EMPTY_FILTERS, ...(filters || {}) };
  if (f.unassigned && issue.assignee) return false;
  if (f.persons !== null && f.persons !== undefined) {
    const set = f.persons instanceof Set ? f.persons : new Set(f.persons);
    const name = issue.assignee ? issue.assignee.displayName : null;
    if (!name || !set.has(name)) return false;
  }
  if (f.search && f.search.trim()) {
    if (!normSearch(issue.key + ' ' + issue.summary).includes(normSearch(f.search.trim()))) return false;
  }
  return true;
}

/**
 * Pure: swim lanes x columns. Issues with a status outside the five columns
 * (e.g. Cancelled) are dropped. Lanes keep the `rank`
 * order, "Other" (issues no initiative claims) comes last and only when it has cards.
 * A lane that ends up empty is hidden while a search or person filter is active.
 * @returns {{ lanes: object[], colTotals: object, total: number }}
 */
export function groupBoard(board, filters) {
  const b = normalizeBoard(board);
  const f = { ...EMPTY_FILTERS, ...(filters || {}) };
  const filtering = Boolean(f.search && f.search.trim()) || (f.persons !== null && f.persons !== undefined);
  const byLane = new Map();
  for (const issue of b.issues) {
    if (!issueMatches(issue, f)) continue;
    const col = colForStatus(issue.statusId);
    if (!col) continue;
    const laneId = b.laneMap[issue.key] || UNMATCHED_LANE;
    if (!byLane.has(laneId)) byLane.set(laneId, {});
    const cols = byLane.get(laneId);
    (cols[col.id] = cols[col.id] || []).push(issue);
  }
  const colTotals = {};
  for (const c of KANBAN_COLUMNS) colTotals[c.id] = 0;
  let total = 0;
  const sorted = [...b.lanes].sort((x, y) => (x.rank || 0) - (y.rank || 0));
  if (byLane.has(UNMATCHED_LANE)) sorted.push({ id: UNMATCHED_LANE, title: UNMATCHED_LANE_TITLE, rank: 9999, epicKey: null });
  const lanes = [];
  for (const lane of sorted) {
    const cols = byLane.get(lane.id) || {};
    const laneTotal = KANBAN_COLUMNS.reduce((s, c) => s + (cols[c.id] || []).length, 0);
    for (const c of KANBAN_COLUMNS) colTotals[c.id] += (cols[c.id] || []).length;
    total += laneTotal;
    if (laneTotal === 0 && filtering) continue;
    lanes.push({ id: String(lane.id), title: lane.title || String(lane.id), epicKey: lane.epicKey || null, total: laneTotal, cols });
  }
  return { lanes, colTotals, total };
}

/** Pure: the cards of one cell that are shown, and how many are hidden by the collapse limit. */
export function cellView(cards, colId, expanded) {
  const list = Array.isArray(cards) ? cards : [];
  const collapsible = COLLAPSE_COLS.includes(colId) && list.length > COLLAPSE_MAX;
  return {
    visible: collapsible && !expanded ? list.slice(0, COLLAPSE_MAX) : list,
    hidden: collapsible ? list.length - COLLAPSE_MAX : 0,
    collapsible,
  };
}

/** Pure: assignees of the issues that sit in a column, for the person chips (sorted by label). */
export function collectPersons(issues, canonical = () => '') {
  const map = new Map();
  for (const issue of Array.isArray(issues) ? issues : []) {
    if (!issue.assignee || !issue.assignee.displayName || !colForStatus(issue.statusId)) continue;
    const name = issue.assignee.displayName;
    if (!map.has(name)) map.set(name, { displayName: name, label: personLabel(name, canonical) });
  }
  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'en'));
}

/** Pure: the next `persons` filter after a click on a chip (null = everybody; all selected collapses to null). */
export function togglePerson(current, name, allNames) {
  if (current === null || current === undefined) return [name];
  const set = new Set(current);
  if (set.has(name)) set.delete(name); else set.add(name);
  if (set.size === 0) return null;
  if (allNames && set.size === allNames.length) return null;
  return [...set];
}

/** Pure: the board with one card moved to another column (optimistic UI); the status id becomes the target's first one. */
export function moveIssue(board, key, targetColId) {
  const col = columnById(targetColId);
  if (!col) return board;
  const b = normalizeBoard(board);
  return { ...b, issues: b.issues.map((i) => (i.key === key ? { ...i, statusId: col.statusIds[0] } : i)) };
}

/** Pure: the neighbouring column of a card (delta -1 / +1) for the keyboard move; null at the edge or for an unknown status. */
export function stepColumn(issue, delta) {
  const cur = colForStatus(issue && issue.statusId);
  if (!cur) return null;
  return KANBAN_COLUMNS[KANBAN_COLUMNS.indexOf(cur) + delta] || null;
}

/** Pure: the columns a card can be moved to from its current one (keyboard alternative to dragging). */
export function moveTargets(issue) {
  const cur = colForStatus(issue && issue.statusId);
  return KANBAN_COLUMNS.filter((c) => !cur || c.id !== cur.id);
}

// ---- Badges, priority, dates ------------------------------------------------------

export function typeBadgeClass(issueType) {
  const t = String(issueType || '').toLowerCase();
  if (t.includes('story')) return 'ds-badge--green';
  if (t.includes('analysis')) return 'ds-badge--violet';
  if (t.includes('bug')) return 'ds-badge--red';
  return 'ds-badge--blue';
}

const PRIORITY_COLOR = {
  Highest: 'var(--state-danger-text)',
  High: 'var(--state-danger-text)',
  Medium: 'var(--state-warning-icon)',
  Low: 'var(--state-info-text)',
  Lowest: 'var(--state-inactive-text)',
};

export function priorityColor(priority) {
  return PRIORITY_COLOR[priority] || 'var(--body-tertiary-text)';
}

export function formatUpdated(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

// ---- Token policy (display side) --------------------------------------------------

export const TECH_TOKEN_NOTE = 'You are using the technical token - unlock the vault to work on your own account.';
export const NO_TOKEN_MESSAGE = 'No Jira token - unlock the Bitwarden vault in the top bar and try again.';

/** Pure: normalises GET /kanban/status; writes need the personal token. */
export function normalizeStatus(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const token = r.token === 'personal' || r.token === 'technical' ? r.token : null;
  return { token, canWrite: token === 'personal' && r.testMode !== true, testMode: r.testMode === true };
}

// ---- Payload builders / validators (shared by the view and the server) ------------

/** Pure: { ok, payload } or { ok: false, message } for POST /kanban/create-task. */
export function validateCreateTask(input) {
  const b = input && typeof input === 'object' ? input : {};
  const epicKey = typeof b.epicKey === 'string' ? b.epicKey.trim().toUpperCase() : '';
  if (!EPIC_KEY_RE.test(epicKey)) return { ok: false, field: 'epicKey', message: 'The epic key must look like PROD-123 or PLAT-123.' };
  const summary = typeof b.summary === 'string' ? b.summary.trim() : '';
  if (!summary) return { ok: false, field: 'summary', message: 'A title is required.' };
  if (summary.length > SUMMARY_MAX) return { ok: false, field: 'summary', message: 'The title is too long (at most ' + SUMMARY_MAX + ' characters).' };
  const description = typeof b.description === 'string' ? b.description.trim() : '';
  if (description.length > DESCRIPTION_MAX) return { ok: false, field: 'description', message: 'The description is too long.' };
  const changeTypeId = typeof b.changeTypeId === 'string' && b.changeTypeId.trim() ? b.changeTypeId.trim() : DEFAULT_CHANGE_TYPE;
  if (!CHANGE_TYPE_OPTIONS.some((o) => o.value === changeTypeId)) return { ok: false, field: 'changeTypeId', message: 'Unknown change type.' };
  const workTypeId = typeof b.workTypeId === 'string' && b.workTypeId.trim() ? b.workTypeId.trim() : DEFAULT_WORK_TYPE;
  if (!WORK_TYPE_OPTIONS.some((o) => o.value === workTypeId)) return { ok: false, field: 'workTypeId', message: 'Unknown work type.' };
  const appliesTo = typeof b.appliesTo === 'string' ? b.appliesTo.trim() : '';
  if (appliesTo && !APPLIES_TO_OPTIONS.some((o) => o.value === appliesTo)) return { ok: false, field: 'appliesTo', message: 'Unknown value of the "Applies to" field.' };
  const assignee = typeof b.assignee === 'string' ? b.assignee.trim() : '';
  if (assignee.length > ASSIGNEE_MAX) return { ok: false, field: 'assignee', message: 'The person name is too long.' };
  return { ok: true, payload: { epicKey, summary, description, changeTypeId, workTypeId, appliesTo, assignee } };
}

/** Pure: the POST body of "Create" from raw form values (the server validates again). */
export function buildCreatePayload(form, epicKey) {
  const f = form || {};
  const body = { epicKey, summary: String(f.summary || '').trim() };
  if (f.description && String(f.description).trim()) body.description = String(f.description).trim();
  body.appliesTo = String(f.appliesTo || '').trim();
  body.changeTypeId = String(f.changeTypeId || '');
  body.workTypeId = String(f.workTypeId || '');
  if (f.assignee && String(f.assignee).trim()) body.assignee = String(f.assignee).trim();
  return body;
}

/** Pure: { ok, payload } or { ok: false, message } for POST /kanban/transition. */
export function validateTransition(input) {
  const b = input && typeof input === 'object' ? input : {};
  const key = typeof b.key === 'string' ? b.key.trim().toUpperCase() : '';
  if (!ISSUE_KEY_RE.test(key)) return { ok: false, message: 'The issue key must look like DISC-123.' };
  const targetColId = typeof b.targetColId === 'string' ? b.targetColId.trim() : '';
  if (!columnById(targetColId)) return { ok: false, message: 'Unknown column.' };
  return { ok: true, payload: { key, targetColId } };
}

export function buildTransitionPayload(key, targetColId) {
  return { key, targetColId };
}
