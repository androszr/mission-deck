// ── Mission Deck — js/state.js ────────────────────────────────────────────
// Single mutable module-scope object shared across views. Deliberately only
// SHELL flags - never cached view data. Views fetch on demand, which is what
// keeps "the screen disagrees with the server" out of this app: there is no
// second copy of a dataset here to go stale.

export const state = {
  /**
   * Cached GET /api/whoami payload (js/topbar.js): who the cockpit thinks is
   * using it. Null until the first fetch resolves; { valid:false } is the
   * normal answer before the vault is unlocked and git is configured.
   */
  whoami: null,
};
