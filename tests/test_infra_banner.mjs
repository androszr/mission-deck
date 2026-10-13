// Unit tests for the "no connection to the cockpit infrastructure" strip:
// the pure two-input decision in js/infra-banner-helpers.mjs plus the source
// pins that keep its halves (js/infra-banner.js, js/theme-boot.js, styles.css,
// index.html, js/topbar.js, js/update-banner.js, the register in server.js)
// naming the same key, the same padding, the same element and the same bus.
// Run: node --test tests/test_infra_banner.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  INFRA_BANNER_TEXTS, INFRA_BANNER_OPEN_VAULT, INFRA_BANNER_RECHECK,
  infraBannerState, infraBannerVisible, infraBannerCanOpenVault, infraBannerCanRecheck, infraRecovered,
} from '../js/infra-banner-helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const BANNER = read('js/infra-banner.js');
const THEME_BOOT = read('js/theme-boot.js');
const STYLES = read('styles.css');
const INDEX = read('index.html');
const TOPBAR = read('js/topbar.js');
const UPDATE_BANNER = read('js/update-banner.js');
const ACADEMY = read('js/academy.js');
const WIZARD = read('js/onboarding-wizard.js');
const SERVER = read('server.js');

const OK = { state: 'reachable', since: '2026-09-14T10:00:00.000Z', source: 'identity' };
const DOWN = { state: 'unreachable', since: '2026-09-14T10:00:00.000Z', source: 'git:fetch' };
const REFUSED = { state: 'refused', since: '2026-09-16T08:00:00.000Z', source: 'git:push' };
const NONE = { state: 'unknown', since: null, source: null };

describe('infraBannerState - two readings, the answer names only what is wrong', () => {
  it('vault: every shape of "no secret" while the network says nothing bad', () => {
    assert.equal(infraBannerState({ status: 'locked', installed: true, hasSecrets: false }, NONE), 'vault');
    assert.equal(infraBannerState({ status: 'unlocked', installed: true, hasSecrets: false }, OK), 'vault');
    assert.equal(infraBannerState({ installed: false, hasSecrets: false }, null), 'vault');
    // A payload that never says hasSecrets is a server that loaded nothing.
    assert.equal(infraBannerState({ status: 'locked' }, NONE), 'vault');
  });

  it('network: secrets loaded, GitLab did not answer - the screenshot case', () => {
    // Green pill (tokens from the local bw cache, or surviving a restart),
    // clone failed on "Could not resolve host". The first version hid here.
    assert.equal(infraBannerState({ status: 'unlocked', hasSecrets: true }, DOWN), 'network');
    assert.equal(infraBannerState({ status: 'locked', hasSecrets: true, sessionOpen: false }, DOWN), 'network');
    // The two readings are independent: a dead bitwarden endpoint does not
    // silence a network verdict.
    assert.equal(infraBannerState(null, DOWN), 'network');
  });

  it('access: secrets loaded, GitLab answered and refused - the no-VPN case on a public host', () => {
    // Reported 2026-09-16: gitlab.com answers with the VPN down (the group's
    // IP allowlist replies 401), so the register said `reachable`, the strip
    // hid, and the only thing the person saw was "Token nie zostal przyjety"
    // in Settings > System. A refusal is now its own kind.
    assert.equal(infraBannerState({ status: 'unlocked', hasSecrets: true }, REFUSED), 'access');
    // A refused token is still a LOADED token, so this is the branch the
    // reported case takes - never the vault one.
    assert.equal(infraBannerState({ status: 'locked', hasSecrets: true, sessionOpen: false }, REFUSED), 'access');
    assert.equal(infraBannerState(null, REFUSED), 'access');
    // Silence outranks a refusal: nothing answered is the bigger claim.
    assert.equal(infraBannerState({ hasSecrets: true }, DOWN), 'network');
    // With no token at all the vault comes first - there is nothing to retry with.
    assert.equal(infraBannerState({ status: 'locked', hasSecrets: false }, REFUSED), 'vault');
  });

  it('both: no secret and no network', () => {
    assert.equal(infraBannerState({ status: 'locked', hasSecrets: false }, DOWN), 'both');
    assert.equal(infraBannerState({ installed: false }, DOWN), 'both');
  });

  it('hides once a secret is loaded and the network is fine or untried', () => {
    assert.equal(infraBannerState({ status: 'unlocked', hasSecrets: true }, OK), 'hide');
    assert.equal(infraBannerState({ status: 'unlocked', hasSecrets: true }, NONE), 'hide');
    assert.equal(infraBannerState({ status: 'unlocked', hasSecrets: true }, null), 'hide');
    // Secrets present, no network reading at all: nothing has failed.
    assert.equal(infraBannerState({ status: 'locked', hasSecrets: true, sessionOpen: false }, undefined), 'hide');
  });

  it('is unknown, not shown, when there was no answer on either side', () => {
    assert.equal(infraBannerState(null, null), 'unknown');
    assert.equal(infraBannerState(undefined, undefined), 'unknown');
    assert.equal(infraBannerState('nope', 'nope'), 'unknown');
    // A network reading that says "unknown" with no vault reading is still nothing.
    assert.equal(infraBannerState(null, NONE), 'hide');
  });

  it('visible for exactly the four problem kinds', () => {
    assert.equal(infraBannerVisible('vault'), true);
    assert.equal(infraBannerVisible('network'), true);
    assert.equal(infraBannerVisible('access'), true);
    assert.equal(infraBannerVisible('both'), true);
    assert.equal(infraBannerVisible('hide'), false);
    assert.equal(infraBannerVisible('unknown'), false);
  });

  it('offers the vault button only where the vault is the problem AND a CLI can open one', () => {
    assert.equal(infraBannerCanOpenVault('vault', { installed: true }), true);
    assert.equal(infraBannerCanOpenVault('both', { installed: true }), true);
    assert.equal(infraBannerCanOpenVault('vault', { installed: false }), false);
    assert.equal(infraBannerCanOpenVault('vault', null), false);
    assert.equal(infraBannerCanOpenVault('network', { installed: true }), false);
    assert.equal(infraBannerCanOpenVault('access', { installed: true }), false, 'a refusal is not a vault problem');
    assert.equal(infraBannerCanOpenVault('hide', { installed: true }), false);
  });

  it('offers the recheck on both network kinds - on both the vault comes first', () => {
    assert.equal(infraBannerCanRecheck('network'), true);
    // Turning the VPN on is exactly what a person does before clicking.
    assert.equal(infraBannerCanRecheck('access'), true);
    assert.equal(infraBannerCanRecheck('both'), false);
    assert.equal(infraBannerCanRecheck('vault'), false);
    assert.equal(infraBannerCanRecheck('hide'), false);
  });

  it('infraRecovered fires on every bad -> reachable edge, and cannot echo', () => {
    assert.equal(infraRecovered(DOWN, OK), true);
    // A refusal that got through is the same event one cause over: the VPN
    // came up, or the token was renewed. Both leave the server memos holding
    // a failure for up to a minute.
    assert.equal(infraRecovered(REFUSED, OK), true);
    assert.equal(infraRecovered(DOWN, DOWN), false);
    assert.equal(infraRecovered(REFUSED, REFUSED), false);
    assert.equal(infraRecovered(DOWN, NONE), false);
    assert.equal(infraRecovered(REFUSED, NONE), false);
    assert.equal(infraRecovered(OK, OK), false, 'the echo a listener re-reading /api/infra/status lands on');
    assert.equal(infraRecovered(null, OK), false);
    assert.equal(infraRecovered(undefined, OK), false);
    assert.equal(infraRecovered(DOWN, null), false);
    // Between the two bad states nothing has come back.
    assert.equal(infraRecovered(DOWN, REFUSED), false);
    assert.equal(infraRecovered(REFUSED, DOWN), false);
  });

  it('every sentence names its own fix', () => {
    assert.match(INFRA_BANNER_TEXTS.vault, /Unlock the Bitwarden vault/);
    assert.doesNotMatch(INFRA_BANNER_TEXTS.vault, /VPN/, 'a locked vault must not send people to the VPN');
    assert.match(INFRA_BANNER_TEXTS.network, /GitLab is not answering/);
    assert.match(INFRA_BANNER_TEXTS.network, /VPN/);
    assert.doesNotMatch(INFRA_BANNER_TEXTS.network, /vault/, 'a dead network must not send people to the vault');
    // The refusal sentence names BOTH causes, VPN first and the token second,
    // the same order as MODULES_CATALOG_NO_ACCESS_MESSAGE and the update
    // errors: with the VPN already on, a refusal really is the token.
    assert.match(INFRA_BANNER_TEXTS.access, /VPN/);
    assert.match(INFRA_BANNER_TEXTS.access, /token/);
    assert.ok(INFRA_BANNER_TEXTS.access.indexOf('VPN') < INFRA_BANNER_TEXTS.access.indexOf('token'));
    assert.doesNotMatch(INFRA_BANNER_TEXTS.access, /vault/, 'a refusal is not a vault story');
    assert.doesNotMatch(INFRA_BANNER_TEXTS.access, /not answering/, 'GitLab DID answer - that is the whole distinction');
    assert.match(INFRA_BANNER_TEXTS.both, /Bitwarden vault/);
    assert.match(INFRA_BANNER_TEXTS.both, /VPN/);
    assert.match(INFRA_BANNER_TEXTS.both, /No connection to the Mission Deck infrastructure/);
    assert.equal(INFRA_BANNER_OPEN_VAULT, 'Open vault');
    assert.equal(INFRA_BANNER_RECHECK, 'Check again');
    assert.ok(Object.isFrozen(INFRA_BANNER_TEXTS));
  });
});

describe('infra banner - the halves name the same things', () => {
  it('theme-boot reserves the row from the key infra-banner.js writes', () => {
    assert.ok(BANNER.includes("const SEEN_KEY = 'cockpit.infraBannerSeen';"));
    assert.ok(THEME_BOOT.includes("localStorage.getItem('cockpit.infraBannerSeen')"));
    assert.ok(THEME_BOOT.includes("setAttribute('data-infra-banner', 'reserved')"));
    assert.ok(BANNER.includes("removeAttribute('data-infra-banner')"));
  });

  it('the shell carries the box with a skeleton, BEFORE the update banner', () => {
    const strip = INDEX.indexOf('id="infra-banner"');
    const update = INDEX.indexOf('id="app-update-banner"');
    assert.notEqual(strip, -1);
    assert.ok(strip < update, 'the update banner list must paint over the strip');
    const tag = INDEX.slice(strip, INDEX.indexOf('</div>', strip));
    assert.ok(tag.includes('app-update-banner--infra'));
    assert.ok(tag.includes('app-update-banner--hidden'));
    assert.ok(tag.includes('data-skel="1"'));
  });

  it('shown and reserved states share one padding, and both banners together pad 148px', () => {
    assert.ok(STYLES.includes('.app:has(#infra-banner:not(.app-update-banner--hidden)) .main,\n'
      + 'html[data-infra-banner="reserved"] .main {\n  padding-top: 108px;\n}'));
    assert.ok(STYLES.includes('html[data-update-banner="reserved"][data-infra-banner="reserved"] .main {\n  padding-top: 148px;\n}'));
    assert.ok(STYLES.includes('html[data-update-banner="reserved"] #infra-banner {\n  top: 84px;\n}'));
    assert.ok(STYLES.includes('html[data-infra-banner="reserved"] #infra-banner.app-update-banner--hidden {\n  display: flex;\n}'));
  });

  it('paints from the top bar status read, on every exit including a dead endpoint', () => {
    assert.ok(TOPBAR.includes("import { paintInfraBanner, paintInfraNetwork } from './infra-banner.js';"));
    const fn = TOPBAR.slice(TOPBAR.indexOf('export async function _renderBitwardenButton'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    assert.equal((body.match(/paintInfraBanner\(null\)/g) || []).length, 2, 'both failure exits hand over null');
    assert.equal((body.match(/paintInfraBanner\(status\)/g) || []).length, 1);
    // The strip must be painted BEFORE the no-CLI return, or a machine without
    // Bitwarden never sees it.
    assert.ok(body.indexOf('paintInfraBanner(status)') < body.indexOf('!status.installed'));
  });

  it('never fetches on its own and releases on every settled answer', () => {
    assert.ok(!BANNER.includes('fetch('), 'the strip paints from the top bar answers only');
    const fn = BANNER.slice(BANNER.indexOf('function _repaint'));
    assert.equal((fn.match(/_settleReservation\(true\)/g) || []).length, 1);
    assert.equal((fn.match(/_settleReservation\(false\)/g) || []).length, 1);
    // Both halves land in the one repaint.
    assert.ok(BANNER.includes('export function paintInfraBanner'));
    assert.ok(BANNER.includes('export function paintInfraNetwork'));
  });

  it('the update banner re-reads the register after every check-update, so a refusal it recorded reaches the strip at once', () => {
    // check-update's ls-remote is the one call on a normal load that writes
    // `refused`, and it settles after the top bar's first register read.
    const fn = UPDATE_BANNER.slice(UPDATE_BANNER.indexOf('async function checkOnce'), UPDATE_BANNER.indexOf('export function initUpdateBanner'));
    const fin = fn.slice(fn.lastIndexOf('finally {'));
    assert.ok(fin.includes("import('./topbar.js').then(({ refreshInfraStatus }) => refreshInfraStatus())"), 'in finally, so every exit re-reads');
    assert.ok(!UPDATE_BANNER.includes("from './topbar.js'"), 'no static edge to the top bar');
  });

  it('the network half is read by the top bar: boot (after the identity lookup), the 60 s poll, and the recheck', () => {
    assert.ok(TOPBAR.includes('export async function refreshInfraStatus'));
    assert.ok(TOPBAR.includes("fetch('/api/infra/status?t='"));
    assert.ok(TOPBAR.includes("fetch('/api/infra/recheck'"));
    // The identity lookup is the first GitLab call of a load, so the register
    // has its first verdict right after it.
    const load = TOPBAR.slice(TOPBAR.indexOf('async function _loadIdentity'), TOPBAR.indexOf('export async function refreshInfraStatus'));
    assert.ok(load.includes('refreshInfraStatus()'));
    const poll = TOPBAR.slice(TOPBAR.indexOf('_syncPollTimer = setInterval'), TOPBAR.indexOf('}, 60000);'));
    assert.ok(poll.includes('refreshInfraStatus()'));
    // The recheck is a POST with a JSON body: checkOrigin answers 415 otherwise.
    const recheck = TOPBAR.slice(TOPBAR.indexOf('export async function recheckInfra'));
    assert.ok(recheck.includes("'Content-Type': 'application/json'"));
    assert.ok(recheck.includes("method: 'POST'"));
  });

  it('the recovery edge is announced on the infra bus and both the top bar and the update banner re-derive', () => {
    assert.ok(BANNER.includes("import { emitInfraChanged } from './infra-events.js';"));
    assert.ok(BANNER.includes('if (recovered) emitInfraChanged('));
    // The edge is computed against the PREVIOUS reading and `_net` is
    // assigned before the bus fires: listeners re-read the status and land
    // back in paintInfraNetwork, and an echo of `reachable` must not re-emit.
    const paint = BANNER.slice(BANNER.indexOf('export function paintInfraNetwork'));
    assert.ok(paint.indexOf('const recovered = infraRecovered(_net, next);') < paint.indexOf('_net = next;'));
    assert.ok(paint.indexOf('_net = next;') < paint.indexOf('if (recovered) emitInfraChanged('));
    assert.ok(TOPBAR.includes("import { onInfraChanged } from './infra-events.js';"));
    assert.ok(TOPBAR.includes('onInfraChanged(() => { refreshTopbarAfterSecrets(); });'));
    assert.ok(UPDATE_BANNER.includes("import { onInfraChanged } from './infra-events.js';"));
    assert.ok(UPDATE_BANNER.includes('onInfraChanged(() => { checkOnce(); });'));
  });

  it('the two "ds-data is not cloned" surfaces say WHY when the network reading knows', () => {
    // Academy: both callouts carry the hint; the wizard's clone card
    // names the reason and re-derives on the infra bus.
    assert.ok(ACADEMY.includes("import { getInfraNetwork } from './infra-banner.js';"));
    assert.ok(ACADEMY.includes("import { onInfraChanged } from './infra-events.js';"));
    assert.ok(ACADEMY.includes('if (view && view.classList.contains(\'active\')) refreshAcademyData();'));
    assert.equal((ACADEMY.match(/\$\{_cloneHintHtml\(\)\}/g) || []).length, 2);
    assert.ok(ACADEMY.includes('GitLab is not answering right now - connect to the VPN before you clone.'));
    // Both bad readings block the same clone; only the reason differs.
    assert.ok(ACADEMY.includes("if (net.state === 'refused')"));
    assert.ok(ACADEMY.includes('GitLab refuses connections from this computer - check the VPN and, if it is on, renew your token before you clone.'));
    assert.ok(WIZARD.includes("const blocked = netState === 'unreachable' || netState === 'refused';"));
    assert.ok(WIZARD.includes('GitLab refuses the connection from this computer - check the VPN and, if it works, renew the token before you click "Download team data".'));
    assert.ok(WIZARD.includes("import { getInfraNetwork } from './infra-banner.js';"));
    assert.ok(WIZARD.includes("import { onInfraChanged } from './infra-events.js';"));
    assert.ok(WIZARD.includes('turn on the VPN before you click "Download team data"'));
    assert.ok(WIZARD.includes('onInfraChanged(() => {'));
  });

  it('an unchanged kind is not rebuilt (the poll must not swap a running "Checking…" for a live button)', () => {
    assert.ok(BANNER.includes("banner.dataset.kind === kind;"));
    assert.ok(BANNER.includes('else if (!showing) _render(banner, kind);'));
    // The top bar drops an infra read that a newer one overtook.
    assert.ok(TOPBAR.includes('let _infraReadSeq = 0;'));
    assert.ok(TOPBAR.includes('if (mine !== _infraReadSeq) return;'));
    // One check-update at a time, whichever of the three callers asks.
    assert.ok(UPDATE_BANNER.includes('if (_checkInFlight) return;'));
    assert.ok(UPDATE_BANNER.includes('_checkInFlight = false;'));
  });

  it('the dismiss is keyed on the kind, so one click cannot silence a different problem', () => {
    assert.ok(BANNER.includes('let _dismissedKind = null;'));
    assert.ok(BANNER.includes('_dismissedKind = kind;'));
    assert.ok(BANNER.includes('if (_dismissedKind === kind) _hide(banner); else if (!showing) _render(banner, kind);'));
  });

  it('the server register is fed by every GitLab call the process already makes, and probes nowhere on its own', () => {
    // Fetch call sites: identity, activity chip, catalog (MR chips ride it).
    // Every response hands over its STATUS, or a 401 reads as a success.
    assert.ok(SERVER.includes("_infraNoteFetch(null, 'identity', r.status)"));
    assert.ok(SERVER.includes("_infraNoteFetch(e, 'identity')"));
    assert.ok(SERVER.includes("_infraNoteFetch(null, 'activity', r.status)"));
    assert.ok(SERVER.includes("_infraNoteFetch(err, 'activity')"));
    assert.ok(SERVER.includes("_infraNoteFetch(null, 'catalog', r.status)"));
    assert.ok(SERVER.includes("_infraNoteFetch(e, 'catalog')"));
    // A git refusal with the APP credential goes to the third axis, never
    // back to `reachable`; a data source's says nothing.
    assert.ok(SERVER.includes("else if ((cat === 'auth-expired' || cat === 'no-access') && _infraSourceIsAppCredential(source)) _infraNoteRefused(source);"));
    // Git call sites: every remote op on a data source, the clone, and the
    // app repository's own (check-update).
    assert.ok(SERVER.includes("if (isRemoteOp) _infraNoteGitResult(result, 'git:' + args[0], { statusOp: Number(opts.timeoutMs) > 0 });"));
    assert.ok(SERVER.includes("_infraNoteGitResult({ code: 1, stderr: stderr || '', killed }, 'git:clone');"));
    assert.ok(SERVER.includes("_infraNoteNetwork(true, 'git:clone');"));
    // After resolve(r): nothing in the note can leave the wrapper pending.
    const gitP = SERVER.slice(SERVER.indexOf('function _gitP('), SERVER.indexOf('function _appAuthUrl('));
    assert.ok(gitP.indexOf('resolve(r);') < gitP.indexOf("_infraNoteGitResult(r, 'app:' + remoteSub, { statusOp: remoteSub === 'ls-remote' })"));
    // The status route is a register read; only the recheck asks GitLab.
    const status = SERVER.slice(SERVER.indexOf('function handleInfraStatus'), SERVER.indexOf('async function handleInfraRecheck'));
    assert.ok(!status.includes('fetch(') && !status.includes('_gitlabIdentity('));
    const recheck = SERVER.slice(SERVER.indexOf('async function handleInfraRecheck'), SERVER.indexOf('// ── Route dispatch'));
    assert.ok(recheck.includes('await _gitlabIdentity();'));
    // The recheck probes the app repository LAST, so its verdict is the
    // newest; the identity lookup alone cannot see an IP allowlist.
    assert.ok(recheck.includes("if (authUrl) await _gitP(['ls-remote', authUrl, 'HEAD'], 15000);"));
    assert.ok(recheck.indexOf('await _gitlabIdentity();') < recheck.indexOf("_gitP(['ls-remote'"));
    assert.ok(recheck.includes('if (!checkOrigin(req, res)) return;'));
    // A recovery drops the three memos that may hold a FAILURE - and never
    // _gitlabIdentityLatest, the last GOOD record behind _localIdentity().
    const note = SERVER.slice(SERVER.indexOf('function _infraNoteOutcomeApply'), SERVER.indexOf('function _infraNoteGitResult'));
    assert.ok(note.includes('_gitlabIdentityCache = { token: null, at: 0, data: null };'));
    assert.ok(note.includes('_gitlabActivityCountCache = { token: null, at: 0, data: null };'));
    assert.ok(note.includes('_mrCountsCache = { token: null, at: 0, data: null };'));
    assert.ok(!note.includes('_invalidateLocalIdentity()'));
    assert.ok(!note.includes('_gitlabIdentityLatest ='), 'the last good record is never reset by the edge');
    // The note is wrapped: it runs inside execFile callbacks.
    assert.ok(SERVER.includes('try { _infraNoteOutcomeApply(kind, source); } catch'));
  });
});
