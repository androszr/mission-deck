// ── Mission Deck — js/sample-mode-helpers.mjs ─────────────────────────────
// Decisions and wording behind "Try it with sample data": the onboarding
// wizard's button, the top-bar badge and the confirm that leaves the mode.
// No `document` in this file - every function takes the parsed
// GET /api/sample-mode payload and returns a value or a string, so
// tests/test_sample_mode_helpers.mjs pins the copy. js/sample-mode.js does the
// DOM and the requests; js/topbar.js imports THIS file statically (the badge
// check runs on every load), which is why the fetch lives here and not next to
// the confirm dialog.

/** The badge text, word for word. */
export const SAMPLE_BADGE_LABEL = 'Sample data - nothing is synced';
export const SAMPLE_LEAVE_LABEL = 'Leave sample mode';
export const SAMPLE_ENTER_LABEL = 'Try it with sample data';
export const SAMPLE_RESTART_LABEL = 'Restart to finish';

/**
 * A payload from GET /api/sample-mode, or anything else, as a complete status.
 * An unreadable answer reads as "not in sample mode": the badge must never
 * appear because a request failed.
 * @param {*} body
 * @returns {{active: boolean, since: string|null, available: boolean, restartRequired: boolean, blockedByEnv: boolean}}
 */
export function normalizeSampleStatus(body) {
  const b = body && typeof body === 'object' ? body : {};
  return {
    active: b.active === true,
    since: typeof b.since === 'string' && b.since ? b.since : null,
    available: b.available === true,
    restartRequired: b.restartRequired === true,
    blockedByEnv: b.blockedByEnv === true,
  };
}

/**
 * @param {*} body parsed /api/sample-mode answer
 * @returns {boolean} whether the top-bar badge is painted
 */
export function shouldShowSampleBadge(body) {
  return normalizeSampleStatus(body).active;
}

/**
 * What the badge says and does.
 * @param {*} body
 * @returns {{label: string, title: string, actionLabel: string, restartPending: boolean}}
 */
export function sampleBadgeState(body) {
  const s = normalizeSampleStatus(body);
  const title = s.restartRequired
    ? 'Sample mode is changing - restart the server to finish.'
    : 'You are looking at a fictional team. Nothing you do here is sent to your real team data.';
  return { label: SAMPLE_BADGE_LABEL, title, actionLabel: SAMPLE_LEAVE_LABEL, restartPending: s.restartRequired };
}

/**
 * The wizard block: can the person start sample mode, and what to tell them otherwise.
 * @param {*} body
 * @returns {{mode: 'enter'|'active'|'restart'|'unavailable'|'blocked', canEnter: boolean, hint: string}}
 */
export function sampleEnterState(body) {
  const s = normalizeSampleStatus(body);
  // The marker changed but this process still runs the old state: the only
  // honest action is the restart that finishes it.
  if (s.restartRequired) {
    return {
      mode: 'restart', canEnter: false,
      hint: s.active
        ? 'Leaving sample mode: restart Mission Deck to finish.'
        : 'Sample mode is set up: restart Mission Deck to finish.',
    };
  }
  if (s.active) {
    return { mode: 'active', canEnter: false, hint: 'Sample mode is on. Everything you see belongs to a fictional team called Northwind Product.' };
  }
  if (s.blockedByEnv) {
    return {
      mode: 'blocked', canEnter: false,
      hint: 'This app is set to use a fixed team data folder (DATA_TIER_0_DIR, DATA_SUB_REPOS_DIR or DATA_TIER_0_GIT_DIR), so sample data is switched off. Remove that setting to try it.',
    };
  }
  if (!s.available) {
    return { mode: 'unavailable', canEnter: false, hint: 'The sample data is not part of this copy of Mission Deck.' };
  }
  return {
    mode: 'enter', canEnter: true,
    hint: 'No team data yet? Try Mission Deck with a fictional team: 24 people, one quarter of history and every module filled in. '
      + 'The modules are installed for you, nothing is synced, and you can leave at any time.',
  };
}

/**
 * The confirm shown before leaving.
 * @returns {{title: string, body: string, okLabel: string, cancelLabel: string}}
 */
export function sampleLeaveConfirm() {
  return {
    title: SAMPLE_LEAVE_LABEL,
    body: 'The sample team data is removed and Mission Deck restarts with your own team data. Modules stay installed.',
    okLabel: SAMPLE_LEAVE_LABEL,
    cancelLabel: 'Stay in sample mode',
  };
}

/**
 * One plain sentence about the result of POST /api/sample-mode/enter.
 * @param {*} body
 * @returns {string}
 */
export function sampleEnterSummary(body) {
  const b = body && typeof body === 'object' ? body : {};
  const installed = Array.isArray(b.installed) ? b.installed.length : 0;
  const failed = Array.isArray(b.failed) ? b.failed.length : 0;
  let text = 'Sample data is ready';
  if (installed > 0) text += ' and ' + installed + (installed === 1 ? ' module was' : ' modules were') + ' installed';
  text += '. Restarting Mission Deck...';
  if (failed > 0) text += ' ' + failed + (failed === 1 ? ' module' : ' modules') + ' could not be installed - see Settings > Modules.';
  return text;
}

/**
 * Plain-English text for an error answer of the enter / leave routes.
 * @param {*} body
 * @returns {string}
 */
export function sampleErrorMessage(body) {
  const b = body && typeof body === 'object' ? body : {};
  if (typeof b.message === 'string' && b.message) return b.message;
  return 'Something went wrong. Try again.';
}

/**
 * GET /api/sample-mode. Never throws: a failure reads as "not in sample mode".
 * @returns {Promise<ReturnType<typeof normalizeSampleStatus>>}
 */
export async function fetchSampleModeStatus() {
  try {
    const res = await fetch('/api/sample-mode', { cache: 'no-store' });
    if (!res.ok) return normalizeSampleStatus(null);
    return normalizeSampleStatus(await res.json());
  } catch (_e) {
    return normalizeSampleStatus(null);
  }
}
