'use strict';
// modules/sprint-review/server/session.js
// Pure session/meeting logic - the one exception is readSprintGoals, which
// reads (never writes) the sprint-stats module's sprint-stats/index.json
// (deadline, new-session build, mutable field allowlist).
//
// The single meeting this module ever reads is the team's own Sprint Review
// page. Its teams are NOT a hardcoded roster: every
// <h2> section server/confluence.js finds on the page IS a team, in page
// order. DUAL_SECTION_TEAMS is the one place a team name appears in this
// file at all, and it names a PAGE RULE (one team keeps two topic lists,
// Problem Space and Solution Space), never a roster.

const fs = require('fs');
const path = require('path');

const MEETING_KEY = 'team-review';

const MEETINGS = {
  'team-review': {
    label: 'Sprint Review',
    // Default Confluence page the meeting's review pages live under;
    // SPRINT_REVIEW_CONFLUENCE_PARENT_ID overrides it (see confluenceParentId).
    confluenceParentId: '100000',
    // Seeding lineup for a brand-new session (POST /sessions) only - NOT the
    // card list. The card list is always sessionTeams(session): teamGoals
    // in page order, plus any orphan submissions key. See server/index.js
    // GET /status ("meeting.teams") and the Backend contract.
    defaultTeams: ['Atlas', 'Borealis', 'Echo', 'Delta'],
  },
};

// The team whose Confluence section carries two <h3> subsections (Problem
// Space / Solution Space) instead of one flat topic list. A page rule, not a
// roster - if the page ever drops this team or adds another dual-section
// one, this is the one line that changes.
const DUAL_SECTION_TEAMS = ['Echo'];

/**
 * The Confluence parent page of the meeting: SPRINT_REVIEW_CONFLUENCE_PARENT_ID
 * when set (digits only), else the meeting's default.
 * @param {object} env
 * @returns {string}
 */
function confluenceParentId(env) {
  const raw = env && typeof env.SPRINT_REVIEW_CONFLUENCE_PARENT_ID === 'string' ? env.SPRINT_REVIEW_CONFLUENCE_PARENT_ID.trim() : '';
  return /^\d+$/.test(raw) ? raw : MEETINGS[MEETING_KEY].confluenceParentId;
}

// Spelling-only normalisation for a heading read off the Confluence page.
// Keys are lowercase with single spaces; an unmapped heading keeps its own
// cleaned text (see server/confluence.js canonicalTeamName) - this map never
// filters a team out.
const TEAM_ALIASES = {
  atlas: 'Atlas',
  borealis: 'Borealis',
  comet: 'Comet',
  delta: 'Delta',
  echo: 'Echo',
  falcon: 'Falcon',
  'team falcon': 'Falcon',
};

// Aliases used only when matching a sprint-goal team name: the name the
// Sprint Review page uses -> the name sprint-stats reports for the same
// people. Empty by default.
const GOAL_TEAM_ALIASES = {};

const SESSION_ID_RE = /^sr-[0-9a-f]{16}$/;
const TOPIC_ID_RE = /^t-[0-9a-f]{8}$/;

const REALIZATION_STATUSES = ['', 'achieved', 'partial', 'not-achieved'];
const TOPIC_FORMATS = ['presentation', 'discussion'];

const TOPIC_LIST_KEYS = ['topics', 'topicsProblemSpace', 'topicsSolutionSpace'];

// Fields a client may mutate through PUT /session. `submissions` is
// deliberately absent - it is mutated one team (and one topic-list section)
// at a time through PUT /session/team, under a read-modify-write lock (see
// server/index.js - a lost update when two windows saved at once).
const MUTABLE_FIELDS = ['reviewDate', 'facilitatorPo', 'sprintName', 'sprintN', 'deadline', 'teamGoals'];

/** @param {string} team @returns {boolean} whether this team carries two topic-list sections. */
function isDualSectionTeam(team) {
  return DUAL_SECTION_TEAMS.includes(team);
}

/** @param {string} team @returns {string[]} the submission keys this team's card writes through. */
function topicListKeysFor(team) {
  return isDualSectionTeam(team) ? ['topicsProblemSpace', 'topicsSolutionSpace'] : ['topics'];
}

/**
 * The single source of truth for "which teams does this session have, in
 * what order" - the server-side twin of client/sprint-review-lib.mjs
 * teamOrder(). Page order (teamGoals) first, then any submissions key that
 * teamGoals does not already carry (a defensive append - a session built by
 * hand may have submissions with no matching
 * teamGoals entry).
 * @param {{teamGoals?: {team: string}[], submissions?: object}} session
 * @returns {string[]}
 */
function sessionTeams(session) {
  const fromGoals = Array.isArray(session.teamGoals) ? session.teamGoals.map((g) => g.team) : [];
  const seen = new Set(fromGoals);
  const orphans = Object.keys(session.submissions || {}).filter((t) => !seen.has(t));
  return [...fromGoals, ...orphans];
}

/**
 * Deadline: the Friday immediately preceding reviewDate, 10:00 UTC (= 12:00
 * CEST / 11:00 CET). Noon UTC avoids DST
 * ambiguity on the date boundary, then step back at least one day and to the
 * nearest Friday.
 * @param {string} reviewDateIso YYYY-MM-DD
 * @returns {string} ISO instant
 */
function deadlineFromReviewDate(reviewDateIso) {
  const d = new Date(reviewDateIso + 'T12:00:00.000Z');
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCHours(10, 0, 0, 0);
  return d.toISOString();
}

/**
 * @param {(size: number) => Buffer} randomBytes injected for testability
 * @returns {string} 'sr-' + 16 hex chars, matches SESSION_ID_RE
 */
function newSessionId(randomBytes) {
  return 'sr-' + randomBytes(8).toString('hex');
}

function newTopicId(randomBytes) {
  return 't-' + randomBytes(4).toString('hex');
}

/**
 * Builds a fully-seeded new session (id, timestamps, deadline, sprint-goal
 * auto-fill from readSprintGoals()'s output when available). Does not
 * write anything - the caller persists through store.writeSession.
 * @param {{reviewDate: string, facilitatorPo?: string,
 *   sprintGoals: {sprintN: number, sprintName: string,
 *     teamGoals: {team: string, goal: string, sprint_name: string}[]}|null,
 *   now: () => Date, randomBytes: (size: number) => Buffer}} args
 */
function buildNewSession(args) {
  const reviewDate = args.reviewDate;
  const facilitatorPo = args.facilitatorPo || '';
  const goals = args.sprintGoals;
  const nowIso = args.now().toISOString();
  const meetingConfig = MEETINGS[MEETING_KEY];

  const teamGoals = goals && Array.isArray(goals.teamGoals) && goals.teamGoals.length > 0
    ? goals.teamGoals
    : meetingConfig.defaultTeams.map((team) => ({ team, goal: '', sprint_name: '' }));

  return {
    id: newSessionId(args.randomBytes),
    createdAt: nowIso,
    updatedAt: nowIso,
    reviewDate,
    sprintN: goals ? goals.sprintN : null,
    sprintName: goals ? goals.sprintName : null,
    deadline: deadlineFromReviewDate(reviewDate),
    facilitatorPo,
    meeting: MEETING_KEY,
    teamGoals,
    submissions: {},
    cardsSentAt: null,
    confluencePageId: null,
    confluenceVersion: null,
  };
}

function isValidReviewDate(v) {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * Applies an allowlisted patch to a session (PUT /session). Unknown keys,
 * including __proto__/constructor, are dropped because MUTABLE_FIELDS is an
 * allowlist rather than a blocklist. Changing reviewDate without an explicit
 * deadline in the same patch recomputes the deadline from the new date.
 * @param {object} session existing session
 * @param {object} body raw request body
 * @param {() => Date} now
 * @returns {{session: object}|{error: string, message: string}}
 */
function applySessionPatch(session, body, now) {
  if (!body || typeof body !== 'object') return { error: 'bad-body', message: 'The request body must be a JSON object.' };
  const patch = {};
  for (const key of MUTABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    patch[key] = body[key];
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'reviewDate')) {
    if (!isValidReviewDate(patch.reviewDate)) {
      return { error: 'reviewDate-invalid', message: 'The "reviewDate" field must use the YYYY-MM-DD format.' };
    }
    if (!Object.prototype.hasOwnProperty.call(patch, 'deadline')) {
      patch.deadline = deadlineFromReviewDate(patch.reviewDate);
    }
  }
  const next = { ...session, ...patch, id: session.id, updatedAt: now().toISOString() };
  return { session: next };
}

function sanitizeTopic(raw, randomBytes) {
  const idCandidate = raw && typeof raw.id === 'string' ? raw.id : '';
  const id = (SESSION_ID_RE.test(idCandidate) || TOPIC_ID_RE.test(idCandidate) || /^cf-[0-9a-f]{8}$/.test(idCandidate))
    ? idCandidate
    : newTopicId(randomBytes);
  const title = String((raw && raw.title) || '').slice(0, 200);
  const formatRaw = raw && raw.format;
  const format = TOPIC_FORMATS.includes(formatRaw) ? formatRaw : '';
  const presentersRaw = Array.isArray(raw && raw.presenters) ? raw.presenters : [];
  const presenters = presentersRaw.map((p) => String(p || '').slice(0, 200)).filter(Boolean);
  return { id, title, format, presenters };
}

function emptySubmission(team) {
  const base = { submitted: false, realizationStatus: '' };
  for (const key of topicListKeysFor(team)) base[key] = [];
  return base;
}

function validateTopicList(list) {
  if (!Array.isArray(list)) return { error: 'bad-topics', message: 'The topics field must be an array.' };
  for (const t of list) {
    if (t && typeof t.format === 'string' && t.format && !TOPIC_FORMATS.includes(t.format)) {
      return { error: 'bad-format', message: 'Unknown topic format.' };
    }
  }
  return null;
}

/**
 * Read-modify-write of ONE team's submission (PUT /session/team). `team`
 * must already be present on the session (sessionTeams(session)) - this
 * function no longer trusts a static roster, because the roster comes from
 * whichever teams the Confluence page or a manual session actually carries.
 * Which topic-list key(s) a patch may carry is decided by
 * topicListKeysFor(team): a dual-section team accepts topicsProblemSpace
 * and/or topicsSolutionSpace and rejects `topics`; every other team accepts
 * `topics` alone and rejects either section key. Everything else in the
 * patch is ignored.
 * @param {object} session existing session
 * @param {string} team must already be in sessionTeams(session)
 * @param {object} patch { realizationStatus?, submitted?, topics?,
 *   topicsProblemSpace?, topicsSolutionSpace? }
 * @param {(size: number) => Buffer} randomBytes
 * @returns {{session: object}|{error: string, message: string}}
 */
function applyTeamPatch(session, team, patch, randomBytes) {
  if (!patch || typeof patch !== 'object') return { error: 'bad-body', message: 'The request body must be a JSON object.' };
  if (!sessionTeams(session).includes(team)) {
    return { error: 'bad-team', message: 'The team is not part of this session: ' + team };
  }

  const submissions = { ...(session.submissions || {}) };
  const current = { ...emptySubmission(team), ...(submissions[team] || {}) };
  const next = { ...current };
  const dual = isDualSectionTeam(team);
  const allowedKeys = topicListKeysFor(team);

  if (Object.prototype.hasOwnProperty.call(patch, 'realizationStatus')) {
    if (!REALIZATION_STATUSES.includes(patch.realizationStatus)) {
      return { error: 'bad-realization-status', message: 'Unknown goal realization status.' };
    }
    next.realizationStatus = patch.realizationStatus;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'submitted')) {
    next.submitted = !!patch.submitted;
  }

  // A key from the OTHER shape is a caller mistake, not a silent no-op -
  // topics written to the wrong key would sit invisibly on the card.
  const forbiddenKeys = TOPIC_LIST_KEYS.filter((k) => !allowedKeys.includes(k));
  for (const key of forbiddenKeys) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      return {
        error: 'bad-topics-key',
        message: dual
          ? 'This team keeps two topic lists: Problem Space and Solution Space.'
          : 'This team keeps one topic list.',
      };
    }
  }
  for (const key of allowedKeys) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const invalid = validateTopicList(patch[key]);
    if (invalid) return invalid;
    next[key] = patch[key].map((t) => sanitizeTopic(t, randomBytes));
  }

  submissions[team] = next;
  return { session: { ...session, submissions } };
}

/**
 * Where the sprint-stats module keeps its data: sprint-stats/ inside the
 * same team data source (data-tier-0) this module writes to. Read on EVERY
 * call, never frozen.
 * @param {{dataTier0Dir: string}} ctx
 * @returns {string}
 */
function teamStatsDir(ctx) {
  return path.join(ctx.dataTier0Dir || '', 'sprint-stats');
}

/**
 * Finds the active main-board sprint entry (src === 'main' with the matching
 * sprint_n) and the active PLATFORM one (src === 'platform', matched by the
 * first team's sprint_id, falling back to any team in `state: 'active'`)
 * of the platform board.
 * Returns the pooled list of per-team entries from whichever of the two
 * were found - never throws, returns [] when neither is found.
 */
function activeSprintTeamEntries(index, boards) {
  const sprints = index.sprints;
  const pool = [];

  const activeMainN = boards.main && boards.main.active_sprint_n;
  if (activeMainN !== null && activeMainN !== undefined) {
    const mainSprint = sprints.find((s) => s && s.src === 'main' && s.sprint_n === activeMainN);
    if (mainSprint && Array.isArray(mainSprint.teams)) pool.push(...mainSprint.teams);
  }

  const activePlatformId = boards.platform && boards.platform.active_sprint_id;
  const platformSprints = sprints.filter((s) => s && s.src === 'platform');
  let platformSprint = null;
  if (activePlatformId !== null && activePlatformId !== undefined) {
    platformSprint = platformSprints.find((s) => Array.isArray(s.teams) && s.teams[0] && s.teams[0].sprint_id === activePlatformId) || null;
  }
  if (!platformSprint) {
    platformSprint = platformSprints.find((s) => Array.isArray(s.teams) && s.teams.some((t) => t && t.state === 'active')) || null;
  }
  if (platformSprint && Array.isArray(platformSprint.teams)) pool.push(...platformSprint.teams);

  return pool;
}

/**
 * Reads sprint-stats/index.json (sprint-stats module data) and returns a
 * per-team goal for each of `teams`, best-effort. `null` only when the file
 * itself is missing, unparsable, or carries no `sprints` array - never
 * because one team's goal is unknown, which simply reads as an empty entry.
 * @param {string} statsDir teamStatsDir(ctx)
 * @param {string[]} teams team names to resolve, in the order they should
 *   come back
 * @returns {{sprintN: number|null, sprintName: string|null,
 *   teamGoals: {team: string, goal: string, sprint_name: string}[]}|null}
 */
function readSprintGoals(statsDir, teams) {
  let index;
  try {
    index = JSON.parse(fs.readFileSync(path.join(statsDir, 'index.json'), 'utf8'));
  } catch {
    return null;
  }
  if (!index || typeof index !== 'object' || !Array.isArray(index.sprints)) return null;

  const boards = index.boards && typeof index.boards === 'object' ? index.boards : {};
  const pool = activeSprintTeamEntries(index, boards);
  const sprintN = (boards.main && boards.main.active_sprint_n) || null;
  const sprintName = sprintN ? ('Sprint ' + sprintN) : null;

  const teamGoals = (teams || []).map((team) => {
    const alias = GOAL_TEAM_ALIASES[team];
    const match = pool.find((t) => t && (t.team === team || (alias && t.team === alias)));
    return match
      ? { team, goal: match.goal || '', sprint_name: match.sprint_name || '' }
      : { team, goal: '', sprint_name: '' };
  });

  return { sprintN, sprintName, teamGoals };
}

module.exports = {
  MEETINGS,
  MEETING_KEY,
  confluenceParentId,
  DUAL_SECTION_TEAMS,
  TEAM_ALIASES,
  GOAL_TEAM_ALIASES,
  SESSION_ID_RE,
  TOPIC_ID_RE,
  TOPIC_LIST_KEYS,
  MUTABLE_FIELDS,
  REALIZATION_STATUSES,
  TOPIC_FORMATS,
  isDualSectionTeam,
  topicListKeysFor,
  sessionTeams,
  deadlineFromReviewDate,
  newSessionId,
  newTopicId,
  buildNewSession,
  applySessionPatch,
  applyTeamPatch,
  teamStatsDir,
  readSprintGoals,
};
