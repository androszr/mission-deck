// ── Mission Deck — js/app-update-errors.js ───────────────────────────────
// Shared error-code → user-friendly message map for the /api/app/update endpoint.
// Used by both consumers (settings page update button + floating update banner) so
// new error codes only need to be declared once.

// Codes both endpoints (check-update and update) can answer with. A source
// archive (zip without .git) is adopted into a repository on the first check
// that holds a token; the two adopt-* codes and git-missing come from there.
// The four codes a missing VPN can produce all name VPN, because where
// GitLab sits behind one it is by far the most common cause and the app cannot tell the
// difference from here. 'network'/'timeout' are the unreachable-host trace. The
// other two are ambiguous: GitLab hides a repository this caller may not see
// (an IP allowlist with the VPN off, or a token without access) behind a plain
// 401/404 over git-over-HTTPS, so the answer reads as a rejected token while
// the real cause is the VPN - and _infraNoteGitResult counts exactly those two
// as "the host answered", so the infrastructure strip stays silent here too.
// VPN first, token second - the same order as MODULES_CATALOG_NO_ACCESS_MESSAGE.
const COMMON_MAP = {
  'no-token': () => 'No COCKPIT_APP_TOKEN token - set it up in Settings.',
  'no-access': () => 'No access to the repository - most often the VPN is off. If the VPN is on, check the token.',
  'auth-expired': () => 'The token was not accepted - most often the VPN is off. If the VPN is on, unlock the vault again or renew the token.',
  'network': () => 'Network error - turn on the VPN and check the connection to GitLab.',
  'timeout': () => 'GitLab did not answer in time - check that the VPN is connected and try again.',
  'no-remote': () => 'The app repository has an address the token cannot handle (e.g. SSH). Set origin to an HTTPS address.',
  'adopt-no-match': (body) => body.message
    || 'This package does not match any recent commit of the repository. Download a fresh package or clone the repository.',
  'git-missing': (body) => body.message || 'The git command was not found - install Git (Settings > Tools).',
  'error': (body) => body.message || 'Error.',
};

// Where the "stash and update" button lives: on EVERY surface that can answer
// a dirty tree - Settings > System (js/settings.js), step 6 of
// js/onboarding-wizard.js, the update modal (js/update-modal.js) and, since
// 2026-09-12, the sticky banner (js/update-banner.js). Each passes
// `stashActionHere: true` when it is about to render the button and gets the
// server's sentence alone. The banner has no room for a file list, so its
// button puts the list in the confirm dialog (stashConfirmText) - the
// destructive step is still one deliberate "yes" away, never a passing click.
// The pointer below is what a caller that CANNOT offer the button says
// (the tree holds a path the stash cannot name).
const DIRTY_TREE_POINTER = 'You can stash them and update from the update window or from Settings > System.';

const ERR_MAP = {
  ...COMMON_MAP,
  'checkout-failed': () => 'Git checkout failed.',
  'dirty-tree': (body, opts) => (body.message || 'The working tree has uncommitted changes.')
    + (opts && opts.stashActionHere === true ? '' : ' ' + DIRTY_TREE_POINTER),
  'stash-failed': (body) => body.message || 'The git stash command failed - the changes stayed in place and the update did not start.',
  'stash-missing': (body) => body.message || 'There was nothing to stash - the update was aborted.',
  'branch-not-main': (body) => body.message
    || `Currently on branch "${body.currentBranch || '?'}". Switch to main: git checkout main`,
};

// Returns the user-facing text for a failed /api/app/check-update response.
// overrides — per-view wording for a code (the wizard points at its own steps).
export function mapCheckUpdateError(body, overrides) {
  body = body || {};
  const own = overrides && overrides[body.error];
  if (own) return own;
  const mapper = COMMON_MAP[body.error];
  return mapper ? mapper(body) : ('Error: ' + (body.message || body.error || 'unknown'));
}

// Returns the user-facing error string for an /api/app/update response.
// body  — parsed JSON response (may have .error, .message, .currentBranch)
// statusCode — HTTP status, used as the last-resort fallback when there is no body.error
// opts.stashActionHere — the caller renders the stash button itself, so the
//   dirty-tree sentence must not send the person to Settings > System.
export function mapAppUpdateError(body, statusCode, opts) {
  body = body || {};
  const mapper = ERR_MAP[body.error];
  const friendly = mapper ? mapper(body, opts || {}) : (body.message || body.error || String(statusCode));
  return 'Update error: ' + friendly;
}
