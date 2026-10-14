// tests/test_sample_mode_helpers.mjs
// The decisions and copy behind "Try it with sample data": the wizard button,
// the top-bar badge and the leave confirm (js/sample-mode-helpers.mjs), plus
// the wiring that puts them on screen. Pure Node: no document.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SAMPLE_BADGE_LABEL, SAMPLE_LEAVE_LABEL, SAMPLE_ENTER_LABEL, SAMPLE_RESTART_LABEL,
  normalizeSampleStatus, shouldShowSampleBadge, sampleBadgeState, sampleEnterState,
  sampleLeaveConfirm, sampleEnterSummary, sampleErrorMessage, fetchSampleModeStatus,
} from '../js/sample-mode-helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('the strings a person reads', () => {
  it('are plain English, word for word', () => {
    assert.equal(SAMPLE_BADGE_LABEL, 'Sample data - nothing is synced');
    assert.equal(SAMPLE_LEAVE_LABEL, 'Leave sample mode');
    assert.equal(SAMPLE_ENTER_LABEL, 'Try it with sample data');
    for (const text of [SAMPLE_BADGE_LABEL, SAMPLE_LEAVE_LABEL, SAMPLE_ENTER_LABEL, JSON.stringify(sampleLeaveConfirm())]) {
      assert.doesNotMatch(text, /[^\x20-\x7E]/);
    }
  });
});

describe('normalizeSampleStatus', () => {
  it('reads anything that is not a clear "on" as off', () => {
    for (const bad of [null, undefined, 'x', 7, [], {}, { active: 'true' }, { active: 1 }]) {
      assert.deepEqual(normalizeSampleStatus(bad), {
        active: false, since: null, available: false, restartRequired: false, blockedByEnv: false,
      });
    }
  });

  it('keeps the fields of a real answer', () => {
    const s = normalizeSampleStatus({ active: true, since: '2026-09-30T10:00:00.000Z', available: true, restartRequired: true, blockedByEnv: false });
    assert.deepEqual(s, { active: true, since: '2026-09-30T10:00:00.000Z', available: true, restartRequired: true, blockedByEnv: false });
  });
});

describe('the top-bar badge', () => {
  it('shows only while the mode is active', () => {
    assert.equal(shouldShowSampleBadge({ active: true }), true);
    assert.equal(shouldShowSampleBadge({ active: false, restartRequired: true }), false);
    assert.equal(shouldShowSampleBadge(null), false);
  });

  it('carries the label, the leave action and a restart note when one is pending', () => {
    const calm = sampleBadgeState({ active: true });
    assert.equal(calm.label, SAMPLE_BADGE_LABEL);
    assert.equal(calm.actionLabel, SAMPLE_LEAVE_LABEL);
    assert.equal(calm.restartPending, false);
    assert.match(calm.title, /fictional team/);
    const pending = sampleBadgeState({ active: true, restartRequired: true });
    assert.equal(pending.restartPending, true);
    assert.match(pending.title, /restart/i);
  });
});

describe('the wizard block', () => {
  it('offers the button only when sample data exists and nothing blocks it', () => {
    const s = sampleEnterState({ available: true });
    assert.equal(s.mode, 'enter');
    assert.equal(s.canEnter, true);
    assert.match(s.hint, /24 people/);
    assert.match(s.hint, /nothing is synced/);
  });

  it('turns into the leave button while the mode is on', () => {
    const s = sampleEnterState({ active: true, available: true });
    assert.equal(s.mode, 'active');
    assert.equal(s.canEnter, false);
    assert.match(s.hint, /Northwind Product/);
  });

  it('says a restart is pending instead of offering the button again', () => {
    const entering = sampleEnterState({ available: true, restartRequired: true });
    assert.equal(entering.mode, 'restart');
    assert.equal(entering.canEnter, false);
    assert.match(entering.hint, /restart Mission Deck to finish/);
    const leaving = sampleEnterState({ active: true, available: true, restartRequired: true });
    assert.equal(leaving.mode, 'restart');
    assert.match(leaving.hint, /Leaving sample mode/);
    assert.equal(SAMPLE_RESTART_LABEL, 'Restart to finish');
  });

  it('explains a fixed data folder and a missing sample', () => {
    const blocked = sampleEnterState({ available: true, blockedByEnv: true });
    assert.equal(blocked.mode, 'blocked');
    assert.equal(blocked.canEnter, false);
    assert.match(blocked.hint, /DATA_TIER_0_DIR/);
    const gone = sampleEnterState({ available: false });
    assert.equal(gone.mode, 'unavailable');
    assert.equal(gone.canEnter, false);
  });
});

describe('the confirm and the messages', () => {
  it('the leave confirm says what is removed and what stays', () => {
    const q = sampleLeaveConfirm();
    assert.equal(q.okLabel, 'Leave sample mode');
    assert.match(q.body, /removed/);
    assert.match(q.body, /Modules stay installed/);
  });

  it('summarises the enter answer in one sentence', () => {
    assert.match(sampleEnterSummary({ installed: new Array(23).fill('x'), failed: [] }), /23 modules were installed/);
    assert.match(sampleEnterSummary({ installed: ['a'], failed: [] }), /1 module was installed/);
    assert.match(sampleEnterSummary({ installed: [], failed: [{ id: 'a' }] }), /1 module could not be installed/);
    assert.match(sampleEnterSummary(null), /Restarting/);
  });

  it('uses the server message when there is one', () => {
    assert.equal(sampleErrorMessage({ message: 'Nope.' }), 'Nope.');
    assert.equal(sampleErrorMessage(null), 'Something went wrong. Try again.');
  });
});

describe('fetchSampleModeStatus', () => {
  it('never throws: a failed request reads as "not in sample mode"', async () => {
    const real = globalThis.fetch;
    try {
      globalThis.fetch = async () => { throw new Error('offline'); };
      assert.equal((await fetchSampleModeStatus()).active, false);
      globalThis.fetch = async () => ({ ok: false });
      assert.equal((await fetchSampleModeStatus()).active, false);
      globalThis.fetch = async () => ({ ok: true, json: async () => ({ active: true, available: true }) });
      assert.equal((await fetchSampleModeStatus()).active, true);
    } finally { globalThis.fetch = real; }
  });
});

describe('the wiring', () => {
  it('the top bar has the slot, paints it at boot and styles it like the stash slot', () => {
    assert.match(read('index.html'), /id="topbar-sample-root" class="app-top-bar__sample"/);
    const topbar = read('js/topbar.js');
    assert.match(topbar, /import \{ refreshSampleBadge \} from '\.\/sample-mode\.js'/);
    assert.match(topbar, /refreshSampleBadge\(\)\.catch\(/);
    // the morning auto-open waits for the badge and stays out in sample mode,
    // whose rows never carry wrappedUpAt
    assert.match(topbar, /await sampleBadgeReady;\s*\n\s*if \(document\.documentElement\.hasAttribute\('data-sample-mode'\)\) return;\s*\n\s*_autoOpenMorningIfDue\(rows\);/);
    const css = read('styles.css');
    assert.match(css, /\.app-top-bar__sample,/);
    assert.match(css, /\.app-top-bar__sample:empty \{ display: none; \}/);
  });

  it('the wizard puts the button in its first card and wires enter / leave', () => {
    const wiz = read('js/onboarding-wizard.js');
    const step1 = wiz.slice(wiz.indexOf("_card('step1'"), wiz.indexOf("_card('step2'"));
    assert.match(step1, /id="obw-sample-btn"/);
    assert.match(wiz, /enterSampleMode\(btn\)/);
    assert.match(wiz, /leaveSampleMode\(btn\)/);
  });

  it('the client module restarts through the settings route and confirms before leaving', () => {
    const src = read('js/sample-mode.js');
    assert.match(src, /\/api\/sample-mode\/enter/);
    assert.match(src, /\/api\/sample-mode\/leave/);
    assert.match(src, /\/api\/settings\/restart/);
    assert.match(src, /confirmDsModal/);
  });
});
