// ── Mission Deck — js/infra-banner-helpers.mjs ────────────────────────
// The decision and the copy behind the "no connection to the cockpit
// infrastructure" strip (js/infra-banner.js). DOM-free on purpose, so
// tests/test_infra_banner.mjs reads it directly.
//
// The strip answers TWO questions from two independent readings, and the
// answer names only what is actually wrong:
//   - the vault half, from /api/bitwarden/status: does this server hold any
//     token at all?
//   - the network half, from /api/infra/status: did the last call to GitLab
//     get through? (a register the server fills from the calls it already
//     makes - never a probe of its own)
// The first version keyed on the vault alone and told people to check the
// VPN. `bw` reads its LOCAL cache, so the vault opens without the VPN, the
// tokens survive in the heap, the pill turned green - and the strip hid on
// exactly the machine it was written for. The same taxonomy as
// syncPrereqCallout in js/sync-center-helpers.js: vault / network / both,
// plus `access` for the third failure this cockpit really has.
//
// `access` is the network half answering `refused`: GitLab ANSWERED and
// turned this machine away. It is its own kind and not a flavour of
// `network`, because the two have different fixes and different lies - a
// refusal with the VPN up is a real token problem, and a `network` sentence
// would send that person after a VPN that is already on. It is also not
// silence: a GitLab that is public SaaS behind a group IP allowlist still
// answers with the VPN down, just with 401. Both causes
// get named, VPN first, the same order as MODULES_CATALOG_NO_ACCESS_MESSAGE
// and the update errors in js/app-update-errors.js.

/** One sentence per kind. */
export const INFRA_BANNER_TEXTS = Object.freeze({
  vault: 'Mission Deck holds no token. Unlock the Bitwarden vault to fetch the keys.',
  network: 'No connection to the Mission Deck infrastructure - GitLab is not answering. Turn on the VPN and check again.',
  access: 'GitLab answers, but refuses connections from this computer - most often the VPN is off. If the VPN is on, renew the token in Settings > Keys.',
  both: 'No connection to the Mission Deck infrastructure. Unlock the Bitwarden vault and turn on the VPN.',
});

export const INFRA_BANNER_OPEN_VAULT = 'Open vault';
export const INFRA_BANNER_RECHECK = 'Check again';
export const INFRA_BANNER_RECHECKING = 'Checking…';

/**
 * What the strip should do for one pair of readings.
 *
 * - `vault`   - the server holds no secret and the network says nothing bad:
 *               a locked vault, a vault whose collection matched nothing, or
 *               no Bitwarden CLI at all.
 * - `network` - secrets are loaded, but the last call to GitLab failed on the
 *               network: nothing answered, the VPN is the story.
 * - `access`  - secrets are loaded and GitLab answered, but refused us: the
 *               VPN or the token, and the sentence names both.
 * - `both`    - no secret AND the network is down.
 * - `hide`    - at least one secret is loaded and the network is reachable
 *               or has not been tried yet.
 * - `unknown` - no answer on either side (dead endpoints). Not a reason to
 *               show a strip that blames the vault, and not a reason to hold
 *               its reservation either.
 *
 * `hasSecrets: true` with `network: unknown` hides: nothing has failed, so
 * there is nothing to say. `status: null` with `network: unreachable` shows
 * the network half alone - the two readings are independent by design.
 *
 * A refusal alongside an empty vault resolves to `vault`, not to a fifth
 * kind: a token GitLab refuses is still a LOADED token, so the reported case
 * (refused with `hasSecrets: true`) lands on `access` and never here. What
 * lands here is an empty vault next to a refusal recorded earlier, and there
 * the vault wins because it is the one step that can be taken now - there is
 * nothing to retry GitLab with until a token exists.
 *
 * @param {object|null|undefined} status /api/bitwarden/status body, or null
 * @param {object|null|undefined} net `network` of /api/infra/status, or null
 * @returns {'vault'|'network'|'access'|'both'|'hide'|'unknown'}
 */
export function infraBannerState(status, net) {
  const hasStatus = !!status && typeof status === 'object';
  const vaultBad = hasStatus && status.hasSecrets !== true;
  const netState = net && typeof net === 'object' ? String(net.state || '') : '';
  const netBad = netState === 'unreachable';
  const netRefused = netState === 'refused';
  if (vaultBad && netBad) return 'both';
  if (netBad) return 'network';
  if (vaultBad) return 'vault';
  if (netRefused) return 'access';
  if (!hasStatus && !netState) return 'unknown';
  return 'hide';
}

/** Whether a kind paints the strip at all. */
export function infraBannerVisible(kind) {
  return kind === 'vault' || kind === 'network' || kind === 'access' || kind === 'both';
}

/**
 * Whether the strip may offer the "open the vault" button: only for a kind
 * where the vault is part of the problem, and only when there is a CLI to
 * open it with. A machine without Bitwarden gets the sentence alone - a
 * button that cannot work is worse than none.
 * @param {'vault'|'network'|'both'|'hide'|'unknown'} kind
 * @param {object|null|undefined} status
 * @returns {boolean}
 */
export function infraBannerCanOpenVault(kind, status) {
  if (kind !== 'vault' && kind !== 'both') return false;
  return Boolean(status && status.installed === true);
}

/**
 * Whether the strip offers "Check again": only where the network is
 * part of the problem. The recheck asks GitLab with the app token; on `both`
 * there is no token yet, so the vault comes first and the button is left out.
 * `access` gets it for the same reason `network` does - turning the VPN on is
 * exactly the thing a person does between the strip appearing and the click.
 * @param {'vault'|'network'|'access'|'both'|'hide'|'unknown'} kind
 * @returns {boolean}
 */
export function infraBannerCanRecheck(kind) {
  return kind === 'network' || kind === 'access';
}

// The readings that mean "the cockpit could not do its work": nothing
// answered, or something answered and said no.
const _BAD_NET_STATES = new Set(['unreachable', 'refused']);

/**
 * Whether a change of network verdict means "the infrastructure came back":
 * the previous reading was a bad one and this one got through. That is the
 * moment every token-derived surface has to re-derive itself, because the
 * server caches memoised a FAILURE for up to a minute.
 *
 * `refused -> reachable` is the same event as `unreachable -> reachable`, one
 * cause over: the VPN came up, or the token was renewed. It cannot loop - a
 * listener re-reads /api/infra/status and lands back here with `reachable`
 * over a `_net` that already says `reachable`, which is not an edge.
 * @param {object|null|undefined} prev previous `network` reading
 * @param {object|null|undefined} next current `network` reading
 * @returns {boolean}
 */
export function infraRecovered(prev, next) {
  const p = prev && typeof prev === 'object' ? prev.state : null;
  const n = next && typeof next === 'object' ? next.state : null;
  return _BAD_NET_STATES.has(p) && n === 'reachable';
}
