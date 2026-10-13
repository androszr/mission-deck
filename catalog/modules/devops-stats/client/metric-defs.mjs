// modules/devops-stats/client/metric-defs.mjs
// Definitions of every metric on the page and the tooltip that shows them.
// The wording must follow flow-model.mjs: when a formula there changes, the
// sentence here changes with it (tests/test_metric_defs.mjs pins the keys).
//
// The tooltip is the DS one (ds-tooltip-wrap + ds-tooltip-content, css/ds.css),
// which ships without a show/hide rule - client/style.css adds only that.
// The trigger is a real button element, so it is reachable by keyboard; the text is
// linked through aria-describedby.

const P85 = '85th percentile: 85 out of 100 issues finish within this time, 15 take longer - it shows the long tail.';
const SCOPE = 'Epics and sub-tasks are excluded.';

/** Team shown on the People tab (TEAM_NAME in client/index.js). */
const TEAM = 'Falcon';

/** @type {Record<string, string>} */
export const METRIC_DEFS = {
  wipNow: 'All issues of the DEVOPS project that are NOW in a status of the "in progress" category in Jira - the state today, '
    + 'not a sum over the range. Includes issues of ' + TEAM + ' members, unassigned issues and issues assigned to people outside the team; '
    + 'the People tab counts ' + TEAM + ' only. ' + SCOPE,
  throughput: 'Average number of issues delivered per {per} in the visible period (the last 12 weeks or 6 months). '
    + 'Delivery is the last entry into a status of the "done" category after work in progress; a reopened issue does not count, '
    + 'closed without work counts separately and cancelled not at all. ' + SCOPE,
  leadTime: 'Lead time: calendar days from creating the issue in Jira to closing it, '
    + 'for issues delivered in the visible period. Median: half of the issues finish faster. '
    + 'Cancelled issues and issues closed without work are left out. ' + SCOPE,
  cycleTime: 'Cycle time: calendar days from the first entry into an "in progress" status to closing - '
    + 'the work itself, without waiting in the queue. Median: half of the issues finish faster. Cancelled issues are left out. ' + SCOPE,
  blockedNow: 'Open issues that are now in a status marked as blocked (the "Set statuses" button). '
    + 'Jira flags are not taken into account. ' + SCOPE,
  wipChart: 'Number of issues in progress at the end of each period; the current, incomplete period shows the state now. ' + SCOPE,
  throughputChart: 'Number of issues delivered in each period (the last entry into a "done" category status after work in progress). '
    + 'Cancelled issues and issues closed without work are left out. ' + SCOPE,
  leadChart: 'Calendar days from creating an issue to closing it, for issues delivered in the period; '
    + 'cancelled issues and issues closed without work are left out. ' + P85,
  cycleChart: 'Calendar days from the first entry into "in progress" to closing, for issues closed in the period. '
    + 'Cancelled issues and issues that were never in progress are left out. ' + P85,
  closedWithoutWork: 'Issues closed in the visible period that never entered an "in progress" status - usually backlog '
    + 'housekeeping (an outdated plan, a duplicate). Cancelled issues do not count here: that is a normal end of an issue, '
    + 'set in "Set statuses". They count neither as delivered nor towards lead and cycle time. ' + SCOPE,
  closedWithoutWorkList: 'Issues closed (not cancelled) in the visible period without entering an "in progress" status, newest closure first. '
    + 'Days open: from creation to closing. If you see an issue here that was really done, '
    + 'the "in progress" status was skipped in Jira. ' + SCOPE,
  cancelledAfterWorkList: 'Issues cancelled in the visible period after work had started: they entered an "in progress" status '
    + 'or have logged time. Largest logged time first. Days in progress: from the first "in progress" to cancelling. '
    + 'Logged: the sum of work logged in Jira, including sub-tasks, in hours and minutes. ' + SCOPE,
  personWip: 'Issues now assigned to the selected person (or to members of the ' + TEAM + ' team) that are in an "in progress" category status. '
    + 'Assignment means the CURRENT assignee in Jira. ' + SCOPE,
  personDelivered: 'Issues of the selected person delivered in the current week (from Monday), after work in progress. '
    + 'Cancelled issues and issues closed without work do not count. ' + SCOPE,
  personLead: 'Median days from creation to closing of the selected person\'s issues delivered in the current week. ' + SCOPE,
  personCycle: 'Median days from the first "in progress" to closing of the selected person\'s issues delivered in the current week. ' + SCOPE,
  personLogged: 'The sum of Jira worklog entries authored by the selected person and started in the current week - '
    + 'on any issue of the DEVOPS project, epics and sub-tasks included. Time logged in other projects is not counted.',
  personCompare: 'The same numbers for each week (the last 12) or month (the last 6), newest on top; '
    + 'the current period is still running. Issues count for the current assignee, time for the author of the entry and the day '
    + 'the work started. Covers only members of the ' + TEAM + ' team from the team directory.',
  epics: 'Start: the earliest entry into "in progress" of the epic or any of its issues (otherwise the epic\'s creation date). '
    + 'Days from start and from creation are counted to the epic\'s closing, and to today for open epics. '
    + 'Progress: closed issues of the epic / all of its issues.',
  aging: 'Open issues in progress, longest since their first entry into "in progress" first. '
    + 'Days in the current status: since the last status change. '
    + 'Blocked days: the total time in blocked statuses.',
  blocked: 'Issues blocked now and their total blocked time. Blocked share: the part of the cycle time '
    + 'of issues delivered in the visible period spent in a blocked status. Jira flags are not taken into account.',
};

const ICON = '/assets/icons/ds/16-ic-info.svg';

function _esc(s) {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Info icon with the definition of one metric.
 * @param {string} key one of METRIC_DEFS
 * @param {{per?: string, extra?: string, label?: string}} [opts]
 *   per - "week" / "month" substituted for {per}; extra - a sentence appended;
 *   label - what the button is the definition of (its accessible name).
 * @returns {string} HTML, empty for an unknown key
 */
export function tipHtml(key, opts) {
  const def = METRIC_DEFS[key];
  if (!def) return '';
  const o = opts || {};
  const text = def.replace('{per}', o.per || 'week') + (o.extra ? ' ' + o.extra : '');
  const id = 'devops-stats-tip-' + key;
  return '<button type="button" class="ds-tooltip-wrap devops-stats-tip" aria-describedby="' + id + '"'
    + ' aria-label="' + _esc('Definition: ' + (o.label || key)) + '">'
    + '<img src="' + ICON + '" alt="" width="16" height="16">'
    + '<span class="ds-tooltip-content devops-stats-tip-content" role="tooltip" id="' + id + '">' + _esc(text) + '</span>'
    + '</button>';
}
