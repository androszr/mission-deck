// Unit tests for js/data-events.js - the one-event bus that tells the view on
// screen to re-read the team data after a sync rewrote it on this disk - plus
// the two static contracts that make the bus reach anything: the emitters at
// every finish path of a sync, and the router's `refresh` hook.
// Run: node --test tests/test_data_events.mjs
//
// The module reads `globalThis.document` at CALL time, never at import time,
// which is what lets a plain Node process stand in an EventTarget for it.

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DATA_CHANGED_EVENT,
  emitDataChanged,
  onDataChanged,
} from '../js/data-events.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

afterEach(() => { delete globalThis.document; });

describe('data-events', () => {
  it('names the event with an ASCII id', () => {
    assert.equal(DATA_CHANGED_EVENT, 'cockpit:data-changed');
    assert.match(DATA_CHANGED_EVENT, /^[\x20-\x7e]+$/);
  });

  it('delivers the event to every subscriber, with its detail', () => {
    globalThis.document = new EventTarget();
    const seen = [];
    onDataChanged(ev => seen.push('a:' + ev.detail.op));
    onDataChanged(ev => seen.push('b:' + ev.detail.op));

    emitDataChanged({ repo: 'data-tier-0', op: 'pull' });

    assert.deepEqual(seen, ['a:pull', 'b:pull']);
  });

  it('defaults the detail to an empty object rather than undefined', () => {
    globalThis.document = new EventTarget();
    let detail = 'not-called';
    onDataChanged(ev => { detail = ev.detail; });
    emitDataChanged();
    assert.deepEqual(detail, {});
  });

  it('stops delivering once the returned unsubscribe runs', () => {
    globalThis.document = new EventTarget();
    let calls = 0;
    const off = onDataChanged(() => { calls += 1; });
    emitDataChanged({ op: 'pull' });
    off();
    emitDataChanged({ op: 'decrypt' });
    assert.equal(calls, 1);
  });

  it('is a no-op without a browser document instead of throwing', () => {
    assert.doesNotThrow(() => emitDataChanged({ op: 'pull' }));
    const off = onDataChanged(() => { throw new Error('never called'); });
    assert.equal(typeof off, 'function');
    assert.doesNotThrow(() => off());
  });
});

describe('data-events emitters', () => {
  it('the streamed sync announces a change only on success', () => {
    const src = read('js/sub-repo-sync-stream.js');
    assert.match(src, /import \{ emitDataChanged \} from '\.\/data-events\.js';/);
    // Guarded by data.ok: a failed pull rewrote nothing and a repaint would
    // only cost a round of fetches.
    assert.match(src, /if \(data\.ok\) emitDataChanged\(/);
  });

  it('every op that rewrites the plaintext tree announces it', () => {
    const src = read('js/data-tier-0-sync.js');
    assert.match(src, /import \{ emitDataChanged \} from '\.\/data-events\.js';/);
    // The three mirror->plaintext ops go through the one _mutating wrapper.
    for (const op of ['/discard-local-changes', '/clear-dir', '/decrypt']) {
      assert.match(src, new RegExp(`_mutating\\('${op}'`), op + ' must emit');
    }
    assert.match(src, /_mutating\(path, repoId, op\)[\s\S]{0,200}if \(data\.ok\) emitDataChanged/);
    // write-resolved and the two data-tier-0-only entry points emit inline.
    assert.match(src, /op: 'write-resolved'/);
    assert.match(src, /op: 'push'/);
  });

  it('pushDataTier announces only from inside its success branch', () => {
    const src = read('js/data-tier-0-sync.js');
    const body = src.slice(src.indexOf('export async function pushDataTier'));
    const fn = body.slice(0, body.indexOf('\n}\n'));
    // No `if (data.ok)` of its own, so the guard IS the branch it sits in - a
    // failed push must not cost a module view a reload of a tree that did not
    // move. Pinned structurally: the emit is between the success test and its
    // return, and both error exits come after it.
    const guard = fn.indexOf('if (res.ok && data.ok !== false)');
    const emit = fn.indexOf('emitDataChanged(');
    const okReturn = fn.indexOf('return { ok: true');
    const errToast = fn.indexOf("showToast('error'");
    assert.ok(guard >= 0 && emit > guard, 'emit must sit inside the success branch');
    assert.ok(emit < okReturn, 'emit must precede the success return');
    assert.ok(okReturn < errToast, 'the failure path must come after the success return');
    assert.equal(fn.split('emitDataChanged(').length - 1, 1, 'exactly one emit');
  });

  it('the read-only conflict-diff probe does NOT announce a change', () => {
    const src = read('js/data-tier-0-sync.js');
    assert.match(src, /_postJson\('\/conflict-diff'/);
    assert.doesNotMatch(src, /_mutating\('\/conflict-diff'/);
  });
});

describe('data-events consumers', () => {
  it('the router refreshes the active view and nothing else', () => {
    const src = read('js/app.js');
    assert.match(src, /import \{ onDataChanged \} from '\.\/data-events\.js';/);
    assert.match(src, /onDataChanged\(\(\) => \{ refreshActiveView\(\); \}\);/);
    const body = src.slice(src.indexOf('async function refreshActiveView'), src.indexOf('onDataChanged(('));
    // The shared roster is re-read before anything repaints, not after.
    assert.ok(body.indexOf('loadTeamDirectory(true)') < body.indexOf('entry.refresh'));
    // A view nobody has opened yet has nothing painted from the old data.
    assert.match(body, /_initedViews\.has\(baseViewId\)/);
  });

  it('a module view is RE-ENTERED: cleanup, document, fresh import, init, render', () => {
    const src = read('js/app.js');
    const body = src.slice(src.indexOf('async function refreshActiveView'), src.indexOf('onDataChanged(('));
    const order = ['runActiveViewCleanup(baseViewId)', '_resetViewDom(baseViewId)',
      '_initedViews.delete(baseViewId)', 'reloadViewModule(baseViewId', '_initedViews.add(baseViewId)',
      'entry.runInit(mod, _viewDeps)', 'mod[entry.render](subPath'];
    let at = -1;
    for (const step of order) {
      const next = body.indexOf(step);
      assert.ok(next > at, step + ' is out of order in refreshActiveView');
      at = next;
    }
    // Cleanup must still see the document the outgoing instance built.
    assert.ok(body.indexOf('runActiveViewCleanup') < body.indexOf('_resetViewDom'));
    // The document reset restores the markup the shell shipped - never a clone of
    // what is on screen. A clone would carry a container's "already wired"
    // marker attribute across without its listener, and the incoming instance
    // would then bind nothing: the view repaints and answers no clicks.
    const reset = src.slice(src.indexOf('function _resetViewDom'), src.indexOf('async function refreshActiveView'));
    assert.match(reset, /_pristineSections\.get\(baseViewId\)/);
    assert.match(reset, /section\.replaceWith\(pristine \? pristine\.cloneNode\(true\) : /);
    assert.doesNotMatch(reset, /innerHTML/);
  });

  it('the pristine section is snapshotted before the view has ever painted', () => {
    const src = read('js/app.js');
    const nav = src.slice(src.indexOf('async function navigate('));
    const snap = nav.indexOf('_pristineSections.set(baseViewId, section.cloneNode(true))');
    assert.ok(snap > 0, 'navigate() must take the snapshot');
    // Before the lazy loader, before runInit and before render - all three
    // write into the section.
    for (const later of ['_showLazyLoader(section)', 'entry.runInit(mod, _viewDeps)', 'mod[entry.render](subPath, opts)']) {
      assert.ok(snap < nav.indexOf(later), 'snapshot must precede ' + later);
    }
    assert.match(nav, /if \(!_pristineSections\.has\(baseViewId\)\)/);
    // Declared ABOVE navigate(): a module-scope const is in the temporal dead
    // zone until evaluation reaches it, so the declaration order is the only
    // thing standing between this and a ReferenceError if navigate() is ever
    // reached earlier.
    assert.ok(src.indexOf('const _pristineSections') < src.indexOf('async function navigate('));
  });

  it('a core view is repainted, never re-imported', () => {
    const src = read('js/app.js');
    const body = src.slice(src.indexOf('async function refreshActiveView'), src.indexOf('onDataChanged(('));
    assert.match(body, /if \(!entry\.moduleId\) \{/);
    // The core branch returns before ever reaching the reload.
    assert.ok(body.indexOf('if (!entry.moduleId)') < body.indexOf('reloadViewModule'));
    assert.ok(body.indexOf('if (!entry.moduleId)') < body.indexOf('runActiveViewCleanup'));
  });

  it('a fresh instance comes from a busted specifier, and siblings come with it', () => {
    const src = read('js/view-registry.js');
    // Only a module-backed entry is reloadable; a core view keeps its instance.
    assert.match(src, /if \(!entry \|\| !entry\.moduleId \|\| _reloadGeneration === 0\) return '';/);
    assert.match(src, /return '\?r=' \+ _reloadGeneration;/);
    assert.match(src, /if \(!entry\.moduleId\) return loadViewModule\(viewId, source\);/);
    // Every view of the same module is dropped together, so a hub module never
    // runs two live instances against one document.
    assert.match(src, /if \(id === viewId \|\| e\.moduleId === entry\.moduleId\) _moduleCache\.delete\(id\);/);
    // The generation is bumped once per reload and shared, so the siblings
    // re-import at the same URL and therefore to the same instance.
    assert.match(src, /_reloadGeneration \+= 1;/);
    for (const m of src.matchAll(/importFn: \(bust\) => import\('([^']+)' \+ bust\)/g)) {
      assert.ok(m[1].startsWith('./'), m[1]);
    }
  });

  it('a module needs no code of its own to be reloaded', () => {
    const src = read('js/module-host.js');
    // The marker the router keys on, and the busted specifier behind it.
    assert.match(src, /^\s*moduleId,$/m);
    assert.match(src, /import\('\/modules\/' \+ moduleId \+ '\/client\/index\.js' \+ bust\)/);
    // The hook is an OPT-OUT, not a prerequisite: a module that exports
    // nothing extra must still be refreshed, by the reload above.
    assert.match(src, /OPT-OUT hook/);
  });

  it('a burst of events costs one extra pass, never one pass each', () => {
    const src = read('js/app.js');
    const body = src.slice(src.indexOf('async function refreshActiveView'), src.indexOf('onDataChanged(('));
    // Re-entry while a refresh runs sets a flag and returns; the loop then runs
    // ONE more pass however many events arrived. Three events during one
    // in-flight refresh must not queue three passes.
    assert.match(body, /if \(_dataRefreshRunning\) \{ _dataRefreshQueued = true; return; \}/);
    assert.match(body, /_dataRefreshRunning = true;/);
    // Cleared at the TOP of each pass, so `continue` exits unless an event
    // genuinely arrived during the awaits - not a busy-spin.
    const loopStart = body.indexOf('do {');
    assert.ok(loopStart > 0);
    assert.ok(body.indexOf('_dataRefreshQueued = false;', loopStart) < body.indexOf('const baseViewId'));
    assert.match(body, /\} while \(_dataRefreshQueued\);/);
    // Released in a finally, so a throw anywhere inside cannot wedge the flag
    // on and kill every later refresh in the session.
    assert.match(body, /\} finally \{\s*_dataRefreshRunning = false;/);
  });

  it('the core-view branch prefers refresh and falls back to render', () => {
    const src = read('js/app.js');
    const body = src.slice(src.indexOf('async function refreshActiveView'), src.indexOf('onDataChanged(('));
    const core = body.slice(body.indexOf('if (!entry.moduleId)'), body.indexOf('const loaded ='));
    // A declared hook wins, but only if the module really exports it - a
    // renamed function must degrade to a repaint, never to a TypeError.
    assert.match(core, /entry\.refresh && typeof mod\[entry\.refresh\] === 'function'\s*\?\s*entry\.refresh : entry\.render/);
    assert.match(core, /if \(!mod \|\| typeof mod\[hook\] !== 'function'\) continue;/);
  });

  it('a module may opt OUT of the reload, and anything else falls through', () => {
    const app = read('js/app.js');
    const body = app.slice(app.indexOf('async function refreshActiveView'), app.indexOf('onDataChanged(('));
    // The hook decides; only a truthy answer skips the reload.
    assert.match(body, /handled = await loaded\[entry\.dataHook\]\(\)/);
    assert.match(body, /if \(handled\) continue;/);
    // A throwing hook must not leave the view stale - it is logged and the
    // reload runs anyway.
    assert.ok(body.indexOf('onDataChanged error, reloading instead') < body.indexOf('runActiveViewCleanup(baseViewId)'));

    const host = read('js/module-host.js');
    assert.match(host, /dataHook: MODULE_DATA_HOOK_KEY/);
    // No hook -> false -> the core reloads. Never a silent no-op.
    assert.match(host, /if \(!view \|\| typeof view\.onDataChanged !== 'function'\) return false;/);
    // A handled call paints the module sync bar (fire-and-forget, see
    // js/module-sync-bar.js) before answering true - the gap between the two
    // pinned calls is deliberate, not a broken adjacency.
    assert.match(host, /await view\.onDataChanged\(\);\s*if \(hasDataRepos\) paintModuleSyncBar\(viewId, moduleId\);\s*return true;/);
  });

  it('a core view that paints from a cache declares a refresh hook', () => {
    assert.match(read('js/view-registry.js'), /refresh: 'refreshAcademyData'/);
    assert.match(read('js/academy.js'), /export async function refreshAcademyData\(\)/);
  });
});
