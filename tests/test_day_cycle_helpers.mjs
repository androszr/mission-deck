// Unit tests for js/day-cycle-helpers.mjs - the DOM-free presentation logic
// behind the "Koniec dnia" / "Dzien dobry" flow (js/day-cycle-modal.js).
// Run: node --test tests/test_day_cycle_helpers.mjs
//
// The module is pure and ASCII-only on purpose (see its file header): every
// function here returns an ASCII state/reason code, never the Polish
// sentence a person reads. These tests assert the codes, not copy.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  wrapUpPlanForRow,
  pushOutcomeAllowsClear,
  morningRowsToDecrypt,
  summarizeWrapUp,
  shouldAutoOpenMorning,
  dayCycleRowBadge,
  dayCycleMode,
} from '../js/day-cycle-helpers.mjs';

describe('wrapUpPlanForRow - evening plan per sync-overview row', () => {
  it('skips a row that is not cloned before checking anything else', () => {
    assert.deepEqual(
      wrapUpPlanForRow({ status: 'not-cloned', canPush: true, hasToken: false }),
      { action: 'skip', reason: 'not-ready' },
    );
  });

  it('skips a pushable row with no write token', () => {
    assert.deepEqual(
      wrapUpPlanForRow({ status: 'ready', canPush: true, hasToken: false }),
      { action: 'skip', reason: 'no-token' },
    );
  });

  it('skips a row with no usable encryption key', () => {
    assert.deepEqual(
      wrapUpPlanForRow({ status: 'ready', canPush: false, encryptionReady: false }),
      { action: 'skip', reason: 'no-key' },
    );
  });

  it('skips a row behind a locked Bitwarden vault, even with a token and a key', () => {
    assert.deepEqual(
      wrapUpPlanForRow({
        status: 'ready', canPush: true, hasToken: true, encryptionReady: true, bitwardenLocked: true,
      }),
      { action: 'skip', reason: 'locked' },
    );
  });

  it('push-and-clear when the row can push and has unsent files', () => {
    assert.deepEqual(
      wrapUpPlanForRow({
        status: 'ready', canPush: true, hasToken: true, encryptionReady: true, filesToSend: 3,
      }),
      { action: 'push-and-clear' },
    );
  });

  // The whole point of returning a code rather than a sentence: both helpers
  // must speak ONE vocabulary, so js/day-cycle-modal.js can resolve either
  // through the single `_BADGE_LABEL` table. That table cannot be imported
  // here (it lives next to the document), so this pins the property that makes it
  // safe - every reason wrapUpPlanForRow can emit is also a state
  // dayCycleRowBadge can emit, and is therefore a key that table already has.
  it('emits only reason codes that dayCycleRowBadge also emits as states', () => {
    const rows = [
      { status: 'not-cloned', canPush: true, hasToken: false },
      { status: 'ready', canPush: true, hasToken: false },
      { status: 'ready', canPush: false, encryptionReady: false },
      { status: 'ready', canPush: true, hasToken: true, encryptionReady: true, bitwardenLocked: true },
    ];
    for (const row of rows) {
      const { reason } = wrapUpPlanForRow(row);
      assert.equal(typeof reason, 'string');
      assert.equal(
        reason, dayCycleRowBadge(row).state,
        `reason ${reason} must match the badge state for the same row`,
      );
      assert.match(reason, /^[a-z-]+$/, `reason ${reason} must be an ASCII code, never copy`);
    }
  });

  it('bare clear when every gate passes but there is nothing to send (or the source cannot push at all)', () => {
    assert.deepEqual(
      wrapUpPlanForRow({
        status: 'ready', canPush: true, hasToken: true, encryptionReady: true, filesToSend: 0,
      }),
      { action: 'clear' },
    );
    assert.deepEqual(
      wrapUpPlanForRow({ status: 'ready', canPush: false, encryptionReady: true }),
      { action: 'clear' },
    );
  });
});

describe('pushOutcomeAllowsClear - which push failures still allow the plaintext clear', () => {
  it('blocks the clear for every error that means the work is not safely encrypted anywhere', () => {
    for (const err of ['key-missing', 'key-invalid', 'encrypt-failed', 'encrypt-destructive', 'conflict-markers', 'locked']) {
      assert.equal(pushOutcomeAllowsClear(err), false, err);
    }
  });

  it('allows the clear for a successful push, no push attempted, and every network/auth/rejection failure', () => {
    for (const err of [undefined, null, 'network', 'timeout', 'auth-expired', 'no-access', 'rejected', 'no-write-token']) {
      assert.equal(pushOutcomeAllowsClear(err), true, String(err));
    }
  });
});

describe('morningRowsToDecrypt - which rows the morning modal offers to decrypt', () => {
  it('includes never-decrypted rows and, crucially, a wrapped-up row that still reads decrypted:true', () => {
    const rows = [
      { status: 'ready', encryptionReady: true, decrypted: false, wrappedUpAt: null },
      // The stale-true bug this list exists to cover (see CLAUDE.md /
      // day-cycle-helpers.mjs header): one write after a wrap-up makes
      // _repoDecryptedState report decrypted:true on a tree still 99% empty.
      { status: 'ready', encryptionReady: true, decrypted: true, wrappedUpAt: '2026-09-08T20:00:00.000Z' },
      { status: 'ready', encryptionReady: true, decrypted: true, wrappedUpAt: null },
      { status: 'not-cloned', encryptionReady: true, decrypted: false, wrappedUpAt: null },
      { status: 'ready', encryptionReady: false, decrypted: false, wrappedUpAt: null },
    ];
    const result = morningRowsToDecrypt(rows);
    assert.equal(result.length, 2);
    assert.equal(result[0].decrypted, false);
    assert.equal(result[1].wrappedUpAt, '2026-09-08T20:00:00.000Z');
  });
});

describe('summarizeWrapUp - closing-screen tally', () => {
  it('tallies cleared/skipped/pushed and carries the skip reason only on skipped lines', () => {
    const summary = summarizeWrapUp([
      { repoId: 'data-tier-0', label: 'Team data', outcome: 'pushed-and-cleared' },
      { repoId: 'data-leads', label: 'PO', outcome: 'cleared' },
      // Display text, not a code: the modal resolves wrapUpPlanForRow's code
      // through _BADGE_LABEL before it pushes a line here, so everything this
      // function tallies is already the sentence a person reads.
      { repoId: 'data-mobile', label: 'Mini', outcome: 'skipped', reason: 'no token' },
    ]);
    assert.equal(summary.cleared, 2);
    assert.equal(summary.pushed, 1);
    assert.equal(summary.skipped, 1);
    assert.equal(summary.lines[0].reason, null);
    assert.equal(summary.lines[2].reason, 'no token');
  });
});

describe('shouldAutoOpenMorning - self-opening morning modal, at most once a day', () => {
  it('opens when a wrap-up cleared something and this day has not been greeted yet', () => {
    assert.equal(
      shouldAutoOpenMorning({ lastCleared: '2026-09-08T20:00:00.000Z', greetedOn: null, today: '2026-09-09' }),
      true,
    );
  });

  it('stays closed on a fresh install with no wrap-up marker at all', () => {
    assert.equal(
      shouldAutoOpenMorning({ lastCleared: null, greetedOn: null, today: '2026-09-09' }),
      false,
    );
  });

  it('stays closed once this same local day was already greeted', () => {
    assert.equal(
      shouldAutoOpenMorning({ lastCleared: '2026-09-08T20:00:00.000Z', greetedOn: '2026-09-09', today: '2026-09-09' }),
      false,
    );
  });
});

describe('dayCycleRowBadge - shared row badge, evening and morning lists', () => {
  it('reads wrapped-up rather than not-decrypted for a marked row (different sentence, same underlying state)', () => {
    assert.deepEqual(
      dayCycleRowBadge({ status: 'ready', decrypted: false, wrappedUpAt: '2026-09-08T20:00:00.000Z' }),
      { cls: 'ds-badge--yellow', state: 'wrapped-up' },
    );
    // Same row with the marker gone (a real decrypt clears it): the plain
    // not-decrypted branch takes over instead.
    assert.deepEqual(
      dayCycleRowBadge({ status: 'ready', decrypted: false, wrappedUpAt: null }),
      { cls: 'ds-badge--yellow', state: 'not-decrypted' },
    );
  });

  it('keeps wrapped-up when a stray write flips decrypted back to true - the case the marker exists for', () => {
    // After a wrap-up, one write into the emptied plaintext tree (an Academy
    // Cockpit progress file) gives _repoDecryptedState a non-empty mirror
    // overlap, so it reports decrypted:true on a tree still ~99% empty. A
    // badge that read `decrypted` here would paint the row green and the
    // person would work all day against nothing. The marker alone decides;
    // a successful decrypt is what clears it server-side.
    assert.deepEqual(
      dayCycleRowBadge({
        status: 'ready', hasToken: true, canPush: true, decrypted: true,
        wrappedUpAt: '2026-09-08T20:00:00.000Z', filesToSend: 0,
      }),
      { cls: 'ds-badge--yellow', state: 'wrapped-up' },
    );
  });

  it('falls through to ready when every gate is clear and nothing is pending', () => {
    assert.deepEqual(
      dayCycleRowBadge({
        status: 'ready', hasToken: true, decrypted: true, wrappedUpAt: null, canPush: true, filesToSend: 0,
      }),
      { cls: 'ds-badge--green', state: 'ready' },
    );
  });
});

describe('dayCycleMode - which single top-bar pill shows', () => {
  it('answers morning when any row still carries a wrappedUpAt marker, even in a mixed registry', () => {
    assert.equal(
      dayCycleMode([
        { wrappedUpAt: null },
        { wrappedUpAt: '2026-09-08T20:00:00.000Z' },
        { wrappedUpAt: null },
      ]),
      'morning',
    );
  });

  it('answers wrapup on a fresh install (empty rows) and when nothing is marked', () => {
    assert.equal(dayCycleMode([]), 'wrapup');
    assert.equal(dayCycleMode([{ wrappedUpAt: null }, { wrappedUpAt: null }]), 'wrapup');
  });
});
