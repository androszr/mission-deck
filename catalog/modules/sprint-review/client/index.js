// modules/sprint-review/client/index.js
// Sprint Review - one card per team the session actually carries, built on
// the module contract (modules/sprint-review/server/*) and DS
// classes/tokens.
//
// The card list is ALWAYS teamOrder(session) (teamGoals page order, plus any
// orphan submissions key) - never status.meeting.teams, which is only the
// seeding lineup for "New session". Dual-section membership (today: "Echo")
// comes from status.meeting.dualSectionTeams, read at every call site
// through _dualSectionTeams() - this file names no team literally anywhere.
//
// Core helpers used: deps.showToast, dynamic import('/js/empty-state.js'),
// ('/js/team-directory.js'), ('/js/ds-modal.js') and ('/js/ds-select.js'),
// each with a safe fallback.
//
// Core ESM (`/js/...`) is reached ONLY through a dynamic import inside
// init(), in a try/catch, with a safe fallback for every bridged call - the
// contract test (tests/test_sprint_review.mjs) reads this file in plain
// Node with no document and no "/js/..." URL resolver.

import {
  esc, formatCountdown, isHistorical, sessionLabel, sortSessions,
  buildAgendaText, renderAgendaMd, visualAgendaFilename, discoverBadge,
  poCandidates, presenterCandidates, fullNameOf, FORMAT_LABELS,
  teamOrder, sectionsFor, topicsOf, hasAnyTopics, TOPIC_SECTIONS, teamLogoSlug,
} from './sprint-review-lib.mjs';

const ROOT_ID = 'sprint-review-main-root';
const ACTIONS_ID = 'sprint-review-main-actions';

const UP_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 15l-6-6-6 6"/></svg>';
const DOWN_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
const EDIT_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
const DELETE_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16Z"/></svg>';
const REFRESH_ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Bridged core ESM namespaces once loaded, else null - every caller checks
// before use, so a load failure degrades (initials instead of photos, a
// bare select, a plain ds-callout) rather than throwing.
let _deps = null;
let _dsModal = null;
let _dsSelect = null;
let _teamDir = null;
let _emptyState = null;

// Module-level state - one view instance for the app session.
let _status = null; // last GET /status answer
let _sessions = []; // last GET /sessions answer's `sessions` (index entries)
let _activeId = null;
let _activeSession = null; // last GET /session?id= answer
let _agendaText = '';
let _countdownTimer = null;
let _actionsWired = false;
let _bodyWired = false;

function _api(path) {
  return (_deps && _deps.apiBase ? _deps.apiBase : '/api/m/sprint-review') + path;
}

// Page rule for which team carries two topic-list sections, published by the
// server on GET /status - never hardcoded here. Falls back to sprint-review-lib.mjs's own mirror constant
// before /status has answered once.
function _dualSectionTeams() {
  return (_status && _status.meeting && Array.isArray(_status.meeting.dualSectionTeams))
    ? _status.meeting.dualSectionTeams
    : undefined;
}

function _toast(variant, title, desc) {
  if (_deps && typeof _deps.showToast === 'function') _deps.showToast(variant, title, desc || '');
}

function _root() {
  return document.getElementById(ROOT_ID);
}

function _fmtDateLong(iso) {
  if (!iso || iso.length < 10) return '';
  const d = new Date(iso + 'T12:00:00Z');
  return WEEKDAYS[d.getUTCDay()] + ', ' + d.getUTCDate() + ' ' + MONTHS_LONG[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
}

// ── team-directory bridge (all safe when the dynamic import never lands) ───

function _teamMembers() {
  return _teamDir && typeof _teamDir.getTeamMembers === 'function' ? _teamDir.getTeamMembers() : [];
}

function _memberByName(name) {
  return _teamDir && typeof _teamDir.memberByName === 'function' ? _teamDir.memberByName(name) : null;
}

function _memberAvatarUrl(member) {
  return _teamDir && typeof _teamDir.memberAvatarUrl === 'function' ? _teamDir.memberAvatarUrl(member) : '';
}

function _memberInitials(name) {
  if (_teamDir && typeof _teamDir.memberInitials === 'function') return _teamDir.memberInitials(name);
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '??';
  return (parts[0][0] + (parts[1] ? parts[1][0] : parts[0][1] || '')).toUpperCase();
}

function _fullNameOf(member) {
  if (_teamDir && typeof _teamDir.fullName === 'function') {
    const full = _teamDir.fullName(member);
    if (full) return full;
  }
  return fullNameOf(member);
}

function _refreshTeamDir() {
  if (!_teamDir || typeof _teamDir.loadTeamDirectory !== 'function') return;
  const before = _teamMembers().length;
  _teamDir.loadTeamDirectory()
    .then(() => {
      if (_teamMembers().length !== before) {
        const root = _root();
        if (root && _activeSession) _paintSessionArea(root);
      }
    })
    .catch(() => { /* an empty directory is a normal state */ });
}

// ── header action slot ──────────────────────────────────────────────────

function _paintActionsSkeleton() {
  const actions = document.getElementById(ACTIONS_ID);
  if (!actions) return;
  actions.innerHTML =
    '<button type="button" class="ds-btn ds-btn--primary" data-skel="1" disabled>New session</button>'
    + '<button type="button" class="ds-btn ds-btn--secondary" data-skel="1" disabled>Import from Confluence</button>';
}

function _paintActions() {
  const actions = document.getElementById(ACTIONS_ID);
  if (!actions) return;
  const disabled = !_status || _status.storage === 'unavailable';
  actions.innerHTML =
    '<button type="button" class="ds-btn ds-btn--primary" data-sr-new' + (disabled ? ' disabled' : '') + '>New session</button>'
    + '<button type="button" class="ds-btn ds-btn--secondary" data-sr-import' + (disabled ? ' disabled' : '') + '>Import from Confluence</button>';
  if (_actionsWired) return;
  _actionsWired = true;
  const onClick = (e) => {
    const root = _root();
    if (e.target.closest('[data-sr-new]')) { _openNewSessionModal(root); return; }
    if (e.target.closest('[data-sr-import]')) { _openConfluenceModal(root); }
  };
  actions.addEventListener('click', onClick);
  _deps.registerViewCleanup(() => {
    actions.removeEventListener('click', onClick);
    _actionsWired = false;
  });
}

// ── empty / unavailable / error states ──────────────────────────────────

function _skeletonHtml() {
  return '<div class="sr-skeleton" data-skel="1">'
    + '<span class="ds-skeleton" style="width:260px;height:32px;display:block;margin-bottom:16px"></span>'
    + '<span class="ds-skeleton" style="width:100%;height:120px;display:block;margin-bottom:16px"></span>'
    + '<span class="ds-skeleton" style="width:100%;height:220px;display:block"></span>'
    + '</div>';
}

function _errorHtml() {
  return '<div class="ds-callout ds-callout--danger"><div>Could not load the Sprint Review data. Reload the page and try again.</div></div>';
}

function _unavailableHtml() {
  return '<div class="ds-callout ds-callout--warning"><div>The team data is not fetched to this computer yet. '
    + 'Fetch the "Team data" source with the button on the top bar.</div></div>';
}

async function _emptyStateHtml() {
  if (!_emptyState) {
    try { _emptyState = await import('/js/empty-state.js'); } catch { _emptyState = null; }
  }
  if (_emptyState && typeof _emptyState.emptyHeroHtml === 'function') {
    return _emptyState.emptyHeroHtml({
      title: 'No Sprint Review sessions',
      message: 'Click "New session" or "Import from Confluence" to plan the meeting.',
    });
  }
  return '<div class="ds-callout ds-callout--info"><div>No Sprint Review sessions. '
    + 'Click "New session" or "Import from Confluence" to plan the meeting.</div></div>';
}

// ── session selector ─────────────────────────────────────────────────────

function _selectorHtml(sorted, activeId) {
  const opts = sorted.map((s) => {
    const label = sessionLabel(s, new Date());
    return '<option value="' + esc(s.id) + '"' + (s.id === activeId ? ' selected' : '') + '>' + esc(label) + '</option>';
  }).join('');
  return '<div class="sr-session-selector">'
    + '<label class="ds-label" for="sr-session-select">Sprint Review session</label>'
    + '<select id="sr-session-select" class="ds-input">' + opts + '</select>'
    + '</div>';
}

// ── session header ───────────────────────────────────────────────────────

function _sessionHeaderHtml(session) {
  const now = new Date();
  const historical = isHistorical(session, now);
  const deadline = session.deadline ? new Date(session.deadline) : null;
  const isPast = !!(deadline && deadline.getTime() < now.getTime());
  const sprintLabel = session.sprintName || (session.sprintN ? 'Sprint ' + session.sprintN : 'Sprint Review');
  const reviewDateLabel = session.reviewDate ? _fmtDateLong(session.reviewDate) : '';

  const badges = (historical
    ? '<span class="ds-badge ds-badge--gray">Archive</span>'
    : '<span class="ds-badge ds-badge--green">Upcoming</span>')
    + (session.sprintN ? ' <span class="ds-badge ds-badge--blue">Sprint ' + esc(String(session.sprintN)) + '</span>' : '');

  const refreshBtn = session.confluencePageId
    ? '<button type="button" class="ds-icon-btn ds-icon-btn--sm" data-sr-session-refresh data-page-id="' + esc(session.confluencePageId) + '" aria-label="Refresh from Confluence">' + REFRESH_ICON + '</button>'
    : '';

  const countdownHtml = (deadline && !historical)
    ? '<div class="sr-meta-line sr-countdown' + (isPast ? ' sr-countdown--past' : '') + '">'
      + '<span class="ds-hint">Deadline</span>'
      + '<strong><span class="sr-countdown-value" id="sr-countdown-value">'
      + esc(isPast ? 'Deadline passed' : formatCountdown(deadline, now)) + '</span></strong>'
      + '</div>'
    : '';

  const facilitatorHtml = session.facilitatorPo
    ? '<div class="sr-meta-line"><span class="ds-hint">Facilitator (PO)</span><strong>' + esc(session.facilitatorPo) + '</strong></div>'
    : '';

  const reviewDateHtml = reviewDateLabel
    ? '<div class="sr-meta-line"><span class="ds-hint">Sprint Review date</span><strong>' + esc(reviewDateLabel) + '</strong></div>'
    : '';

  return '<div class="sr-session-header">'
    + '<div class="sr-session-title"><h2>' + esc(sprintLabel) + '</h2>'
    + '<div class="sr-session-badges">' + badges + refreshBtn + '</div></div>'
    + '<div class="sr-session-meta">' + reviewDateHtml + facilitatorHtml + countdownHtml + '</div>'
    + '</div>';
}

// ── team card ────────────────────────────────────────────────────────────

function _realizationSegmentedHtml(sub, locked) {
  const rs = sub.realizationStatus || '';
  function seg(val, label) {
    const active = rs === val;
    return '<button type="button" class="ds-segment' + (active ? ' active' : '') + '" data-sr-status="' + val + '" aria-pressed="' + active + '"' + (locked ? ' disabled' : '') + '>' + label + '</button>';
  }
  return '<div class="sr-realization-wrap">'
    + '<span class="ds-hint">Sprint goal status</span>'
    + '<div class="ds-segmented" role="group" aria-label="Sprint goal status">'
    + seg('achieved', 'Achieved') + seg('partial', 'Partially') + seg('not-achieved', 'Not achieved')
    + '</div></div>';
}

function _presentersHtml(presenters) {
  if (!presenters.length) return '<span class="ds-hint">None</span>';
  return presenters.map((name) => {
    const member = _memberByName(name);
    const avatarSrc = _memberAvatarUrl(member);
    const display = member ? _fullNameOf(member) : name;
    const img = avatarSrc
      ? '<img class="sr-presenter-avatar" src="' + esc(avatarSrc) + '" alt="" loading="lazy">'
      : '<span class="sr-presenter-avatar sr-presenter-avatar--initials">' + esc(_memberInitials(name)) + '</span>';
    return '<span class="sr-presenter">' + img + '<span>' + esc(display) + '</span></span>';
  }).join('');
}

function _topicsTableHtml(topics, locked, sectionKey) {
  if (!topics.length) {
    return '<div class="ds-callout ds-callout--info"><div>No topics submitted.</div></div>';
  }
  const rows = topics.map((t, idx) => {
    const formatLabel = FORMAT_LABELS[t.format] || '-';
    const upDisabled = (idx === 0 || locked) ? ' disabled' : '';
    const downDisabled = (idx === topics.length - 1 || locked) ? ' disabled' : '';
    const editDisabled = locked ? ' disabled' : '';
    const sec = esc(sectionKey);
    return '<tr data-sr-topic-id="' + esc(t.id) + '">'
      + '<td>' + esc(t.title) + '</td>'
      + '<td>' + _presentersHtml(t.presenters || []) + '</td>'
      + '<td>' + esc(formatLabel) + '</td>'
      + '<td class="sr-topic-actions"><div class="sr-topic-actions-row">'
      + '<button type="button" class="ds-icon-btn ds-icon-btn--sm" data-sr-move-up data-sr-section="' + sec + '" data-sr-topic-id="' + esc(t.id) + '" aria-label="Move up"' + upDisabled + '>' + UP_ICON + '</button>'
      + '<button type="button" class="ds-icon-btn ds-icon-btn--sm" data-sr-move-down data-sr-section="' + sec + '" data-sr-topic-id="' + esc(t.id) + '" aria-label="Move down"' + downDisabled + '>' + DOWN_ICON + '</button>'
      + '<button type="button" class="ds-icon-btn ds-icon-btn--sm" data-sr-edit-topic data-sr-section="' + sec + '" data-sr-topic-id="' + esc(t.id) + '" aria-label="Edit topic"' + editDisabled + '>' + EDIT_ICON + '</button>'
      + '<button type="button" class="ds-icon-btn ds-icon-btn--sm" data-sr-delete-topic data-sr-section="' + sec + '" data-sr-topic-id="' + esc(t.id) + '" aria-label="Delete topic"' + editDisabled + '>' + DELETE_ICON + '</button>'
      + '</div></td></tr>';
  }).join('');
  return '<div class="ds-table-wrap"><table class="ds-table">'
    + '<thead><tr><th>Topic</th><th>Presenter</th><th>Format</th><th></th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table></div>';
}

function _presenterChipsHtml(team, selected) {
  const members = presenterCandidates(_teamMembers(), team);
  if (!members.length) return '<span class="ds-hint">The team directory is not fetched yet - photos and the list appear after a sync.</span>';
  return members.map((m) => {
    const name = _fullNameOf(m);
    const isSel = selected.indexOf(name) !== -1;
    return '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm sr-presenter-chip' + (isSel ? ' active' : '') + '" data-sr-presenter="' + esc(name) + '" aria-pressed="' + isSel + '">' + esc(name) + '</button>';
  }).join('');
}

function _topicFormHtml(team, editing) {
  const title = editing ? editing.title : '';
  const format = editing ? editing.format : '';
  const presenters = editing ? (editing.presenters || []) : [];
  return '<div class="sr-topic-form-fields">'
    + '<label class="ds-label" for="sr-topic-title-input">What will you present</label>'
    + '<input type="text" class="ds-input" id="sr-topic-title-input" maxlength="200" value="' + esc(title) + '" placeholder="Topic description...">'
    + '<label class="ds-label" for="sr-topic-format-select">Format</label>'
    + '<select class="ds-input" id="sr-topic-format-select">'
    + '<option value=""' + (format === '' ? ' selected' : '') + '>Choose...</option>'
    + '<option value="presentation"' + (format === 'presentation' ? ' selected' : '') + '>Presentation</option>'
    + '<option value="discussion"' + (format === 'discussion' ? ' selected' : '') + '>Discussion</option>'
    + '</select>'
    + '<div class="ds-label">Presenters</div>'
    + '<div class="sr-presenter-chips" data-sr-presenter-chips>' + _presenterChipsHtml(team, presenters) + '</div>'
    + '</div>'
    + '<div class="ds-actions">'
    + '<button type="button" class="ds-btn ds-btn--primary ds-btn--sm" data-sr-topic-save>' + (editing ? 'Save' : 'Add') + '</button>'
    + '<button type="button" class="ds-btn ds-btn--tertiary ds-btn--sm" data-sr-topic-cancel>Cancel</button>'
    + '</div>'
    + '<div class="ds-callout ds-callout--danger" data-sr-topic-error hidden><div></div></div>';
}

function _lockBarHtml(team, locked) {
  return '<div class="sr-lock-bar">'
    + (locked
      ? '<span class="ds-hint">Card locked for editing</span>'
        + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-sr-lock-toggle data-sr-team="' + esc(team) + '" data-sr-locked="1">Unlock editing</button>'
      : '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-sr-lock-toggle data-sr-team="' + esc(team) + '" data-sr-locked="0">Finish editing</button>')
    + '</div>';
}

function _topicsSectionHtml(session, team, sectionKey, locked) {
  const sub = (session.submissions && session.submissions[team]) || {};
  const topics = topicsOf(sub, sectionKey);
  const label = TOPIC_SECTIONS[sectionKey] || 'Topics';
  return '<div class="sr-topics-section" data-sr-section="' + esc(sectionKey) + '">'
    + '<div class="ds-section-head"><h3 class="ds-section-head-title">' + esc(label) + '</h3>'
    + '<div class="ds-section-head-actions">'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-sr-add-topic data-sr-team="' + esc(team) + '" data-sr-section="' + esc(sectionKey) + '"' + (locked ? ' disabled' : '') + '>Add topic</button>'
    + '</div></div>'
    + _topicsTableHtml(topics, locked, sectionKey)
    + '<div class="sr-topic-form" data-sr-topic-form hidden></div>'
    + '</div>';
}

function _teamCardHtml(session, team) {
  const sub = (session.submissions && session.submissions[team]) || { submitted: false, realizationStatus: '' };
  const goal = Array.isArray(session.teamGoals) ? session.teamGoals.find((g) => g.team === team) : null;
  const locked = !!sub.submitted;
  const badgeCls = locked ? 'ds-badge--green' : 'ds-badge--yellow';
  const badgeLabel = locked ? 'Confirmed' : 'Pending';
  const goalHtml = '<div class="sr-goal-line"><span class="ds-hint">Sprint goal</span>'
    + (goal && goal.goal
      ? '<span>' + esc(goal.goal) + '</span>'
      : '<span class="ds-hint">No sprint goal</span>')
    + '</div>';
  const sectionsHtml = sectionsFor(team, _dualSectionTeams())
    .map((sec) => _topicsSectionHtml(session, team, sec, locked))
    .join('');

  return '<div class="ds-card sr-team-card' + (locked ? ' sr-team-card--locked' : '') + '" data-sr-team="' + esc(team) + '">'
    + '<div class="ds-card-header"><div class="ds-card-title">' + esc(team) + '</div><span class="ds-badge ' + badgeCls + '">' + badgeLabel + '</span></div>'
    + '<div class="ds-card-body">'
    + goalHtml
    + _realizationSegmentedHtml(sub, locked)
    + '<div class="sr-section-head-inline">'
    + sectionsHtml
    + '</div>'
    + _lockBarHtml(team, locked)
    + '</div></div>';
}

// ── agenda card ──────────────────────────────────────────────────────────

function _agendaCardHtml(session) {
  const hasTopics = hasAnyTopics(session, _dualSectionTeams());
  const agendaPanel = _agendaText
    ? '<div class="sr-agenda-panel">'
      + '<div class="ds-section-head"><h3 class="ds-section-head-title">Preview</h3>'
      + '<div class="ds-section-head-actions"><button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-sr-copy-agenda>Copy</button></div></div>'
      + '<div class="sr-agenda-rendered">' + renderAgendaMd(_agendaText) + '</div>'
      + '<textarea class="ds-textarea sr-agenda-raw" readonly aria-label="Agenda text" data-sr-agenda-raw>' + esc(_agendaText) + '</textarea>'
      + '</div>'
    : '';
  return '<div class="ds-section-head"><h2 class="ds-section-head-title">Agenda</h2></div>'
    + '<div class="ds-card sr-agenda-card"><div class="ds-card-body">'
    + '<div class="ds-actions">'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-sr-generate-agenda' + (hasTopics ? '' : ' disabled') + '>Generate agenda</button>'
    + '<button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-sr-download-agenda>Download visual agenda</button>'
    + '</div>'
    + agendaPanel
    + '</div></div>';
}

// ── body assembly ────────────────────────────────────────────────────────

function _teamsAreaHtml(session) {
  const teams = teamOrder(session);
  if (!teams.length) {
    return '<div class="ds-callout ds-callout--info"><div>This session has no teams yet - '
      + 'import a page from Confluence or create the session again.</div></div>';
  }
  return '<div class="sr-team-grid">' + teams.map((t) => _teamCardHtml(session, t)).join('') + '</div>';
}

function _bodyHtml(sorted, session) {
  if (!session) return _errorHtml();
  const selectorHtml = sorted.length > 1 ? _selectorHtml(sorted, session.id) : '';
  return selectorHtml
    + _sessionHeaderHtml(session)
    + '<div class="ds-section-head"><h2 class="ds-section-head-title">Teams</h2></div>'
    + _teamsAreaHtml(session)
    + _agendaCardHtml(session)
    + '<div class="sr-danger-zone">'
    + '<button type="button" class="ds-btn ds-btn--danger ds-btn--sm" data-sr-delete-session>Delete session</button>'
    + '</div>';
}

function _initSelects(root) {
  if (!_dsSelect) return;
  const sel = root.querySelector('#sr-session-select');
  if (sel) { try { _dsSelect.initSelect(sel); } catch { /* bare select still works */ } }
}

function _paintSessionArea(root) {
  if (!root) return;
  const sorted = sortSessions(_sessions);
  root.innerHTML = _bodyHtml(sorted, _activeSession);
  _wireBody(root);
  _initSelects(root);
  _startCountdownFor(_activeSession);
}

// ── countdown ────────────────────────────────────────────────────────────

function _clearCountdown() {
  if (_countdownTimer !== null) { clearInterval(_countdownTimer); _countdownTimer = null; }
}

function _startCountdownFor(session) {
  _clearCountdown();
  if (!session || !session.deadline || isHistorical(session, new Date())) return;
  const deadline = new Date(session.deadline);
  _countdownTimer = setInterval(() => {
    const el = document.getElementById('sr-countdown-value');
    if (!el) { _clearCountdown(); return; }
    const now = new Date();
    if (deadline.getTime() - now.getTime() <= 0) {
      el.textContent = 'Deadline passed';
      const wrap = el.closest('.sr-countdown');
      if (wrap) wrap.classList.add('sr-countdown--past');
      _clearCountdown();
      return;
    }
    el.textContent = formatCountdown(deadline, now);
  }, 60000);
  _deps.registerViewCleanup(() => _clearCountdown());
}

// ── data reload helpers ──────────────────────────────────────────────────

// Every write below (a team patch, a new / deleted session, a Confluence
// import) lands in data-tier-0's sprint-review/ and has already repainted
// the view from the server's answer. Announcing it on the core's data bus
// makes the core repaint the module sync bar (local date, pending files);
// onDataChanged() then finds nothing new (_dataKey) and leaves the view -
// and the generated agenda - alone. Dynamic import keeps this file Node-safe.
async function _announceDataWrite() {
  try {
    const ev = await import('/js/data-events.js');
    ev.emitDataChanged({ source: 'sprint-review' });
  } catch { /* the bar catches up on the next view entry */ }
}

/** What the view is painted from, as one comparable string. */
function _dataKey(status, sessions, active) {
  const list = (sessions || []).map((x) => x.id + '@' + (x.updatedAt || '')).sort().join('|');
  try { return JSON.stringify(status || null) + '#' + list + '#' + JSON.stringify(active || null); } catch { return null; }
}

/** The same three answers _render reads, as a _dataKey; null when any fails. */
async function _fetchDataKey() {
  try {
    const [statusRes, sessionsRes] = await Promise.all([fetch(_api('/status')), fetch(_api('/sessions'))]);
    if (!statusRes.ok || !sessionsRes.ok) return null;
    const status = await statusRes.json();
    const sessionsData = await sessionsRes.json();
    let active = null;
    if (_activeId) {
      const res = await fetch(_api('/session?id=' + encodeURIComponent(_activeId)));
      if (!res.ok) return null;
      active = await res.json();
    }
    return _dataKey(status, sessionsData.sessions || [], active);
  } catch {
    return null;
  }
}

async function _reloadSessions(root) {
  try {
    const res = await fetch(_api('/sessions'));
    const data = await res.json();
    _sessions = data.sessions || [];
  } catch { /* keep the previous list rather than blanking it */ }
  if (_activeId) {
    try {
      const res2 = await fetch(_api('/session?id=' + encodeURIComponent(_activeId)));
      _activeSession = res2.ok ? await res2.json() : null;
    } catch { _activeSession = null; }
  }
  _paintSessionArea(root);
}

function _updateSessionsEntry(session) {
  const entry = {
    id: session.id, reviewDate: session.reviewDate, sprintN: session.sprintN,
    sprintName: session.sprintName, meeting: session.meeting,
    confluencePageId: session.confluencePageId, confluenceVersion: session.confluenceVersion,
    updatedAt: session.updatedAt,
  };
  const idx = _sessions.findIndex((s) => s.id === session.id);
  if (idx === -1) _sessions.push(entry); else _sessions[idx] = entry;
}

async function _saveTeamPatch(team, patch, root) {
  try {
    const res = await fetch(_api('/session/team?id=' + encodeURIComponent(_activeId) + '&team=' + encodeURIComponent(team)), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (!res.ok) throw new Error((data && data.message) || 'Could not save the changes.');
    _activeSession = data;
    _updateSessionsEntry(data);
    _paintSessionArea(root);
    _announceDataWrite();
    return true;
  } catch (e) {
    _toast('danger', 'Save failed', e.message || '');
    return false;
  }
}

async function _importConfluencePage(pageId) {
  try {
    const res = await fetch(_api('/confluence-import?pageId=' + encodeURIComponent(pageId)), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, error: data };
    return { ok: true, session: data };
  } catch (e) {
    return { ok: false, error: { message: e.message } };
  }
}

async function _confirmReimport(trigger) {
  if (!_dsModal) return true;
  return _dsModal.confirmDsModal({
    title: 'Refresh from Confluence?',
    body: 'Refreshing from Confluence updates the sprint goal, the date and the facilitator. '
      + 'Topics added and edited by hand are kept, new topics from Confluence are added; '
      + 'in the rare case of a title fixed in Confluence a duplicate may appear.',
    okLabel: 'Refresh',
    trigger,
  });
}

// ── body event handlers ──────────────────────────────────────────────────

function _findTopic(team, sectionKey, topicId) {
  const sub = (_activeSession && _activeSession.submissions && _activeSession.submissions[team]) || {};
  const topics = topicsOf(sub, sectionKey);
  return topics.find((t) => t.id === topicId) || null;
}

// A team name is arbitrary text read off a Confluence <h2> - it may contain
// a quote or another character that would break a `[data-sr-team="..."]`
// attribute selector built by string concatenation. Iterating and comparing
// `dataset` needs no escaping and cannot be broken by page content.
function _findTeamCard(root, team) {
  for (const card of root.querySelectorAll('.sr-team-card')) {
    if (card.dataset.srTeam === team) return card;
  }
  return null;
}

function _findTopicsSection(card, sectionKey) {
  if (!card) return null;
  for (const section of card.querySelectorAll('.sr-topics-section')) {
    if (section.dataset.srSection === sectionKey) return section;
  }
  return null;
}

function _showTopicForm(root, team, sectionKey, topic) {
  const card = _findTeamCard(root, team);
  if (!card) return;
  // A dual-section team's card carries two [data-sr-topic-form] containers -
  // only one is ever open at a time, or the duplicate #sr-topic-title-input
  // / #sr-topic-format-select ids in the document would point a <label> at
  // the wrong input.
  card.querySelectorAll('[data-sr-topic-form]').forEach((other) => {
    if (!other.hidden) { other.hidden = true; other.innerHTML = ''; }
  });
  const section = _findTopicsSection(card, sectionKey);
  const container = section && section.querySelector('[data-sr-topic-form]');
  if (!container) return;
  container.dataset.srTeam = team;
  container.dataset.srSection = sectionKey;
  if (topic) container.dataset.srTopicId = topic.id; else delete container.dataset.srTopicId;
  container.innerHTML = _topicFormHtml(team, topic);
  container.hidden = false;
  const titleInput = container.querySelector('#sr-topic-title-input');
  if (titleInput) titleInput.focus();
  const formatSelect = container.querySelector('#sr-topic-format-select');
  if (formatSelect && _dsSelect) { try { _dsSelect.initSelect(formatSelect); } catch { /* bare select still works */ } }
}

function _hideTopicForm(target) {
  const form = target.closest('[data-sr-topic-form]');
  if (form) { form.hidden = true; form.innerHTML = ''; }
}

async function _saveTopicForm(root, saveBtn) {
  const container = saveBtn.closest('[data-sr-topic-form]');
  if (!container) return;
  const team = container.dataset.srTeam;
  const sectionKey = container.dataset.srSection;
  const editingId = container.dataset.srTopicId || null;
  const titleInput = container.querySelector('#sr-topic-title-input');
  const formatSelect = container.querySelector('#sr-topic-format-select');
  const errEl = container.querySelector('[data-sr-topic-error]');
  const title = ((titleInput && titleInput.value) || '').trim();
  if (!title) {
    if (errEl) { errEl.querySelector('div').textContent = 'Enter a topic.'; errEl.hidden = false; }
    if (titleInput) titleInput.focus();
    return;
  }
  const format = formatSelect ? formatSelect.value : '';
  const presenters = [...container.querySelectorAll('.sr-presenter-chip.active')].map((c) => c.dataset.srPresenter);

  const sub = (_activeSession.submissions && _activeSession.submissions[team]) || {};
  const existing = topicsOf(sub, sectionKey);
  const topics = editingId
    ? existing.map((t) => (t.id === editingId ? { ...t, title, format, presenters } : t))
    : [...existing, { title, format, presenters }];

  saveBtn.setAttribute('aria-busy', 'true');
  try {
    const ok = await _saveTeamPatch(team, { [sectionKey]: topics }, root);
    if (!ok && errEl) { errEl.querySelector('div').textContent = 'Could not save the topic.'; errEl.hidden = false; }
  } finally {
    saveBtn.removeAttribute('aria-busy');
  }
}

async function _deleteTopicHandler(root, btn) {
  const team = btn.closest('[data-sr-team]').dataset.srTeam;
  const sectionKey = btn.dataset.srSection;
  const topicId = btn.dataset.srTopicId;
  const ok = await (_dsModal
    ? _dsModal.confirmDsModal({ title: 'Delete the topic?', body: 'This cannot be undone.', okLabel: 'Delete', danger: true, trigger: btn })
    : Promise.resolve(true));
  if (!ok) return;
  const sub = (_activeSession.submissions && _activeSession.submissions[team]) || {};
  const existing = topicsOf(sub, sectionKey);
  const topics = existing.filter((t) => t.id !== topicId);
  btn.setAttribute('aria-busy', 'true');
  try {
    await _saveTeamPatch(team, { [sectionKey]: topics }, root);
  } finally {
    if (btn.isConnected) btn.removeAttribute('aria-busy');
  }
}

async function _moveTopicHandler(root, btn, delta) {
  const team = btn.closest('[data-sr-team]').dataset.srTeam;
  const sectionKey = btn.dataset.srSection;
  const topicId = btn.dataset.srTopicId;
  const sub = (_activeSession.submissions && _activeSession.submissions[team]) || {};
  const existing = [...topicsOf(sub, sectionKey)];
  const idx = existing.findIndex((t) => t.id === topicId);
  const next = idx + delta;
  if (idx === -1 || next < 0 || next >= existing.length) return;
  [existing[idx], existing[next]] = [existing[next], existing[idx]];
  await _saveTeamPatch(team, { [sectionKey]: existing }, root);
}

async function _setStatusHandler(root, btn) {
  const team = btn.closest('[data-sr-team]').dataset.srTeam;
  await _saveTeamPatch(team, { realizationStatus: btn.dataset.srStatus }, root);
}

async function _toggleLockHandler(root, btn) {
  const team = btn.dataset.srTeam;
  const locked = btn.dataset.srLocked === '1';
  await _saveTeamPatch(team, { submitted: !locked }, root);
}

async function _refreshSessionFromConfluence(root, btn) {
  const ok = await _confirmReimport(btn);
  if (!ok) return;
  btn.setAttribute('aria-busy', 'true');
  try {
    const result = await _importConfluencePage(btn.dataset.pageId);
    if (!result.ok) { _toast('danger', 'Refresh failed', (result.error && result.error.message) || ''); return; }
    _activeId = result.session.id;
    await _reloadSessions(root);
    _announceDataWrite();
    _toast('success', 'Session refreshed from Confluence', '');
  } finally {
    if (btn.isConnected) btn.removeAttribute('aria-busy');
  }
}

function _generateAgenda(root) {
  if (!_activeSession) return;
  _agendaText = buildAgendaText(_activeSession, _dualSectionTeams());
  _paintSessionArea(root);
}

async function _copyAgenda(btn) {
  btn.setAttribute('aria-busy', 'true');
  try {
    if (navigator.clipboard && typeof window.ClipboardItem === 'function') {
      const html = renderAgendaMd(_agendaText);
      const item = new window.ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([_agendaText], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(_agendaText);
    } else {
      throw new Error('The clipboard is not available in this browser.');
    }
    _toast('success', 'Agenda copied', '');
  } catch (e) {
    _toast('danger', 'Could not copy the agenda', e.message || '');
  } finally {
    btn.removeAttribute('aria-busy');
  }
}

async function _downloadAgenda(btn) {
  if (!_activeSession) return;
  btn.setAttribute('aria-busy', 'true');
  try {
    const mod = await import('./agenda-export.js');
    const teams = teamOrder(_activeSession);
    const dualSectionTeams = _dualSectionTeams();
    const meetingLabel = (_status && _status.meeting && _status.meeting.label) || 'Sprint Review';
    const html = await mod.buildVisualAgendaHtml({
      session: _activeSession,
      teams,
      dualSectionTeams,
      meetingLabel,
      avatarUrlFor: (name) => _memberAvatarUrl(_memberByName(name)),
      logoUrlFor: (team) => '/modules/sprint-review/client/assets/' + teamLogoSlug(team) + '_light.svg',
    });
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = visualAgendaFilename(_activeSession.sprintName);
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    _toast('danger', 'Could not download the visual agenda', e.message || '');
  } finally {
    btn.removeAttribute('aria-busy');
  }
}

async function _deleteSessionHandler(root, btn) {
  if (!_activeSession) return;
  const label = _activeSession.sprintName || ('session ' + String(_activeSession.id).slice(-6));
  const ok = await (_dsModal
    ? _dsModal.confirmDsModal({ title: 'Delete the session?', body: 'Delete "' + label + '"? This cannot be undone.', okLabel: 'Delete', danger: true, trigger: btn })
    : Promise.resolve(true));
  if (!ok) return;
  btn.setAttribute('aria-busy', 'true');
  try {
    // checkOrigin in the core answers 415 to ANY mutating request without a
    // JSON content type (its CSRF gate), a bodiless DELETE included.
    const res = await fetch(_api('/session?id=' + encodeURIComponent(_activeSession.id)), {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Could not delete the session.');
    }
    _sessions = _sessions.filter((s) => s.id !== _activeSession.id);
    _activeId = null;
    _activeSession = null;
    _agendaText = '';
    await _render(root);
    _announceDataWrite();
    _toast('success', 'Session deleted', '');
  } catch (e) {
    _toast('danger', 'Delete failed', e.message || '');
  } finally {
    if (btn.isConnected) btn.removeAttribute('aria-busy');
  }
}

function _wireBody(root) {
  if (_bodyWired) return;
  _bodyWired = true;
  const onClick = async (e) => {
    const chip = e.target.closest('[data-sr-presenter]');
    if (chip) { chip.classList.toggle('active'); chip.setAttribute('aria-pressed', chip.classList.contains('active') ? 'true' : 'false'); return; }

    const addBtn = e.target.closest('[data-sr-add-topic]');
    if (addBtn) { _showTopicForm(root, addBtn.dataset.srTeam, addBtn.dataset.srSection, null); return; }

    const editBtn = e.target.closest('[data-sr-edit-topic]');
    if (editBtn) {
      const team = editBtn.closest('[data-sr-team]').dataset.srTeam;
      const sectionKey = editBtn.dataset.srSection;
      _showTopicForm(root, team, sectionKey, _findTopic(team, sectionKey, editBtn.dataset.srTopicId));
      return;
    }

    if (e.target.closest('[data-sr-topic-cancel]')) { _hideTopicForm(e.target); return; }

    const saveBtn = e.target.closest('[data-sr-topic-save]');
    if (saveBtn) { await _saveTopicForm(root, saveBtn); return; }

    const delTopicBtn = e.target.closest('[data-sr-delete-topic]');
    if (delTopicBtn) { await _deleteTopicHandler(root, delTopicBtn); return; }

    const upBtn = e.target.closest('[data-sr-move-up]');
    if (upBtn) { await _moveTopicHandler(root, upBtn, -1); return; }

    const downBtn = e.target.closest('[data-sr-move-down]');
    if (downBtn) { await _moveTopicHandler(root, downBtn, 1); return; }

    const statusBtn = e.target.closest('[data-sr-status]');
    if (statusBtn) { await _setStatusHandler(root, statusBtn); return; }

    const lockBtn = e.target.closest('[data-sr-lock-toggle]');
    if (lockBtn) { await _toggleLockHandler(root, lockBtn); return; }

    const refreshBtn = e.target.closest('[data-sr-session-refresh]');
    if (refreshBtn) { await _refreshSessionFromConfluence(root, refreshBtn); return; }

    if (e.target.closest('[data-sr-generate-agenda]')) { _generateAgenda(root); return; }

    const copyBtn = e.target.closest('[data-sr-copy-agenda]');
    if (copyBtn) { await _copyAgenda(copyBtn); return; }

    const dlBtn = e.target.closest('[data-sr-download-agenda]');
    if (dlBtn) { await _downloadAgenda(dlBtn); return; }

    const delSessBtn = e.target.closest('[data-sr-delete-session]');
    if (delSessBtn) { await _deleteSessionHandler(root, delSessBtn); }
  };
  const onChange = (e) => {
    const sel = e.target.closest('#sr-session-select');
    if (sel) { _activeId = sel.value; _render(root); }
  };
  root.addEventListener('click', onClick);
  root.addEventListener('change', onChange);
  _deps.registerViewCleanup(() => {
    root.removeEventListener('click', onClick);
    root.removeEventListener('change', onChange);
    _bodyWired = false;
    if (_dsSelect) {
      const sel = root.querySelector('#sr-session-select');
      if (sel) { try { _dsSelect.destroySelect(sel); } catch { /* already bare */ } }
    }
  });
}

// ── "New session" modal ───────────────────────────────────────────────────

function _goalPreviewHtml() {
  // The current seeding lineup for "New session" ONLY - status.meeting.teams,
  // never the card list of an existing session (that is always
  // teamOrder(session)).
  const teams = (_status && _status.meeting && Array.isArray(_status.meeting.teams)) ? _status.meeting.teams : [];
  const rows = teams.map((t) => '<tr><td>' + esc(t) + '</td></tr>').join('');
  return '<div class="sr-modal-goal-preview">'
    + '<div class="ds-table-wrap"><table class="ds-table">'
    + '<thead><tr><th>Team</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
    + '<p class="ds-hint">The goal is taken from the active sprint when the sprint statistics know it; '
    + 'otherwise it stays empty.</p>'
    + '</div>';
}

async function _openNewSessionModal(root) {
  if (!_dsModal) { try { _dsModal = await import('/js/ds-modal.js'); } catch { _dsModal = null; } }

  const poOpts = ['<option value="">Choose...</option>']
    .concat(poCandidates(_teamMembers()).map((m) => {
      const name = _fullNameOf(m);
      return '<option value="' + esc(name) + '">' + esc(name) + '</option>';
    }))
    .join('');

  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  const titleId = 'sr-new-session-title';
  overlay.innerHTML =
    '<div class="ds-modal" role="dialog" aria-modal="true" aria-labelledby="' + titleId + '">'
    + '<div class="ds-modal-header"><span class="ds-modal-title" id="' + titleId + '">New Sprint Review</span></div>'
    + '<div class="ds-modal-body">'
    + '<div class="ds-input-wrap"><label class="ds-label" for="sr-new-date">Sprint Review date</label>'
    + '<input type="date" id="sr-new-date" class="ds-input" required>'
    + '<span class="ds-hint">Submission deadline: the Friday before the meeting, 12:00.</span></div>'
    + '<div class="ds-input-wrap"><label class="ds-label" for="sr-new-po">Facilitator</label>'
    + '<select id="sr-new-po" class="ds-input">' + poOpts + '</select></div>'
    + _goalPreviewHtml()
    + '<div class="ds-callout ds-callout--danger" data-sr-new-error hidden><div></div></div>'
    + '</div>'
    + '<div class="ds-modal-footer">'
    + '<button type="button" class="ds-btn ds-btn--primary" data-sr-new-confirm>Create session</button>'
    + '<button type="button" class="ds-btn ds-btn--tertiary" data-sr-new-cancel>Cancel</button>'
    + '</div></div>';
  document.body.appendChild(overlay);
  const trigger = document.activeElement;

  const dateInput = overlay.querySelector('#sr-new-date');
  const poSelect = overlay.querySelector('#sr-new-po');
  if (_dsSelect) { try { _dsSelect.initSelect(poSelect); } catch { /* bare select still works */ } }

  const close = () => {
    if (_dsModal) _dsModal.closeDsModal(overlay);
    overlay.remove();
  };
  overlay.querySelector('[data-sr-new-cancel]').addEventListener('click', close);
  overlay.querySelector('[data-sr-new-confirm]').addEventListener('click', async () => {
    const errEl = overlay.querySelector('[data-sr-new-error]');
    const confirmBtn = overlay.querySelector('[data-sr-new-confirm]');
    const reviewDate = dateInput.value.trim();
    if (!reviewDate) {
      errEl.querySelector('div').textContent = 'Pick the Sprint Review date.';
      errEl.hidden = false;
      dateInput.focus();
      return;
    }
    confirmBtn.setAttribute('aria-busy', 'true');
    confirmBtn.disabled = true;
    try {
      const res = await fetch(_api('/sessions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewDate, facilitatorPo: poSelect.value || '' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Could not create the session.');
      _activeId = data.id;
      close();
      await _reloadSessions(root);
      _announceDataWrite();
      _toast('success', 'Sprint Review session created', '');
    } catch (e) {
      errEl.querySelector('div').textContent = e.message || 'Creating the session failed.';
      errEl.hidden = false;
    } finally {
      if (confirmBtn.isConnected) { confirmBtn.removeAttribute('aria-busy'); confirmBtn.disabled = false; }
    }
  });

  if (_dsModal) _dsModal.openDsModal(overlay, { trigger }); else overlay.hidden = false;
}

// ── "Import from Confluence" modal ───────────────────────────────────────

function _renderConfluenceList(overlay, root, pages, storage) {
  const body = overlay.querySelector('[data-sr-cf-body]');
  const footer = overlay.querySelector('[data-sr-cf-footer]');
  if (!body || !footer) return;
  const disabled = storage === 'unavailable';
  const warning = disabled
    ? '<div class="ds-callout ds-callout--warning"><div>The team data is not fetched to this computer yet - '
      + 'fetch the "Team data" source in the Sync window on the top bar.</div></div>'
    : '';

  if (!pages.length) {
    body.innerHTML = warning + '<p class="ds-hint">No Sprint Review pages under the meeting page in Confluence.</p>';
    footer.innerHTML = '<button type="button" class="ds-btn ds-btn--tertiary" data-sr-cf-close>Close</button>';
    footer.querySelector('[data-sr-cf-close]').addEventListener('click', () => { _closeOverlay(overlay); });
    return;
  }

  const rows = pages.map((p) => {
    const badge = discoverBadge(p.status);
    const actionLabel = p.status === 'new' ? 'Import' : 'Refresh';
    return '<tr>'
      + '<td>' + esc(p.title) + '</td>'
      + '<td><span class="ds-badge ' + badge.cls + '">' + esc(badge.label) + '</span></td>'
      + '<td><button type="button" class="ds-btn ds-btn--secondary ds-btn--sm" data-sr-cf-action data-sr-cf-page-id="' + esc(p.pageId) + '" data-sr-cf-status="' + esc(p.status) + '"' + (disabled ? ' disabled' : '') + '>' + actionLabel + '</button></td>'
      + '</tr>';
  }).join('');
  body.innerHTML = warning + '<div class="ds-table-wrap"><table class="ds-table">'
    + '<thead><tr><th>Session</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';

  const newCount = disabled ? 0 : pages.filter((p) => p.status === 'new').length;
  // `footer` is the modal's footer element (built in _openConfluenceModal);
  // the primary below belongs to that dialog, not to the view - the
  // btn-primary-per-view heuristic cannot see through `footer.innerHTML`
  // and will WARN here on purpose; the right read needs a human.
  footer.innerHTML =
    (newCount > 0
      ? '<button type="button" class="ds-btn ds-btn--primary" data-sr-cf-import-all>Import all new (' + newCount + ')</button>'
      : '')
    + '<button type="button" class="ds-btn ds-btn--tertiary" data-sr-cf-close>Close</button>';

  footer.querySelector('[data-sr-cf-close]').addEventListener('click', () => { _closeOverlay(overlay); });

  const importAllBtn = footer.querySelector('[data-sr-cf-import-all]');
  if (importAllBtn) {
    importAllBtn.addEventListener('click', async () => {
      importAllBtn.setAttribute('aria-busy', 'true');
      importAllBtn.disabled = true;
      const toImport = pages.filter((pg) => pg.status === 'new');
      const total = toImport.length;
      let imported = 0;
      let failed = 0;
      let firstErrorMessage = '';
      let lastId = null;
      for (const p of toImport) {
        const result = await _importConfluencePage(p.pageId);
        if (result.ok) {
          p.status = 'synced'; imported += 1; lastId = result.session.id;
        } else {
          failed += 1;
          if (!firstErrorMessage) firstErrorMessage = (result.error && result.error.message) || '';
        }
      }
      if (lastId) _activeId = lastId;
      await _reloadSessions(root);
      if (imported > 0) _announceDataWrite(); // once for the whole batch
      // Every page can fail (a stale token, Confluence down mid-loop) - a
      // success toast over 0 imports used to hide that from the person who
      // clicked. Three distinct outcomes, never silently merged into one.
      if (imported === 0 && failed > 0) {
        _toast('danger', 'No session was imported',
          firstErrorMessage ? 'No session was imported: ' + firstErrorMessage : 'No session was imported.');
      } else if (failed > 0) {
        _toast('warning', 'Imported ' + imported + ' of ' + total + ' sessions',
          'Some pages were not imported - try again for the rest.');
      } else {
        _toast('success', 'Imported ' + imported + ' ' + (imported === 1 ? 'session' : 'sessions') + ' from Confluence', '');
      }
      _renderConfluenceList(overlay, root, pages, storage);
    });
  }

  body.querySelectorAll('[data-sr-cf-action]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const pageId = btn.dataset.srCfPageId;
      const status = btn.dataset.srCfStatus;
      if (status !== 'new') {
        const ok = await _confirmReimport(btn);
        if (!ok) return;
      }
      btn.setAttribute('aria-busy', 'true');
      btn.disabled = true;
      const result = await _importConfluencePage(pageId);
      if (!result.ok) {
        if (btn.isConnected) { btn.removeAttribute('aria-busy'); btn.disabled = false; }
        _toast('danger', 'Import failed', (result.error && result.error.message) || '');
        return;
      }
      const page = pages.find((p) => p.pageId === pageId);
      if (page) page.status = 'synced';
      _activeId = result.session.id;
      await _reloadSessions(root);
      _announceDataWrite();
      _toast('success', 'Imported: ' + (result.session.sprintName || pageId), '');
      _renderConfluenceList(overlay, root, pages, storage);
    });
  });
}

function _closeOverlay(overlay) {
  if (_dsModal) _dsModal.closeDsModal(overlay);
  overlay.remove();
}

async function _openConfluenceModal(root) {
  if (!_dsModal) { try { _dsModal = await import('/js/ds-modal.js'); } catch { _dsModal = null; } }

  const overlay = document.createElement('div');
  overlay.className = 'ds-modal-overlay';
  const titleId = 'sr-cf-title';
  overlay.innerHTML =
    '<div class="ds-modal ds-modal--lg" role="dialog" aria-modal="true" aria-labelledby="' + titleId + '">'
    + '<div class="ds-modal-header"><span class="ds-modal-title" id="' + titleId + '">Import from Confluence</span></div>'
    + '<div class="ds-modal-body" data-sr-cf-body>'
    + '<span class="ds-skeleton" data-skel="1" style="width:100%;height:120px;display:block"></span>'
    + '</div>'
    + '<div class="ds-modal-footer" data-sr-cf-footer>'
    + '<button type="button" class="ds-btn ds-btn--tertiary" data-sr-cf-close>Close</button>'
    + '</div></div>';
  document.body.appendChild(overlay);
  const trigger = document.activeElement;
  overlay.querySelector('[data-sr-cf-close]').addEventListener('click', () => { _closeOverlay(overlay); });
  if (_dsModal) _dsModal.openDsModal(overlay, { trigger }); else overlay.hidden = false;

  let pages = [];
  let storage = 'ok';
  let loadError = null;
  try {
    const res = await fetch(_api('/confluence-discover'));
    const data = await res.json();
    if (!res.ok) loadError = data; else { pages = data.pages || []; storage = data.storage; }
  } catch (e) {
    loadError = { message: e.message };
  }

  const body = overlay.querySelector('[data-sr-cf-body]');
  const footer = overlay.querySelector('[data-sr-cf-footer]');
  if (!body) return;

  if (loadError) {
    let html;
    if (loadError.error === 'no-token') {
      html = '<div class="ds-callout ds-callout--warning"><div>No Confluence key - add CONFLUENCE_TOKEN in Settings > Keys or unlock the vault.</div></div>';
    } else if (loadError.error === 'confluence-disabled') {
      html = '<div class="ds-callout ds-callout--warning"><div>Importing from Confluence is disabled in this mode.</div></div>';
    } else {
      html = '<div class="ds-callout ds-callout--danger"><div>' + esc(loadError.message || 'Could not connect to Confluence.') + '</div></div>';
    }
    body.innerHTML = html;
    if (footer) footer.innerHTML = '<button type="button" class="ds-btn ds-btn--tertiary" data-sr-cf-close>Close</button>';
    const closeBtn = footer && footer.querySelector('[data-sr-cf-close]');
    if (closeBtn) closeBtn.addEventListener('click', () => { _closeOverlay(overlay); });
    return;
  }

  _renderConfluenceList(overlay, root, pages, storage);
}

// ── main render ──────────────────────────────────────────────────────────

async function _render(root) {
  if (!root.dataset.srBooted) {
    root.innerHTML = _skeletonHtml();
    _paintActionsSkeleton();
  }

  let statusData;
  let sessionsData;
  try {
    const [statusRes, sessionsRes] = await Promise.all([fetch(_api('/status')), fetch(_api('/sessions'))]);
    statusData = await statusRes.json();
    sessionsData = await sessionsRes.json();
  } catch (_e) {
    root.innerHTML = _errorHtml();
    return;
  }
  _status = statusData;
  _sessions = sessionsData.sessions || [];
  root.dataset.srBooted = '1';
  _paintActions();

  if (_status.storage === 'unavailable') {
    root.innerHTML = _unavailableHtml();
    return;
  }
  if (!_sessions.length) {
    root.innerHTML = await _emptyStateHtml();
    return;
  }

  const sorted = sortSessions(_sessions);
  if (!_activeId || !_sessions.some((s) => s.id === _activeId)) _activeId = sorted[0].id;

  try {
    const res = await fetch(_api('/session?id=' + encodeURIComponent(_activeId)));
    if (!res.ok) throw new Error('not-found');
    _activeSession = await res.json();
  } catch (_e) {
    root.innerHTML = _errorHtml();
    return;
  }

  _paintSessionArea(root);
  _refreshTeamDir();
}

// ── view ─────────────────────────────────────────────────────────────────

export const views = {

  'sprint-review-main': {
    /** @param {{ navigate, registerViewCleanup, showToast, apiBase }} deps */
    init(deps) {
      _deps = deps;

      // No registerViewCleanup() call here on purpose - see js/view-lifecycle.js
      // and the pattern in modules/sprint-stats: init() runs
      // ONCE per session, but the cleanup registry is consumed on EVERY exit
      // from the view, so a callback registered only here would cover the
      // first visit and nothing after. Real teardown is registered at each
      // resource's creation site instead (the countdown in
      // _startCountdownFor, the delegated listeners in _wireBody/_paintActions).

      (async () => {
        try { _dsModal = await import('/js/ds-modal.js'); } catch { _dsModal = null; }
      })();
      (async () => {
        try { _dsSelect = await import('/js/ds-select.js'); } catch { _dsSelect = null; }
      })();
      (async () => {
        try {
          _teamDir = await import('/js/team-directory.js');
          await _teamDir.loadTeamDirectory();
        } catch (e) {
          console.warn('[sprint-review] team directory unavailable', e);
          _teamDir = null;
        }
        const root = _root();
        if (root && _activeSession) _paintSessionArea(root);
      })();
      (async () => {
        try { _emptyState = await import('/js/empty-state.js'); } catch { _emptyState = null; }
      })();
    },

    /**
     * @param {string} _subPath path segment after the view id
     * @param {object} _opts navigation options
     */
    async render(_subPath, _opts) {
      const root = _root();
      if (!root) return;
      await _render(root);
    },

    /** Data pulled under us (a sync-window decrypt) - keep _activeId, drop the cache. */
    async onDataChanged() {
      // Nothing new on disk (typically this view's own write, already
      // painted - see _announceDataWrite): keep everything, agenda included.
      const before = _dataKey(_status, _sessions, _activeSession);
      if (before !== null && before === await _fetchDataKey()) return;
      _status = null;
      _sessions = [];
      _agendaText = '';
      // A pull may bring new team photos under the same avatar URLs; the export
      // helper is a sibling file the core never re-imports, so it is told here.
      try { (await import('./agenda-export.js')).clearAgendaExportCache(); } catch (_e) { /* export helper not loaded yet */ }
      const root = _root();
      if (root) await _render(root);
    },
  },
};
