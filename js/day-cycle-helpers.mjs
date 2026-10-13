// -- Mission Deck -- js/day-cycle-helpers.mjs -------------------------
// Pure, DOM-free presentation logic behind the "End of day" / "Good morning"
// flow (js/day-cycle-modal.js). No `document`, no `window`, no import that
// touches either - tests/test_day_cycle_helpers.mjs imports this file
// directly under `node --test`, the same discipline js/sync-center-helpers.js
// already carries.
//
// Every string literal in THIS file stays ASCII on purpose (gate: `LC_ALL=C
// grep -n '[^[:print:][:space:]]' js/day-cycle-helpers.mjs` prints nothing).
// None of the labels a person actually reads live here: every function
// below returns an ASCII STATE CODE or REASON CODE, never the sentence shown
// on screen. js/day-cycle-modal.js owns the one lookup table that turns a
// code into display copy - keeping that table out of this file is what lets
// this file stay pure and ASCII at the same time.

/**
 * What to do with one GET /api/sync-overview row during the evening
 * wrap-up, and the ASCII reason code when it is skipped. Checked in order of
 * how hard a prerequisite it is - a row not even cloned skips before a row
 * whose token is merely missing, and so on - so only a row that clears every
 * gate reaches the branch that decides push-and-clear vs a bare clear.
 *
 * `reason` is a CODE, never a sentence - deliberately the same four codes
 * `dayCycleRowBadge` below returns for the same four states, so both resolve
 * through the one `_BADGE_LABEL` table in js/day-cycle-modal.js and the
 * evening plan badge and the row badge can never drift apart. Returning the
 * display text from here instead would put user copy in a file whose header
 * promises none.
 * @param {{status?: string, hasToken?: boolean, canPush?: boolean,
 *   encryptionReady?: boolean, bitwardenLocked?: boolean,
 *   filesToSend?: number|null}} row
 * @returns {{action: 'push-and-clear'|'clear'|'skip', reason?: string}}
 */
export function wrapUpPlanForRow(row) {
  const r = row || {};
  if (r.status !== 'ready') return { action: 'skip', reason: 'not-ready' };
  if (!r.hasToken && r.canPush) return { action: 'skip', reason: 'no-token' };
  if (r.encryptionReady === false) return { action: 'skip', reason: 'no-key' };
  if (r.bitwardenLocked) return { action: 'skip', reason: 'locked' };
  if (r.canPush && typeof r.filesToSend === 'number' && r.filesToSend > 0) {
    return { action: 'push-and-clear' };
  }
  return { action: 'clear' };
}

// Push failures that leave work sitting ONLY in the plaintext tree - clearing
// it now would be the one thing this whole feature exists to prevent. Every
// other push failure still lets the clear proceed: the encrypt+commit step
// already ran, so the work survives in the local mirror and the morning
// decrypt brings it back.
const _PUSH_BLOCKS_CLEAR = new Set([
  'key-missing', 'key-invalid', 'encrypt-failed', 'encrypt-destructive',
  'conflict-markers', 'locked',
]);

/**
 * Whether a push outcome still allows the plaintext clear that follows it.
 * `undefined`/`null` (no error - the push succeeded, or push was skipped for
 * this row) and every network/auth/rejection category answer `true`: the
 * SERVER'S OWN gate (`wrapUpClearEligibility`) is the real guard here, this
 * only steers which sentence the summary uses.
 * @param {string|null|undefined} error
 * @returns {boolean}
 */
export function pushOutcomeAllowsClear(error) {
  if (!error) return true;
  return !_PUSH_BLOCKS_CLEAR.has(error);
}

/**
 * Rows the morning modal offers to decrypt: cloned, with a usable key, and
 * either never decrypted or wrapped up last night. The `wrappedUpAt` half of
 * that OR is the fix for the "stale decrypted:true" bug: one write from
 * Academy after a wrap-up is enough for `_repoDecryptedState` to see a
 * non-empty mirror overlap and report `decrypted:true` on a tree that is
 * still 99% empty, so a row carrying the marker belongs on this list even
 * when `decrypted` reads true.
 * @param {{status?: string, encryptionReady?: boolean, decrypted?: boolean,
 *   wrappedUpAt?: string|null}[]} rows
 * @returns {object[]}
 */
export function morningRowsToDecrypt(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.filter((r) => r && r.status === 'ready' && r.encryptionReady !== false
    && (r.decrypted === false || !!r.wrappedUpAt));
}

/**
 * Row-state badge shared by both modals: the evening list (what will happen
 * to this row / why it is blocked) and the morning list (which state this
 * row is in - see `morningRowsToDecrypt`). `state` is an ASCII code;
 * js/day-cycle-modal.js maps it to the label actually shown.
 * @param {{status?: string, hasToken?: boolean, canPush?: boolean,
 *   bitwardenLocked?: boolean, encryptionReady?: boolean,
 *   wrappedUpAt?: string|null, decrypted?: boolean,
 *   filesToSend?: number|null}} row
 * @returns {{cls: string, state: string}}
 */
export function dayCycleRowBadge(row) {
  const r = row || {};
  if (r.status !== 'ready') return { cls: 'ds-badge--gray', state: 'not-ready' };
  if (!r.hasToken && r.canPush) return { cls: 'ds-badge--yellow', state: 'no-token' };
  if (r.bitwardenLocked) return { cls: 'ds-badge--yellow', state: 'locked' };
  if (r.encryptionReady === false) return { cls: 'ds-badge--yellow', state: 'no-key' };
  // The MARKER ALONE decides, with no `&& r.decrypted !== true` guard - that
  // clause would defeat the very case this branch exists for. A wrapped-up
  // row with one stray write on top (a Academy progress file, say)
  // reads `decrypted: true` again, because `_repoDecryptedState` only sees a
  // non-empty mirror overlap, on a tree that is still ~99% empty. The server
  // clears `wrappedUpAt` on a successful decrypt, so the mark being present
  // already means "wiped and not yet restored" - reading `decrypted` here
  // would re-import the lie. Same rule as `repoStateBadge` in
  // js/sync-center-helpers.js and `morningRowsToDecrypt` below; all three
  // must agree or the badge, the sync table and the morning list disagree
  // about the same row.
  if (r.wrappedUpAt) return { cls: 'ds-badge--yellow', state: 'wrapped-up' };
  if (r.decrypted === false) return { cls: 'ds-badge--yellow', state: 'not-decrypted' };
  if (r.canPush && typeof r.filesToSend === 'number' && r.filesToSend > 0) {
    return { cls: 'ds-badge--yellow', state: 'pending' };
  }
  return { cls: 'ds-badge--green', state: 'ready' };
}

/**
 * Tally one evening run for the closing screen. `results` is one entry per
 * row this run touched, in the order it was processed. No display text here
 * on purpose (see file header) - `outcome` and `reason` are ASCII codes that
 * js/day-cycle-modal.js turns into the sentence a person reads.
 * @param {{repoId: string, label?: string,
 *   outcome: 'pushed-and-cleared'|'cleared'|'skipped',
 *   reason?: string|null}[]} results
 * @returns {{cleared: number, skipped: number, pushed: number,
 *   lines: {repoId: string, label: string, outcome: string,
 *   reason: string|null}[]}}
 */
export function summarizeWrapUp(results) {
  const list = Array.isArray(results) ? results : [];
  let cleared = 0;
  let skipped = 0;
  let pushed = 0;
  const lines = list.map((entry) => {
    const item = entry || {};
    const outcome = item.outcome === 'pushed-and-cleared' || item.outcome === 'cleared'
      ? item.outcome
      : 'skipped';
    if (outcome === 'pushed-and-cleared') { cleared += 1; pushed += 1; } else if (outcome === 'cleared') { cleared += 1; } else { skipped += 1; }
    return {
      repoId: item.repoId || '',
      label: item.label || item.repoId || '',
      outcome,
      reason: outcome === 'skipped' ? (item.reason || null) : null,
    };
  });
  return { cleared, skipped, pushed, lines };
}

/**
 * Which of the two top-bar actions the ONE day-cycle pill shows right now.
 * `'morning'` when ANY row still carries a `wrappedUpAt` marker - recovering
 * data is what unblocks work, so a mixed registry (some sources cleared, some
 * not) resolves to 'morning' on purpose, not to the row-by-row majority.
 * An empty or failed read is the fresh-install shape and answers 'wrapup',
 * the neutral default.
 * @param {{wrappedUpAt?: string|null}[]} rows
 * @returns {'morning'|'wrapup'}
 */
export function dayCycleMode(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.some((r) => r && r.wrappedUpAt) ? 'morning' : 'wrapup';
}

/**
 * Whether the morning modal should open itself, unprompted, on this load.
 * `lastCleared` is the ISO timestamp `cockpit.dayCycle.lastCleared` carried
 * (set only when a wrap-up actually cleared something); `greetedOn` and
 * `today` are LOCAL `YYYY-MM-DD` strings, never a UTC slice - the same rule
 * `_fmtHHMM` in js/topbar.js already states, because a UTC day flips hours
 * before midnight in Poland and would re-open the modal the same evening.
 * @param {{lastCleared?: string|null, greetedOn?: string|null, today?: string}} args
 * @returns {boolean}
 */
export function shouldAutoOpenMorning({ lastCleared, greetedOn, today } = {}) {
  return !!lastCleared && greetedOn !== today;
}
