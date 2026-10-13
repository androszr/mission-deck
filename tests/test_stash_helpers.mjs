// tests/test_stash_helpers.mjs
// Pure decisions and Polish copy behind the top-bar "Stash" pill and its modal
// (js/stash-helpers.mjs). Real ESM import, no server, no document access - the builders
// return HTML strings. The wiring in js/stash-modal.js and js/topbar.js is
// deliberately untested, like the rest of those files.

import { test } from 'node:test';
import assert from 'node:assert';

import {
  STASH_FILE_LIST_LIMIT,
  STASH_APPLY_BTN_SELECTOR,
  STASH_DROP_BTN_SELECTOR,
  STASH_FILES_BTN_SELECTOR,
  STASH_COPY_BTN_SELECTOR,
  pluralStashes,
  pluralFiles,
  stashEntries,
  shouldShowStashPill,
  stashPillState,
  formatStashDate,
  stashEntryTitle,
  claudePromptForStash,
  stashApplyOutcome,
  stashEntryCardHtml,
  stashFilesHtml,
  stashOutcomeHtml,
  stashIntroLines,
} from '../js/stash-helpers.mjs';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

const entry = (over) => ({
  sha: SHA_A,
  ref: 'stash@{0}',
  at: '2026-09-12T08:30:00.000Z',
  message: 'cockpit-update 2026-09-12T08:30:00.000Z v1.2.3',
  cockpit: true,
  ...over,
});

// ── constants ────────────────────────────────────────────────────────────────

test('the four button selectors are data attributes, so one delegated listener serves every card', () => {
  assert.strictEqual(STASH_APPLY_BTN_SELECTOR, '[data-stash-apply]');
  assert.strictEqual(STASH_DROP_BTN_SELECTOR, '[data-stash-drop]');
  assert.strictEqual(STASH_FILES_BTN_SELECTOR, '[data-stash-files]');
  assert.strictEqual(STASH_COPY_BTN_SELECTOR, '[data-stash-copy]');
  assert.strictEqual(STASH_FILE_LIST_LIMIT, 20);
});

// ── plurals ──────────────────────────────────────────────────────────────────

test('pluralStashes: English plural forms', () => {
  assert.strictEqual(pluralStashes(0), '0 stashes');
  assert.strictEqual(pluralStashes(1), '1 stash');
  assert.strictEqual(pluralStashes(2), '2 stashes');
  assert.strictEqual(pluralStashes(4), '4 stashes');
  assert.strictEqual(pluralStashes(5), '5 stashes');
  assert.strictEqual(pluralStashes(12), '12 stashes');
  assert.strictEqual(pluralStashes(22), '22 stashes');
  assert.strictEqual(pluralStashes(undefined), '0 stashes');
});

test('pluralFiles matches the form js/app-update-stash.mjs uses for the same counts', () => {
  assert.strictEqual(pluralFiles(1), '1 file');
  assert.strictEqual(pluralFiles(3), '3 files');
  assert.strictEqual(pluralFiles(13), '13 files');
});

// ── stashEntries ─────────────────────────────────────────────────────────────

test('stashEntries keeps only rows carrying a real sha and a ref', () => {
  const out = stashEntries({
    entries: [
      entry(),
      entry({ sha: 'not-a-sha' }),
      entry({ sha: SHA_B, ref: '' }),
      null,
      { sha: SHA_B, ref: 'stash@{1}' },
    ],
  });
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[0].sha, SHA_A);
  assert.strictEqual(out[1].sha, SHA_B);
  // Missing fields normalise rather than reaching the page as undefined.
  assert.strictEqual(out[1].message, '');
  assert.strictEqual(out[1].at, '');
  assert.strictEqual(out[1].cockpit, false);
});

test('stashEntries on a malformed or failed payload is an empty list, never a throw', () => {
  assert.deepStrictEqual(stashEntries(null), []);
  assert.deepStrictEqual(stashEntries({}), []);
  assert.deepStrictEqual(stashEntries({ entries: 'nope' }), []);
  assert.deepStrictEqual(stashEntries({ ok: false, error: 'git-failed', entries: [] }), []);
});

test('cockpit is only the literal true - an entry the server did not mark reads as hand-made', () => {
  assert.strictEqual(stashEntries({ entries: [entry({ cockpit: 'true' })] })[0].cockpit, false);
});

// ── pill ─────────────────────────────────────────────────────────────────────

test('shouldShowStashPill: no entries means no slot at all', () => {
  assert.strictEqual(shouldShowStashPill([]), false);
  assert.strictEqual(shouldShowStashPill(null), false);
  assert.strictEqual(shouldShowStashPill(undefined), false);
  assert.strictEqual(shouldShowStashPill([entry()]), true);
});

test('stashPillState: the count is on the label only when there is more than one', () => {
  const one = stashPillState([entry()]);
  assert.strictEqual(one.label, 'Stash');
  assert.strictEqual(one.count, 1);
  assert.match(one.title, /1 stash/);

  const three = stashPillState([entry(), entry(), entry()]);
  assert.strictEqual(three.label, 'Stash (3)');
  assert.match(three.title, /3 stashes/);

  const none = stashPillState([]);
  assert.strictEqual(none.count, 0);
  assert.strictEqual(none.title, 'No stashed changes');
});

// ── formatStashDate ──────────────────────────────────────────────────────────

test('formatStashDate: local DD.MM.YYYY, HH:MM - never a UTC slice', () => {
  const d = new Date(2026, 8, 12, 8, 5); // 12.09.2026 08:05 local
  assert.strictEqual(formatStashDate(d.toISOString()), '12.09.2026, 08:05');
});

test('formatStashDate: anything unparseable renders nothing rather than "Invalid Date"', () => {
  assert.strictEqual(formatStashDate(''), '');
  assert.strictEqual(formatStashDate(null), '');
  assert.strictEqual(formatStashDate('kiedys'), '');
});

// ── stashEntryTitle ──────────────────────────────────────────────────────────

test('stashEntryTitle: a cockpit entry gets a sentence, a hand-made one keeps its own message', () => {
  assert.strictEqual(stashEntryTitle(entry()), 'Changes stashed before a Mission Deck update');
  assert.strictEqual(
    stashEntryTitle(entry({ message: 'detached-head-repair', cockpit: true })),
    'Changes stashed while repairing the branch',
  );
  assert.strictEqual(stashEntryTitle(entry({ message: 'my work', cockpit: false })), 'my work');
  assert.strictEqual(stashEntryTitle(entry({ message: '', cockpit: false })), 'Changes stashed by hand');
});

// ── claudePromptForStash ─────────────────────────────────────────────────────

test('claudePromptForStash names the SHA, says apply-not-pop and warns about conflicts', () => {
  const p = claudePromptForStash(entry());
  assert.ok(p.includes(SHA_A), 'the sha is what survives a drop, so the prompt carries it');
  assert.ok(!p.includes('stash@{0}'), 'never the ref - it shifts under every drop');
  assert.match(p, /git stash apply/);
  assert.match(p, /never pop/);
  assert.match(p, /conflict/i);
  assert.match(p, /cockpit-update 2026-09-12T08:30:00\.000Z v1\.2\.3/);
});

test('claudePromptForStash: an entry with no message drops that sentence instead of quoting nothing', () => {
  const p = claudePromptForStash(entry({ message: '' }));
  assert.ok(!p.includes('The entry is called'));
  assert.ok(p.includes(SHA_A));
});

// ── stashApplyOutcome ────────────────────────────────────────────────────────

test('stashApplyOutcome: success says the entry SURVIVED and points at the delete button', () => {
  const o = stashApplyOutcome({ ok: true, files: ['a.js', 'b.js'] }, 200);
  assert.strictEqual(o.kind, 'ok');
  assert.strictEqual(o.tone, 'success');
  assert.match(o.title, /2 files/);
  assert.ok(o.lines.some((l) => /never runs git stash pop/.test(l)));
  assert.ok(o.lines.some((l) => /Remove entry/.test(l)));
  assert.deepStrictEqual(o.files, ['a.js', 'b.js']);
});

test('stashApplyOutcome: a conflict is NOT a failure - the work is in the tree with markers', () => {
  const o = stashApplyOutcome({ ok: false, error: 'conflict', conflicts: ['server.js'], message: 'Git applied the changes, but 1 file has a conflict to resolve by hand.' }, 200);
  assert.strictEqual(o.kind, 'conflict');
  assert.strictEqual(o.tone, 'warning');
  assert.ok(o.lines.some((l) => l.includes('ARE in the files')), 'must not send anybody looking for changes already applied');
  assert.ok(o.lines.some((l) => /update will not run either/.test(l)));
  assert.ok(o.lines.some((l) => /nothing is lost/.test(l)));
  assert.deepStrictEqual(o.files, ['server.js']);
});

test('stashApplyOutcome: a vanished entry and a git failure read differently', () => {
  const gone = stashApplyOutcome({ ok: false, error: 'stash-gone', message: 'This entry is no longer on the stash - refresh the list.' }, 200);
  assert.strictEqual(gone.kind, 'error');
  assert.strictEqual(gone.tone, 'warning');

  const failed = stashApplyOutcome({ ok: false, error: 'apply-failed', message: 'Git did not apply the stash - the working tree is unchanged.', stderr: 'fatal: x\ny\nz\nq' }, 200);
  assert.strictEqual(failed.kind, 'error');
  assert.strictEqual(failed.tone, 'danger');
  assert.strictEqual(failed.lines.length, 1, 'at most three stderr lines, joined');
});

test('stashApplyOutcome: ok:true on a non-200 is not success', () => {
  assert.strictEqual(stashApplyOutcome({ ok: true }, 500).kind, 'error');
  assert.strictEqual(stashApplyOutcome(null, 200).kind, 'error');
});

test('stashApplyOutcome: a non-200 is never an answer, whatever error it carries', () => {
  // The server can only reach 5xx through its own catch, which sends
  // error:'internal' - but this is the pure boundary, so every branch is
  // gated on the status, not only the success one.
  for (const err of ['conflict', 'stash-gone', 'test-mode']) {
    const o = stashApplyOutcome({ ok: false, error: err, conflicts: [] }, 500);
    assert.strictEqual(o.kind, 'error', err);
    assert.strictEqual(o.tone, 'danger', err);
  }
});

test('stashApplyOutcome: the failure line never claims the tree is untouched', () => {
  // git can exit non-zero having already written something, so a blanket
  // "nothing changed" would send somebody away from a half-applied tree.
  const o = stashApplyOutcome({ ok: false, error: 'apply-failed' }, 200);
  assert.ok(!o.lines.join(' ').includes('bez zmian'));
  assert.match(o.lines.join(' '), /check the working tree/);
});
test('stashApplyOutcome: the test-mode refusal is a warning, not a red error', () => {
  const o = stashApplyOutcome({ ok: false, error: 'test-mode', message: 'Applying a stash is disabled in test mode.' }, 200);
  assert.strictEqual(o.tone, 'warning');
});

// ── markup ───────────────────────────────────────────────────────────────────

test('stashEntryCardHtml: every button carries the SHA, never the ref', () => {
  const html = stashEntryCardHtml(entry());
  assert.ok(html.includes(`data-stash-apply="${SHA_A}"`));
  assert.ok(html.includes(`data-stash-files="${SHA_A}"`));
  assert.ok(html.includes(`data-stash-drop="${SHA_A}"`));
  assert.ok(html.includes(`data-stash-slot="${SHA_A}"`));
  assert.ok(html.includes('data-stash-copy="name"'));
  assert.ok(html.includes('data-stash-copy="prompt"'));
  assert.ok(!/data-stash-(apply|drop|files)="stash@/.test(html));
});

test('stashEntryCardHtml: the badge separates a cockpit entry from a hand-made one', () => {
  assert.match(stashEntryCardHtml(entry()), /ds-badge--blue">from Mission Deck</);
  assert.match(stashEntryCardHtml(entry({ cockpit: false, message: 'moje' })), /ds-badge--gray">manual</);
});

test('stashEntryCardHtml escapes everything a stash message can carry', () => {
  const html = stashEntryCardHtml(entry({ cockpit: false, message: '<img src=x onerror=alert(1)>' }));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x'));
});

test('stashFilesHtml: empty, missing and populated are three different answers', () => {
  assert.match(stashFilesHtml(null), /Could not read/);
  assert.match(stashFilesHtml([]), /contains no files/);
  const html = stashFilesHtml(['a.js', 'b.js']);
  assert.match(html, /2 files in this entry/);
  assert.ok(html.includes('<code>a.js</code>'));
});

test('stashFilesHtml caps the list and says how many are hidden', () => {
  const many = Array.from({ length: 25 }, (_v, i) => `f${i}.js`);
  const html = stashFilesHtml(many, 20);
  assert.match(html, /25 files in this entry/);
  assert.match(html, /plus 5 files/);
  assert.ok(!html.includes('f24.js'));
});

test('stashOutcomeHtml paints the tone as a ds-callout modifier that exists in the DS', () => {
  const html = stashOutcomeHtml(stashApplyOutcome({ ok: true, files: [] }, 200));
  assert.match(html, /ds-callout--success/);
  const bad = stashOutcomeHtml(stashApplyOutcome({ ok: false, error: 'apply-failed' }, 200));
  assert.match(bad, /ds-callout--danger/);
  // No outcome at all still renders a callout rather than throwing.
  assert.match(stashOutcomeHtml(null), /ds-callout--danger/);
});

test('stashIntroLines: says what is here, that the app never pops, and that Claude is a way out', () => {
  const lines = stashIntroLines();
  assert.strictEqual(lines.length, 3);
  assert.ok(lines.some((l) => /never runs git stash pop/.test(l)));
  assert.ok(lines.some((l) => /Claude/.test(l)));
  assert.ok(lines.some((l) => /git stash apply/.test(l)));
});

test('every user-facing string is English', () => {
  const all = [
    ...stashIntroLines(),
    stashPillState([entry()]).title,
    stashEntryTitle(entry()),
    claudePromptForStash(entry()),
    ...stashApplyOutcome({ ok: true, files: [] }, 200).lines,
    ...stashApplyOutcome({ ok: false, error: 'conflict', conflicts: [] }, 200).lines,
  ].join(' ');
  assert.doesNotMatch(all, /[ąćęłńóśźż]/i);
  assert.ok(all.includes('stash'));
});
