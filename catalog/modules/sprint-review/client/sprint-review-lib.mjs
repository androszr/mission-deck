// modules/sprint-review/client/sprint-review-lib.mjs
// Pure, DOM-free, stateless helpers for the Sprint Review view (the MAIN
// Sprint Review meeting - see the Backend contract; teams are read off the
// session, never hardcoded here). No import of core ESM (`/js/...`) and no
// top-level `document`/`fetch` -
// this file is imported straight in plain Node by
// tests/test_client_lib.mjs, and a pull re-imports client/index.js alone
// (modules-template/README.md "Refreshing after a data sync"), so
// any state kept HERE instead of in index.js would survive a data reload
// with stale content. There is no state here at all: every function takes
// what it needs as an argument.

/**
 * HTML-escape a value for use as text content or an attribute value.
 * @param {*} s
 * @returns {string}
 */
export function esc(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "YYYY-MM-DD" -> "17 Sep 2026". Manual table rather than
 * `toLocaleDateString(...)` so the format never depends on the
 * ICU data a runtime happens to ship with.
 * @param {string} iso
 * @returns {string}
 */
export function fmtDateShort(iso) {
  if (!iso || String(iso).length < 10) return '';
  const y = iso.slice(0, 4);
  const m = parseInt(iso.slice(5, 7), 10);
  const d = parseInt(iso.slice(8, 10), 10);
  if (!m || !d || !MONTH_ABBR[m - 1]) return '';
  return d + ' ' + MONTH_ABBR[m - 1] + ' ' + y;
}

/**
 * Countdown text to a deadline: "3d 4h 12min" / "4h 12min" / "12min" /
 * "Deadline passed" once it has passed.
 * @param {string|Date} deadline
 * @param {string|Date} now
 * @returns {string}
 */
export function formatCountdown(deadline, now) {
  const d = deadline instanceof Date ? deadline : new Date(deadline);
  const n = now instanceof Date ? now : new Date(now);
  const diff = d.getTime() - n.getTime();
  if (diff <= 0) return 'Deadline passed';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return days + 'd ' + hours + 'h ' + mins + 'min';
  if (hours > 0) return hours + 'h ' + mins + 'min';
  return mins + 'min';
}

/**
 * A session (or an index entry - both carry reviewDate) is historical once
 * its review date has fully elapsed.
 * @param {{reviewDate?: string}} session
 * @param {string|Date} now
 * @returns {boolean}
 */
export function isHistorical(session, now) {
  if (!session || !session.reviewDate) return false;
  const n = now instanceof Date ? now : new Date(now);
  return new Date(session.reviewDate + 'T23:59:59Z').getTime() < n.getTime();
}

/**
 * "Sprint 18 - 17 Sep 2026" (+" [Confluence]" when imported, +" - archive"
 * once historical). Works on a full session or an index entry.
 * @param {object} session
 * @param {string|Date} now
 * @returns {string}
 */
export function sessionLabel(session, now) {
  if (!session) return '';
  const name = session.sprintName || (session.sprintN ? 'Sprint ' + session.sprintN : '');
  const date = session.reviewDate ? fmtDateShort(session.reviewDate) : '';
  let label;
  if (name && date) label = name + ' - ' + date;
  else if (name) label = name;
  else if (date) label = date;
  else label = 'Session ' + String(session.id || '').slice(-6);
  if (session.confluencePageId) label += ' [Confluence]';
  if (isHistorical(session, now)) label += ' - archive';
  return label;
}

/**
 * Newest first, by reviewDate then createdAt - ISO strings sort correctly
 * as strings, so no Date parsing is needed.
 * @param {Array<object>} sessions
 * @returns {Array<object>}
 */
export function sortSessions(sessions) {
  return [...(sessions || [])].sort(
    (a, b) => (b.reviewDate || b.createdAt || '').localeCompare(a.reviewDate || a.createdAt || ''),
  );
}

export const REALIZ_LABELS = {
  achieved: { label: 'Achieved', cls: 'rb-ok' },
  partial: { label: 'Partially', cls: 'rb-partial' },
  'not-achieved': { label: 'Not achieved', cls: 'rb-no' },
};

export const FORMAT_LABELS = { presentation: 'Presentation', discussion: 'Discussion' };

// Mirror of server/session.js DUAL_SECTION_TEAMS. Used ONLY as a drift-test
// fixture (tests/test_client_lib.mjs deep-equals it against the server's own
// constant) and as the fallback when a caller has no live `status` yet. The
// real UI never relies on this literal - every call site below passes
// `status.meeting.dualSectionTeams` from the Backend contract, so a page
// rule change (the team that carries two topic lists) never needs a client
// edit.
export const DUAL_SECTION_TEAMS = ['Echo'];

/**
 * Whether `team` carries two topic-list sections (Problem Space / Solution
 * Space) instead of one flat list. `dualSectionTeams` should come from
 * `status.meeting.dualSectionTeams`; the local DUAL_SECTION_TEAMS mirror is
 * only the fallback for a caller with no status yet.
 * @param {string} team
 * @param {string[]} [dualSectionTeams]
 * @returns {boolean}
 */
export function isDualSectionTeam(team, dualSectionTeams) {
  return (dualSectionTeams || DUAL_SECTION_TEAMS).includes(team);
}

/** Section-key -> heading label, in the order a dual-section card paints them. */
export const TOPIC_SECTIONS = {
  topics: 'Topics',
  topicsProblemSpace: 'Problem Space',
  topicsSolutionSpace: 'Solution Space',
};

/**
 * Which submission keys a team's card writes through.
 * @param {string} team
 * @param {string[]} [dualSectionTeams]
 * @returns {string[]}
 */
export function sectionsFor(team, dualSectionTeams) {
  return isDualSectionTeam(team, dualSectionTeams) ? ['topicsProblemSpace', 'topicsSolutionSpace'] : ['topics'];
}

/**
 * The card list and its order - the client-side twin of
 * server/session.js sessionTeams(): teamGoals in page order, plus any
 * submissions key teamGoals does not already carry. Client and server
 * cannot cross-require (one runs in the browser, one in plain Node), so
 * this rule is duplicated deliberately - tests/test_client_lib.mjs and the
 * server's tests/test_session.mjs run it against the same fixture and must
 * agree.
 * @param {{teamGoals?: {team: string}[], submissions?: object}} session
 * @returns {string[]}
 */
export function teamOrder(session) {
  const fromGoals = Array.isArray(session && session.teamGoals) ? session.teamGoals.map((g) => g.team) : [];
  const seen = new Set(fromGoals);
  const orphans = Object.keys((session && session.submissions) || {}).filter((t) => !seen.has(t));
  return [...fromGoals, ...orphans];
}

/**
 * @param {object} sub one team's submissions[team]
 * @param {string} sectionKey 'topics' | 'topicsProblemSpace' | 'topicsSolutionSpace'
 * @returns {Array<object>}
 */
export function topicsOf(sub, sectionKey) {
  return (sub && Array.isArray(sub[sectionKey])) ? sub[sectionKey] : [];
}

/**
 * Whether ANY team, in ANY of its sections, has at least one topic - the
 * "Generate agenda" button is disabled otherwise.
 * @param {object} session
 * @param {string[]} [dualSectionTeams]
 * @returns {boolean}
 */
export function hasAnyTopics(session, dualSectionTeams) {
  return teamOrder(session).some((team) => {
    const sub = (session.submissions && session.submissions[team]) || {};
    return sectionsFor(team, dualSectionTeams).some((sec) => topicsOf(sub, sec).length > 0);
  });
}

/**
 * Deterministic, no-AI Markdown agenda text straight from the session's own
 * data. Iterates ALL of teamOrder(session), in page order, with a
 * Problem Space / Solution Space sub-split for a dual-section team.
 * @param {object} session
 * @param {string[]} [dualSectionTeams]
 * @returns {string}
 */
export function buildAgendaText(session, dualSectionTeams) {
  const goalMap = {};
  (session.teamGoals || []).forEach((g) => { if (g && g.team) goalMap[g.team] = g; });

  function topicLine(t, i) {
    const presenters = Array.isArray(t.presenters) && t.presenters.length ? t.presenters.join(', ') : '-';
    const formatLabel = FORMAT_LABELS[t.format] || '';
    const suffix = formatLabel ? ' (' + formatLabel + ')' : '';
    return (i + 1) + '. ' + (t.title || '-') + ' - _' + presenters + '_' + suffix;
  }
  function topicsBlock(topics) {
    if (!Array.isArray(topics) || !topics.length) return 'No topics';
    return topics.map(topicLine).join('\n');
  }

  const reviewDate = session.reviewDate ? fmtDateShort(session.reviewDate) : 'unknown';
  const headerLines = ['# ' + (session.sprintName || 'Sprint Review'), 'Date: ' + reviewDate];
  if (session.facilitatorPo) headerLines.push('Facilitator: _' + session.facilitatorPo + '_');

  const sections = teamOrder(session).map((team) => {
    const tg = goalMap[team];
    const sub = (session.submissions && session.submissions[team]) || {};
    const lines = ['## ' + team];
    if (tg && tg.goal) {
      if (sub.realizationStatus === 'achieved') {
        // U+2705 (green checkmark), escaped rather than a literal byte -
        // this whole file is ASCII-only per the check-conventions `ascii`
        // rule.
        lines.push('Sprint Goal: "' + tg.goal + '" \u2705');
      } else {
        lines.push('Sprint Goal: "' + tg.goal + '"');
        const rl = REALIZ_LABELS[sub.realizationStatus];
        if (rl) lines.push('Goal status: ' + rl.label);
      }
    }
    if (isDualSectionTeam(team, dualSectionTeams)) {
      const ps = topicsOf(sub, 'topicsProblemSpace');
      const ss = topicsOf(sub, 'topicsSolutionSpace');
      if (!ps.length && !ss.length) {
        lines.push('No topics');
      } else {
        if (ps.length) { lines.push('### Problem Space'); lines.push(topicsBlock(ps)); }
        if (ss.length) { lines.push('### Solution Space'); lines.push(topicsBlock(ss)); }
      }
    } else {
      lines.push(topicsBlock(topicsOf(sub, 'topics')));
    }
    return lines.join('\n');
  });

  return headerLines.join('\n') + '\n\n' + sections.join('\n\n');
}

function formatInlineMd(text) {
  return esc(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/_(.+?)_/g, '<em>$1</em>');
}

/**
 * Lightweight Markdown -> HTML for the agenda preview, line by line. No
 * inline `style=` attributes (port note: the source used `style="..."` on
 * headings; here every block gets an `.sr-md-*` class instead so
 * `client/style.css` owns the look).
 * @param {string} text
 * @returns {string}
 */
export function renderAgendaMd(text) {
  const lines = String(text || '').split('\n');
  let html = '';
  let inList = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (inList && !/^\s*(\d+\.|[-*])\s/.test(line)) { html += '</ol>'; inList = false; }
    if (line.startsWith('## ')) {
      html += '<h2 class="sr-md-h2">' + esc(line.slice(3)) + '</h2>';
    } else if (line.startsWith('### ')) {
      html += '<h3 class="sr-md-h3">' + esc(line.slice(4)) + '</h3>';
    } else if (line.startsWith('# ')) {
      html += '<h1 class="sr-md-h1">' + esc(line.slice(2)) + '</h1>';
    } else if (/^\d+\.\s/.test(line)) {
      if (!inList) { html += '<ol class="sr-md-ol">'; inList = true; }
      html += '<li>' + formatInlineMd(line.replace(/^\d+\.\s/, '')) + '</li>';
    } else if (/^[-*]\s/.test(line)) {
      if (!inList) { html += '<ol class="sr-md-ol">'; inList = true; }
      html += '<li>' + formatInlineMd(line.slice(2)) + '</li>';
    } else if (line.startsWith('---') || line.startsWith('***')) {
      html += '<hr class="sr-md-hr">';
    } else if (line === '') {
      html += '<br>';
    } else {
      html += '<p class="sr-md-p">' + formatInlineMd(line) + '</p>';
    }
  }
  if (inList) html += '</ol>';
  return html;
}

/**
 * ASCII filename-safe download name: sprint-review-<sprint>.html, or bare
 * "sprint-review.html" when `sprintName` is empty.
 * @param {string} sprintName
 * @returns {string}
 */
export function visualAgendaFilename(sprintName) {
  const slug = String(sprintName || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug ? 'sprint-review-' + slug + '.html' : 'sprint-review.html';
}

/**
 * Badge shape for one Confluence-discover row.
 * @param {'new'|'outdated'|'synced'} status
 * @returns {{cls: string, label: string}}
 */
export function discoverBadge(status) {
  if (status === 'new') return { cls: 'ds-badge--blue', label: 'New' };
  if (status === 'outdated') return { cls: 'ds-badge--yellow', label: 'Changed in Confluence' };
  return { cls: 'ds-badge--gray', label: 'Up to date' };
}

const PO_ROLES = ['Product Owner', 'Senior Product Owner', 'Product Manager', 'Head of Product Development'];

/**
 * "First Last" for one team-directory member record, duplicated here
 * (rather than imported from js/team-directory.js) so this file stays
 * import-free and testable in plain Node.
 * @param {object} member
 * @returns {string}
 */
export function fullNameOf(member) {
  if (!member) return '';
  return [member.first_name, member.last_name].filter(Boolean).join(' ').trim() || member.name || '';
}

/**
 * Roster members eligible for the "Facilitator" select, sorted by name.
 * @param {Array<object>} members
 * @returns {Array<object>}
 */
export function poCandidates(members) {
  return (members || [])
    .filter((m) => m && m.role && PO_ROLES.some((r) => m.role.includes(r)))
    .sort((a, b) => fullNameOf(a).localeCompare(fullNameOf(b), 'en'));
}

/**
 * Lowercase, space-free key for matching a team name across two sources
 * that disagree on spacing - the roster may store "Falcon" while the
 * Confluence page says "Falcon".
 * @param {string} s
 * @returns {string}
 */
export function normTeamKey(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '');
}

/**
 * Roster members offered as presenters for a topic: this team first, then
 * the rest of the roster, each half sorted by name. Team names
 * are compared through normTeamKey() rather than by equality.
 * @param {Array<object>} members
 * @param {string} team
 * @returns {Array<object>}
 */
export function presenterCandidates(members, team) {
  const list = members || [];
  const key = normTeamKey(team);
  const sortFn = (a, b) => fullNameOf(a).localeCompare(fullNameOf(b), 'en');
  const inTeam = list.filter((m) => m && normTeamKey(m.team) === key).sort(sortFn);
  const rest = list.filter((m) => !(m && normTeamKey(m.team) === key)).sort(sortFn);
  return [...inTeam, ...rest];
}

/**
 * Filename-safe, lowercase slug for a team's logo asset:
 * client/assets/<teamLogoSlug(team)>_light.svg. 'Echo' -> 'echo',
 * 'Falcon' -> 'falcon'.
 * @param {string} team
 * @returns {string}
 */
export function teamLogoSlug(team) {
  return String(team || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
