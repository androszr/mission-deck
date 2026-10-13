// Unit tests for the loading-skeleton layer: the static markup in index.html
// that reserves each box's finished height before any endpoint answers, the
// rail-state guard in js/theme-boot.js that stops the whole grid sliding
// sideways on load, and the two rules a painter has to honour around a
// skeleton (js/skeleton.js).
//
// The document helpers are exercised against a hand-rolled stub rather than a real
// document: js/skeleton.js touches nothing but querySelector/querySelectorAll
// and remove(), which is the whole point of keeping it that small.
//
// Run: node --test tests/test_loading_skeletons.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { hasSkeleton, clearSkeleton } from '../js/skeleton.js';

const root = new URL('../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), 'utf8');

const INDEX = read('index.html');
const STYLES = read('styles.css');
const THEME_BOOT = read('js/theme-boot.js');
const TOPBAR = read('js/topbar.js');
const APP = read('js/app.js');
const MODULE_HOST = read('js/module-host.js');
const GITLAB_ACTIVITY = read('js/gitlab-activity.js');
const ACADEMY = read('js/academy.js');
const UPDATE_BANNER = read('js/update-banner.js');

// ── js/skeleton.js ───────────────────────────────────────────────────────────

/** Minimal Element stand-in: children carrying (or not) the data-skel marker. */
function stubRoot(skelCount, otherCount = 0) {
  const skels = Array.from({ length: skelCount }, () => ({ removed: false }));
  skels.forEach(s => { s.remove = () => { s.removed = true; }; });
  const others = Array.from({ length: otherCount }, () => ({ removed: false }));
  others.forEach(o => { o.remove = () => { o.removed = true; }; });
  return {
    skels,
    others,
    querySelector: () => (skels.length ? skels[0] : null),
    querySelectorAll: () => skels,
  };
}

describe('hasSkeleton', () => {
  it('is true while the static skeleton is still in the box', () => {
    assert.equal(hasSkeleton(stubRoot(3)), true);
  });

  it('is false once a painter has replaced it', () => {
    assert.equal(hasSkeleton(stubRoot(0)), false);
  });

  it('survives a missing root', () => {
    assert.equal(hasSkeleton(null), false);
    assert.equal(hasSkeleton(undefined), false);
  });
});

describe('clearSkeleton', () => {
  it('removes every skeleton node and nothing else', () => {
    const el = stubRoot(2, 2);
    clearSkeleton(el);
    assert.deepEqual(el.skels.map(s => s.removed), [true, true]);
    assert.deepEqual(el.others.map(o => o.removed), [false, false]);
  });

  it('is a no-op on a box that holds no skeleton', () => {
    const el = stubRoot(0);
    clearSkeleton(el);
    assert.equal(el.skels.length, 0);
  });

  it('survives a missing root', () => {
    assert.doesNotThrow(() => clearSkeleton(null));
  });
});

// ── The static markup ────────────────────────────────────────────────────────

// Every id here is a box filled by a fetch or by a lazily imported view module,
// so each one has to reserve its height at parse time. Settings and the
// wizard are deliberately absent: they ship their own skeletons already
// (sett-skel-* in index.html, obw-skel-* painted by js/onboarding-wizard.js).
const SKELETON_ROOTS = [
  'topbar-mr-root',
  'topbar-active-badge-root',
  'topbar-terminal-root',
  'topbar-daycycle-root',
  'topbar-sync-root',
  'topbar-bw-root',
  'topbar-user-root',
  'dashboard-cards',
  'academy-root',
  'gitlab-activity-root',
  'assets-design-system-root',
  'assets-icons-root',
  'assets-illustrations-root',
  'assets-mascot-root',
];

/**
 * The markup of one slot: from its `id="<id>"` up to the NEXT id in the file.
 * Bounded that way and not by a fixed length, because a slot whose skeleton was
 * deleted would otherwise pass on the next view's markup bleeding into the
 * slice - and these slots sit next to each other.
 */
function slotMarkup(id) {
  const at = INDEX.indexOf(`id="${id}"`);
  assert.notEqual(at, -1, `index.html has no element with id="${id}"`);
  const rest = INDEX.slice(at + `id="${id}"`.length);
  const next = rest.indexOf('id="');
  return next === -1 ? rest : rest.slice(0, next);
}

describe('index.html loading skeletons', () => {
  for (const id of SKELETON_ROOTS) {
    it(`#${id} ships a skeleton`, () => {
      const markup = slotMarkup(id);
      assert.ok(markup.includes('ds-skeleton'), `#${id} has no .ds-skeleton bar`);
      assert.ok(markup.includes('data-skel="1"'), `#${id} skeleton is not marked data-skel`);
    });
  }

  it('marks every skeleton container aria-hidden', () => {
    // A pulsing bar has no text worth announcing, and two of these boxes sit
    // inside an aria-live region (the counters in the Assets toolbars).
    const containers = INDEX.match(/data-skel="1"[^>]*>/g) || [];
    assert.ok(containers.length >= SKELETON_ROOTS.length);
    for (const c of containers) {
      assert.ok(c.includes('aria-hidden="true"'), `skeleton container is not aria-hidden: ${c}`);
    }
  });

  it('reserves whole table rows in both Modules sections', () => {
    // Both module lists are tables (js/settings-moduly.js, js/settings-moduly-katalog.js),
    // so the skeleton reserves ROWS: a row that carries fewer cells than the
    // header has columns collapses to a narrower table and the whole grid
    // shifts sideways the moment the real rows paint.
    for (const id of ['settings-moduly-installed', 'settings-moduly-catalog']) {
      const markup = slotMarkup(id);
      const columns = (markup.match(/<th[ >]/g) || []).length;
      assert.equal(columns, 6, `#${id} reserves the six columns the renderer emits`);
      assert.match(markup, /<th>Area<\/th>/);
      const rows = markup.match(/<tr class="moduly-row sett-skel"[\s\S]*?<\/tr>/g) || [];
      assert.ok(rows.length >= 3, `#${id} reserves at least three rows`);
      for (const row of rows) {
        const cells = (row.match(/<td[ >]/g) || []).length;
        assert.equal(cells, columns, 'every skeleton row fills every column');
        assert.ok(row.includes('moduly-row-icon'), 'the name cell reserves the icon tile');
      }
    }
  });

  it('reuses the real card class on the dashboard, not an approximation', () => {
    // The reserved box has to BE the finished box (180x148), which it only is
    // while it carries .placeholder-hub-card.
    const markup = slotMarkup('dashboard-cards');
    const cards = markup.match(/placeholder-hub-card placeholder-hub-card--skel/g) || [];
    assert.equal(cards.length, 3, 'the dashboard reserves three entry cards');
  });
});

describe('styles.css skeleton geometry', () => {
  it('defines a size for every skeleton class the markup uses', () => {
    const used = new Set();
    for (const m of INDEX.matchAll(/class="ds-skeleton ([^"]+)"/g)) {
      m[1].split(/\s+/).filter(Boolean).forEach(c => used.add(c));
    }
    // Only the classes this change introduced; the sett-* and obw-* families
    // are covered by their own views' tests.
    const mine = [...used].filter(c => /^(tb|dash|tc|ga|asv)-skel/.test(c));
    assert.ok(mine.length >= 15, 'expected the new skeleton classes to be in use');
    for (const cls of mine) {
      assert.ok(STYLES.includes(`.${cls} `) || STYLES.includes(`.${cls} {`),
        `styles.css has no rule for .${cls}`);
    }
  });
});

// ── Rail state before the first paint ────────────────────────────────────────

describe('rail state guard', () => {
  it('js/theme-boot.js sets data-rail from the same key the toggle writes', () => {
    assert.ok(THEME_BOOT.includes('cockpit.sidebarCollapsed'),
      'theme-boot must read the rail preference');
    assert.ok(THEME_BOOT.includes("setAttribute('data-rail'"),
      'theme-boot must stamp data-rail before any stylesheet applies');
  });

  it('defaults to collapsed, the same default _applyRailState applies', () => {
    // A wrong default here is worse than none: the rail would paint expanded
    // and snap 228px narrower on every load for everyone who never touched
    // the toggle.
    assert.match(THEME_BOOT, /let collapsed = true;/);
    assert.match(TOPBAR, /stored === null \? true : stored === '1'/);
  });

  it('_applyRailState owns the attribute too, so the three can never disagree', () => {
    assert.ok(TOPBAR.includes("setAttribute('data-rail'"),
      'the runtime toggle must keep data-rail in sync with the two classes');
  });

  it('the stylesheet keys the rail geometry off the attribute alone', () => {
    // The classes stay for the JS that queries them; if any LAYOUT rule still
    // hangs on them, the pre-paint guard cannot work.
    for (const stale of ['#sidebar.collapsed {', '#sidebar:not(.collapsed) {',
      'body.sidebar-collapsed .main {', 'body:not(.sidebar-collapsed) .main {']) {
      assert.ok(!STYLES.includes(stale), `styles.css still keys layout on: ${stale}`);
    }
    assert.ok(STYLES.includes('html[data-rail="collapsed"] #sidebar {'));
    assert.ok(STYLES.includes('html[data-rail="expanded"] #sidebar {'));
    assert.ok(STYLES.includes('html[data-rail="collapsed"] .main {'));
    assert.ok(STYLES.includes('html[data-rail="expanded"] .main {'));
  });
});

// ── Update banner reservation ────────────────────────────────────────────────

describe('update banner reservation', () => {
  it('theme-boot reserves the row from the key update-banner.js writes', () => {
    // The two halves have to name the SAME key, and nothing type-checks that.
    assert.ok(THEME_BOOT.includes("localStorage.getItem('cockpit.updateBannerSeen')"));
    assert.ok(UPDATE_BANNER.includes("const SEEN_KEY = 'cockpit.updateBannerSeen';"));
    assert.ok(THEME_BOOT.includes("setAttribute('data-update-banner', 'reserved')"));
  });

  it('the reserved state pads .main exactly as a shown banner does', () => {
    // Different numbers here and the reservation would itself be a jump.
    const rule = STYLES.slice(STYLES.indexOf('.app:has(#app-update-banner:not(.app-update-banner--hidden)) .main,'));
    assert.ok(rule.startsWith('.app:has(#app-update-banner:not(.app-update-banner--hidden)) .main,\n'
      + 'html[data-update-banner="reserved"] .main {\n  padding-top: 108px;\n}'),
      'the shown and reserved states must share one padding declaration');
  });

  it('every settled outcome releases it, failures included', () => {
    // A check that cannot answer (offline, no token) is the dangerous one: left
    // reserved it holds 40px of blank space at the top of every view all session.
    // checkOnce() now fetches both /api/app/check-update and
    // /api/modules/updates through Promise.allSettled - there is no per-request
    // early return any more, so only two paths release: the no-items branch
    // (neither source had anything worth showing) and the outer catch.
    const fn = UPDATE_BANNER.slice(UPDATE_BANNER.indexOf('async function checkOnce()'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    assert.equal((body.match(/_settleReservation\(false\)/g) || []).length, 2,
      'the no-items branch and the outer catch must each release');
    assert.equal((body.match(/_settleReservation\(true\)/g) || []).length, 1,
      'the one path that shows a banner remembers it for next load');
    assert.ok(UPDATE_BANNER.includes("removeAttribute('data-update-banner')"));
  });

  it('showBanner runs before the reservation is dropped', () => {
    // The other order leaves a frame where neither rule matches and .main
    // falls back to 68px - the jump this whole thing exists to remove.
    const at = UPDATE_BANNER.indexOf('showBanner(model);\n      _settleReservation(true);');
    assert.notEqual(at, -1, 'unhide first, release second');
  });

  it('the module-row snooze key is declared here, not read by theme-boot', () => {
    // The reservation stays keyed on the single cockpit.updateBannerSeen -
    // a second remembered key in theme-boot.js would risk disagreeing with it.
    assert.ok(UPDATE_BANNER.includes("const SNOOZE_KEY = 'cockpit.moduleUpdateSnoozed';"));
    assert.ok(!THEME_BOOT.includes('cockpit.moduleUpdateSnoozed'),
      'theme-boot.js must not read the module snooze key');
  });
});

// ── Every exit path clears or keeps the skeleton deliberately ────────────────

describe('painters clear their skeleton on every exit', () => {
  it('the Bitwarden pill: the one answer that paints nothing clears it, the rest paint', () => {
    const fn = TOPBAR.slice(TOPBAR.indexOf('export async function _renderBitwardenButton'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    // Exactly ONE final answer paints nothing now: `notInstalled`, a fact
    // about this machine (no Bitwarden CLI), so the slot stays empty and the
    // skeleton has to go with it or it pulses for the whole session.
    assert.equal((body.match(/clearSkeleton\(root\)/g) || []).length, 1,
      'only the no-CLI answer of the Bitwarden pill may paint nothing');
    assert.ok(/status\.status === 'notInstalled'/.test(body),
      'the no-CLI answer must be recognised by its own status, not by installed:false');
    // The other two - a dead endpoint and a probe that did not answer - are
    // MISSING facts, not final ones. They used to take the same silent path,
    // which is how one slow `bw status` at npm start made the pill vanish from
    // the bar with nothing to click and no poll to bring it back. They now
    // paint a neutral pill and retry.
    assert.equal((body.match(/_paintBwUnknown\(root\)/g) || []).length, 3,
      'a failed check must paint the neutral pill, never leave the slot empty');
    assert.equal((body.match(/_scheduleBwRetry\(root\)/g) || []).length, 3,
      'a failed check must schedule a retry - this slot has no poll of its own');
    assert.ok(!/if \(!res\.ok\) return;/.test(body));
    assert.ok(!/if \(!status \|\| !status\.installed\) return;/.test(body));
  });

  it('the neutral Bitwarden pill rebuilds its container, so the skeleton goes with it', () => {
    const fn = TOPBAR.slice(TOPBAR.indexOf('function _paintBwUnknown'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    // A painter that rebuilds its container drops the skeleton for free - the
    // reason this path needs no clearSkeleton call of its own.
    assert.ok(body.includes('root.replaceChildren();'),
      'the neutral pill must replace the slot content, not append to a skeleton');
    assert.ok(/aria-label/.test(body), 'an icon-and-text pill still needs its aria-label');
  });

  it('a settled Bitwarden answer drops the retry budget AND any queued timer', () => {
    const fn = TOPBAR.slice(TOPBAR.indexOf('function _bwRetrySettled'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    // Zeroing the counter alone left a timer queued behind a failure still
    // firing after the real answer had been painted - one pointless render
    // and one pointless `bw status` spawn.
    assert.ok(/clearTimeout\(_bwRetryTimer\)/.test(body), 'a settled answer must cancel the queued retry');
    assert.ok(/_bwRetries = 0/.test(body), 'and reset the budget');
    // Every settle path goes through the helper, never through a bare reset.
    const render = TOPBAR.slice(TOPBAR.indexOf('export async function _renderBitwardenButton'));
    const renderBody = render.slice(0, render.indexOf('\n}\n'));
    assert.ok(!/_bwRetries = 0/.test(renderBody),
      'the renderer must settle through _bwRetrySettled, not by zeroing the counter itself');
  });

  it('the Bitwarden retry is bounded, so a dead probe cannot spin forever', () => {
    const fn = TOPBAR.slice(TOPBAR.indexOf('function _scheduleBwRetry'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    assert.ok(/_bwRetries >= _BW_RETRY_MAX/.test(body), 'the retry must have a ceiling');
    assert.ok(/if \(_bwRetryTimer/.test(body), 'only one retry may be pending at a time');
  });

  it('the MR chips clear it on both dead-fetch answers', () => {
    const fn = TOPBAR.slice(TOPBAR.indexOf('export async function _renderMrBadges'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    assert.equal((body.match(/clearSkeleton\(root\)/g) || []).length, 2,
      'each dead-fetch return of the MR chips must clear the skeleton');
    // The no-token answer must UNPAINT, never keep a stale chip or the bars.
    assert.ok(body.includes('root.replaceChildren();'));
  });

  it('the activity chip clears it on both dead-fetch answers', () => {
    const fn = TOPBAR.slice(TOPBAR.indexOf('export async function _renderActivityBadge'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    assert.equal((body.match(/clearSkeleton\(root\)/g) || []).length, 2,
      'each dead-fetch return of the activity chip must clear the skeleton');
  });

  it('js/module-host.js drops the rail placeholders on every exit', () => {
    // Three: a non-ok manifest, a thrown fetch, and the normal path just before
    // the first real rail item is inserted (which also covers zero modules).
    assert.equal((MODULE_HOST.match(/clearRailPlaceholders\(\)/g) || []).length, 3,
      'the two failure returns plus the pre-insert clear');
    assert.ok(MODULE_HOST.includes('storeRailCount(0)'),
      'zero modules must also reset the remembered count');
  });

  it('a failed IMPORT of the loader drops them too', () => {
    // The import is an exit initModuleHost() cannot cover - a stale cached
    // bundle after a deploy, an offline tab - and the rows were already
    // painted by then, so only a finally in the caller catches this.
    const at = APP.indexOf("await import('./module-host.js')");
    assert.notEqual(at, -1);
    const after = APP.slice(at, at + 700);
    assert.ok(/\}\s*finally\s*\{[\s\S]*clearRailPlaceholders\(\);/.test(after),
      'boot() must clear the rail placeholders in a finally around the import');
  });

  it('paints them from the boot path, not from the dynamically imported loader', () => {
    // js/module-host.js is reached through a dynamic import inside boot(), so on
    // a cold load its own import is most of the wait the placeholders exist to
    // cover - painting from there reserves nothing (measured: 1.4 s).
    assert.ok(APP.includes('paintRailPlaceholders();'),
      'js/app.js must paint the rail placeholders at module-evaluation time');
    assert.ok(!MODULE_HOST.includes('paintRailPlaceholders'),
      'the loader clears the placeholders, it never paints them');
  });
});

describe('painters that would paint SHORTER leave the skeleton alone', () => {
  it('gitlab-activity keeps the skeleton instead of a one-line sentence', () => {
    assert.ok(GITLAB_ACTIVITY.includes('if (hasSkeleton(root)) return;'),
      'the no-data branch must not overwrite a taller skeleton');
  });

  it('gitlab-activity paints a real failure state so it cannot pulse forever', () => {
    assert.ok(GITLAB_ACTIVITY.includes('if (!_lastData) {'),
      'a first-load failure must put something on the page, not only a toast');
  });

  it('academy does not paint a hollow view before its data arrives', () => {
    assert.ok(ACADEMY.includes('if (_stateLoading && !_stateLoaded && hasSkeleton(root)) return;'),
      'the renderer runs before initAcademy() resolves - it must wait');
    assert.ok(ACADEMY.includes('_stateLoaded = true;'),
      'a dead endpoint must still release the skeleton');
    // Both halves matter. Without _stateLoading a renderer reached before the
    // init ever asked for the data would hold the skeleton with nothing coming;
    // without _stateLoaded a dead endpoint would hold it forever.
    assert.ok(ACADEMY.includes('_stateLoading = true;'),
      'the flag must be set when the load is entered, not when it finishes');
  });

  it('the lazy-load animation stands down where a skeleton already waits', () => {
    // .lazy-loader-host is a 200px block in normal flow, so on a view with a
    // skeleton it would add its own height and cause the jump it is meant to
    // hide. :not(.msb-skel) carves out the module sync bar's own skeleton,
    // which must not silence the loader for a whole module view - see
    // js/module-sync-bar.js.
    assert.ok(APP.includes("if (section.querySelector('.ds-skeleton:not(.msb-skel)')) return function () {};"));
  });
});
